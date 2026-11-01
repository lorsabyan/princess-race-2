import * as THREE from 'three';

/**
 * One small tiling noise texture shared by every world shader, so per-pixel detail
 * (cloud shadows, grass, leaves, water) costs a texture read, not a procedural noise.
 *
 * R: broad soft billows. G: round blobs (leaf gaps, clumps). B: fine grain.
 * A: a second, unrelated set of billows, for anything that must not line up with R.
 */
const SIZE = 256;

function lattice(period: number, seed: number): Float32Array {
  const table = new Float32Array(period * period);
  let s = seed >>> 0;
  for (let i = 0; i < table.length; i += 1) {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    table[i] = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return table;
}

/** Value noise that wraps every `period` cells. */
function wrapped(table: Float32Array, period: number, x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const x0 = ((ix % period) + period) % period;
  const y0 = ((iy % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const a = table[x0 + y0 * period];
  const b = table[x1 + y0 * period];
  const c = table[x0 + y1 * period];
  const d = table[x1 + y1 * period];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Layers of value noise, each twice as fine and half as strong. */
function billows(seed: number, base: number, octaves: number): (u: number, v: number) => number {
  const layers = Array.from({ length: octaves }, (_, i) => ({ period: base << i, table: lattice(base << i, seed + i * 101) }));
  const total = 2 - 2 ** (1 - octaves);
  return (u, v) => {
    let sum = 0;
    let weight = 1;
    for (const { period, table } of layers) {
      sum += wrapped(table, period, u * period, v * period) * weight;
      weight *= 0.5;
    }
    return sum / total;
  };
}

/** Soft round blobs on a jittered grid: 1 in the middle of a blob, 0 between them. */
function blobs(seed: number, cells: number): (u: number, v: number) => number {
  const jitter = lattice(cells * 2, seed);
  const point = (cx: number, cy: number, axis: number) => {
    const wrapX = ((cx % cells) + cells) % cells;
    const wrapY = ((cy % cells) + cells) % cells;
    return jitter[wrapX + axis * cells + wrapY * cells * 2];
  };
  return (u, v) => {
    const x = u * cells;
    const y = v * cells;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let nearest = 9;
    for (let j = -1; j <= 1; j += 1) {
      for (let i = -1; i <= 1; i += 1) {
        const dx = ix + i + point(ix + i, iy + j, 0) - x;
        const dy = iy + j + point(ix + i, iy + j, 1) - y;
        nearest = Math.min(nearest, dx * dx + dy * dy);
      }
    }
    return Math.max(0, 1 - Math.sqrt(nearest) * 1.25);
  };
}

function stretch(v: number, lo: number, hi: number): number {
  return Math.round(Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * 255);
}

let shared: THREE.DataTexture | null = null;

export function noiseTexture(): THREE.DataTexture {
  if (shared) return shared;
  const broad = billows(7, 4, 5);
  const round = blobs(23, 12);
  const grain = billows(31, 48, 3);
  const other = billows(53, 5, 4);
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let j = 0; j < SIZE; j += 1) {
    for (let i = 0; i < SIZE; i += 1) {
      const u = i / SIZE;
      const v = j / SIZE;
      const o = (i + j * SIZE) * 4;
      data[o] = stretch(broad(u, v), 0.24, 0.76);
      data[o + 1] = stretch(round(u, v), 0, 0.95);
      data[o + 2] = stretch(grain(u, v), 0.2, 0.8);
      data[o + 3] = stretch(other(u, v), 0.24, 0.76);
    }
  }
  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  tex.name = 'world-noise';
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  shared = tex;
  return tex;
}
