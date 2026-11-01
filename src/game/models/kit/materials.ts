import * as THREE from 'three';
import { noiseTexture } from './noise';
import { PAL } from './palette';

/**
 * Global shader uniforms shared by every "world" material.
 *
 * - Curved world: geometry away from `uCurveOrigin` (the car, xz) gently drops below the
 *   horizon in every direction, like a tiny storybook planet. Only the *visible* position
 *   bends; shadows and lighting use the real world so contact shadows stay glued to objects.
 * - Wind: vertices with a `wind` attribute sway (foliage, flags, balloons).
 * - Sunlight: soft cloud shadows drift across everything, and under the trees the sun
 *   falls through in dapples (`uDapple` goes up in the forest).
 */
export const worldUniforms = {
  uCurveOrigin: { value: new THREE.Vector2() },
  uCurveY: { value: 0.0003 },
  uTime: { value: 0 },
  uNoise: { value: null as THREE.Texture | null },
  uCloudShift: { value: new THREE.Vector2() },
  uCloudShade: { value: 0 },
  uDapple: { value: 0 },
};

const CURVE_PARS = /* glsl */ `
uniform vec2 uCurveOrigin;
uniform float uCurveY;
uniform float uTime;
varying vec3 vCw;
#ifdef CW_WIND
attribute float wind;
vec3 cwWind( vec3 p ) {
  float ph = p.x * 0.31 + p.z * 0.23;
  float s = sin( uTime * 1.6 + ph ) * 0.65 + sin( uTime * 2.7 + ph * 1.9 ) * 0.35;
  return vec3( s, 0.12 * s * s, s * 0.4 );
}
#endif
`;

const CURVE_PROJECT = /* glsl */ `
vec4 cwWorld = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  cwWorld = batchingMatrix * cwWorld;
#endif
#ifdef USE_INSTANCING
  cwWorld = instanceMatrix * cwWorld;
#endif
cwWorld = modelMatrix * cwWorld;
#ifdef CW_WIND
  cwWorld.xyz += cwWind( cwWorld.xyz ) * wind;
#endif
vCw = cwWorld.xyz;
vec2 cwD = cwWorld.xz - uCurveOrigin;
cwWorld.y -= uCurveY * dot( cwD, cwD );
vec4 mvPosition = viewMatrix * cwWorld;
gl_Position = projectionMatrix * mvPosition;
`;

/**
 * The shadow map's texels are coarse next to the hero car and princess, so they would speckle
 * themselves. They lean further off their own surface when looking up the map than the world does.
 */
export const HERO_SHADOW_VERTEX = /* glsl */ `
#include <shadowmap_vertex>
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  vDirectionalShadowCoord[ 0 ] = directionalShadowMatrix[ 0 ] * ( worldPosition + vec4( shadowWorldNormal * 0.1, 0.0 ) );
#endif
`;

const SUN_PARS = /* glsl */ `
uniform sampler2D uNoise;
uniform vec2 uCloudShift;
uniform float uCloudShade;
uniform float uDapple;
uniform float uTime;
varying vec3 vCw;
float cwSunlight() {
  float cloud = texture2D( uNoise, ( vCw.xz + uCloudShift ) * 0.0034 ).r;
  float sun = 1.0 - uCloudShade * smoothstep( 0.5, 0.7, cloud );
  if ( uDapple > 0.002 ) {
    float a = texture2D( uNoise, vCw.xz * 0.05 + vec2( uTime * 0.0035, 0.0 ) ).g;
    float b = texture2D( uNoise, vCw.xz * 0.029 - vec2( 0.0, uTime * 0.0024 ) ).g;
    sun *= mix( 1.0, 0.3 + 0.7 * smoothstep( 0.45, 0.58, a * 0.62 + b * 0.52 ), uDapple );
  }
  return sun;
}
`;

/** Lawn is the whole surface unless the material names the atlas column that holds it. */
const grassDetail = (lawnU?: readonly [number, number]) => /* glsl */ `
float cwLawn = ${lawnU ? `step( ${lawnU[0].toFixed(5)}, vMapUv.x ) * step( vMapUv.x, ${lawnU[1].toFixed(5)} )` : '1.0'};
float cwBig = texture2D( uNoise, vCw.xz * 0.0117 ).r;
float cwTuft = texture2D( uNoise, vCw.xz * 0.07 ).g;
float cwFine = texture2D( uNoise, vCw.xz * 0.29 ).b;
float cwBlades = ( cwBig - 0.5 ) * 0.62 + ( cwTuft - 0.42 ) * 0.5 + ( cwFine - 0.5 ) * 0.68;
vec3 cwGrass = mix( diffuseColor.rgb * vec3( 0.72, 0.83, 0.84 ), diffuseColor.rgb * vec3( 1.17, 1.1, 0.76 ), smoothstep( -0.36, 0.36, cwBlades ) );
diffuseColor.rgb = mix( diffuseColor.rgb * ( 0.94 + 0.12 * cwBig ), cwGrass, cwLawn );
`;

const LEAF_DETAIL = /* glsl */ `
float cwClump = texture2D( uNoise, ( vCw.xz + vCw.y * vec2( 0.8, -0.7 ) ) * 0.15 ).g;
float cwSpeck = texture2D( uNoise, ( vCw.xz + vCw.y * vec2( -0.7, 0.8 ) ) * 0.41 ).b;
diffuseColor.rgb *= 0.8 + 0.3 * cwClump + 0.2 * cwSpeck;
`;

/** Coursed stone blocks in world space, each with its own tone: big walls stop being flat planes. */
const STONE_DETAIL = /* glsl */ `
vec2 cwCourse = vec2( vCw.x + vCw.z, vCw.y ) * vec2( 0.62, 1.6 );
cwCourse.x += floor( cwCourse.y ) * 0.5;
vec2 cwBlock = fract( cwCourse );
float cwJoint = smoothstep( 0.0, 0.05, min( cwBlock.y, 1.0 - cwBlock.y ) ) * smoothstep( 0.0, 0.02, min( cwBlock.x, 1.0 - cwBlock.x ) );
float cwTone = texture2D( uNoise, floor( cwCourse ) * 0.137 ).g;
diffuseColor.rgb *= ( 0.91 + 0.2 * cwTone ) * mix( 0.84, 1.0, cwJoint );
`;

/** Soft glow around a crown's edge, as if the sun were coming through the leaves. */
const LEAF_RIM = /* glsl */ `
float cwRim = 1.0 - saturate( dot( normal, geometryViewDir ) );
totalEmissiveRadiance += diffuseColor.rgb * cwRim * cwRim * cwRim * 0.3 * cwSun;
`;

export interface CurveOptions {
  wind?: boolean;
  /** Per-pixel surface detail: tufts and blades on grass, clumps on leaves, blocks on stone. */
  detail?: 'grass' | 'leaves' | 'stone';
  /** With grass detail, the span of map u that is lawn (the rest stays as painted). */
  lawnU?: readonly [number, number];
  /** Keeps programs apart for materials with extra patches of their own. */
  key?: string;
}

/** Patch a built-in material so it follows the curved world (and optional wind). */
export function curved<T extends THREE.Material>(material: T, opts: CurveOptions = {}): T {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    worldUniforms.uNoise.value ??= noiseTexture();
    Object.assign(shader.uniforms, worldUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${CURVE_PARS}`)
      .replace('#include <project_vertex>', CURVE_PROJECT);
    const detail = opts.detail === 'grass' ? grassDetail(opts.lawnU) : opts.detail === 'leaves' ? LEAF_DETAIL : opts.detail === 'stone' ? STONE_DETAIL : '';
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${SUN_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${detail}`)
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        float cwSun = cwSunlight();
        reflectedLight.directDiffuse *= cwSun;
        reflectedLight.directSpecular *= cwSun;
        ${opts.detail === 'leaves' ? LEAF_RIM : ''}`,
      );
  };
  if (opts.wind) {
    material.defines = { ...(material.defines ?? {}), CW_WIND: '' };
  }
  const key = ['curved', opts.wind && 'wind', opts.detail, opts.lawnU?.join(), opts.key].filter(Boolean).join('-');
  material.customProgramCacheKey = () => key;
  return material;
}

type MatKey =
  | 'matte'
  | 'stone'
  | 'matteWind'
  | 'satin'
  | 'gloss'
  | 'metal'
  | 'glass'
  | 'glow'
  | 'foliage';

const cache = new Map<MatKey, THREE.Material>();

/**
 * Shared material roles for vertex-colored geometry. Everything in a street
 * chunk uses one of these, so a whole chunk renders in ~5 draw calls.
 */
export function mat(key: MatKey): THREE.Material {
  const hit = cache.get(key);
  if (hit) return hit;
  let m: THREE.Material;
  switch (key) {
    case 'matte':
      m = curved(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 }));
      break;
    case 'stone':
      // A touch of its own pink, so a wall in shade stays rosy instead of turning grey.
      m = curved(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, emissive: new THREE.Color('#ff9db8'), emissiveIntensity: 0.11 }), { detail: 'stone' });
      break;
    case 'matteWind':
      m = curved(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }), { wind: true });
      break;
    case 'foliage':
      m = curved(
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, emissive: new THREE.Color('#1c3d1a'), emissiveIntensity: 0.18 }),
        { wind: true, detail: 'leaves' },
      );
      break;
    case 'satin':
      m = curved(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0 }));
      break;
    case 'gloss':
      m = curved(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.32, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.18 }));
      break;
    case 'metal':
      m = curved(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 1 }));
      break;
    case 'glass':
      m = curved(
        new THREE.MeshStandardMaterial({
          color: PAL.glass,
          roughness: 0.08,
          metalness: 0.2,
          envMapIntensity: 1.6,
          emissive: new THREE.Color('#7fb8e6'),
          emissiveIntensity: 0.12,
        }),
      );
      break;
    case 'glow':
      m = curved(new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
      break;
  }
  m.name = key;
  cache.set(key, m);
  return m;
}

/** Create a mesh from a vertex-colored geometry with a shared material role. */
export function meshOf(geometry: THREE.BufferGeometry | null, key: MatKey, shadows: { cast?: boolean; receive?: boolean } = {}): THREE.Mesh | null {
  if (!geometry) return null;
  const mesh = new THREE.Mesh(geometry, mat(key));
  mesh.castShadow = shadows.cast ?? true;
  mesh.receiveShadow = shadows.receive ?? true;
  return mesh;
}
