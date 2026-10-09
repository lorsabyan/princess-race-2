import * as THREE from 'three';
import type { LevelData } from '../sim/level';
import type { Sim } from '../sim/Sim';
import type { Landmark, ModelLibrary, ObstacleRig, PrincessHome, TownChunk } from '../models/contracts';

// The curved world drops everything past ~120 m below the horizon; don't draw beyond it.
const VIEW_AHEAD = 130;
const COIN_AHEAD = 125;
const VIEW_BEHIND = 70;
/** Coins closer than this cast shadows (the sun's shadow box reaches ~34 m ahead). */
const SHADOW_COIN_RANGE = 36;
const PICKUP_TIME = 0.32;

interface PlacedChunk {
  object: THREE.Object3D;
  z0: number; // near edge (larger z)
  z1: number; // far edge
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
  private readonly matrix = new THREE.Matrix4();
  private readonly rotation = new THREE.Matrix4();
  private readonly scaleM = new THREE.Matrix4();

  constructor(
    private readonly lib: ModelLibrary,
    readonly level: LevelData,
    private readonly home: PrincessHome,
    private readonly castle: Landmark,
  ) {
    const capacity = level.coins.length + 40;
    this.coins = new THREE.InstancedMesh(lib.createCoinGeometry(), lib.coinMaterial(), capacity);
    this.coins.name = 'coins';
    this.coins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.coins.frustumCulled = false;
    this.coins.castShadow = true;
    this.coins.count = 0;
    // Distant coins skip the shadow pass (their shadows are too small to see).
    this.farCoins = new THREE.InstancedMesh(this.coins.geometry, this.coins.material, capacity);
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
    castle.group.position.set(0, 0, -level.length);
    this.group.add(home.group, castle.group);

    for (const o of level.obstacles) {
      const rig = lib.createObstacle(o.kind, level.seed + o.id);
      rig.root.position.set(o.x, 0, o.z);
      rig.root.visible = false;
      this.obstacles.set(o.id, rig);
      this.group.add(rig.root);
    }
  }

  /** Build every street chunk up front (~10 ms each) so driving never hitches. */
  async build(onProgress?: (p: number) => void): Promise<void> {
    const L = this.lib.chunkLength;
    const length = this.level.length;
    const first = -3;
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
      // Chunk indices are offset so every level starts in a different part of town.
      const chunk = this.lib.buildTownChunk(i + 3, this.level.seed, opts);
      chunk.group.position.z = -i * L;
      chunk.group.visible = false;
      this.group.add(chunk.group);
      this.built.push(chunk);
      this.placed.push({ object: chunk.group, z0: -i * L, z1: -i * L - L });
      done += 1;
      onProgress?.(done / total);
      // Keep the loading screen animating: yield roughly every frame's worth of work.
      if (performance.now() - frameStart > 24) {
        await nextFrame();
        frameStart = performance.now();
      }
    }
  }

  /**
   * @param lookBehind how far behind the viewer to keep chunks (large on the title screen,
   *   where the camera looks back up the street; small while chasing the car).
   */
  update(dt: number, time: number, sim: Sim, viewZ: number, lookBehind = VIEW_BEHIND): void {
    // Chunk visibility window around the viewer.
    for (const c of this.placed) {
      c.object.visible = c.z1 < viewZ + lookBehind && c.z0 > viewZ - VIEW_AHEAD;
    }
    this.home.group.visible = viewZ > -190;
    // The castle only rises over the curved horizon in the last ~150 m.
    this.castle.group.visible = viewZ < -this.level.length + 190;
    if (this.home.group.visible) this.home.update(dt, time);
    if (this.castle.group.visible) this.castle.update(dt, time);

    for (const o of sim.obstacles) {
      const rig = this.obstacles.get(o.id);
      if (!rig) continue;
      const visible = o.z < viewZ + 30 && o.z > viewZ - VIEW_AHEAD;
      rig.root.visible = visible;
      if (!visible) continue;
      const driftX = dt > 0 ? (o.x - rig.root.position.x) / dt : 0;
      rig.root.position.x = o.x;
      rig.update(dt, time, driftX);
    }

    this.updateCoins(time, sim, viewZ);
  }

  obstacle(id: number): ObstacleRig | undefined {
    return this.obstacles.get(id);
  }

  dispose(): void {
    for (const c of this.built) c.dispose();
    for (const rig of this.obstacles.values()) rig.dispose();
    // Coin/gem geometries are created per level (the caller owns them).
    this.coins.geometry.dispose();
    this.gems.geometry.dispose();
    this.coins.dispose();
    this.farCoins.dispose();
    this.gems.dispose();
    this.group.removeFromParent();
  }

  private updateCoins(time: number, sim: Sim, viewZ: number): void {
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
      this.matrix.multiplyMatrices(this.rotation, this.scaleM).setPosition(x, y, z);
      if (c.kind === 'gem') {
        if (gemCount < this.gems.instanceMatrix.count) this.gems.setMatrixAt(gemCount++, this.matrix);
      } else if (z < viewZ - SHADOW_COIN_RANGE) {
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
