import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { LevelData } from '../sim/level';
import type { Sim } from '../sim/Sim';
import type { Landmark, ModelLibrary, ObstacleRig, PrincessHome, ScenicKind, ScenicRig, TownChunk } from '../models/contracts';
import type { Rect } from '../models/town/ground';
import { WATER_Y } from '../sim/landscape';
import { mulberry32, range } from '../sim/rng';
import { areaAt } from '../sim/route';
import type { WorldPoint } from '../sim/track';
import { Grass } from './Grass';
import type { QualityTier } from './Stage';
import { Terrain } from './Terrain';
import { Water } from './Water';
import { warpChunk, type RoadWorld } from './warp';

/** Full-detail chunks stop at `near`; further scenery is cheap stand-ins and the land itself, out to `far`. */
const VIEW: Record<QualityTier, { near: number; far: number; shadow: number; castle: number; scenic: number; coin: number }> = {
  high: { near: 125, far: 440, shadow: 52, castle: 420, scenic: 1, coin: 36 },
  medium: { near: 96, far: 400, shadow: 36, castle: 330, scenic: 0.85, coin: 24 },
  low: { near: 72, far: 320, shadow: 24, castle: 240, scenic: 0.65, coin: 14 },
};
const COIN_AHEAD = 125;

/**
 * Scenery never moves once it is placed, so three needn't recompute its matrices every frame.
 * The parents must be frozen too (`Game` and `WorldView` do that): a parent that updates makes all its children update.
 */
function freeze(root: THREE.Object3D): void {
  root.traverse((o) => {
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });
}
const VIEW_BEHIND = 70;
/** Chunks behind the car cast shadows this far back (the sun's shadow box is ~54 m across). */
const SHADOW_BEHIND = 26;
/** Moving scenery stops updating and drawing beyond this (before the tier's scale). */
const SCENIC_RANGE: Record<ScenicKind, number> = { windmill: 340, balloon: 460, sailboat: 300, swan: 170, lighthouse: 420 };
/** Coins closer than this cast shadows (the sun's shadow box reaches ~34 m ahead). */
const PICKUP_TIME = 0.32;
/** Chunks start behind the car, so the title camera has a street to look up. */
const FIRST_CHUNK = -3;

interface PlacedChunk {
  object: THREE.Object3D;
  z0: number; // near edge (larger z)
  z1: number; // far edge
  casts: THREE.Mesh[];
  shadows: boolean;
}

interface PlacedScenic {
  rig: ScenicRig;
  kind: ScenicKind;
  s: number;
}

/** All far stand-ins of one material, merged in road order, so any stretch of road is a single draw. */
interface FarRun {
  mesh: THREE.Mesh;
  /** Index offset where each chunk starts (one extra entry for the end). */
  starts: number[];
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * Everything level-specific in the 3D world: street chunks laid along the track,
 * instanced coins/gems with pickup animation, pooled obstacle rigs, and the
 * placement of the home (start) and castle (finish) landmarks.
 */
export class WorldView {
  readonly group = new THREE.Group();
  private readonly built: TownChunk[] = [];
  private readonly placed: PlacedChunk[] = [];
  private readonly coins: THREE.InstancedMesh;
  private readonly farCoins: THREE.InstancedMesh;
  private readonly gems: THREE.InstancedMesh;
  private readonly obstacles = new Map<number, ObstacleRig>();
  private readonly scenic: PlacedScenic[] = [];
  private readonly farRuns: FarRun[] = [];
  private terrain: Terrain | null = null;
  private water: Water | null = null;
  private grass: Grass | null = null;
  private readonly matrix = new THREE.Matrix4();
  private readonly rotation = new THREE.Matrix4();
  private readonly scaleM = new THREE.Matrix4();
  private readonly point: WorldPoint = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly lib: ModelLibrary,
    readonly level: LevelData,
    private readonly home: PrincessHome,
    private readonly castle: Landmark,
    readonly road: RoadWorld,
  ) {
    this.group.matrixAutoUpdate = false;
    const capacity = level.coins.length + 40;
    this.coins = new THREE.InstancedMesh(lib.createCoinGeometry(), lib.coinMaterial(), capacity);
    this.coins.name = 'coins';
    this.coins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.coins.frustumCulled = false;
    this.coins.castShadow = true;
    this.coins.count = 0;
    // Distant coins skip the shadow pass (their shadows are too small to see).
    this.farCoins = new THREE.InstancedMesh(lib.createFarCoinGeometry(), this.coins.material, capacity);
    this.farCoins.name = 'coins-far';
    this.farCoins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.farCoins.frustumCulled = false;
    this.farCoins.castShadow = false;
    this.farCoins.count = 0;
    this.gems = new THREE.InstancedMesh(lib.createHeartGemGeometry(), lib.heartGemMaterial(), 8);
    this.gems.name = 'gems';
    this.gems.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.gems.frustumCulled = false;
    this.gems.castShadow = true;
    this.gems.count = 0;
    this.group.add(this.coins, this.farCoins, this.gems);

    home.group.position.set(0, 0, 0);
    const finish = road.track.sample(level.length);
    castle.group.position.set(finish.x, finish.y, finish.z);
    castle.group.rotation.y = -finish.heading;
    this.group.add(home.group, castle.group);

    for (const o of level.obstacles) {
      const rig = lib.createObstacle(o.kind, level.seed + o.id);
      this.placeObstacle(rig, o.x, o.z);
      rig.root.visible = false;
      this.obstacles.set(o.id, rig);
      this.group.add(rig.root);
    }
  }

  /** Land and lake first, so the loading bar moves on while the chunks are built. */
  buildLand(sunDir: THREE.Vector3, fog: THREE.Fog): void {
    this.terrain = new Terrain(this.road.land, this.road.track, this.level.seed);
    this.water = new Water(this.road.land, sunDir, fog, this.level.seed);
    freeze(this.terrain.group);
    this.group.add(this.terrain.group, this.water.group);
    this.plantScenery();
  }

  /** Windmills on the meadow, boats and swans on the lake, balloons over everything. */
  private plantScenery(): void {
    const { track, land } = this.road;
    const rng = mulberry32((this.level.seed ^ 0x7c15) >>> 0);
    const add = (kind: ScenicKind, s: number, x: number, y?: number, yaw = 0) => {
      const p = track.toWorld(x, 0, s, this.point);
      const wet = kind === 'sailboat' || kind === 'swan' || kind === 'lighthouse';
      const ground = land.heightAt(p.x, p.z);
      if (wet && ground > WATER_Y - 0.5) return false;
      const rig = this.lib.createScenicRig(kind, this.level.seed + this.scenic.length * 31);
      const px = p.x;
      const pz = p.z;
      rig.group.position.set(px, y ?? (wet ? WATER_Y : ground), pz);
      rig.group.rotation.y = yaw;
      rig.group.visible = false;
      this.group.add(rig.group);
      this.scenic.push({ rig, kind, s });
      return true;
    };
    const side = () => (rng() < 0.5 ? -1 : 1);
    for (const span of track.route) {
      const from = Math.max(span.from, 40);
      const to = Math.min(span.to, this.level.length);
      const at = (t: number) => from + (to - from) * t;
      const heading = (s: number) => track.sample(s).heading;
      switch (span.area) {
        case 'meadow':
          for (const t of [0.3, 0.78]) {
            // Outside of the nearest bend, where the road points right at it.
            let s = at(t);
            for (let probe = at(t - 0.16); probe < at(t + 0.16); probe += 6) {
              if (Math.abs(track.sample(probe).curvature) > Math.abs(track.sample(s).curvature)) s = probe;
            }
            const bend = track.sample(s).curvature;
            const dir = bend === 0 ? side() : bend > 0 ? -1 : 1;
            // Sails turn toward the oncoming car, or they'd be edge-on all the way up the road.
            const h = heading(s);
            const faceX = -0.85 * Math.sin(h) - 0.5 * dir * Math.cos(h);
            const faceZ = 0.85 * Math.cos(h) - 0.5 * dir * Math.sin(h);
            add('windmill', s, dir * range(rng, 37, 43), undefined, Math.atan2(faceX, faceZ));
          }
          for (const t of [0.15, 0.6, 0.95]) add('balloon', at(t), side() * range(rng, 60, 130), track.sample(at(t)).y + range(rng, 26, 46));
          break;
        case 'lake':
          for (const t of [0.15, 0.4, 0.7, 0.95]) add('sailboat', at(t), side() * range(rng, 44, 86), undefined, rng() * 6.28);
          for (const t of [0.1, 0.3, 0.55, 0.8]) add('swan', at(t), side() * range(rng, 25, 40));
          add('lighthouse', at(0.55), side() * range(rng, 70, 95));
          add('balloon', at(0.6), side() * range(rng, 70, 140), track.sample(at(0.6)).y + range(rng, 30, 46));
          break;
        case 'castle':
          add('balloon', at(0.35), side() * range(rng, 70, 130), track.sample(at(0.35)).y + range(rng, 30, 50));
          add('balloon', at(0.7), side() * range(rng, 70, 130), track.sample(at(0.7)).y + range(rng, 34, 56));
          break;
        case 'town':
          add('balloon', at(0.6), side() * range(rng, 80, 130), track.sample(at(0.6)).y + range(rng, 30, 44));
          break;
        default:
          break;
      }
    }
  }

  /** Build every chunk up front (~10 ms each) so driving never hitches. */
  async build(onProgress?: (p: number) => void): Promise<void> {
    const L = this.lib.chunkLength;
    const length = this.level.length;
    const first = FIRST_CHUNK;
    const last = Math.ceil((length + 48) / L) - 1;
    const homeChunks = new Set([-1, 0]);
    const castleFrom = Math.floor((length - 12) / L);
    const total = last - first + 1;
    let done = 0;
    let frameStart = performance.now();
    for (let i = first; i <= last; i += 1) {
      const opts = homeChunks.has(i)
        ? { clearLeft: true }
        : i >= castleFrom
          ? { clearLeft: true, clearRight: true }
          : undefined;
      // Town chunk indices are offset so every level starts in a different part of town.
      const area = areaAt(this.road.track.route, i * L + 1);
      const opens = this.road.track.route.some((r) => r.from === i * L);
      const chunk = area === 'town' || opts ? this.lib.buildTownChunk(i + 3, this.level.seed, opts) : this.lib.buildCountryChunk(i + 3, this.level.seed, area, { gateway: opens });
      warpChunk(chunk.group, -i * L, this.road);
      chunk.group.visible = false;
      freeze(chunk.group);
      this.group.add(chunk.group);
      if (chunk.far) warpChunk(chunk.far, -i * L, this.road);
      this.built.push(chunk);
      const casts: THREE.Mesh[] = [];
      chunk.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh && mesh.castShadow) casts.push(mesh);
      });
      this.placed.push({ object: chunk.group, z0: -i * L, z1: -i * L - L, casts, shadows: true });
      done += 1;
      onProgress?.(done / total);
      // Keep the loading screen animating: yield roughly every frame's worth of work.
      if (performance.now() - frameStart > 24) {
        await nextFrame();
        frameStart = performance.now();
      }
    }
    this.mergeFarScenery();
    this.plantGrass();
  }

  /** Grass grows along the whole road, except on the plazas the chunks laid out. */
  private plantGrass(): void {
    const L = this.lib.chunkLength;
    const paved = (x: number, s: number) => {
      const index = Math.floor(s / L);
      const plazas = this.built[index - FIRST_CHUNK]?.group.userData.plazas as Rect[] | undefined;
      const z = index * L - s;
      return plazas?.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) ?? false;
    };
    const beds = this.built.flatMap((chunk, i) => {
      const planted = (chunk.group.userData.beds ?? []) as Array<{ x: number; z: number; color: string }>;
      return planted.map((b) => ({ x: b.x, s: (i + FIRST_CHUNK) * L - b.z, color: b.color }));
    });
    this.grass = new Grass(this.road, this.level.seed, this.level.length, paved, beds);
    this.group.add(this.grass.group);
  }

  private mergeFarScenery(): void {
    const byMaterial = new Map<THREE.Material, Array<THREE.BufferGeometry | null>>();
    this.built.forEach((chunk, i) => {
      for (const child of chunk.far?.children ?? []) {
        const mesh = child as THREE.Mesh;
        const material = mesh.material as THREE.Material;
        if (!byMaterial.has(material)) byMaterial.set(material, new Array<THREE.BufferGeometry | null>(this.built.length).fill(null));
        byMaterial.get(material)![i] = mesh.geometry;
      }
    });
    for (const [material, parts] of byMaterial) {
      const present = parts.filter((g): g is THREE.BufferGeometry => g !== null);
      const merged = mergeGeometries(present);
      if (!merged) continue;
      const starts = [0];
      for (const g of parts) starts.push(starts[starts.length - 1] + (g?.index?.count ?? 0));
      const mesh = new THREE.Mesh(merged, material);
      mesh.name = 'far-scenery';
      mesh.frustumCulled = false;
      mesh.visible = false;
      freeze(mesh);
      this.group.add(mesh);
      this.farRuns.push({ mesh, starts });
    }
    // The merged copies replace the per-chunk stand-ins.
    for (const chunk of this.built) {
      chunk.far?.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
    }
  }

  /**
   * @param lookBehind how far behind the viewer to keep chunks (large on the title screen,
   *   where the camera looks back up the street; small while chasing the car).
   */
  update(dt: number, time: number, sim: Sim, viewZ: number, lookBehind = VIEW_BEHIND, tier: QualityTier = 'high'): void {
    const view = VIEW[tier];
    // Chunk visibility window around the viewer.
    let farFrom = -1;
    let farTo = -1;
    for (let i = 0; i < this.placed.length; i += 1) {
      const c = this.placed[i];
      const near = c.z1 < viewZ + lookBehind && c.z0 > viewZ - view.near;
      c.object.visible = near;
      if (!near && c.z1 < viewZ + lookBehind && c.z0 > viewZ - view.far) {
        if (farFrom < 0) farFrom = i;
        farTo = i;
      }
      const shadows = near && c.z1 < viewZ + SHADOW_BEHIND && c.z0 > viewZ - view.shadow;
      if (shadows !== c.shadows) {
        c.shadows = shadows;
        for (const mesh of c.casts) mesh.castShadow = shadows;
      }
    }
    for (const run of this.farRuns) {
      const start = farFrom < 0 ? 0 : run.starts[farFrom];
      const end = farFrom < 0 ? 0 : run.starts[farTo + 1];
      run.mesh.visible = end > start;
      run.mesh.geometry.setDrawRange(start, end - start);
    }
    this.terrain?.update(-viewZ, lookBehind, tier);
    this.grass?.update(-viewZ, tier);
    this.home.group.visible = viewZ > -190;
    // The castle stands on its hill, in view from far down the road.
    this.castle.group.visible = viewZ < -this.level.length + view.castle;
    if (this.home.group.visible) this.home.update(dt, time);
    if (this.castle.group.visible) this.castle.update(dt, time);

    for (const o of sim.obstacles) {
      const rig = this.obstacles.get(o.id);
      if (!rig) continue;
      const visible = o.z < viewZ + 30 && o.z > viewZ - view.near;
      rig.root.visible = visible;
      if (!visible) continue;
      const driftX = dt > 0 ? (o.x - (rig.root.userData.roadX as number)) / dt : 0;
      this.placeObstacle(rig, o.x, o.z);
      rig.update(dt, time, driftX);
    }

    for (const p of this.scenic) {
      const shown = Math.abs(p.s + viewZ) < SCENIC_RANGE[p.kind] * view.scenic;
      p.rig.group.visible = shown;
      if (shown) p.rig.update(dt, time);
    }

    this.updateCoins(time, sim, viewZ, view.coin);
  }

  private placeObstacle(rig: ObstacleRig, x: number, z: number): void {
    const track = this.road.track;
    track.toWorld(x, 0, -z, this.point);
    rig.root.position.set(this.point.x, this.point.y, this.point.z);
    rig.root.rotation.y = -track.sample(-z).heading;
    rig.root.userData.roadX = x;
  }

  /** The horn: nearby scenery answers it. */
  honk(s: number): void {
    for (const p of this.scenic) if (p.rig.group.visible && Math.abs(p.s - s) < 150) p.rig.react?.();
  }

  obstacle(id: number): ObstacleRig | undefined {
    return this.obstacles.get(id);
  }

  dispose(): void {
    for (const c of this.built) c.dispose();
    for (const rig of this.obstacles.values()) rig.dispose();
    for (const p of this.scenic) p.rig.dispose();
    for (const run of this.farRuns) run.mesh.geometry.dispose();
    this.terrain?.dispose();
    this.water?.dispose();
    this.grass?.dispose();
    // Coin/gem geometries are created per level (the caller owns them).
    this.coins.geometry.dispose();
    this.farCoins.geometry.dispose();
    this.gems.geometry.dispose();
    this.coins.dispose();
    this.farCoins.dispose();
    this.gems.dispose();
    this.group.removeFromParent();
  }

  private updateCoins(time: number, sim: Sim, viewZ: number, fullCoins: number): void {
    let coinCount = 0;
    let farCount = 0;
    let gemCount = 0;
    const car = sim.car;
    for (const c of sim.coins) {
      if (c.z > viewZ + 12 || c.z < viewZ - COIN_AHEAD) continue;
      let x = c.x;
      let y = c.y;
      let z = c.z;
      let scale = 1;
      let spin = time * (c.kind === 'gem' ? 1.6 : 2.8) + c.id * 0.7;
      if (!c.alive) {
        if (c.collectedAt < 0) continue;
        const t = (sim.time - c.collectedAt) / PICKUP_TIME;
        if (t >= 1) continue;
        // Zip into the car with a little pop.
        const e = t * t;
        x = THREE.MathUtils.lerp(c.x, car.x, e);
        z = THREE.MathUtils.lerp(c.z, car.z - 0.3, e);
        y = THREE.MathUtils.lerp(c.y, 2.2, Math.sin(t * Math.PI * 0.5)) + Math.sin(t * Math.PI) * 0.6;
        scale = t < 0.2 ? 1 + t * 1.5 : (1.3 * (1 - t)) / 0.8;
        spin += t * 12;
      } else if (c.flying) {
        spin *= 3;
      } else {
        y += Math.sin(time * 2.4 + c.id * 0.9) * 0.09;
      }
      if (c.kind === 'gem') {
        y += 0.15;
        scale *= 1.0 + Math.sin(time * 3 + c.id) * 0.05;
      }
      this.rotation.makeRotationY(spin);
      this.scaleM.makeScale(scale, scale, scale);
      this.road.track.toWorld(x, y, -z, this.point);
      this.matrix.multiplyMatrices(this.rotation, this.scaleM).setPosition(this.point.x, this.point.y, this.point.z);
      if (c.kind === 'gem') {
        if (gemCount < this.gems.instanceMatrix.count) this.gems.setMatrixAt(gemCount++, this.matrix);
      } else if (z < viewZ - fullCoins) {
        if (farCount < this.farCoins.instanceMatrix.count) this.farCoins.setMatrixAt(farCount++, this.matrix);
      } else if (coinCount < this.coins.instanceMatrix.count) {
        this.coins.setMatrixAt(coinCount++, this.matrix);
      }
    }
    this.coins.count = coinCount;
    this.farCoins.count = farCount;
    this.farCoins.instanceMatrix.needsUpdate = true;
    this.gems.count = gemCount;
    this.coins.instanceMatrix.needsUpdate = true;
    this.gems.instanceMatrix.needsUpdate = true;
  }
}
