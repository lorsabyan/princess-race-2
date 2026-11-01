import { FOOTPRINTS, TUNING, levelSpec, type ObstacleKind } from './config';
import { chance, mulberry32, pick, range, type Rng } from './rng';
import { areaAt, buildRoute, type Area } from './route';
import { Track } from './track';

export interface CoinSpawn {
  id: number;
  x: number;
  z: number;
  kind: 'coin' | 'gem';
  /** Height above the road (default TUNING.coinHover); coins over humps float higher. */
  y?: number;
}

export interface ObstacleSpawn {
  id: number;
  kind: ObstacleKind;
  x: number;
  z: number;
  /** Ducks wander across the road: x(t) = x + amp * sin(speed * t + phase). */
  sway?: { amp: number; speed: number; phase: number };
}

export interface LevelData {
  level: number;
  seed: number;
  length: number;
  speed: number;
  coins: CoinSpawn[];
  obstacles: ObstacleSpawn[];
  /** The real road this level is driven on. */
  track: Track;
}

/** Bends stronger than this get a coin line that hugs the inside. */
const STRONG_BEND = 0.0036;
/** Obstacles stay off bends tighter than this, so little drivers see them coming. */
const TIGHT_BEND = 0.0092;
/** How far around a hump stays free of obstacles, and how far coins rise over one. */
const HUMP_CLEAR = 24;
const HUMP_ARC = 6.5;

/** What each area is known for. */
const SIGNATURE: Partial<Record<Area, ObstacleKind>> = { meadow: 'sheep', forest: 'mushrooms', lake: 'ducks' };

const LANES = [-2.3, 0, 2.3];
const COIN_GAP = 3.0;
const START_CLEAR = 42;
const FINISH_CLEAR = 60;

interface Cursor {
  z: number;
  /** x of the last coin placed (to keep trails smoothly connected). */
  x: number;
}

/**
 * Builds a level from short hand-designed patterns (coin trails, dodges, duck
 * crossings, splashy puddles). Every pattern keeps coin trails within the
 * steering slope limit and leaves a wide free corridor around obstacles.
 */
export function generateLevel(level: number, seedOverride?: number): LevelData {
  const spec = levelSpec(level);
  const seed = seedOverride ?? spec.seed;
  const rng = mulberry32(seed);
  const route = buildRoute(spec.level, spec.length);
  const track = new Track(spec.length, route, seed);
  const bendAt = (z: number) => track.sample(-z).curvature;
  const nearHump = (z: number) => track.hops.some((h) => Math.abs(h + z) < HUMP_CLEAR);
  const coins: CoinSpawn[] = [];
  const obstacles: ObstacleSpawn[] = [];
  const cursor: Cursor = { z: -START_CLEAR, x: 0 };
  const endZ = -(spec.length - FINISH_CLEAR);
  let lastObstacleZ = cursor.z + 10;
  let gemsLeft = spec.gems;
  let gemEvery = (spec.length - START_CLEAR - FINISH_CLEAR) / (spec.gems + 1);
  let nextGemZ = cursor.z - gemEvery;

  const addCoin = (x: number, z: number, kind: CoinSpawn['kind'] = 'coin') => {
    coins.push({ id: coins.length, x: clampX(x), z, kind });
  };
  const addObstacle = (kind: ObstacleKind, x: number, z: number, sway?: ObstacleSpawn['sway']) => {
    obstacles.push({ id: obstacles.length, kind, x, z, sway });
    lastObstacleZ = z;
  };

  /** Move the cursor to x with a smooth diagonal trail of coins if the lane changes. */
  const travelTo = (x: number, withCoins: boolean) => {
    const dx = x - cursor.x;
    const dist = Math.max(COIN_GAP * 2, Math.abs(dx) / TUNING.maxTrailSlope);
    const steps = Math.max(1, Math.round(dist / COIN_GAP));
    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const eased = t * t * (3 - 2 * t);
      const z = cursor.z - t * dist;
      if (withCoins) addCoin(cursor.x + dx * eased, z);
    }
    cursor.z -= dist;
    cursor.x = x;
  };

  const line = (x: number, count: number) => {
    travelTo(x, false);
    for (let i = 0; i < count; i += 1) {
      cursor.z -= COIN_GAP;
      addCoin(x, cursor.z);
    }
  };

  const slalom = (count: number, amp: number) => {
    const center = pick(rng, [-0.8, 0, 0.8]);
    travelTo(center, false);
    const wavelength = Math.max(18, (Math.PI * 2 * amp) / TUNING.maxTrailSlope);
    const startZ = cursor.z;
    for (let i = 1; i <= count; i += 1) {
      const z = startZ - i * COIN_GAP;
      const x = center + Math.sin(((startZ - z) / wavelength) * Math.PI * 2) * amp;
      addCoin(x, z);
      cursor.z = z;
      cursor.x = x;
    }
  };

  /** Coin line through a bend: wide on the way in, hugging the inside, wide on the way out. */
  const sweep = (side: number) => {
    travelTo(-side * 1.3, true);
    const count = 13 + Math.floor(rng() * 6);
    const startZ = cursor.z;
    for (let i = 1; i <= count; i += 1) {
      const z = startZ - i * COIN_GAP;
      const x = side * (-1.3 + 3.5 * Math.sin((i / count) * Math.PI));
      addCoin(x, z);
      cursor.z = z;
      cursor.x = x;
    }
  };

  const gap = (length: number) => {
    cursor.z -= length;
  };

  const obstacleDodge = (kinds: readonly ObstacleKind[]) => {
    const kind = pick(rng, kinds);
    const ox = pick(rng, LANES);
    const lanes = LANES.filter((l) => Math.abs(l - ox) > 2);
    const lane = lanes.length ? pick(rng, lanes) : ox > 0 ? -2.3 : 2.3;
    travelTo(lane, true);
    const oz = cursor.z - COIN_GAP * 3;
    for (let i = 0; i < 6; i += 1) {
      cursor.z -= COIN_GAP;
      addCoin(lane, cursor.z);
    }
    addObstacle(kind, ox, oz);
  };

  const gate = (kind: ObstacleKind) => {
    // Two clusters with an inviting coin-filled gap between them.
    const gapX = pick(rng, [-1.4, 0, 1.4]);
    travelTo(gapX, true);
    const oz = cursor.z - COIN_GAP * 2.5;
    const left = gapX - 3.0;
    const right = gapX + 3.0;
    if (left >= -3.6) addObstacle(kind, Math.max(-3.2, left), oz);
    if (right <= 3.6) addObstacle(kind, Math.min(3.2, right), oz);
    for (let i = 0; i < 5; i += 1) {
      cursor.z -= COIN_GAP;
      addCoin(gapX, cursor.z);
    }
  };

  /** Ducks or sheep wander across the road. */
  const crossing = (kind: ObstacleKind) => {
    const side = chance(rng, 0.5) ? -1 : 1;
    const lane = side * 2.5;
    travelTo(lane, true);
    const oz = cursor.z - COIN_GAP * 3;
    addObstacle(kind, -side * 0.6, oz, { amp: 0.8, speed: 0.55, phase: range(rng, 0, Math.PI * 2) });
    for (let i = 0; i < 6; i += 1) {
      cursor.z -= COIN_GAP;
      addCoin(lane, cursor.z);
    }
  };

  const puddleSplash = () => {
    const x = pick(rng, LANES);
    travelTo(x, true);
    const oz = cursor.z - COIN_GAP * 2;
    addObstacle('puddle', x, oz);
    for (let i = 0; i < 5; i += 1) {
      cursor.z -= COIN_GAP;
      addCoin(x, cursor.z);
    }
  };

  const gemReward = () => {
    // A little arc of coins with the heart gem at its peak.
    const from = cursor.x;
    const to = from > 0 ? -1.6 : 1.6;
    travelTo(to, true);
    cursor.z -= COIN_GAP * 1.5;
    addCoin(to, cursor.z, 'gem');
    gemsLeft -= 1;
    nextGemZ = cursor.z - gemEvery;
  };

  gemEvery = Math.max(120, gemEvery);

  // Obstacle "decks": each area deals its own varied mix.
  const cardsFor = (area: Area): Array<() => void> => {
    switch (area) {
      case 'meadow':
        return [() => crossing('sheep'), puddleSplash, () => obstacleDodge(['cart']), () => crossing('sheep')];
      case 'forest':
        return [() => obstacleDodge(['mushrooms']), () => gate('mushrooms'), puddleSplash, () => obstacleDodge(['mushrooms'])];
      case 'lake':
        return [() => crossing('ducks'), puddleSplash, () => crossing('ducks'), () => gate('cones')];
      case 'castle':
        return [() => gate('cones'), () => obstacleDodge(['cart', 'cones']), () => crossing('ducks')];
      default:
        return [() => crossing('ducks'), () => obstacleDodge(['cones', 'cones', 'cart']), puddleSplash, () => gate('cones'), () => crossing('ducks'), () => obstacleDodge(['cones', 'cones', 'cart'])];
    }
  };
  const decks = new Map<Area, Array<() => void>>();
  const seen = new Set<Area>();
  const nextCard = () => {
    const area = areaAt(route, 6 - cursor.z);
    let deck = decks.get(area);
    if (!deck || deck.length === 0) {
      deck = cardsFor(area);
      for (let i = deck.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      // The first card in an area is always its signature, so nobody misses the sheep.
      if (!seen.has(area)) {
        seen.add(area);
        const signature = SIGNATURE[area];
        if (signature) deck.unshift(signature === 'sheep' || signature === 'ducks' ? () => crossing(signature) : () => obstacleDodge([signature]));
      }
      decks.set(area, deck);
    }
    deck.shift()!();
  };

  // Opening: a friendly straight line right where she starts.
  line(0, 6);

  while (cursor.z > endZ + 20) {
    const sinceObstacle = lastObstacleZ - cursor.z;
    const bend = bendAt(cursor.z - 20);
    // Obstacles land 8-30 m ahead of the cursor, and must stay inside one area.
    const area = areaAt(route, 6 - cursor.z);
    const open = Math.abs(bend) < TIGHT_BEND && !nearHump(cursor.z - 12) && area === areaAt(route, 34 - cursor.z);
    // A new area shows off its signature as soon as the road allows.
    const fresh = !seen.has(area) && SIGNATURE[area] !== undefined && sinceObstacle > 26;
    if (gemsLeft > 0 && cursor.z < nextGemZ) {
      gemReward();
    } else if (open && (fresh || sinceObstacle > spec.obstacleSpacing * range(rng, 0.75, 1.1))) {
      nextCard();
    } else if (Math.abs(bend) > STRONG_BEND) {
      sweep(Math.sign(bend));
    } else {
      const roll = rng();
      if (roll < 0.45) line(pick(rng, LANES), 5 + Math.floor(rng() * 4));
      else if (roll < 0.8) slalom(9 + Math.floor(rng() * 5), range(rng, 1.4, 2.3));
      else travelTo(pick(rng, LANES), true);
    }
    gap(range(rng, 5, 9));
  }

  // Royal carpet: a straight line of coins leading into the castle gate.
  travelTo(0, true);
  while (cursor.z > -(spec.length - 8)) {
    cursor.z -= COIN_GAP;
    addCoin(0, cursor.z);
  }

  const cleaned = removeBlockedCoins(coins, obstacles).filter((c) => c.z < -START_CLEAR + 12 && c.z > -spec.length + 4);
  cleaned.forEach((c, i) => {
    c.id = i;
    for (const hump of track.hops) {
      const d = -c.z - hump;
      if (Math.abs(d) < HUMP_ARC) c.y = TUNING.coinHover + 0.85 * Math.cos((d / HUMP_ARC) * (Math.PI / 2)) ** 2;
    }
  });
  return { level: spec.level, seed, length: spec.length, speed: spec.speed, coins: cleaned, obstacles, track };
}

function clampX(x: number): number {
  return Math.max(-2.9, Math.min(2.9, x));
}

/** Drop coins that would sit on or right behind an obstacle (puddles are fine to splash through). */
function removeBlockedCoins(coins: CoinSpawn[], obstacles: ObstacleSpawn[]): CoinSpawn[] {
  return coins.filter((coin) =>
    obstacles.every((o) => {
      if (o.kind === 'puddle') return true;
      const fp = FOOTPRINTS[o.kind];
      const reach = fp.halfWidth + (o.sway?.amp ?? 0) + 1.2;
      const depth = fp.halfDepth + 2.2;
      return Math.abs(coin.x - o.x) > reach || Math.abs(coin.z - o.z) > depth;
    }),
  );
}

/** Obstacle x at time t (ducks wander). */
export function obstacleX(o: ObstacleSpawn, time: number): number {
  if (!o.sway) return o.x;
  return o.x + o.sway.amp * Math.sin(o.sway.speed * time + o.sway.phase);
}

export type { Rng };
