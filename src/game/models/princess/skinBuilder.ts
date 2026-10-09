import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { composeMatrix, type Vec3 } from '../kit/geo';

/** Up to four [boneIndex, weight] pairs; weights are normalized on write. */
export type Influence = ReadonlyArray<readonly [number, number]>;
export type WeightFn = (x: number, y: number, z: number) => Influence;
export type SkinColorFn = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => THREE.ColorRepresentation;
export type UvFn = (x: number, y: number, z: number) => [number, number];

export interface SkinPartOptions {
  p?: Vec3;
  r?: Vec3;
  s?: number | Vec3;
  /** Extra transform applied after p/r/s. */
  matrix?: THREE.Matrix4;
  /** Rigid bone index or a per-vertex weight function (evaluated in bind space). */
  bone: number | WeightFn;
  /** Flat color or per-vertex function. Omit to keep the geometry's own `color` attribute. */
  color?: THREE.ColorRepresentation | SkinColorFn;
  /** Multiplies the final color (cheap baked shading), evaluated in bind space. */
  tint?: (x: number, y: number, z: number, nx: number, ny: number, nz: number) => number;
  /** Constant UV or per-vertex UV. Default [0.004, 0.004] (a plain corner texel). */
  uv?: [number, number] | UvFn;
  /**
   * Draw-range section: 'sit' parts come first, 'stand' parts last, so each pose
   * can draw one contiguous index range and skip the other pose's parts entirely.
   */
  section?: Section;
}

export type Section = 'sit' | 'common' | 'stand';
const SECTION_ORDER: Section[] = ['sit', 'common', 'stand'];

/** Index ranges (in indices, not triangles) for each pose. */
export interface PoseRanges {
  sit: { start: number; count: number };
  stand: { start: number; count: number };
}

const tmpColor = new THREE.Color();
const tmpMatrix = new THREE.Matrix4();

/**
 * Accumulates parts for ONE skinned mesh: every part carries position, normal,
 * color, uv, skinIndex and skinWeight, so a whole material zone (all the skin,
 * all the hair, all the fabric) renders in a single draw call while each piece
 * still follows its own bone.
 */
export class SkinBuilder {
  private readonly parts: Array<{ g: THREE.BufferGeometry; section: Section }> = [];
  /** Filled by build(). */
  ranges: PoseRanges = { sit: { start: 0, count: Infinity }, stand: { start: 0, count: Infinity } };

  add(source: THREE.BufferGeometry, opts: SkinPartOptions): this {
    let g = source.clone();
    for (const name of Object.keys(g.attributes)) {
      if (name === 'position' || name === 'normal' || name === 'color') continue;
      g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (opts.p || opts.r || opts.s) g.applyMatrix4(composeMatrix(opts, tmpMatrix));
    if (opts.matrix) g.applyMatrix4(opts.matrix);
    if (!g.index) {
      const count = g.attributes.position.count;
      const idx = new Uint32Array(count);
      for (let i = 0; i < count; i += 1) idx[i] = i;
      g.setIndex(new THREE.BufferAttribute(idx, 1));
    } else if (!(g.index.array instanceof Uint32Array)) {
      g.setIndex(new THREE.BufferAttribute(new Uint32Array(g.index.array as ArrayLike<number>), 1));
    }

    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const count = pos.count;
    const oldColor = g.attributes.color as THREE.BufferAttribute | undefined;
    const colors = new Float32Array(count * 3);
    const uvs = new Float32Array(count * 2);
    const skinIndex = new Uint16Array(count * 4);
    const skinWeight = new Float32Array(count * 4);
    const colorIsFn = typeof opts.color === 'function';
    if (opts.color !== undefined && !colorIsFn) tmpColor.set(opts.color as THREE.ColorRepresentation);
    const uvConst = Array.isArray(opts.uv) ? opts.uv : opts.uv ? null : ([0.004, 0.004] as [number, number]);

    for (let i = 0; i < count; i += 1) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const nx = nor.getX(i);
      const ny = nor.getY(i);
      const nz = nor.getZ(i);
      // Color
      if (colorIsFn) tmpColor.set((opts.color as SkinColorFn)(x, y, z, nx, ny, nz));
      else if (opts.color === undefined) {
        if (oldColor) tmpColor.setRGB(oldColor.getX(i), oldColor.getY(i), oldColor.getZ(i));
        else tmpColor.setRGB(1, 1, 1);
      }
      const k = opts.tint ? opts.tint(x, y, z, nx, ny, nz) : 1;
      colors[i * 3] = tmpColor.r * k;
      colors[i * 3 + 1] = tmpColor.g * k;
      colors[i * 3 + 2] = tmpColor.b * k;
      // UV
      if (uvConst) {
        uvs[i * 2] = uvConst[0];
        uvs[i * 2 + 1] = uvConst[1];
      } else {
        const [u, v] = (opts.uv as UvFn)(x, y, z);
        uvs[i * 2] = u;
        uvs[i * 2 + 1] = v;
      }
      // Weights
      if (typeof opts.bone === 'number') {
        skinIndex[i * 4] = opts.bone;
        skinWeight[i * 4] = 1;
      } else {
        writeInfluence(opts.bone(x, y, z), skinIndex, skinWeight, i * 4);
      }
    }
    if (oldColor) g.deleteAttribute('color');
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
    this.parts.push({ g, section: opts.section ?? 'common' });
    return this;
  }

  get triangleCount(): number {
    return this.parts.reduce((n, p) => n + (p.g.index ? p.g.index.count / 3 : 0), 0);
  }

  /** Triangles drawn in each pose. */
  poseTriangles(): { sit: number; stand: number } {
    let sit = 0;
    let stand = 0;
    for (const p of this.parts) {
      const t = p.g.index ? p.g.index.count / 3 : 0;
      if (p.section !== 'stand') sit += t;
      if (p.section !== 'sit') stand += t;
    }
    return { sit, stand };
  }

  build(): THREE.BufferGeometry {
    const ordered = SECTION_ORDER.flatMap((sec) => this.parts.filter((p) => p.section === sec));
    const count = (sec: Section) =>
      this.parts.filter((p) => p.section === sec).reduce((n, p) => n + (p.g.index ? p.g.index.count : 0), 0);
    const nSit = count('sit');
    const nCommon = count('common');
    const nStand = count('stand');
    this.ranges = {
      sit: { start: 0, count: nSit + nCommon },
      stand: { start: nSit, count: nCommon + nStand },
    };
    const merged = mergeGeometries(
      ordered.map((p) => p.g),
      false,
    );
    if (!merged) throw new Error('SkinBuilder: mergeGeometries failed');
    for (const p of this.parts) p.g.dispose();
    this.parts.length = 0;
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    return merged;
  }
}

function writeInfluence(inf: Influence, idx: Uint16Array, w: Float32Array, o: number): void {
  // Keep the 4 strongest influences.
  const sorted = inf.length > 4 ? [...inf].sort((a, b) => b[1] - a[1]).slice(0, 4) : inf;
  let sum = 0;
  for (const [, weight] of sorted) sum += Math.max(0, weight);
  if (sum <= 1e-6) {
    idx[o] = sorted[0]?.[0] ?? 0;
    w[o] = 1;
    return;
  }
  for (let j = 0; j < sorted.length; j += 1) {
    idx[o + j] = sorted[j][0];
    w[o + j] = Math.max(0, sorted[j][1]) / sum;
  }
}

/** Smooth 0..1 ramp. */
export function ramp(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Weights along a polyline of joints: vertices project onto the chain and blend
 * between consecutive bones over `soft` (fraction of a segment).
 */
export function chainWeights(points: Vec3[], bones: number[], soft = 0.5): WeightFn {
  const segs = points.length - 1;
  return (x, y, z) => {
    let best = 0;
    let bestD = Infinity;
    let bestT = 0;
    for (let i = 0; i < segs; i += 1) {
      const a = points[i];
      const b = points[i + 1];
      const abx = b[0] - a[0];
      const aby = b[1] - a[1];
      const abz = b[2] - a[2];
      const l2 = abx * abx + aby * aby + abz * abz;
      let t = ((x - a[0]) * abx + (y - a[1]) * aby + (z - a[2]) * abz) / l2;
      t = Math.min(1, Math.max(0, t));
      const dx = x - (a[0] + abx * t);
      const dy = y - (a[1] + aby * t);
      const dz = z - (a[2] + abz * t);
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
        bestT = t;
      }
    }
    // Segment i belongs to bone i; blend into bone i+1 near the joint.
    const s = best + bestT; // continuous parameter along the chain
    const half = soft / 2;
    const out: Array<[number, number]> = [];
    const seg = Math.min(bones.length - 1, Math.floor(s));
    const f = s - seg;
    if (f > 1 - half && seg + 1 < bones.length) {
      const w = ramp(1 - half, 1 + half, f);
      out.push([bones[seg], 1 - w], [bones[seg + 1], w]);
    } else if (f < half && seg > 0) {
      const w = ramp(-half, half, f);
      out.push([bones[seg - 1], 1 - w], [bones[seg], w]);
    } else {
      out.push([bones[seg], 1]);
    }
    return out;
  };
}
