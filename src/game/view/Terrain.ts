import * as THREE from 'three';
import { BIOME, SHORE } from '../models/country/biome';
import { curved } from '../models/kit/materials';
import { distantCrown } from '../models/town/plants';
import { WATER_Y, type Landscape } from '../sim/landscape';
import { areaAt, type Area } from '../sim/route';
import { mulberry32, range, type Rng } from '../sim/rng';
import type { Track } from '../sim/track';
import { LOOK_NOW } from './look';
import type { QualityTier } from './Stage';

/** One terrain quad spans this many height-grid cells. */
const QUAD = 2;
const VIEW_MARGIN = 400;
/** Trees per square meter, away from the road. */
const TREE_DENSITY: Record<Area, number> = { town: 0.0022, meadow: 0.0016, forest: 0.016, lake: 0.0013, castle: 0.0024 };
const MAX_TREES = 2200;
const TREE_REACH = 300;
/** Trees are drawn in blocks of this many meters of road; only blocks in view are drawn. */
const TREE_BLOCK = 150;
/** Road-to-road blend between area colors. */
const BLEND = 46;

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function material(): THREE.Material {
  const m = curved(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.93, metalness: 0 }), { detail: 'grass' });
  m.name = 'terrain';
  return m;
}

function treeMaterial(): THREE.Material {
  const m = curved(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, emissive: new THREE.Color('#1c3d1a'), emissiveIntensity: 0.12 }), { detail: 'leaves' });
  m.name = 'terrain-trees';
  return m;
}

/** Soft leaves on a short trunk; brightness baked toward the top, color comes per instance. */
function treeGeometry(crown: THREE.BufferGeometry): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.1, 0.17, 1.1, 5, 1, true);
  trunk.translate(0, 0.5, 0);
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  for (const [g, isCrown] of [[crown, true], [trunk, false]] as const) {
    const source = g.index ? g.toNonIndexed() : g;
    const p = source.attributes.position;
    const n = source.attributes.normal;
    for (let i = 0; i < p.count; i += 1) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
      const k = isCrown ? 0.84 + 0.3 * smoothstep(0.9, 2.6, p.getY(i)) : 0.42;
      col.push(k, k, k);
    }
    if (source !== g) source.dispose();
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

/** The soft crown of a tree close enough to the road to show its shape. */
function fullCrown(): THREE.BufferGeometry {
  const crown = distantCrown();
  crown.scale(0.62, 0.62, 0.62);
  crown.translate(0, 1.72, 0);
  return crown;
}

/** One lumpy ball, for trees further off: a rough outline over shading as smooth as a ball. */
function plainCrown(detail = 1): THREE.BufferGeometry {
  const crown = new THREE.IcosahedronGeometry(1, detail);
  const shape = crown.attributes.position;
  const round = crown.attributes.normal;
  for (let i = 0; i < shape.count; i += 1) {
    const x = shape.getX(i);
    const y = shape.getY(i);
    const z = shape.getZ(i);
    const lump = 1 + 0.17 * Math.sin(x * 5.1 + 1) * Math.sin(y * 4.3 + 2) * Math.sin(z * 5.7 + 0.5);
    round.setXYZ(i, x, y, z);
    shape.setXYZ(i, x * lump, y * lump, z * lump);
  }
  crown.scale(0.95, 0.9, 0.95);
  crown.translate(0, 1.75, 0);
  return crown;
}

const palette: Record<Area, THREE.Color[]> = {
  town: ['#7ccb86', '#9bdc8e', '#ffb3cf', '#5fb87c'].map((c) => new THREE.Color(c)),
  meadow: ['#8fd47c', '#b3e083', '#76c47c', '#ffc2d8'].map((c) => new THREE.Color(c)),
  forest: ['#4fa577', '#5ebc80', '#3f9a78', '#77c98a', '#ff9fc4'].map((c) => new THREE.Color(c)),
  lake: ['#8fd488', '#b6e39a', '#74c493'].map((c) => new THREE.Color(c)),
  castle: ['#7ccb86', '#ffb3cf', '#5fb87c', '#d6b4ff'].map((c) => new THREE.Color(c)),
};

/** How far ahead along the road distant trees are drawn. */
const TREE_AHEAD: Record<QualityTier, number> = { high: 430, medium: 300, low: 210 };
/** Trees nearer the road than this have soft crowns while they are ahead by less than the tier's reach. */
const CLOSE_TREE = 84;
const FULL_CROWN: Record<QualityTier, number> = { high: 240, medium: 0, low: 0 };

const FIELDS = ['#c9eb9a', '#e6eeaa', '#9edc9a', '#f3e2a2', '#f6c9dc', '#dcd2fa', '#b9e8a6'];

const grass = new THREE.Color();
const tmp = new THREE.Color();

/**
 * The land itself, out to the horizon: a tiled height mesh shared with the road
 * strips, plus forests and copses of instanced trees. Under each strip it dips
 * out of sight; right at the strip's edge it rises through, so the seam is a
 * natural line in the grass rather than a gap.
 */
export class Terrain {
  readonly group = new THREE.Group();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly instanced: THREE.InstancedMesh[] = [];
  private readonly toneA = new THREE.Color();
  private readonly toneB = new THREE.Color();
  private readonly soft = treeGeometry(fullCrown());
  /** A third of the triangles, for trees well back from the road on phones. */
  private readonly tiny = treeGeometry(plainCrown(0));
  private readonly plain = treeGeometry(plainCrown());

  constructor(
    private readonly land: Landscape,
    private readonly track: Track,
    seed: number,
  ) {
    this.group.name = 'terrain';
    const landMat = material();
    this.materials.push(landMat);
    const g = this.buildLand(Math.floor((land.nx - 1) / QUAD), Math.floor((land.nz - 1) / QUAD));
    const mesh = new THREE.Mesh(g, landMat);
    mesh.name = 'terrain-land';
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.geometries.push(g);
    this.plantTrees(mulberry32((seed ^ 0x51ab7e) >>> 0));
  }

  /** Land height as drawn: hidden under the road strip, flush at its edge. */
  private shapedHeight(at: number): number {
    const { height, distance, strip } = this.land;
    const d = distance[at];
    const edge = strip[at];
    return height[at] - 1.5 * (1 - smoothstep(edge - 7, edge - 2.5, d)) + 0.1 * smoothstep(edge - 2.5, edge - 1, d);
  }

  private colorAt(at: number, out: THREE.Color): THREE.Color {
    const land = this.land;
    const route = this.track.route;
    const s = land.nearestS[at];
    const area = areaAt(route, s);
    // Blend across area borders along the road.
    const next = areaAt(route, s + BLEND);
    const prev = areaAt(route, s - BLEND);
    const other = next !== area ? next : prev;
    let mix = 0;
    if (other !== area) {
      const span = route.find((r) => r.area === area);
      if (span) mix = 0.5 * (1 - Math.min(Math.abs(s - span.from), Math.abs(s - span.to)) / BLEND);
    }
    const x = land.x0 + (at % land.nx) * land.cell;
    const z = land.z0 + Math.floor(at / land.nx) * land.cell;
    // Forest floors stay in the shade; open land ranges from deep to sunlit.
    const n = (0.5 + 0.5 * Math.sin(x * 0.031 + Math.sin(z * 0.017) * 2.4) * Math.sin(z * 0.027 + 1.3 + Math.sin(x * 0.012) * 1.7)) * (area === 'forest' ? 0.55 : 1);
    const a = BIOME[area];
    this.toneA.set(n < 0.5 ? a.deep : a.base).lerp(tmp.set(n < 0.5 ? a.base : a.light), n < 0.5 ? n * 2 : (n - 0.5) * 2);
    if (mix > 0) {
      const b = BIOME[other];
      this.toneB.set(n < 0.5 ? b.deep : b.base).lerp(tmp.set(n < 0.5 ? b.base : b.light), n < 0.5 ? n * 2 : (n - 0.5) * 2);
      this.toneA.lerp(this.toneB, mix);
    }
    out.copy(this.toneA);
    // Quilted fields on open land: soft patches of crops and flowers.
    if (area === 'meadow' || area === 'town' || area === 'castle') {
      const fx = Math.floor(x / 46);
      const fz = Math.floor(z / 34);
      const pick = Math.abs(Math.sin(fx * 12.9898 + fz * 78.233) * 43758.5453) % 1;
      if (pick > 0.35) {
        const tint = FIELDS[Math.floor(pick * 137) % FIELDS.length];
        const strength = area === 'meadow' ? 0.72 : 0.42;
        out.lerp(tmp.set(tint), strength * smoothstep(0, 60, land.distance[at] - land.strip[at]));
      }
    }
    const h = land.height[at];
    // Sandy shore around water, darker lake bed under it.
    const shore = 1 - smoothstep(WATER_Y + 0.25, WATER_Y + 1.6, h);
    if (shore > 0) out.lerp(tmp.set(SHORE.dry), shore);
    if (h < WATER_Y) out.lerp(tmp.set(SHORE.wet), smoothstep(WATER_Y, WATER_Y - 1.5, h));
    // Aerial perspective: distant hills drift toward the sky.
    out.lerp(tmp.set(LOOK_NOW.haze), smoothstep(150, 420, land.distance[at]) * 0.45);
    return out;
  }

  private buildLand(w: number, h: number): THREE.BufferGeometry {
    const land = this.land;
    const pos: number[] = [];
    const nor: number[] = [];
    const col: number[] = [];
    const idx: number[] = [];
    const cols = w + 1;
    const rows = h + 1;
    const at = (i: number, j: number) => i * QUAD + j * QUAD * land.nx;
    const e = land.cell * QUAD;
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < cols; i += 1) {
        const k = at(i, j);
        pos.push(land.x0 + i * e, this.shapedHeight(k), land.z0 + j * e);
        const kx0 = at(Math.max(0, i - 1), j);
        const kx1 = at(Math.min(w, i + 1), j);
        const kz0 = at(i, Math.max(0, j - 1));
        const kz1 = at(i, Math.min(h, j + 1));
        const nx = land.height[kx0] - land.height[kx1];
        const nz = land.height[kz0] - land.height[kz1];
        const l = Math.hypot(nx, 2 * e, nz);
        nor.push(nx / l, (2 * e) / l, nz / l);
        grass.copy(this.colorAt(k, grass));
        col.push(grass.r, grass.g, grass.b);
      }
    }
    for (let j = 0; j < h; j += 1) {
      for (let i = 0; i < w; i += 1) {
        const nearest = Math.min(land.distance[at(i, j)], land.distance[at(i + 1, j)], land.distance[at(i, j + 1)], land.distance[at(i + 1, j + 1)]);
        if (nearest > VIEW_MARGIN) continue;
        const a = i + j * cols;
        idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    return g;
  }

  private plantTrees(rng: Rng): void {
    const land = this.land;
    const route = this.track.route;
    const cell = 12;
    const area = cell * cell;
    const sites: Array<{ x: number; y: number; z: number; s: number; kind: Area; block: number; close: boolean }> = [];
    const x0 = land.x0;
    const z0 = land.z0;
    const nx = Math.floor((land.nx * land.cell) / cell);
    const nz = Math.floor((land.nz * land.cell) / cell);
    for (let j = 0; j < nz; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const x = x0 + (i + rng()) * cell;
        const z = z0 + (j + rng()) * cell;
        const roll = rng();
        const scale = range(rng, 2.4, 4.8);
        const at = Math.floor((x - x0) / land.cell) + Math.floor((z - z0) / land.cell) * land.nx;
        const d = land.distance[at];
        if (d < land.strip[at] + 2 || d > TREE_REACH) continue;
        const kind = areaAt(route, land.nearestS[at]);
        // Copses: density swells and fades with a slow pattern.
        const copse = 0.5 + 0.5 * Math.sin(x * 0.024 + 1.2) * Math.sin(z * 0.031 + 0.4);
        const density = TREE_DENSITY[kind] * (kind === 'forest' ? 1 : 3.2 * copse * copse);
        if (roll > density * area) continue;
        const y = land.heightAt(x, z);
        if (y < WATER_Y + 1.2) continue;
        sites.push({ x, y, z, s: scale, kind, block: Math.floor(land.nearestS[at] / TREE_BLOCK), close: d < CLOSE_TREE });
      }
    }
    // Over budget: thin evenly, never by region.
    const keep = Math.min(1, MAX_TREES / Math.max(1, sites.length));
    const trees = sites.filter(() => rng() < keep);
    trees.sort((a, b) => a.block - b.block || Number(a.close) - Number(b.close));
    this.geometries.push(this.soft, this.plain, this.tiny);
    const mat = treeMaterial();
    this.materials.push(mat);
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    let start = 0;
    while (start < trees.length) {
      const first = trees[start];
      let end = start;
      while (end < trees.length && trees[end].block === first.block && trees[end].close === first.close) end += 1;
      const mesh = new THREE.InstancedMesh(this.plain, mat, end - start);
      mesh.name = 'terrain-trees';
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      for (let t = start; t < end; t += 1) {
        const site = trees[t];
        quat.setFromAxisAngle(up, rng() * 6.28);
        const wide = site.s * range(rng, 0.9, 1.15);
        matrix.compose(new THREE.Vector3(site.x, site.y - 0.3, site.z), quat, new THREE.Vector3(wide, site.s, wide));
        mesh.setMatrixAt(t - start, matrix);
        const colors = palette[site.kind];
        tmp.copy(colors[Math.floor(rng() * colors.length) % colors.length]).multiplyScalar(range(rng, 0.92, 1.08));
        mesh.setColorAt(t - start, tmp);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.userData.from = first.block * TREE_BLOCK;
      mesh.userData.close = first.close;
      this.group.add(mesh);
      this.instanced.push(mesh);
      start = end;
    }
  }

  /** Show only the tree blocks around road distance `s`. */
  update(s: number, lookBehind: number, tier: QualityTier): void {
    const ahead = TREE_AHEAD[tier];
    for (const mesh of this.instanced) {
      const from = mesh.userData.from as number;
      mesh.visible = from + TREE_BLOCK > s - lookBehind && from < s + ahead;
      if (mesh.userData.close) mesh.geometry = from < s + FULL_CROWN[tier] ? this.soft : this.plain;
      else mesh.geometry = tier === 'high' ? this.plain : this.tiny;
    }
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const mesh of this.instanced) mesh.dispose();
    this.group.removeFromParent();
  }
}
