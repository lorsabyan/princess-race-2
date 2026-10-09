import * as THREE from 'three';
import type { SdfNode } from './sdf';

export interface MeshSdfOptions {
  /** Axis-aligned bounds of the region to polygonize. Keep ~1 cell of margin around the shape. */
  min: [number, number, number];
  max: [number, number, number];
  /** Grid cell size in world units. Smaller = smoother + more triangles. */
  cell: number;
  /** Material id -> color. Ids missing from the table fall back to white. */
  colors?: Record<number, THREE.ColorRepresentation>;
  /** Optional per-vertex color override (position, material id). */
  colorFn?: (x: number, y: number, z: number, mat: number) => THREE.ColorRepresentation;
  /** Per-vertex wind amplitude. */
  wind?: (x: number, y: number, z: number) => number;
  /** Vertex projection iterations onto the true surface (sharper silhouettes). */
  project?: number;
}

/**
 * Surface-nets polygonizer with a coarse pre-pass so only cells near the surface
 * are sampled at full resolution. Produces an indexed geometry with smooth
 * normals from the field gradient plus `color` and `wind` attributes.
 */
export function meshSdf(node: SdfNode, opts: MeshSdfOptions): THREE.BufferGeometry {
  const h = opts.cell;
  const [x0, y0, z0] = opts.min;
  const nx = Math.max(2, Math.ceil((opts.max[0] - x0) / h));
  const ny = Math.max(2, Math.ceil((opts.max[1] - y0) / h));
  const nz = Math.max(2, Math.ceil((opts.max[2] - z0) / h));
  const sx = nx + 1;
  const sy = ny + 1;
  const sz = nz + 1;
  const field = new Float32Array(sx * sy * sz);

  // Coarse pass: sample every C-th grid point, reuse values far from the surface.
  const C = 4;
  const cx = Math.ceil(nx / C) + 1;
  const cy = Math.ceil(ny / C) + 1;
  const cz = Math.ceil(nz / C) + 1;
  const coarse = new Float32Array(cx * cy * cz);
  for (let k = 0; k < cz; k += 1) {
    for (let j = 0; j < cy; j += 1) {
      for (let i = 0; i < cx; i += 1) {
        coarse[i + cx * (j + cy * k)] = node.d(x0 + i * C * h, y0 + j * C * h, z0 + k * C * h);
      }
    }
  }
  const safe = C * h * 1.2 + h * 2;
  for (let k = 0; k < sz; k += 1) {
    const kc = Math.min(cz - 1, Math.round(k / C));
    const z = z0 + k * h;
    for (let j = 0; j < sy; j += 1) {
      const jc = Math.min(cy - 1, Math.round(j / C));
      const y = y0 + j * h;
      for (let i = 0; i < sx; i += 1) {
        const ic = Math.min(cx - 1, Math.round(i / C));
        const c = coarse[ic + cx * (jc + cy * kc)];
        field[i + sx * (j + sy * k)] = Math.abs(c) > safe ? c : node.d(x0 + i * h, y, z);
      }
    }
  }

  // Vertex per surface cell.
  const cellVertex = new Int32Array(nx * ny * nz).fill(-1);
  const verts: number[] = [];
  const cornerOffsets: Array<[number, number, number]> = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0],
    [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
  ];
  const edges: Array<[number, number]> = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  const cv = new Float32Array(8);
  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        let mask = 0;
        for (let c = 0; c < 8; c += 1) {
          const o = cornerOffsets[c];
          const v = field[i + o[0] + sx * (j + o[1] + sy * (k + o[2]))];
          cv[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;
        let ax = 0;
        let ay = 0;
        let az = 0;
        let count = 0;
        for (const [a, b] of edges) {
          const va = cv[a];
          const vb = cv[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          const oa = cornerOffsets[a];
          const ob = cornerOffsets[b];
          ax += oa[0] + (ob[0] - oa[0]) * t;
          ay += oa[1] + (ob[1] - oa[1]) * t;
          az += oa[2] + (ob[2] - oa[2]) * t;
          count += 1;
        }
        cellVertex[i + nx * (j + ny * k)] = verts.length / 3;
        verts.push(x0 + (i + ax / count) * h, y0 + (j + ay / count) * h, z0 + (k + az / count) * h);
      }
    }
  }

  const vertexCount = verts.length / 3;
  const positions = new Float32Array(verts);
  const normals = new Float32Array(vertexCount * 3);
  const eps = h * 0.35;
  const iterations = opts.project ?? 2;

  for (let v = 0; v < vertexCount; v += 1) {
    let x = positions[v * 3];
    let y = positions[v * 3 + 1];
    let z = positions[v * 3 + 2];
    let gx = 0;
    let gy = 0;
    let gz = 0;
    for (let it = 0; it <= iterations; it += 1) {
      gx = node.d(x + eps, y, z) - node.d(x - eps, y, z);
      gy = node.d(x, y + eps, z) - node.d(x, y - eps, z);
      gz = node.d(x, y, z + eps) - node.d(x, y, z - eps);
      const gl = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
      gx /= gl;
      gy /= gl;
      gz /= gl;
      if (it === iterations) break;
      const d = node.d(x, y, z);
      // Clamp the step so noisy fields cannot throw vertices across the cell.
      const step = Math.max(-h, Math.min(h, d));
      x -= gx * step;
      y -= gy * step;
      z -= gz * step;
    }
    positions[v * 3] = x;
    positions[v * 3 + 1] = y;
    positions[v * 3 + 2] = z;
    normals[v * 3] = gx;
    normals[v * 3 + 1] = gy;
    normals[v * 3 + 2] = gz;
  }

  // Quads for every grid edge that crosses the surface.
  const indices: number[] = [];
  const quad = (a: number, b: number, c: number, d: number) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    // Orient using the summed vertex normals.
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const cx2 = positions[c * 3], cy2 = positions[c * 3 + 1], cz2 = positions[c * 3 + 2];
    const dx = positions[d * 3], dy = positions[d * 3 + 1], dz = positions[d * 3 + 2];
    const e1x = cx2 - ax, e1y = cy2 - ay, e1z = cz2 - az;
    const e2x = dx - bx, e2y = dy - by, e2z = dz - bz;
    const qx = e1y * e2z - e1z * e2y;
    const qy = e1z * e2x - e1x * e2z;
    const qz = e1x * e2y - e1y * e2x;
    const nsx = normals[a * 3] + normals[b * 3] + normals[c * 3] + normals[d * 3];
    const nsy = normals[a * 3 + 1] + normals[b * 3 + 1] + normals[c * 3 + 1] + normals[d * 3 + 1];
    const nsz = normals[a * 3 + 2] + normals[b * 3 + 2] + normals[c * 3 + 2] + normals[d * 3 + 2];
    const flip = qx * nsx + qy * nsy + qz * nsz < 0;
    // Split along the shorter diagonal for smoother shading.
    const acLen = e1x * e1x + e1y * e1y + e1z * e1z;
    const bdLen = e2x * e2x + e2y * e2y + e2z * e2z;
    if (acLen <= bdLen) {
      if (!flip) indices.push(a, b, c, a, c, d);
      else indices.push(a, c, b, a, d, c);
    } else if (!flip) {
      indices.push(a, b, d, b, c, d);
    } else {
      indices.push(a, d, b, b, d, c);
    }
  };
  const cellAt = (i: number, j: number, k: number) =>
    i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? -1 : cellVertex[i + nx * (j + ny * k)];

  for (let k = 0; k < sz; k += 1) {
    for (let j = 0; j < sy; j += 1) {
      for (let i = 0; i < sx; i += 1) {
        const v0 = field[i + sx * (j + sy * k)] < 0;
        if (i < nx && v0 !== field[i + 1 + sx * (j + sy * k)] < 0) {
          quad(cellAt(i, j - 1, k - 1), cellAt(i, j, k - 1), cellAt(i, j, k), cellAt(i, j - 1, k));
        }
        if (j < ny && v0 !== field[i + sx * (j + 1 + sy * k)] < 0) {
          quad(cellAt(i - 1, j, k - 1), cellAt(i, j, k - 1), cellAt(i, j, k), cellAt(i - 1, j, k));
        }
        if (k < nz && v0 !== field[i + sx * (j + sy * (k + 1))] < 0) {
          quad(cellAt(i - 1, j - 1, k), cellAt(i, j - 1, k), cellAt(i, j, k), cellAt(i - 1, j, k));
        }
      }
    }
  }

  // Colors + wind.
  const colors = new Float32Array(vertexCount * 3);
  const wind = new Float32Array(vertexCount);
  const col = new THREE.Color();
  for (let v = 0; v < vertexCount; v += 1) {
    const x = positions[v * 3];
    const y = positions[v * 3 + 1];
    const z = positions[v * 3 + 2];
    const mat = node.m(x, y, z);
    if (opts.colorFn) col.set(opts.colorFn(x, y, z, mat));
    else col.set(opts.colors?.[mat] ?? '#ffffff');
    colors[v * 3] = col.r;
    colors[v * 3 + 1] = col.g;
    colors[v * 3 + 2] = col.b;
    if (opts.wind) wind[v] = opts.wind(x, y, z);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('wind', new THREE.BufferAttribute(wind, 1));
  geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}
