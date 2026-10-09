import * as THREE from 'three';
import { mat } from '../kit/materials';

/**
 * Immediate-mode geometry accumulator, one bucket per shared material role.
 *
 * It follows the same conventions as the kit's PartBuilder (vertex `color`,
 * per-vertex `wind`, baked `shade` gradient, p/r/s transforms) but writes
 * straight into growable typed arrays with a transform stack, so a whole street
 * chunk (hundreds of parts, nested house -> facade -> window frames) merges into
 * five meshes without cloning every part. Prefabs (trees, lamps, fences) are
 * baked once into small colored geometries and stamped in with `stamp`.
 */

export type Role = 'matte' | 'foliage' | 'glass' | 'metal' | 'glow';
export const ROLES: readonly Role[] = ['matte', 'foliage', 'glass', 'metal', 'glow'];

export type Vec3 = [number, number, number];

export interface Xf {
  p?: Vec3;
  r?: Vec3;
  s?: number | Vec3;
}

/** Writes a color into `out` (linear) for a vertex in the current frame's local space. */
export type ColorFn = (x: number, y: number, z: number, nx: number, ny: number, nz: number, out: THREE.Color) => void;
export type Paint = THREE.ColorRepresentation | ColorFn;

export interface PartOpts extends Xf {
  /** Baked AO: color *= mix(k, 1, smoothstep(y0, y1, y)) with y in frame space. */
  shade?: { y0: number; y1: number; k: number };
  /** Wind sway amplitude (constant or per-vertex in frame space). */
  wind?: number | ((x: number, y: number, z: number) => number);
}

export interface StampOpts extends Xf {
  /** Multiplies the prefab's baked colors. */
  tint?: THREE.Color;
  /** Scales the prefab's baked wind amplitudes. */
  windScale?: number;
}

export type Prefab = Partial<Record<Role, THREE.BufferGeometry>>;

const colorCache = new Map<string, THREE.Color>();
/** Parsed (linear) color, cached. */
export function col(c: THREE.ColorRepresentation): THREE.Color {
  if (c instanceof THREE.Color) return c;
  const key = String(c);
  let hit = colorCache.get(key);
  if (!hit) {
    hit = new THREE.Color(c);
    colorCache.set(key, hit);
  }
  return hit;
}

/** Linear-space mix of two colors into a new Color. */
export function mix(a: THREE.ColorRepresentation, b: THREE.ColorRepresentation, t: number): THREE.Color {
  return col(a).clone().lerp(col(b), t);
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const tmpEuler = new THREE.Euler();
const tmpQuat = new THREE.Quaternion();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3();

export function xfMatrix(xf: Xf, target = new THREE.Matrix4()): THREE.Matrix4 {
  const p = xf.p;
  const r = xf.r;
  const s = xf.s ?? 1;
  tmpPos.set(p ? p[0] : 0, p ? p[1] : 0, p ? p[2] : 0);
  if (r) tmpQuat.setFromEuler(tmpEuler.set(r[0], r[1], r[2]));
  else tmpQuat.identity();
  if (typeof s === 'number') tmpScale.set(s, s, s);
  else tmpScale.set(s[0], s[1], s[2]);
  return target.compose(tmpPos, tmpQuat, tmpScale);
}

class Bucket {
  pos = new Float32Array(3 * 4096);
  nor = new Float32Array(3 * 4096);
  col = new Float32Array(3 * 4096);
  wind = new Float32Array(4096);
  idx = new Uint32Array(8192);
  v = 0;
  i = 0;

  reserve(nv: number, ni: number): void {
    if (this.v + nv > this.wind.length) {
      let cap = this.wind.length;
      while (this.v + nv > cap) cap *= 2;
      this.pos = grow(this.pos, cap * 3);
      this.nor = grow(this.nor, cap * 3);
      this.col = grow(this.col, cap * 3);
      this.wind = grow(this.wind, cap);
    }
    if (this.i + ni > this.idx.length) {
      let cap = this.idx.length;
      while (this.i + ni > cap) cap *= 2;
      const next = new Uint32Array(cap);
      next.set(this.idx.subarray(0, this.i));
      this.idx = next;
    }
  }

  geometry(): THREE.BufferGeometry | null {
    if (this.i === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, this.v * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.slice(0, this.v * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.slice(0, this.v * 3), 3));
    g.setAttribute('wind', new THREE.BufferAttribute(this.wind.slice(0, this.v), 1));
    const index = this.v > 65535 ? this.idx.slice(0, this.i) : Uint16Array.from(this.idx.subarray(0, this.i));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

function grow(a: Float32Array<ArrayBuffer>, size: number): Float32Array<ArrayBuffer> {
  const next = new Float32Array(size);
  next.set(a);
  return next;
}

const vL = new THREE.Vector3();
const vW = new THREE.Vector3();
const nL = new THREE.Vector3();
const nW = new THREE.Vector3();
const cTmp = new THREE.Color();
const mLocal = new THREE.Matrix4();
const mWorld = new THREE.Matrix4();
const nmLocal = new THREE.Matrix3();
const nmWorld = new THREE.Matrix3();

export const binsDebug = { nan: false };

function checkNaN(b: Bucket, from: number, to: number, what: string): void {
  for (let i = from * 3; i < to * 3; i += 1) {
    if (Number.isNaN(b.pos[i])) {
      console.warn(`NaN position in ${what}`, new Error().stack);
      return;
    }
  }
}

export class Bins {
  private readonly buckets = new Map<Role, Bucket>();
  private readonly stack: THREE.Matrix4[] = [new THREE.Matrix4()];

  /** Enter a child frame (composed with the current one). */
  push(xf: Xf | THREE.Matrix4): this {
    const local = xf instanceof THREE.Matrix4 ? xf : xfMatrix(xf, new THREE.Matrix4());
    this.stack.push(new THREE.Matrix4().multiplyMatrices(this.top, local));
    return this;
  }

  pop(): this {
    if (this.stack.length > 1) this.stack.pop();
    return this;
  }

  /** Run `fn` inside a child frame. */
  within(xf: Xf, fn: () => void): this {
    this.push(xf);
    try {
      fn();
    } finally {
      this.pop();
    }
    return this;
  }

  get top(): THREE.Matrix4 {
    return this.stack[this.stack.length - 1];
  }

  private bucket(role: Role): Bucket {
    let b = this.buckets.get(role);
    if (!b) {
      b = new Bucket();
      this.buckets.set(role, b);
    }
    return b;
  }

  /** Add a primitive with a flat color or a color function. */
  add(role: Role, geo: THREE.BufferGeometry, paint: Paint, opts: PartOpts = {}): this {
    const hasLocal = opts.p !== undefined || opts.r !== undefined || opts.s !== undefined;
    if (hasLocal) xfMatrix(opts, mLocal);
    else mLocal.identity();
    mWorld.multiplyMatrices(this.top, mLocal);
    nmLocal.getNormalMatrix(mLocal);
    nmWorld.getNormalMatrix(mWorld);
    const flip = mWorld.determinant() < 0;

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const nor = geo.attributes.normal as THREE.BufferAttribute;
    const n = pos.count;
    const index = geo.index;
    const ni = index ? index.count : n;
    const b = this.bucket(role);
    b.reserve(n, ni);
    const base = b.v;

    const fn = typeof paint === 'function' ? (paint as ColorFn) : null;
    if (!fn) cTmp.copy(col(paint as THREE.ColorRepresentation));
    const shade = opts.shade;
    const wind = opts.wind;
    const top = this.top;

    for (let k = 0; k < n; k += 1) {
      vL.fromBufferAttribute(pos, k).applyMatrix4(mLocal);
      nL.fromBufferAttribute(nor, k).applyMatrix3(nmLocal).normalize();
      if (fn) fn(vL.x, vL.y, vL.z, nL.x, nL.y, nL.z, cTmp);
      let f = 1;
      if (shade) f = shade.k + (1 - shade.k) * smoothstep(shade.y0, shade.y1, vL.y);
      const o3 = (base + k) * 3;
      b.col[o3] = cTmp.r * f;
      b.col[o3 + 1] = cTmp.g * f;
      b.col[o3 + 2] = cTmp.b * f;
      b.wind[base + k] = wind === undefined ? 0 : typeof wind === 'number' ? wind : wind(vL.x, vL.y, vL.z);
      vW.copy(vL).applyMatrix4(top);
      nW.fromBufferAttribute(nor, k).applyMatrix3(nmWorld).normalize();
      b.pos[o3] = vW.x;
      b.pos[o3 + 1] = vW.y;
      b.pos[o3 + 2] = vW.z;
      b.nor[o3] = nW.x;
      b.nor[o3 + 1] = nW.y;
      b.nor[o3 + 2] = nW.z;
    }
    this.writeIndex(b, index, n, base, flip);
    b.v += n;
    if (binsDebug.nan) checkNaN(b, base, b.v, `add(${role})`);
    return this;
  }

  /** Stamp an already colored geometry (color + optional wind attributes). */
  addColored(role: Role, geo: THREE.BufferGeometry, opts: StampOpts = {}): this {
    const hasLocal = opts.p !== undefined || opts.r !== undefined || opts.s !== undefined;
    if (hasLocal) xfMatrix(opts, mLocal);
    else mLocal.identity();
    mWorld.multiplyMatrices(this.top, mLocal);
    nmWorld.getNormalMatrix(mWorld);
    const flip = mWorld.determinant() < 0;

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const nor = geo.attributes.normal as THREE.BufferAttribute;
    const colors = geo.attributes.color as THREE.BufferAttribute | undefined;
    const winds = geo.attributes.wind as THREE.BufferAttribute | undefined;
    const n = pos.count;
    const index = geo.index;
    const ni = index ? index.count : n;
    const b = this.bucket(role);
    b.reserve(n, ni);
    const base = b.v;
    const tint = opts.tint;
    const ws = opts.windScale ?? 1;
    for (let k = 0; k < n; k += 1) {
      vW.fromBufferAttribute(pos, k).applyMatrix4(mWorld);
      nW.fromBufferAttribute(nor, k).applyMatrix3(nmWorld).normalize();
      const o3 = (base + k) * 3;
      b.pos[o3] = vW.x;
      b.pos[o3 + 1] = vW.y;
      b.pos[o3 + 2] = vW.z;
      b.nor[o3] = nW.x;
      b.nor[o3 + 1] = nW.y;
      b.nor[o3 + 2] = nW.z;
      let r = 1;
      let g = 1;
      let bl = 1;
      if (colors) {
        r = colors.getX(k);
        g = colors.getY(k);
        bl = colors.getZ(k);
      }
      if (tint) {
        r *= tint.r;
        g *= tint.g;
        bl *= tint.b;
      }
      b.col[o3] = r;
      b.col[o3 + 1] = g;
      b.col[o3 + 2] = bl;
      b.wind[base + k] = winds ? winds.getX(k) * ws : 0;
    }
    this.writeIndex(b, index, n, base, flip);
    b.v += n;
    if (binsDebug.nan) checkNaN(b, base, b.v, `addColored(${role})`);
    return this;
  }

  /** Stamp a multi-role prefab. */
  stamp(prefab: Prefab, opts: StampOpts = {}): this {
    for (const role of ROLES) {
      const g = prefab[role];
      if (g) this.addColored(role, g, opts);
    }
    return this;
  }

  private writeIndex(b: Bucket, index: THREE.BufferAttribute | null, n: number, base: number, flip: boolean): void {
    const ni = index ? index.count : n;
    const out = b.idx;
    let o = b.i;
    if (index) {
      const arr = index.array;
      for (let k = 0; k < ni; k += 3) {
        out[o] = base + arr[k];
        out[o + 1] = base + (flip ? arr[k + 2] : arr[k + 1]);
        out[o + 2] = base + (flip ? arr[k + 1] : arr[k + 2]);
        o += 3;
      }
    } else {
      for (let k = 0; k < ni; k += 3) {
        out[o] = base + k;
        out[o + 1] = base + (flip ? k + 2 : k + 1);
        out[o + 2] = base + (flip ? k + 1 : k + 2);
        o += 3;
      }
    }
    b.i = o;
  }

  triangles(): number {
    let t = 0;
    for (const b of this.buckets.values()) t += b.i / 3;
    return t;
  }

  /** Bake into one geometry per role (used for cached prefabs). */
  geometries(): Prefab {
    const out: Prefab = {};
    for (const role of ROLES) {
      const g = this.buckets.get(role)?.geometry();
      if (g) out[role] = g;
    }
    return out;
  }

  /** Bake into meshes using the shared world materials. */
  meshes(prefix: string): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    for (const role of ROLES) {
      const g = this.buckets.get(role)?.geometry();
      if (!g) continue;
      const mesh = new THREE.Mesh(g, mat(role));
      mesh.name = `${prefix}-${role}`;
      mesh.castShadow = role !== 'glow';
      mesh.receiveShadow = role !== 'glow';
      meshes.push(mesh);
    }
    return meshes;
  }
}

/** Build a prefab with a fresh Bins. */
export function bake(fn: (b: Bins) => void): Prefab {
  const b = new Bins();
  fn(b);
  return b.geometries();
}

export function prefabTriangles(p: Prefab): number {
  let t = 0;
  for (const role of ROLES) {
    const g = p[role];
    if (g) t += (g.index ? g.index.count : g.attributes.position.count) / 3;
  }
  return t;
}
