import * as THREE from 'three';
import type { Track, WorldPoint } from '../sim/track';
import { REDUCED_MOTION } from './look';

export interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

const tmpDir = new THREE.Vector3();
const tmpPoint: WorldPoint = { x: 0, y: 0, z: 0 };

function damp(current: number, target: number, lambda: number, dt: number): number {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/**
 * Chase camera with aspect-aware framing, plus a smooth "director" blend used by
 * the title orbit, intro and finish cinematics. Every mode produces a desired
 * pose; the rig eases toward it so transitions never snap.
 */
export class CameraRig {
  readonly pose: CameraPose = { position: new THREE.Vector3(0, 4, 9), target: new THREE.Vector3(0, 1, -5), fov: 52 };
  private readonly desired: CameraPose = { position: new THREE.Vector3(), target: new THREE.Vector3(), fov: 52 };
  private shake = 0;
  private shakeSeed = 0;
  private roll = 0;
  /** 0 = snap, larger = smoother. Set per mode by the game. */
  followLambda = 4;
  targetLambda = 6;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  /**
   * Chase framing along the road: the camera rides the road a little behind the
   * car and looks further up it, so bends and hills read ahead of time.
   * Portrait screens get a wider, higher view so the road fits.
   */
  chase(track: Track, s: number, carX: number, steer: number, speed: number, aspect: number): CameraPose {
    const portrait = Math.max(0, Math.min(1, (1.25 - aspect) / 0.75));
    // Close enough that the car and princess read big and friendly on screen.
    const back = 5.7 + portrait * 2.3;
    const height = 2.85 + portrait * 1.9;
    const d = this.desired;
    track.toWorld(carX * 0.75 + steer * 0.3, height, s - back, tmpPoint);
    d.position.set(tmpPoint.x, tmpPoint.y, tmpPoint.z);
    // Portrait screens look down more steeply so the road (not the sky) fills the tall view.
    track.toWorld(carX * 0.88 + steer * 0.55, 1.2 - portrait * 0.55, s + 7 - portrait * 1.0, tmpPoint);
    d.target.set(tmpPoint.x, tmpPoint.y, tmpPoint.z);
    // Keep ~7.5 units of road visible at the car's depth regardless of aspect.
    const depth = Math.hypot(back, height);
    const wanted = THREE.MathUtils.radToDeg(2 * Math.atan(7.6 / (2 * depth * Math.max(aspect, 0.3))));
    d.fov = THREE.MathUtils.clamp(Math.max(50 + speed * 0.25, wanted), 48, 82);
    this.roll = REDUCED_MOTION ? 0 : damp(this.roll, -steer * 0.035, 5, 1 / 60);
    return d;
  }

  /** Orbit around a target (title screen, finish celebration). */
  orbit(target: THREE.Vector3, radius: number, height: number, angle: number, fov = 42, aspect = 1.6): CameraPose {
    const portrait = Math.max(0, Math.min(1, (1.25 - aspect) / 0.75));
    const r = radius * (1 + portrait * 0.55);
    const d = this.desired;
    d.position.set(target.x + Math.sin(angle) * r, target.y + height + portrait * 0.6, target.z + Math.cos(angle) * r);
    d.target.copy(target);
    d.fov = fov + portrait * 14;
    this.roll = 0;
    return d;
  }

  /** Explicit pose (scripted shots). */
  look(position: THREE.Vector3, target: THREE.Vector3, fov = 45): CameraPose {
    const d = this.desired;
    d.position.copy(position);
    d.target.copy(target);
    d.fov = fov;
    this.roll = 0;
    return d;
  }

  addShake(amount: number): void {
    if (REDUCED_MOTION) return;
    this.shake = Math.min(0.5, this.shake + amount);
  }

  snap(): void {
    this.pose.position.copy(this.desired.position);
    this.pose.target.copy(this.desired.target);
    this.pose.fov = this.desired.fov;
    this.apply(0);
  }

  update(dt: number): void {
    const p = this.pose;
    const d = this.desired;
    const k = 1 - Math.exp(-this.followLambda * dt);
    const kt = 1 - Math.exp(-this.targetLambda * dt);
    p.position.lerp(d.position, k);
    p.target.lerp(d.target, kt);
    p.fov = damp(p.fov, d.fov, 3, dt);
    this.shake = Math.max(0, this.shake - dt * 1.8);
    this.apply(dt);
  }

  private apply(dt: number): void {
    const cam = this.camera;
    cam.position.copy(this.pose.position);
    if (this.shake > 0) {
      this.shakeSeed += dt * 40;
      const s = this.shake * this.shake;
      cam.position.x += Math.sin(this.shakeSeed * 1.7) * s * 0.6;
      cam.position.y += Math.sin(this.shakeSeed * 2.3 + 1.1) * s * 0.4;
    }
    cam.lookAt(this.pose.target);
    tmpDir.set(0, 0, -1).applyQuaternion(cam.quaternion);
    cam.rotateOnWorldAxis(tmpDir, this.roll);
    if (Math.abs(cam.fov - this.pose.fov) > 0.01) {
      cam.fov = this.pose.fov;
      cam.updateProjectionMatrix();
    }
  }
}
