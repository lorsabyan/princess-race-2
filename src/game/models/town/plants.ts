import * as THREE from 'three';
import { PAL } from '../kit/palette';
import { blend, displace, ellipsoid, move, roundBox, sphere, type SdfNode } from '../kit/sdf';
import { meshSdf } from '../kit/mesher';
import { Bins, bake, col, type ColorFn, type Prefab } from './bins';
import { LOOK, foliagePaint } from './look';
import * as P from './prims';
import { makeRng } from './rng';

/**
 * Trees, bushes, hedges and flowers. Canopies are sculpted once with SDF
 * blending (soft, clay-like puffs), painted with a baked sun-facing gradient,
 * and cached as prefabs; placements stamp them with a transform and a tint.
 */

export const GREENS: ReadonlyArray<readonly [string, string, string]> = [
  [PAL.leafDeep, PAL.leaf, '#b4ec9c'],
  ['#4d9f63', '#78c77f', '#a9e39a'],
  ['#5aa865', PAL.leafSage, '#d2f0a0'],
  ['#3f9a6e', '#6cc596', '#a6e8bf'],
];

export const BLOSSOMS: ReadonlyArray<readonly [string, string, string]> = [
  ['#ea6498', '#ffa6c8', '#ffcfe1'],
  ['#e35d93', '#ff94bd', '#ffbfd8'],
  ['#b27be0', '#cfa4fb', '#ead8ff'],
];

const tmpN = new THREE.Vector3();

/** Recolor a geometry with a ColorFn that uses its normals; set wind by height. */
function paintGeometry(g: THREE.BufferGeometry, paint: ColorFn, wind: (x: number, y: number, z: number) => number): THREE.BufferGeometry {
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const winds = new Float32Array(pos.count);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    tmpN.fromBufferAttribute(nor, i);
    paint(x, y, z, tmpN.x, tmpN.y, tmpN.z, c);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
    winds[i] = wind(x, y, z);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('wind', new THREE.BufferAttribute(winds, 1));
  return g;
}

function bumps(n: SdfNode, amp: number, freq: number, seed: number): SdfNode {
  return displace(n, (x, y, z) => Math.sin(x * freq + seed) * Math.sin(y * freq * 1.13 + seed * 2.1) * Math.sin(z * freq * 0.91 - seed) * amp);
}

// ---------------------------------------------------------------------------
// Canopy geometries (cached)
// ---------------------------------------------------------------------------

const geoCache = new Map<string, THREE.BufferGeometry>();

function cachedGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

/** SDF shapes are meshed once per variant; palettes only recolor a clone. */
const shapeCache = new Map<string, THREE.BufferGeometry>();
export const sdfTiming = { ms: 0, count: 0 };
function sdfShape(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = shapeCache.get(key);
  if (!g) {
    const t0 = performance.now();
    g = make();
    sdfTiming.ms += performance.now() - t0;
    sdfTiming.count += 1;
    shapeCache.set(key, g);
  }
  return g.clone();
}

/** Cloud canopy: a big puff ringed with smaller ones. Centered at origin, radius ~1.3. */
function cloudCanopy(v: number, palette: readonly [string, string, string]): THREE.BufferGeometry {
  return cachedGeo(`cloud:${v}:${palette.join()}`, () => {
    const rng = makeRng(1000 + v * 17);
    const puffs: SdfNode[] = [sphere(1.08)];
    const n = 5 + (v % 2);
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2 + rng() * 0.5;
      const r = 0.62 + rng() * 0.22;
      const ring = 0.78 + rng() * 0.18;
      puffs.push(move(sphere(r), Math.cos(a) * ring, -0.15 + rng() * 0.5, Math.sin(a) * ring));
    }
    puffs.push(move(sphere(0.7), rng() * 0.3 - 0.15, 0.78, rng() * 0.3 - 0.15));
    const g = sdfShape(`cloud:${v}`, () => {
      const node = bumps(blend(0.42, ...puffs), 0.035, 5.5, v);
      return meshSdf(node, { min: [-2.1, -1.5, -2.1], max: [2.1, 1.9, 2.1], cell: 0.35, project: 2, colors: { 0: '#ffffff' } });
    });
    return paintGeometry(g, foliagePaint(palette[0], palette[1], palette[2], 0, 1.3), (_x, y) => 0.035 + Math.max(0, y + 1.2) * 0.025);
  });
}

/** Wide, clustered blossom canopy with light speckles. */
function blossomCanopy(v: number, palette: readonly [string, string, string]): THREE.BufferGeometry {
  return cachedGeo(`blossom:${v}:${palette.join()}`, () => {
    const rng = makeRng(2000 + v * 31);
    const puffs: SdfNode[] = [move(ellipsoid(1.2, 0.8, 1.2), 0, 0.15, 0)];
    const n = 6 + (v % 3);
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2 + rng() * 0.6;
      const r = 0.55 + rng() * 0.25;
      const ring = 1.0 + rng() * 0.35;
      puffs.push(move(sphere(r), Math.cos(a) * ring, -0.2 + rng() * 0.55, Math.sin(a) * ring));
    }
    for (let i = 0; i < 3; i += 1) puffs.push(move(sphere(0.5 + rng() * 0.2), (rng() - 0.5) * 1.2, 0.55 + rng() * 0.3, (rng() - 0.5) * 1.2));
    const g = sdfShape(`blossom:${v}`, () => {
      const node = bumps(blend(0.36, ...puffs), 0.05, 7, v + 3);
      return meshSdf(node, { min: [-2.4, -1.3, -2.4], max: [2.4, 1.6, 2.4], cell: 0.34, project: 2, colors: { 0: '#ffffff' } });
    });
    const base = foliagePaint(palette[0], palette[1], palette[2], 0.1, 1.2);
    const speck = col('#ffffff');
    const paint: ColorFn = (x, y, z, nx, ny, nz, out) => {
      base(x, y, z, nx, ny, nz, out);
      const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
      const f = h - Math.floor(h);
      if (f > 0.86 && ny > -0.2) out.lerp(speck, 0.55);
    };
    return paintGeometry(g, paint, (_x, y) => 0.04 + Math.max(0, y + 1) * 0.025);
  });
}

/** Small round bush (a few blended puffs), base at y = 0. */
function bushGeo(v: number, palette: readonly [string, string, string]): THREE.BufferGeometry {
  return cachedGeo(`bush:${v}:${palette.join()}`, () => {
    const rng = makeRng(3000 + v * 13);
    const puffs: SdfNode[] = [move(sphere(0.42), 0, 0.36, 0)];
    for (let i = 0; i < 3; i += 1) {
      const a = (i / 3) * Math.PI * 2 + rng();
      puffs.push(move(sphere(0.27 + rng() * 0.08), Math.cos(a) * 0.3, 0.26 + rng() * 0.12, Math.sin(a) * 0.3));
    }
    const g = sdfShape(`bush:${v}`, () =>
      meshSdf(blend(0.2, ...puffs), { min: [-0.75, -0.05, -0.75], max: [0.75, 0.85, 0.75], cell: 0.2, project: 2, colors: { 0: '#ffffff' } }),
    );
    return paintGeometry(g, foliagePaint(palette[0], palette[1], palette[2], 0.35, 0.45), (_x, y) => Math.max(0, y) * 0.03);
  });
}

/** Hedge segment 2 m long (along X), 0.8 tall, 0.7 deep, lumpy top. Base at y = 0. */
function hedgeGeo(v: number): THREE.BufferGeometry {
  return cachedGeo(`hedge:${v}`, () => {
    const body = move(roundBox(1.02, 0.36, 0.34, 0.22), 0, 0.4, 0);
    const lumps: SdfNode[] = [body];
    for (let i = 0; i < 5; i += 1) lumps.push(move(sphere(0.27), -0.9 + i * 0.45, 0.62 + ((i + v) % 2) * 0.05, 0));
    const node = bumps(blend(0.2, ...lumps), 0.025, 9, v);
    const g = meshSdf(node, { min: [-1.1, -0.05, -0.5], max: [1.1, 1.0, 0.5], cell: 0.21, project: 2, colors: { 0: '#ffffff' } });
    const pal = GREENS[v % GREENS.length];
    return paintGeometry(g, foliagePaint(pal[0], pal[1], pal[2], 0.45, 0.45), (_x, y) => Math.max(0, y - 0.3) * 0.02);
  });
}

// ---------------------------------------------------------------------------
// Tree prefabs
// ---------------------------------------------------------------------------

const prefabCache = new Map<string, Prefab>();

function cachedPrefab(key: string, make: () => Prefab): Prefab {
  let p = prefabCache.get(key);
  if (!p) {
    p = make();
    prefabCache.set(key, p);
  }
  return p;
}

function trunk(b: Bins, h: number, r: number, color: string = PAL.trunk): void {
  const g = P.lathe(`trunk:${h.toFixed(2)}:${r.toFixed(2)}`, [
    [r * 1.9, 0],
    [r * 1.25, 0.12],
    [r * 1.02, 0.4],
    [r * 0.9, h * 0.6],
    [r * 0.75, h],
    [0.001, h + 0.02],
  ], 7, 0);
  b.add('matte', g, color, { shade: { y0: 0, y1: 0.8, k: 0.7 } });
}

/** Lollipop street tree: straight trunk, sphere (or stacked spheres) canopy. ~4 m tall. */
export function lollipopTree(v: number, pal = 0, blossom = false): Prefab {
  return cachedPrefab(`lolli:${v}:${pal}:${blossom ? 1 : 0}`, () =>
    bake((b) => {
      const palette = blossom ? BLOSSOMS[pal % BLOSSOMS.length] : GREENS[pal % GREENS.length];
      const th = 1.75 + (v % 3) * 0.15;
      trunk(b, th + 0.4, 0.1);
      const paint = foliagePaint(palette[0], palette[1], palette[2], 0, 1.2);
      const kind = v % 3;
      const wind = (_x: number, y: number) => 0.03 + Math.max(0, y - th) * 0.02;
      if (kind === 0) {
        b.add('foliage', P.sphere(1.2, 15, 10), paint, { p: [0, th + 1.0, 0], wind });
      } else if (kind === 1) {
        b.add('foliage', P.sphere(1.0, 14, 9), paint, { p: [0, th + 0.85, 0], wind });
        b.add('foliage', P.sphere(0.72, 11, 7), paint, { p: [0, th + 2.05, 0], wind });
      } else {
        b.add('foliage', P.sphere(1.1, 14, 10), paint, { p: [0, th + 1.15, 0], s: [0.92, 1.22, 0.92], wind });
      }
    }),
  );
}

/** Cloud tree (garden tree): trunk + blended puff canopy. ~5.5 m tall. */
export function cloudTree(v: number, pal = 0): Prefab {
  return cachedPrefab(`cloudTree:${v}:${pal}`, () =>
    bake((b) => {
      const th = 2.1 + (v % 2) * 0.3;
      trunk(b, th + 0.6, 0.15);
      // A couple of stubby branches into the canopy.
      b.add('matte', P.cyl(0.05, 0.08, 0.9, 5, true), PAL.trunk, { p: [0.25, th + 0.2, 0], r: [0, 0, -0.7] });
      b.add('matte', P.cyl(0.05, 0.08, 0.9, 5, true), PAL.trunk, { p: [-0.2, th + 0.3, 0.1], r: [0.3, 0, 0.8] });
      b.addColored('foliage', cloudCanopy(v % 3, GREENS[pal % GREENS.length]), { p: [0, th + 1.35, 0], s: [1.1, 1, 1.1] });
    }),
  );
}

/** Cherry blossom tree: curvy trunk with branches, wide pink canopy. ~5 m tall. */
export function blossomTree(v: number, pal = 0): Prefab {
  return cachedPrefab(`blossomTree:${v}:${pal}`, () =>
    bake((b) => {
      const lean = (v % 2 === 0 ? 1 : -1) * 0.18;
      const main = P.tube(`bt:${v}`, [
        [0, 0, 0],
        [lean * 0.4, 0.8, 0.05],
        [lean, 1.6, -0.05],
        [lean * 0.6, 2.4, 0],
      ], 0.15, 8, 6);
      b.add('matte', main, '#a8735a', { shade: { y0: 0, y1: 1, k: 0.75 } });
      b.add('matte', P.cyl(0.16, 0.3, 0.3, 7), '#a8735a', { p: [0, 0.15, 0], shade: { y0: 0, y1: 0.3, k: 0.75 } });
      const rng = makeRng(4000 + v);
      for (let i = 0; i < 3; i += 1) {
        const a = (i / 3) * Math.PI * 2 + rng();
        const branch = P.tube(`bb:${v}:${i}`, [
          [lean, 1.5, 0],
          [lean + Math.cos(a) * 0.5, 2.0, Math.sin(a) * 0.5],
          [lean + Math.cos(a) * 1.0, 2.5, Math.sin(a) * 1.0],
        ], 0.065, 5, 4);
        b.add('matte', branch, '#a8735a');
      }
      b.addColored('foliage', blossomCanopy(v % 3, BLOSSOMS[pal % BLOSSOMS.length]), { p: [lean * 0.6, 3.05, 0], s: [1.05, 0.95, 1.05] });
    }),
  );
}

/** Tall soft cypress (teardrop). ~5.5 m. */
export function cypress(v: number, pal = 0): Prefab {
  return cachedPrefab(`cypress:${v}:${pal}`, () =>
    bake((b) => {
      const palette = GREENS[(pal + 1) % GREENS.length];
      const h = 4.6 + (v % 3) * 0.5;
      const r = 0.72 + (v % 2) * 0.12;
      b.add('matte', P.cyl(0.1, 0.13, 0.6, 6), PAL.trunk, { p: [0, 0.3, 0] });
      const g = P.lathe(`cypress:${h.toFixed(2)}:${r.toFixed(2)}`, [
        [0.001, 0.35],
        [r * 0.75, 0.55],
        [r, 1.5],
        [r * 0.85, h * 0.6],
        [r * 0.4, h * 0.9],
        [0.001, h],
      ], 10, 2);
      b.add('foliage', g, foliagePaint(palette[0], palette[1], palette[2], h * 0.5, h * 0.5), { wind: (_x, y) => Math.max(0, y - 0.5) * 0.012 });
    }),
  );
}

/** Tiered storybook fir (three soft cones). ~5 m. */
export function fir(v: number): Prefab {
  return cachedPrefab(`fir:${v}`, () =>
    bake((b) => {
      const palette = GREENS[(v + 3) % GREENS.length];
      b.add('matte', P.cyl(0.12, 0.16, 0.9, 6), PAL.trunk, { p: [0, 0.45, 0] });
      const paint = foliagePaint(palette[0], palette[1], palette[2], 2.5, 2.5);
      const tiers = [
        [1.45, 1.9, 0.6],
        [1.12, 1.6, 1.7],
        [0.8, 1.4, 2.7],
      ];
      for (const [r, h, y] of tiers) {
        const g = P.lathe(`firTier:${r}:${h}`, [
          [0.001, 0],
          [r * 0.9, 0.02],
          [r, 0.14],
          [r * 0.55, h * 0.5],
          [0.001, h],
        ], 10, 0);
        b.add('foliage', g, paint, { p: [0, y, 0], wind: (_x, yy) => Math.max(0, yy - 0.6) * 0.012 });
      }
    }),
  );
}

/** Cheap far-away tree for the lawn and tree line (~100 tris); `blossom` paints it pink. */
export function farTree(v: number, blossom = false): Prefab {
  return cachedPrefab(`far:${v}:${blossom ? 1 : 0}`, () =>
    bake((b) => {
      const palette = blossom ? BLOSSOMS[v % BLOSSOMS.length] : GREENS[v % GREENS.length];
      b.add('matte', P.cyl(0.12, 0.17, 1.6, 5), PAL.trunk, { p: [0, 0.8, 0] });
      const paint = foliagePaint(palette[0], palette[1], palette[2], 2.4, 1.3);
      if (v % 2 === 0) b.add('foliage', P.icoSmooth(1.35, 1), paint, { p: [0, 2.5, 0], wind: 0.04 });
      else {
        b.add('foliage', P.icoSmooth(1.05, 1), paint, { p: [0, 2.2, 0], wind: 0.04 });
        b.add('foliage', P.icoSmooth(0.8, 1), paint, { p: [0.35, 3.1, 0.1], wind: 0.05 });
      }
    }),
  );
}

export function bush(v: number, pal = 0, flowers: string | null = null): Prefab {
  return cachedPrefab(`bush:${v}:${pal}:${flowers ?? '-'}`, () =>
    bake((b) => {
      b.addColored('foliage', bushGeo(v % 3, GREENS[pal % GREENS.length]));
      if (flowers) {
        const rng = makeRng(5000 + v);
        for (let i = 0; i < 6; i += 1) {
          const a = rng() * Math.PI * 2;
          const up = 0.35 + rng() * 0.5;
          const rr = Math.sqrt(1 - up * up) * 0.5;
          b.add('foliage', P.ico(0.075, 0), i % 4 === 3 ? '#ffffff' : flowers, { p: [Math.cos(a) * rr, 0.36 + up * 0.46, Math.sin(a) * rr], wind: 0.02 });
        }
      }
    }),
  );
}

/** Very cheap bush for the meadow and tree line (~110 tris). */
export function farBush(v: number): Prefab {
  return cachedPrefab(`farBush:${v}`, () =>
    bake((b) => {
      const palette = GREENS[v % GREENS.length];
      const paint = foliagePaint(palette[0], palette[1], palette[2], 0.4, 0.5);
      b.add('foliage', P.sphere(0.55, 8, 5), paint, { p: [0, 0.35, 0], s: [1, 0.8, 1], wind: 0.015 });
      b.add('foliage', P.sphere(0.38, 7, 4), paint, { p: [0.45, 0.25, 0.15], s: [1, 0.8, 1], wind: 0.015 });
    }),
  );
}

export function hedge(v: number): Prefab {
  return cachedPrefab(`hedge:${v}`, () => bake((b) => b.addColored('foliage', hedgeGeo(v % 3))));
}

/** Ball topiary in a terracotta pot (door decoration). */
export function pottedTopiary(v: number): Prefab {
  return cachedPrefab(`topiary:${v}`, () =>
    bake((b) => {
      const pot = P.lathe('pot', [
        [0.001, 0],
        [0.17, 0],
        [0.22, 0.34],
        [0.26, 0.38],
        [0.25, 0.44],
        [0.001, 0.44],
      ], 8, 0);
      b.add('matte', pot, LOOK.terracotta, { shade: { y0: 0, y1: 0.4, k: 0.8 } });
      b.add('matte', P.box(0.05, 0.5, 0.05), PAL.trunk, { p: [0, 0.65, 0] });
      const pal = GREENS[v % GREENS.length];
      b.add('foliage', P.sphere(0.32, 10, 7), foliagePaint(pal[0], pal[1], pal[2], 1.1, 0.32), { p: [0, 1.08, 0], wind: 0.02 });
    }),
  );
}

// ---------------------------------------------------------------------------
// Flowers (built straight into the chunk, colors vary per placement)
// ---------------------------------------------------------------------------

/** Raised flower bed (stone border, leafy mound, blooms on top). Frame: center at ground, length along X. */
export function flowerBed(b: Bins, lenIn: number, depth: number, colors: readonly string[], seed: number, border = true): void {
  const rng = makeRng(seed);
  const len = Math.max(0.6, Math.round(lenIn * 5) / 5);
  if (border) b.add('matte', P.box(len + 0.16, 0.18, depth + 0.16), LOOK.stone, { p: [0, 0.09, 0], shade: { y0: 0, y1: 0.18, k: 0.85 } });
  const pal = GREENS[seed % GREENS.length];
  b.add('foliage', P.rbox(len, 0.3, depth, 0.14, 1), foliagePaint(pal[0], pal[1], pal[2], 0.3, 0.2), { p: [0, 0.2, 0], wind: 0.006 });
  const nx = Math.max(2, Math.round(len / 0.3));
  const nz = depth > 0.7 ? 2 : 1;
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < nz; j += 1) {
      const x = -len / 2 + ((i + 0.5) * len) / nx + (rng() - 0.5) * 0.08;
      const z = -depth / 2 + ((j + 0.5) * depth) / nz + (rng() - 0.5) * 0.08;
      const c = colors[(i + j * 2) % colors.length];
      b.add('foliage', P.ico(0.1, 0), c, { p: [x, 0.39 + rng() * 0.05, z], wind: 0.02 });
    }
  }
}

/** Tulip clump: little cups on stems. Frame: center at ground. */
export function tulips(b: Bins, n: number, radius: number, color: string, seed: number): void {
  const rng = makeRng(seed);
  const cup = P.lathe('tulipCup', [
    [0.001, 0],
    [0.06, 0.02],
    [0.075, 0.09],
    [0.06, 0.15],
    [0.04, 0.13],
    [0.001, 0.1],
  ], 6, 0);
  for (let i = 0; i < n; i += 1) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * radius;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = 0.28 + rng() * 0.14;
    b.add('foliage', P.box(0.025, 1, 0.025), '#58a85f', { p: [x, h / 2, z], s: [1, h, 1], wind: (_x, y) => y * 0.05 });
    b.add('foliage', cup, color, { p: [x, h, z], wind: 0.02 });
    if (i % 2 === 0) b.add('foliage', P.box(0.07, 0.16, 0.02), '#6cbf6c', { p: [x + 0.04, 0.1, z], r: [0, a, 0.4], wind: 0.01 });
  }
}

/** Daisy dots scattered in the lawn: one low disc each, yellow center painted on the cap. */
export function daisies(b: Bins, pts: Array<[number, number, number]>, colors: readonly string[]): void {
  const disc = P.cyl(0.075, 0.075, 0.03, 5);
  const yellow = col(PAL.flowerYellow);
  pts.forEach(([x, y, z], i) => {
    const petal = col(colors[i % colors.length]);
    b.add('foliage', disc, (vx, vy, vz, _nx, ny, _nz, out) => {
      out.copy(ny > 0.5 && Math.hypot(vx, vz) < 0.01 && vy > 0 ? yellow : petal);
    }, { p: [x, y + 0.03, z] });
  });
}
