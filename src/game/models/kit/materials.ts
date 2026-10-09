import * as THREE from 'three';
import { PAL } from './palette';

/**
 * Global shader uniforms shared by every "world" material.
 *
 * - Curved world: geometry away from `uCurveOrigin` (the car) drops below the horizon
 *   in both directions and drifts sideways, like a tiny storybook planet. Only the *visible* position bends;
 *   shadows and lighting use the flat world so contact shadows stay glued to objects.
 * - Wind: vertices with a `wind` attribute sway (foliage, flags, balloons).
 */
export const worldUniforms = {
  uCurveOrigin: { value: 0 },
  uCurveY: { value: 0.0016 },
  uCurveX: { value: 0 },
  uTime: { value: 0 },
};

const CURVE_PARS = /* glsl */ `
uniform float uCurveOrigin;
uniform float uCurveY;
uniform float uCurveX;
uniform float uTime;
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
float cwDz = abs( uCurveOrigin - cwWorld.z );
cwWorld.y -= uCurveY * cwDz * cwDz;
cwWorld.x += uCurveX * cwDz * cwDz;
vec4 mvPosition = viewMatrix * cwWorld;
gl_Position = projectionMatrix * mvPosition;
`;

export interface CurveOptions {
  wind?: boolean;
}

/** Patch a built-in material so it follows the curved world (and optional wind). */
export function curved<T extends THREE.Material>(material: T, opts: CurveOptions = {}): T {
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    Object.assign(shader.uniforms, worldUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${CURVE_PARS}`)
      .replace('#include <project_vertex>', CURVE_PROJECT);
  };
  if (opts.wind) {
    material.defines = { ...(material.defines ?? {}), CW_WIND: '' };
  }
  material.customProgramCacheKey = () => `curved${opts.wind ? '-wind' : ''}`;
  return material;
}

/** Evaluate the curve on the CPU (for placing screen-space UI or particles over bent objects). */
export function curveOffset(worldZ: number, out = new THREE.Vector3()): THREE.Vector3 {
  const dz = Math.abs(worldUniforms.uCurveOrigin.value - worldZ);
  return out.set(worldUniforms.uCurveX.value * dz * dz, -worldUniforms.uCurveY.value * dz * dz, 0);
}

type MatKey =
  | 'matte'
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
    case 'matteWind':
      m = curved(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }), { wind: true });
      break;
    case 'foliage':
      m = curved(
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0, emissive: new THREE.Color('#1c3d1a'), emissiveIntensity: 0.18 }),
        { wind: true },
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
