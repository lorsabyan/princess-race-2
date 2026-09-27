import * as THREE from 'three';
import { disposeObject3D } from '../utils/dispose';

export type ObstacleKind = 'barrier' | 'gate' | 'cart' | 'sweeper';

const hazardMaterial = new THREE.MeshStandardMaterial({
  color: '#7f5861',
  roughness: 0.58,
  metalness: 0.08,
});
const stoneMaterial = new THREE.MeshStandardMaterial({
  color: '#8a8380',
  roughness: 0.72,
  metalness: 0.02,
});
const trimMaterial = new THREE.MeshStandardMaterial({
  color: '#c89d67',
  roughness: 0.42,
  metalness: 0.32,
});
const signalMaterial = new THREE.MeshStandardMaterial({
  color: '#d8becb',
  emissive: '#4f2d39',
  emissiveIntensity: 0.18,
  roughness: 0.4,
  metalness: 0.08,
});

export class Obstacle {
  readonly group = new THREE.Group();
  readonly radius: number;
  active = true;

  private hitCooldown = 0;

  constructor(
    readonly index: number,
    readonly kind: ObstacleKind,
    position: THREE.Vector3,
  ) {
    this.group.name = `${kind}Obstacle`;
    this.group.position.copy(position);
    this.radius = kind === 'gate' ? 0.85 : kind === 'cart' ? 0.68 : kind === 'sweeper' ? 0.92 : 0.78;
    this.group.add(this.createModel(kind));
  }

  update(delta: number, elapsed: number): void {
    this.hitCooldown = Math.max(0, this.hitCooldown - delta);

    if (this.kind === 'gate') {
      this.group.children[0].rotation.y = Math.sin(elapsed * 1.8 + this.index) * 0.08;
    }

    if (this.kind === 'cart') {
      this.group.position.x += Math.sin(elapsed * 1.6 + this.index) * delta * 1.25;
      this.group.rotation.y = Math.sin(elapsed * 1.6 + this.index) * 0.15;
    }

    if (this.kind === 'sweeper') {
      this.group.children[0].rotation.y = elapsed * 1.7 + this.index;
      this.group.position.y = 0.04 + Math.sin(elapsed * 2.2 + this.index) * 0.04;
    }
  }

  canHit(): boolean {
    return this.hitCooldown <= 0;
  }

  markHit(): void {
    this.hitCooldown = 1.1;
  }

  dispose(): void {
    disposeObject3D(this.group);
  }

  private createModel(kind: ObstacleKind): THREE.Group {
    if (kind === 'gate') return this.createGate();
    if (kind === 'cart') return this.createCart();
    if (kind === 'sweeper') return this.createSweeper();
    return this.createBarrier();
  }

  private createBarrier(): THREE.Group {
    const root = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.42, 0.34), hazardMaterial);
    base.name = 'gardenBarrierBase';
    base.position.y = 0.32;
    base.castShadow = true;
    base.receiveShadow = true;
    root.add(base);

    for (const x of [-0.48, 0, 0.48]) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.38, 4), trimMaterial);
      spike.name = 'barrierGoldFinial';
      spike.position.set(x, 0.72, 0);
      spike.castShadow = true;
      root.add(spike);
    }

    const signal = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.04, 0.38), signalMaterial);
    signal.name = 'softWarningStripe';
    signal.position.set(0, 0.55, -0.19);
    root.add(signal);
    return root;
  }

  private createSweeper(): THREE.Group {
    const root = new THREE.Group();
    const spinner = new THREE.Group();
    spinner.name = 'rotatingGardenSweeper';
    root.add(spinner);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.36, 14), stoneMaterial);
    base.name = 'sweeperBase';
    base.position.y = 0.3;
    base.castShadow = true;
    spinner.add(base);

    for (let arm = 0; arm < 3; arm += 1) {
      const angle = (arm / 3) * Math.PI * 2;
      const rail = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.12), hazardMaterial);
      rail.name = 'paddedSweeperArm';
      rail.position.set(Math.cos(angle) * 0.64, 0.58, Math.sin(angle) * 0.64);
      rail.rotation.y = -angle;
      rail.castShadow = true;
      spinner.add(rail);

      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 8), signalMaterial);
      cap.name = 'sweeperWarningPearl';
      cap.position.set(Math.cos(angle) * 1.36, 0.58, Math.sin(angle) * 1.36);
      spinner.add(cap);
    }

    const warning = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 36), trimMaterial);
    warning.name = 'sweeperFloorHalo';
    warning.rotation.x = -Math.PI / 2;
    warning.position.y = 0.025;
    root.add(warning);
    return root;
  }

  private createGate(): THREE.Group {
    const root = new THREE.Group();
    const postGeometry = new THREE.BoxGeometry(0.22, 1.42, 0.24);
    for (const x of [-0.72, 0.72]) {
      const post = new THREE.Mesh(postGeometry, stoneMaterial);
      post.name = 'fountainGatePost';
      post.position.set(x, 0.78, 0);
      post.castShadow = true;
      root.add(post);

      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 8), trimMaterial);
      cap.name = 'gateBrassCap';
      cap.position.set(x, 1.55, 0);
      cap.castShadow = true;
      root.add(cap);
    }

    const arch = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.055, 8, 32, Math.PI), trimMaterial);
    arch.name = 'gateArch';
    arch.position.set(0, 1.36, 0);
    arch.rotation.z = Math.PI;
    arch.castShadow = true;
    root.add(arch);

    const mist = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.9), signalMaterial);
    mist.name = 'softMistCurtain';
    mist.position.set(0, 0.82, -0.02);
    mist.material = signalMaterial.clone();
    mist.material.transparent = true;
    mist.material.opacity = 0.42;
    root.add(mist);
    return root;
  }

  private createCart(): THREE.Group {
    const root = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.52, 0.72), stoneMaterial);
    body.name = 'deliveryCartBody';
    body.position.y = 0.48;
    body.castShadow = true;
    body.receiveShadow = true;
    root.add(body);

    const canopy = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.46, 0.9, 8), hazardMaterial);
    canopy.name = 'cartCanopy';
    canopy.position.set(0, 0.86, 0);
    canopy.rotation.z = Math.PI / 2;
    canopy.scale.y = 1.3;
    canopy.castShadow = true;
    root.add(canopy);

    const wheelGeometry = new THREE.CylinderGeometry(0.16, 0.16, 0.12, 16);
    for (const x of [-0.58, 0.58]) {
      for (const z of [-0.28, 0.28]) {
        const wheel = new THREE.Mesh(wheelGeometry, trimMaterial);
        wheel.name = 'cartWheel';
        wheel.position.set(x, 0.2, z);
        wheel.rotation.z = Math.PI / 2;
        wheel.castShadow = true;
        root.add(wheel);
      }
    }
    return root;
  }
}
