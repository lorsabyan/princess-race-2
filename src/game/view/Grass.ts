import * as THREE from 'three';
import { BIOME } from '../models/country/biome';
import { curved } from '../models/kit/materials';
import { WATER_Y } from '../sim/landscape';
import { mulberry32, range, type Rng } from '../sim/rng';
import { areaAt, type Area } from '../sim/route';
import type { QualityTier } from './Stage';
import { surfaceAt, type RoadWorld } from './warp';

/** Tufts are drawn in blocks of this many meters of road. */
const BLOCK = 60;
const WALK_TOP = 0.16;
/** Grass stays this far behind the car: nothing further back is on screen while driving. */
const BEHIND = 12;

/** Where grass grows beside the road, how much per block, and how long it is. */
const GROWTH: Record<Area, { from: number; to: number; tufts: number; size: number }> = {
  town: { from: 6.45, to: 15, tufts: 1900, size: 0.72 },
  meadow: { from: 4.76, to: 22, tufts: 5200, size: 1 },
  forest: { from: 4.76, to: 18, tufts: 4500, size: 1.25 },
  lake: { from: 4.76, to: 15, tufts: 1900, size: 0.95 },
  castle: { from: 6.45, to: 18, tufts: 2700, size: 0.68 },
};

/** A strip of tulips beside the road, in road coordinates. */
export interface FlowerBed {
  x: number;
  s: number;
  color: string;
}
/** Tulip heads per bed; each bed is about 1.4 m by 8 m. */
const BED_HEADS = 26;

/** Distance from the car where the grass has shrunk away, and the share of tufts drawn. */
const QUALITY: Record<QualityTier, { reach: number; share: number }> = {
  high: { reach: 96, share: 1 },
  medium: { reach: 58, share: 0.4 },
  low: { reach: 0, share: 0 },
};

/** Six thin blades fanning out of one root: one triangle each, dark at the root, sunlit at the tip. */
function tuftGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const wind: number[] = [];
  const blades: ReadonlyArray<readonly [number, number, number]> = [
    [0.3, 0.12, 0.4],
    [1.4, 0.18, 0.3],
    [2.5, 0.09, 0.44],
    [3.6, 0.2, 0.27],
    [4.6, 0.13, 0.37],
    [5.6, 0.17, 0.33],
  ];
  for (const [angle, lean, height] of blades) {
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const half = 0.042;
    pos.push(dx * 0.05 - dz * half, 0, dz * 0.05 + dx * half);
    pos.push(dx * 0.05 + dz * half, 0, dz * 0.05 - dx * half);
    pos.push(dx * (0.05 + lean), height, dz * (0.05 + lean));
    col.push(0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 1.46, 1.46, 1.26);
    wind.push(0, 0, 0.1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('wind', new THREE.Float32BufferAttribute(wind, 1));
  return g;
}

/** A closed tulip bud: five sides, narrow at the stem, on one thin green stem. */
function tulipGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const wind: number[] = [];
  const idx: number[] = [];
  const add = (x: number, y: number, z: number, nx: number, ny: number, nz: number, shade: number, sway: number) => {
    pos.push(x, y, z);
    const l = Math.hypot(nx, ny, nz) || 1;
    nor.push(nx / l, ny / l, nz / l);
    col.push(shade, shade, shade);
    wind.push(sway);
    return pos.length / 3 - 1;
  };
  const bottom = add(0, 0.16, 0, 0, -1, 0, 0.9, 0.03);
  const top = add(0, 0.46, 0, 0, 1, 0, 1.3, 0.06);
  const ring: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2;
    ring.push(add(Math.cos(a) * 0.1, 0.32, Math.sin(a) * 0.1, Math.cos(a), 0.3, Math.sin(a), 1.12, 0.05));
  }
  for (let i = 0; i < 5; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % 5];
    idx.push(bottom, a, b, top, b, a);
  }
  const stemA = add(-0.016, 0, 0, 0, 1, 0, 0.3, 0);
  const stemB = add(0.016, 0, 0, 0, 1, 0, 0.3, 0);
  const stemC = add(0, 0.2, 0, 0, 1, 0, 0.42, 0.03);
  idx.push(stemA, stemB, stemC);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('wind', new THREE.Float32BufferAttribute(wind, 1));
  g.setIndex(idx);
  return g;
}

function grassMaterial(reach: { value: number }): THREE.Material {
  const m = curved(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: THREE.DoubleSide }), { wind: true, key: 'grass-blades' });
  const patch = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    patch.call(m, shader, renderer);
    shader.uniforms.uGrassReach = reach;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uGrassReach;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      transformed.y *= 1.0 - smoothstep( 0.6, 1.0, distance( instanceMatrix[ 3 ].xz, uCurveOrigin ) / uGrassReach );`,
    );
    // Blades are lit like the ground they grow from, on both faces.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      'float faceDirection = 1.0;\nvec3 normal = normalize( vNormal );\nvec3 nonPerturbedNormal = normal;',
    );
  };
  m.name = 'grass-blades';
  return m;
}

/**
 * Real blades along the road, where the camera is close enough to see them. The
 * instances are shuffled, so a lower quality tier just draws fewer of them, and
 * they shrink away with distance so no block ever pops in.
 */
export class Grass {
  readonly group = new THREE.Group();
  private readonly geometry = tuftGeometry();
  private readonly tulip = tulipGeometry();
  private readonly reach = { value: QUALITY.high.reach };
  private readonly material = grassMaterial(this.reach);
  private readonly blocks: THREE.InstancedMesh[] = [];

  /** @param blocked true where something paved lies under road position (x, s). */
  constructor(world: RoadWorld, seed: number, length: number, blocked: (x: number, s: number) => boolean, beds: readonly FlowerBed[]) {
    this.group.name = 'grass';
    const rng = mulberry32((seed ^ 0x6a55) >>> 0);
    const route = world.track.route;
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const scale = new THREE.Vector3();
    const spot = new THREE.Vector3();
    const tint = new THREE.Color();
    const shade = new THREE.Color();
    for (let from = 40; from < length - 20; from += BLOCK) {
      const to = Math.min(from + BLOCK, length - 20);
      const middle = GROWTH[areaAt(route, (from + to) / 2)];
      const tries = Math.ceil((middle.tufts * (to - from)) / BLOCK);
      const mesh = new THREE.InstancedMesh(this.geometry, this.material, tries);
      let count = 0;
      for (let i = 0; i < tries; i += 1) {
        const s = range(rng, from, to);
        const area = areaAt(route, s);
        const grow = GROWTH[area];
        // Thick by the road, thinning out across the verge.
        const x = (rng() < 0.5 ? -1 : 1) * (grow.from + (grow.to - grow.from) * rng() ** 1.8);
        if (blocked(x, s)) continue;
        const p = surfaceAt(world, x, s, spot);
        if (area === 'lake' && Math.abs(x) > 5.32 && p.y < WATER_Y + 0.5) continue;
        if (world.land.heightAt(p.x, p.z) < WATER_Y + 0.25) continue;
        const size = grow.size * range(rng, 0.72, 1.32);
        quat.setFromAxisAngle(up, rng() * 6.28);
        matrix.compose(spot.set(p.x, p.y + WALK_TOP, p.z), quat, scale.set(size, size * range(rng, 0.8, 1.2), size));
        mesh.setMatrixAt(count, matrix);
        const tone = BIOME[area];
        const n = rng();
        tint.set(tone.base).lerp(shade.set(n < 0.5 ? tone.deep : tone.light), Math.abs(n - 0.5) * 1.7);
        mesh.setColorAt(count, tint);
        count += 1;
      }
      mesh.count = count;
      mesh.name = 'grass-tufts';
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.userData.from = from;
      mesh.userData.total = count;
      this.group.add(mesh);
      this.blocks.push(mesh);
    }
    this.plantTulips(world, beds, mulberry32((seed ^ 0x7a11) >>> 0));
  }

  private plantTulips(world: RoadWorld, beds: readonly FlowerBed[], rng: Rng): void {
    const byBlock = new Map<number, THREE.Matrix4[]>();
    const tints = new Map<THREE.Matrix4, THREE.Color>();
    const quat = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const scale = new THREE.Vector3();
    const spot = new THREE.Vector3();
    for (const bed of beds) {
      const block = Math.floor(bed.s / BLOCK);
      const list = byBlock.get(block) ?? [];
      byBlock.set(block, list);
      // Pale beds get deeper heads, or the flowers would wash out against them.
      const bloom = new THREE.Color(bed.color);
      const hsl = bloom.getHSL({ h: 0, s: 0, l: 0 });
      bloom.setHSL(hsl.h, Math.min(1, hsl.s * 1.1), Math.min(hsl.l, 0.62));
      for (let i = 0; i < BED_HEADS; i += 1) {
        const across = range(rng, -0.62, 0.62);
        const p = surfaceAt(world, bed.x + across, bed.s + range(rng, -3.9, 3.9), spot);
        // The bed is a low ridge: heads sit on its crown and shoulders.
        const lift = 0.5 * (1 - Math.min(1, Math.abs(across) / 0.74) ** 2);
        const size = range(rng, 0.85, 1.25);
        quat.setFromAxisAngle(up, rng() * 6.28);
        const matrix = new THREE.Matrix4().compose(spot.set(p.x, p.y + 0.16 + lift, p.z), quat, scale.set(size, size * range(rng, 0.9, 1.15), size));
        list.push(matrix);
        tints.set(matrix, bloom.clone().multiplyScalar(range(rng, 1, 1.25)));
      }
    }
    for (const [block, list] of byBlock) {
      for (let i = list.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      const mesh = new THREE.InstancedMesh(this.tulip, this.material, list.length);
      list.forEach((matrix, i) => {
        mesh.setMatrixAt(i, matrix);
        mesh.setColorAt(i, tints.get(matrix)!);
      });
      mesh.name = 'tulip-heads';
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.frustumCulled = false;
      mesh.userData.from = block * BLOCK;
      mesh.userData.total = list.length;
      this.group.add(mesh);
      this.blocks.push(mesh);
    }
  }

  /** Show the blocks around road distance `s`, at this tier's density. */
  update(s: number, tier: QualityTier): void {
    const { reach, share } = QUALITY[tier];
    this.reach.value = Math.max(1, reach);
    for (const mesh of this.blocks) {
      const from = mesh.userData.from as number;
      mesh.visible = share > 0 && from + BLOCK > s - BEHIND && from < s + reach;
      mesh.count = Math.floor((mesh.userData.total as number) * share);
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.tulip.dispose();
    this.material.dispose();
    for (const mesh of this.blocks) mesh.dispose();
    this.group.removeFromParent();
  }
}
