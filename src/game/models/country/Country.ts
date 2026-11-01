import * as THREE from 'three';
import type { CountryChunkOptions, TownChunk } from '../contracts';
import { PAL } from '../kit/palette';
import type { Area } from '../../sim/route';
import { Bins, type Prefab } from '../town/bins';
import { farCrown, farStrip } from '../town/farProxy';
import { CHUNK_LEN, LAWN_Y, WALK_Y, addEdging, buildGroundGeometry, groundMaterial, type GroundPlan } from '../town/ground';
import { LOOK } from '../town/look';
import { blossomTree, bush, cloudTree, cypress, farTree, fir, flowerBed, hedge, lollipopTree, pottedTopiary, tulips } from '../town/plants';
import { balloons, bunting, buntingPole } from '../town/props';
import { hashInts, makeRng, type Rng } from '../town/rng';
import { banner, fairyLights, gateway, hayBale, lanternPost, mushroom, mushroomHouse, railFence, reeds, sheep, stoneWall, treeStump, tulipRow, wildflowers } from './prefabs';

/**
 * Country chunks: the same road strip as Rose Town, dressed for each area.
 * Same conventions as town chunks (local road along -Z, straight, bent onto the
 * real road later), so any chunk can follow any other.
 *
 * Budget: at most 40k triangles and six meshes per chunk.
 */

type Side = -1 | 1;
const SIDES: readonly Side[] = [-1, 1];

interface Ctx {
  b: Bins;
  far: Bins;
  rng: Rng;
  plan: GroundPlan;
  /** Tulip rows near enough to the road to carry real flower heads. */
  beds: Array<{ x: number; z: number; color: string }>;
}

const yawToRoad = (s: Side): number => (s < 0 ? 0 : Math.PI);
const alongRoad = (): number => Math.PI / 2;

function put(ctx: Ctx, prefab: Prefab, x: number, z: number, yaw = 0, scale: number | [number, number, number] = 1, y = LAWN_Y): void {
  ctx.b.stamp(prefab, { p: [x, y, z], r: [0, yaw, 0], s: scale });
}

function shade(ctx: Ctx, x: number, z: number, r: number, k = 0.26): void {
  ctx.plan.blobs.push({ x, z, hx: 0, hz: 0, f: r, k });
}

/** A tree with its far-away stand-in and a soft contact shadow baked into the grass. */
function plantTree(ctx: Ctx, prefab: Prefab, x: number, z: number, scale: number, height: number, color: string): void {
  put(ctx, prefab, x, z, ctx.rng.range(0, 6.28), scale);
  farCrown(ctx.far, x, LAWN_Y, z, height * scale, color);
  shade(ctx, x, z, 1.5 * scale);
}

const GREEN = '#7ccb86';
const GREEN_DEEP = '#55a973';
const PINK = '#ffb3cf';

// ---------------------------------------------------------------------------
// Tulip meadow
// ---------------------------------------------------------------------------

function vergeFlowers(ctx: Ctx, s: Side, colors: readonly string[], count: number): void {
  for (let i = 0; i < count; i += 1) put(ctx, wildflowers(colors, i), s * ctx.rng.range(5.2, 6.5), ctx.rng.range(-CHUNK_LEN + 1, -1), ctx.rng.range(0, 6.28), ctx.rng.range(0.8, 1.2), WALK_Y);
}

function railLine(ctx: Ctx, s: Side): void {
  const rng = ctx.rng;
  const openAt = rng.chance(0.5) ? rng.int(0, 9) : -1;
  for (let i = 0; i < 10; i += 1) {
    if (i === openAt) continue;
    put(ctx, railFence(), s * 7.0, -2 - i * 4, alongRoad());
  }
}

/** Stripes of tulips running beside the road, in short rows so they follow bends. */
function tulipField(ctx: Ctx, s: Side): void {
  const rng = ctx.rng;
  const colors = rng.shuffle<string>([PAL.flowerRose, PAL.flowerYellow, '#ffc9dc', PAL.flowerLilac, PAL.flowerRed, PAL.flowerOrange]);
  const stripe = 3;
  for (let r = 0; r < 12; r += 1) {
    const x = 9 + r * 1.85;
    const c = colors[Math.floor(r / stripe) % colors.length];
    for (let k = 0; k < 5; k += 1) {
      put(ctx, tulipRow(c), s * x, -4 - k * 8, 0, 1, LAWN_Y - 0.02);
      if (r < 6) ctx.beds.push({ x: s * x, z: -4 - k * 8, color: c });
    }
  }
  for (let k = 0; k < 4; k += 1) farCrown(ctx.far, s * 19, LAWN_Y - 0.7, -5 - k * 10, 1.3, colors[k]);
}

function pasture(ctx: Ctx, s: Side): void {
  const rng = ctx.rng;
  const cx = s * rng.range(14, 22);
  const cz = rng.range(-12, -28);
  const herd = rng.int(3, 6);
  for (let i = 0; i < herd; i += 1) {
    const x = cx + rng.range(-5, 5);
    const z = cz + rng.range(-7, 7);
    put(ctx, sheep(i), x, z, rng.range(0, 6.28), rng.range(0.95, 1.2));
    shade(ctx, x, z, 1.2, 0.24);
  }
  for (let i = 0; i < 2; i += 1) {
    const x = s * rng.range(10, 30);
    const z = rng.range(-4, -36);
    put(ctx, hayBale(), x, z, rng.range(0, 3.14), rng.range(0.9, 1.15));
    shade(ctx, x, z, 1.1, 0.26);
  }
  const trees = rng.int(2, 4);
  for (let i = 0; i < trees; i += 1) {
    const tall = rng.chance(0.6);
    plantTree(ctx, tall ? lollipopTree(i, rng.int(0, 3)) : lollipopTree(i, 0, true), s * rng.range(11, 32), rng.range(-3, -37), rng.range(1.0, 1.35), 4.2, tall ? GREEN : PINK);
  }
}

function orchard(ctx: Ctx, s: Side): void {
  const rng = ctx.rng;
  for (let col = 0; col < 3; col += 1) {
    for (let i = 0; i < 5; i += 1) {
      plantTree(ctx, lollipopTree(i + col, rng.int(0, 1), true), s * (11 + col * 7 + rng.range(-0.5, 0.5)), -4 - i * 8 + rng.range(-0.6, 0.6), rng.range(1.0, 1.2), 4.2, PINK);
    }
  }
}

function meadow(ctx: Ctx): void {
  const rng = ctx.rng;
  for (const s of SIDES) {
    railLine(ctx, s);
    vergeFlowers(ctx, s, ['#ffffff', PAL.flowerYellow, '#ffc0d8'], 7);
    const kind = rng.weighted<'tulips' | 'pasture' | 'orchard'>([
      ['tulips', 4],
      ['pasture', 4],
      ['orchard', 1.5],
    ]);
    if (kind === 'tulips') tulipField(ctx, s);
    else if (kind === 'pasture') pasture(ctx, s);
    else orchard(ctx, s);
  }
}

// ---------------------------------------------------------------------------
// Mushroom forest
// ---------------------------------------------------------------------------

const CAPS = [PAL.flowerRed, PAL.roofBerry, '#ff8fb1', PAL.flowerOrange, PAL.roofLilac];

function forestTree(ctx: Ctx, x: number, z: number, scale: number): void {
  const rng = ctx.rng;
  const roll = rng();
  if (roll < 0.4) plantTree(ctx, cloudTree(rng.int(0, 2), rng.int(0, 3)), x, z, scale, 5.5, GREEN_DEEP);
  else if (roll < 0.62) plantTree(ctx, fir(rng.int(0, 3)), x, z, scale * 1.15, 5, '#4f9f76');
  else if (roll < 0.82) plantTree(ctx, cypress(rng.int(0, 2), rng.int(0, 3)), x, z, scale * 0.95, 5.3, GREEN_DEEP);
  else plantTree(ctx, blossomTree(rng.int(0, 2), rng.int(0, 2)), x, z, scale * 0.95, 5, PINK);
}

function forest(ctx: Ctx): void {
  const rng = ctx.rng;
  for (const s of SIDES) {
    // Big trees lean in over the road.
    // (Not too far: the phone camera rides higher and would be inside their canopies.)
    for (let z = -2 - rng.range(0, 2); z > -CHUNK_LEN + 1; z -= rng.range(7, 9.5)) forestTree(ctx, s * rng.range(9.8, 11.2), z, rng.range(1.4, 1.75));
    // The wood fills in behind them with cheaper trees.
    for (let row = 0; row < 3; row += 1) {
      for (let z = -1 - rng.range(0, 4); z > -CHUNK_LEN + 0.5; z -= rng.range(5.5, 7.5)) {
        const x = s * (15 + row * 6.2 + rng.range(-1.6, 1.6));
        const pink = rng.chance(0.12);
        plantTree(ctx, row === 0 && rng.chance(0.45) ? fir(rng.int(0, 3)) : farTree(rng.int(0, 3), pink), x, z, rng.range(1.5, 2.2), 3.6, pink ? PINK : GREEN_DEEP);
      }
    }
    // Toadstools along the verge.
    const clusters = rng.int(2, 3);
    for (let c = 0; c < clusters; c += 1) {
      const zc = rng.range(-4, -36);
      const xc = s * rng.range(6.4, 7.4);
      for (let i = 0; i < 4; i += 1) {
        const x = xc + rng.range(-0.8, 0.8);
        const z = zc + rng.range(-1.3, 1.3);
        put(ctx, mushroom(rng.pick(CAPS), i), x, z, rng.range(0, 6.28), rng.range(0.55, 1.5));
        shade(ctx, x, z, 0.9, 0.2);
      }
    }
    for (let i = 0; i < 7; i += 1) {
      const x = s * rng.range(5, 11);
      const z = rng.range(-1, -39);
      put(ctx, rng.chance(0.75) ? wildflowers([PAL.flowerBlue, PAL.flowerLilac, '#ffffff'], i) : bush(rng.int(0, 2), rng.int(0, 3)), x, z, rng.range(0, 6.28), 1);
    }
    if (rng.chance(0.4)) put(ctx, treeStump(), s * rng.range(6.2, 7), rng.range(-6, -34), rng.range(0, 6.28));
  }
  // A gnome lives here: one mushroom house every other chunk.
  if (ctx.plan.index % 2 === 0) {
    const s = rng.sign();
    const z = rng.range(-14, -26);
    put(ctx, mushroomHouse(rng.pick([PAL.flowerRed, PAL.roofBerry, PAL.roofLilac])), s * 14.5, z, yawToRoad(s));
    shade(ctx, s * 14.5, z, 4.4, 0.34);
    ctx.b.stamp(balloons(rng.int(0, 99), 3, 1.6), { p: [s * 11.4, LAWN_Y, z + 3] });
  }
  // Strings of fairy lights between the big trees.
  for (const z of [-11, -31]) {
    const y = 6.2 + rng.range(-0.3, 0.3);
    fairyLights(ctx.b, [-9.6, y, z + rng.range(-1, 1)], [9.6, y, z + rng.range(-1, 1)], 1.0, ['#ffe9a8', '#ffc7dd', '#bfe8ff', '#d9ccff', '#c8f5d6']);
  }
}

// ---------------------------------------------------------------------------
// Lake causeway
// ---------------------------------------------------------------------------

function lake(ctx: Ctx): void {
  const rng = ctx.rng;
  for (const s of SIDES) {
    for (let i = 0; i < 10; i += 1) put(ctx, stoneWall(), s * 5.5, -2 - i * 4, alongRoad(), 1, WALK_Y);
    for (let i = 0; i < 3; i += 1) {
      const z = (s < 0 ? -6 : -13) - i * 14;
      put(ctx, lanternPost(), s * 5.5, z, 0, 1, WALK_Y + 0.5);
    }
    for (let i = 0; i < 5; i += 1) {
      const x = s * rng.range(7.6, 13);
      const z = rng.range(-2, -38);
      put(ctx, reeds(i), x, z, rng.range(0, 6.28), rng.range(0.9, 1.3), 0);
    }
    for (let i = 0; i < 3; i += 1) put(ctx, bush(rng.int(0, 2), rng.int(0, 3), rng.chance(0.5) ? PAL.flowerWhite : null), s * rng.range(6.6, 9), rng.range(-3, -37), 0, rng.range(0.7, 1));
  }
}

// ---------------------------------------------------------------------------
// Castle hill
// ---------------------------------------------------------------------------

function castleHill(ctx: Ctx): void {
  const rng = ctx.rng;
  const bannerColor = rng.pick([PAL.roofBerry, PAL.roofLilac, PAL.roofCoral]);
  for (const s of SIDES) {
    // Clipped hedges with rose beds along the road.
    for (let i = 0; i < 20; i += 1) {
      ctx.b.stamp(hedge(rng.int(0, 2)), { p: [s * 7.6, LAWN_Y - 0.02, -1 - i * 2], r: [0, Math.PI / 2, 0], s: [1.04, 1, 1] });
    }
    ctx.plan.blobs.push({ x: s * 7.6, z: -20, hx: 0.4, hz: 20, f: 0.8, k: 0.2 });
    for (const z of [-7, -33]) {
      ctx.b.within({ p: [s * 9.4, LAWN_Y - 0.02, z], r: [0, Math.PI / 2, 0] }, () => flowerBed(ctx.b, 7, 0.9, LOOK.flowers, rng.int(0, 9999), true));
    }
    // An avenue of cypresses and blossom behind them.
    for (let i = 0; i < 4; i += 1) {
      const z = -5 - i * 10;
      if (i % 2 === 0) plantTree(ctx, cypress(i, rng.int(0, 3)), s * 11.5, z, 1.25, 5.3, GREEN_DEEP);
      else plantTree(ctx, blossomTree(i, rng.int(0, 2)), s * 12.5, z, 1.05, 5, PINK);
    }
    put(ctx, banner(bannerColor), s * 6.6, -20, yawToRoad(s), 1, WALK_Y);
    ctx.b.within({ p: [s * 6.6, LAWN_Y, -38] }, () => tulips(ctx.b, 8, 0.5, rng.pick(LOOK.flowers), rng.int(0, 999)));
    put(ctx, pottedTopiary(rng.int(0, 3)), s * 6.7, -2, 0, 1, WALK_Y);
    for (let i = 0; i < 6; i += 1) plantTree(ctx, farTree(rng.int(0, 3), rng.chance(0.3)), s * rng.range(17, 32), rng.range(-2, -38), rng.range(1.2, 1.7), 3.6, GREEN);
  }
  if (ctx.plan.index % 2 === 1) {
    const z = -30;
    for (const s of SIDES) put(ctx, buntingPole(rng.pick(LOOK.stripes)), s * 6.55, z, 0, 1, WALK_Y);
    bunting(ctx.b, [-6.55, 6.85, z], [6.55, 6.85, z], 0.75, rng.shuffle([...LOOK.stripes, '#ffffff']), `hill:${ctx.plan.index}`);
  }
}

// ---------------------------------------------------------------------------
// Chunk
// ---------------------------------------------------------------------------

const REACH: Record<Exclude<Area, 'town'>, 16 | 34> = { meadow: 34, forest: 34, lake: 16, castle: 34 };

/** Build one country chunk. Deterministic for (index, seed, area, opts). */
export function buildCountryChunk(index: number, seed: number, area: Exclude<Area, 'town'>, opts: CountryChunkOptions = {}): TownChunk {
  const rng = makeRng(hashInts(seed, index, 0xc047));
  const b = new Bins();
  const farBins = new Bins();
  const reach = REACH[area];
  const plan: GroundPlan = { index, seed, plazas: [], blobs: [], area, reach };
  const ctx: Ctx = { b, far: farBins, rng, plan, beds: [] };

  if (area === 'castle') addEdging(b);
  if (area === 'meadow') meadow(ctx);
  else if (area === 'forest') forest(ctx);
  else if (area === 'lake') lake(ctx);
  else castleHill(ctx);
  if (opts.gateway) {
    b.stamp(gateway(area), { p: [0, 0, -1.4] });
    for (const s of SIDES) shade(ctx, s * 6.9, -1.4, 1.2, 0.3);
    farCrown(farBins, 0, 7.6, -1.4, 2, PINK);
  }
  farStrip(farBins, area, reach);

  const ground = new THREE.Mesh(buildGroundGeometry(plan), groundMaterial());
  ground.name = 'country-ground';
  ground.receiveShadow = true;
  ground.castShadow = false;

  const group = new THREE.Group();
  group.name = `country-chunk-${index}`;
  group.userData.area = area;
  group.userData.beds = ctx.beds;
  group.add(ground);
  for (const m of b.meshes('country')) group.add(m);

  const far = new THREE.Group();
  far.name = `country-far-${index}`;
  for (const m of farBins.meshes('country-far')) {
    m.castShadow = false;
    m.receiveShadow = false;
    far.add(m);
  }

  return {
    group,
    far,
    dispose() {
      for (const root of [group, far]) {
        root.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) mesh.geometry.dispose();
        });
        root.removeFromParent();
      }
    },
  };
}
