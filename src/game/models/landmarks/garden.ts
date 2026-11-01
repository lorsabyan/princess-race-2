import * as THREE from 'three';
import { PAL } from '../kit/palette';
import { rbox, sphere, valueNoise3 } from '../kit/geo';
import { blend, ellipsoid, move, type SdfNode } from '../kit/sdf';
import { meshSdf } from '../kit/mesher';
import { Bag, FLOWER_COLORS, FLOWER_GEO, latheRings, rng, type Col } from './kit';

/** Shared garden and decor pieces for the landmarks (beds, paving, lanterns, railings). */

/** Flat tiled floor with crisp per-tile colors (one colored geometry). */
export function tileFloor(x0: number, x1: number, z0: number, z1: number, y: number, size: number, color: (ix: number, iz: number, cx: number, cz: number) => Col): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  const c = new THREE.Color();
  const nx = Math.max(1, Math.round((x1 - x0) / size));
  const nz = Math.max(1, Math.round((z1 - z0) / size));
  const sx = (x1 - x0) / nx;
  const sz = (z1 - z0) / nz;
  const gap = Math.min(sx, sz) * 0.03;
  // Grout: one sheet under the tiles, so the gaps never show what lies below.
  const low = y - 0.012;
  pos.push(x0, low, z0, x0, low, z1, x1, low, z1, x0, low, z0, x1, low, z1, x1, low, z0);
  c.set(PAL.stoneDeep);
  for (let k = 0; k < 6; k += 1) {
    col.push(c.r, c.g, c.b);
    nor.push(0, 1, 0);
  }
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < nz; j += 1) {
      const ax = x0 + i * sx + gap;
      const bx = x0 + (i + 1) * sx - gap;
      const az = z0 + j * sz + gap;
      const bz = z0 + (j + 1) * sz - gap;
      c.set(color(i, j, (ax + bx) / 2, (az + bz) / 2));
      const quad = [ax, y, az, ax, y, bz, bx, y, bz, ax, y, az, bx, y, bz, bx, y, az];
      pos.push(...quad);
      for (let k = 0; k < 6; k += 1) {
        col.push(c.r, c.g, c.b);
        nor.push(0, 1, 0);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('wind', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3), 1));
  return g;
}

export const ROSES: Col[] = [PAL.flowerRose, PAL.blossom, PAL.flowerWhite, PAL.flowerRose, PAL.blossomLight];

/**
 * Garden bed of rounded shrubs (SDF-blended puffs of varied size and height,
 * merged at the base) sprinkled with blossoms, running along X.
 */
export function hedgeRow(
  bag: Bag, x0: number, x1: number, z: number, h: number, d: number, seed: number,
  y = 0, flowers: Col[] = FLOWER_COLORS, cell = 0.23, alongZ = false,
): void {
  // Built along local X; alongZ rotates the bed so it runs from z=x0 to z=x1 at x=z (front faces +X).
  const len = Math.abs(x1 - x0);
  const cx = (x0 + x1) / 2;
  const place = (lx: number, ly: number, lz: number): [number, number, number] =>
    alongZ ? [z + lz, y + ly, cx - lx] : [cx + lx, y + ly, z + lz];
  const rand = rng(seed);
  const parts: SdfNode[] = [];
  // Low base so the bed reads as one planting.
  parts.push(move(ellipsoid(len / 2, h * 0.28, d * 0.42), 0, h * 0.12, 0));
  let u = -len / 2 + d * 0.35;
  let i = 0;
  while (u < len / 2 - d * 0.3) {
    const big = i % 3 !== 1;
    const r = d * (big ? 0.5 + rand() * 0.14 : 0.34 + rand() * 0.1);
    const hh = h * (big ? 0.9 + rand() * 0.3 : 0.6 + rand() * 0.15);
    parts.push(move(ellipsoid(r * 1.05, hh * 0.52, r * 0.95), u + r * 0.2, hh * 0.48, (rand() - 0.5) * d * 0.25));
    u += r * (1.35 + rand() * 0.35);
    i += 1;
  }
  const field = blend(0.22, ...parts);
  const deep = new THREE.Color(PAL.leafDeep);
  const leaf = new THREE.Color(PAL.leaf);
  const tmp = new THREE.Color();
  const g = meshSdf(field, {
    min: [-len / 2 - 0.6, -0.05, -d / 2 - 0.5],
    max: [len / 2 + 0.6, h * 1.3 + 0.3, d / 2 + 0.5],
    cell,
    project: 1,
    colorFn: (xx, yy, zz) =>
      tmp
        .copy(deep)
        .lerp(leaf, Math.min(1, Math.max(0, yy / (h * 1.1))) ** 1.2)
        .offsetHSL(0, 0, (valueNoise3(xx * 2.2, yy * 2.2, zz * 2.2) - 0.5) * 0.08)
        .getHex(),
    wind: (_x, yy) => 0.018 * Math.max(0, yy / h),
  });
  bag.foliage.addColored(g, alongZ ? { p: [z, y, cx], r: [0, Math.PI / 2, 0] } : { p: [cx, y, z] });
  g.dispose();
  // Blossoms on the surface: march down the field from above; favor the tops.
  const count = Math.round(len * d * (cell > 0.23 ? 2.6 : 3.4));
  for (let k = 0; k < count; k += 1) {
    const lx = (rand() - 0.5) * (len - 0.2);
    const lz = (rand() - 0.5) * d * 0.9 + d * 0.08;
    let ly = h * 1.4 + 0.4;
    for (let it = 0; it < 24; it += 1) {
      const dist = field.d(lx, ly, lz);
      if (dist < 0.01) break;
      ly -= dist;
    }
    if (ly < h * 0.45) continue;
    const fr = 0.08 + rand() * 0.06;
    bag.foliage.add(FLOWER_GEO, flowers[Math.floor(rand() * flowers.length)], { p: place(lx, ly + 0.02, lz), s: fr, wind: 0.018 });
  }
}

/** Wall lantern: gold bracket + glowing lamp, facing along ry. */
export function lantern(bag: Bag, x: number, y: number, z: number, ry: number): void {
  const C = { gold: PAL.gold, goldDeep: PAL.goldDeep };
  const nx = Math.sin(ry);
  const nz = Math.cos(ry);
  // Wall bracket.
  bag.metal.add(rbox(0.08, 0.08, 0.6, 0.03, 1), C.gold, { p: [x + nx * 0.3, y + 0.55, z + nz * 0.3], r: [0, ry, 0] });
  bag.metal.add(rbox(0.3, 0.3, 0.06, 0.03, 1), C.goldDeep, { p: [x + nx * 0.02, y + 0.45, z + nz * 0.02], r: [0, ry, 0] });
  const lx = x + nx * 0.62;
  const lz = z + nz * 0.62;
  const cage = latheRings(
    [
      [0.0, -0.12, C.gold],
      [0.1, -0.1],
      [0.17, 0.02],
      [0.17, 0.03],
      [0.02, 0.03],
    ],
    { segments: 10 },
  );
  bag.metal.addColored(cage, { p: [lx, y - 0.1, lz] });
  bag.glow.add(new THREE.CylinderGeometry(0.13, 0.11, 0.42, 10), '#fff0c0', { p: [lx, y + 0.14, lz] });
  bag.metal.addColored(
    latheRings(
      [
        [0.2, 0.0, C.gold],
        [0.22, 0.04],
        [0.09, 0.2],
        [0.02, 0.32],
        [0.0, 0.34],
      ],
      { segments: 10 },
    ),
    { p: [lx, y + 0.35, lz] },
  );
  bag.metal.add(sphere(0.05, 8, 6), C.gold, { p: [lx, y + 0.72, lz] });
}

/** Little lathe baluster (railing post). */
export const BALUSTER = latheRings(
  [
    [0.1, 0, '#fff0e2'],
    [0.05, 0.12],
    [0.1, 0.3],
    [0.05, 0.5],
    [0.09, 0.6],
  ],
  { segments: 6 },
);

export function balustrade(bag: Bag, x0: number, z0: number, x1: number, z1: number, y: number, h = 0.62, spacing = 0.62, rail: Col = PAL.trimWhite): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(2, Math.round(len / spacing));
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    bag.matte.addColored(BALUSTER, { p: [x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t], s: [1, h / 0.6, 1] });
  }
  const ry = Math.atan2(x1 - x0, z1 - z0);
  bag.matte.add(rbox(0.26, 0.12, len + 0.3, 0.05, 1), rail, { p: [(x0 + x1) / 2, y + h + 0.04, (z0 + z1) / 2], r: [0, ry, 0] });
}

