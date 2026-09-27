import * as THREE from 'three';

export class CameraRig {
  private readonly desiredPosition = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly offset = new THREE.Vector3(0, 4.2, 8.4),
  ) {}

  snapTo(target: THREE.Vector3): void {
    this.desiredPosition.copy(target).add(this.offset);
    this.camera.position.copy(this.desiredPosition);
    this.lookTarget.copy(target).add(new THREE.Vector3(0, 1.05, -7.2));
    this.camera.lookAt(this.lookTarget);
  }

  update(delta: number, target: THREE.Vector3, lag: number, steer = 0, shake = 0): void {
    this.desiredPosition.copy(target).add(this.offset);
    this.desiredPosition.x += steer * 0.55 + shake;
    const factor = 1 - Math.exp(-delta / Math.max(0.001, lag));
    this.camera.position.lerp(this.desiredPosition, factor);
    this.lookTarget.copy(target).add(new THREE.Vector3(steer * 0.75, 1.1, -8.4));
    this.camera.lookAt(this.lookTarget);
  }
}
