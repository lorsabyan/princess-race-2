import * as THREE from 'three';
// @ts-ignore -- three ships this addon without typings; the API surface we use is typed below.
import { MeshoptSimplifier as Simplifier } from 'three/addons/libs/meshopt_simplifier.module.js';

interface MeshoptSimplifierApi {
  ready: Promise<void>;
  supported: boolean;
  simplifyWithAttributes(
    indices: Uint32Array,
    positions: Float32Array,
    positionsStride: number,
    attributes: Float32Array,
    attributesStride: number,
    weights: number[],
    lock: Uint8Array | null,
    targetIndexCount: number,
    targetError: number,
    flags?: string[],
  ): [Uint32Array, number];
}

const meshopt = Simplifier as MeshoptSimplifierApi;
let ready = false;
try {
  await meshopt.ready;
  ready = meshopt.supported !== false;
} catch {
  ready = false;
}

/** Accumulated decimation time (ms), for build stats. */
export const decimateTiming = { ms: 0 };

export interface DecimateOptions {
  /** Max relative error (fraction of the mesh extent). */
  error?: number;
  normalWeight?: number;
  colorWeight?: number;
  /** Extra per-vertex attributes for the error metric (e.g. skin weights). */
  lock?: (x: number, y: number, z: number) => boolean;
}

/**
 * Edge-collapse decimation (meshoptimizer) that keeps normals and colors in the
 * error metric, so sculpted SDF parts can be meshed finely and then reduced to a
 * triangle budget with detail concentrated where the shape needs it.
 */
export function decimate(g: THREE.BufferGeometry, targetTris: number, opts: DecimateOptions = {}): THREE.BufferGeometry {
  const index = g.index;
  if (!ready || !index) return g;
  const tris = index.count / 3;
  if (tris <= targetTris) return g;
  const t0 = performance.now();
  try {
    return decimateInner(g, index, targetTris, opts);
  } finally {
    decimateTiming.ms += performance.now() - t0;
  }
}

function decimateInner(g: THREE.BufferGeometry, index: THREE.BufferAttribute, targetTris: number, opts: DecimateOptions): THREE.BufferGeometry {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const nor = g.attributes.normal as THREE.BufferAttribute | undefined;
  const col = g.attributes.color as THREE.BufferAttribute | undefined;
  const n = pos.count;
  const positions = new Float32Array(n * 3);
  for (let i = 0; i < n; i += 1) {
    positions[i * 3] = pos.getX(i);
    positions[i * 3 + 1] = pos.getY(i);
    positions[i * 3 + 2] = pos.getZ(i);
  }
  const stride = 6;
  const attrs = new Float32Array(n * stride);
  for (let i = 0; i < n; i += 1) {
    if (nor) {
      attrs[i * stride] = nor.getX(i);
      attrs[i * stride + 1] = nor.getY(i);
      attrs[i * stride + 2] = nor.getZ(i);
    }
    if (col) {
      attrs[i * stride + 3] = col.getX(i);
      attrs[i * stride + 4] = col.getY(i);
      attrs[i * stride + 5] = col.getZ(i);
    }
  }
  const nw = opts.normalWeight ?? 0.5;
  const cw = opts.colorWeight ?? 1.0;
  let lock: Uint8Array | null = null;
  if (opts.lock) {
    lock = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) lock[i] = opts.lock(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]) ? 1 : 0;
  }
  const indices = new Uint32Array(index.array as ArrayLike<number>);
  let out: Uint32Array;
  try {
    [out] = meshopt.simplifyWithAttributes(
      indices,
      positions,
      3,
      attrs,
      stride,
      [nw, nw, nw, cw, cw, cw],
      lock,
      Math.floor(targetTris) * 3,
      opts.error ?? 1,
      ['Regularize'],
    );
  } catch {
    return g;
  }
  // Compact to the referenced vertices.
  const remap = new Int32Array(n).fill(-1);
  let m = 0;
  for (let i = 0; i < out.length; i += 1) {
    if (remap[out[i]] < 0) remap[out[i]] = m++;
  }
  const result = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(g.attributes)) {
    const a = attr as THREE.BufferAttribute;
    const size = a.itemSize;
    const Ctor = (a.array as Float32Array).constructor as new (len: number) => Float32Array;
    const arr = new Ctor(m * size);
    for (let i = 0; i < n; i += 1) {
      const j = remap[i];
      if (j < 0) continue;
      for (let c = 0; c < size; c += 1) arr[j * size + c] = a.array[i * size + c];
    }
    result.setAttribute(name, new THREE.BufferAttribute(arr, size, a.normalized));
  }
  const newIndex = new Uint32Array(out.length);
  for (let i = 0; i < out.length; i += 1) newIndex[i] = remap[out[i]];
  result.setIndex(new THREE.BufferAttribute(newIndex, 1));
  result.computeBoundingSphere();
  g.dispose();
  return result;
}
