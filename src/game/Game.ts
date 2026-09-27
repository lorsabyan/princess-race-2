import * as THREE from 'three';
import { InputController, type GameIntent } from '../core/InputController';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { Obstacle, type ObstacleKind } from '../entities/Obstacle';
import { Pickup, type PickupKind } from '../entities/Pickup';
import { Player } from '../entities/Player';
import { AudioSystem } from '../systems/AudioSystem';
import { CameraRig } from '../systems/CameraRig';
import { CollisionSystem } from '../systems/CollisionSystem';
import { DebugTools, type DebugTuning } from '../systems/DebugTools';
import { Hud } from '../systems/Hud';
import { disposeObject3D } from '../utils/dispose';

type GameState = 'intro' | 'boarding' | 'running' | 'paused' | 'won' | 'failed';

const ROAD_HALF_WIDTH = 5.2;
const BASE_LEVEL_DISTANCE = 430;
const BASE_TARGET_COINS = 22;
const LANES = [-3.15, -1.05, 1.05, 3.15];

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(58, 1, 0.1, 150);
  private readonly input: InputController;
  private readonly player = new Player();
  private readonly pickups: Pickup[] = [];
  private readonly obstacles: Obstacle[] = [];
  private readonly roadSegments: THREE.Group[] = [];
  private readonly citySegments: THREE.Group[] = [];
  private readonly collision = new CollisionSystem();
  private readonly audio = new AudioSystem();
  private readonly hud = new Hud();
  private readonly cameraRig = new CameraRig(this.camera);
  private readonly loop = new Loop(
    (delta, elapsed) => this.update(delta, elapsed),
    () => this.render(),
  );

  private readonly tuning: DebugTuning = {
    forwardSpeed: 10.4,
    steeringSpeed: 9.6,
    steeringEase: 12,
    cameraLag: 0.18,
    exposure: 1.04,
    maxDpr: 1.75,
  };

  private readonly debugTools: DebugTools;
  private readonly introPrincess = this.createIntroPrincess();
  private readonly castle = this.createCastleGate();
  private frame = 0;
  private score = 0;
  private hearts = 3;
  private level = 1;
  private state: GameState = 'intro';
  private previousState: GameState = 'intro';
  private stateTime = 0;
  private elapsed = 0;
  private cameraShake = 0;
  private lastBannerAt = 0;
  private shieldTimer = 0;
  private milestone = 0;
  private muted = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    this.renderer.toneMappingExposure = this.tuning.exposure;
    this.debugTools = new DebugTools(this.tuning, () => {
      this.renderer.toneMappingExposure = this.tuning.exposure;
      resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    });

    this.input = new InputController(
      this.getElement('#steering-wheel'),
      this.getElement('#pause-button'),
      this.getElement('#mute-button'),
      this.getElement('#primary-action'),
      this.getElement('#secondary-action'),
      (intent) => this.handleIntent(intent),
    );

    this.createScene();
    this.resetLevel();
    this.hud.setOverlay('intro');
    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    this.publishDiagnostics();
  }

  start(): void {
    this.loop.start();
  }

  dispose(): void {
    this.loop.stop();
    this.input.dispose();
    this.audio.dispose();
    this.hud.dispose();
    this.debugTools.dispose();
    this.player.dispose();
    for (const pickup of this.pickups) {
      this.scene.remove(pickup.group);
      pickup.dispose();
    }
    for (const obstacle of this.obstacles) {
      this.scene.remove(obstacle.group);
      obstacle.dispose();
    }
    for (const segment of this.roadSegments) disposeObject3D(segment);
    for (const segment of this.citySegments) disposeObject3D(segment);
    disposeObject3D(this.introPrincess);
    disposeObject3D(this.castle);
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
  }

  private update(delta: number, elapsed: number): void {
    this.frame += 1;
    this.stateTime += delta;
    this.elapsed += delta;
    this.cameraShake *= Math.exp(-delta * 8);
    this.shieldTimer = Math.max(0, this.shieldTimer - delta);
    this.player.setSafetyShield(this.shieldTimer);

    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    this.updateState(delta, elapsed);
    this.audio.update(delta, this.state === 'running' || this.state === 'boarding', this.tuning.forwardSpeed / 14);
    this.hud.update(
      this.score,
      this.targetCoins(),
      Math.min(1, -this.player.group.position.z / this.levelDistance()),
      this.hearts,
      this.muted,
      this.state === 'paused',
    );
    this.publishDiagnostics();
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private updateState(delta: number, elapsed: number): void {
    if (this.state === 'intro') {
      this.player.setIntroProgress(0);
      this.cameraRig.update(delta, this.player.group.position, this.tuning.cameraLag, 0, this.cameraShake);
      return;
    }

    if (this.state === 'boarding') {
      const progress = Math.min(1, this.stateTime / 3.0);
      this.updateIntroPrincess(progress);
      this.player.setIntroProgress(progress);
      this.cameraRig.update(delta, this.player.group.position, this.tuning.cameraLag, 0, this.cameraShake);
      if (progress >= 1) {
        this.introPrincess.visible = false;
        this.setState('running');
        this.hud.flash('Collect the royal coins');
      }
      return;
    }

    const running = this.state === 'running';
    const steer = this.input.getSteer();
    this.tuning.forwardSpeed = this.levelSpeed();
    this.player.update(delta, elapsed, steer, running, this.tuning, { halfWidth: ROAD_HALF_WIDTH });
    this.updateRoad();
    this.updateCity();

    for (const pickup of this.pickups) pickup.update(delta, elapsed, this.player.group.position);
    for (const obstacle of this.obstacles) obstacle.update(delta, elapsed);

    if (running) {
      this.collectPickups();
      this.hitObstacles(elapsed);
      this.checkWin();
    }

    this.castle.position.z = -this.levelDistance() - 28;
    this.cameraRig.update(delta, this.player.group.position, this.tuning.cameraLag, steer, this.cameraShake);
  }

  private collectPickups(): void {
    const collected = this.collision.collectPickups(this.player.group.position, this.pickups, 0.72);
    for (const pickup of collected) {
      this.score = Math.min(this.targetCoins(), this.score + pickup.value);
      if (pickup.kind === 'charm') {
        this.audio.charm();
        this.hud.flash('+3 Royal charm');
      } else {
        this.audio.coin(pickup.index);
      }
      this.hud.pulseCoins();
      const nextMilestone = Math.floor(this.score / 8);
      if (nextMilestone > this.milestone && this.score < this.targetCoins()) {
        this.milestone = nextMilestone;
        this.hud.flash('Beautiful driving');
      }
    }
  }

  private hitObstacles(elapsed: number): void {
    const hits = this.collision.hitObstacles(this.player.group.position, this.obstacles, 0.68);
    for (const obstacle of hits) {
      const side = this.player.group.position.x < obstacle.group.position.x ? -1 : 1;
      if (this.shieldTimer > 0) {
        this.audio.shield();
        this.hud.flash('Shield saved a heart');
        continue;
      }

      this.hearts = Math.max(0, this.hearts - 1);
      this.shieldTimer = 2.25;
      this.player.bump(side);
      this.cameraShake = 0.16 * side;
      this.audio.bump();
      if (elapsed - this.lastBannerAt > 1.2) {
        this.hud.flash(this.hearts > 0 ? 'Soft bump' : 'Let us try again');
        this.lastBannerAt = elapsed;
      }
      if (this.hearts <= 0) {
        this.audio.fail();
        this.setState('failed');
        this.hud.setOverlay('failed', this.score, this.targetCoins());
      }
    }
  }

  private checkWin(): void {
    if (-this.player.group.position.z < this.levelDistance() || this.score < this.targetCoins()) return;
    this.player.celebrate();
    this.audio.win();
    this.setState('won');
    this.hud.setOverlay('win', this.score, this.targetCoins());
  }

  private handleIntent(intent: GameIntent): void {
    if (intent === 'mute') {
      this.muted = !this.muted;
      this.audio.setMuted(this.muted);
      this.audio.ui();
      return;
    }

    if (intent === 'pause') {
      this.audio.ui();
      if (this.state === 'running') {
        this.previousState = this.state;
        this.setState('paused');
        this.hud.setOverlay('paused', this.score, this.targetCoins());
      } else if (this.state === 'paused') {
        this.setState(this.previousState === 'paused' ? 'running' : this.previousState);
        this.hud.setOverlay('hidden');
      }
      return;
    }

    if (intent === 'restart') {
      this.audio.ui();
      this.resetLevel();
      this.setState('boarding');
      this.hud.setOverlay('hidden');
      return;
    }

    this.audio.ui();
    if (this.state === 'intro') {
      this.setState('boarding');
      this.hud.setOverlay('hidden');
    } else if (this.state === 'paused') {
      this.setState('running');
      this.hud.setOverlay('hidden');
    } else if (this.state === 'won') {
      this.level += 1;
      this.resetLevel();
      this.setState('boarding');
      this.hud.setOverlay('hidden');
    } else if (this.state === 'failed') {
      this.resetLevel();
      this.setState('boarding');
      this.hud.setOverlay('hidden');
    }
  }

  private setState(state: GameState): void {
    this.previousState = this.state;
    this.state = state;
    this.stateTime = 0;
  }

  private resetLevel(): void {
    this.score = 0;
    this.hearts = 3;
    this.milestone = 0;
    this.shieldTimer = 0;
    this.player.group.position.set(0, 0.18, 8);
    this.player.group.rotation.set(0, 0, 0);
    this.player.setIntroProgress(0);
    this.introPrincess.visible = true;
    this.updateIntroPrincess(0);
    this.hud.setLevel(this.level, this.targetCoins());
    this.audio.levelStart(this.level);

    for (const pickup of this.pickups) {
      this.scene.remove(pickup.group);
      pickup.dispose();
    }
    for (const obstacle of this.obstacles) {
      this.scene.remove(obstacle.group);
      obstacle.dispose();
    }
    this.pickups.length = 0;
    this.obstacles.length = 0;
    this.createPickups();
    this.createObstacles();
    this.cameraRig.snapTo(this.player.group.position);
  }

  private createScene(): void {
    this.scene.background = new THREE.Color('#171a22');
    this.scene.fog = new THREE.Fog('#171a22', 34, 128);

    const hemisphere = new THREE.HemisphereLight('#f5ead6', '#334447', 1.25);
    this.scene.add(hemisphere);

    const sun = new THREE.DirectionalLight('#f7dfba', 2.9);
    sun.position.set(-6, 11, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 70;
    sun.shadow.camera.left = -16;
    sun.shadow.camera.right = 16;
    sun.shadow.camera.top = 20;
    sun.shadow.camera.bottom = -28;
    this.scene.add(sun);

    const rim = new THREE.DirectionalLight('#9fbcb6', 1.5);
    rim.position.set(7, 6, -8);
    this.scene.add(rim);

    this.createRoad();
    this.createCity();
    this.scene.add(this.player.group);
    this.scene.add(this.introPrincess);
    this.scene.add(this.castle);
  }

  private createRoad(): void {
    for (let index = 0; index < 7; index += 1) {
      const segment = this.createRoadSegment(index);
      segment.position.z = 28 - index * 80;
      this.roadSegments.push(segment);
      this.scene.add(segment);
    }
  }

  private updateRoad(): void {
    const playerZ = this.player.group.position.z;
    for (const segment of this.roadSegments) {
      if (segment.position.z - playerZ > 72) {
        segment.position.z -= this.roadSegments.length * 80;
      }
    }
  }

  private createRoadSegment(index: number): THREE.Group {
    const segment = new THREE.Group();
    segment.name = `roadSegment${index}`;

    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_HALF_WIDTH * 2, 80),
      new THREE.MeshStandardMaterial({ color: '#34343a', roughness: 0.84, metalness: 0.02 }),
    );
    road.rotation.x = -Math.PI / 2;
    road.receiveShadow = true;
    segment.add(road);

    const centerMaterial = new THREE.MeshStandardMaterial({ color: '#c89d67', roughness: 0.58, metalness: 0.12 });
    for (let z = -32; z <= 32; z += 12) {
      const marker = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.022, 4.6), centerMaterial);
      marker.name = 'laneInlay';
      marker.position.set(0, 0.03, z);
      segment.add(marker);
    }

    const edgeMaterial = new THREE.MeshStandardMaterial({ color: '#837064', roughness: 0.64, metalness: 0.08 });
    for (const x of [-3.15, 3.15]) {
      for (let z = -36; z <= 36; z += 18) {
        const glyph = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.024, 0.12), edgeMaterial);
        glyph.name = 'subtleLaneGlyph';
        glyph.position.set(x, 0.034, z);
        glyph.rotation.y = (index % 2 === 0 ? 1 : -1) * 0.34;
        segment.add(glyph);
      }
    }

    const railMaterial = new THREE.MeshStandardMaterial({ color: '#5e5864', roughness: 0.58, metalness: 0.16 });
    for (const x of [-ROAD_HALF_WIDTH - 0.24, ROAD_HALF_WIDTH + 0.24]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.42, 80), railMaterial);
      rail.name = 'sideRail';
      rail.position.set(x, 0.24, 0);
      rail.castShadow = true;
      rail.receiveShadow = true;
      segment.add(rail);
    }

    return segment;
  }

  private createCity(): void {
    for (let index = 0; index < 9; index += 1) {
      const segment = this.createCitySegment(index);
      segment.position.z = 8 - index * 58;
      this.citySegments.push(segment);
      this.scene.add(segment);
    }
  }

  private updateCity(): void {
    const playerZ = this.player.group.position.z;
    for (const segment of this.citySegments) {
      if (segment.position.z - playerZ > 58) {
        segment.position.z -= this.citySegments.length * 58;
      }
    }
  }

  private createCitySegment(index: number): THREE.Group {
    const root = new THREE.Group();
    const buildingMaterials = [
      new THREE.MeshStandardMaterial({ color: '#5e6771', roughness: 0.66, metalness: 0.08 }),
      new THREE.MeshStandardMaterial({ color: '#71626a', roughness: 0.7, metalness: 0.05 }),
      new THREE.MeshStandardMaterial({ color: '#586b68', roughness: 0.68, metalness: 0.06 }),
    ];
    const windowMaterial = new THREE.MeshStandardMaterial({
      color: '#f3eadc',
      emissive: '#7d6542',
      emissiveIntensity: 0.16,
      roughness: 0.38,
      metalness: 0.06,
    });
    const roofMaterial = new THREE.MeshStandardMaterial({ color: '#8d6973', roughness: 0.54, metalness: 0.06 });

    for (const side of [-1, 1]) {
      for (let b = 0; b < 3; b += 1) {
        const height = 3.2 + ((index + b) % 4) * 0.9;
        const width = 2.0 + ((index + b) % 2) * 0.55;
        const depth = 3.4 + ((index + b) % 3) * 0.6;
        const x = side * (ROAD_HALF_WIDTH + 2.1 + b * 2.25);
        const z = -22 + b * 17 + ((index % 2) * 3);
        const building = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), buildingMaterials[(index + b) % 3]);
        building.name = 'cityBuilding';
        building.position.set(x, height / 2, z);
        building.castShadow = true;
        building.receiveShadow = true;
        root.add(building);

        const roof = new THREE.Mesh(new THREE.ConeGeometry(width * 0.72, 0.72, 4), roofMaterial);
        roof.name = 'softRoofline';
        roof.position.set(x, height + 0.38, z);
        roof.rotation.y = Math.PI / 4;
        roof.castShadow = true;
        root.add(roof);

        for (let row = 0; row < Math.floor(height); row += 1) {
          const windows = new THREE.Mesh(new THREE.BoxGeometry(width * 0.72, 0.06, 0.04), windowMaterial);
          windows.name = 'windowBand';
          windows.position.set(x, 0.86 + row * 0.78, z + side * (depth / 2 + 0.025));
          windows.rotation.y = side < 0 ? Math.PI : 0;
          root.add(windows);
        }
      }

      const lamp = this.createStreetLamp();
      lamp.position.set(side * (ROAD_HALF_WIDTH + 0.8), 0, -8 + (index % 3) * 14);
      root.add(lamp);

      const planter = this.createPlanter();
      planter.position.set(side * (ROAD_HALF_WIDTH + 1.08), 0, 11 + (index % 2) * 10);
      root.add(planter);

      const banner = this.createRoyalBanner(side);
      banner.position.set(side * (ROAD_HALF_WIDTH + 0.92), 1.65, -23 + (index % 3) * 12);
      root.add(banner);
    }

    return root;
  }

  private createStreetLamp(): THREE.Group {
    const lamp = new THREE.Group();
    const poleMaterial = new THREE.MeshStandardMaterial({ color: '#4c4b55', roughness: 0.5, metalness: 0.38 });
    const glowMaterial = new THREE.MeshStandardMaterial({
      color: '#f4e1bd',
      emissive: '#d1a56e',
      emissiveIntensity: 0.36,
      roughness: 0.2,
      metalness: 0.05,
    });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 2.1, 10), poleMaterial);
    pole.name = 'streetLampPole';
    pole.position.y = 1.05;
    lamp.add(pole);
    const globe = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 8), glowMaterial);
    globe.name = 'streetLampGlow';
    globe.position.y = 2.2;
    lamp.add(globe);
    return lamp;
  }

  private createPlanter(): THREE.Group {
    const planter = new THREE.Group();
    const baseMaterial = new THREE.MeshStandardMaterial({ color: '#6d5e57', roughness: 0.62, metalness: 0.08 });
    const leafMaterial = new THREE.MeshStandardMaterial({ color: '#536758', roughness: 0.74, metalness: 0.02 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.34, 0.5), baseMaterial);
    base.name = 'cityPlanterBase';
    base.position.y = 0.18;
    base.castShadow = true;
    planter.add(base);
    for (const x of [-0.22, 0, 0.22]) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.58, 6), leafMaterial);
      leaf.name = 'sculptedPlanterLeaf';
      leaf.position.set(x, 0.62, 0);
      leaf.castShadow = true;
      planter.add(leaf);
    }
    return planter;
  }

  private createRoyalBanner(side: number): THREE.Group {
    const banner = new THREE.Group();
    const poleMaterial = new THREE.MeshStandardMaterial({ color: '#4c4b55', roughness: 0.52, metalness: 0.34 });
    const clothMaterial = new THREE.MeshStandardMaterial({ color: '#9d7783', roughness: 0.7, metalness: 0.02 });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.4, 8), poleMaterial);
    pole.name = 'bannerPole';
    banner.add(pole);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.62, 3, 2), clothMaterial);
    cloth.name = 'softRoyalBanner';
    cloth.position.set(side * -0.28, 0.2, 0);
    cloth.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    banner.add(cloth);
    return banner;
  }

  private createPickups(): void {
    let index = 0;
    const rows = this.targetCoins() + 16;
    for (let row = 0; row < rows; row += 1) {
      const z = -18 - row * 10.4;
      const lane = LANES[(row * 2 + Math.floor(row / 5)) % LANES.length];
      const kind: PickupKind = row > 0 && row % 8 === 0 ? 'charm' : 'coin';
      const pickup = new Pickup(index, kind, new THREE.Vector3(lane, 0.95, z));
      this.pickups.push(pickup);
      this.scene.add(pickup.group);
      index += 1;
    }
  }

  private createObstacles(): void {
    const plan: Array<[ObstacleKind, number, number]> = [
      ['barrier', -42, -3.15],
      ['gate', -72, 1.05],
      ['cart', -106, 3.15],
      ['sweeper', -136, -1.05],
      ['barrier', -166, 1.05],
      ['gate', -198, -1.05],
      ['cart', -210, -3.15],
      ['sweeper', -244, 3.15],
      ['barrier', -278, 3.15],
      ['gate', -316, -3.15],
      ['cart', -354, 1.05],
      ['barrier', -402, -1.05],
    ];

    if (this.level > 1) {
      plan.push(['sweeper', -438, 1.05], ['gate', -468, 3.15]);
    }

    plan.forEach(([kind, z, x], index) => {
      const obstacle = new Obstacle(index, kind, new THREE.Vector3(x, 0, z));
      this.obstacles.push(obstacle);
      this.scene.add(obstacle.group);
    });
  }

  private createCastleGate(): THREE.Group {
    const gate = new THREE.Group();
    gate.name = 'finishCastleGate';
    const wallMaterial = new THREE.MeshStandardMaterial({ color: '#867d82', roughness: 0.68, metalness: 0.04 });
    const roofMaterial = new THREE.MeshStandardMaterial({ color: '#a87685', roughness: 0.48, metalness: 0.08 });
    const trimMaterial = new THREE.MeshStandardMaterial({ color: '#c89d67', roughness: 0.4, metalness: 0.28 });

    for (const x of [-4.4, 4.4]) {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 1, 5.4, 14), wallMaterial);
      tower.name = 'castleTower';
      tower.position.set(x, 2.7, 0);
      tower.castShadow = true;
      gate.add(tower);

      const roof = new THREE.Mesh(new THREE.ConeGeometry(1.05, 1.3, 14), roofMaterial);
      roof.name = 'castleTowerRoof';
      roof.position.set(x, 6.0, 0);
      roof.castShadow = true;
      gate.add(roof);
    }

    const arch = new THREE.Mesh(new THREE.BoxGeometry(6.6, 1.0, 0.62), wallMaterial);
    arch.name = 'castleArchTop';
    arch.position.set(0, 4.1, 0);
    arch.castShadow = true;
    gate.add(arch);

    const finish = new THREE.Mesh(new THREE.BoxGeometry(8.4, 0.08, 0.4), trimMaterial);
    finish.name = 'finishLineGold';
    finish.position.set(0, 0.08, 4.2);
    gate.add(finish);
    return gate;
  }

  private createIntroPrincess(): THREE.Group {
    const root = new THREE.Group();
    root.name = 'introWalkingPrincess';
    const skin = new THREE.MeshStandardMaterial({ color: '#d4a986', roughness: 0.6 });
    const dress = new THREE.MeshStandardMaterial({ color: '#d8becb', roughness: 0.48, metalness: 0.04 });
    const hair = new THREE.MeshStandardMaterial({ color: '#5d4650', roughness: 0.58 });
    const crown = new THREE.MeshStandardMaterial({ color: '#d4ad6a', roughness: 0.32, metalness: 0.45 });

    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.6, 8, 14), dress);
    body.name = 'introDress';
    body.position.y = 0.74;
    body.castShadow = true;
    root.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 18, 12), skin);
    head.name = 'introHead';
    head.position.y = 1.28;
    head.castShadow = true;
    root.add(head);
    const hairMesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 18, 10), hair);
    hairMesh.name = 'introHair';
    hairMesh.position.set(0, 1.27, 0.04);
    hairMesh.scale.set(1.04, 0.84, 0.8);
    hairMesh.castShadow = true;
    root.add(hairMesh);
    const crownMesh = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.2, 5), crown);
    crownMesh.name = 'introCrown';
    crownMesh.position.y = 1.56;
    crownMesh.castShadow = true;
    root.add(crownMesh);
    return root;
  }

  private updateIntroPrincess(progress: number): void {
    const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    this.introPrincess.position.set(THREE.MathUtils.lerp(-3.2, -0.82, eased), 0, THREE.MathUtils.lerp(3.5, 0.22, eased));
    this.introPrincess.rotation.y = THREE.MathUtils.lerp(Math.PI * 0.28, Math.PI * 0.5, eased);
    this.introPrincess.visible = progress < 0.72;
  }

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.elapsed,
      state: this.state,
      score: this.score,
      targetScore: this.targetCoins(),
      complete: this.state === 'won',
      hearts: this.hearts,
      shield: this.shieldTimer,
      level: this.level,
      pickupsActive: this.pickups.filter((pickup) => pickup.active).length,
      obstacles: this.obstacles.length,
      player: {
        position: {
          x: this.player.group.position.x,
          y: this.player.group.position.y,
          z: this.player.group.position.z,
        },
        speed: this.player.velocity.length(),
        steer: this.input.getSteer(),
      },
      renderer: {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
      },
      canvas: {
        clientWidth: this.canvas.clientWidth,
        clientHeight: this.canvas.clientHeight,
        width: this.canvas.width,
        height: this.canvas.height,
        dpr: Math.min(window.devicePixelRatio || 1, this.tuning.maxDpr),
      },
      audio: {
        muted: this.muted,
      },
    };
  }

  private targetCoins(): number {
    return BASE_TARGET_COINS + Math.min(this.level - 1, 4) * 4;
  }

  private levelDistance(): number {
    return BASE_LEVEL_DISTANCE + Math.min(this.level - 1, 4) * 46;
  }

  private levelSpeed(): number {
    return 9.7 + Math.min(this.level - 1, 4) * 0.45;
  }

  private getElement(selector: string): HTMLElement {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
  }
}
