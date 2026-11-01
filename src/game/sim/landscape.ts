import type { Area } from './route';
import { areaAt } from './route';
import { FINISH_STRAIGHT, newRoadPoint, type Track } from './track';

/** Lakes appear wherever the land dips below this height. */
export const WATER_Y = -3.6;

/** How the land behaves around the road in each area. */
interface AreaShape {
  /** Land height relative to the road, once away from it. */
  lift: number;
  /** Size of the rolling hills. */
  rolling: number;
  /** The land follows the road out to `inner`, and reaches its own height by `outer`. */
  inner: number;
  outer: number;
  /** Half width of the detailed ground strip; the coarser terrain takes over beyond it. */
  strip: number;
}

const SHAPES: Record<Area, AreaShape> = {
  town: { lift: 1.5, rolling: 4.5, inner: 40, outer: 100, strip: 60 },
  meadow: { lift: 3, rolling: 11, inner: 18, outer: 76, strip: 34 },
  forest: { lift: 9, rolling: 8, inner: 13, outer: 58, strip: 34 },
  lake: { lift: -8.5, rolling: 2.5, inner: 6.4, outer: 19, strip: 16 },
  castle: { lift: -3.5, rolling: 7, inner: 18, outer: 84, strip: 34 },
};

const CELL = 5;
/** Land is modelled this far from the road. */
const MARGIN = 420;
/** Track points used when measuring distance to the road. */
const SAMPLE_EVERY = 8;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(y, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = x - xi;
  const v = y - yi;
  const su = u * u * (3 - 2 * u);
  const sv = v * v * (3 - 2 * v);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}

/** Rolling hills in -1..1. */
function rollingHills(x: number, z: number, seed: number): number {
  const n = valueNoise(x * 0.0085, z * 0.0085, seed) * 0.62 + valueNoise(x * 0.021, z * 0.021, seed + 9) * 0.28 + valueNoise(x * 0.05, z * 0.05, seed + 21) * 0.1;
  return n * 2 - 1;
}

/**
 * One continuous land surface around the road, stored as a height grid. The
 * land follows the road close in and rolls into each area's own hills further
 * out, with a soft bowl rising toward the horizon. Pure data, so tests can walk it.
 */
export class Landscape {
  readonly x0: number;
  readonly z0: number;
  readonly nx: number;
  readonly nz: number;
  readonly cell = CELL;
  /** Land height per grid vertex. */
  readonly height: Float32Array;
  /** Distance to the road per grid vertex. */
  readonly distance: Float32Array;
  /** Half width of the detailed strip near each grid vertex. */
  readonly strip: Float32Array;
  /** Road distance `s` of the nearest road point, per grid vertex. */
  readonly nearestS: Float32Array;

  constructor(
    readonly track: Track,
    seed: number,
  ) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const p = newRoadPoint();
    const road: number[] = [];
    for (let s = track.first; s <= track.last; s += SAMPLE_EVERY) {
      track.sample(s, p);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
      const shape = SHAPES[areaAt(track.route, s)];
      // The home scene and the castle stand on level ground, whatever the area around them.
      const level = Math.max(1 - smoothstep(30, 70, s), smoothstep(track.length - FINISH_STRAIGHT + 44, track.length - FINISH_STRAIGHT + 76, s));
      road.push(
        p.x,
        p.z,
        p.y,
        shape.lift * (1 - level),
        shape.rolling * (1 - level * 0.7),
        shape.inner + (84 - shape.inner) * level,
        shape.outer + (140 - shape.outer) * level,
        shape.strip + (60 - shape.strip) * level,
      );
    }
    this.x0 = minX - MARGIN;
    this.z0 = minZ - MARGIN;
    this.nx = Math.ceil((maxX - minX + MARGIN * 2) / CELL) + 1;
    this.nz = Math.ceil((maxZ - minZ + MARGIN * 2) / CELL) + 1;
    this.height = new Float32Array(this.nx * this.nz);
    this.distance = new Float32Array(this.nx * this.nz);
    this.strip = new Float32Array(this.nx * this.nz);
    this.nearestS = new Float32Array(this.nx * this.nz);

    const stride = 8;
    const points = road.length / stride;
    for (let j = 0; j < this.nz; j += 1) {
      const z = this.z0 + j * CELL;
      for (let i = 0; i < this.nx; i += 1) {
        const x = this.x0 + i * CELL;
        // Blend the nearby road's properties by inverse distance, so land changes
        // smoothly even where two parts of a bend are equally close.
        let nearest = Infinity;
        let nearestK = 0;
        let wSum = 0;
        let yRoad = 0;
        let lift = 0;
        let rolling = 0;
        let inner = 0;
        let outer = 0;
        let strip = 0;
        for (let k = 0; k < points; k += 1) {
          const o = k * stride;
          const dx = road[o] - x;
          const dz = road[o + 1] - z;
          const d2 = dx * dx + dz * dz;
          if (d2 < nearest) {
            nearest = d2;
            nearestK = k;
          }
          const w0 = 1 / (d2 + 100);
          const w = w0 * w0;
          wSum += w;
          yRoad += road[o + 2] * w;
          lift += road[o + 3] * w;
          rolling += road[o + 4] * w;
          inner += road[o + 5] * w;
          outer += road[o + 6] * w;
          strip += road[o + 7] * w;
        }
        const d = Math.sqrt(nearest);
        yRoad /= wSum;
        const hills = yRoad + lift / wSum + (rolling / wSum) * rollingHills(x, z, seed);
        // A soft bowl of higher ground closes the view toward the horizon.
        const bowl = Math.max(0, d - 130) * 0.075;
        const t = smoothstep(inner / wSum, outer / wSum, d);
        const at = i + j * this.nx;
        this.height[at] = yRoad + (hills + bowl - yRoad) * t;
        this.distance[at] = d;
        this.strip[at] = strip / wSum;
        this.nearestS[at] = track.first + nearestK * SAMPLE_EVERY;
      }
    }
  }

  /** Bilinear lookup in a grid-sized field. */
  private lookup(field: Float32Array, x: number, z: number): number {
    const fx = Math.max(0, Math.min(this.nx - 1.001, (x - this.x0) / CELL));
    const fz = Math.max(0, Math.min(this.nz - 1.001, (z - this.z0) / CELL));
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const at = i + j * this.nx;
    const a = field[at];
    const b = field[at + 1];
    const c = field[at + this.nx];
    const d = field[at + this.nx + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  heightAt(x: number, z: number): number {
    return this.lookup(this.height, x, z);
  }

  distanceAt(x: number, z: number): number {
    return this.lookup(this.distance, x, z);
  }
}
