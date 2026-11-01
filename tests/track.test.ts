import { describe, expect, it } from 'vitest';
import { CHUNK_METERS, levelSpec } from '../src/game/sim/config';
import { Landscape, WATER_Y } from '../src/game/sim/landscape';
import { areaAt, buildRoute, type Area } from '../src/game/sim/route';
import { FINISH_STRAIGHT, MIN_RADIUS, START_STRAIGHT, Track, bendLateral, newRoadPoint } from '../src/game/sim/track';

const LEVELS = [1, 2, 3, 4, 5, 6, 8, 12];

function trackFor(level: number): Track {
  const spec = levelSpec(level);
  return new Track(spec.length, buildRoute(level, spec.length), spec.seed);
}

describe('route', () => {
  it.each(LEVELS)('level %i visits every area, town first and castle last', (level) => {
    const spec = levelSpec(level);
    const route = buildRoute(level, spec.length);
    expect(route[0].area).toBe('town');
    expect(route[route.length - 1].area).toBe('castle');
    expect(new Set(route.map((r) => r.area)).size).toBe(5);
  });

  it.each(LEVELS)('level %i areas sit on chunk edges and are long enough to enjoy', (level) => {
    const spec = levelSpec(level);
    const route = buildRoute(level, spec.length);
    for (let i = 1; i < route.length; i += 1) {
      expect(route[i].from % CHUNK_METERS).toBe(0);
      expect(route[i].from).toBe(route[i - 1].to);
      if (i < route.length - 1) expect(route[i].to - route[i].from).toBeGreaterThanOrEqual(120);
    }
  });

  it('levels do not all follow the same order', () => {
    const orders = new Set([1, 2, 3, 4].map((l) => buildRoute(l, 960).map((r) => r.area).join()));
    expect(orders.size).toBeGreaterThan(1);
  });
});

describe('track', () => {
  it.each(LEVELS)('level %i is deterministic', (level) => {
    const a = trackFor(level);
    const b = trackFor(level);
    expect(a.sample(500)).toEqual(b.sample(500));
  });

  it.each(LEVELS)('level %i starts on the home street and ends level at the castle', (level) => {
    const t = trackFor(level);
    for (const s of [-150, -40, 0, 40, START_STRAIGHT]) {
      const p = t.sample(s);
      expect(p.x).toBeCloseTo(0, 3);
      expect(p.y).toBeCloseTo(0, 3);
      expect(p.z).toBeCloseTo(-s, 3);
      expect(p.heading).toBeCloseTo(0, 3);
    }
    const line = t.sample(t.length - FINISH_STRAIGHT + 12);
    for (const s of [t.length - 60, t.length, t.length + 60, t.length + 150]) {
      const p = t.sample(s);
      expect(p.heading).toBeCloseTo(line.heading, 3);
      expect(p.curvature).toBeCloseTo(0, 4);
      expect(p.y).toBeCloseTo(t.sample(t.length).y, 2);
    }
  });

  it.each(LEVELS)('level %i really winds', (level) => {
    const t = trackFor(level);
    const p = newRoadPoint();
    let lo = 0;
    let hi = 0;
    let rights = 0;
    let lefts = 0;
    let wasRight = 0;
    for (let s = 0; s < t.length; s += 4) {
      t.sample(s, p);
      lo = Math.min(lo, p.heading);
      hi = Math.max(hi, p.heading);
      const now = Math.sign(Math.round(p.curvature * 1e4));
      if (now !== 0 && now !== wasRight) {
        if (now > 0) rights += 1;
        else lefts += 1;
        wasRight = now;
      }
    }
    expect(hi - lo).toBeGreaterThan(0.8); // at least a 45 degree swing
    expect(rights + lefts).toBeGreaterThanOrEqual(3);
  });

  it.each(LEVELS)('level %i bends stay gentle enough for the scenery', (level) => {
    const t = trackFor(level);
    const p = newRoadPoint();
    let previous = 0;
    for (let s = t.first; s < t.last; s += 1) {
      t.sample(s, p);
      expect(Math.abs(p.curvature)).toBeLessThanOrEqual(1 / MIN_RADIUS + 1e-6);
      expect(Math.abs(p.curvature - previous)).toBeLessThan(0.0012); // curvature eases, never jumps
      previous = p.curvature;
    }
  });

  it.each(LEVELS)('level %i slopes stay drivable and heading never doubles back', (level) => {
    const t = trackFor(level);
    const p = newRoadPoint();
    for (let s = t.first; s < t.last; s += 1) {
      t.sample(s, p);
      expect(Math.abs(p.grade)).toBeLessThan(0.135); // cartoon hills: the car has no hill physics
      expect(Math.abs(p.heading)).toBeLessThan(1.3);
    }
  });

  it.each(LEVELS)('level %i road never passes close to itself', (level) => {
    const t = trackFor(level);
    const a = newRoadPoint();
    const b = newRoadPoint();
    let tightest = Infinity;
    for (let s1 = t.first; s1 < t.last; s1 += 8) {
      t.sample(s1, a);
      for (let s2 = s1 + 220; s2 < t.last; s2 += 8) {
        t.sample(s2, b);
        tightest = Math.min(tightest, Math.hypot(a.x - b.x, a.z - b.z));
      }
    }
    expect(tightest).toBeGreaterThan(125); // two strips of scenery up to 60 m wide never overlap
  });

  it('squeezes the inside of a bend without ever crossing its center', () => {
    const k = 1 / MIN_RADIUS;
    expect(bendLateral(20, k)).toBeCloseTo(20, 6);
    expect(bendLateral(-60, k)).toBeCloseTo(-60, 6); // the outside is untouched
    let last = 0;
    for (let x = 0; x < 400; x += 2) {
      const bent = bendLateral(x, k);
      expect(bent).toBeGreaterThanOrEqual(last);
      expect(bent).toBeLessThan(MIN_RADIUS * 0.85);
      last = bent;
    }
  });
});

describe('landscape', () => {
  const samples = (t: Track, want: Area) => {
    const out: number[] = [];
    for (let s = 0; s < t.length; s += 10) if (areaAt(t.route, s) === want) out.push(s);
    return out;
  };

  it.each([1, 2, 3, 4])('level %i keeps the road surface dry and on the land', (level) => {
    const t = trackFor(level);
    const land = new Landscape(t, levelSpec(level).seed);
    const p = newRoadPoint();
    for (let s = 0; s < t.length; s += 5) {
      t.sample(s, p);
      expect(p.y).toBeGreaterThan(WATER_Y + 0.8);
      expect(Math.abs(land.heightAt(p.x, p.z) - p.y)).toBeLessThan(0.6);
    }
  });

  it.each([1, 2, 3, 4])('level %i has open water beside the lake road', (level) => {
    const t = trackFor(level);
    const land = new Landscape(t, levelSpec(level).seed);
    const p = newRoadPoint();
    let wet = 0;
    let total = 0;
    for (const s of samples(t, 'lake')) {
      t.sample(s, p);
      for (const side of [-1, 1]) {
        const x = p.x + Math.cos(p.heading) * side * 45;
        const z = p.z + Math.sin(p.heading) * side * 45;
        total += 1;
        if (land.heightAt(x, z) < WATER_Y) wet += 1;
      }
    }
    expect(wet / total).toBeGreaterThan(0.45);
  });

  it.each([1, 2, 3, 4])('level %i leaves level ground for the home and the castle', (level) => {
    const t = trackFor(level);
    const land = new Landscape(t, levelSpec(level).seed);
    for (const x of [-34, -12, 12, 34]) expect(Math.abs(land.heightAt(x, -2))).toBeLessThan(0.4);
    const end = t.sample(t.length + 6);
    for (const side of [-1, 1]) {
      const x = end.x + Math.cos(end.heading) * side * 30;
      const z = end.z + Math.sin(end.heading) * side * 30;
      expect(Math.abs(land.heightAt(x, z) - end.y)).toBeLessThan(0.6);
    }
  });
});
