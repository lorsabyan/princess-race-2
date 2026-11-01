import * as THREE from 'three';
import {
  BloomEffect,
  BrightnessContrastEffect,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { LOOK_NOW } from './look';

export type QualityTier = 'high' | 'medium' | 'low';

interface TierSettings {
  dpr: number;
  msaa: number;
  ao: 'Medium' | 'Performance' | null;
  aoHalfRes: boolean;
  shadowSize: number;
  bloom: boolean;
}

const TIERS: Record<QualityTier, TierSettings> = {
  high: { dpr: 2, msaa: 4, ao: 'Medium', aoHalfRes: false, shadowSize: 2048, bloom: true },
  medium: { dpr: 1.6, msaa: 0, ao: 'Performance', aoHalfRes: true, shadowSize: 2048, bloom: true },
  low: { dpr: 1.25, msaa: 0, ao: null, aoHalfRes: true, shadowSize: 1024, bloom: true },
};

const TIER_ORDER: QualityTier[] = ['high', 'medium', 'low'];

export function detectTier(): QualityTier {
  const forced = new URLSearchParams(location.search).get('q');
  if (forced === 'high' || forced === 'medium' || forced === 'low') return forced;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return coarse ? 'medium' : 'high';
}

export interface StageStats {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  tier: QualityTier;
  dpr: number;
  fps: number;
}

/**
 * Owns the WebGL renderer and the post-processing chain:
 * scene -> N8AO ambient occlusion -> bloom + grade + vignette + tone mapping (+ SMAA).
 * Quality tiers change resolution, MSAA, AO and shadow size; a frame-time monitor
 * steps down automatically if a device cannot keep up.
 */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  tier: QualityTier;
  adaptive = true;
  /** Lights whose shadow map size follows the quality tier. */
  readonly shadowLights: THREE.DirectionalLight[] = [];

  private readonly renderPass: RenderPass;
  private ao: N8AOPostPass | null = null;
  private effectPass: EffectPass | null = null;
  private readonly bloom: BloomEffect;
  private readonly tone: ToneMappingEffect;
  private readonly vignette: VignetteEffect;
  private readonly grade: HueSaturationEffect;
  private readonly contrast: BrightnessContrastEffect;
  private readonly smaa: SMAAEffect;
  private width = 1;
  private height = 1;
  private frameTimes: number[] = [];
  private slowWindows = 0;
  private fps = 60;
  private lastInfo = { calls: 0, triangles: 0 };

  constructor(
    readonly canvas: HTMLCanvasElement,
    public scene: THREE.Scene,
    public camera: THREE.PerspectiveCamera,
    tier: QualityTier = detectTier(),
  ) {
    this.tier = tier;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: new URLSearchParams(location.search).has('shot'),
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;

    const maxSamples = this.renderer.capabilities.maxSamples ?? 0;
    this.composer = new EffectComposer(this.renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: Math.min(TIERS[tier].msaa, maxSamples),
    });
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    this.bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: LOOK_NOW.bloom.threshold,
      luminanceSmoothing: 0.12,
      intensity: LOOK_NOW.bloom.intensity,
      radius: 0.72,
      levels: 7,
    });
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL });
    this.vignette = new VignetteEffect({ offset: 0.28, darkness: LOOK_NOW.vignette });
    this.grade = new HueSaturationEffect({ saturation: LOOK_NOW.grade.saturation, hue: 0 });
    this.contrast = new BrightnessContrastEffect({ brightness: LOOK_NOW.grade.brightness, contrast: LOOK_NOW.grade.contrast });
    this.smaa = new SMAAEffect({ preset: SMAAPreset.MEDIUM });

    this.applyTier();
    this.resize();
  }

  /** Swap the scene/camera being rendered (e.g. lab vs game). */
  setView(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    this.scene = scene;
    this.camera = camera;
    this.renderPass.mainScene = scene;
    this.renderPass.mainCamera = camera;
    this.applyTier();
  }

  setTier(tier: QualityTier): void {
    if (tier === this.tier) return;
    this.tier = tier;
    this.applyTier();
    this.resize(true);
  }

  resize(force = false): void {
    const w = Math.max(1, Math.floor(this.canvas.clientWidth || window.innerWidth));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight || window.innerHeight));
    if (!force && w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    const dpr = Math.min(window.devicePixelRatio || 1, TIERS[this.tier].dpr);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(dt: number): void {
    this.resize();
    this.renderer.info.reset();
    this.composer.render(dt);
    this.lastInfo.calls = this.renderer.info.render.calls;
    this.lastInfo.triangles = this.renderer.info.render.triangles;
    this.trackPerformance(dt);
  }

  get aspect(): number {
    return this.width / this.height;
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  stats(): StageStats {
    const info = this.renderer.info;
    return {
      calls: this.lastInfo.calls,
      triangles: this.lastInfo.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      programs: info.programs?.length ?? 0,
      tier: this.tier,
      dpr: this.renderer.getPixelRatio(),
      fps: Math.round(this.fps),
    };
  }

  dispose(): void {
    this.composer.dispose();
    this.renderer.dispose();
  }

  private applyTier(): void {
    const s = TIERS[this.tier];
    const maxSamples = this.renderer.capabilities.maxSamples ?? 0;
    this.composer.multisampling = Math.min(s.msaa, maxSamples);

    if (this.ao) {
      this.composer.removePass(this.ao);
      this.ao.dispose();
      this.ao = null;
    }
    if (this.effectPass) {
      this.composer.removePass(this.effectPass);
      this.effectPass.dispose();
      this.effectPass = null;
    }

    if (s.ao) {
      const ao = new N8AOPostPass(this.scene, this.camera, this.width, this.height);
      ao.setQualityMode(s.ao);
      ao.configuration.aoRadius = 1.6;
      ao.configuration.distanceFalloff = 1.0;
      ao.configuration.intensity = 2.4;
      ao.configuration.color = new THREE.Color('#5a3a66');
      ao.configuration.halfRes = s.aoHalfRes;
      ao.configuration.depthAwareUpsampling = true;
      ao.configuration.gammaCorrection = false;
      this.ao = ao;
      this.composer.addPass(ao);
    }

    const effects = [];
    if (s.bloom) effects.push(this.bloom);
    effects.push(this.grade, this.contrast, this.vignette, this.tone);
    if (s.msaa === 0 || maxSamples === 0) effects.push(this.smaa);
    this.effectPass = new EffectPass(this.camera, ...effects);
    this.composer.addPass(this.effectPass);

    for (const light of this.shadowLights) {
      if (light.shadow.mapSize.x !== s.shadowSize) {
        light.shadow.mapSize.set(s.shadowSize, s.shadowSize);
        light.shadow.map?.dispose();
        light.shadow.map = null;
      }
    }
  }

  private trackPerformance(dt: number): void {
    if (dt <= 0 || dt > 0.5) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 120) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    this.fps = 1 / avg;
    if (!this.adaptive || document.hidden) return;
    if (this.fps < 42) this.slowWindows += 1;
    else this.slowWindows = Math.max(0, this.slowWindows - 1);
    if (this.slowWindows >= 2) {
      this.slowWindows = 0;
      const next = TIER_ORDER[TIER_ORDER.indexOf(this.tier) + 1];
      if (next) this.setTier(next);
    }
  }
}
