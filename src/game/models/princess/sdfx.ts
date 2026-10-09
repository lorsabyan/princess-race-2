import { blend, roundCone, union, type SdfNode } from '../kit/sdf';

export type TubePoint = [number, number, number, number]; // x, y, z, radius

/** Non-uniform scale (approximate distance; fine for gentle ratios). */
export function stretch(n: SdfNode, sx: number, sy: number, sz: number): SdfNode {
  const k = Math.min(sx, sy, sz);
  return {
    d: (x, y, z) => n.d(x / sx, y / sy, z / sz) * k,
    m: (x, y, z) => n.m(x / sx, y / sy, z / sz),
  };
}

/**
 * Displacement that is only evaluated near the surface (|d| < band); far away the
 * base distance is returned unchanged, which is all the mesher needs there.
 */
export function displaceNear(n: SdfNode, f: (x: number, y: number, z: number) => number, band = 0.03): SdfNode {
  return {
    d: (x, y, z) => {
      const d = n.d(x, y, z);
      return Math.abs(d) > band ? d : d + f(x, y, z);
    },
    m: n.m,
  };
}

/** Smooth tapered tube through points (round cones between consecutive points). */
export function tube(points: TubePoint[], k = 0, mat = 0): SdfNode {
  const segs: SdfNode[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const cone = roundCone(a[0], a[1], a[2], b[0], b[1], b[2], a[3], b[3], mat);
    // Each segment gets its own bounding sphere so long tubes stay cheap to evaluate.
    const cx = (a[0] + b[0]) / 2;
    const cy = (a[1] + b[1]) / 2;
    const cz = (a[2] + b[2]) / 2;
    const r = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 2 + Math.max(a[3], b[3]);
    segs.push(bounded(cone, cx, cy, cz, r, Math.max(0.03, k * 2)));
  }
  if (segs.length === 1) return segs[0];
  return k > 0 ? blend(k, ...segs) : union(...segs);
}

/**
 * Skip evaluating `n` when the query point is far from its bounding sphere and
 * return a conservative distance instead. Speeds up fields with many small parts.
 */
export function bounded(n: SdfNode, cx: number, cy: number, cz: number, r: number, margin = 0.06): SdfNode {
  return {
    d: (x, y, z) => {
      const dx = x - cx;
      const dy = y - cy;
      const dz = z - cz;
      const ds = Math.sqrt(dx * dx + dy * dy + dz * dz) - r;
      return ds > margin ? ds : n.d(x, y, z);
    },
    m: n.m,
  };
}

/** Bounding sphere of a tube's control points (plus radii). */
export function tubeBounds(points: TubePoint[]): [number, number, number, number] {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const p of points) {
    cx += p[0];
    cy += p[1];
    cz += p[2];
  }
  cx /= points.length;
  cy /= points.length;
  cz /= points.length;
  let r = 0;
  for (const p of points) {
    r = Math.max(r, Math.hypot(p[0] - cx, p[1] - cy, p[2] - cz) + p[3]);
  }
  return [cx, cy, cz, r];
}

export function boundedTube(points: TubePoint[], k = 0, mat = 0): SdfNode {
  const [cx, cy, cz, r] = tubeBounds(points);
  return bounded(tube(points, k, mat), cx, cy, cz, r);
}

/** Catmull-Rom resample of a tube path for smoother bends. */
export function smoothPath(points: TubePoint[], perSegment = 3): TubePoint[] {
  if (points.length < 3) return points;
  const out: TubePoint[] = [];
  const get = (i: number) => points[Math.max(0, Math.min(points.length - 1, i))];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    for (let s = 0; s < perSegment; s += 1) {
      const t = s / perSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      const q: TubePoint = [0, 0, 0, 0];
      for (let c = 0; c < 4; c += 1) {
        q[c] =
          0.5 *
          (2 * p1[c] +
            (-p0[c] + p2[c]) * t +
            (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 +
            (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3);
      }
      out.push(q);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}
