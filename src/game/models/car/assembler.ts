import * as THREE from 'three';
import { composeMatrix, smoothstep, type ColorFn, type PartOptions } from '../kit/geo';
import type { Pbr } from './carMaterials';

/**
 * Paint roles let `setPaint` recolor the body later: every vertex remembers
 * whether it follows the paint, where it sits on the deep->light paint gradient
 * (`t`) and how bright it was (`k`, baked AO), so a garage recolor keeps all
 * baked shading.
 */
export const ROLE_FIXED = 0;
export const ROLE_PAINT = 1;
export const ROLE_INTERIOR = 2;

export interface AsmOptions extends PartOptions {
  /** Paint role for recoloring (default fixed). */
  role?: number;
  /** Paint gradient position for ROLE_PAINT (0 = deep, 1 = light). Default 1. */
  t?: number;
  /** Multiply the color (can exceed 1 for glow parts). */
  gain?: number;
}

export interface RecolorInfo {
  role: Uint8Array;
  t: Float32Array;
  k: Float32Array;
}

interface Chunk extends RecolorInfo {
  pos: Float32Array;
  nor: Float32Array;
  col: Float32Array;
  pbr: Float32Array;
  idx: Uint32Array;
}

const tmpColor = new THREE.Color();
const tmpNormalMatrix = new THREE.Matrix3();

/** Accumulates vertex-colored parts with per-vertex PBR and merges them into one geometry. */
export class Assembler {
  private readonly chunks: Chunk[] = [];

  get isEmpty(): boolean {
    return this.chunks.length === 0;
  }

  /** Triangles added so far. */
  get triangleCount(): number {
    let n = 0;
    for (const c of this.chunks) n += c.idx.length / 3;
    return n;
  }

  /** Vertices added so far (use it to address a part's vertex range in the merged result). */
  get vertexCount(): number {
    let n = 0;
    for (const c of this.chunks) n += c.pos.length / 3;
    return n;
  }

  add(source: THREE.BufferGeometry, color: THREE.ColorRepresentation | ColorFn, pbr: Pbr, opts: AsmOptions = {}): this {
    let g = source.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    if (opts.flat) {
      g = g.index ? g.toNonIndexed() : g;
      g.deleteAttribute('normal');
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(composeMatrix(opts));
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const n = pos.count;
    const col = new Float32Array(n * 3);
    const pb = new Float32Array(n * 4);
    const role = new Uint8Array(n).fill(opts.role ?? ROLE_FIXED);
    const t = new Float32Array(n).fill(opts.t ?? 1);
    const k = new Float32Array(n);
    const isFn = typeof color === 'function';
    if (!isFn) tmpColor.set(color as THREE.ColorRepresentation);
    const gain = opts.gain ?? 1;
    for (let i = 0; i < n; i += 1) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      if (isFn) tmpColor.set((color as ColorFn)(x, y, z, nor.getX(i), nor.getY(i), nor.getZ(i)));
      let s = gain;
      if (opts.shade) s *= opts.shade.k + (1 - opts.shade.k) * smoothstep(opts.shade.y0, opts.shade.y1, y);
      col[i * 3] = tmpColor.r * s;
      col[i * 3 + 1] = tmpColor.g * s;
      col[i * 3 + 2] = tmpColor.b * s;
      k[i] = s;
      pb.set(pbr, i * 4);
    }
    const idx = g.index
      ? new Uint32Array(g.index.array as ArrayLike<number>)
      : Uint32Array.from({ length: n }, (_, i) => i);
    this.chunks.push({
      pos: new Float32Array(pos.array as ArrayLike<number>),
      nor: new Float32Array(nor.array as ArrayLike<number>),
      col,
      pbr: pb,
      role,
      t,
      k,
      idx,
    });
    g.dispose();
    return this;
  }

  /**
   * Add a geometry that already carries `color` (e.g. an SDF mesh). Optional
   * per-vertex pbr and recolor info; otherwise the constant `pbr` and a fixed role.
   */
  addColored(
    g: THREE.BufferGeometry,
    pbr: Pbr | Float32Array,
    extra: Partial<RecolorInfo> & { matrix?: THREE.Matrix4 } = {},
  ): this {
    const n = g.attributes.position.count;
    const pos = new Float32Array(g.attributes.position.array as ArrayLike<number>);
    const nor = new Float32Array(g.attributes.normal.array as ArrayLike<number>);
    if (extra.matrix) {
      const v = new THREE.Vector3();
      tmpNormalMatrix.getNormalMatrix(extra.matrix);
      for (let i = 0; i < n; i += 1) {
        v.fromArray(pos, i * 3).applyMatrix4(extra.matrix).toArray(pos, i * 3);
        v.fromArray(nor, i * 3).applyMatrix3(tmpNormalMatrix).normalize().toArray(nor, i * 3);
      }
    }
    let pb: Float32Array;
    if (pbr instanceof Float32Array) pb = pbr;
    else {
      pb = new Float32Array(n * 4);
      for (let i = 0; i < n; i += 1) pb.set(pbr, i * 4);
    }
    const idx = g.index
      ? new Uint32Array(g.index.array as ArrayLike<number>)
      : Uint32Array.from({ length: n }, (_, i) => i);
    this.chunks.push({
      pos,
      nor,
      col: new Float32Array(g.attributes.color.array as ArrayLike<number>),
      pbr: pb,
      role: extra.role ?? new Uint8Array(n),
      t: extra.t ?? new Float32Array(n).fill(1),
      k: extra.k ?? new Float32Array(n).fill(1),
      idx,
    });
    return this;
  }

  /** Merge everything. Returns the geometry plus recolor metadata. */
  build(): { geometry: THREE.BufferGeometry; recolor: RecolorInfo } {
    let vCount = 0;
    let iCount = 0;
    for (const c of this.chunks) {
      vCount += c.pos.length / 3;
      iCount += c.idx.length;
    }
    const pos = new Float32Array(vCount * 3);
    const nor = new Float32Array(vCount * 3);
    const col = new Float32Array(vCount * 3);
    const pbr = new Float32Array(vCount * 4);
    const role = new Uint8Array(vCount);
    const t = new Float32Array(vCount);
    const k = new Float32Array(vCount);
    const idx = new Uint32Array(iCount);
    let vo = 0;
    let io = 0;
    for (const c of this.chunks) {
      const n = c.pos.length / 3;
      pos.set(c.pos, vo * 3);
      nor.set(c.nor, vo * 3);
      col.set(c.col, vo * 3);
      pbr.set(c.pbr, vo * 4);
      role.set(c.role, vo);
      t.set(c.t, vo);
      k.set(c.k, vo);
      for (let i = 0; i < c.idx.length; i += 1) idx[io + i] = c.idx[i] + vo;
      vo += n;
      io += c.idx.length;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geometry.setAttribute('pbr', new THREE.BufferAttribute(pbr, 4));
    geometry.setIndex(new THREE.BufferAttribute(idx, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return { geometry, recolor: { role, t, k } };
  }
}

/** Palette used by `recolor`. */
export interface PaintSet {
  paint: THREE.Color;
  deep: THREE.Color;
  interior: THREE.Color;
}

/** Derive the deep/interior companions of a paint color (matches PAL's pink trio). */
export function paintSet(color: THREE.ColorRepresentation): PaintSet {
  const paint = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  paint.getHSL(hsl);
  const deep = new THREE.Color().setHSL(hsl.h, Math.max(0, hsl.s - 0.16), Math.max(0, hsl.l - 0.085));
  const interior = new THREE.Color().setHSL(hsl.h, Math.max(0, hsl.s - 0.3), Math.max(0, hsl.l - 0.15));
  return { paint, deep, interior };
}

const mixColor = new THREE.Color();

/** Rewrite vertex colors of paint-role vertices. */
export function recolor(geometry: THREE.BufferGeometry, info: RecolorInfo, set: PaintSet): void {
  const col = geometry.attributes.color as THREE.BufferAttribute;
  const arr = col.array as Float32Array;
  const { role, t, k } = info;
  for (let i = 0; i < role.length; i += 1) {
    const r = role[i];
    if (r === ROLE_FIXED) continue;
    const c = r === ROLE_INTERIOR ? set.interior : mixColor.copy(set.deep).lerp(set.paint, t[i]);
    arr[i * 3] = c.r * k[i];
    arr[i * 3 + 1] = c.g * k[i];
    arr[i * 3 + 2] = c.b * k[i];
  }
  col.needsUpdate = true;
}
