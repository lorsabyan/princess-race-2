/**
 * Deterministic randomness for the town composer. Every chunk derives its own
 * stream from (index, seed), and sub-systems fork further streams so adding a
 * prop in one place never reshuffles the rest of the street.
 */

export interface Rng {
  (): number;
  range(a: number, b: number): number;
  int(a: number, b: number): number;
  pick<T>(items: readonly T[]): T;
  weighted<T>(items: ReadonlyArray<readonly [T, number]>): T;
  chance(p: number): boolean;
  sign(): 1 | -1;
  shuffle<T>(items: T[]): T[];
  fork(salt: number): Rng;
}

/** 32-bit integer hash of a list of numbers (order sensitive). */
export function hashInts(...values: number[]): number {
  let h = 0x811c9dc5 ^ values.length;
  for (const value of values) {
    let v = Math.floor(value) | 0;
    v = Math.imul(v ^ (v >>> 16), 0x7feb352d);
    v = Math.imul(v ^ (v >>> 15), 0x846ca68b);
    v ^= v >>> 16;
    h = Math.imul(h ^ v, 0x01000193);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

export function makeRng(seed: number): Rng {
  let s = seed >>> 0 || 0x9e3779b9;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = next as Rng;
  rng.range = (a, b) => a + (b - a) * next();
  rng.int = (a, b) => a + Math.floor(next() * (b - a + 1));
  rng.pick = (items) => items[Math.floor(next() * items.length) % items.length];
  rng.weighted = (items) => {
    let total = 0;
    for (const [, w] of items) total += w;
    let r = next() * total;
    for (const [item, w] of items) {
      r -= w;
      if (r <= 0) return item;
    }
    return items[items.length - 1][0];
  };
  rng.chance = (p) => next() < p;
  rng.sign = () => (next() < 0.5 ? -1 : 1);
  rng.shuffle = (items) => {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  };
  rng.fork = (salt) => makeRng(hashInts(s, salt));
  return rng;
}

/** Smooth 1D value noise in [0, 1], used for lawn tint and gentle terrain. */
export function noise1(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash01(i, seed);
  const b = hash01(i + 1, seed);
  const u = f * f * (3 - 2 * f);
  return a + (b - a) * u;
}

export function hash01(a: number, b = 0, c = 0): number {
  return hashInts(a, b, c) / 4294967296;
}

/** Smooth 2D value noise in [0, 1]. */
export function noise2(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash01(xi, yi, seed);
  const b = hash01(xi + 1, yi, seed);
  const c = hash01(xi, yi + 1, seed);
  const d = hash01(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/**
 * 2D value noise that repeats every `period` cells along y. Chunk-local ground
 * detail uses this so any chunk can follow any other without a seam.
 */
export function noise2Periodic(x: number, y: number, period: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const y0 = ((yi % period) + period) % period;
  const y1 = (y0 + 1) % period;
  const a = hash01(xi, y0, seed);
  const b = hash01(xi + 1, y0, seed);
  const c = hash01(xi, y1, seed);
  const d = hash01(xi + 1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
