import * as THREE from 'three';

/** Signed area of a closed 2D polyline (positive = counter-clockwise). */
function signedArea(pts: THREE.Vector2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export interface PillowOptions {
  /** Bulge of the front (+Z) face. */
  front: number;
  /** Bulge of the back (-Z) face. 0 = no back half at all (open; for parts sitting on a surface). */
  back: number;
  /** Radial ring positions (0..1, ascending, last must be 1). */
  rings?: number[];
  /** Dent the front face (tufting): returns an offset (negative = inward). */
  dent?: (x: number, y: number) => number;
  /** Profile exponent: larger = flatter top, rounder rim. */
  flat?: number;
}

/**
 * "Inflated" 2D outline: a puffy pillow whose front bulges toward +Z and back
 * toward -Z, meeting at a rounded rim on z = 0. Great for heart cushions,
 * glowing heart lamps and soft emblems. The outline must be star-shaped
 * around `center`.
 */
export function pillow(outline: THREE.Vector2[], center: THREE.Vector2, opts: PillowOptions): THREE.BufferGeometry {
  const pts = signedArea(outline) < 0 ? [...outline].reverse() : outline;
  const n = pts.length;
  const rings = opts.rings ?? [0.2, 0.4, 0.56, 0.7, 0.8, 0.88, 0.94, 0.98, 1];
  const flat = opts.flat ?? 2.4;
  const prof = (rho: number) => Math.pow(Math.max(0, 1 - Math.pow(rho, flat)), 0.5);
  const pos: number[] = [];
  const idx: number[] = [];
  // Front center, front rings (excluding rim), rim, back rings (reverse), back center.
  const frontCenter = 0;
  pos.push(center.x, center.y, opts.front + (opts.dent?.(center.x, center.y) ?? 0));
  const ringStart: number[] = [];
  const addRing = (rho: number, side: 1 | -1) => {
    ringStart.push(pos.length / 3);
    for (let k = 0; k < n; k += 1) {
      const x = center.x + (pts[k].x - center.x) * rho;
      const y = center.y + (pts[k].y - center.y) * rho;
      let z = side > 0 ? opts.front * prof(rho) : -opts.back * prof(rho);
      if (side > 0 && opts.dent && rho < 1) z += opts.dent(x, y) * prof(rho);
      pos.push(x, y, z);
    }
  };
  const inner = rings.slice(0, -1);
  const hasBack = opts.back > 0;
  for (const r of inner) addRing(r, 1);
  addRing(1, 1); // rim (z = 0)
  if (hasBack) for (let i = inner.length - 1; i >= 0; i -= 1) addRing(inner[i], -1);
  const backCenter = pos.length / 3;
  if (hasBack) pos.push(center.x, center.y, -opts.back);

  // Front fan.
  const r0 = ringStart[0];
  for (let k = 0; k < n; k += 1) idx.push(frontCenter, r0 + k, r0 + ((k + 1) % n));
  // Bands (front rings -> rim -> back rings). The same winding works for both halves:
  // the ring order runs back inward on the back half, which flips the facing to -Z.
  for (let r = 0; r < ringStart.length - 1; r += 1) {
    const a = ringStart[r];
    const b = ringStart[r + 1];
    for (let k = 0; k < n; k += 1) {
      const k1 = (k + 1) % n;
      idx.push(a + k, b + k, b + k1, a + k, b + k1, a + k1);
    }
  }
  // Back fan.
  if (hasBack) {
    const rl = ringStart[ringStart.length - 1];
    for (let k = 0; k < n; k += 1) idx.push(backCenter, rl + ((k + 1) % n), rl + k);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Heart outline (point down), width ~= size, height ~= 0.92 * size, origin near the middle. */
export function heartOutline(size: number, samples = 72): THREE.Vector2[] {
  const s = size / 2;
  const shape = new THREE.Shape();
  shape.moveTo(0, -s * 0.95);
  shape.bezierCurveTo(-s * 0.2, -s * 0.7, -s * 1.1, -s * 0.2, -s * 1.0, s * 0.35);
  shape.bezierCurveTo(-s * 0.95, s * 0.85, -s * 0.35, s * 1.05, 0, s * 0.6);
  shape.bezierCurveTo(s * 0.35, s * 1.05, s * 0.95, s * 0.85, s * 1.0, s * 0.35);
  shape.bezierCurveTo(s * 1.1, -s * 0.2, s * 0.2, -s * 0.7, 0, -s * 0.95);
  const pts = shape.getSpacedPoints(samples);
  pts.pop(); // closed: drop the duplicate end point
  return pts;
}

/** Closed smooth tube through 2D outline points lifted to 3D by `lift`. */
export function outlineTube(
  pts: THREE.Vector2[],
  radius: number,
  lift: (p: THREE.Vector2) => THREE.Vector3,
  tubular = 96,
  radial = 8,
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(pts.map(lift), true, 'centripetal');
  return new THREE.TubeGeometry(curve, tubular, radius, radial, true);
}

/** Open tube through 3D points. */
export function pathTube(points: THREE.Vector3[], radius: number, tubular = 64, radial = 10): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  return new THREE.TubeGeometry(curve, tubular, radius, radial, false);
}

/** Smile outline: a curved band whose corners curl upward, centered at the origin. */
export function smileOutline(w: number, thick: number, curl: number, samples = 20): THREE.Vector2[] {
  const out: THREE.Vector2[] = [];
  const top = (x: number) => thick * 0.42 + curl * 0.7 * (x / w) ** 2;
  const bottom = (x: number) => -thick * 0.58 + curl * 1.25 * (x / w) ** 2;
  const capR = (top(w) - bottom(w)) / 2;
  // Top edge left -> right.
  for (let i = 0; i <= samples; i += 1) {
    const x = -w + (2 * w * i) / samples;
    out.push(new THREE.Vector2(x, top(x)));
  }
  // Right cap (semicircle bulging outward).
  const cy = (top(w) + bottom(w)) / 2;
  for (let i = 1; i < 8; i += 1) {
    const a = Math.PI / 2 - (Math.PI * i) / 8;
    out.push(new THREE.Vector2(w + Math.cos(a) * capR, cy + Math.sin(a) * capR));
  }
  // Bottom edge right -> left.
  for (let i = 0; i <= samples; i += 1) {
    const x = w - (2 * w * i) / samples;
    out.push(new THREE.Vector2(x, bottom(x)));
  }
  // Left cap.
  for (let i = 1; i < 8; i += 1) {
    const a = -Math.PI / 2 - (Math.PI * i) / 8;
    out.push(new THREE.Vector2(-w + Math.cos(a) * capR, cy + Math.sin(a) * capR));
  }
  return out;
}
