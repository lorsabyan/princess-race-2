/**
 * Tiny signed-distance-field modeling kit.
 *
 * Shapes are blended with smooth unions/subtractions (like sculpting clay), then
 * turned into triangles by `meshSdf` (surface nets). Each primitive carries a
 * material id; the mesher colors every vertex by the id of the nearest primitive,
 * so regions (paint, interior, trim) stay crisp without extra draw calls.
 */

export interface SdfNode {
  d(x: number, y: number, z: number): number;
  m(x: number, y: number, z: number): number;
}

const sqrt = Math.sqrt;
const abs = Math.abs;
const max = Math.max;
const min = Math.min;

function len3(x: number, y: number, z: number): number {
  return sqrt(x * x + y * y + z * z);
}

function smin(a: number, b: number, k: number): number {
  if (k <= 0) return min(a, b);
  const h = max(k - abs(a - b), 0) / k;
  return min(a, b) - h * h * k * 0.25;
}

function smax(a: number, b: number, k: number): number {
  return -smin(-a, -b, k);
}

// ---------------------------------------------------------------------------
// Primitives (centered at origin)
// ---------------------------------------------------------------------------

export function sphere(r: number, mat = 0): SdfNode {
  return { d: (x, y, z) => len3(x, y, z) - r, m: () => mat };
}

/** Approximate ellipsoid (Inigo Quilez). Good enough for soft organic forms. */
export function ellipsoid(rx: number, ry: number, rz: number, mat = 0): SdfNode {
  return {
    d: (x, y, z) => {
      const k0 = len3(x / rx, y / ry, z / rz);
      const k1 = len3(x / (rx * rx), y / (ry * ry), z / (rz * rz));
      return k1 < 1e-9 ? -min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
    },
    m: () => mat,
  };
}

/** Box with half-extents and edge radius. */
export function roundBox(hx: number, hy: number, hz: number, r: number, mat = 0): SdfNode {
  return {
    d: (x, y, z) => {
      const qx = abs(x) - hx + r;
      const qy = abs(y) - hy + r;
      const qz = abs(z) - hz + r;
      return len3(max(qx, 0), max(qy, 0), max(qz, 0)) + min(max(qx, max(qy, qz)), 0) - r;
    },
    m: () => mat,
  };
}

/** Capsule between points a and b. */
export function capsule(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  r: number, mat = 0,
): SdfNode {
  const bax = bx - ax;
  const bay = by - ay;
  const baz = bz - az;
  const baba = bax * bax + bay * bay + baz * baz;
  return {
    d: (x, y, z) => {
      const pax = x - ax;
      const pay = y - ay;
      const paz = z - az;
      const h = min(1, max(0, (pax * bax + pay * bay + paz * baz) / baba));
      return len3(pax - bax * h, pay - bay * h, paz - baz * h) - r;
    },
    m: () => mat,
  };
}

/** Cone-capsule between a (radius r1) and b (radius r2). Inigo Quilez round cone. */
export function roundCone(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  r1: number, r2: number, mat = 0,
): SdfNode {
  const bax = bx - ax;
  const bay = by - ay;
  const baz = bz - az;
  const l2 = bax * bax + bay * bay + baz * baz;
  const rr = r1 - r2;
  const a2 = l2 - rr * rr;
  const il2 = 1 / l2;
  return {
    d: (x, y, z) => {
      const pax = x - ax;
      const pay = y - ay;
      const paz = z - az;
      const yy = pax * bax + pay * bay + paz * baz;
      const zz = yy - l2;
      const qx = pax * l2 - bax * yy;
      const qy = pay * l2 - bay * yy;
      const qz = paz * l2 - baz * yy;
      const x2 = qx * qx + qy * qy + qz * qz;
      const y2 = yy * yy * l2;
      const z2 = zz * zz * l2;
      const k = Math.sign(rr) * rr * rr * x2;
      if (Math.sign(zz) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
      if (Math.sign(yy) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
      return (sqrt(x2 * a2 * il2) + yy * rr) * il2 - r1;
    },
    m: () => mat,
  };
}

/** Torus lying in the XZ plane. */
export function torus(R: number, r: number, mat = 0): SdfNode {
  return {
    d: (x, y, z) => {
      const q = sqrt(x * x + z * z) - R;
      return sqrt(q * q + y * y) - r;
    },
    m: () => mat,
  };
}

/** Vertical cylinder (Y axis) with half height h, radius r and edge rounding rr. */
export function cylinder(r: number, h: number, rr = 0, mat = 0): SdfNode {
  return {
    d: (x, y, z) => {
      const dx = sqrt(x * x + z * z) - r + rr;
      const dy = abs(y) - h + rr;
      return min(max(dx, dy), 0) + len3(max(dx, 0), max(dy, 0), 0) - rr;
    },
    m: () => mat,
  };
}

/** Infinite half-space below plane y = h (useful for flat-bottoming shapes). */
export function planeBelow(h: number, mat = 0): SdfNode {
  return { d: (_x, y) => y - h, m: () => mat };
}

// ---------------------------------------------------------------------------
// Operators
// ---------------------------------------------------------------------------

export function union(...nodes: SdfNode[]): SdfNode {
  return {
    d: (x, y, z) => {
      let d = Infinity;
      for (const n of nodes) d = min(d, n.d(x, y, z));
      return d;
    },
    m: (x, y, z) => nearest(nodes, x, y, z).m(x, y, z),
  };
}

/** Smooth union with blend radius k (clay-like fillets between parts). */
export function blend(k: number, ...nodes: SdfNode[]): SdfNode {
  return {
    d: (x, y, z) => {
      let d = nodes[0].d(x, y, z);
      for (let i = 1; i < nodes.length; i += 1) d = smin(d, nodes[i].d(x, y, z), k);
      return d;
    },
    m: (x, y, z) => nearest(nodes, x, y, z).m(x, y, z),
  };
}

/**
 * Carve `b` out of `a` with optional smoothing k. Surfaces created by the carve
 * get `innerMat` (e.g. a darker cabin interior) when provided.
 */
export function subtract(a: SdfNode, b: SdfNode, k = 0, innerMat?: number): SdfNode {
  return {
    d: (x, y, z) => (k > 0 ? smax(a.d(x, y, z), -b.d(x, y, z), k) : max(a.d(x, y, z), -b.d(x, y, z))),
    m: (x, y, z) => {
      if (innerMat === undefined) return a.m(x, y, z);
      return -b.d(x, y, z) >= a.d(x, y, z) - 1e-4 ? innerMat : a.m(x, y, z);
    },
  };
}

export function intersect(a: SdfNode, b: SdfNode, k = 0): SdfNode {
  return {
    d: (x, y, z) => (k > 0 ? smax(a.d(x, y, z), b.d(x, y, z), k) : max(a.d(x, y, z), b.d(x, y, z))),
    m: (x, y, z) => a.m(x, y, z),
  };
}

export function move(n: SdfNode, tx: number, ty: number, tz: number): SdfNode {
  return {
    d: (x, y, z) => n.d(x - tx, y - ty, z - tz),
    m: (x, y, z) => n.m(x - tx, y - ty, z - tz),
  };
}

/** Rotate by Euler XYZ angles (radians). */
export function rotate(n: SdfNode, rx: number, ry: number, rz: number): SdfNode {
  // Build R = Rz * Ry * Rx (three.js 'XYZ' order), then apply R^T to points.
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  const m00 = cy * cz, m01 = -cy * sz, m02 = sy;
  const m10 = cx * sz + sx * sy * cz, m11 = cx * cz - sx * sy * sz, m12 = -sx * cy;
  const m20 = sx * sz - cx * sy * cz, m21 = sx * cz + cx * sy * sz, m22 = cx * cy;
  const inv = (x: number, y: number, z: number, f: (x: number, y: number, z: number) => number) =>
    f(m00 * x + m10 * y + m20 * z, m01 * x + m11 * y + m21 * z, m02 * x + m12 * y + m22 * z);
  return {
    d: (x, y, z) => inv(x, y, z, n.d),
    m: (x, y, z) => inv(x, y, z, n.m),
  };
}

export function scale(n: SdfNode, s: number): SdfNode {
  return {
    d: (x, y, z) => n.d(x / s, y / s, z / s) * s,
    m: (x, y, z) => n.m(x / s, y / s, z / s),
  };
}

/** Mirror across the YZ plane (symmetric left/right models). */
export function mirrorX(n: SdfNode): SdfNode {
  return { d: (x, y, z) => n.d(abs(x), y, z), m: (x, y, z) => n.m(abs(x), y, z) };
}

/** Inflate (positive) or shrink (negative) a shape. */
export function inflate(n: SdfNode, r: number): SdfNode {
  return { d: (x, y, z) => n.d(x, y, z) - r, m: n.m };
}

/** Hollow shell of thickness t. */
export function shell(n: SdfNode, t: number): SdfNode {
  return { d: (x, y, z) => abs(n.d(x, y, z)) - t, m: n.m };
}

/** Add a displacement field (keep amplitude small to preserve the distance property). */
export function displace(n: SdfNode, f: (x: number, y: number, z: number) => number): SdfNode {
  return { d: (x, y, z) => n.d(x, y, z) + f(x, y, z), m: n.m };
}

/** Override material everywhere. */
export function paint(n: SdfNode, mat: number): SdfNode {
  return { d: n.d, m: () => mat };
}

/** Paint regions by a function of position (stripes, bands, gradients by id). */
export function paintBy(n: SdfNode, f: (x: number, y: number, z: number, base: number) => number): SdfNode {
  return { d: n.d, m: (x, y, z) => f(x, y, z, n.m(x, y, z)) };
}

function nearest(nodes: SdfNode[], x: number, y: number, z: number): SdfNode {
  let best = nodes[0];
  let bestD = Infinity;
  for (const n of nodes) {
    const d = n.d(x, y, z);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best;
}
