import * as THREE from 'three';
import { disposeObject3D } from '../utils/dispose';

export type PickupKind = 'coin' | 'charm';

const sharedCoinGeometry = new THREE.CylinderGeometry(0.28, 0.28, 0.08, 28);
const sharedRingGeometry = new THREE.TorusGeometry(0.38, 0.018, 8, 30);
const sharedCrownGeometry = new THREE.ConeGeometry(0.16, 0.22, 5);
const coinMaterial = new THREE.MeshStandardMaterial({
  color: '#d0a96d',
  emissive: '#4d3212',
  emissiveIntensity: 0.16,
  roughness: 0.32,
  metalness: 0.46,
});
const rimMaterial = new THREE.MeshStandardMaterial({
  color: '#f2e6ce',
  roughness: 0.28,
  metalness: 0.18,
});
const charmMaterial = new THREE.MeshStandardMaterial({
  color: '#9fbcb6',
  emissive: '#193e3a',
  emissiveIntensity: 0.2,
  roughness: 0.36,
  metalness: 0.22,
});

export class Pickup {
  readonly group = new THREE.Group();
  readonly radius = 0.72;
  active = true;

  private collectTimer = 0;

  constructor(
    readonly index: number,
    readonly kind: PickupKind,
    position: THREE.Vector3,
  ) {
    this.group.name = `${kind}Pickup`;
    this.group.position.copy(position);
    this.group.add(kind === 'coin' ? this.createCoin() : this.createCharm());
  }

  get value(): number {
    return this.kind === 'coin' ? 1 : 3;
  }

  update(delta: number, elapsed: number, playerPosition: THREE.Vector3): void {
    if (!this.active && this.collectTimer <= 0) return;

    if (this.active) {
      const distance = this.group.position.distanceTo(playerPosition);
      if (distance < 2.6) {
        this.group.position.lerp(playerPosition.clone().setY(0.9), delta * 2.4);
      }
      this.group.rotation.y += delta * (this.kind === 'coin' ? 2.6 : 1.7);
      this.group.children[0].rotation.z += delta * 1.4;
      this.group.position.y = 0.95 + Math.sin(elapsed * 3 + this.index) * 0.13;
      return;
    }

    this.collectTimer -= delta;
    this.group.scale.multiplyScalar(1 + delta * 4.5);
    this.group.traverse((child) => {
      const mesh = child as THREE.Mesh;
      const material = mesh.material as THREE.Material | undefined;
      if (material && 'opacity' in material) {
        material.transparent = true;
        material.opacity = Math.max(0, this.collectTimer / 0.22);
      }
    });
    if (this.collectTimer <= 0) this.group.visible = false;
  }

  collect(): void {
    if (!this.active) return;
    this.active = false;
    this.collectTimer = 0.22;
  }

  dispose(): void {
    disposeObject3D(this.group);
  }

  private createCoin(): THREE.Group {
    const coin = new THREE.Group();
    const disk = new THREE.Mesh(sharedCoinGeometry, coinMaterial.clone());
    disk.name = 'coinDisk';
    disk.rotation.x = Math.PI / 2;
    disk.castShadow = true;
    coin.add(disk);

    const ring = new THREE.Mesh(sharedRingGeometry, rimMaterial.clone());
    ring.name = 'coinRim';
    ring.rotation.x = Math.PI / 2;
    coin.add(ring);

    const crown = new THREE.Mesh(sharedCrownGeometry, rimMaterial.clone());
    crown.name = 'coinCrownMark';
    crown.position.set(0, 0.06, 0);
    crown.rotation.x = Math.PI / 2;
    crown.scale.set(0.78, 0.78, 0.38);
    coin.add(crown);
    return coin;
  }

  private createCharm(): THREE.Group {
    const charm = new THREE.Group();
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 0), charmMaterial.clone());
    gem.name = 'charmGem';
    gem.castShadow = true;
    charm.add(gem);

    const ring = new THREE.Mesh(sharedRingGeometry, rimMaterial.clone());
    ring.name = 'charmOrbit';
    ring.rotation.x = Math.PI / 2;
    ring.scale.setScalar(1.12);
    charm.add(ring);
    return charm;
  }
}
