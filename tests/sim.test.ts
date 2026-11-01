import { describe, expect, it } from 'vitest';
import { FOOTPRINTS, TUNING, levelSpec, starsFor } from '../src/game/sim/config';
import { generateLevel, obstacleX } from '../src/game/sim/level';
import { areaAt } from '../src/game/sim/route';
import { Sim } from '../src/game/sim/Sim';

const LEVELS = [1, 2, 3, 4, 5, 6, 8, 12];
const DT = 1 / 60;

/** A tidy "perfect" driver: steer toward the next uncollected coin ahead. */
function coinChaser(sim: Sim): void {
  const car = sim.car;
  let best: { x: number; z: number } | null = null;
  for (const c of sim.coins) {
    if (!c.alive || c.z > car.z + 0.5 || c.z < car.z - 26) continue;
    if (!best || c.z > best.z) best = c;
  }
  sim.setTargetX(best ? best.x : 0);
}

function run(sim: Sim, driver: (sim: Sim) => void, maxSeconds = 240): void {
  sim.start();
  const steps = Math.round(maxSeconds / DT);
  for (let i = 0; i < steps && sim.phase !== 'done'; i += 1) {
    driver(sim);
    sim.step(DT);
  }
}

describe('level generation', () => {
  it.each(LEVELS)('level %i is deterministic', (level) => {
    expect(generateLevel(level)).toEqual(generateLevel(level));
  });

  it.each(LEVELS)('level %i has plenty of coins inside the road', (level) => {
    const data = generateLevel(level);
    const coins = data.coins.filter((c) => c.kind === 'coin');
    expect(coins.length).toBeGreaterThanOrEqual(60);
    expect(data.coins.some((c) => c.kind === 'gem')).toBe(true);
    for (const c of data.coins) {
      expect(Math.abs(c.x)).toBeLessThanOrEqual(TUNING.driveHalf);
      expect(c.z).toBeLessThan(-20);
      expect(c.z).toBeGreaterThan(-data.length);
    }
  });

  it.each(LEVELS)('level %i coin trails stay steerable', (level) => {
    const data = generateLevel(level);
    const sorted = [...data.coins].sort((a, b) => b.z - a.z);
    for (let i = 1; i < sorted.length; i += 1) {
      const dz = sorted[i - 1].z - sorted[i].z;
      if (dz > 9) continue; // separate patterns, the driver has time
      const dx = Math.abs(sorted[i].x - sorted[i - 1].x);
      // Allow lane-change trails up to the slope limit (+ small tolerance for eased curves).
      expect(dx / Math.max(dz, 0.01)).toBeLessThanOrEqual(TUNING.maxTrailSlope * 1.6 + 0.05);
    }
  });

  it.each(LEVELS)('level %i obstacles never wall off the road', (level) => {
    const data = generateLevel(level);
    for (const o of data.obstacles) {
      // Collect every obstacle overlapping this one in z, at the worst sway position.
      const nearby = data.obstacles.filter(
        (p) => Math.abs(p.z - o.z) < FOOTPRINTS[p.kind].halfDepth + FOOTPRINTS[o.kind].halfDepth + TUNING.carHalfLength * 2,
      );
      const blocked: Array<[number, number]> = nearby
        .filter((p) => p.kind !== 'puddle')
        .map((p) => {
          const half = FOOTPRINTS[p.kind].halfWidth + TUNING.carHalfWidth + (p.sway?.amp ?? 0);
          return [p.x - half, p.x + half];
        });
      // Find a free interval for the car center inside ±driveHalf.
      const samples = 200;
      let free = 0;
      for (let i = 0; i <= samples; i += 1) {
        const x = -TUNING.driveHalf + (i / samples) * TUNING.driveHalf * 2;
        if (blocked.every(([a, b]) => x < a || x > b)) free += 1;
      }
      expect(free / samples).toBeGreaterThan(0.12);
    }
  });

  it.each(LEVELS)('level %i keeps the start and the castle approach clear', (level) => {
    const data = generateLevel(level);
    for (const o of data.obstacles) {
      expect(o.z).toBeLessThan(-40);
      expect(o.z).toBeGreaterThan(-data.length + 45);
    }
  });

  it('coins never sit on a solid obstacle', () => {
    for (const level of LEVELS) {
      const data = generateLevel(level);
      for (const o of data.obstacles.filter((p) => p.kind !== 'puddle')) {
        const fp = FOOTPRINTS[o.kind];
        for (const c of data.coins) {
          const dx = Math.abs(c.x - o.x);
          const dz = Math.abs(c.z - o.z);
          expect(dx > fp.halfWidth + (o.sway?.amp ?? 0) || dz > fp.halfDepth + 1).toBe(true);
        }
      }
    }
  });
});

describe('simulation', () => {
  it.each(LEVELS)('a coin-chasing driver finishes level %i with 3 stars and no bumps', (level) => {
    const sim = new Sim(generateLevel(level));
    run(sim, coinChaser);
    expect(sim.phase).toBe('done');
    expect(sim.collected / sim.totalCoins).toBeGreaterThan(0.85);
    expect(sim.stars).toBe(3);
    expect(sim.bumps).toBeLessThanOrEqual(1);
  });

  it.each(LEVELS)('a child who never steers still reaches the castle on level %i', (level) => {
    const sim = new Sim(generateLevel(level));
    run(sim, () => {});
    expect(sim.phase).toBe('done');
    expect(sim.stars).toBeGreaterThanOrEqual(1);
    expect(sim.car.z).toBeLessThan(-sim.level.length);
  });

  it('a random wiggler always finishes (never soft-locks)', () => {
    for (const level of LEVELS) {
      const sim = new Sim(generateLevel(level));
      let t = 0;
      run(sim, (s) => {
        t += DT;
        s.setTargetX(Math.sin(t * 1.7) * 3.1 * Math.sin(t * 0.37));
      });
      expect(sim.phase).toBe('done');
    }
  });

  it('bumps knock coins loose, and they can be caught again', () => {
    const data = generateLevel(1);
    const sim = new Sim(data);
    sim.start();
    // Drive straight into the first solid obstacle after collecting some coins.
    const target = data.obstacles.find((o) => o.kind !== 'puddle');
    expect(target).toBeDefined();
    let bumped = false;
    let lost = 0;
    for (let i = 0; i < 60 * 120 && sim.phase === 'drive'; i += 1) {
      const aheadOfTarget = sim.car.z > target!.z + 1;
      if (aheadOfTarget) {
        if (sim.car.z > target!.z + 25) coinChaser(sim);
        else sim.setTargetX(obstacleX(target!, sim.time));
      } else coinChaser(sim);
      sim.step(DT);
      for (const e of sim.events.splice(0)) {
        if (e.type === 'bump') {
          bumped = true;
          lost = e.lost;
        }
      }
    }
    expect(bumped).toBe(true);
    expect(lost).toBeGreaterThan(0);
    const bonus = sim.coins.filter((c) => c.bonus);
    expect(bonus.length).toBe(lost);
    // The chaser grabs most of them back.
    expect(bonus.filter((c) => !c.alive).length).toBeGreaterThanOrEqual(1);
  });

  it('stops smoothly past the finish line', () => {
    const sim = new Sim(generateLevel(2));
    const events: string[] = [];
    run(sim, (s) => {
      coinChaser(s);
      for (const e of s.events.splice(0)) events.push(e.type);
    });
    expect(events).toContain('finish');
    expect(sim.car.z).toBeLessThanOrEqual(-sim.level.length);
    expect(sim.car.z).toBeGreaterThan(-sim.level.length - TUNING.finishRunout - 1);
    expect(sim.car.speed).toBe(0);
  });

  it('awards stars generously', () => {
    expect(starsFor(0, 100)).toBe(1);
    expect(starsFor(55, 100)).toBe(2);
    expect(starsFor(85, 100)).toBe(3);
    expect(levelSpec(1).length).toBeLessThan(levelSpec(8).length);
  });
});

describe('the road changes the drive', () => {
  it.each(LEVELS)('level %i has humps, and coins float up over them', (level) => {
    const data = generateLevel(level);
    expect(data.track.hops.length).toBeGreaterThanOrEqual(3);
    for (const hump of data.track.hops) {
      const over = data.coins.filter((c) => Math.abs(-c.z - hump) < 1.6);
      for (const c of over) expect(c.y!).toBeGreaterThan(TUNING.coinHover + 0.5);
    }
  });

  it.each(LEVELS)('level %i keeps obstacles off humps and tight bends', (level) => {
    const data = generateLevel(level);
    for (const o of data.obstacles) {
      for (const hump of data.track.hops) expect(Math.abs(-o.z - hump)).toBeGreaterThan(5);
    }
    const tight = data.obstacles.filter((o) => Math.abs(data.track.sample(-o.z).curvature) > 0.0095);
    expect(tight.length).toBeLessThanOrEqual(1);
  });

  it.each(LEVELS)('level %i coin lines hug the inside of strong bends', (level) => {
    const data = generateLevel(level);
    let inside = 0;
    let total = 0;
    for (const c of data.coins) {
      const bend = data.track.sample(-c.z).curvature;
      if (Math.abs(bend) < 0.007) continue;
      total += 1;
      if (c.x * Math.sign(bend) > 0) inside += 1;
    }
    expect(total).toBeGreaterThan(5);
    expect(inside / total).toBeGreaterThan(0.5);
  });

  it.each(LEVELS)('level %i meets the animals of each area', (level) => {
    const data = generateLevel(level);
    const kinds = (area: string) => new Set(data.obstacles.filter((o) => areaAt(data.track.route, -o.z) === area).map((o) => o.kind));
    expect(kinds('meadow').has('sheep')).toBe(true);
    expect(kinds('forest').has('mushrooms')).toBe(true);
    expect(kinds('lake').has('ducks')).toBe(true);
    expect(kinds('forest').has('sheep')).toBe(false);
    expect(kinds('meadow').has('mushrooms')).toBe(false);
  });

  it('swoops downhill and eases uphill, without ever stalling', () => {
    const data = generateLevel(1);
    const sim = new Sim(data);
    sim.start();
    let fastest = 0;
    let slowest = Infinity;
    for (let i = 0; i < 60 * 240 && sim.phase === 'drive'; i += 1) {
      coinChaser(sim);
      sim.step(DT);
      if (sim.time < 4) continue;
      fastest = Math.max(fastest, sim.car.speed);
      slowest = Math.min(slowest, sim.car.speed);
    }
    expect(fastest).toBeGreaterThan(data.speed * 1.1);
    expect(slowest).toBeLessThan(data.speed * 0.97);
    expect(slowest).toBeGreaterThan(data.speed * 0.8);
  });

  it('announces hops, landings and every area exactly once, in order', () => {
    const data = generateLevel(3);
    const sim = new Sim(data);
    sim.start();
    const seen: string[] = [];
    for (let i = 0; i < 60 * 240 && sim.phase !== 'done'; i += 1) {
      sim.step(DT);
      for (const e of sim.events.splice(0)) {
        if (e.type === 'hop' || e.type === 'land') seen.push(e.type);
        if (e.type === 'area') seen.push(e.area);
      }
    }
    expect(seen.filter((e) => e === 'hop').length).toBe(data.track.hops.length);
    expect(seen.filter((e) => e === 'land').length).toBe(data.track.hops.length);
    expect(seen.filter((e) => e !== 'hop' && e !== 'land')).toEqual(data.track.route.slice(1).map((r) => r.area));
  });

  it('a warp skips the hops and areas it jumps over', () => {
    const data = generateLevel(1);
    const sim = new Sim(data);
    sim.start();
    sim.warpTo(700);
    sim.step(DT);
    expect(sim.events.filter((e) => e.type === 'area' || e.type === 'hop')).toEqual([]);
    expect(sim.car.hop).toBe(0);
  });

  it('hopping changes nothing but the view: a run still collects coins and finishes', () => {
    const sim = new Sim(generateLevel(1));
    run(sim, coinChaser);
    expect(sim.phase).toBe('done');
    expect(sim.car.hop).toBe(0);
  });
});
