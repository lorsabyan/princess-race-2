import * as THREE from 'three';
import { PAL } from '../kit/palette';
import type { Area } from '../../sim/route';
import { Bins, bake, type ColorFn, type Prefab, type Vec3 } from '../town/bins';
import { LOOK } from '../town/look';
import * as P from '../town/prims';
import { makeRng } from '../town/rng';

/**
 * Countryside props. Frames: origin on the ground at the footprint center; +X
 * points toward the road unless noted. Everything is baked once and stamped.
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
// Meadow
// ---------------------------------------------------------------------------

const WOOD = '#d7a877';
const WOOD_DEEP = '#b98a5e';
const WOOL = '#fff8ef';
const FACE = '#5d4a55';

/** 4 m rustic rail fence along X. */
export function railFence(): Prefab {
  return cached('railFence', () =>
    bake((b) => {
      for (const x of [-2, 2]) b.add('matte', P.cyl(0.075, 0.09, 1.05, 6), WOOD_DEEP, { p: [x, 0.52, 0], shade: { y0: 0, y1: 0.5, k: 0.8 } });
      for (const y of [0.42, 0.82]) b.add('matte', P.rbox(4.05, 0.08, 0.06, 0.02, 1), WOOD, { p: [0, y, 0] });
    }),
  );
}

/** Round woolly sheep facing +X. */
export function sheep(v: number): Prefab {
  return cached(`sheep:${v % 3}`, () =>
    bake((b) => {
      const rng = makeRng(6100 + v);
      const lump = (x: number, y: number, z: number, r: number) => b.add('matte', P.icoSmooth(r, 1), WOOL, { p: [x, y, z], shade: { y0: 0.3, y1: 0.75, k: 0.82 } });
      lump(0, 0.62, 0, 0.42);
      for (let i = 0; i < 6; i += 1) {
        const a = (i / 6) * Math.PI * 2 + rng();
        lump(Math.cos(a) * 0.34, 0.66 + rng.range(-0.05, 0.1), Math.sin(a) * 0.26, rng.range(0.2, 0.28));
      }
      b.add('matte', P.sphere(0.17, 9, 7), FACE, { p: [0.52, 0.78, 0], s: [1.15, 0.95, 0.9] });
      lump(0.46, 0.95, 0, 0.14);
      for (const s of [-1, 1]) {
        b.add('matte', P.sphere(0.08, 6, 4), FACE, { p: [0.44, 0.84, s * 0.19], s: [0.6, 0.35, 1.3] });
        b.add('matte', P.sphere(0.03, 5, 4), '#fffaf4', { p: [0.65, 0.83, s * 0.08] });
        for (const x of [-0.2, 0.22]) b.add('matte', P.cyl(0.045, 0.055, 0.36, 6), FACE, { p: [x, 0.18, s * 0.17] });
      }
    }),
  );
}

/** 8 m row of tulips along Z: a ruffled ridge of blooms over green leaves. */
export function tulipRow(color: string): Prefab {
  return cached(`tulipRow:${color}`, () => {
    const rng = makeRng(6050);
    const across = [-0.72, -0.5, -0.2, 0.2, 0.5, 0.72];
    const lift = [0, 0.26, 0.52, 0.52, 0.26, 0];
    const rows = 17;
    const pos: number[] = [];
    const nor: number[] = [];
    const idx: number[] = [];
    const paint: number[] = [];
    for (let j = 0; j < rows; j += 1) {
      const z = -4 + (j / (rows - 1)) * 8;
      for (let i = 0; i < across.length; i += 1) {
        const bump = lift[i] > 0.3 ? rng.range(-0.12, 0.14) : 0;
        pos.push(across[i], lift[i] + bump, z);
        nor.push(across[i] * 0.9, 1, rng.range(-0.25, 0.25));
        paint.push(rng());
      }
    }
    for (let j = 0; j < rows - 1; j += 1) {
      for (let i = 0; i < across.length - 1; i += 1) {
        const a = j * across.length + i;
        const c = a + across.length;
        idx.push(a, c, a + 1, a + 1, c, c + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    const leaf = new THREE.Color('#62b06c');
    const bloom = new THREE.Color(color);
    const pale = bloom.clone().lerp(new THREE.Color('#ffffff'), 0.34);
    let k = 0;
    return bake((b) => {
      b.add('foliage', g, (_x, y, _z, _nx, _ny, _nz, out) => {
        const t = paint[k % paint.length];
        k += 1;
        if (y < 0.2) out.copy(leaf);
        else out.copy(t > 0.8 ? pale : bloom).multiplyScalar(0.92 + t * 0.16);
      }, { wind: (_x, y) => Math.max(0, y) * 0.035 });
    });
  });
}

/** Clump of wildflowers (~1 m across) in up to three colors. */
export function wildflowers(colors: readonly string[], v: number): Prefab {
  return cached(`wild:${colors.join()}:${v % 3}`, () =>
    bake((b) => {
      const rng = makeRng(6060 + v);
      for (let i = 0; i < 13; i += 1) {
        const a = rng.range(0, 6.28);
        const r = Math.sqrt(rng()) * 0.62;
        const h = rng.range(0.2, 0.44);
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        b.add('foliage', P.cyl(0.014, 0.014, h, 3, true), '#5faf73', { p: [x, h / 2, z], wind: 0.02 });
        b.add('foliage', P.ico(0.075, 0), colors[i % colors.length], { p: [x, h, z], s: [1, 0.7, 1], wind: 0.03 });
      }
    }),
  );
}

export function hayBale(): Prefab {
  return cached('hayBale', () =>
    bake((b) => {
      const straw: ColorFn = (_x, _y, z, _nx, _ny, _nz, out) => {
        out.set(Math.sin(z * 34) > 0 ? '#f4d77e' : '#e5c063');
      };
      b.add('matte', P.cyl(0.62, 0.62, 1.1, 14), straw, { p: [0, 0.62, 0], r: [Math.PI / 2, 0, 0], shade: { y0: 0.05, y1: 0.5, k: 0.82 } });
      for (const z of [-0.3, 0.3]) b.add('matte', P.torus(0.625, 0.016, 3, 14), '#c9884d', { p: [0, 0.62, z] });
    }),
  );
}

// ---------------------------------------------------------------------------
// Forest
// ---------------------------------------------------------------------------

/** Storybook toadstool, ~1.8 m at scale 1. */
export function mushroom(cap: string, v: number): Prefab {
  return cached(`mushroom:${cap}:${v % 3}`, () =>
    bake((b) => {
      const stem = P.lathe('shroomStem', [
        [0.001, 0],
        [0.34, 0],
        [0.27, 0.3],
        [0.21, 0.8],
        [0.24, 1.2],
        [0.001, 1.25],
      ], 10, 2);
      b.add('matte', stem, '#fff4e6', { shade: { y0: 0, y1: 0.5, k: 0.82 } });
      b.add('matte', P.cyl(0.92, 0.92, 0.05, 16), '#ffe6d4', { p: [0, 1.17, 0] });
      b.add('foliage', P.dome(0.98, 16, 7), cap, { p: [0, 1.17, 0], s: [1, 0.74, 1] });
      const rng = makeRng(6200 + v);
      for (let i = 0; i < 8; i += 1) {
        const a = rng.range(0, Math.PI * 2);
        const up = rng.range(0.25, 1.1);
        const r = Math.cos(up) * 0.96;
        b.add('foliage', P.sphere(0.13, 7, 4), '#fffdf8', { p: [Math.cos(a) * r, 1.17 + Math.sin(up) * 0.72, Math.sin(a) * r], s: [1, 0.45, 1] });
      }
    }),
  );
}

/** Toadstool for the bouncy obstacle: one mesh, so it can squash and stretch as a whole. */
export function springMushroom(cap: string): Prefab {
  return cached(`springMushroom:${cap}`, () =>
    bake((b) => {
      const stem = P.lathe('springStem', [
        [0.001, 0],
        [0.3, 0],
        [0.25, 0.25],
        [0.2, 0.62],
        [0.22, 0.86],
        [0.001, 0.9],
      ], 9, 2);
      b.add('matte', stem, '#fff4e6', { shade: { y0: 0, y1: 0.4, k: 0.84 } });
      b.add('matte', P.cyl(0.76, 0.76, 0.04, 14), '#ffe6d4', { p: [0, 0.84, 0] });
      b.add('matte', P.dome(0.8, 14, 6), cap, { p: [0, 0.84, 0], s: [1, 0.78, 1] });
      const rng = makeRng(6210);
      for (let i = 0; i < 7; i += 1) {
        const a = rng.range(0, Math.PI * 2);
        const up = rng.range(0.3, 1.15);
        const r = Math.cos(up) * 0.78;
        b.add('matte', P.sphere(0.12, 7, 4), '#fffdf8', { p: [Math.cos(a) * r, 0.84 + Math.sin(up) * 0.61, Math.sin(a) * r], s: [1, 0.45, 1] });
      }
    }),
  );
}

/** Gnome's house inside a giant mushroom. The door faces +X. */
export function mushroomHouse(cap: string): Prefab {
  return cached(`mushroomHouse:${cap}`, () =>
    bake((b) => {
      const trunk = P.lathe('shroomHouse', [
        [0.001, 0],
        [2.0, 0],
        [1.85, 0.5],
        [1.62, 1.8],
        [1.72, 3.1],
        [0.001, 3.2],
      ], 18, 2);
      b.add('matte', trunk, '#fff0dc', { shade: { y0: 0, y1: 0.9, k: 0.84 } });
      b.add('matte', P.cyl(3.15, 3.15, 0.12, 22), '#ffe2cc', { p: [0, 3.05, 0] });
      b.add('matte', P.dome(3.3, 24, 9), cap, { p: [0, 3.02, 0], s: [1, 0.72, 1] });
      const rng = makeRng(6301);
      for (let i = 0; i < 11; i += 1) {
        const a = rng.range(0, Math.PI * 2);
        const up = rng.range(0.25, 1.15);
        const r = Math.cos(up) * 3.24;
        b.add('matte', P.sphere(0.42, 9, 5), '#fffdf8', { p: [Math.cos(a) * r, 3.02 + Math.sin(up) * 2.36, Math.sin(a) * r], s: [1, 0.42, 1] });
      }
      const door = P.extrude('gnomeDoor', () => P.archShape(0.95, 1.75), { depth: 0.1, curveSegments: 6 });
      b.within({ p: [1.72, 0.02, 0], r: [0, Math.PI / 2, 0] }, () => {
        b.add('matte', door, PAL.doorTeal);
        b.add('metal', P.sphere(0.07, 6, 4), LOOK.gold, { p: [0.3, 0.8, 0.08] });
      });
      for (const a of [0.85, -0.85]) {
        b.add('glow', P.cyl(0.34, 0.34, 0.05, 12), PAL.lampGlow, { p: [Math.cos(a) * 1.72, 1.9, Math.sin(a) * 1.72], r: [0, -a, Math.PI / 2] });
        b.add('matte', P.torus(0.36, 0.05, 4, 12), LOOK.trim, { p: [Math.cos(a) * 1.75, 1.9, Math.sin(a) * 1.75], r: [0, Math.PI / 2 - a, 0] });
      }
      b.add('matte', P.cyl(0.26, 0.3, 1.5, 8), '#d98b63', { p: [-1.2, 5.3, 0.6] });
      b.add('matte', P.cyl(0.33, 0.33, 0.14, 8), '#fff0dc', { p: [-1.2, 6.05, 0.6] });
      for (let i = 0; i < 5; i += 1) {
        b.add('matte', P.rbox(0.34, 0.09, 0.5, 0.03, 1), LOOK.stone, { p: [2.25 + i * 0.62, 0.03, (i % 2 ? 0.1 : -0.1)] });
      }
    }),
  );
}

export function treeStump(): Prefab {
  return cached('treeStump', () =>
    bake((b) => {
      b.add('matte', P.cyl(0.42, 0.56, 0.6, 10), PAL.trunk, { p: [0, 0.3, 0], shade: { y0: 0, y1: 0.4, k: 0.78 } });
      b.add('matte', P.cyl(0.43, 0.43, 0.03, 10), '#efd2a4', { p: [0, 0.61, 0] });
    }),
  );
}

/** Fairy lights strung between two points (in the current frame); built directly into the bins. */
export function fairyLights(b: Bins, a: Vec3, c: Vec3, sag: number, colors: readonly string[]): void {
  const n = 15;
  const points: Vec3[] = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    points.push([a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (c[2] - a[2]) * t]);
  }
  const wire = P.tubeOnce(points, 0.014, n, 3);
  b.add('matte', wire, '#c9b8cf');
  wire.dispose();
  for (let i = 1; i < n; i += 1) {
    const p = points[i];
    b.add('glow', P.sphere(0.16, 8, 6), colors[i % colors.length], { p: [p[0], p[1] - 0.17, p[2]] });
  }
}

// ---------------------------------------------------------------------------
// Lake
// ---------------------------------------------------------------------------

/** Low stone parapet along X, 4 m. */
export function stoneWall(): Prefab {
  return cached('stoneWall', () =>
    bake((b) => {
      // Two courses of cut blocks, staggered, under a cap.
      const rng = makeRng(6210);
      const tones = [LOOK.stone, LOOK.stoneWarm, '#e4d3ca', '#f2e4d8', LOOK.stoneDeep];
      for (let course = 0; course < 2; course += 1) {
        let x = -2.01;
        const lengths = course === 0 ? [0.9, 0.7, 1.05, 0.65, 0.72] : [0.5, 0.95, 0.75, 1.05, 0.77];
        for (const length of lengths) {
          b.add('matte', P.box(length - 0.03, 0.235, 0.34 + rng.range(-0.012, 0.03)), rng.pick(tones), {
            p: [x + length / 2, 0.12 + course * 0.25, rng.range(-0.008, 0.008)],
            shade: { y0: 0, y1: 0.36, k: 0.8 },
          });
          x += length;
        }
      }
      b.add('matte', P.rbox(4.08, 0.08, 0.46, 0.03, 1), '#fff6ec', { p: [0, 0.535, 0] });
    }),
  );
}

/** Stone post with a glowing lantern. */
export function lanternPost(): Prefab {
  return cached('lanternPost', () =>
    bake((b) => {
      b.add('matte', P.rbox(0.42, 0.9, 0.42, 0.05, 1), LOOK.stone, { p: [0, 0.45, 0], shade: { y0: 0, y1: 0.6, k: 0.84 } });
      b.add('metal', P.cyl(0.2, 0.25, 0.08, 8), LOOK.iron, { p: [0, 0.94, 0] });
      b.add('glow', P.sphere(0.2, 10, 7), PAL.lampGlow, { p: [0, 1.17, 0] });
      b.add('metal', P.cone(0.27, 0.22, 8), PAL.roofCoral, { p: [0, 1.46, 0] });
    }),
  );
}

/** Tuft of reeds at the water's edge. */
export function reeds(v: number): Prefab {
  return cached(`reeds:${v % 3}`, () =>
    bake((b) => {
      const rng = makeRng(6500 + v);
      for (let i = 0; i < 10; i += 1) {
        const a = rng.range(0, 6.28);
        const r = rng.range(0, 0.5);
        const h = rng.range(0.9, 1.5);
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        const wind = (_x: number, y: number) => Math.max(0, y) * 0.03;
        b.add('foliage', P.cyl(0.012, 0.022, h, 4, true), '#7bbd72', { p: [x, h / 2, z], wind });
        if (i % 3 === 0) b.add('foliage', P.capsule(0.04, 0.2, 2, 5), '#b98059', { p: [x, h, z], wind });
      }
    }),
  );
}

// ---------------------------------------------------------------------------
// Castle hill
// ---------------------------------------------------------------------------

/** Tall hanging banner on a pole. The cloth faces +X. */
export function banner(color: string): Prefab {
  return cached(`banner:${color}`, () =>
    bake((b) => {
      b.add('metal', P.cyl(0.05, 0.07, 6.2, 7), LOOK.gold, { p: [0, 3.1, 0] });
      b.add('metal', P.sphere(0.12, 8, 6), LOOK.gold, { p: [0, 6.28, 0] });
      b.add('metal', P.cyl(0.03, 0.03, 1.3, 5), LOOK.gold, { p: [0, 5.75, 0], r: [Math.PI / 2, 0, 0] });
      const cloth = P.extrude('bannerCloth', () => P.polyShape([[-0.6, 0], [0.6, 0], [0.6, -2.5], [0, -3.0], [-0.6, -2.5]]), { depth: 0.03 });
      const wind = (_x: number, y: number) => Math.max(0, 5.7 - y) * 0.02;
      b.add('foliage', cloth, color, { p: [0, 5.72, 0], r: [0, Math.PI / 2, 0], wind });
      const heart = P.extrude('bannerHeart', () => P.heartShape(0.6), { depth: 0.01, curveSegments: 5 });
      for (const s of [-1, 1]) b.add('foliage', heart, '#fff3ea', { p: [s * 0.03, 4.3, 0], r: [0, Math.PI / 2, 0], wind });
    }),
  );
}

// ---------------------------------------------------------------------------
// Welcome arches
// ---------------------------------------------------------------------------

const GATE_RADIUS = 6.9;
const GATE_SPRING = 1.5;

/** Big picture on top of an arch: reads from far away, no reading needed. Built around y = 0. */
function gateEmblem(b: Bins, area: Exclude<Area, 'town'>): void {
  if (area === 'meadow') {
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      b.add('matte', P.sphere(0.46, 9, 6), i % 2 === 0 ? PAL.flowerRose : '#ffc0d8', { p: [Math.cos(a) * 0.72, Math.sin(a) * 0.72, 0], s: [1, 1, 0.5] });
    }
    b.add('matte', P.sphere(0.5, 10, 7), PAL.flowerYellow, { s: [1, 1, 0.7] });
  } else if (area === 'forest') {
    b.stamp(mushroom(PAL.flowerRed, 1), { p: [0, -1.1, 0], s: 1.7 });
  } else if (area === 'lake') {
    b.within({ p: [0, -0.9, 0], r: [0, Math.PI / 2, 0], s: 0.62 }, () => sailboatHull(b, '#ffb3cc'));
  } else {
    b.add('metal', P.cyl(0.8, 0.72, 0.5, 18, true), PAL.gold, { p: [0, -0.3, 0] });
    for (let i = 0; i < 5; i += 1) {
      const a = (i / 5) * Math.PI * 2;
      b.add('metal', P.cone(0.2, 0.75, 8), PAL.gold, { p: [Math.cos(a) * 0.74, 0.3, Math.sin(a) * 0.74] });
      b.add('glow', P.sphere(0.1, 7, 5), i % 2 === 0 ? PAL.gemPink : PAL.gemBlue, { p: [Math.cos(a) * 0.74, 0.74, Math.sin(a) * 0.74] });
    }
  }
}

/** Arch over the road where an area begins. Origin on the road; it spans X. */
export function gateway(area: Exclude<Area, 'town'>): Prefab {
  return cached(`gateway:${area}`, () =>
    bake((b) => {
      const theme = {
        meadow: { frame: WOOD, beads: ['#ffffff', PAL.flowerYellow, PAL.flowerRose, '#79c47d'], glow: false },
        forest: { frame: '#a97c55', beads: ['#5fb87c', '#7fd38b', '#4ea86a'], glow: true },
        lake: { frame: LOOK.stone, beads: ['#bfe8ff', '#fffaf2', '#8fd2ff'], glow: true },
        castle: { frame: '#ffe0ea', beads: [PAL.flowerRose, '#ff9cc6', '#ffffff', PAL.leafDeep], glow: false },
      }[area];
      for (const s of [-1, 1]) {
        b.add('matte', P.rbox(1.0, 0.5, 1.0, 0.08, 1), LOOK.stone, { p: [s * GATE_RADIUS, 0.25, 0], shade: { y0: 0, y1: 0.4, k: 0.84 } });
        b.add('matte', P.cyl(0.22, 0.28, GATE_SPRING + 0.2, 10), theme.frame, { p: [s * GATE_RADIUS, (GATE_SPRING + 0.2) / 2 + 0.3, 0] });
      }
      b.add('matte', P.torus(GATE_RADIUS, 0.2, 7, 32, Math.PI), theme.frame, { p: [0, GATE_SPRING, 0] });
      const beads = 21;
      for (let i = 0; i <= beads; i += 1) {
        const a = (i / beads) * Math.PI;
        const x = Math.cos(a) * GATE_RADIUS;
        const y = GATE_SPRING + Math.sin(a) * GATE_RADIUS;
        if (theme.glow && i % 4 === 2) b.add('glow', P.sphere(0.24, 9, 6), PAL.lampGlow, { p: [x, y - 0.28, 0.1] });
        else b.add('matte', P.icoSmooth(0.36, 1), theme.beads[i % theme.beads.length], { p: [x, y, 0.08], s: [1, 1, 0.8] });
      }
      b.within({ p: [0, GATE_SPRING + GATE_RADIUS + 1.35, 0] }, () => gateEmblem(b, area));
    }),
  );
}

// ---------------------------------------------------------------------------
// Parts of moving scenery (see scenic.ts)
// ---------------------------------------------------------------------------

export const STRIPES = {
  balloonA: ['#ff8fb4', '#fff4e4'],
  balloonB: ['#8fd0ff', '#fff4e4'],
  balloonC: ['#ffd46b', '#ff9a8a'],
} as const;

export function balloonBody(b: Bins, colors: readonly [string, string]): void {
  const envelope = P.lathe('balloon', [
    [0.5, 0],
    [1.3, 0.8],
    [3.1, 3.4],
    [3.9, 5.8],
    [3.5, 8.2],
    [2.2, 9.9],
    [0.001, 10.5],
  ], 16, 3);
  const gores = (x: number, _y: number, z: number, _nx: number, _ny: number, _nz: number, out: THREE.Color) => {
    const a = Math.atan2(z, x) + Math.PI;
    out.set(Math.floor((a / (Math.PI * 2)) * 10) % 2 === 0 ? colors[0] : colors[1]);
  };
  b.add('matte', envelope, gores, { p: [0, 2.4, 0], shade: { y0: 0, y1: 4, k: 0.82 } });
  b.add('matte', P.rbox(1.15, 0.8, 1.15, 0.1, 1), WOOD, { p: [0, 0, 0] });
  b.add('matte', P.torus(0.72, 0.05, 4, 12), WOOD_DEEP, { p: [0, 0.4, 0], r: [Math.PI / 2, 0, 0] });
  for (const a of [0.8, 2.35, 3.9, 5.5]) {
    const x = Math.cos(a);
    const z = Math.sin(a);
    const rope = P.cyl(0.02, 0.02, 2.1, 3, true);
    b.add('matte', rope, '#8b7a6c', { p: [x * 0.68, 1.42, z * 0.68], r: [z * 0.26, 0, -x * 0.26] });
  }
}

export function sailboatHull(b: Bins, sail: string): void {
  const hull = P.sphere(1, 14, 7);
  b.add('matte', hull, (_x, y, _z, _nx, _ny, _nz, out) => {
    out.set(y > -0.1 ? '#fff6ea' : PAL.roofBerry);
  }, { p: [0, 0.15, 0], s: [0.8, 0.5, 2.1] });
  b.add('matte', P.cyl(0.7, 0.7, 0.06, 14), '#d7a877', { p: [0, 0.4, 0], s: [1, 1, 2.6] });
  b.add('matte', P.cyl(0.05, 0.07, 4.6, 6), '#c9956a', { p: [0, 2.6, 0.1] });
  const main = P.extrude('sailMain', () => P.polyShape([[0, 0], [1.9, 0], [0, 3.9]]), { depth: 0.03 });
  const jib = P.extrude('sailJib', () => P.polyShape([[0, 0], [1.25, 0], [0, 3.2]]), { depth: 0.03 });
  b.add('matte', main, sail, { p: [0, 0.85, 0.12], r: [0, Math.PI / 2, 0] });
  b.add('matte', jib, '#fffaf2', { p: [0, 0.85, -0.05], r: [0, -Math.PI / 2, 0] });
  b.add('matte', P.extrude('sailFlag', () => P.polyShape([[0, 0], [0.5, -0.12], [0, -0.26]]), { depth: 0.01 }), PAL.gemPink, { p: [0, 4.95, 0.1], r: [0, Math.PI / 2, 0] });
}

export function swanBody(b: Bins): void {
  b.add('matte', P.sphere(0.55, 12, 8), '#fffdf8', { p: [0, 0.32, 0], s: [0.9, 0.72, 1.45] });
  b.add('matte', P.sphere(0.2, 8, 6), '#fffdf8', { p: [0, 0.5, 0.75], s: [0.7, 0.8, 1.5] });
  const neck = P.tube('swanNeck', [
    [0, 0.42, -0.5],
    [0, 0.7, -0.78],
    [0, 1.05, -0.74],
    [0, 1.3, -0.56],
    [0, 1.42, -0.46],
  ], 0.085, 12, 6);
  b.add('matte', neck, '#fffdf8');
  b.add('matte', P.sphere(0.13, 8, 6), '#fffdf8', { p: [0, 1.46, -0.5] });
  b.add('matte', P.cone(0.06, 0.2, 6), '#ff9a3c', { p: [0, 1.44, -0.68], r: [-Math.PI / 2, 0, 0] });
  for (const s of [-1, 1]) b.add('matte', P.sphere(0.025, 5, 4), '#3b2438', { p: [s * 0.1, 1.5, -0.54] });
}

export function lighthouseBody(b: Bins): void {
  const rock = P.lathe('lightRock', [
    [8, -4],
    [7.4, -0.6],
    [6, 0.4],
    [4.1, 1.1],
    [0.001, 1.2],
  ], 16, 2);
  b.add('matte', rock, (_x, y, _z, _nx, _ny, _nz, out) => {
    out.set(y > 0.65 ? '#a9dd92' : y > -0.1 ? '#f3e4b8' : '#c5b49c');
  });
  const tower = P.lathe('lightTower', [
    [2.4, 1.1],
    [2.25, 2.0],
    [1.65, 10.5],
    [1.8, 11],
    [0.001, 11],
  ], 18, 0);
  b.add('matte', tower, (_x, y, _z, _nx, _ny, _nz, out) => {
    out.set(Math.floor((y - 1.1) / 2.4) % 2 === 0 ? '#fffaf2' : '#ff7f9e');
  });
  b.add('matte', P.torus(1.95, 0.08, 4, 18), LOOK.iron, { p: [0, 11.1, 0], r: [Math.PI / 2, 0, 0] });
  b.add('glow', P.cyl(1.05, 1.05, 1.5, 14), PAL.lampGlow, { p: [0, 11.8, 0] });
  b.add('matte', P.cone(1.45, 1.35, 14), PAL.roofBerry, { p: [0, 13.2, 0] });
  b.add('metal', P.sphere(0.18, 8, 6), LOOK.gold, { p: [0, 14, 0] });
  b.add('matte', P.rbox(1.0, 1.9, 0.14, 0.05, 1), PAL.doorBerry, { p: [0, 2.05, 2.2] });
}

export function windmillBody(b: Bins, roof: string): void {
  const tower = P.lathe('millTower', [
    [2.75, 0],
    [2.7, 0.55],
    [2.2, 0.75],
    [1.72, 6.6],
    [1.55, 7.2],
    [0.001, 7.2],
  ], 18, 0);
  b.add('matte', tower, '#fff4e4', { shade: { y0: 0, y1: 3, k: 0.86 } });
  b.add('matte', P.cone(2.05, 2.2, 18), roof, { p: [0, 8.25, 0] });
  b.add('matte', P.torus(2.0, 0.09, 4, 18), LOOK.trim, { p: [0, 7.15, 0], r: [Math.PI / 2, 0, 0] });
  const door = P.extrude('millDoor', () => P.archShape(1.05, 1.9), { depth: 0.1, curveSegments: 6 });
  b.add('matte', door, PAL.doorBerry, { p: [0, 0.05, 2.42] });
  for (const [a, y] of [[0.5, 3.6], [-0.5, 5.2], [2.3, 4.3]] as const) {
    b.add('glow', P.cyl(0.3, 0.3, 0.05, 10), PAL.lampGlow, { p: [Math.sin(a) * 2.05, y, Math.cos(a) * 2.05], r: [Math.PI / 2, 0, -a] });
  }
  for (const a of [0, 1.05, 2.1, 3.15, 4.2, 5.25]) b.add('matte', P.rbox(0.28, 0.1, 0.5, 0.03, 1), LOOK.stone, { p: [Math.sin(a) * 2.95, 0.05, Math.cos(a) * 2.95], r: [0, a, 0] });
}

/** Four sails turning around Z, hub at the origin. */
export function windmillSails(b: Bins, cloth: string): void {
  b.add('matte', P.cyl(0.28, 0.32, 0.5, 10), WOOD_DEEP, { r: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2;
    b.within({ r: [0, 0, a] }, () => {
      b.add('matte', P.rbox(0.14, 5.6, 0.1, 0.03, 1), WOOD, { p: [0, 2.85, 0] });
      b.add('matte', P.rbox(1.25, 4.5, 0.04, 0.03, 1), cloth, { p: [0.68, 3.3, 0.02] });
      for (const y of [1.3, 2.4, 3.5, 4.6]) b.add('matte', P.box(1.34, 0.05, 0.07), WOOD, { p: [0.68, y, 0.04] });
    });
  }
}
