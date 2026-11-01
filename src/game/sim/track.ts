import { mulberry32, range } from './rng';
import type { Area, AreaSpan } from './route';

/** Road built behind the start and past the finish line (town and courtyard chunks live there). */
export const TRACK_BEFORE = 200;
export const TRACK_AFTER = 160;
/** The home scene and the castle courtyard need dead-straight, level road. */
export const START_STRAIGHT = 90;
export const FINISH_STRAIGHT = 110;
/** Tightest bend anywhere. Houses reach ~60 m from the road, so this keeps the inside of a bend from folding. */
export const MIN_RADIUS = 92;
/** Streets bend more gently than country roads so the houses stay square. */
const TOWN_RADIUS = 175;
/** Heading stays within this of straight ahead, so the road never doubles back over itself. */
const MAX_HEADING = 1.2;

/** Road height the level aims for through the middle of each area (meters). */
const AREA_HEIGHT: Record<Area, number> = { town: 1.4, meadow: 6, forest: 8.5, lake: -2.2, castle: 12.5 };

/** Steepest the road may get. The car has no hill physics; this is purely how it looks. */
const MAX_GRADE = 0.125;

/** Little humps in the road that give the car a hop, by share of each area. */
const HUMPS: Partial<Record<Area, readonly number[]>> = { meadow: [0.38, 0.82], forest: [0.55], castle: [0.3] };
const HUMP_HEIGHT = 0.6;
const HUMP_WIDTH = 7.5;

const STEP = 1;

export interface RoadPoint {
  x: number;
  y: number;
  z: number;
  /** Radians: 0 points along -Z, positive turns toward +X (right). */
  heading: number;
  /** Rise per meter along the road. */
  grade: number;
  /** Signed curvature (1/m), positive when bending right. */
  curvature: number;
}

export interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

export function newRoadPoint(): RoadPoint {
  return { x: 0, y: 0, z: 0, heading: 0, grade: 0, curvature: 0 };
}

function smoother(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * x * (x * (x * 6 - 15) + 10);
}

/**
 * The real 3D road. The simulation keeps working in straight road space
 * (x = sideways, s = distance along the road) and this maps that onto the world:
 * sweeping S-bends with continuous curvature, rising and falling through the
 * areas of the route. Deterministic for (length, route, seed).
 */
export class Track {
  readonly first = -TRACK_BEFORE;
  readonly last: number;
  /** Road distances of the humps, in driving order. */
  readonly hops: number[] = [];
  private readonly count: number;
  private readonly px: Float32Array;
  private readonly py: Float32Array;
  private readonly pz: Float32Array;
  private readonly head: Float32Array;
  private readonly kappa: Float32Array;
  private readonly slope: Float32Array;

  constructor(
    readonly length: number,
    readonly route: readonly AreaSpan[],
    seed: number,
  ) {
    this.last = length + TRACK_AFTER;
    this.count = Math.round((this.last - this.first) / STEP) + 1;
    this.px = new Float32Array(this.count);
    this.py = new Float32Array(this.count);
    this.pz = new Float32Array(this.count);
    this.head = new Float32Array(this.count);
    this.kappa = new Float32Array(this.count);
    this.slope = new Float32Array(this.count);
    this.layBends(seed);
    this.integrate();
    this.layHills(seed);
  }

  private indexOf(s: number): number {
    return Math.round((s - this.first) / STEP);
  }

  /** Alternating S-bends; each bend's curvature eases in and out (sin^2) so nothing kinks. */
  private layBends(seed: number): void {
    const rng = mulberry32((seed ^ 0x2f6e2b1) >>> 0);
    const end = this.length - FINISH_STRAIGHT;
    let s = START_STRAIGHT;
    let heading = 0;
    let dir = rng() < 0.5 ? -1 : 1;
    while (end - s >= 80) {
      const span = this.route.find((a) => s < a.to) ?? this.route[this.route.length - 1];
      const radius = span.area === 'town' ? TOWN_RADIUS : MIN_RADIUS;
      const len = Math.min(end - s, range(rng, 135, 190));
      const most = len / (2 * radius);
      let turn = dir * most * range(rng, 0.8, 1);
      // The last bend straightens the road back toward the castle's axis of approach.
      if (Math.abs(heading + turn) > MAX_HEADING) turn = dir * Math.max(0, MAX_HEADING - Math.abs(heading));
      if (Math.abs(heading + turn) > MAX_HEADING || Math.abs(turn) < 0.1) {
        dir = -dir;
        turn = dir * most * range(rng, 0.8, 1);
      }
      const peak = (2 * turn) / len;
      for (let m = 0; m <= Math.round(len); m += 1) {
        const i = this.indexOf(s + m);
        const w = Math.sin((Math.PI * m) / len);
        this.kappa[i] = peak * w * w;
      }
      heading += turn;
      s += len + range(rng, 0, 16);
      dir = -dir;
    }
  }

  private integrate(): void {
    const start = this.indexOf(0);
    // Straight behind the start line: x = 0, z = -s.
    for (let i = 0; i <= start; i += 1) this.pz[i] = -(this.first + i * STEP);
    let heading = 0;
    let x = 0;
    let z = 0;
    for (let i = start + 1; i < this.count; i += 1) {
      const mid = heading + (this.kappa[i - 1] * STEP) / 2;
      x += Math.sin(mid) * STEP;
      z -= Math.cos(mid) * STEP;
      heading += this.kappa[i - 1] * STEP;
      this.px[i] = x;
      this.pz[i] = z;
      this.head[i] = heading;
    }
  }

  /** Height knots at each area's plateau, joined with smooth ramps, plus a small roll. */
  private layHills(seed: number): void {
    const knots: Array<[number, number]> = [[START_STRAIGHT, 0]];
    for (const span of this.route) {
      if (span.area === 'town') continue;
      const to = Math.min(span.to, this.length - FINISH_STRAIGHT);
      const size = to - span.from;
      const height = AREA_HEIGHT[span.area];
      // The lake road stays low the whole way across; the ramps live in its neighbors.
      if (span.area === 'lake') knots.push([span.from + 8, height], [to - 8, height]);
      else knots.push([span.from + size * (span.area === 'castle' ? 0.72 : 0.5), height]);
    }
    const lastKnot = knots[knots.length - 1];
    const phase = (seed % 97) * 0.13;
    for (let i = 0; i < this.count; i += 1) {
      const s = this.first + i * STEP;
      let y = lastKnot[1];
      if (s <= knots[0][0]) y = knots[0][1];
      else {
        for (let k = 1; k < knots.length; k += 1) {
          if (s > knots[k][0]) continue;
          const [a, ya] = knots[k - 1];
          const [b, yb] = knots[k];
          const t = Math.max(0, Math.min(1, (s - a) / (b - a)));
          y = ya + (yb - ya) * t * t * (3 - 2 * t);
          break;
        }
      }
      // Gentle extra swell, faded out over the lake and near both ends.
      const here = this.route.find((a) => s < a.to)?.area;
      const fade = here === 'lake' ? 0 : Math.min(smoother((s - START_STRAIGHT) / 120), smoother((this.length - FINISH_STRAIGHT - s) / 150));
      this.py[i] = y;
      this.slope[i] = fade;
    }
    // Smooth the fade so the swell doesn't step at area boundaries, then apply it.
    const fade = this.slope.slice();
    const reach = 26;
    for (let i = 0; i < this.count; i += 1) {
      let sum = 0;
      let weight = 0;
      for (let k = Math.max(0, i - reach); k <= Math.min(this.count - 1, i + reach); k += 4) {
        sum += fade[k];
        weight += 1;
      }
      const s = this.first + i * STEP;
      const ends = Math.min(smoother((s - START_STRAIGHT) / 80), smoother((this.length - FINISH_STRAIGHT - s) / 80));
      this.py[i] += Math.min(sum / weight, ends) * 0.9 * Math.sin(s * 0.024 + phase);
    }
    this.layHumps();
    this.limitGrade();
    for (let i = 0; i < this.count; i += 1) {
      const a = this.py[Math.max(0, i - 1)];
      const b = this.py[Math.min(this.count - 1, i + 1)];
      this.slope[i] = (b - a) / (2 * STEP);
    }
  }

  private layHumps(): void {
    for (const span of this.route) {
      const from = Math.max(span.from, START_STRAIGHT + 40);
      const to = Math.min(span.to, this.length - FINISH_STRAIGHT - 24);
      if (to - from < 60) continue;
      for (const share of HUMPS[span.area] ?? []) {
        const at = Math.round(from + (to - from) * share);
        this.hops.push(at);
        for (let m = -20; m <= 20; m += 1) this.py[this.indexOf(at + m)] += HUMP_HEIGHT * Math.exp(-((m / HUMP_WIDTH) ** 2));
      }
    }
  }

  /** Lower any stretch that climbs or falls too fast, then round off the corners that leaves. */
  private limitGrade(): void {
    const y = this.py;
    for (let i = 1; i < this.count; i += 1) y[i] = Math.min(y[i], y[i - 1] + MAX_GRADE * STEP);
    for (let i = this.count - 2; i >= 0; i -= 1) y[i] = Math.min(y[i], y[i + 1] + MAX_GRADE * STEP);
    const raw = y.slice();
    const reach = 10;
    const from = this.indexOf(START_STRAIGHT + reach);
    const to = this.indexOf(this.length - FINISH_STRAIGHT);
    for (let i = from; i < to; i += 1) {
      let sum = 0;
      for (let k = -reach; k <= reach; k += 1) sum += raw[i + k];
      const edge = Math.min(smoother((i - from) / 14), smoother((to - i) / 14));
      y[i] = raw[i] + (sum / (reach * 2 + 1) - raw[i]) * edge;
    }
  }

  /** Road centerline frame at distance `s` (clamped to the built road). */
  sample(s: number, out: RoadPoint = newRoadPoint()): RoadPoint {
    const f = (Math.max(this.first, Math.min(this.last, s)) - this.first) / STEP;
    const i = Math.min(this.count - 2, Math.floor(f));
    const t = f - i;
    out.x = this.px[i] + (this.px[i + 1] - this.px[i]) * t;
    out.y = this.py[i] + (this.py[i + 1] - this.py[i]) * t;
    out.z = this.pz[i] + (this.pz[i + 1] - this.pz[i]) * t;
    out.heading = this.head[i] + (this.head[i + 1] - this.head[i]) * t;
    out.grade = this.slope[i] + (this.slope[i + 1] - this.slope[i]) * t;
    out.curvature = this.kappa[i] + (this.kappa[i + 1] - this.kappa[i]) * t;
    return out;
  }

  /** World position of a road-space point: `x` sideways, `y` above the road, `s` along it. */
  toWorld(x: number, y: number, s: number, out: WorldPoint): WorldPoint {
    const p = this.sample(s, scratch);
    out.x = p.x + Math.cos(p.heading) * x;
    out.y = p.y + y;
    out.z = p.z + Math.sin(p.heading) * x;
    return out;
  }
}

const scratch = newRoadPoint();

/**
 * Sideways distance after bending. Scenery reaches far from the road, so on the
 * inside of a bend it is squeezed gently toward (never past) the bend's center.
 */
export function bendLateral(x: number, curvature: number): number {
  const inside = x * curvature;
  if (inside <= 0.5) return x;
  const radius = 1 / Math.abs(curvature);
  const u = Math.abs(x) / radius;
  return Math.sign(x) * radius * (0.5 + 0.34 * Math.tanh((u - 0.5) / 0.34));
}
