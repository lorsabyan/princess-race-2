import * as THREE from 'three';
import { PAL } from '../kit/palette';
import { extrude, heartShape } from '../kit/geo';

/**
 * Crown in its own frame: base ring centered on the origin at y = 0, points up,
 * front point toward -Z. Built as a closed rounded wall swept around Y whose
 * height varies with the angle, so the points and dips stay one smooth surface.
 */
export const CROWN = {
  radius: 0.112,
  flare: 0.16,
  thickness: 0.013,
  band: 0.046,
  peak: 0.072,
  points: 5,
};

export function crownHeight(a: number): number {
  const f = Math.pow(0.5 + 0.5 * Math.cos(CROWN.points * a), 1.7);
  return CROWN.band + CROWN.peak * f;
}

export function crownRadius(y: number): number {
  return CROWN.radius + CROWN.flare * y;
}

export function buildCrown(): THREE.BufferGeometry {
  const N = 110; // around
  const T = CROWN.thickness;
  const h = T / 2;
  // Cross-section loop (outer side up, top cap, inner side down, bottom cap).
  const side = 4;
  const cap = 4;
  const loop: Array<(H: number) => [number, number, number]> = []; // returns [radialOffset, y, isOuter(1)/inner(0)]
  for (let i = 0; i < side; i += 1) {
    const f = i / side;
    loop.push((H) => [h, h + (H - 2 * h) * f, 1]);
  }
  for (let i = 0; i < cap; i += 1) {
    const ang = (i / cap) * Math.PI;
    loop.push((H) => [h * Math.cos(ang), H - h + h * Math.sin(ang), 1]);
  }
  for (let i = 0; i < side; i += 1) {
    const f = i / side;
    loop.push((H) => [-h, H - h - (H - 2 * h) * f, 0]);
  }
  for (let i = 0; i < cap; i += 1) {
    const ang = Math.PI + (i / cap) * Math.PI;
    loop.push(() => [h * Math.cos(ang), h + h * Math.sin(ang), 0]);
  }
  const L = loop.length;
  const pos = new Float32Array(N * L * 3);
  const col = new Float32Array(N * L * 3);
  const gold = new THREE.Color('#ffc451');
  const deep = new THREE.Color(PAL.goldDeep);
  const bright = new THREE.Color('#ffe08a');
  const bandRidge = (y: number) => 0.0055 * Math.exp(-Math.pow((y - 0.016) / 0.011, 2));
  for (let i = 0; i < N; i += 1) {
    const a = (i / N) * Math.PI * 2;
    const H = crownHeight(a);
    const sx = Math.sin(a);
    const sz = -Math.cos(a);
    for (let j = 0; j < L; j += 1) {
      const [off, y, outer] = loop[j](H);
      const ridge = outer ? bandRidge(y) : 0;
      const r = crownRadius(y) + off + ridge;
      const k = (i * L + j) * 3;
      pos[k] = sx * r;
      pos[k + 1] = y;
      pos[k + 2] = sz * r;
      let c: THREE.Color;
      if (outer) c = gold.clone().lerp(bright, Math.min(1, ridge / 0.004) * 0.35);
      else c = deep.clone().lerp(gold, 0.35);
      col[k] = c.r;
      col[k + 1] = c.g;
      col[k + 2] = c.b;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < N; i += 1) {
    const i2 = (i + 1) % N;
    for (let j = 0; j < L; j += 1) {
      const j2 = (j + 1) % L;
      const a = i * L + j;
      const b = i2 * L + j;
      const c = i2 * L + j2;
      const d = i * L + j2;
      idx.push(a, d, b, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export interface CrownJewel {
  geometry: THREE.BufferGeometry;
  color: THREE.ColorRepresentation;
  matrix: THREE.Matrix4;
}

/** Pearls on the tips, cabochons on the band and a heart gem in front (crown frame). */
export function crownJewels(): CrownJewel[] {
  const out: CrownJewel[] = [];
  const pearlGeo = new THREE.SphereGeometry(1, 10, 8);
  const studGeo = new THREE.SphereGeometry(1, 8, 6);
  const gemGeo = new THREE.SphereGeometry(1, 12, 7);
  const heart = extrude(heartShape(1), 0.25, 0.12, 2, 7);
  heart.center();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  for (let k = 0; k < CROWN.points; k += 1) {
    const a = (k / CROWN.points) * Math.PI * 2;
    const sx = Math.sin(a);
    const sz = -Math.cos(a);
    // Pearl on the tip.
    const H = crownHeight(a);
    const rTop = crownRadius(H);
    p.set(sx * rTop, H + 0.011, sz * rTop);
    out.push({ geometry: pearlGeo, color: PAL.pearl, matrix: new THREE.Matrix4().compose(p.clone(), q.identity().clone(), s.set(0.0155, 0.0155, 0.0155).clone()) });
    // Gem on the wall below the point.
    const gy = 0.045;
    const rr = crownRadius(gy) + CROWN.thickness / 2 + 0.002;
    p.set(sx * rr, gy, sz * rr);
    const out1 = new THREE.Vector3(sx, -CROWN.flare * 0.5, sz).normalize();
    q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), out1);
    if (k === 0) {
      out.push({ geometry: heart, color: PAL.gemPink, matrix: m.clone().compose(p.clone(), q.clone(), s.set(0.036, 0.036, 0.036).clone()) });
    } else {
      const color = k === 1 || k === 4 ? PAL.gemBlue : PAL.gemPink;
      out.push({ geometry: gemGeo, color, matrix: m.clone().compose(p.clone(), q.clone(), s.set(0.0125, 0.0135, 0.0075).clone()) });
    }
    // Tiny pearl stud in the dip between points, on the band ridge.
    const ad = a + Math.PI / CROWN.points;
    const rd = crownRadius(0.016) + CROWN.thickness / 2 + 0.0055;
    p.set(Math.sin(ad) * rd, 0.016, -Math.cos(ad) * rd);
    out.push({ geometry: studGeo, color: PAL.pearl, matrix: m.clone().compose(p.clone(), q.identity().clone(), s.set(0.0068, 0.0068, 0.0068).clone()) });
  }
  return out;
}
