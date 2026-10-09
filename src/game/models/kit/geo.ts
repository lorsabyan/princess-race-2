import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export type Vec3 = [number, number, number];
export type ColorFn = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => THREE.ColorRepresentation;

export interface PartOptions {
  /** Position. */
  p?: Vec3;
  /** Euler rotation in radians (XYZ). */
  r?: Vec3;
  /** Uniform or per-axis scale. */
  s?: number | Vec3;
  /** Wind sway amplitude in world units (constant or per-vertex in builder space). */
  wind?: number | ((x: number, y: number, z: number) => number);
  /** Baked ambient-occlusion style darkening: color *= mix(k, 1, smoothstep(y0, y1, y)). */
  shade?: { y0: number; y1: number; k: number };
  /** Faceted look: split vertices and recompute flat normals. */
  flat?: boolean;
  /** Keep UVs (for textured builders). */
  keepUv?: boolean;
}

const tmpColor = new THREE.Color();
const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpScale = new THREE.Vector3();
const tmpPos = new THREE.Vector3();

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function composeMatrix(opts: PartOptions, target = tmpMatrix): THREE.Matrix4 {
  const p = opts.p ?? [0, 0, 0];
  const r = opts.r ?? [0, 0, 0];
  const s = opts.s ?? 1;
  tmpPos.set(p[0], p[1], p[2]);
  tmpQuat.setFromEuler(tmpEuler.set(r[0], r[1], r[2]));
  if (typeof s === 'number') tmpScale.set(s, s, s);
  else tmpScale.set(s[0], s[1], s[2]);
  return target.compose(tmpPos, tmpQuat, tmpScale);
}

/**
 * Accumulates vertex-colored parts and merges them into one geometry so a whole
 * prop (or a whole street chunk) renders in a single draw call.
 */
export class PartBuilder {
  readonly parts: THREE.BufferGeometry[] = [];
  private readonly keepUv: boolean;

  constructor(opts: { keepUv?: boolean } = {}) {
    this.keepUv = opts.keepUv ?? false;
  }

  get isEmpty(): boolean {
    return this.parts.length === 0;
  }

  add(source: THREE.BufferGeometry, color: THREE.ColorRepresentation | ColorFn, opts: PartOptions = {}): this {
    let g = source.clone();
    if (opts.flat) {
      g = g.index ? g.toNonIndexed() : g;
      g.deleteAttribute('normal');
      g.computeVertexNormals();
    }
    for (const name of Object.keys(g.attributes)) {
      if (name === 'position' || name === 'normal') continue;
      if (name === 'uv' && (this.keepUv || opts.keepUv)) continue;
      g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(composeMatrix(opts));
    this.paint(g, color, opts);
    this.push(g);
    return this;
  }

  /** Adds an already colored geometry (must carry color + wind attributes, e.g. from another builder). */
  addColored(source: THREE.BufferGeometry, opts: PartOptions = {}): this {
    const g = source.clone();
    if (opts.p || opts.r || opts.s) g.applyMatrix4(composeMatrix(opts));
    if (!g.attributes.wind) g.setAttribute('wind', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1));
    this.push(g);
    return this;
  }

  /** Merges another builder's content with an optional transform. */
  addBuilder(other: PartBuilder, opts: PartOptions = {}): this {
    const merged = other.build();
    if (merged) this.addColored(merged, opts);
    return this;
  }

  build(): THREE.BufferGeometry | null {
    if (this.parts.length === 0) return null;
    const merged = mergeGeometries(this.parts, false);
    if (!merged) throw new Error('PartBuilder: mergeGeometries failed (attribute mismatch)');
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }

  private push(g: THREE.BufferGeometry): void {
    if (!g.index) {
      const count = g.attributes.position.count;
      const index = new (count > 65535 ? Uint32Array : Uint16Array)(count);
      for (let i = 0; i < count; i += 1) index[i] = i;
      g.setIndex(new THREE.BufferAttribute(index, 1));
    }
    if (this.keepUv && !g.attributes.uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    // mergeGeometries needs identical index types; normalise to 32-bit.
    const idx = g.index!;
    if (!(idx.array instanceof Uint32Array)) {
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx.array as ArrayLike<number>), 1));
    }
    this.parts.push(g);
  }

  private paint(g: THREE.BufferGeometry, color: THREE.ColorRepresentation | ColorFn, opts: PartOptions): void {
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const count = pos.count;
    const colors = new Float32Array(count * 3);
    const wind = new Float32Array(count);
    const isFn = typeof color === 'function';
    if (!isFn) tmpColor.set(color as THREE.ColorRepresentation);
    for (let i = 0; i < count; i += 1) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      if (isFn) tmpColor.set((color as ColorFn)(x, y, z, nor.getX(i), nor.getY(i), nor.getZ(i)));
      let k = 1;
      if (opts.shade) k = opts.shade.k + (1 - opts.shade.k) * smoothstep(opts.shade.y0, opts.shade.y1, y);
      colors[i * 3] = tmpColor.r * k;
      colors[i * 3 + 1] = tmpColor.g * k;
      colors[i * 3 + 2] = tmpColor.b * k;
      if (opts.wind !== undefined) wind[i] = typeof opts.wind === 'number' ? opts.wind : opts.wind(x, y, z);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('wind', new THREE.BufferAttribute(wind, 1));
  }
}

// ---------------------------------------------------------------------------
// Geometry factories. All return fresh geometries; builders clone on add.
// ---------------------------------------------------------------------------

export function rbox(w: number, h: number, d: number, radius = 0.08, segments = 3): THREE.BufferGeometry {
  const r = Math.min(radius, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3);
  return new RoundedBoxGeometry(w, h, d, segments, Math.max(0.001, r));
}

export function sphere(r: number, w = 20, h = 14): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, w, h);
}

export function cyl(rTop: number, rBottom: number, h: number, seg = 20, open = false): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, open);
}

export function cone(r: number, h: number, seg = 20): THREE.BufferGeometry {
  return new THREE.ConeGeometry(r, h, seg);
}

export function torus(R: number, r: number, radial = 10, tubular = 32, arc = Math.PI * 2): THREE.BufferGeometry {
  return new THREE.TorusGeometry(R, r, radial, tubular, arc);
}

export function capsule(r: number, len: number, cap = 6, radial = 14): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(r, len, cap, radial);
}

/**
 * Lathe from a profile of [radius, y] points. Profiles are optionally smoothed
 * with a Catmull-Rom curve so silhouettes read as sculpted rather than faceted.
 */
export function lathe(profile: Array<[number, number]>, segments = 28, smooth = 0): THREE.BufferGeometry {
  let pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y));
  if (smooth > 0) {
    const curve = new THREE.SplineCurve(pts);
    pts = curve.getSpacedPoints(Math.max(pts.length * smooth, 8));
  }
  const g = new THREE.LatheGeometry(pts, segments);
  return g;
}

/** Extrude a 2D shape (in XY) along Z with soft bevels, centered on Z. */
export function extrude(
  shape: THREE.Shape,
  depth: number,
  bevel = 0.04,
  bevelSegments = 3,
  curveSegments = 18,
): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments,
    curveSegments,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Tube along a list of points. */
export function tube(points: Vec3[], radius: number, tubular = 32, radial = 8, closed = false): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed);
  return new THREE.TubeGeometry(curve, tubular, radius, radial, closed);
}

export function heartShape(size = 1): THREE.Shape {
  const s = size / 2;
  const shape = new THREE.Shape();
  shape.moveTo(0, -s * 0.95);
  shape.bezierCurveTo(-s * 0.2, -s * 0.7, -s * 1.1, -s * 0.2, -s * 1.0, s * 0.35);
  shape.bezierCurveTo(-s * 0.95, s * 0.85, -s * 0.35, s * 1.05, 0, s * 0.6);
  shape.bezierCurveTo(s * 0.35, s * 1.05, s * 0.95, s * 0.85, s * 1.0, s * 0.35);
  shape.bezierCurveTo(s * 1.1, -s * 0.2, s * 0.2, -s * 0.7, 0, -s * 0.95);
  return shape;
}

export function starShape(outer = 0.5, inner = 0.22, points = 5): THREE.Shape {
  const shape = new THREE.Shape();
  for (let i = 0; i <= points * 2; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = Math.PI / 2 + (i / (points * 2)) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  return shape;
}

export function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const x = -w / 2;
  const y = -h / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + w - r, y);
  shape.quadraticCurveTo(x + w, y, x + w, y + r);
  shape.lineTo(x + w, y + h - r);
  shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  shape.lineTo(x + r, y + h);
  shape.quadraticCurveTo(x, y + h, x, y + h - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

/** Arch-topped window/door outline: rectangle with a semicircular top. */
export function archShape(w: number, h: number): THREE.Shape {
  const r = w / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-r, 0);
  shape.lineTo(-r, h - r);
  shape.absarc(0, h - r, r, Math.PI, 0, true);
  shape.lineTo(r, 0);
  shape.lineTo(-r, 0);
  return shape;
}

/** Deterministic hash noise for displacement (no allocation). */
export function hash3(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

export function valueNoise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = x - xi;
  const yf = y - yi;
  const zf = z - zi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const w = zf * zf * (3 - 2 * zf);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c000 = hash3(xi, yi, zi);
  const c100 = hash3(xi + 1, yi, zi);
  const c010 = hash3(xi, yi + 1, zi);
  const c110 = hash3(xi + 1, yi + 1, zi);
  const c001 = hash3(xi, yi, zi + 1);
  const c101 = hash3(xi + 1, yi, zi + 1);
  const c011 = hash3(xi, yi + 1, zi + 1);
  const c111 = hash3(xi + 1, yi + 1, zi + 1);
  return lerp(
    lerp(lerp(c000, c100, u), lerp(c010, c110, u), v),
    lerp(lerp(c001, c101, u), lerp(c011, c111, u), v),
    w,
  );
}

/** Puffy blob: subdivided icosahedron displaced by smooth noise. Good for bushes and canopies. */
export function blob(radius: number, detail = 3, amp = 0.12, freq = 2.2, seed = 0): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i);
    const n = valueNoise3(v.x * freq + seed * 13.1, v.y * freq + seed * 7.7, v.z * freq + seed * 3.3);
    v.multiplyScalar(1 + (n - 0.5) * 2 * amp);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  // Icosahedron geometry is non-indexed; merge coincident vertices for smooth normals.
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const merged = mergeVerticesSafe(g);
  merged.computeVertexNormals();
  return merged;
}

export function mergeVerticesSafe(g: THREE.BufferGeometry, tolerance = 1e-4): THREE.BufferGeometry {
  return mergeVertices(g, tolerance);
}

export function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
  });
}
