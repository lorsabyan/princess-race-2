import * as THREE from 'three';
import { disposeObject3D } from '../utils/dispose';

export type RunnerBounds = {
  halfWidth: number;
};

export type PlayerTuning = {
  forwardSpeed: number;
  steeringSpeed: number;
  steeringEase: number;
  maxDpr: number;
  cameraLag: number;
  exposure: number;
};

type PlayerMaterials = {
  shell: THREE.MeshStandardMaterial;
  shellDeep: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  glass: THREE.MeshPhysicalMaterial;
  tire: THREE.MeshStandardMaterial;
  gold: THREE.MeshStandardMaterial;
  exhaust: THREE.MeshStandardMaterial;
  shield: THREE.MeshPhysicalMaterial;
  skin: THREE.MeshStandardMaterial;
  hair: THREE.MeshStandardMaterial;
  dress: THREE.MeshStandardMaterial;
  crown: THREE.MeshStandardMaterial;
  light: THREE.MeshStandardMaterial;
};

export class Player {
  readonly group = new THREE.Group();
  readonly velocity = new THREE.Vector3();

  private readonly princess = new THREE.Group();
  private readonly door = new THREE.Group();
  private readonly shield = new THREE.Mesh(new THREE.SphereGeometry(1.45, 32, 16), new THREE.MeshPhysicalMaterial());
  private readonly materials: PlayerMaterials;
  private steerVelocity = 0;
  private hitTimer = 0;
  private boostTimer = 0;
  private safetyShieldTimer = 0;

  constructor() {
    this.materials = this.createMaterials();
    this.shield.material = this.materials.shield;
    this.shield.name = 'softSafetyShield';
    this.shield.scale.set(0.82, 0.48, 1.38);
    this.shield.position.y = 0.88;
    this.shield.visible = false;
    this.group.name = 'playerPrincessCar';
    this.group.add(this.createCar());
    this.princess.name = 'seatedPrincess';
    this.princess.position.set(0, 1.24, -0.25);
    this.princess.scale.setScalar(0.84);
    this.princess.visible = false;
    this.princess.add(this.createPrincessFigure());
    this.group.add(this.princess);
    this.group.add(this.shield);
  }

  setIntroProgress(progress: number): void {
    const eased = 1 - Math.pow(1 - progress, 3);
    this.door.rotation.z = -Math.sin(Math.min(1, progress) * Math.PI) * 0.55;
    this.princess.visible = progress > 0.48;
    this.princess.scale.setScalar(0.78 + eased * 0.06);
  }

  update(delta: number, elapsed: number, steer: number, active: boolean, tuning: PlayerTuning, bounds: RunnerBounds): void {
    this.hitTimer = Math.max(0, this.hitTimer - delta);
    this.boostTimer = Math.max(0, this.boostTimer - delta);
    this.safetyShieldTimer = Math.max(0, this.safetyShieldTimer - delta);

    const targetXVelocity = active ? steer * tuning.steeringSpeed : 0;
    const smoothing = 1 - Math.exp(-tuning.steeringEase * delta);
    this.steerVelocity = THREE.MathUtils.lerp(this.steerVelocity, targetXVelocity, smoothing);
    this.velocity.set(this.steerVelocity, 0, active ? -tuning.forwardSpeed : 0);
    this.group.position.addScaledVector(this.velocity, delta);
    this.group.position.x = THREE.MathUtils.clamp(this.group.position.x, -bounds.halfWidth + 0.95, bounds.halfWidth - 0.95);

    const roll = -this.steerVelocity * 0.035;
    const yaw = -this.steerVelocity * 0.045;
    const bounce = Math.sin(elapsed * 16) * (active ? 0.025 : 0.008);
    const hitShake = this.hitTimer > 0 ? Math.sin(elapsed * 52) * 0.055 * (this.hitTimer / 0.65) : 0;
    this.group.rotation.set(roll + hitShake, yaw, 0);
    this.group.position.y = 0.18 + bounce;
    this.princess.rotation.z = -this.steerVelocity * 0.018;
    this.princess.rotation.y = Math.sin(elapsed * 3.2) * 0.025;
    this.princess.position.y = 1.24 + Math.sin(elapsed * 9.5) * (active ? 0.018 : 0.006);
    this.shield.visible = this.hitTimer > 0.03 || this.boostTimer > 0.03 || this.safetyShieldTimer > 0.03;
    this.shield.material.opacity =
      this.hitTimer > 0
        ? Math.min(0.36, this.hitTimer * 0.42)
        : Math.min(0.24, Math.max(this.boostTimer * 0.18, this.safetyShieldTimer * 0.1));
    this.shield.rotation.y += delta * 1.25;

    const wheelRotation = elapsed * (active ? 13 : 2);
    this.group.traverse((child) => {
      if (child.name.startsWith('wheel')) child.rotation.x = wheelRotation;
      if (child.name === 'exhaustGlow') {
        child.scale.setScalar(0.85 + Math.sin(elapsed * 18) * 0.08 + Math.min(this.boostTimer, 1) * 0.16);
      }
    });
  }

  bump(side: number): void {
    this.hitTimer = 0.65;
    this.safetyShieldTimer = 2.3;
    this.boostTimer = 0;
    this.steerVelocity += side * 2.2;
  }

  celebrate(): void {
    this.boostTimer = 1.4;
  }

  setSafetyShield(seconds: number): void {
    this.safetyShieldTimer = Math.max(this.safetyShieldTimer, seconds);
  }

  dispose(): void {
    disposeObject3D(this.group);
  }

  private createCar(): THREE.Group {
    const car = new THREE.Group();
    car.name = 'roseRoadster';

    const lower = new THREE.Mesh(new THREE.BoxGeometry(1.95, 0.52, 3.35), this.materials.shell);
    lower.name = 'carShellLower';
    lower.position.y = 0.52;
    lower.castShadow = true;
    lower.receiveShadow = true;
    car.add(lower);

    const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.82, 1.08, 6), this.materials.shellDeep);
    nose.name = 'facetedFrontNose';
    nose.position.set(0, 0.54, -1.98);
    nose.rotation.x = Math.PI / 2;
    nose.scale.x = 1.55;
    nose.castShadow = true;
    car.add(nose);

    const rear = new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.58, 0.62), this.materials.shellDeep);
    rear.name = 'rearPanel';
    rear.position.set(0, 0.68, 1.36);
    rear.castShadow = true;
    car.add(rear);

    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.1, 1.0), this.materials.shell);
    deck.name = 'rearSteppedDeck';
    deck.position.set(0, 1.02, 1.0);
    deck.castShadow = true;
    car.add(deck);

    const cabin = new THREE.Mesh(new THREE.SphereGeometry(0.72, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), this.materials.glass);
    cabin.name = 'softGlassCanopy';
    cabin.position.set(0, 1.07, -0.2);
    cabin.scale.set(1.05, 0.64, 0.88);
    cabin.castShadow = true;
    car.add(cabin);

    const bumperFront = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.12), this.materials.gold);
    bumperFront.name = 'frontGoldTrim';
    bumperFront.position.set(0, 0.68, -2.55);
    bumperFront.castShadow = true;
    car.add(bumperFront);

    const sideTrimGeometry = new THREE.BoxGeometry(0.08, 0.09, 2.55);
    for (const x of [-1.02, 1.02]) {
      const trim = new THREE.Mesh(sideTrimGeometry, this.materials.gold);
      trim.name = 'sideGoldTrim';
      trim.position.set(x, 0.76, -0.2);
      trim.castShadow = true;
      car.add(trim);
    }

    const panelLineGeometry = new THREE.BoxGeometry(1.54, 0.025, 0.035);
    for (const z of [-0.95, -0.32, 0.44]) {
      const panelLine = new THREE.Mesh(panelLineGeometry, this.materials.trim);
      panelLine.name = 'paintedPanelLine';
      panelLine.position.set(0, 0.82, z);
      car.add(panelLine);
    }

    const grille = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.18, 0.06), this.materials.trim);
    grille.name = 'frontGrille';
    grille.position.set(0, 0.55, -2.62);
    car.add(grille);

    const headlightGeometry = new THREE.SphereGeometry(0.13, 14, 8);
    for (const x of [-0.55, 0.55]) {
      const light = new THREE.Mesh(headlightGeometry, this.materials.light);
      light.name = 'pearlHeadlight';
      light.position.set(x, 0.72, -2.6);
      light.scale.set(1, 0.55, 0.25);
      car.add(light);
    }

    const exhaustGeometry = new THREE.ConeGeometry(0.16, 0.48, 18);
    for (const x of [-0.44, 0.44]) {
      const exhaust = new THREE.Mesh(exhaustGeometry, this.materials.exhaust);
      exhaust.name = 'exhaustGlow';
      exhaust.position.set(x, 0.56, 1.82);
      exhaust.rotation.x = Math.PI / 2;
      car.add(exhaust);
    }

    const wheelGeometry = new THREE.CylinderGeometry(0.35, 0.35, 0.26, 24);
    const hubGeometry = new THREE.CylinderGeometry(0.18, 0.18, 0.29, 18);
    const wheelPositions = [
      [-1.05, 0.35, -1.22],
      [1.05, 0.35, -1.22],
      [-1.05, 0.35, 1.12],
      [1.05, 0.35, 1.12],
    ];
    wheelPositions.forEach(([x, y, z], index) => {
      const wheel = new THREE.Mesh(wheelGeometry, this.materials.tire);
      wheel.name = `wheel${index}`;
      wheel.position.set(x, y, z);
      wheel.rotation.z = Math.PI / 2;
      wheel.castShadow = true;
      car.add(wheel);

      const hub = new THREE.Mesh(hubGeometry, this.materials.gold);
      hub.name = `wheelHub${index}`;
      hub.position.copy(wheel.position);
      hub.rotation.z = Math.PI / 2;
      hub.castShadow = true;
      car.add(hub);
    });

    this.door.name = 'openingDoor';
    this.door.position.set(-1.02, 0.84, -0.22);
    const doorPanel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.54, 0.86), this.materials.shellDeep);
    doorPanel.name = 'leftDoorPanel';
    doorPanel.position.set(-0.04, 0, 0);
    doorPanel.castShadow = true;
    this.door.add(doorPanel);
    car.add(this.door);

    const crownBadge = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.25, 5), this.materials.gold);
    crownBadge.name = 'hoodCrownBadge';
    crownBadge.position.set(0, 0.9, -1.52);
    crownBadge.rotation.x = -0.2;
    crownBadge.castShadow = true;
    car.add(crownBadge);

    return car;
  }

  private createPrincessFigure(): THREE.Group {
    const princess = new THREE.Group();
    princess.name = 'princessFigure';

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.36, 8, 12), this.materials.dress);
    body.name = 'princessDress';
    body.position.y = 0.1;
    body.castShadow = true;
    princess.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 18, 12), this.materials.skin);
    head.name = 'princessHead';
    head.position.y = 0.55;
    head.castShadow = true;
    princess.add(head);

    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 10), this.materials.hair);
    hair.name = 'princessHair';
    hair.position.set(0, 0.56, 0.04);
    hair.scale.set(1.06, 0.82, 0.78);
    hair.castShadow = true;
    princess.add(hair);

    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.18, 5), this.materials.crown);
    crown.name = 'princessCrown';
    crown.position.set(0, 0.82, -0.02);
    crown.castShadow = true;
    princess.add(crown);

    return princess;
  }

  private createMaterials(): PlayerMaterials {
    return {
      shell: new THREE.MeshStandardMaterial({ color: '#c9879d', roughness: 0.42, metalness: 0.18 }),
      shellDeep: new THREE.MeshStandardMaterial({ color: '#a86b7f', roughness: 0.48, metalness: 0.16 }),
      trim: new THREE.MeshStandardMaterial({ color: '#312f36', roughness: 0.62, metalness: 0.22 }),
      glass: new THREE.MeshPhysicalMaterial({
        color: '#cfdedc',
        roughness: 0.16,
        metalness: 0,
        transmission: 0.28,
        transparent: true,
        opacity: 0.74,
        clearcoat: 0.7,
      }),
      tire: new THREE.MeshStandardMaterial({ color: '#252734', roughness: 0.78, metalness: 0.02 }),
      gold: new THREE.MeshStandardMaterial({ color: '#c89d67', roughness: 0.35, metalness: 0.34 }),
      exhaust: new THREE.MeshStandardMaterial({
        color: '#d0a36c',
        emissive: '#d0a36c',
        emissiveIntensity: 0.36,
        roughness: 0.25,
        metalness: 0.08,
      }),
      shield: new THREE.MeshPhysicalMaterial({
        color: '#a9c9c2',
        transparent: true,
        opacity: 0,
        roughness: 0.12,
        metalness: 0,
        transmission: 0.24,
        clearcoat: 0.5,
        depthWrite: false,
      }),
      skin: new THREE.MeshStandardMaterial({ color: '#d4a986', roughness: 0.6, metalness: 0.02 }),
      hair: new THREE.MeshStandardMaterial({ color: '#5d4650', roughness: 0.58, metalness: 0.02 }),
      dress: new THREE.MeshStandardMaterial({ color: '#d8becb', roughness: 0.48, metalness: 0.06 }),
      crown: new THREE.MeshStandardMaterial({ color: '#d4ad6a', roughness: 0.32, metalness: 0.45 }),
      light: new THREE.MeshStandardMaterial({
        color: '#fff5d6',
        emissive: '#d0a36c',
        emissiveIntensity: 0.65,
        roughness: 0.2,
        metalness: 0.06,
      }),
    };
  }
}
