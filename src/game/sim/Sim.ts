import { FOOTPRINTS, TUNING, starsFor, type ObstacleKind } from './config';
import { obstacleX, type LevelData } from './level';
import { mulberry32, range, type Rng } from './rng';

export type SimPhase = 'ready' | 'drive' | 'finish' | 'done';

export type SimEvent =
  | { type: 'coin'; id: number; x: number; z: number; combo: number }
  | { type: 'gem'; id: number; x: number; z: number }
  | { type: 'bump'; obstacleId: number; kind: ObstacleKind; side: -1 | 1; lost: number }
  | { type: 'splash'; obstacleId: number }
  | { type: 'coinsLost'; ids: number[] }
  | { type: 'finish' }
  | { type: 'stopped' };

export interface CoinState {
  id: number;
  kind: 'coin' | 'gem';
  x: number;
  y: number;
  z: number;
  alive: boolean;
  /** Sim time when collected (for pickup animation), -1 if not collected. */
  collectedAt: number;
  /** Popped coins fly in an arc before they settle and become catchable pickups again. */
  vx: number;
  vy: number;
  vz: number;
  flying: boolean;
  /** Coins created by bumps (not part of the level total). */
  bonus: boolean;
}

export interface ObstacleState {
  id: number;
  kind: ObstacleKind;
  x: number;
  z: number;
  hit: boolean;
}

export interface CarSim {
  x: number;
  z: number;
  vx: number;
  targetX: number;
  speed: number;
  /** 0..1 bump impulse for visuals (decays). */
  bump: number;
  invulnerable: number;
  slow: number;
}

/**
 * Pure gameplay simulation (no rendering). Step it at a fixed rate; read state
 * and drain `events` for effects/audio/UI. There is no fail state: bumps slow
 * the car and knock a few coins loose, and every run ends at the castle.
 */
export class Sim {
  phase: SimPhase = 'ready';
  time = 0;
  readonly car: CarSim = { x: 0, z: 0, vx: 0, targetX: 0, speed: 0, bump: 0, invulnerable: 0, slow: 0 };
  readonly coins: CoinState[];
  readonly obstacles: ObstacleState[];
  readonly events: SimEvent[] = [];
  readonly totalCoins: number;
  collected = 0;
  gems = 0;
  bumps = 0;
  combo = 0;
  private lastCoinTime = -10;
  private readonly rng: Rng;
  private finishZ: number;

  constructor(readonly level: LevelData) {
    this.rng = mulberry32(level.seed ^ 0x5bd1e995);
    this.coins = level.coins.map((c) => ({
      id: c.id,
      kind: c.kind,
      x: c.x,
      y: TUNING.coinHover,
      z: c.z,
      alive: true,
      collectedAt: -1,
      vx: 0,
      vy: 0,
      vz: 0,
      flying: false,
      bonus: false,
    }));
    this.obstacles = level.obstacles.map((o) => ({ id: o.id, kind: o.kind, x: o.x, z: o.z, hit: false }));
    this.totalCoins = level.coins.filter((c) => c.kind === 'coin').length;
    this.finishZ = -level.length;
  }

  start(): void {
    if (this.phase === 'ready') this.phase = 'drive';
  }

  /** QA helper: begin further along the road at full speed (coins behind are skipped). */
  warpTo(distance: number): void {
    const z = -Math.max(0, Math.min(distance, this.level.length - 1));
    this.car.z = z;
    this.car.speed = this.level.speed;
    for (const c of this.coins) if (c.z > z) c.alive = false;
  }

  /** Desired lateral position (world x). */
  setTargetX(x: number): void {
    if (this.phase === 'finish' || this.phase === 'done') return;
    this.car.targetX = Math.max(-TUNING.driveHalf, Math.min(TUNING.driveHalf, x));
  }

  get distance(): number {
    return -this.car.z;
  }

  get progress(): number {
    return Math.max(0, Math.min(1, this.distance / this.level.length));
  }

  get stars(): number {
    return starsFor(this.collected, this.totalCoins);
  }

  step(dt: number): void {
    this.time += dt;
    const car = this.car;
    car.bump = Math.max(0, car.bump - dt * 2.2);
    car.invulnerable = Math.max(0, car.invulnerable - dt);
    car.slow = Math.max(0, car.slow - dt / TUNING.bumpRecover);

    this.stepSteering(dt);
    this.stepSpeed(dt);
    car.z -= car.speed * dt;

    for (const o of this.obstacles) {
      const spawn = this.level.obstacles[o.id];
      o.x = obstacleX(spawn, this.time);
    }

    this.stepFlyingCoins(dt);
    if (this.phase === 'drive' || this.phase === 'finish') this.collectCoins();
    if (this.phase === 'drive') {
      this.checkObstacles();
      if (car.z <= this.finishZ) {
        this.phase = 'finish';
        this.events.push({ type: 'finish' });
      }
    }
  }

  private stepSteering(dt: number): void {
    const car = this.car;
    if (this.phase === 'finish' || this.phase === 'done') car.targetX = car.targetX * Math.exp(-dt * 1.5);
    const w = TUNING.steerOmega;
    const ax = w * w * (car.targetX - car.x) - 2 * w * car.vx;
    car.vx += ax * dt;
    car.x += car.vx * dt;
    if (Math.abs(car.x) > TUNING.driveHalf) {
      car.x = Math.sign(car.x) * TUNING.driveHalf;
      car.vx = 0;
    }
  }

  private stepSpeed(dt: number): void {
    const car = this.car;
    if (this.phase === 'ready' || this.phase === 'done') {
      car.speed = Math.max(0, car.speed - TUNING.accel * 2 * dt);
      return;
    }
    if (this.phase === 'finish') {
      const remaining = car.z - (this.finishZ - TUNING.finishRunout);
      if (remaining <= 0.05 || car.speed < 0.15) {
        car.speed = 0;
        this.phase = 'done';
        this.events.push({ type: 'stopped' });
        return;
      }
      // v^2 = 2 a d -> decelerate to stop exactly at the runout point.
      const decel = (car.speed * car.speed) / (2 * Math.max(0.5, remaining));
      car.speed = Math.max(0.1, car.speed - decel * dt);
      return;
    }
    const cruise = this.level.speed * (1 - TUNING.bumpSlow * car.slow);
    const diff = cruise - car.speed;
    const rate = diff > 0 ? TUNING.accel : TUNING.accel * 3;
    car.speed += Math.sign(diff) * Math.min(Math.abs(diff), rate * dt);
  }

  private collectCoins(): void {
    const car = this.car;
    for (const coin of this.coins) {
      if (!coin.alive) continue;
      const dz = coin.z - car.z;
      if (dz > TUNING.pickupHalfLength || dz < -TUNING.pickupHalfLength) continue;
      if (Math.abs(coin.x - car.x) > TUNING.pickupHalfWidth) continue;
      if (coin.flying && coin.y > 2.4) continue;
      coin.alive = false;
      coin.flying = false;
      coin.collectedAt = this.time;
      if (coin.kind === 'gem') {
        this.gems += 1;
        this.collected += 5;
        this.events.push({ type: 'gem', id: coin.id, x: coin.x, z: coin.z });
      } else {
        this.combo = this.time - this.lastCoinTime <= TUNING.comboWindow ? this.combo + 1 : 1;
        this.lastCoinTime = this.time;
        this.collected += 1;
        this.events.push({ type: 'coin', id: coin.id, x: coin.x, z: coin.z, combo: this.combo });
      }
    }
  }

  private checkObstacles(): void {
    const car = this.car;
    for (const o of this.obstacles) {
      if (o.hit) continue;
      const fp = FOOTPRINTS[o.kind];
      const dz = Math.abs(o.z - car.z);
      if (dz > fp.halfDepth * 0.9 + TUNING.carHalfLength) continue;
      const dx = car.x - o.x;
      if (Math.abs(dx) > fp.halfWidth * 0.88 + TUNING.carHalfWidth) continue;
      if (o.kind === 'puddle') {
        o.hit = true;
        this.events.push({ type: 'splash', obstacleId: o.id });
        continue;
      }
      if (car.invulnerable > 0) continue;
      o.hit = true;
      const side: -1 | 1 = dx >= 0 ? 1 : -1;
      car.bump = 1;
      car.invulnerable = TUNING.invulnerable;
      car.slow = 1;
      car.vx += side * 5;
      this.bumps += 1;
      this.combo = 0;
      const lost = Math.min(TUNING.bumpCoinLoss, this.collected);
      this.collected -= lost;
      const ids = this.popCoins(lost);
      this.events.push({ type: 'bump', obstacleId: o.id, kind: o.kind, side, lost });
      if (ids.length) this.events.push({ type: 'coinsLost', ids });
    }
  }

  /** Knocked-loose coins arc forward and settle ahead of the car, easy to catch again. */
  private popCoins(count: number): number[] {
    const ids: number[] = [];
    const car = this.car;
    for (let i = 0; i < count; i += 1) {
      const spread = count > 1 ? i / (count - 1) - 0.5 : 0;
      const coin: CoinState = {
        id: this.coins.length,
        kind: 'coin',
        x: car.x,
        y: 1.3,
        z: car.z - 1.2,
        alive: true,
        collectedAt: -1,
        vx: spread * 4.5 + range(this.rng, -0.5, 0.5) - car.x * 0.35,
        vy: range(this.rng, 6.2, 7.4),
        vz: -(car.speed + range(this.rng, 5, 8)),
        flying: true,
        bonus: true,
      };
      this.coins.push(coin);
      ids.push(coin.id);
    }
    return ids;
  }

  private stepFlyingCoins(dt: number): void {
    for (const coin of this.coins) {
      if (!coin.flying || !coin.alive) continue;
      coin.vy -= 16 * dt;
      coin.x += coin.vx * dt;
      coin.y += coin.vy * dt;
      coin.z += coin.vz * dt;
      coin.vx *= Math.exp(-dt * 1.5);
      coin.vz *= Math.exp(-dt * 1.2);
      coin.x = Math.max(-2.9, Math.min(2.9, coin.x));
      if (coin.vy < 0 && coin.y <= TUNING.coinHover) {
        coin.y = TUNING.coinHover;
        coin.flying = false;
        coin.vx = coin.vy = coin.vz = 0;
      }
    }
  }
}
