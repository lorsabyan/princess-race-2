import * as THREE from 'three';
import { Stage } from './view/Stage';
import { Sky } from './view/Sky';
import { Lighting, SUN_DIR } from './view/Lighting';
import { CameraRig } from './view/CameraRig';
import { WorldView } from './view/WorldView';
import { Air } from './view/Air';
import { Vfx } from './view/Vfx';
import { Input, type InputAction } from './input/Input';
import { AudioEngine } from './audio/Audio';
import { loadModelLibrary, type LibraryReport } from './models/library';
import type { Backdrop, CarRig, Landmark, ModelLibrary, PrincessHome, PrincessRig } from './models/contracts';
import { generateLevel } from './sim/level';
import { Sim, type SimEvent } from './sim/Sim';
import { TUNING, type ObstacleKind } from './sim/config';
import { Landscape } from './sim/landscape';
import { areaAt } from './sim/route';
import { newRoadPoint } from './sim/track';
import { LOOK_NOW, REDUCED_MOTION } from './view/look';
import type { RoadWorld } from './view/warp';
import { worldUniforms } from './models/kit/materials';
import { loadSave, ui, writeSave } from '../app/state';

const STEP = 1 / 60;
/** Obstacles that hop or boing when the horn sounds. */
const HONK_REACTS: ReadonlySet<ObstacleKind> = new Set<ObstacleKind>(['ducks', 'sheep', 'mushrooms']);
/** Tiny-planet bend while driving; gentler for the celebration so the castle stands tall. */
const DRIVE_BEND = 0.0003;
const FINISH_BEND = 0.00015;
/** How high the car hops over a road hump. */
const HOP_HEIGHT = REDUCED_MOTION ? 0.25 : 0.72;
const params = new URLSearchParams(location.search);
/** QA only: ?timescale=3 runs the whole game faster (full-level tests). */
const TIMESCALE = Math.max(0.1, Math.min(8, Number(params.get('timescale')) || 1));

type Mode = 'loading' | 'title' | 'intro' | 'drive' | 'finish' | 'results';

declare global {
  interface Window {
    __ready?: boolean;
    __threeReady?: boolean;
    __GAME__?: {
      stats: () => Record<string, unknown>;
      game: Game;
    };
  }
}

/** Ease an angle toward a target along the shortest arc. */
function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  let delta = (target - current) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * (1 - Math.exp(-lambda * dt));
}

function smooth(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

/**
 * Orchestrates one play session: loading, title, intro cinematic, driving
 * (fixed-step simulation), finish celebration and results. Rendering, audio
 * and UI all react to simulation events; the simulation never waits on them.
 */
export class Game {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(52, 1, 0.1, 1100);
  readonly stage: Stage;
  readonly audio = new AudioEngine();
  private readonly sky: Sky;
  private readonly lighting: Lighting;
  private readonly cam: CameraRig;
  private readonly vfx = new Vfx();
  private readonly air = new Air(SUN_DIR);
  private readonly input: Input;
  private lib!: ModelLibrary;
  private libReport: LibraryReport = { real: [], placeholder: [] };
  private car!: CarRig;
  private princess!: PrincessRig;
  private home!: PrincessHome;
  private castle!: Landmark;
  private backdrop!: Backdrop;
  private world: WorldView | null = null;
  private road: RoadWorld | null = null;
  private readonly roadPoint = newRoadPoint();
  private readonly skyFrom = { x: 0, y: 0, z: 0 };
  private readonly skyTo = { x: 0, y: 0, z: 0 };
  private readonly skyLook = new THREE.Vector3();
  private sim: Sim | null = null;
  private mode: Mode = 'loading';
  private modeTime = 0;
  private time = 0;
  private accumulator = 0;
  private lastNow = 0;
  private level: number;
  private readonly save = loadSave();
  private readonly carPos = new THREE.Vector3();
  private readonly prevCar = new THREE.Vector2();
  private readonly tmp = new THREE.Vector3();
  private readonly seatWorld = new THREE.Vector3();
  private readonly walkStart = new THREE.Vector3();
  private readonly walkEnd = new THREE.Vector3();
  private readonly titleTarget = new THREE.Vector3(-0.9, 1.0, 0.2);
  private seated = false;
  /** QA warps (?at=) jump the camera straight to the car instead of easing there. */
  private snapCamera = false;
  private introSkipped = false;
  private titleWave = 2.5;
  private resultsConfetti = 0;
  private steerHintTimer = 0;
  private driveStarted = false;
  private frameId = 0;
  private hiddenPause = false;
  /** Screenshot/QA freeze (?freeze=seconds): stops time without showing the pause menu. */
  private frozen = false;

  constructor(canvas: HTMLCanvasElement) {
    window.__threeReady = false;
    this.level = Number(params.get('level')) || this.save.level;
    ui.level.value = this.level;
    ui.bestStars.value = this.save.bestStars;
    ui.muted.value = this.save.muted;
    this.audio.setMuted(this.save.muted);

    this.stage = new Stage(canvas, this.scene, this.camera);
    this.cam = new CameraRig(this.camera);
    this.sky = new Sky({ sunDir: SUN_DIR });
    this.scene.add(this.sky.group);
    this.scene.environment = Sky.bakeEnvironment(this.stage.renderer, SUN_DIR);
    this.scene.environmentIntensity = LOOK_NOW.env;
    this.scene.fog = new THREE.Fog(LOOK_NOW.fog, 120, 420);
    this.lighting = new Lighting(this.scene);
    this.stage.shadowLights.push(this.lighting.sun);
    this.scene.add(this.vfx.group, this.air.group);
    worldUniforms.uCloudShade.value = LOOK_NOW.shade.cloud;

    this.input = new Input(canvas, (action) => this.onAction(action));
    document.addEventListener('visibilitychange', this.onVisibility);

    window.__GAME__ = { stats: () => this.stats(), game: this };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async init(): Promise<void> {
    ui.screen.value = 'loading';
    ui.loadProgress.value = 0.05;
    this.frameId = requestAnimationFrame(this.frame);

    const { library, report } = await loadModelLibrary();
    this.lib = library;
    this.libReport = report;
    if (report.placeholder.length) console.info('[models] placeholders in use:', report.placeholder.join(', '));
    ui.loadProgress.value = 0.15;
    await this.yieldFrame();

    this.car = this.lib.createCar();
    this.princess = this.lib.createPrincess();
    ui.loadProgress.value = 0.25;
    await this.yieldFrame();
    this.home = this.lib.createPrincessHome();
    this.castle = this.lib.createCastleGate();
    this.backdrop = this.lib.createBackdrop();
    this.scene.add(this.car.root, this.princess.root, this.backdrop.group);
    ui.loadProgress.value = 0.35;
    await this.yieldFrame();

    await this.loadLevel(this.level, (p) => {
      ui.loadProgress.value = 0.35 + p * 0.55;
    });
    this.stage.renderer.compile(this.scene, this.camera);
    ui.loadProgress.value = 1;

    if (params.has('autoplay')) {
      this.showTitle();
      this.startIntro(true);
    } else {
      this.showTitle();
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.frameId);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.input.dispose();
    this.audio.dispose();
    this.world?.dispose();
    this.vfx.dispose();
    this.air.dispose();
    this.stage.dispose();
  }

  // ---------------------------------------------------------------------------
  // UI commands
  // ---------------------------------------------------------------------------

  /** Title "play" button. */
  play(): void {
    this.audio.unlock();
    this.audio.tap();
    if (this.mode === 'title') this.startIntro(false);
  }

  setPaused(paused: boolean): void {
    if (this.mode !== 'drive' && this.mode !== 'intro' && paused) return;
    ui.paused.value = paused;
    this.audio.setMusicEnabled(!paused);
    this.audio.setEngine(0, false);
    if (!paused) this.lastNow = performance.now();
  }

  toggleMute(): void {
    this.audio.unlock();
    const muted = !ui.muted.value;
    ui.muted.value = muted;
    this.audio.setMuted(muted);
    this.save.muted = muted;
    writeSave(this.save);
  }

  honk(): void {
    this.audio.unlock();
    this.audio.honk();
    this.tmp.copy(this.carPos).add(new THREE.Vector3(0, 2.3, -0.4));
    this.vfx.hearts(this.tmp, 4);
    if (this.seated) this.princess.wave();
    // Ducks and sheep nearby hop out of the way, toadstools boing, windmills whirl. Silly and satisfying.
    if (this.sim && this.world) {
      for (const o of this.sim.obstacles) {
        const ahead = this.sim.car.z - o.z;
        if (HONK_REACTS.has(o.kind) && ahead > 0 && ahead < 30) this.world.obstacle(o.id)?.react(o.x < this.sim.car.x ? -1 : 1);
      }
      this.world.honk(this.sim.distance);
    }
  }

  async restart(): Promise<void> {
    this.audio.tap();
    ui.paused.value = false;
    this.audio.setMusicEnabled(true);
    this.resetLevelState();
    this.showTitle();
    this.startIntro(true);
  }

  async nextLevel(): Promise<void> {
    this.audio.tap();
    this.level += 1;
    ui.level.value = this.level;
    ui.screen.value = 'loading';
    ui.loadProgress.value = 0.1;
    await this.loadLevel(this.level, (p) => {
      ui.loadProgress.value = 0.1 + p * 0.85;
    });
    ui.loadProgress.value = 1;
    this.showTitle();
    this.startIntro(true);
  }

  goHome(): void {
    this.audio.tap();
    ui.paused.value = false;
    this.audio.setMusicEnabled(true);
    this.resetLevelState();
    this.showTitle();
  }

  // ---------------------------------------------------------------------------
  // Level + modes
  // ---------------------------------------------------------------------------

  private async loadLevel(level: number, onProgress: (p: number) => void): Promise<void> {
    this.world?.dispose();
    const data = generateLevel(level);
    this.sim = new Sim(data);
    const road: RoadWorld = { track: data.track, land: new Landscape(data.track, data.seed) };
    this.road = road;
    const world = new WorldView(this.lib, data, this.home, this.castle, road);
    this.world = world;
    this.scene.add(world.group);
    world.buildLand(SUN_DIR, this.scene.fog as THREE.Fog);
    await world.build(onProgress);
    ui.totalCoins.value = this.sim.totalCoins;
    ui.areaMarks.value = data.track.route.slice(1).map((r) => ({ area: r.area, at: r.from / data.length }));
  }

  private resetLevelState(): void {
    if (!this.sim || !this.world) return;
    this.sim = new Sim(this.sim.level);
    for (const o of this.sim.obstacles) this.world.obstacle(o.id)?.reset();
    this.vfx.clear();
  }

  private showTitle(): void {
    this.setMode('title');
    ui.screen.value = 'title';
    ui.coins.value = 0;
    ui.progress.value = 0;
    ui.areaFlash.value = null;
    this.audio.setArea('town');
    this.audio.playSong('title');
    this.seated = false;
    this.driveStarted = false;
    // Car parked at the start, princess waiting at the end of her garden path.
    this.carPos.set(0, 0, 0);
    this.car.root.position.set(0, 0, 0);
    this.car.root.rotation.set(0, 0, 0);
    this.princess.root.removeFromParent();
    this.scene.add(this.princess.root);
    this.princess.setPose('stand');
    const path = this.home.pathPoints;
    const end = path[path.length - 1] ?? new THREE.Vector3(-1.6, 0, 0);
    const before = path[path.length - 2] ?? end.clone().add(new THREE.Vector3(-2.5, 0, 0));
    // She waits a few steps from the car door so the title shot holds both of them.
    const back = Math.min(1, 1.8 / Math.max(0.01, end.distanceTo(before)));
    this.walkStart.copy(end).lerp(before, back);
    this.walkEnd.copy(end);
    this.titleTarget.set((this.walkStart.x + 0) / 2, 1.0, (this.walkStart.z + 0) / 2);
    this.princess.root.position.set(this.walkStart.x, this.princess.standHeight, this.walkStart.z);
    this.princess.root.rotation.set(0, Math.PI * 0.9, 0);
    this.input.enabled = false;
    this.input.targetX = 0;
    worldUniforms.uCurveOrigin.value.set(0, 0);
    worldUniforms.uCurveY.value = DRIVE_BEND;
    this.cam.followLambda = 2.2;
    this.cam.targetLambda = 3;
    this.cam.orbit(this.titleTarget, 6.8, 1.3, Math.PI - 0.55, 40, this.stage.aspect);
    this.cam.snap();
    // Greet the camera right away.
    const cp = this.camera.position;
    this.princess.root.rotation.y = Math.atan2(-(cp.x - this.walkStart.x), -(cp.z - this.walkStart.z));
    window.__ready = !params.has('freeze') && !params.has('autoplay');
    window.__threeReady = window.__ready;
  }

  private startIntro(quick: boolean): void {
    this.setMode('intro');
    ui.screen.value = 'intro';
    this.introSkipped = quick;
    this.audio.playSong('drive');
    this.cam.followLambda = 2.4;
    this.cam.targetLambda = 3.2;
  }

  private startDrive(): void {
    this.setMode('drive');
    ui.screen.value = 'play';
    this.seatPrincess();
    this.sim!.start();
    if (params.has('at')) {
      this.sim!.warpTo(Number(params.get('at')));
      this.prevCar.set(this.sim!.car.x, this.sim!.car.z);
      this.snapCamera = true;
    }
    this.input.enabled = true;
    this.input.targetX = 0;
    this.driveStarted = true;
    this.audio.go();
    this.princess.wave();
    this.cam.followLambda = 4.2;
    this.cam.targetLambda = 6;
    this.steerHintTimer = 0;
    ui.showSteerHint.value = this.level <= 2;
  }

  private setMode(mode: Mode): void {
    this.mode = mode;
    this.modeTime = 0;
  }

  private seatPrincess(): void {
    if (this.seated) return;
    this.seated = true;
    this.princess.setPose('sit');
    this.princess.root.removeFromParent();
    this.car.seat.add(this.princess.root);
    this.princess.root.position.set(0, 0, 0);
    this.princess.root.rotation.set(0, 0, 0);
  }

  // ---------------------------------------------------------------------------
  // Frame loop
  // ---------------------------------------------------------------------------

  private readonly frame = (now: number) => {
    this.frameId = requestAnimationFrame(this.frame);
    const raw = this.lastNow ? (now - this.lastNow) / 1000 : 0;
    this.lastNow = now;
    const dt = Math.min(raw, 0.1) * TIMESCALE;
    const paused = ui.paused.value || this.frozen || this.mode === 'loading';
    const frameDt = paused ? 0 : dt;
    this.time += frameDt;
    this.modeTime += frameDt;
    worldUniforms.uTime.value = this.time;

    if (this.lib && this.sim) {
      this.updateMode(frameDt);
      this.updateVisuals(frameDt, dt);
    }
    this.stage.render(dt);
    if (params.has('freeze') && !this.frozen && this.sim && this.sim.time >= Number(params.get('freeze'))) {
      this.frozen = true;
      // Let the UI settle for a couple of frames before signalling readiness.
      window.setTimeout(() => {
        window.__ready = true;
        window.__threeReady = true;
      }, 120);
    }
  };

  private updateMode(dt: number): void {
    const sim = this.sim!;
    switch (this.mode) {
      case 'title':
        this.updateTitle(dt);
        break;
      case 'intro':
        this.updateIntro(dt);
        break;
      case 'drive':
      case 'finish':
      case 'results':
        this.stepSim(dt);
        if (this.mode === 'results') this.updateResults(dt);
        break;
      default:
        break;
    }
    ui.progress.value = sim.progress;
  }

  private updateTitle(dt: number): void {
    this.titleWave -= dt;
    if (this.titleWave <= 0) {
      this.princess.wave();
      this.titleWave = 6 + Math.random() * 3;
    }
    const angle = Math.PI - 0.55 + (REDUCED_MOTION ? 0 : Math.sin(this.time * 0.13) * 0.28);
    this.cam.orbit(this.titleTarget, 6.8, 1.3, angle, 40, this.stage.aspect);
    // She turns to face the camera.
    const p = this.princess.root.position;
    const face = Math.atan2(-(this.camera.position.x - p.x), -(this.camera.position.z - p.z));
    this.princess.root.rotation.y = dampAngle(this.princess.root.rotation.y, face, 3, dt);
    this.princess.update(dt, { time: this.time, steer: 0, speed: 0, walk: 0 });
    this.car.update(dt, { time: this.time, speed: 0, steer: 0, bump: 0 });
  }

  private updateIntro(dt: number): void {
    const t = this.modeTime;
    const p = this.princess;
    if (this.introSkipped) {
      // Quick hop straight into the seat.
      this.car.seat.getWorldPosition(this.seatWorld);
      if (!this.seated) {
        const k = smooth(t / 0.7);
        this.tmp.copy(this.walkEnd).setY(p.standHeight).lerp(this.seatWorld, k);
        this.tmp.y += Math.sin(k * Math.PI) * 1.1;
        p.root.position.copy(this.tmp);
        p.root.rotation.y = dampAngle(p.root.rotation.y, 0, 10, dt);
        if (k > 0.5) p.setPose('sit');
        if (t >= 0.7) this.seatPrincess();
      }
      this.cam.chase(this.road!.track, 0, 0, 0, 0, this.stage.aspect);
      if (t > 0.9) this.startDrive();
    } else {
      // 1) walk to the car door, 2) hop in, 3) wave, 4) go.
      const walkDur = 1.5;
      const hopDur = 0.8;
      if (t < walkDur) {
        const k = smooth(t / walkDur);
        this.tmp.copy(this.walkStart).lerp(this.walkEnd, k);
        p.root.position.set(this.tmp.x, p.standHeight, this.tmp.z);
        const dx = this.walkEnd.x - this.walkStart.x;
        const dz = this.walkEnd.z - this.walkStart.z;
        const face = Math.atan2(-dx, -dz);
        p.root.rotation.y = dampAngle(p.root.rotation.y, face, 8, dt);
        p.update(dt, { time: this.time, steer: 0, speed: 0, walk: 1 });
        this.cam.look(new THREE.Vector3(-6.2, 2.6, 4.2), new THREE.Vector3(-1.1, 1.0, 0), 42);
      } else if (!this.seated) {
        const k = smooth((t - walkDur) / hopDur);
        this.car.seat.getWorldPosition(this.seatWorld);
        this.tmp.copy(this.walkEnd).setY(p.standHeight).lerp(this.seatWorld, k);
        this.tmp.y += Math.sin(k * Math.PI) * 1.2;
        p.root.position.copy(this.tmp);
        p.root.rotation.y = dampAngle(p.root.rotation.y, 0, 8, dt);
        if (k > 0.5) p.setPose('sit');
        if (k >= 1) {
          this.seatPrincess();
          p.wave();
        }
        this.cam.chase(this.road!.track, 0, 0, 0, 0, this.stage.aspect);
      } else {
        this.cam.chase(this.road!.track, 0, 0, 0, 0, this.stage.aspect);
      }
      if (t > walkDur + hopDur + 1.0) this.startDrive();
    }
    if (!this.seated) p.update(dt, { time: this.time, steer: 0, speed: 0, walk: this.introSkipped ? 0 : 1 });
    this.car.update(dt, { time: this.time, speed: 0, steer: 0, bump: 0 });
  }

  private stepSim(dt: number): void {
    const sim = this.sim!;
    const bot = (params.has('bot') || params.has('freeze')) && !params.has('nobot');
    if (bot) this.botSteer(sim);
    else if (this.mode === 'drive') sim.setTargetX(this.input.update(dt));
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= STEP && steps < 8 * TIMESCALE) {
      this.prevCar.set(sim.car.x, sim.car.z);
      sim.step(STEP);
      this.accumulator -= STEP;
      steps += 1;
    }
    for (const event of sim.events.splice(0)) this.onSimEvent(event);
    if (this.mode === 'drive' && ui.showSteerHint.value) {
      this.steerHintTimer += dt;
      if (this.input.dragging || this.steerHintTimer > 7 || Math.abs(sim.car.x) > 0.8) ui.showSteerHint.value = false;
    }
  }

  private botSteer(sim: Sim): void {
    let best: { x: number; z: number } | null = null;
    for (const c of sim.coins) {
      if (!c.alive || c.z > sim.car.z + 0.5 || c.z < sim.car.z - 26) continue;
      if (!best || c.z > best.z) best = c;
    }
    sim.setTargetX(best ? best.x : 0);
  }

  private onSimEvent(e: SimEvent): void {
    const sim = this.sim!;
    switch (e.type) {
      case 'coin':
        this.vfx.coin(this.roadSpot(e.x, TUNING.coinHover, e.z), e.combo);
        this.audio.coin(e.combo);
        ui.coins.value = sim.collected;
        ui.coinPulse.value += 1;
        break;
      case 'gem':
        this.vfx.gem(this.roadSpot(e.x, TUNING.coinHover + 0.2, e.z));
        this.audio.gem();
        this.princess.setMood('joy', 1.4);
        ui.coins.value = sim.collected;
        ui.coinPulse.value += 1;
        ui.gemFlash.value += 1;
        break;
      case 'bump':
        this.vfx.bump(this.carPos);
        if (e.kind === 'sheep') this.audio.baa();
        else if (e.kind === 'mushrooms') this.audio.boing();
        else this.audio.bump();
        this.cam.addShake(0.4);
        this.princess.setMood('surprised', 1.1);
        this.world?.obstacle(e.obstacleId)?.react(e.side === 1 ? -1 : 1);
        ui.coins.value = sim.collected;
        break;
      case 'splash':
        this.vfx.splash(this.carPos);
        this.audio.splash();
        this.audio.giggle();
        this.princess.setMood('joy', 1.2);
        this.world?.obstacle(e.obstacleId)?.react(1);
        break;
      case 'hop':
        this.audio.whee();
        this.princess.setMood('joy', 1);
        break;
      case 'land':
        this.vfx.puff(this.carPos);
        this.audio.land();
        break;
      case 'area': {
        this.audio.setArea(e.area);
        this.audio.areaJingle(e.area);
        this.vfx.gateSparkle(this.roadSpot(0, 7, sim.car.z - 1.4));
        ui.areaFlash.value = e.area;
        ui.areaPulse.value += 1;
        break;
      }
      case 'finish':
        this.setMode('finish');
        ui.screen.value = 'finish';
        ui.showSteerHint.value = false;
        this.input.enabled = false;
        this.audio.fanfare();
        this.princess.cheer();
        this.princess.setMood('joy', 5);
        this.vfx.confetti(this.roadSpot(0, 9, -sim.level.length - 2), 220);
        break;
      case 'stopped':
        window.setTimeout(() => this.showResults(), 900 / TIMESCALE);
        break;
      default:
        break;
    }
  }

  /** World position of a point given in straight road coordinates. */
  private roadSpot(x: number, y: number, z: number): THREE.Vector3 {
    this.road!.track.toWorld(x, y, -z, this.tmp);
    return this.tmp;
  }

  private showResults(): void {
    if (this.mode !== 'finish') return;
    const sim = this.sim!;
    this.setMode('results');
    ui.stars.value = sim.stars;
    ui.coins.value = sim.collected;
    ui.screen.value = 'results';
    this.audio.playSong('results');
    const best = this.save.bestStars[this.level] ?? 0;
    this.save.bestStars = { ...this.save.bestStars, [this.level]: Math.max(best, sim.stars) };
    this.save.level = Math.max(this.save.level, this.level + 1);
    writeSave(this.save);
    ui.bestStars.value = this.save.bestStars;
    this.resultsConfetti = 0.4;
  }

  private updateResults(dt: number): void {
    this.resultsConfetti -= dt;
    if (this.resultsConfetti <= 0) {
      this.resultsConfetti = 2.8;
      this.vfx.confetti(this.tmp.copy(this.carPos).add(new THREE.Vector3(0, 7, -3)), 80);
      this.princess.cheer();
    }
  }

  private updateVisuals(dt: number, realDt: number): void {
    const sim = this.sim!;
    const car = sim.car;
    const moving = this.mode === 'drive' || this.mode === 'finish' || this.mode === 'results';
    if (moving) {
      const alpha = Math.min(1, this.accumulator / STEP);
      const x = THREE.MathUtils.lerp(this.prevCar.x, car.x, alpha);
      const z = THREE.MathUtils.lerp(this.prevCar.y, car.z, alpha);
      const track = this.road!.track;
      const frame = track.sample(-z, this.roadPoint);
      track.toWorld(x, 0, -z, this.carPos);
      const steer = THREE.MathUtils.clamp(car.vx / 6, -1, 1);
      const root = this.car.root;
      // Up and over the hump: nose up on the way, down on the way to landing.
      const hopT = car.hop > 0 ? 1 - car.hop / TUNING.hopTime : 0;
      const arc = Math.sin(hopT * Math.PI);
      root.position.copy(this.carPos);
      root.position.y += arc * HOP_HEIGHT;
      root.rotation.order = 'YXZ';
      root.rotation.y = -frame.heading - car.vx * 0.045;
      root.rotation.x = Math.atan(frame.grade) + (car.hop > 0 ? Math.cos(hopT * Math.PI) * 0.16 : 0);
      root.rotation.z = car.vx * 0.012 + frame.curvature * 3 + (REDUCED_MOTION ? 0 : Math.sin(this.time * 32) * car.bump * 0.05);
      this.car.update(dt, { time: this.time, speed: car.speed, steer, bump: car.bump });
      this.princess.update(dt, { time: this.time, steer, speed: car.speed, walk: 0 });
      worldUniforms.uCurveOrigin.value.set(this.carPos.x, this.carPos.z);

      if (this.mode === 'drive' && params.get('cam') === 'hero') {
        // QA/showcase camera: 3/4 front view riding along with the car.
        this.cam.followLambda = 6;
        this.cam.targetLambda = 8;
        this.cam.orbit(this.tmp.copy(this.carPos).setY(this.carPos.y + 1.0), 6.2, 0.9, Math.PI * 0.78 - frame.heading, 42, this.stage.aspect);
      } else if (this.mode === 'drive' && params.get('cam') === 'side') {
        this.cam.followLambda = 6;
        this.cam.targetLambda = 8;
        this.cam.orbit(this.tmp.copy(this.carPos).setY(this.carPos.y + 1.1), 7.5, 1.4, Math.PI * 0.42 - frame.heading, 40, this.stage.aspect);
      } else if (this.mode === 'drive' && params.get('cam') === 'sky') {
        // QA/showcase camera: high above the road, looking along it.
        this.cam.followLambda = 6;
        this.cam.targetLambda = 8;
        track.toWorld(0, 46, -z - 46, this.skyFrom);
        track.toWorld(0, 0, -z + 90, this.skyTo);
        this.cam.look(this.tmp.set(this.skyFrom.x, this.skyFrom.y, this.skyFrom.z), this.skyLook.set(this.skyTo.x, this.skyTo.y, this.skyTo.z), 50);
      } else if (this.mode === 'drive') {
        this.cam.chase(track, -z, x, steer, car.speed, this.stage.aspect);
      } else {
        // Swing around to the front for the celebration.
        const t = this.mode === 'finish' ? this.modeTime : this.modeTime + 3;
        const angle = THREE.MathUtils.lerp(0.25, Math.PI * 0.82, smooth((t - 0.4) / 3.2)) + Math.max(0, t - 3.6) * 0.06 - frame.heading;
        this.cam.followLambda = 2.2;
        this.cam.targetLambda = 3;
        // Portrait screens widen the orbit a lot, so start closer and higher to clear courtyard props.
        const portrait = this.stage.aspect < 1;
        if (this.mode === 'results') {
          // Aim below the car so she celebrates in the upper half, above the results card.
          this.cam.orbit(this.tmp.copy(this.carPos).setY(this.carPos.y + (portrait ? -1.3 : -0.7)), portrait ? 5.6 : 8.2, portrait ? 4.8 : 3.2, angle, 44, this.stage.aspect);
        } else {
          this.cam.orbit(this.tmp.copy(this.carPos).setY(this.carPos.y + 1.2), portrait ? 5.2 : 7.4, portrait ? 2.6 : 1.6, angle, 44, this.stage.aspect);
        }
      }
      if (car.speed > 1 && this.mode !== 'results') this.vfx.trail(dt, this.carPos, car.speed, frame.heading);
      if (areaAt(track.route, -z) === 'forest') this.vfx.fireflies(dt, this.carPos, frame.heading);
      this.audio.setEngine(car.speed, !ui.paused.value && car.speed > 0.2);
    }

    if (this.snapCamera && moving) {
      this.snapCamera = false;
      this.cam.snap();
    }
    this.cam.update(realDt > 0 && dt === 0 ? 0 : dt);
    // The shadow box sits a little ahead of the car, where the player is looking.
    const ahead = this.road!.track.sample(-sim.car.z, this.roadPoint);
    this.tmp.set(this.carPos.x + Math.sin(ahead.heading) * 12, this.carPos.y, this.carPos.z - Math.cos(ahead.heading) * 12);
    this.lighting.follow(this.tmp);
    // Gentler bend for the celebration so the castle stands tall behind the car.
    const bend = this.mode === 'finish' || this.mode === 'results' ? FINISH_BEND : DRIVE_BEND;
    worldUniforms.uCurveY.value += (bend - worldUniforms.uCurveY.value) * (1 - Math.exp(-1.5 * dt));
    // While chasing the car nothing behind the camera is visible; the title camera looks back up the street.
    this.world?.update(dt, this.time, sim, moving ? sim.car.z : 0, this.mode === 'drive' ? 14 : 125, this.stage.tier);
    this.backdrop.update(this.camera);
    this.sky.update(this.camera, this.time);
    this.vfx.update(dt, this.time);
    const here = areaAt(this.road!.track.route, -sim.car.z);
    this.air.update(dt, this.carPos, ahead.heading, here, this.stage.tier);
    worldUniforms.uCloudShift.value.set(this.time * 2.7, this.time * 1.3);
    worldUniforms.uDapple.value += ((here === 'forest' ? LOOK_NOW.shade.canopy : 0) - worldUniforms.uDapple.value) * (1 - Math.exp(-1.4 * dt));
  }

  // ---------------------------------------------------------------------------
  // Input & platform
  // ---------------------------------------------------------------------------

  private onAction(action: InputAction): void {
    if (action === 'pause') {
      if (this.mode === 'drive') this.setPaused(!ui.paused.value);
    } else if (action === 'honk') {
      if (this.mode === 'drive' || this.mode === 'title') this.honk();
    } else if (action === 'confirm') {
      if (this.mode === 'title') this.play();
      else if (this.mode === 'intro' && !this.introSkipped && this.modeTime > 0.3) this.skipIntro();
    }
  }

  /** Tap during the intro skips ahead. */
  skipIntro(): void {
    if (this.mode !== 'intro' || this.seated) return;
    this.introSkipped = true;
    this.modeTime = 0;
  }

  private readonly onVisibility = () => {
    if (document.hidden) {
      this.audio.setSuspended(true);
      if (this.mode === 'drive' && !ui.paused.value) {
        this.setPaused(true);
        this.hiddenPause = true;
      }
    } else {
      this.audio.setSuspended(false);
      this.lastNow = performance.now();
      this.hiddenPause = false;
    }
  };

  private yieldFrame(): Promise<void> {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  private stats(): Record<string, unknown> {
    const s = this.stage.stats();
    const sim = this.sim;
    return {
      mode: this.mode,
      paused: ui.paused.value,
      level: this.level,
      renderer: s,
      models: this.libReport,
      sim: sim
        ? {
            phase: sim.phase,
            time: Number(sim.time.toFixed(2)),
            x: Number(sim.car.x.toFixed(2)),
            z: Number(sim.car.z.toFixed(2)),
            speed: Number(sim.car.speed.toFixed(2)),
            collected: sim.collected,
            total: sim.totalCoins,
            bumps: sim.bumps,
            progress: Number(sim.progress.toFixed(3)),
          }
        : null,
      hiddenPause: this.hiddenPause,
      started: this.driveStarted,
    };
  }
}
