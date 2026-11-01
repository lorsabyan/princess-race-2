import * as THREE from 'three';
import type { ObstacleKind, ObstacleRig } from '../items/rig';
import { mat } from '../kit/materials';
import { PAL } from '../kit/palette';
import { makeRng } from '../town/rng';
import { sheep, springMushroom } from './prefabs';

/**
 * Countryside obstacles. Same contract as the items in ../items: origin at ground
 * level, centered on the collision footprint, facing the approaching car.
 */

function solidMesh(geometry: THREE.BufferGeometry): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, mat('matte'));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

interface Walker {
  mesh: THREE.Mesh;
  home: THREE.Vector2;
  off: THREE.Vector2;
  phase: number;
  y: number;
  vy: number;
  /** Seconds until a queued hop starts (negative when none is queued). */
  wait: number;
  yaw: number;
  scale: number;
}

const FLOCK: ReadonlyArray<readonly [number, number, number]> = [
  [-0.62, 0.12, 1.05],
  [0.55, -0.2, 0.95],
  [0.02, 0.42, 0.8],
];

/** A small flock wandering across the road. They bounce off the car with a hop. */
class SheepRig implements ObstacleRig {
  readonly root = new THREE.Group();
  readonly kind: ObstacleKind = 'sheep';
  readonly halfWidth = 1.0;
  readonly halfDepth = 0.6;
  private readonly flock: Walker[] = [];

  constructor(seed: number) {
    const rng = makeRng(seed + 811);
    FLOCK.forEach(([x, z, scale], i) => {
      const geometry = sheep(i).matte!;
      const mesh = solidMesh(geometry);
      this.root.add(mesh);
      this.flock.push({ mesh, home: new THREE.Vector2(x, z), off: new THREE.Vector2(), phase: rng.range(0, 6.28), y: 0, vy: 0, wait: -1, yaw: 0, scale });
    });
  }

  update(dt: number, time: number, driftX = 0): void {
    const facing = driftX >= 0 ? 0 : Math.PI;
    const moving = Math.min(1, Math.abs(driftX) / 0.25);
    for (const s of this.flock) {
      if (s.wait >= 0) {
        s.wait -= dt;
        if (s.wait < 0) s.vy = 4.4 + (s.phase % 1) * 0.8;
      }
      if (s.vy !== 0 || s.y > 0) {
        s.vy -= 13 * dt;
        s.y += s.vy * dt;
        if (s.y <= 0) {
          s.y = 0;
          s.vy = 0;
        }
      }
      s.yaw += (facing - s.yaw) * (1 - Math.exp(-5 * dt));
      const step = Math.abs(Math.sin(time * 5.4 + s.phase)) * 0.055 * moving;
      s.mesh.position.set(s.home.x + s.off.x, s.y + step, s.home.y + s.off.y);
      s.mesh.rotation.set(0, s.yaw, Math.sin(time * 5.4 + s.phase) * 0.05 * moving);
      s.mesh.scale.setScalar(s.scale);
    }
  }

  react(side: -1 | 1): void {
    this.flock.forEach((s, i) => {
      s.wait = i * 0.07;
      s.off.x = Math.max(-1, Math.min(1, s.off.x + side * 0.4));
    });
  }

  reset(): void {
    for (const s of this.flock) {
      s.y = 0;
      s.vy = 0;
      s.wait = -1;
      s.off.set(0, 0);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.clear();
  }
}

interface Spring {
  mesh: THREE.Mesh;
  base: number;
  /** Squash amount (negative = squashed flat) and its velocity. */
  s: number;
  v: number;
  wait: number;
  phase: number;
}

const CLUMP: ReadonlyArray<readonly [number, number, number, string]> = [
  [-0.56, 0.12, 1.15, PAL.flowerRed],
  [0.5, -0.18, 0.9, PAL.roofLilac],
  [0.08, 0.4, 0.62, '#ff8fb1'],
];

/** A clump of bouncy toadstools: a bump makes them boing. */
class MushroomRig implements ObstacleRig {
  readonly root = new THREE.Group();
  readonly kind: ObstacleKind = 'mushrooms';
  readonly halfWidth = 1.0;
  readonly halfDepth = 0.7;
  private readonly clump: Spring[] = [];

  constructor(seed: number) {
    const rng = makeRng(seed + 977);
    CLUMP.forEach(([x, z, base, cap]) => {
      const mesh = solidMesh(springMushroom(cap).matte!);
      mesh.position.set(x, 0, z);
      mesh.rotation.y = rng.range(0, 6.28);
      this.root.add(mesh);
      this.clump.push({ mesh, base, s: 0, v: 0, wait: -1, phase: rng.range(0, 6.28) });
    });
  }

  update(dt: number, time: number): void {
    const omega = 17;
    const damping = 0.22;
    const step = Math.min(dt, 1 / 30);
    for (const m of this.clump) {
      if (m.wait >= 0) {
        m.wait -= dt;
        if (m.wait < 0) m.v = -5.5;
      }
      m.v += (-omega * omega * m.s - 2 * damping * omega * m.v) * step;
      m.s += m.v * step;
      const breathe = Math.sin(time * 1.7 + m.phase) * 0.012;
      const sy = 1 + m.s + breathe;
      const sxz = 1 - (m.s + breathe) * 0.5;
      m.mesh.scale.set(m.base * sxz, m.base * sy, m.base * sxz);
    }
  }

  react(): void {
    this.clump.forEach((m, i) => {
      m.wait = i * 0.05;
    });
  }

  reset(): void {
    for (const m of this.clump) {
      m.s = 0;
      m.v = 0;
      m.wait = -1;
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.clear();
  }
}

export function createSheep(seed = 0): ObstacleRig {
  return new SheepRig(seed);
}

export function createMushrooms(seed = 0): ObstacleRig {
  return new MushroomRig(seed);
}
