import * as THREE from 'three';
import { LOOK_NOW } from './look';

/** Direction *toward* the sun. */
export const SUN_DIR = new THREE.Vector3(...LOOK_NOW.sunDir).normalize();

/**
 * Key + fill lighting. The sun casts soft PCF shadows inside a box that follows
 * the player (snapped to shadow texels so edges never shimmer). Ambient fill comes
 * mostly from the sky environment map; a weak hemisphere light adds warmth.
 */
export class Lighting {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly rim: THREE.DirectionalLight;
  private readonly extent = { left: -27, right: 27, top: 27, bottom: -27 };
  private readonly lightSpace = new THREE.Matrix4();
  private readonly tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.hemi = new THREE.HemisphereLight(LOOK_NOW.hemi.sky, LOOK_NOW.hemi.ground, LOOK_NOW.hemi.intensity);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(LOOK_NOW.sun.color, LOOK_NOW.sun.intensity);
    this.sun.castShadow = true;
    const cam = this.sun.shadow.camera;
    cam.left = this.extent.left;
    cam.right = this.extent.right;
    cam.top = this.extent.top;
    cam.bottom = this.extent.bottom;
    cam.near = 1;
    cam.far = 120;
    cam.up.set(0, 0, -1);
    cam.updateProjectionMatrix();
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 3.5;
    this.sun.shadow.intensity = LOOK_NOW.sun.shadow;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // Cool back-rim to separate the hero from the road.
    this.rim = new THREE.DirectionalLight(LOOK_NOW.rim.color, LOOK_NOW.rim.intensity);
    this.rim.position.set(3, 4, -8);
    scene.add(this.rim);
    scene.add(this.rim.target);
  }

  /** Center the shadow box on `focus` (a point just ahead of the car), snapped to texel size. */
  follow(focus: THREE.Vector3): void {
    const size = this.sun.shadow.mapSize.x;
    const texel = (this.extent.right - this.extent.left) / size;
    // Snap focus along the light's right/up axes to avoid shimmering edges.
    const dir = SUN_DIR;
    const up = new THREE.Vector3(0, 0, -1);
    const right = this.tmp.crossVectors(up, dir).normalize();
    const trueUp = new THREE.Vector3().crossVectors(dir, right).normalize();
    const r = Math.round(focus.dot(right) / texel) * texel;
    const u = Math.round(focus.dot(trueUp) / texel) * texel;
    const d = focus.dot(dir);
    const snapped = new THREE.Vector3()
      .addScaledVector(right, r)
      .addScaledVector(trueUp, u)
      .addScaledVector(dir, d);
    this.sun.target.position.copy(snapped);
    this.sun.position.copy(snapped).addScaledVector(dir, 50);
    this.sun.target.updateMatrixWorld();
    this.rim.target.position.copy(focus);
    this.rim.position.copy(focus).add(new THREE.Vector3(3, 4, -8));
    this.rim.target.updateMatrixWorld();
    void this.lightSpace;
  }
}
