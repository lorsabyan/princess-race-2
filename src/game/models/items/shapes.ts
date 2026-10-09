import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heartShape } from '../kit/geo';

/**
 * 2D outline helpers + low-poly relief geometry for embossed emblems.
 */

/** Heart outline (CCW, bbox-centered) sampled per bezier segment so the cusp and tip stay crisp. */
export function heartOutline(size: number, perCurve = 9): THREE.Vector2[] {
  const pts = heartShape(size).getPoints(perCurve);
  const out: THREE.Vector2[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || last.distanceToSquared(p) > 1e-10) out.push(p.clone());
  }
  if (out.length > 1 && out[0].distanceToSquared(out[out.length - 1]) < 1e-10) out.pop();
  const box = new THREE.Box2().setFromPoints(out);
  const cy = (box.min.y + box.max.y) / 2;
  const cx = (box.min.x + box.max.x) / 2;
  for (const p of out) p.set(p.x - cx, p.y - cy);
  if (THREE.ShapeUtils.isClockWise(out)) out.reverse();
  return out;
}

/** Offset a CCW polygon inward by d (miter joins, clamped at sharp corners). */
export function insetPolygon(poly: THREE.Vector2[], d: number, maxMiter = 2.6): THREE.Vector2[] {
  const n = poly.length;
  const out: THREE.Vector2[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = poly[(i - 1 + n) % n];
    const p = poly[i];
    const b = poly[(i + 1) % n];
    const e1x = p.x - a.x;
    const e1y = p.y - a.y;
    const e2x = b.x - p.x;
    const e2y = b.y - p.y;
    const l1 = Math.hypot(e1x, e1y) || 1;
    const l2 = Math.hypot(e2x, e2y) || 1;
    // Outward edge normals for a CCW polygon.
    const n1x = e1y / l1;
    const n1y = -e1x / l1;
    const n2x = e2y / l2;
    const n2y = -e2x / l2;
    let mx = n1x + n2x;
    let my = n1y + n2y;
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml;
    my /= ml;
    const cos = Math.max(mx * n1x + my * n1y, 1 / maxMiter);
    const len = d / cos;
    out.push(new THREE.Vector2(p.x - mx * len, p.y - my * len));
  }
  return out;
}

/** Scale a polygon about a center. */
export function scalePolygon(poly: THREE.Vector2[], s: number, cx = 0, cy = 0): THREE.Vector2[] {
  return poly.map((p) => new THREE.Vector2(cx + (p.x - cx) * s, cy + (p.y - cy) * s));
}

/**
 * Pillowy embossed emblem: base ring on z=0, rounded bevel up to a flat cap at z=height.
 * Faces +Z. Only the visible surfaces are generated (no back cap), so it's cheap.
 */
export function reliefGeometry(outline: THREE.Vector2[], height: number, bevel: number): THREE.BufferGeometry {
  const n = outline.length;
  const rings = [
    { pts: outline, z: 0 },
    { pts: insetPolygon(outline, bevel * 0.38), z: height * 0.72 },
    { pts: insetPolygon(outline, bevel), z: height },
  ];
  const pos: number[] = [];
  for (const ring of rings) for (const p of ring.pts) pos.push(p.x, p.y, ring.z);
  const idx: number[] = [];
  for (let k = 0; k < rings.length - 1; k += 1) {
    for (let i = 0; i < n; i += 1) {
      const a = k * n + i;
      const b = k * n + ((i + 1) % n);
      const c = (k + 1) * n + ((i + 1) % n);
      const d = (k + 1) * n + i;
      idx.push(a, b, c, a, c, d);
    }
  }
  const band = new THREE.BufferGeometry();
  band.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  band.setIndex(idx);
  band.computeVertexNormals();

  const top = rings[rings.length - 1];
  const capPos: number[] = [];
  const capNor: number[] = [];
  for (const p of top.pts) {
    capPos.push(p.x, p.y, top.z);
    capNor.push(0, 0, 1);
  }
  const faces = THREE.ShapeUtils.triangulateShape(top.pts, []);
  const capIdx: number[] = [];
  for (const f of faces) capIdx.push(f[0], f[1], f[2]);
  const cap = new THREE.BufferGeometry();
  cap.setAttribute('position', new THREE.Float32BufferAttribute(capPos, 3));
  cap.setAttribute('normal', new THREE.Float32BufferAttribute(capNor, 3));
  cap.setIndex(capIdx);
  const merged = mergeGeometries([band, cap], false);
  band.dispose();
  cap.dispose();
  if (!merged) throw new Error('reliefGeometry: merge failed');
  return merged;
}

/** `count` points evenly spaced by arc length along a closed polygon (starting half a step in). */
export function samplePolygon(poly: THREE.Vector2[], count: number): THREE.Vector2[] {
  const n = poly.length;
  const cum: number[] = [0];
  for (let i = 1; i <= n; i += 1) cum.push(cum[i - 1] + poly[i % n].distanceTo(poly[i - 1]));
  const total = cum[n];
  const out: THREE.Vector2[] = [];
  let seg = 0;
  for (let k = 0; k < count; k += 1) {
    const target = ((k + 0.5) / count) * total;
    while (seg < n - 1 && cum[seg + 1] < target) seg += 1;
    const t = (target - cum[seg]) / Math.max(1e-9, cum[seg + 1] - cum[seg]);
    out.push(poly[seg].clone().lerp(poly[(seg + 1) % n], t));
  }
  return out;
}
