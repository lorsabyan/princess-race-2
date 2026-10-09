import * as THREE from 'three';
import { PAL } from '../kit/palette';
import { Bins, bake, col, type Prefab, type Vec3 } from './bins';
import { addStripedAwning } from './houses';
import { LOOK, darker, foliagePaint, hexOf, lighter } from './look';
import { GREENS } from './plants';
import * as P from './prims';
import { makeRng } from './rng';

/**
 * Street furniture and showpieces. Prop frames: origin on the ground at the
 * prop's footprint center; +X points toward the road unless noted.
 */

const cache = new Map<string, Prefab>();
function cached(key: string, make: () => Prefab): Prefab {
  let p = cache.get(key);
  if (!p) {
    p = make();
    cache.set(key, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Lamps
// ---------------------------------------------------------------------------

function lampBase(b: Bins): void {
  const base = P.lathe('lampBase', [
    [0.001, 0],
    [0.24, 0],
    [0.24, 0.1],
    [0.18, 0.16],
    [0.16, 0.42],
    [0.11, 0.5],
    [0.075, 0.62],
    [0.001, 0.62],
  ], 8, 0);
  b.add('metal', base, LOOK.iron);
  b.add('metal', P.cyl(0.065, 0.075, 3.0, 8), LOOK.iron, { p: [0, 2.0, 0] });
  b.add('metal', P.torus(0.1, 0.03, 3, 10), LOOK.gold, { p: [0, 1.25, 0], r: [Math.PI / 2, 0, 0] });

}

function globe(b: Bins, x: number, y: number, z: number, r = 0.22): void {
  b.add('glow', P.sphere(r, 10, 7), PAL.lampGlow, { p: [x, y, z] });
  b.add('metal', P.dome(r * 0.78, 8, 2), LOOK.iron, { p: [x, y + r * 0.55, z], s: [1, 0.6, 1] });
  b.add('metal', P.sphere(0.05, 5, 3), LOOK.gold, { p: [x, y + r * 1.02, z] });
  b.add('metal', P.cyl(r * 0.45, r * 0.3, 0.07, 6), LOOK.iron, { p: [x, y - r * 0.95, z] });
}

/** Curvy shepherd's-crook lamp; the globe hangs toward +X (the road). ~4.2 m. */
export function crookLamp(): Prefab {
  return cached('crookLamp', () =>
    bake((b) => {
      lampBase(b);
      const arm = P.tube('lampArm', [
        [0, 3.45, 0],
        [0.02, 3.9, 0],
        [0.2, 4.18, 0],
        [0.5, 4.2, 0],
        [0.72, 4.02, 0],
        [0.76, 3.84, 0],
      ], 0.045, 12, 5);
      b.add('metal', arm, LOOK.iron);
      b.add('metal', P.sphere(0.06, 6, 4), LOOK.gold, { p: [0, 4.1, 0] });
      globe(b, 0.76, 3.55, 0, 0.2);
    }),
  );
}

/** Twin-globe lamp with a crown finial. ~4 m. */
export function twinLamp(): Prefab {
  return cached('twinLamp', () =>
    bake((b) => {
      lampBase(b);
      for (const s of [-1, 1]) {
        const arm = P.tube(`twinArm${s}`, [
          [0, 3.3, 0],
          [s * 0.18, 3.42, 0],
          [s * 0.42, 3.36, 0],
          [s * 0.5, 3.5, 0],
        ], 0.035, 8, 4);
        b.add('metal', arm, LOOK.iron);
        globe(b, s * 0.5, 3.78, 0, 0.19);
      }
      globe(b, 0, 4.0, 0, 0.22);
    }),
  );
}

// ---------------------------------------------------------------------------
// Fences
// ---------------------------------------------------------------------------

/** 2 m white picket fence segment along X (pickets face +Z). */
export function fenceSegment(color: string = LOOK.trim, len = 2): Prefab {
  return cached(`fence:${color}:${len}`, () =>
    bake((b) => {
      const picket = P.extrude('picket', () => P.polyShape([[-0.045, 0], [0.045, 0], [0.045, 0.74], [0, 0.84], [-0.045, 0.74]]), { depth: 0.035 });
      const n = Math.round(len / 0.27);
      for (let i = 0; i < n; i += 1) {
        const x = -len / 2 + (i + 0.5) * (len / n);
        b.add('matte', picket, color, { p: [x, 0.02, 0.03], shade: { y0: 0, y1: 0.5, k: 0.82 } });
      }
      for (const y of [0.25, 0.6]) b.add('matte', P.box(len, 0.06, 0.035), color, { p: [0, y, -0.005], shade: { y0: 0, y1: 0.5, k: 0.85 } });
    }),
  );
}

/** Fence post with a ball finial. */
export function fencePost(color: string = LOOK.trim): Prefab {
  return cached(`fencePost:${color}`, () =>
    bake((b) => {
      b.add('matte', P.box(0.12, 0.95, 0.12), color, { p: [0, 0.47, 0], shade: { y0: 0, y1: 0.6, k: 0.8 } });
      b.add('matte', P.box(0.16, 0.05, 0.16), color, { p: [0, 0.96, 0] });
      b.add('matte', P.sphere(0.075, 6, 4), color, { p: [0, 1.04, 0] });
    }),
  );
}

/** Garden gate arch (trellis) with climbing roses, spanning a 1.2 m opening along X. */
export function gateArch(rose: string): Prefab {
  return cached(`gateArch:${rose}`, () =>
    bake((b) => {
      const pts: Vec3[] = [];
      for (let i = 0; i <= 10; i += 1) {
        const a = Math.PI - (i / 10) * Math.PI;
        pts.push([Math.cos(a) * 0.72, 1.55 + Math.sin(a) * 0.55, 0]);
      }
      b.add('matte', P.tube('gateArc', pts, 0.05, 12, 4), LOOK.trim);
      for (const s of [-1, 1]) b.add('matte', P.box(0.09, 1.6, 0.09), LOOK.trim, { p: [s * 0.72, 0.8, 0] });
      const leaf = GREENS[0];
      const paint = foliagePaint(leaf[0], leaf[1], leaf[2], 1.6, 0.6);
      const rng = makeRng(77);
      for (let i = 0; i < 9; i += 1) {
        const a = Math.PI - (i / 8) * Math.PI;
        const x = Math.cos(a) * 0.72;
        const y = 1.55 + Math.sin(a) * 0.55;
        b.add('foliage', P.sphere(0.2, 6, 4), paint, { p: [x, y, (rng() - 0.5) * 0.12], wind: 0.02 });
        if (i % 2 === 0) b.add('foliage', P.ico(0.1, 0), rose, { p: [x, y + 0.12, 0.12], wind: 0.02 });
      }
      for (const s of [-1, 1]) {
        for (let i = 0; i < 3; i += 1) {
          const y = 0.45 + i * 0.4;
          b.add('foliage', P.sphere(0.17, 6, 4), paint, { p: [s * 0.72, y, 0.05 * (i % 2 ? 1 : -1)], wind: 0.01 });
          if (i === 1) b.add('foliage', P.ico(0.09, 0), rose, { p: [s * 0.72 + 0.06, y + 0.06, 0.13], wind: 0.01 });
        }
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// Street furniture
// ---------------------------------------------------------------------------

/** Park bench facing +X, 1.6 m long along Z. */
export function bench(color: string): Prefab {
  return cached(`bench:${color}`, () =>
    bake((b) => {
      const slat = color;
      for (let i = 0; i < 3; i += 1) b.add('matte', P.box(0.13, 0.05, 1.6), slat, { p: [0.18 - i * 0.16, 0.46, 0] });
      for (let i = 0; i < 2; i += 1) b.add('matte', P.box(0.05, 0.13, 1.6), slat, { p: [-0.2 - i * 0.03, 0.66 + i * 0.2, 0], r: [0, 0, 0.16] });
      for (const z of [-0.68, 0.68]) {
        b.add('metal', P.box(0.06, 0.46, 0.06), LOOK.iron, { p: [0.2, 0.23, z] });
        b.add('metal', P.box(0.06, 0.95, 0.06), LOOK.iron, { p: [-0.2, 0.47, z], r: [0, 0, 0.1] });
        b.add('metal', P.box(0.46, 0.05, 0.06), LOOK.iron, { p: [0.02, 0.66, z] });
        b.add('metal', P.torus(0.07, 0.018, 3, 8, Math.PI * 1.4), LOOK.gold, { p: [0.24, 0.62, z], r: [0, 0, -0.4] });
      }
    }),
  );
}

/** Mailbox on a post facing +X (the road). */
export function mailbox(color: string): Prefab {
  return cached(`mailbox:${color}`, () =>
    bake((b) => {
      b.add('matte', P.box(0.09, 1.0, 0.09), LOOK.woodLight, { p: [0, 0.5, 0], shade: { y0: 0, y1: 0.6, k: 0.8 } });
      b.add('matte', P.box(0.5, 0.2, 0.26), color, { p: [0.05, 1.1, 0] });
      b.add('matte', P.cylArc(0.13, 0.5, 10, 0, Math.PI), color, { p: [0.05, 1.2, 0], r: [0, 0, Math.PI / 2] });
      b.add('matte', P.box(0.03, 0.24, 0.24), lighter(color, 0.35), { p: [0.31, 1.15, 0] });
      b.add('matte', P.box(0.03, 0.2, 0.06), PAL.flowerRed, { p: [-0.05, 1.33, 0.15] });
      const heart = P.extrude('mailHeart', () => P.heartShape(0.13), { depth: 0.02 });
      b.add('matte', heart, PAL.flowerRose, { p: [0.33, 1.16, 0], r: [0, Math.PI / 2, 0] });
    }),
  );
}

/** Balloon bunch tied at the origin (strings rise from y = 0). */
export function balloons(seed: number, count = 4, height = 1.9): Prefab {
  return cached(`balloons:${seed}:${count}:${height}`, () =>
    bake((b) => {
      const rng = makeRng(6000 + seed);
      for (let i = 0; i < count; i += 1) {
        const a = (i / count) * Math.PI * 2 + rng();
        const top: Vec3 = [Math.cos(a) * 0.28, height + rng() * 0.45, Math.sin(a) * 0.28];
        const c = LOOK.balloon[(seed + i) % LOOK.balloon.length];
        const sway = (_x: number, y: number) => Math.max(0, y) * 0.07;
        b.add('foliage', P.sphere(0.26, 10, 7), c, { p: [top[0], top[1] + 0.3, top[2]], s: [1, 1.18, 1], wind: sway });
        b.add('foliage', P.cone(0.05, 0.08, 6), hexOf(darker(c, 0.85)), { p: [top[0], top[1], top[2]], r: [Math.PI, 0, 0], wind: sway });
        // String: thin box from the anchor to the knot.
        const dir = new THREE.Vector3(top[0], top[1], top[2]);
        const len = dir.length();
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
        const e = new THREE.Euler().setFromQuaternion(q);
        b.add('foliage', P.box(0.012, 1, 0.012), '#fffaf6', {
          p: [top[0] / 2, top[1] / 2, top[2] / 2],
          r: [e.x, e.y, e.z],
          s: [1, len, 1],
          wind: sway,
        });
      }
    }),
  );
}

/** Birdhouse on a pole. */
export function birdhouse(color: string, roof: string): Prefab {
  return cached(`birdhouse:${color}:${roof}`, () =>
    bake((b) => {
      b.add('matte', P.box(0.08, 1.6, 0.08), LOOK.woodLight, { p: [0, 0.8, 0] });
      b.add('matte', P.box(0.36, 0.4, 0.36), color, { p: [0, 1.8, 0] });
      for (const s of [-1, 1]) b.add('matte', P.box(0.3, 0.04, 0.46), roof, { p: [s * 0.12, 2.08, 0], r: [0, 0, -s * 0.7] });
      b.add('matte', P.cyl(0.06, 0.06, 0.02, 10), '#6a4a5a', { p: [0.185, 1.84, 0], r: [0, 0, Math.PI / 2] });
      b.add('matte', P.box(0.1, 0.02, 0.02), LOOK.woodLight, { p: [0.23, 1.74, 0] });
    }),
  );
}

/** Terracotta planter with a bushy flower mound. */
export function planter(flower: string, v: number): Prefab {
  return cached(`planter:${flower}:${v}`, () =>
    bake((b) => {
      const pot = P.lathe('bigPot', [
        [0.001, 0],
        [0.32, 0],
        [0.4, 0.5],
        [0.46, 0.55],
        [0.45, 0.62],
        [0.001, 0.62],
      ], 9, 0);
      b.add('matte', pot, v % 2 === 0 ? LOOK.terracotta : LOOK.cream, { shade: { y0: 0, y1: 0.5, k: 0.8 } });
      const pal = GREENS[v % GREENS.length];
      b.add('foliage', P.sphere(0.42, 10, 7), foliagePaint(pal[0], pal[1], pal[2], 0.8, 0.4), { p: [0, 0.78, 0], s: [1, 0.72, 1], wind: 0.015 });
      const rng = makeRng(700 + v);
      for (let i = 0; i < 5; i += 1) {
        const a = rng() * Math.PI * 2;
        const r = 0.12 + rng() * 0.22;
        b.add('foliage', P.ico(0.08, 0), i % 3 === 2 ? '#ffffff' : flower, { p: [Math.cos(a) * r, 0.96 - r * 0.35, Math.sin(a) * r], wind: 0.02 });
      }
    }),
  );
}

/** Stepping stone. */
export function steppingStone(): THREE.BufferGeometry {
  return P.cyl(0.26, 0.28, 0.06, 7);
}

// ---------------------------------------------------------------------------
// Showpieces
// ---------------------------------------------------------------------------

/** Catenary points between a and b with sag. */
function catenary(a: Vec3, b: Vec3, sag: number, n: number): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t]);
  }
  return pts;
}

/**
 * Bunting string between two attachment points (in the current frame), with
 * pennants in cycling colors. Built directly into the bins (unique per span).
 */
export function bunting(b: Bins, a: Vec3, c: Vec3, sag: number, colors: readonly string[], key: string): void {
  const span = Math.hypot(c[0] - a[0], c[2] - a[2]);
  const n = Math.max(8, Math.round(span / 0.55));
  const pts = catenary(a, c, sag, n * 2);
  const wind = (x: number, _y: number, z: number) => {
    const t = Math.min(1, Math.max(0, Math.hypot(x - a[0], z - a[2]) / span));
    return Math.sin(Math.PI * t) * 0.12;
  };
  const rope = P.tubeOnce(pts, 0.022, n * 2, 4);
  b.add('foliage', rope, '#fffaf6', { wind });
  rope.dispose();
  void key;
  const flag = P.extrude('buntFlag', () => P.polyShape([[-0.2, 0], [0.2, 0], [0, -0.42]]), { depth: 0.015 });
  const dir = new THREE.Vector3(c[0] - a[0], 0, c[2] - a[2]).normalize();
  const yaw = Math.atan2(-dir.z, dir.x);
  for (let i = 1; i < n; i += 1) {
    const p = pts[i * 2];
    b.add('foliage', flag, colors[i % colors.length], { p: [p[0], p[1] - 0.01, p[2]], r: [0, yaw, 0], wind });
  }
}

/** Tall decorated pole for bunting (7 m), with a pennant. */
export function buntingPole(flag: string): Prefab {
  return cached(`buntPole:${flag}`, () =>
    bake((b) => {
      b.add('matte', P.cyl(0.2, 0.24, 0.3, 10), LOOK.stone, { p: [0, 0.15, 0] });
      b.add('matte', P.cyl(0.07, 0.085, 6.9, 8), LOOK.trim, { p: [0, 3.6, 0] });
      for (let i = 0; i < 3; i += 1) b.add('matte', P.torus(0.085, 0.03, 3, 8), flag, { p: [0, 1.4 + i * 2.0, 0], r: [Math.PI / 2, 0, 0] });
      b.add('metal', P.sphere(0.13, 8, 6), LOOK.gold, { p: [0, 7.1, 0] });
      const pennant = P.extrude('pennantBig', () => P.polyShape([[0, 0], [0.9, -0.22], [0, -0.44]]), { depth: 0.02 });
      b.add('foliage', pennant, flag, { p: [0.06, 6.9, 0], wind: (x) => Math.max(0, x) * 0.12 });
    }),
  );
}

/**
 * Rose-covered arch spanning the road (frame: road center, arch in the XY plane).
 * Pillars at x = ±halfSpan; the arch never drops below 5.2 m over the road.
 */
export function roseArch(halfSpan: number, v: number): Prefab {
  return cached(`roseArch:${halfSpan}:${v}`, () =>
    bake((b) => {
      const spring = 5.3;
      const rise = 2.1;
      const pts: Vec3[] = [];
      const n = 28;
      for (let i = 0; i <= n; i += 1) {
        const a = Math.PI - (i / n) * Math.PI;
        pts.push([Math.cos(a) * halfSpan, spring + Math.sin(a) * rise, 0]);
      }
      const arc = P.tube(`roseArc:${halfSpan}`, pts, 0.1, 30, 5);
      for (const z of [-0.3, 0.3]) b.add('matte', arc, LOOK.trim, { p: [0, 0, z] });
      // Rungs between the two arcs.
      for (let i = 1; i < n; i += 3) {
        const p = pts[i];
        b.add('matte', P.box(0.07, 0.07, 0.6), LOOK.trim, { p: [p[0], p[1], 0] });
      }
      // Lattice pillars.
      for (const s of [-1, 1]) {
        const x = s * halfSpan;
        b.add('matte', P.box(0.8, 0.35, 0.95), LOOK.stone, { p: [x, 0.17, 0] });
        for (const z of [-0.3, 0.3]) {
          for (const dx of [-0.18, 0.18]) b.add('matte', P.box(0.08, spring, 0.08), LOOK.trim, { p: [x + dx, spring / 2 + 0.2, z] });
        }
        for (let k = 0; k < 7; k += 1) {
          b.add('matte', P.box(0.44, 0.05, 0.66), LOOK.trim, { p: [x, 0.6 + k * 0.72, 0] });
        }
        b.add('matte', P.box(0.62, 0.14, 0.82), LOOK.trim, { p: [x, spring + 0.2, 0] });
      }
      // Leaves wrapped around the arc, studded with big roses front and back.
      const rng = makeRng(8000 + v);
      const roses = [PAL.flowerRose, '#ff8fb1', PAL.flowerRed, '#ffffff', '#ffb0c8', '#ff7a9c'];
      const leafPals = [GREENS[1], GREENS[0]];
      for (let i = 0; i <= 22; i += 1) {
        const t = i / 22;
        const a = Math.PI - t * Math.PI;
        const x = Math.cos(a) * halfSpan;
        const y = spring + Math.sin(a) * rise;
        const lp = leafPals[i % 2];
        const leafPaint = foliagePaint(lp[0], lp[1], lp[2], y - 0.2, 0.5);
        b.add('foliage', P.sphere(0.4 + rng() * 0.08, 8, 6), leafPaint, { p: [x, y + (rng() - 0.5) * 0.12, (rng() - 0.5) * 0.3], wind: 0.025 });
        for (const zs of [-1, 1]) {
          if (rng() < 0.2) continue;
          const rc = roses[Math.floor(rng() * roses.length)];
          b.add('foliage', P.sphere(0.17 + rng() * 0.04, 6, 4), rc, { p: [x + (rng() - 0.5) * 0.35, y + (rng() - 0.3) * 0.35, zs * (0.34 + rng() * 0.06)], wind: 0.025 });
        }
      }
      for (const s of [-1, 1]) {
        for (let k = 0; k < 6; k += 1) {
          const y = 0.9 + k * 0.75;
          const z = (k % 2 === 0 ? 1 : -1) * 0.34;
          const lp = leafPals[k % 2];
          b.add('foliage', P.sphere(0.3, 7, 5), foliagePaint(lp[0], lp[1], lp[2], y - 0.2, 0.5), { p: [s * halfSpan + (rng() - 0.5) * 0.3, y, z], wind: 0.015 });
          b.add('foliage', P.sphere(0.15, 7, 5), roses[k % roses.length], { p: [s * halfSpan + (rng() - 0.5) * 0.2, y + 0.12, z * 1.3], wind: 0.015 });
        }
      }
      // Heart emblem at the crown, facing the camera (+Z).
      const heart = P.extrude('archHeart', () => P.heartShape(1.1), { depth: 0.16, bevel: 0.04, curveSegments: 6 });
      const heartBack = P.extrude('archHeartBack', () => P.heartShape(1.36), { depth: 0.12, curveSegments: 6 });
      b.add('matte', heartBack, LOOK.trim, { p: [0, spring + rise + 0.55, 0.36] });
      b.add('matte', heart, PAL.heartGem, { p: [0, spring + rise + 0.55, 0.46] });
      b.add('matte', heartBack, LOOK.trim, { p: [0, spring + rise + 0.55, -0.36], r: [0, Math.PI, 0] });
      b.add('matte', heart, PAL.heartGem, { p: [0, spring + rise + 0.55, -0.46], r: [0, Math.PI, 0] });
    }),
  );
}

/** Tiered park fountain. Water surfaces use the reflective glass role. */
export function fountain(v: number): Prefab {
  return cached(`fountain:${v}`, () =>
    bake((b) => {
      const basin = P.lathe('fountainBasin', [
        [2.0, 0],
        [2.35, 0],
        [2.42, 0.08],
        [2.4, 0.5],
        [2.48, 0.58],
        [2.45, 0.68],
        [2.2, 0.7],
        [2.12, 0.62],
        [2.1, 0.3],
        [0.001, 0.3],
      ], 26, 0);
      b.add('matte', basin, LOOK.stone, { shade: { y0: 0, y1: 0.6, k: 0.8 } });
      // Water: matte aqua (a flat mirror would flash the horizon glow into bloom) + twinkles.
      const water = (inner: string, outer: string, radius: number) => (x: number, _y: number, z: number, _nx: number, _ny: number, _nz: number, out: THREE.Color) => {
        out.set(inner).lerp(col(outer), Math.min(1, Math.hypot(x, z) / radius));
      };
      b.add('matte', P.cyl(2.12, 2.12, 0.1, 26), water('#8fd4ee', '#c4ecf8', 2.12), { p: [0, 0.5, 0] });
      const column = P.lathe('fountainColumn', [
        [0.001, 0.3],
        [0.42, 0.3],
        [0.3, 0.45],
        [0.22, 0.9],
        [0.3, 1.2],
        [0.2, 1.35],
        [0.001, 1.35],
      ], 12, 1);
      b.add('matte', column, LOOK.stone);
      const bowl = P.lathe('fountainBowl', [
        [0.001, 1.3],
        [0.3, 1.32],
        [0.8, 1.52],
        [1.05, 1.7],
        [1.02, 1.78],
        [0.92, 1.74],
        [0.001, 1.62],
      ], 20, 1);
      b.add('matte', bowl, LOOK.cream);
      b.add('matte', P.cyl(0.9, 0.9, 0.05, 20), water('#98d8f0', '#cdeffa', 0.9), { p: [0, 1.7, 0] });
      const tw = makeRng(40 + v);
      for (let i = 0; i < 7; i += 1) {
        const a = tw() * Math.PI * 2;
        const r = 0.5 + tw() * 1.4;
        b.add('glow', P.ico(0.035, 0), '#ffffff', { p: [Math.cos(a) * r, 0.57, Math.sin(a) * r] });
      }
      // Water curtain from the upper bowl.
      const curtain = P.lathe('fountainCurtain', [
        [1.0, 1.72],
        [1.12, 1.55],
        [1.28, 1.0],
        [1.4, 0.52],
      ], 20, 0);
      // Falling water is matte (a curved mirror would flash the sun into bloom).
      b.add('matte', curtain, (_x, y, _z, _nx, _ny, _nz, out) => {
        out.set('#cdeefa').lerp(col('#a6dcf2'), Math.min(1, Math.max(0, (1.7 - y) / 1.2)));
      });
      // Top tier.
      b.add('matte', P.cyl(0.12, 0.18, 0.6, 10), LOOK.cream, { p: [0, 1.95, 0] });
      b.add('matte', P.lathe('fountainTop', [[0.001, 0], [0.2, 0.02], [0.42, 0.14], [0.4, 0.2], [0.001, 0.12]], 16, 0), LOOK.cream, { p: [0, 2.2, 0] });
      const plume = P.lathe('fountainPlume', [
        [0.001, 0],
        [0.07, 0.1],
        [0.09, 0.4],
        [0.05, 0.7],
        [0.001, 0.8],
      ], 10, 2);
      b.add('matte', plume, '#d9f3fc', { p: [0, 2.3, 0] });
      b.add('metal', P.sphere(0.1, 10, 7), LOOK.gold, { p: [0, 3.15, 0] });
      // Lily pads + flowers on the basin water.
      const rng = makeRng(90 + v);
      for (let i = 0; i < 6; i += 1) {
        const a = rng() * Math.PI * 2;
        const r = 1.3 + rng() * 0.6;
        b.add('foliage', P.cyl(0.2, 0.2, 0.03, 9), '#6cc184', { p: [Math.cos(a) * r, 0.56, Math.sin(a) * r] });
        if (i % 2 === 0) b.add('foliage', P.ico(0.08, 0), '#ff9ac0', { p: [Math.cos(a) * r, 0.62, Math.sin(a) * r] });
      }
    }),
  );
}

/** Market stall facing +X: counter, posts, striped awning with valance, goods. */
export function marketStall(stripe: string, goods: 'fruit' | 'flowers' | 'bakery', v: number): Prefab {
  return cached(`stall:${stripe}:${goods}:${v}`, () =>
    bake((b) => {
      const w = 2.4;
      const d = 1.2;
      b.add('matte', P.box(d, 0.9, w), LOOK.woodLight, { p: [0, 0.45, 0], shade: { y0: 0, y1: 0.9, k: 0.8 } });
      b.add('matte', P.box(0.04, 0.6, w - 0.2), stripe, { p: [d / 2 + 0.01, 0.5, 0] });
      b.add('matte', P.box(0.05, 0.08, w + 0.04), LOOK.trim, { p: [d / 2 + 0.02, 0.88, 0] });
      for (const z of [-w / 2 + 0.06, w / 2 - 0.06]) {
        b.add('matte', P.box(0.08, 2.5, 0.08), LOOK.trim, { p: [-d / 2 + 0.06, 1.25, z] });
        b.add('matte', P.box(0.08, 2.15, 0.08), LOOK.trim, { p: [d / 2 - 0.06, 1.075, z] });
      }
      // Awning: frame whose +Z points toward +X (the road).
      b.within({ p: [-d / 2, 0, 0], r: [0, Math.PI / 2, 0] }, () => addStripedAwning(b, w + 0.3, d + 0.5, 2.55, stripe, LOOK.trim, 0.45));
      b.add('matte', P.box(0.1, 0.1, w + 0.3), stripe, { p: [-d / 2 - 0.02, 2.58, 0] });
      const rng = makeRng(9100 + v);
      if (goods === 'fruit') {
        for (let c = 0; c < 3; c += 1) {
          const z = -0.75 + c * 0.75;
          b.add('matte', P.box(0.55, 0.22, 0.6), LOOK.wood, { p: [0.15, 1.0, z] });
          const fruit = [PAL.flowerRed, PAL.flowerOrange, '#ffe066', '#8fd16a'][(c + v) % 4];
          for (let i = 0; i < 6; i += 1) {
            b.add('matte', P.sphere(0.1, 6, 4), fruit, { p: [0.15 + ((i % 3) - 1) * 0.16, 1.17, z + (Math.floor(i / 3) - 0.5) * 0.2] });
          }
        }
      } else if (goods === 'flowers') {
        for (let c = 0; c < 4; c += 1) {
          const z = -0.85 + c * 0.57;
          b.add('matte', P.cyl(0.17, 0.14, 0.32, 8), c % 2 === 0 ? '#9cc8f5' : LOOK.cream, { p: [0.15, 1.06, z] });
          const flower = LOOK.flowers[(c * 2 + v) % LOOK.flowers.length];
          b.add('foliage', P.sphere(0.2, 6, 4), '#5cb56a', { p: [0.15, 1.28, z], s: [1, 0.6, 1], wind: 0.01 });
          for (let i = 0; i < 5; i += 1) {
            const a = rng() * Math.PI * 2;
            const r = rng() * 0.14;
            b.add('foliage', P.ico(0.075, 0), flower, { p: [0.15 + Math.cos(a) * r * 1.1, 1.33 + rng() * 0.14, z + Math.sin(a) * r * 1.1], wind: 0.02 });
          }
        }
        // Buckets on the ground in front.
        for (let c = 0; c < 3; c += 1) {
          const z = -0.8 + c * 0.8;
          b.add('matte', P.cyl(0.16, 0.13, 0.36, 8), '#bfe4ff', { p: [0.9, 0.18, z] });
          for (let i = 0; i < 4; i += 1) {
            const a = (i / 4) * Math.PI * 2;
            b.add('foliage', P.ico(0.09, 0), LOOK.flowers[(c + i + v) % LOOK.flowers.length], { p: [0.9 + Math.cos(a) * 0.09, 0.47 + (i % 2) * 0.06, z + Math.sin(a) * 0.09], wind: 0.02 });
          }
        }
      } else {
        for (let i = 0; i < 6; i += 1) {
          const z = -0.9 + i * 0.36;
          b.add('matte', P.cyl(0.14, 0.14, 0.06, 10), LOOK.trim, { p: [0.15, 0.93, z] });
          const loaf = i % 2 === 0;
          if (loaf) b.add('matte', P.capsule(0.09, 0.18), '#e8b06e', { p: [0.15, 1.04, z], r: [0, 0, Math.PI / 2] });
          else {
            b.add('matte', P.cyl(0.1, 0.09, 0.1, 10), '#ffc2d6', { p: [0.15, 1.01, z] });
            b.add('matte', P.sphere(0.1, 8, 5), '#fff6ea', { p: [0.15, 1.07, z], s: [1, 0.6, 1] });
            b.add('matte', P.sphere(0.035, 6, 4), PAL.flowerRed, { p: [0.15, 1.15, z] });
          }
        }
      }
      // Little sign on top.
      b.add('matte', P.box(0.08, 0.36, 1.0), LOOK.trim, { p: [0.2, 2.95, 0] });
      const heart = P.extrude('stallHeart', () => P.heartShape(0.24), { depth: 0.04 });
      b.add('matte', heart, stripe, { p: [0.25, 2.95, 0], r: [0, Math.PI / 2, 0] });
    }),
  );
}

/** Wooden flower cart facing +X. */
export function flowerCart(v: number): Prefab {
  return cached(`cart:${v}`, () =>
    bake((b) => {
      const body = LOOK.stripes[(v + 1) % LOOK.stripes.length];
      b.add('matte', P.box(1.0, 0.45, 1.7), body, { p: [0, 0.75, 0] });
      b.add('matte', P.box(1.04, 0.07, 1.74), LOOK.trim, { p: [0, 0.98, 0] });
      for (const z of [-0.95, 0.95]) {
        b.add('matte', P.torus(0.36, 0.05, 3, 12), LOOK.wood, { p: [0, 0.4, z] });
        b.add('matte', P.box(0.06, 0.66, 0.04), LOOK.wood, { p: [0, 0.4, z] });
        b.add('matte', P.box(0.66, 0.06, 0.04), LOOK.wood, { p: [0, 0.4, z] });
      }
      b.add('matte', P.box(1.4, 0.06, 0.06), LOOK.wood, { p: [-1.0, 0.8, 0.45], r: [0, 0, 0.12] });
      b.add('matte', P.box(1.4, 0.06, 0.06), LOOK.wood, { p: [-1.0, 0.8, -0.45], r: [0, 0, 0.12] });
      const rng = makeRng(9300 + v);
      b.add('foliage', P.box(0.9, 0.2, 1.55), '#5cb56a', { p: [0, 1.02, 0], wind: 0.005 });
      for (let i = 0; i < 12; i += 1) {
        const x = (rng() - 0.5) * 0.7;
        const z = (rng() - 0.5) * 1.4;
        b.add('foliage', P.ico(0.09, 0), LOOK.flowers[(i + v) % LOOK.flowers.length], { p: [x, 1.16 + rng() * 0.08, z], wind: 0.02 });
      }
    }),
  );
}

/** Picnic blanket with a basket. */
export function picnic(color: string): Prefab {
  return cached(`picnic:${color}`, () =>
    bake((b) => {
      const n = 4;
      const s = 0.42;
      for (let i = 0; i < n; i += 1) {
        for (let j = 0; j < n; j += 1) {
          b.add('matte', P.box(s, 0.02, s), (i + j) % 2 === 0 ? color : LOOK.trim, { p: [(i - (n - 1) / 2) * s, 0.01, (j - (n - 1) / 2) * s] });
        }
      }
      b.add('matte', P.rbox(0.45, 0.28, 0.32, 0.05, 1), LOOK.woodLight, { p: [0.2, 0.16, -0.1] });
      b.add('matte', P.torus(0.16, 0.025, 4, 12, Math.PI), LOOK.wood, { p: [0.2, 0.3, -0.1] });
      b.add('matte', P.sphere(0.07, 8, 6), PAL.flowerRed, { p: [-0.3, 0.07, 0.25] });
      b.add('matte', P.sphere(0.07, 8, 6), '#8fd16a', { p: [-0.18, 0.07, 0.3] });
    }),
  );
}

/** Wooden signpost with two pastel arrows. */
export function signpost(v: number): Prefab {
  return cached(`signpost:${v}`, () =>
    bake((b) => {
      b.add('matte', P.box(0.1, 2.2, 0.1), LOOK.woodLight, { p: [0, 1.1, 0] });
      const arrow = P.extrude('arrow', () => P.polyShape([[-0.45, -0.12], [0.3, -0.12], [0.45, 0], [0.3, 0.12], [-0.45, 0.12]]), { depth: 0.05 });
      b.add('matte', arrow, LOOK.stripes[v % LOOK.stripes.length], { p: [0, 1.85, 0.06], r: [0, 0.3, 0] });
      b.add('matte', arrow, LOOK.stripes[(v + 2) % LOOK.stripes.length], { p: [0, 1.5, 0.06], r: [0, Math.PI - 0.4, 0] });
      b.add('matte', P.sphere(0.07, 8, 6), LOOK.gold, { p: [0, 2.23, 0] });
    }),
  );
}
