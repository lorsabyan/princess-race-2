import * as THREE from 'three';
import { PAL } from '../kit/palette';
import { Bins, type Prefab } from './bins';
import { farBox, farCrown, farStrip } from './farProxy';
import {
  CHUNK_LEN,
  CURB_OUT,
  FIELD_L,
  FIELD_W,
  FIELD_X0,
  LAWN_OUT,
  LAWN_Y,
  ROAD_HALF,
  WALK_OUT,
  WALK_Y,
  addEdging,
  buildGroundGeometry,
  groundTriangles,
  groundMaterial,
  lawnHeight,
  type GroundPlan,
} from './ground';
import { buildHouse, buildTower, randomHouse, type HouseSpec } from './houses';
import { LOOK, SCHEMES, foliagePaint, type Scheme } from './look';
import {
  GREENS,
  blossomTree,
  bush,
  farBush,
  cloudTree,
  cypress,
  daisies,
  farTree,
  fir,
  flowerBed,
  hedge,
  lollipopTree,
  pottedTopiary,
  tulips,
} from './plants';
import * as P from './prims';
import {
  balloons,
  bench,
  birdhouse,
  bunting,
  buntingPole,
  crookLamp,
  fenceSegment,
  fencePost,
  flowerCart,
  fountain,
  gateArch,
  mailbox,
  marketStall,
  picnic,
  planter,
  roseArch,
  signpost,
  steppingStone,
  twinLamp,
} from './props';
import { hashInts, makeRng, type Rng } from './rng';

/**
 * Rose Town street chunks.
 *
 *   buildTownChunk(index, seed, { clearLeft?, clearRight? }) -> { group, dispose }
 *
 * Chunk local space: road centered on x = 0 from z = 0 to z = -CHUNK_LENGTH;
 * the returned group is already positioned at z = -index * CHUNK_LENGTH
 * (setting it again to the same value is harmless). Bands per side (|x|):
 * road 0-4.3, curb 4.3-4.6, sidewalk 4.6-6.2 (first 1.5 m kept clear), verge
 * with lamps / street trees / benches 6.2-6.9, fences at 6.95, front yards,
 * house fronts from ~10.2, back row ~19-30, patchwork meadow with hedgerows,
 * then a tree line on a soft berm up to 60.
 *
 * Six archetypes (cottage street, blossom avenue + rose arch, market square,
 * park with fountain, tower houses + bunting, garden lane) are sequenced
 * deterministically from (index, seed) so neighbours never repeat and set
 * pieces stay spaced out. Chunks tile seamlessly in any order: ground texture
 * repeats every 8 m, curbs are flat-ended sweeps, lawn noise is periodic.
 *
 * Budget: at most six meshes (textured ground + matte, foliage (wind), glass,
 * metal, glow bins) and <= 60k triangles; a governor places street-front
 * content first and lets the back row / meadow use what is left. Builds take
 * ~10-15 ms once the shared caches are warm (the first call in a session also
 * pays ~60-100 ms to bake the texture, SDF canopies and prefabs).
 */

/** Band edges and ground heights, for placing gameplay objects and landmarks. */
export const TOWN_LAYOUT = {
  roadHalfWidth: ROAD_HALF,
  curbOut: CURB_OUT,
  sidewalkOut: WALK_OUT,
  sidewalkY: WALK_Y,
  lawnY: LAWN_Y,
  lawnOut: LAWN_OUT,
} as const;

export const CHUNK_LENGTH = CHUNK_LEN;

export interface TownChunk {
  group: THREE.Group;
  /** Cheap stand-in shown far down the road. */
  far?: THREE.Group;
  dispose(): void;
}

export interface TownChunkOptions {
  /** Keep road/curb/sidewalk/lawn on x < 0 but place nothing beyond the sidewalk (landmark space). */
  clearLeft?: boolean;
  /** Same for x > 0. */
  clearRight?: boolean;
}

export type Archetype = 'cottage' | 'blossom' | 'market' | 'park' | 'towers' | 'garden';
export const ARCHETYPES: readonly Archetype[] = ['cottage', 'blossom', 'market', 'park', 'towers', 'garden'];

type Side = -1 | 1;
type SideKind = 'cottages' | 'blossom' | 'market' | 'park' | 'towers' | 'garden';

const VERGE_X = 6.4;
const FENCE_X = 6.95;
const FRONT_X = 10.2;
const Z_MARGIN = 0.9;
/** Triangle budget for a whole chunk (ground mesh + merged bins). */
const CHUNK_BUDGET = 59000;
/** Absolute ceiling (the governor checks before placing, so it keeps a margin under this). */
const CHUNK_HARD_CAP = 59700;
/** Typical ground mesh cost, the verge share, and what the tree line / back row / meadow need at minimum. */
const GROUND_EST = 4400;
const VERGE_RESERVE = 4600;
const REAR_RESERVE = 5600;

interface Ctx {
  b: Bins;
  /** Stand-ins for the far view: one box per house, one blob per tree. */
  far: Bins;
  rng: Rng;
  plan: GroundPlan;
  index: number;
  arch: Archetype;
  /** z positions on the verge that must stay free (gates, arch pillars, poles). */
  keep: Record<Side, number[]>;
  /** z positions already used by verge props. */
  verge: Record<Side, number[]>;
  /** Triangle ceiling for this side's street-front content (houses are always placed; extras adapt). */
  frontCap: number;
  /** 0..1 richness of optional yard dressing, set per side from the remaining budget. */
  rich: number;
}

// ---------------------------------------------------------------------------
// Archetype sequence
// ---------------------------------------------------------------------------

const WEIGHTS: Record<Archetype, number> = { cottage: 3, blossom: 2.2, market: 1.2, park: 1.3, towers: 1.8, garden: 1.7 };

function rawArchetype(index: number, seed: number): Archetype {
  if (index === 0) return 'cottage';
  const r = makeRng(hashInts(seed, index, 0xa7c4));
  return r.weighted(ARCHETYPES.map((a) => [a, WEIGHTS[a]] as const));
}

/** Deterministic archetype for chunk `index`: never the same twice in a row, big set pieces spaced out. */
export function archetypeFor(index: number, seed: number): Archetype {
  const seq: Archetype[] = [];
  const start = Math.max(0, index - 8);
  for (let i = start; i <= index; i += 1) {
    let a = rawArchetype(i, seed);
    let tries = 0;
    const prev = seq[seq.length - 1];
    const recent = seq.slice(-3);
    const special = (x: Archetype) => x === 'market' || x === 'park' || x === 'towers';
    while ((a === prev || (special(a) && (recent.includes(a) || special(prev)))) && tries < 12) {
      a = makeRng(hashInts(seed, i, 0xbeef + tries)).weighted(ARCHETYPES.map((x) => [x, WEIGHTS[x]] as const));
      tries += 1;
    }
    seq.push(a);
  }
  return seq[seq.length - 1];
}

// ---------------------------------------------------------------------------
// Placement helpers
// ---------------------------------------------------------------------------

const yawToRoad = (s: Side): number => (s < 0 ? 0 : Math.PI);
const houseYaw = (s: Side): number => (-s * Math.PI) / 2;

function groundY(x: number, z: number): number {
  return lawnHeight(Math.abs(x), z);
}

function put(ctx: Ctx, prefab: Prefab, x: number, z: number, yaw = 0, scale: number | [number, number, number] = 1, tint?: THREE.Color, y?: number): void {
  ctx.b.stamp(prefab, { p: [x, y ?? groundY(x, z), z], r: [0, yaw, 0], s: scale, tint });
}

function blob(ctx: Ctx, x: number, z: number, hx: number, hz: number, f: number, k: number): void {
  ctx.plan.blobs.push({ x, z, hx, hz, f, k });
}

const tints: THREE.Color[] = [1, 0.94, 1.06, 0.97, 1.03].map((k) => new THREE.Color(k, k * (k > 1 ? 0.99 : 1), k));

function tint(rng: Rng): THREE.Color {
  return rng.pick(tints);
}

function inChunk(z: number, margin = 0.6): boolean {
  return z < -margin && z > -CHUNK_LEN + margin;
}

type TreeKind = 'lollipop' | 'pinkLollipop' | 'cloud' | 'blossom' | 'cypress' | 'fir' | 'far' | 'farPink';

function tree(ctx: Ctx, kind: TreeKind, x: number, z: number, scale = 1, v?: number, pal?: number): void {
  measure(ctx, `tree:${kind}`, () => treeInner(ctx, kind, x, z, scale, v, pal));
}

function treeInner(ctx: Ctx, kind: TreeKind, x: number, z: number, scale = 1, v?: number, pal?: number): void {
  const rng = ctx.rng;
  const vv = v ?? rng.int(0, 5);
  const pp = pal ?? rng.int(0, 3);
  let prefab: Prefab;
  let r = 1.3;
  switch (kind) {
    case 'lollipop':
      prefab = lollipopTree(vv % 3, pp);
      r = 1.2;
      break;
    case 'pinkLollipop':
      prefab = lollipopTree(vv % 3, pp % 2, true);
      r = 1.2;
      break;
    case 'farPink':
      prefab = farTree(vv % 4, true);
      r = 1.4;
      break;
    case 'cloud':
      prefab = cloudTree(vv % 3, pp);
      r = 2.0;
      break;
    case 'blossom':
      prefab = blossomTree(vv % 3, pp % 2 === 0 ? 0 : rng.chance(0.3) ? 2 : 1);
      r = 2.3;
      break;
    case 'cypress':
      prefab = cypress(vv % 3, pp);
      r = 0.9;
      break;
    case 'fir':
      prefab = fir(vv % 4);
      r = 1.4;
      break;
    default:
      prefab = farTree(vv % 4);
      r = 1.4;
  }
  put(ctx, prefab, x, z, rng.range(0, Math.PI * 2), scale * rng.range(0.92, 1.08), tint(rng));
  blob(ctx, x, z, 0, 0, r * scale * 1.1, kind === 'cypress' ? 0.2 : 0.28);
  if (Math.abs(x) < 34) farCrown(ctx.far, x, LAWN_Y, z, 4.8 * scale, kind === 'pinkLollipop' || kind === 'blossom' || kind === 'farPink' ? '#ffb3cf' : '#7ccb86');
}

function bushAt(ctx: Ctx, x: number, z: number, scale = 1, flowers: string | null = null): void {
  measure(ctx, 'bush', () => bushInner(ctx, x, z, scale, flowers));
}

/** Long low hedge between meadow fields (along X when `alongX`, else along Z). */
function hedgerow(ctx: Ctx, x: number, z: number, len: number, alongX: boolean): void {
  const pal = GREENS[ctx.rng.int(0, GREENS.length - 1)];
  ctx.b.add('foliage', P.rbox(len, 0.75, 0.7, 0.3, 1), foliagePaint(pal[0], pal[1], pal[2], 0.5, 0.4), {
    p: [x, groundY(x, z) + 0.3, z],
    r: [0, alongX ? 0 : Math.PI / 2, 0],
    wind: 0.01,
  });
  blob(ctx, x, z, alongX ? len / 2 : 0.4, alongX ? 0.4 : len / 2, 0.8, 0.2);
}

function farBushAt(ctx: Ctx, x: number, z: number, scale = 1): void {
  put(ctx, farBush(ctx.rng.int(0, 3)), x, z, ctx.rng.range(0, 6.28), scale, tint(ctx.rng));
  blob(ctx, x, z, 0, 0, 0.8 * scale, 0.18);
}

function bushInner(ctx: Ctx, x: number, z: number, scale = 1, flowers: string | null = null): void {
  const rng = ctx.rng;
  put(ctx, bush(rng.int(0, 2), rng.int(0, 3), flowers), x, z, rng.range(0, 6.28), scale * rng.range(0.85, 1.15), tint(rng));
  blob(ctx, x, z, 0, 0, 0.75 * scale, 0.22);
}

// ---------------------------------------------------------------------------
// Fences / hedges along the verge
// ---------------------------------------------------------------------------

/** Picket fence along z from z0 to z1 (z0 > z1) at |x| = FENCE_X with gates. */
function fenceRun(ctx: Ctx, s: Side, z0: number, z1: number, gates: number[], color: string): void {
  const x = s * FENCE_X;
  const yaw = houseYaw(s);
  const gap = 0.7;
  // Split into runs between gates.
  const cuts = gates.filter((g) => g < z0 && g > z1).sort((a, b) => b - a);
  let start = z0;
  const runs: Array<[number, number]> = [];
  for (const g of cuts) {
    runs.push([start, g + gap]);
    start = g - gap;
  }
  runs.push([start, z1]);
  const post = fencePost(color);
  for (const [a, c] of runs) {
    const len = a - c;
    if (len < 0.5) continue;
    const n = Math.max(1, Math.round(len / 2));
    const seg = len / n;
    for (let i = 0; i < n; i += 1) {
      const zc = a - (i + 0.5) * seg;
      ctx.b.stamp(fenceSegment(color), { p: [x, LAWN_Y, zc], r: [0, yaw, 0], s: [seg / 2, 1, 1] });
    }
    for (let i = 0; i <= n; i += 1) {
      if (i !== 0 && i !== n && i % 2 === 1) continue;
      ctx.b.stamp(post, { p: [x, LAWN_Y, a - i * seg], r: [0, yaw, 0] });
    }
    blob(ctx, x, (a + c) / 2, 0.05, len / 2, 0.45, 0.12);
  }
}

function hedgeRun(ctx: Ctx, s: Side, x: number, z0: number, z1: number, gates: number[]): void {
  const yaw = houseYaw(s);
  const cuts = gates.filter((g) => g < z0 && g > z1).sort((a, b) => b - a);
  let start = z0;
  const runs: Array<[number, number]> = [];
  for (const g of cuts) {
    runs.push([start, g + 0.8]);
    start = g - 0.8;
  }
  runs.push([start, z1]);
  for (const [a, c] of runs) {
    const len = a - c;
    if (len < 0.9) continue;
    const n = Math.max(1, Math.round(len / 1.9));
    const seg = len / n;
    for (let i = 0; i < n; i += 1) {
      const zc = a - (i + 0.5) * seg;
      ctx.b.stamp(hedge(ctx.rng.int(0, 2)), { p: [s * x, LAWN_Y - 0.02, zc], r: [0, yaw, 0], s: [(seg / 2) * 1.04, 1, 1], tint: tint(ctx.rng) });
    }
    blob(ctx, s * x, (a + c) / 2, 0.35, len / 2, 0.6, 0.22);
  }
}

// ---------------------------------------------------------------------------
// Houses with yards
// ---------------------------------------------------------------------------

interface Placed {
  z0: number;
  z1: number;
  doorZ: number;
  height: number;
  front: number;
}

function placeHouse(ctx: Ctx, s: Side, xFront: number, zc: number, spec: HouseSpec): Placed {
  const rng = ctx.rng;
  const yaw = houseYaw(s) + rng.range(-0.025, 0.025);
  let info = { doorU: 0, height: 0, wallTop: 0 };
  ctx.b.within({ p: [s * xFront, 0.03, zc], r: [0, yaw, 0] }, () => {
    info = buildHouse(ctx.b, spec, rng.fork(17));
  });
  const doorZ = zc + s * info.doorU;
  farBox(ctx.far, s * (xFront + spec.d / 2), LAWN_Y, zc, 0, spec.w, Math.max(3, info.wallTop), spec.d, spec.scheme.wall, spec.scheme.roof);
  // Footprint AO (+ tower).
  blob(ctx, s * (xFront + spec.d / 2), zc, spec.d / 2 + 0.1, spec.w / 2 + 0.1, 1.5, 0.34);
  let z0 = zc + spec.w / 2;
  let z1 = zc - spec.w / 2;
  if (spec.tower !== 0) {
    const tr = Math.min(1.7, Math.max(1.2, spec.w * 0.24));
    const tz = zc + s * spec.tower * (spec.w / 2 + tr * 0.35);
    blob(ctx, s * (xFront + tr * 0.9), tz, tr, tr, 1.2, 0.3);
    z0 = Math.max(z0, tz + tr);
    z1 = Math.min(z1, tz - tr);
  }
  return { z0, z1, doorZ, height: info.height, front: xFront };
}

function towerWidth(spec: HouseSpec): number {
  if (spec.tower === 0) return spec.w;
  const tr = Math.min(1.7, Math.max(1.2, spec.w * 0.24));
  return spec.w + tr * 1.4;
}

/** Offset of the footprint center relative to the body center along world z. */
function towerShift(s: Side, spec: HouseSpec): number {
  if (spec.tower === 0) return 0;
  const tr = Math.min(1.7, Math.max(1.2, spec.w * 0.24));
  return -s * spec.tower * (tr * 0.7);
}

interface YardStyle {
  fence: 'picket' | 'hedge' | 'open';
  fenceColor: string;
  gateArch: boolean;
  tree: TreeKind | null;
  beds: boolean;
  topiary: boolean;
  mailbox: boolean;
}

function dressYard(ctx: Ctx, s: Side, h: Placed, style: YardStyle, flowers: readonly string[]): void {
  const rng = ctx.rng;
  const front = h.front;
  // Path of stepping stones from the gate to the door.
  const stone = steppingStone();
  const n = Math.max(2, Math.floor((front - FENCE_X - 0.3) / 0.62));
  for (let i = 0; i < n; i += 1) {
    const x = FENCE_X + 0.35 + (i * (front - FENCE_X - 0.8)) / Math.max(1, n - 1);
    ctx.b.add('matte', stone, i % 2 === 0 ? LOOK.stone : LOOK.stoneWarm, {
      p: [s * x, LAWN_Y + 0.01, h.doorZ + (i % 2 === 0 ? 0.07 : -0.07)],
      r: [0, rng.range(0, 3), 0],
      shade: { y0: -0.03, y1: 0.03, k: 0.85 },
    });
  }
  ctx.keep[s].push(h.doorZ);
  const extra = () => rng() < ctx.rich;
  if (style.gateArch && extra()) put(ctx, gateArch(rng.pick([PAL.flowerRose, '#ff8fb1', PAL.flowerRed])), s * FENCE_X, h.doorZ, houseYaw(s));
  if (style.mailbox) put(ctx, mailbox(rng.pick(LOOK.stripes)), s * (FENCE_X - 0.35), h.doorZ + rng.sign() * 1.0, yawToRoad(s));
  if (style.topiary && extra()) {
    for (const d of [-1, 1]) put(ctx, pottedTopiary(rng.int(0, 3)), s * (front + 0.35), h.doorZ + d * 0.95, 0, 0.9);
  }
  // Flower beds along the fence, either side of the path.
  const room0 = h.z0 - (h.doorZ + 0.9);
  const room1 = h.doorZ - 0.9 - h.z1;
  if (style.beds && extra()) {
    // One flower bed along the fence on the roomier side of the path.
    const dir = room0 > room1 ? 1 : -1;
    const room = Math.max(room0, room1);
    if (room >= 1.4) {
      const len = Math.min(2.6, room - 0.4);
      const zc = h.doorZ + dir * (0.9 + len / 2 + 0.1);
      ctx.b.within({ p: [s * (FENCE_X + 0.75), LAWN_Y - 0.02, zc], r: [0, Math.PI / 2, 0] }, () =>
        flowerBed(ctx.b, len, 0.55, flowers, rng.int(0, 9999), rng.chance(0.6)),
      );
      blob(ctx, s * (FENCE_X + 0.75), zc, 0.3, len / 2, 0.4, 0.15);
    }
  } else if (extra()) {
    // A round bush instead.
    const dir = room0 > room1 ? 1 : -1;
    if (Math.max(room0, room1) > 1.2) bushAt(ctx, s * (FENCE_X + 0.8), h.doorZ + dir * (1.2 + rng.range(0, 0.6)), rng.range(0.8, 1.1), rng.chance(0.5) ? rng.pick(flowers) : null);
  }
  // A foundation bush against the facade.
  {
    const dir = rng.sign();
    const z = dir > 0 ? h.z0 - 0.7 : h.z1 + 0.7;
    if (Math.abs(z - h.doorZ) > 1.6 && rng.chance(0.5) && extra()) bushAt(ctx, s * (front + 0.55), z, rng.range(0.7, 1.0), rng.chance(0.35) ? rng.pick(flowers) : null);
  }
  // Yard tree.
  if (style.tree && extra()) {
    const dir = room0 > room1 ? 1 : -1;
    const room = Math.max(room0, room1);
    if (room > 2.2) tree(ctx, style.tree, s * (FENCE_X + 1.9 + rng.range(0, 0.5)), h.doorZ + dir * (1.4 + room * 0.5), style.tree === 'blossom' ? 0.85 : 0.8);
  }
  // Daisies in the lawn.
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i < 4; i += 1) {
    const x = s * rng.range(FENCE_X + 0.4, front - 0.5);
    const z = rng.range(h.z1 + 0.3, h.z0 - 0.3);
    if (Math.abs(z - h.doorZ) < 0.5) continue;
    pts.push([x, LAWN_Y, z]);
  }
  daisies(ctx.b, pts, ['#ffffff', '#ffffff', '#ffd6e6']);
}

function yardStyle(rng: Rng, kind: SideKind): YardStyle {
  const blossom = kind === 'blossom';
  return {
    fence: rng.weighted([
      ['picket', blossom ? 5 : 6],
      ['hedge', 3],
      ['open', 1.2],
    ]),
    fenceColor: rng.weighted([
      [LOOK.trim, 6],
      ['#ffd9e6', 1],
      ['#d4f2e6', 1],
      ['#e6dcff', 1],
    ]),
    gateArch: rng.chance(blossom ? 0.3 : 0.12),
    tree: rng.chance(blossom ? 0.55 : 0.35) ? (blossom ? rng.pick<TreeKind>(['pinkLollipop', 'pinkLollipop', 'blossom']) : rng.pick<TreeKind>(['lollipop', 'cloud', 'pinkLollipop', 'lollipop'])) : null,
    beds: rng.chance(0.6),
    topiary: rng.chance(0.3),
    mailbox: rng.chance(0.5),
  };
}

function pickScheme(rng: Rng, avoid: Scheme | null): Scheme {
  let s = rng.pick(SCHEMES);
  for (let i = 0; i < 3 && avoid && s.wall === avoid.wall; i += 1) s = rng.pick(SCHEMES);
  return s;
}

/** A row of front houses with yards along one side. */
function frontRow(ctx: Ctx, s: Side, kind: SideKind): void {
  const rng = ctx.rng;
  let z = -Z_MARGIN;
  let prev: Scheme | null = null;
  const placed: Placed[] = [];
  const gates: number[] = [];
  const styles: YardStyle[] = [];
  const loose = kind === 'blossom' || kind === 'garden';
  while (true) {
    const scheme = pickScheme(rng, prev);
    prev = scheme;
    let spec: HouseSpec;
    if (kind === 'towers') {
      const r = rng();
      const tall = r < 0.55;
      spec = r > 0.8
        ? randomHouse(rng, scheme, 2, { camSide: s, roof: 'gableFront', floors: 2 })
        : tall
        ? randomHouse(rng, scheme, 2, { roof: 'gableFront', floors: 3, bell: true, w: rng.pick([4.8, 5.2, 5.6]), d: rng.pick([5.2, 5.6]), roofStyle: rng.chance(0.5) ? 'scallop' : 'courses', pitch: rng.pick([0.86, 0.94]), camSide: s, doorHood: rng.pick(['gable', 'round'] as const) })
        : randomHouse(rng, scheme, 2, { roof: 'gableFront', floors: 2, tower: rng.sign(), camSide: s });
    } else if (kind === 'garden') {
      spec = randomHouse(rng, scheme, 2, { floors: rng.chance(0.7) ? 1 : 2, roofStyle: rng.chance(0.55) ? 'puffy' : 'scallop', roof: rng.chance(0.6) ? 'gableSide' : 'gableFront', camSide: s });
    } else {
      spec = randomHouse(rng, scheme, 2, { camSide: s, tower: rng.chance(0.12) ? rng.sign() : 0 });
    }
    const width = towerWidth(spec);
    if (z - width < -CHUNK_LEN + Z_MARGIN) break;
    const zc = z - width / 2 + towerShift(s, spec);
    const setback = loose ? rng.range(0.6, 1.6) : rng.range(0, 0.7);
    const h = measure(ctx, 'frontHouses', () => placeHouse(ctx, s, FRONT_X + setback, zc, spec));
    placed.push(h);
    gates.push(h.doorZ);
    styles.push(yardStyle(rng, kind));
    const gap = kind === 'towers' ? rng.range(1.8, 3.0) : loose ? rng.range(3.0, 4.6) : rng.range(2.0, 3.4);
    z = Math.min(h.z1, z - width) - gap;
  }
  // Yards: optional dressing scales with what's left of this side's budget.
  const left = ctx.frontCap - ctx.b.triangles() - placed.length * 450;
  ctx.rich = Math.min(1, Math.max(0.15, left / Math.max(1, placed.length * 1500)));
  measure(ctx, 'yards', () => placed.forEach((h, i) => dressYard(ctx, s, h, styles[i], randomFlowers(rng))));
  // Verge boundary: fences / hedges per house frontage (+ half the gaps).
  placed.forEach((h, i) => {
    const top = Math.min(-0.4, h.z0 + 0.4);
    const bottom = Math.max(-CHUNK_LEN + 0.4, h.z1 - 0.4);
    const st = styles[i];
    if (st.fence === 'picket') measure(ctx, 'fence', () => fenceRun(ctx, s, top, bottom, [h.doorZ], st.fenceColor));
    else if (st.fence === 'hedge') measure(ctx, 'hedge', () => hedgeRun(ctx, s, FENCE_X + 0.1, top, bottom, [h.doorZ]));
  });
  // Gaps between houses: trees and bushes, deeper in.
  const gaps: Array<[number, number]> = [];
  gaps.push([-0.3, placed[0]?.z0 ?? -CHUNK_LEN]);
  for (let i = 0; i + 1 < placed.length; i += 1) gaps.push([placed[i].z1, placed[i + 1].z0]);
  if (placed.length) gaps.push([placed[placed.length - 1].z1, -CHUNK_LEN + 0.3]);
  for (const [a, c] of gaps) {
    const len = a - c;
    const zc = (a + c) / 2;
    if (len > 1.6 && inChunk(zc, 1.2) && (ctx.b.triangles() < ctx.frontCap || rng() < 0.5)) {
      const lean = ctx.b.triangles() > ctx.frontCap;
      const k: TreeKind = lean ? 'cypress' : kind === 'blossom' ? 'blossom' : kind === 'towers' ? rng.pick<TreeKind>(['cypress', 'lollipop']) : rng.pick<TreeKind>(['cloud', 'cypress', 'pinkLollipop', 'cloud', 'lollipop']);
      tree(ctx, k, s * (FRONT_X + rng.range(2.5, 4.5)), zc, len > 3 ? 1 : 0.85);
    }
    if (len > 1.0 && inChunk(zc, 0.8) && rng.chance(0.6) && ctx.b.triangles() < ctx.frontCap) bushAt(ctx, s * (FRONT_X + 0.4), zc, 0.9);
  }
  for (const g of gates) ctx.keep[s].push(g);
}

function randomFlowers(rng: Rng): string[] {
  return rng.shuffle([...LOOK.flowers]).slice(0, 3);
}

// ---------------------------------------------------------------------------
// Special sides
// ---------------------------------------------------------------------------

function marketSide(ctx: Ctx, s: Side): void {
  const rng = ctx.rng;
  const z0 = -3;
  const z1 = -37;
  const plaza = { x0: s < 0 ? -18 : WALK_OUT, x1: s < 0 ? -WALK_OUT : 18, z0: z1, z1: z0 };
  ctx.plan.plazas.push(plaza);
  // Shops facing the plaza.
  let z = z0 - 0.2;
  let prev: Scheme | null = null;
  const stripes = rng.shuffle([...LOOK.stripes]);
  let si = 0;
  while (true) {
    const scheme = pickScheme(rng, prev);
    prev = scheme;
    const stripe = stripes[si % stripes.length];
    si += 1;
    const spec = randomHouse(rng, scheme, 2, {
      roof: rng.chance(0.6) ? 'gableFront' : 'gableSide',
      floors: 2,
      camSide: s,
      shop: { stripe, sign: rng.pick(['heart', 'star', 'cup', 'flower'] as const) },
      bay: false,
      balcony: false,
      w: rng.pick([6.6, 7.2, 7.8]),
    });
    if (z - spec.w < z1 - 2) break;
    const zc = z - spec.w / 2;
    placeHouse(ctx, s, 18.2, zc, spec);
    z -= spec.w + rng.range(0.3, 1.0);
  }
  // Stalls near the street.
  const goods = rng.shuffle(['fruit', 'flowers', 'bakery', 'flowers'] as Array<'fruit' | 'flowers' | 'bakery'>);
  const stallZ = [-8, -17, -26, -34];
  stallZ.forEach((sz, i) => {
    if (i === 3 && ctx.b.triangles() > ctx.frontCap - 2500) return;
    if (i === 2 && rng.chance(0.5)) {
      put(ctx, flowerCart(rng.int(0, 5)), s * 9.4, sz, yawToRoad(s) + rng.range(-0.3, 0.3));
      blob(ctx, s * 9.4, sz, 0.6, 1.0, 0.6, 0.2);
      return;
    }
    put(ctx, marketStall(stripes[(i + 1) % stripes.length], goods[i], rng.int(0, 3)), s * 9.6, sz, yawToRoad(s));
    blob(ctx, s * 9.6, sz, 0.8, 1.4, 0.7, 0.25);
  });
  // Planters, benches and balloons around the square.
  for (const pz of [-12.5, -21.5, -30.5]) {
    put(ctx, planter(rng.pick(LOOK.flowers), rng.int(0, 3)), s * 8.2, pz);
    blob(ctx, s * 8.2, pz, 0, 0, 0.6, 0.2);
  }
  put(ctx, bench(rng.pick(['#fffaf6', '#ffc9d9', '#bfe8da'])), s * 13.2, -21.5, yawToRoad(s));
  put(ctx, balloons(rng.int(0, 99), 5, 2.1), s * 9.9, -8 + 1.3, 0);
  // Central tree in a round bed.
  ctx.b.add('matte', P.cyl(1.3, 1.35, 0.3, 20), LOOK.stone, { p: [s * 14, LAWN_Y + 0.15, -12.5] });
  ctx.b.add('matte', P.cyl(1.18, 1.18, 0.32, 20), LOOK.soil, { p: [s * 14, LAWN_Y + 0.17, -12.5] });
  tree(ctx, rng.chance(0.5) ? 'blossom' : 'cloud', s * 14, -12.5, 0.9);
  tulips(ctx.b.push({ p: [s * 14, LAWN_Y + 0.3, -12.5] }), 12, 1.0, rng.pick(LOOK.flowers), rng.int(0, 999));
  ctx.b.pop();
  // Festive bunting from plaza poles to shop fronts.
  for (const [pz, sz] of [
    [-6, -9],
    [-22, -26],
  ]) {
    put(ctx, buntingPole(rng.pick(LOOK.stripes)), s * 7.4, pz, 0);
    bunting(ctx.b, [s * 7.4, 6.4, pz], [s * 17.9, 6.2, sz], 0.8, LOOK.stripes, `plaza:${s}:${pz}`);
    ctx.keep[s].push(pz);
  }
  // Back: trees behind the shops.
  for (let i = 0; i < 5; i += 1) tree(ctx, rng.pick<TreeKind>(['cloud', 'cypress', 'lollipop']), s * rng.range(26, 30), -4 - i * 8 + rng.range(-1, 1), 1.1);
}

function parkSide(ctx: Ctx, s: Side): void {
  const rng = ctx.rng;
  const cz = -20;
  const cx = s * 16.5;
  // Paved round-ish square (rect plaza) around the fountain.
  ctx.plan.plazas.push({ x0: cx - 5, x1: cx + 5, z0: cz - 5, z1: cz + 5 });
  put(ctx, fountain(rng.int(0, 3)), cx, cz, 0, 1, undefined, LAWN_Y);
  blob(ctx, cx, cz, 2.2, 2.2, 1.2, 0.25);
  // Benches around the fountain, facing it.
  for (let i = 0; i < 4; i += 1) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const bx = cx + Math.cos(a) * 4.3;
    const bz = cz + Math.sin(a) * 4.3;
    const yaw = Math.atan2(-(cz - bz), cx - bx);
    put(ctx, bench(rng.pick(['#fffaf6', '#ffc9d9', '#bfe8da', '#ffe6a6'])), bx, bz, yaw, 1, undefined, LAWN_Y);
  }
  // Ring of lollipop trees and round flower beds.
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2;
    const tx = cx + Math.cos(a) * 7.4;
    const tz = cz + Math.sin(a) * 7.4;
    if (s * tx < 8.4) {
      bushAt(ctx, tx, tz, 1.1, rng.pick(LOOK.flowers));
      continue;
    }
    if (i % 2 === 0) tree(ctx, 'lollipop', tx, tz, 1.05, i, 0);
    else {
      ctx.b.within({ p: [tx, LAWN_Y, tz] }, () => {
        ctx.b.add('matte', P.cyl(0.8, 0.85, 0.22, 16), LOOK.stone, { p: [0, 0.1, 0] });
        ctx.b.add('matte', P.cyl(0.7, 0.7, 0.26, 16), LOOK.soil, { p: [0, 0.12, 0] });
        tulips(ctx.b, 10, 0.55, rng.pick(LOOK.flowers), rng.int(0, 9999));
      });
    }
  }
  // Hedge border along the verge with an entrance at the fountain axis.
  hedgeRun(ctx, s, FENCE_X + 0.2, -0.6, -CHUNK_LEN + 0.6, [cz]);
  ctx.keep[s].push(cz);
  // Path from the entrance to the square.
  for (let i = 0; i < 6; i += 1) {
    const x = s * (FENCE_X + 0.5 + i * 0.75);
    ctx.b.add('matte', steppingStone(), LOOK.stone, { p: [x, LAWN_Y + 0.01, cz + (i % 2 ? 0.1 : -0.1)], s: [1.3, 1, 1.3] });
  }
  // Picnic, balloons, a signpost.
  put(ctx, picnic(rng.pick(['#ff9fb8', '#9cc8f5', '#ffd07a'])), s * 21.5, cz - 9.5, rng.range(0, 3));
  put(ctx, balloons(rng.int(0, 99), 4, 1.8), cx + Math.cos(Math.PI / 4) * 4.3 + 0.8, cz + Math.sin(Math.PI / 4) * 4.3, 0);
  put(ctx, balloons(rng.int(0, 99), 3, 1.6), s * 21.2, cz - 9.2, 0);
  put(ctx, signpost(rng.int(0, 5)), s * (FENCE_X + 0.8), cz + 1.6, yawToRoad(s));
  put(ctx, birdhouse(rng.pick(LOOK.stripes), rng.pick(LOOK.stripes)), s * 12, cz + 9, yawToRoad(s));
  // Lawn trees at the corners of the park.
  for (const [tx, tz] of [
    [10.5, -4.5],
    [11.5, -35.5],
    [24, -5],
    [25, -34],
    [28.5, -20],
  ]) tree(ctx, rng.pick<TreeKind>(['cloud', 'blossom', 'cloud']), s * tx, tz, 1.05);
  for (let i = 0; i < 6; i += 1) bushAt(ctx, s * rng.range(9, 26), rng.pick([-3, -37]) + rng.range(-1, 1), 1.0, rng.chance(0.5) ? rng.pick(LOOK.flowers) : null);
}

// ---------------------------------------------------------------------------
// Verge, back row, lawn, tree line
// ---------------------------------------------------------------------------

function freeAt(ctx: Ctx, s: Side, z: number, r: number): boolean {
  for (const k of ctx.keep[s]) if (Math.abs(k - z) < r + 0.9) return false;
  for (const v of ctx.verge[s]) if (Math.abs(v - z) < r) return false;
  return true;
}

function verge(ctx: Ctx, s: Side, kind: SideKind): void {
  const rng = ctx.rng;
  const lampZ = s < 0 ? [-5, -25] : [-15, -35];
  const lamp = ctx.arch === 'market' || ctx.arch === 'towers' ? twinLamp() : crookLamp();
  for (const z0 of lampZ) {
    let z = z0;
    for (let t = 0; t < 6 && !freeAt(ctx, s, z, 1.0); t += 1) z += t % 2 === 0 ? 1.3 * (t + 1) : -1.3 * (t + 1);
    if (!inChunk(z, 0.8) || !freeAt(ctx, s, z, 1.0)) continue;
    put(ctx, lamp, s * VERGE_X, z, yawToRoad(s), 1, undefined, LAWN_Y);
    ctx.verge[s].push(z);
    blob(ctx, s * VERGE_X, z, 0, 0, 0.5, 0.2);
    if (rng.chance(0.18)) put(ctx, balloons(rng.int(0, 99), 3, 1.5), s * (VERGE_X + 0.15), z - 0.2, 0, 1, undefined, LAWN_Y + 0.9);
  }
  if (kind === 'market' || kind === 'park') return;
  // Street trees between lamps, little round flower beds in between.
  const spacing = kind === 'blossom' ? 8 : 8.5;
  for (let z = -3 - (s > 0 ? spacing / 2 : 0); z > -CHUNK_LEN + 1; z -= spacing) {
    const zz = z + rng.range(-0.5, 0.5);
    if (freeAt(ctx, s, zz, 1.6)) {
      if (kind === 'towers') {
        put(ctx, planter(rng.pick(LOOK.flowers), rng.int(0, 3)), s * (VERGE_X + 0.2), zz);
      } else {
        const treeKind: TreeKind = kind === 'blossom' ? (rng.chance(0.3) ? 'blossom' : 'pinkLollipop') : 'lollipop';
        tree(ctx, treeKind, s * (VERGE_X + 0.25), zz, treeKind === 'blossom' ? 0.8 : 0.95, undefined, treeKind === 'lollipop' ? rng.int(0, 3) : rng.int(0, 1));
      }
      ctx.verge[s].push(zz);
    }
    const mid = zz - spacing / 2;
    if (inChunk(mid, 1.5) && freeAt(ctx, s, mid, 1.2)) {
      const r = rng();
      if (r < 0.2 && kind !== 'towers') {
        // A bench facing the street, sometimes with balloons tied to it.
        put(ctx, bench(rng.pick(['#fffaf6', '#ffc9d9', '#bfe8da', '#ffe6a6', '#d9ccff'])), s * (VERGE_X + 0.25), mid, yawToRoad(s), 1, undefined, LAWN_Y);
        blob(ctx, s * (VERGE_X + 0.25), mid, 0.3, 0.8, 0.5, 0.18);
        if (rng.chance(0.35)) put(ctx, balloons(rng.int(0, 99), 3, 1.4), s * (VERGE_X + 0.05), mid + 0.68, 0, 1, undefined, LAWN_Y + 0.66);
        ctx.verge[s].push(mid);
      } else if (r < 0.75) {
        vergeFlowers(ctx, s * (VERGE_X + 0.25), mid);
        ctx.verge[s].push(mid);
      }
    }
  }
}

/** Small round flower bed on the verge. */
function vergeFlowers(ctx: Ctx, x: number, z: number): void {
  const rng = ctx.rng;
  ctx.b.within({ p: [x, LAWN_Y, z] }, () => {
    ctx.b.add('matte', P.cyl(0.42, 0.45, 0.14, 10), LOOK.stone, { p: [0, 0.05, 0] });
    ctx.b.add('foliage', P.sphere(0.38, 8, 4), '#5fb86e', { p: [0, 0.1, 0], s: [1, 0.45, 1], wind: 0.005 });
    const colors = randomFlowers(rng);
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2 + rng();
      const r = i === 0 ? 0 : 0.24;
      ctx.b.add('foliage', P.ico(0.09, 0), colors[i % colors.length], { p: [Math.cos(a) * r, 0.24, Math.sin(a) * r], wind: 0.015 });
    }
  });
  blob(ctx, x, z, 0, 0, 0.5, 0.15);
}

function backRow(ctx: Ctx, s: Side, kind: SideKind, cap: number): void {
  const rng = ctx.rng;
  const room = () => ctx.b.triangles() < cap;
  let z = -1.5 - rng.range(0, 4);
  let prev: Scheme | null = null;
  while (z > -CHUNK_LEN + 3 && room()) {
    if (rng.chance(kind === 'garden' ? 0.5 : 0.32)) {
      // Garden patch instead of a house.
      const len = rng.range(5, 8);
      tree(ctx, rng.pick<TreeKind>(['cloud', 'fir', 'cypress', kind === 'blossom' ? 'farPink' : 'far']), s * rng.range(20, 24), z - len / 2, 1.1);
      z -= len;
      continue;
    }
    const scheme = pickScheme(rng, prev);
    prev = scheme;
    const spec = randomHouse(rng, scheme, 1, { camSide: s, flowerBoxes: false, bay: false, balcony: false, tower: rng.chance(0.1) ? rng.sign() : 0 });
    const width = towerWidth(spec);
    if (z - width < -CHUNK_LEN + Z_MARGIN) break;
    const zc = z - width / 2 + towerShift(s, spec);
    measure(ctx, 'backHouses', () => placeHouse(ctx, s, rng.range(19.5, 22.5), zc, spec));
    z -= width + rng.range(1.5, 4);
    if (z > -CHUNK_LEN + 2 && rng.chance(0.6)) tree(ctx, rng.pick<TreeKind>(['far', 'cypress', 'fir', 'lollipop']), s * rng.range(18.5, 22), z + 0.8, 1.0);
  }
  // Private back gardens between the rows (seen through the gaps).
  for (let i = 0; i < 2 && room(); i += 1) {
    const zz = rng.range(-4, -36);
    tree(ctx, rng.pick<TreeKind>(['lollipop', 'far', kind === 'blossom' ? 'pinkLollipop' : 'cypress']), s * rng.range(16.8, 18.2), zz, 0.9);
  }
}

function standaloneTower(ctx: Ctx, s: Side, x: number, z: number, scheme: Scheme): void {
  ctx.b.within({ p: [s * x, 0.03, z], r: [0, houseYaw(s), 0] }, () => {
    buildTower(ctx.b, { r: 1.6, h: 7.5, scheme, detail: 1, windows: 'arch', flag: ctx.rng.pick(LOOK.stripes) }, ctx.rng.fork(5));
  });
  blob(ctx, s * x, z, 1.6, 1.6, 1.3, 0.3);
}

/** Tree line on the berm: it closes the horizon, so it gets budget before the meadow. */
function treeLine(ctx: Ctx, s: Side, cap: number, hardCap: number): void {
  const rng = ctx.rng;
  for (let z = -1.5 - rng.range(0, 2); z > -CHUNK_LEN + 0.5; z -= rng.range(3.8, 5.4)) {
    if (ctx.b.triangles() > hardCap - 150) break;
    const x = rng.range(51, 56);
    const kindTL = rng.weighted<TreeKind>([
      ['far', 5],
      ['cypress', 2],
      ['fir', 2],
    ]);
    // Over budget: keep a sparser line of the cheapest trees.
    if (ctx.b.triangles() > cap) {
      if (rng.chance(0.5)) tree(ctx, 'far', s * x, z, rng.range(1.5, 1.9));
      continue;
    }
    tree(ctx, kindTL, s * x, z, rng.range(1.35, 1.8));
  }
}

function lawn(ctx: Ctx, s: Side, kind: SideKind, cap: number): void {
  const rng = ctx.rng;
  const room = () => ctx.b.triangles() < cap;
  for (let z = -3 - rng.range(0, 3); z > -CHUNK_LEN + 1 && room(); z -= rng.range(8, 12)) {
    farBushAt(ctx, s * rng.range(47, 50), z, rng.range(1.5, 2.1));
  }
  // Occasional tulip field (colorful stripes seen from above and far away).
  if ((kind === 'garden' || rng.chance(0.3)) && room()) {
    const fx = rng.range(33, 40);
    const fz = rng.range(-12, -28);
    const colors = rng.shuffle([PAL.flowerRose, PAL.flowerYellow, '#ffffff', PAL.flowerLilac, PAL.flowerRed, PAL.flowerOrange]);
    for (let r = 0; r < 6; r += 1) {
      const x = s * (fx + r * 0.9);
      const c = colors[r % colors.length];
      ctx.b.add('foliage', P.rbox(0.55, 0.3, 9, 0.12, 1), (_x, y, _z, _nx, _ny, _nz, out) => {
        out.set(y > 0.05 ? c : '#5aa865');
      }, { p: [x, LAWN_Y + 0.1, fz], wind: (_x, y) => Math.max(0, y) * 0.03 });
    }
  }
  // Hedgerows between some meadow fields (a patchwork read from above).
  for (let k = 1; k < 3; k += 1) {
    if (!rng.chance(0.55) || !room()) continue;
    const z = -k * FIELD_L;
    const x0 = FIELD_X0 + 0.8;
    const x1 = FIELD_X0 + FIELD_W * 2 - 0.8;
    hedgerow(ctx, s * ((x0 + x1) / 2), z, x1 - x0, true);
  }
  for (let k = 1; k < 3; k += 1) {
    if (!rng.chance(0.4) || !room()) continue;
    const fz = rng.int(0, 2);
    hedgerow(ctx, s * (FIELD_X0 + k * FIELD_W), -(fz + 0.5) * FIELD_L, FIELD_L - 1.6, false);
  }
  // A cottage or a little tower out on the meadow.
  if (kind !== 'market' && room()) {
    const r = rng();
    if (r < 0.18) standaloneTower(ctx, s, rng.range(33, 40), rng.range(-10, -30), pickScheme(rng, null));
    else if (r < 0.55) {
      const spec = randomHouse(rng, pickScheme(rng, null), 1, { camSide: s, floors: 1, tower: 0, bay: false, balcony: false, flowerBoxes: false, dormers: 0 });
      placeHouse(ctx, s, rng.range(34, 40), rng.range(-8, -32), spec);
    }
  }
  // Scattered trees and bushes across the meadow.
  const n = 5 + rng.int(0, 3);
  for (let i = 0; i < n && room(); i += 1) {
    const x = rng.range(31, 48);
    const z = rng.range(-2, -38);
    tree(ctx, rng.weighted<TreeKind>([
      ['far', 5],
      ['cypress', 1.2],
      ['fir', 1.2],
      ['farPink', kind === 'blossom' ? 3 : 1],
    ]), s * x, z, rng.range(1.0, 1.35));
  }
  for (let i = 0; i < 4 && room(); i += 1) farBushAt(ctx, s * rng.range(30, 46), rng.range(-2, -38), rng.range(1.1, 1.6));
}

// ---------------------------------------------------------------------------
// Chunk
// ---------------------------------------------------------------------------

function sideKinds(arch: Archetype, rng: Rng): [SideKind, SideKind] {
  switch (arch) {
    case 'cottage':
      return ['cottages', 'cottages'];
    case 'blossom':
      return ['blossom', 'blossom'];
    case 'market':
      return rng.chance(0.5) ? ['market', 'cottages'] : ['cottages', 'market'];
    case 'park':
      return rng.chance(0.5) ? ['park', 'cottages'] : ['cottages', 'park'];
    case 'towers':
      return ['towers', 'towers'];
    case 'garden':
      return rng.chance(0.5) ? ['garden', 'cottages'] : ['cottages', 'garden'];
  }
}

/** Debug: triangle accounting per category (filled when `townStats` is set). */
export const townStats: { enabled: boolean; tris: Record<string, number> } = { enabled: false, tris: {} };
function measure<T>(ctx: Ctx, tag: string, fn: () => T): T {
  if (!townStats.enabled) return fn();
  const t0 = ctx.b.triangles();
  const out = fn();
  townStats.tris[tag] = (townStats.tris[tag] ?? 0) + (ctx.b.triangles() - t0);
  return out;
}

/** Build one street chunk. Deterministic for (index, seed, opts). */
export function buildTownChunk(index: number, seed: number, opts: TownChunkOptions = {}): TownChunk {
  const arch = archetypeFor(index, seed);
  const rng = makeRng(hashInts(seed, index, 0x51de));
  const b = new Bins();
  const farBins = new Bins();
  const plan: GroundPlan = { index, seed, plazas: [], blobs: [] };
  const ctx: Ctx = { b, far: farBins, rng, plan, index, arch, keep: { [-1]: [], [1]: [] }, verge: { [-1]: [], [1]: [] }, frontCap: Infinity, rich: 1 };
  const clear: Record<Side, boolean> = { [-1]: !!opts.clearLeft, [1]: !!opts.clearRight };
  const kinds = sideKinds(arch, rng);
  const kindOf = (s: Side): SideKind => (s < 0 ? kinds[0] : kinds[1]);

  addEdging(b);

  // Road-spanning showpieces first so the verge keeps their footprint free.
  const showpieces = !clear[-1] && !clear[1];
  if (showpieces && arch === 'blossom') {
    const z = -20 + rng.range(-3, 3);
    ctx.b.stamp(roseArch(6.55, rng.int(0, 2)), { p: [0, LAWN_Y, z] });
    for (const s of [-1, 1] as Side[]) ctx.keep[s].push(z);
  }
  if (showpieces && arch === 'towers') {
    for (const z of [-11, -29]) {
      const zz = z + rng.range(-1.5, 1.5);
      for (const s of [-1, 1] as Side[]) {
        put(ctx, buntingPole(rng.pick(LOOK.stripes)), s * 6.55, zz, 0, 1, undefined, LAWN_Y);
        ctx.keep[s].push(zz);
      }
      bunting(b, [-6.55, 6.85, zz], [6.55, 6.85, zz], 0.75, rng.shuffle([...LOOK.stripes, '#ffffff']), `road:${zz.toFixed(2)}`);
    }
  }
  if (showpieces && arch === 'market') {
    const zz = -14 + rng.range(-2, 2);
    for (const s of [-1, 1] as Side[]) {
      put(ctx, buntingPole(rng.pick(LOOK.stripes)), s * 6.55, zz, 0, 1, undefined, LAWN_Y);
      ctx.keep[s].push(zz);
    }
    bunting(b, [-6.55, 6.85, zz], [6.55, 6.85, zz], 0.8, rng.shuffle([...LOOK.stripes, '#ffffff']), `road:${zz.toFixed(2)}`);
  }

  // Street-facing content first (both sides), then the back rows and meadow
  // share whatever triangle budget is left, split evenly between the sides.
  const sides = ([-1, 1] as Side[]).filter((s) => !clear[s]);
  const sctx = new Map<Side, Ctx>();
  for (const s of sides) sctx.set(s, { ...ctx, rng: rng.fork(s < 0 ? 101 : 202) });
  const frontBudget = CHUNK_BUDGET - GROUND_EST - VERGE_RESERVE - REAR_RESERVE;
  const frontBase = b.triangles();
  sides.forEach((s, i) => {
    sctx.get(s)!.frontCap = frontBase + ((frontBudget - frontBase) * (i + 1)) / sides.length;
  });
  for (const s of sides) {
    const c = sctx.get(s)!;
    const kind = kindOf(s);
    if (kind === 'market') measure(c, 'market', () => marketSide(c, s));
    else if (kind === 'park') measure(c, 'park', () => parkSide(c, s));
    else measure(c, 'frontRow', () => frontRow(c, s, kind));
  }
  for (const s of sides) {
    const c = sctx.get(s)!;
    measure(c, 'verge', () => verge(c, s, kindOf(s)));
  }
  // Plazas are final now, so the ground's exact cost is known.
  const budget = CHUNK_BUDGET - groundTriangles(plan);
  let base = b.triangles();
  sides.forEach((s, i) => {
    const c = sctx.get(s)!;
    const cap = base + (budget - base) * 0.3 * ((i + 1) / sides.length);
    measure(c, 'treeLine', () => treeLine(c, s, cap, CHUNK_HARD_CAP - (CHUNK_BUDGET - budget)));
  });
  base = b.triangles();
  sides.forEach((s, i) => {
    const c = sctx.get(s)!;
    const kind = kindOf(s);
    if (kind === 'market' || kind === 'park') return;
    const cap = base + (budget - base) * 0.45 * ((i + 1) / sides.length);
    measure(c, 'backRow', () => backRow(c, s, kind, cap));
  });
  base = b.triangles();
  sides.forEach((s, i) => {
    const c = sctx.get(s)!;
    const cap = base + (budget - base) * ((i + 1) / sides.length);
    measure(c, 'lawn', () => lawn(c, s, kindOf(s), cap));
  });

  const ground = new THREE.Mesh(buildGroundGeometry(plan), groundMaterial());
  ground.name = 'town-ground';
  ground.receiveShadow = true;
  ground.castShadow = false;

  const group = new THREE.Group();
  group.name = `town-chunk-${index}`;
  group.userData.archetype = arch;
  group.userData.plazas = plan.plazas;
  group.add(ground);
  for (const m of b.meshes('town')) group.add(m);
  group.position.z = -index * CHUNK_LENGTH;

  farStrip(farBins, 'town', LAWN_OUT);
  const far = new THREE.Group();
  far.name = `town-far-${index}`;
  for (const m of farBins.meshes('town-far')) {
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
