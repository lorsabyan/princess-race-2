import * as THREE from 'three';

/** Direction *toward* the sun: from the left, high, slightly behind the chase camera. */
export const SUN_DIR = new THREE.Vector3(-0.5, 1.0, 0.32).normalize();

/**
 * Key + fill lighting. The sun casts soft PCF shadows inside a box that follows
 * the player (snapped to shadow texels so edges never shimmer). Ambient fill comes
 * mostly from the sky environment map; a weak hemisphere light adds warmth.
 */
export class Lighting {
  readonly sun: THREE.DirectionalLight;
  readonly hemi: THREE.HemisphereLight;
  readonly rim: THREE.DirectionalLight;
  private readonly extent = { left: -20, right: 20, top: 34, bottom: -14 };
  private readonly lightSpace = new THREE.Matrix4();
  private readonly tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.hemi = new THREE.HemisphereLight('#fff4f4', '#bfe6b0', 0.4);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight('#fff0dc', 2.35);
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
    this.sun.shadow.intensity = 0.82;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // Cool back-rim to separate the hero from the road.
    this.rim = new THREE.DirectionalLight('#d9e8ff', 0.7);
    this.rim.position.set(3, 4, -8);
    scene.add(this.rim);
    scene.add(this.rim.target);
  }

  /** Center the shadow box on `focus` (usually the car), snapped to texel size. */
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
