/** Gameplay tuning. Units are world units (~meters) and seconds. */
export const TUNING = {
  /** Paved road half width. */
  roadHalf: 4.3,
  /** The car's center stays within ±driveHalf. */
  driveHalf: 3.1,
  /** Collision footprint of the car (slightly smaller than the visual for forgiveness). */
  carHalfWidth: 0.82,
  carHalfLength: 1.45,
  /** Coins float at this height. */
  coinHover: 1.0,
  /** Generous pickup box around the car. */
  pickupHalfWidth: 1.45,
  pickupHalfLength: 1.9,
  /** Critically damped steering spring (rad/s). Higher = snappier. */
  steerOmega: 9,
  /** Acceleration toward cruise speed. */
  accel: 5.5,
  /** Fraction of speed lost right after a bump, recovered over bumpRecover seconds. */
  bumpSlow: 0.5,
  bumpRecover: 1.5,
  /** Seconds of invulnerability after a bump. */
  invulnerable: 1.6,
  /** Most coins a single bump can knock loose (they fly ahead and can be caught again). */
  bumpCoinLoss: 3,
  /** Distance past the finish line where the car rolls to a stop. */
  finishRunout: 18,
  /** Max lateral slope (dx/dz) of coin trails, so a toddler's steering can follow them. */
  maxTrailSlope: 0.34,
  /** Two coins picked within this many seconds continue a combo. */
  comboWindow: 0.9,
} as const;

export type ObstacleKind = 'cones' | 'ducks' | 'cart' | 'puddle';

/** Collision half extents (x, z) per obstacle kind. Puddles splash instead of bumping. */
export const FOOTPRINTS: Record<ObstacleKind, { halfWidth: number; halfDepth: number }> = {
  cones: { halfWidth: 1.0, halfDepth: 0.5 },
  ducks: { halfWidth: 0.9, halfDepth: 0.5 },
  cart: { halfWidth: 1.1, halfDepth: 0.8 },
  puddle: { halfWidth: 1.2, halfDepth: 1.0 },
};

export interface LevelSpec {
  level: number;
  seed: number;
  length: number;
  speed: number;
  /** Average distance between obstacles. */
  obstacleSpacing: number;
  gems: number;
}

export function levelSpec(level: number): LevelSpec {
  const n = Math.max(1, Math.floor(level));
  const step = Math.min(n - 1, 7);
  return {
    level: n,
    seed: 1000 + n * 7919,
    length: 600 + step * 40,
    speed: 10.5 + step * 0.4,
    obstacleSpacing: Math.max(44, 78 - step * 5),
    gems: n === 1 ? 1 : 2,
  };
}

/** 1–3 stars. Finishing always earns at least one. */
export function starsFor(collected: number, total: number): number {
  const ratio = total > 0 ? collected / total : 1;
  if (ratio >= 0.85) return 3;
  if (ratio >= 0.55) return 2;
  return 1;
}
