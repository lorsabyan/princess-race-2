import type { SdfNode } from '../kit/sdf';

/** Cylinder along X with half length h, radius r and edge rounding rr. */
export function xCylinder(r: number, h: number, rr = 0, mat = 0): SdfNode {
  return {
    d: (x, y, z) => {
      const dr = Math.sqrt(y * y + z * z) - r + rr;
      const dh = Math.abs(x) - h + rr;
      return Math.min(Math.max(dr, dh), 0) + Math.hypot(Math.max(dr, 0), Math.max(dh, 0)) - rr;
    },
    m: () => mat,
  };
}

/** Cylinder along Z with half length h, radius r and edge rounding rr. */
export function zCylinder(r: number, h: number, rr = 0, mat = 0): SdfNode {
  return {
    d: (x, y, z) => {
      const dr = Math.sqrt(x * x + y * y) - r + rr;
      const dh = Math.abs(z) - h + rr;
      return Math.min(Math.max(dr, dh), 0) + Math.hypot(Math.max(dr, 0), Math.max(dh, 0)) - rr;
    },
    m: () => mat,
  };
}

/** Wrap a node with a custom distance (keeps its material). */
export function custom(d: (x: number, y: number, z: number) => number, mat = 0): SdfNode {
  return { d, m: () => mat };
}

/** Evaluate the normalized gradient (surface normal) of a field. */
export function sdfNormal(node: SdfNode, x: number, y: number, z: number, e = 1e-3): [number, number, number] {
  const gx = node.d(x + e, y, z) - node.d(x - e, y, z);
  const gy = node.d(x, y + e, z) - node.d(x, y - e, z);
  const gz = node.d(x, y, z + e) - node.d(x, y, z - e);
  const l = Math.hypot(gx, gy, gz) || 1;
  return [gx / l, gy / l, gz / l];
}

export interface SurfaceHit {
  p: [number, number, number];
  n: [number, number, number];
}

/**
 * March from `o` along `dir` until the surface is crossed, then bisect.
 * Robust for the approximate (non-Euclidean) fields that blends produce.
 */
export function traceSurface(
  node: SdfNode,
  o: [number, number, number],
  dir: [number, number, number],
  maxDist = 4,
  step = 0.01,
): SurfaceHit | null {
  const l = Math.hypot(dir[0], dir[1], dir[2]) || 1;
  const dx = dir[0] / l;
  const dy = dir[1] / l;
  const dz = dir[2] / l;
  let t0 = 0;
  let d0 = node.d(o[0], o[1], o[2]);
  if (d0 < 0) return null;
  for (let t = step; t <= maxDist; t += step) {
    const d1 = node.d(o[0] + dx * t, o[1] + dy * t, o[2] + dz * t);
    if (d1 < 0) {
      let a = t0;
      let b = t;
      for (let i = 0; i < 30; i += 1) {
        const m = (a + b) / 2;
        if (node.d(o[0] + dx * m, o[1] + dy * m, o[2] + dz * m) < 0) b = m;
        else a = m;
      }
      const tt = (a + b) / 2;
      const p: [number, number, number] = [o[0] + dx * tt, o[1] + dy * tt, o[2] + dz * tt];
      return { p, n: sdfNormal(node, p[0], p[1], p[2]) };
    }
    t0 = t;
    d0 = d1;
  }
  void d0;
  return null;
}

/**
 * Classic SDF ambient occlusion sampled along each vertex normal. Returns a
 * per-vertex factor in [minAo, 1].
 */
export function bakeSdfAo(
  positions: ArrayLike<number>,
  normals: ArrayLike<number>,
  field: SdfNode,
  opts: { step?: number; samples?: number; strength?: number; minAo?: number } = {},
): Float32Array {
  const step = opts.step ?? 0.045;
  const samples = opts.samples ?? 5;
  const strength = opts.strength ?? 1.1;
  const minAo = opts.minAo ?? 0.5;
  const n = positions.length / 3;
  const out = new Float32Array(n);
  for (let v = 0; v < n; v += 1) {
    const px = positions[v * 3];
    const py = positions[v * 3 + 1];
    const pz = positions[v * 3 + 2];
    const nx = normals[v * 3];
    const ny = normals[v * 3 + 1];
    const nz = normals[v * 3 + 2];
    let occ = 0;
    let w = 1;
    let wsum = 0;
    for (let i = 1; i <= samples; i += 1) {
      const h = step * i;
      const d = field.d(px + nx * h, py + ny * h, pz + nz * h);
      occ += w * Math.max(0, h - d) / h;
      wsum += w;
      w *= 0.7;
    }
    out[v] = Math.max(minAo, Math.min(1, 1 - strength * (occ / wsum)));
  }
  return out;
}
