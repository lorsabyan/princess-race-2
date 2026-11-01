import * as THREE from 'three';
import { HERO_SHADOW_VERTEX, worldUniforms } from '../kit/materials';
import { noiseTexture } from '../kit/noise';
import { PAL } from '../kit/palette';
import { COVE } from './layout';

/**
 * Car materials.
 *
 * Almost everything on the car shares ONE physical material whose surface response
 * comes from a per-vertex `pbr` attribute: (roughness, metalness, clearcoat, iridescence).
 * That lets the pearl paint, chrome, gold, leather and rubber live in the same mesh
 * (one draw call) while each keeps its own look.
 */
export type Pbr = readonly [roughness: number, metalness: number, clearcoat: number, special: number];

export const PBR = {
  /** Pearl paint: clearcoat + iridescence. */
  paint: [0.3, 0, 1, 1],
  /** Cockpit tub / padded interior: soft satin, no pearl. */
  interior: [0.6, 0, 0.18, 0],
  /** Dark recesses (wheel wells, grille). */
  recess: [0.7, 0, 0, 0],
  chrome: [0.07, 1, 0, 0],
  /** w = reflection desaturation for metals: toy gold stays warm under a blue sky. */
  gold: [0.24, 1, 0, 0.75],
  tire: [0.88, 0, 0, 0],
  whitewall: [0.46, 0, 0.3, 0],
  leather: [0.46, 0, 0.3, 0],
  enamel: [0.3, 0, 0.8, 0],
  cloth: [0.75, 0, 0, 0],
} as const satisfies Record<string, Pbr>;

const PBR_VERTEX_PARS = /* glsl */ `
#include <color_pars_vertex>
attribute vec4 pbr;
varying vec4 vPbr;
varying vec3 vCarP;
`;

const PBR_FRAGMENT_PARS = /* glsl */ `
#include <color_pars_fragment>
uniform sampler2D uNoise;
varying vec4 vPbr;
varying vec3 vCarP;
float carPanel( vec2 p, vec2 c, vec2 h, float r ) {
  vec2 q = abs( p - c ) - h + r;
  return length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) - r;
}
float carSeam( float d ) {
  float w = fwidth( d );
  return ( 1.0 - smoothstep( w * 0.6 + 0.0035, w * 1.8 + 0.0045, abs( d ) ) ) * ( 1.0 - smoothstep( 0.004, 0.016, w ) );
}
`;

/** Linear RGB of a palette color, as GLSL arguments. */
function rgb(hex: string): string {
  const c = new THREE.Color(hex);
  return `${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)}`;
}

/** Door, hood and trunk shut-lines, drawn per pixel on the paint: far finer than the mesh. */
const PBR_PANELS = /* glsl */ `
#include <color_fragment>
if ( vPbr.w > 0.08 && vPbr.y < 0.5 ) {
  float seam = 0.0;
  if ( abs( vCarP.x ) > 0.42 && vCarP.y < 0.82 ) seam = carSeam( carPanel( vCarP.zy, vec2( 0.06, 0.62 ), vec2( 0.53, 0.33 ), 0.07 ) );
  if ( vCarP.y > 0.62 ) {
    seam = max( seam, carSeam( carPanel( vCarP.xz, vec2( 0.0, -1.06 ), vec2( 0.5, 0.47 ), 0.16 ) ) );
    seam = max( seam, carSeam( carPanel( vCarP.xz, vec2( 0.0, 1.0 ), vec2( 0.42, 0.34 ), 0.13 ) ) );
  }
  diffuseColor.rgb *= 1.0 - 0.74 * seam;
  // The cream side scoop, edged with a thin gold pinstripe. Drawn from a clean shape, not the
  // mesh, so the edge stays crisp where the carve meets the body at a shallow angle.
  vec2 scoop = abs( vCarP.zy - vec2( ${COVE.z}, ${COVE.y} ) ) / vec2( ${(COVE.rz * 0.8).toFixed(3)}, ${(COVE.ry * 0.82).toFixed(3)} );
  float cove = pow( pow( scoop.x, 2.6 ) + pow( scoop.y, 2.6 ), 1.0 / 2.6 );
  float coveW = fwidth( cove ) * 0.7;
  float coveSide = step( 0.6, abs( vCarP.x ) );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( ${rgb(PAL.seat)} ), ( 1.0 - smoothstep( 1.0 - coveW, 1.0 + coveW, cove ) ) * coveSide );
  diffuseColor.rgb = mix( diffuseColor.rgb, vec3( ${rgb(PAL.gold)} ), ( 1.0 - smoothstep( 0.022 - coveW, 0.022 + coveW, abs( cove - 1.024 ) ) ) * coveSide );
}
`;

const PBR_LIGHTS = /* glsl */ `
#include <lights_physical_fragment>
#ifdef USE_CLEARCOAT
  material.clearcoat *= vPbr.z;
#endif
#ifdef USE_IRIDESCENCE
  material.iridescence *= vPbr.y < 0.5 ? vPbr.w : 0.0;
#endif
`;

/** Pearl paint: tiny flakes catch the sun and twinkle as the car moves. */
const PBR_FLAKES = /* glsl */ `
#include <lights_fragment_end>
if ( vPbr.w > 0.08 && vPbr.y < 0.5 ) {
  float flakeCell = fract( sin( dot( floor( vCarP * 240.0 ), vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 );
  float flakeTurn = fract( flakeCell * 17.0 + dot( geometryViewDir, vec3( 4.1, 3.3, 6.7 ) ) );
  float flakeNear = 1.0 - smoothstep( 0.002, 0.005, fwidth( vCarP.x ) + fwidth( vCarP.z ) );
  reflectedLight.directSpecular += vec3( 1.0, 0.9, 0.94 ) * step( 0.9, flakeCell ) * smoothstep( 0.7, 1.0, flakeTurn ) * flakeNear * vPbr.w * 0.8;
}
`;

const PBR_ENV = /* glsl */ `
#include <lights_fragment_maps>
{
  float metalDesat = vPbr.y >= 0.5 ? vPbr.w : 0.0;
  float lum = dot( radiance, vec3( 0.2126, 0.7152, 0.0722 ) );
  radiance = mix( radiance, vec3( lum ) * vec3( 1.04, 1.0, 0.94 ), metalDesat );
}
`;

/** The shared car body material (vertex colors + per-vertex PBR). */
export function createCarMaterial(): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.09,
    iridescence: 0.32,
    iridescenceIOR: 1.32,
    iridescenceThicknessRange: [180, 420],
    envMapIntensity: 1.1,
  });
  m.name = 'car-pbr';
  m.onBeforeCompile = (shader) => {
    worldUniforms.uNoise.value ??= noiseTexture();
    shader.uniforms.uNoise = worldUniforms.uNoise;
    shader.vertexShader = shader.vertexShader
      .replace('#include <color_pars_vertex>', PBR_VERTEX_PARS)
      .replace('#include <color_vertex>', '#include <color_vertex>\nvPbr = pbr;\nvCarP = position;')
      .replace('#include <shadowmap_vertex>', HERO_SHADOW_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_pars_fragment>', PBR_FRAGMENT_PARS)
      .replace('#include <color_fragment>', PBR_PANELS)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPbr.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPbr.y;')
      .replace('#include <lights_physical_fragment>', PBR_LIGHTS)
      .replace('#include <lights_fragment_maps>', PBR_ENV)
      .replace('#include <lights_fragment_end>', PBR_FLAKES);
  };
  m.customProgramCacheKey = () => 'car-pbr-v8';
  // The hull is open underneath (never seen); cast shadows from both faces.
  m.shadowSide = THREE.DoubleSide;
  return m;
}

/**
 * Windshield glass: faint tint head-on, reflective at grazing angles. Uses
 * premultiplied-style output so sky reflections stay bright while the glass
 * itself remains see-through.
 */
export function createGlassMaterial(): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    color: '#dff1ff',
    roughness: 0.04,
    metalness: 0,
    envMapIntensity: 1.6,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  m.name = 'car-glass';
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  m.blendSrcAlpha = THREE.OneFactor;
  m.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float glint;\nvarying float vGlint;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlint = glint;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vGlint;')
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
      float glassNv = abs( dot( normalize( vViewPosition ), normal ) );
      float glassFres = pow( 1.0 - glassNv, 3.0 );
      float glassA = mix( 0.16, 0.66, glassFres );
      float g = vGlint * 0.5;
      glassA = max( glassA, g * 0.6 );
      gl_FragColor = vec4( totalDiffuse * glassA + totalSpecular * ( 0.6 + 0.4 * glassFres ) + vec3( g * 0.55 ), glassA );
      `,
      );
  };
  m.customProgramCacheKey = () => 'car-glass-v3';
  return m;
}

/** Unlit glow for lamp lenses; vertex colors may exceed 1 to drive bloom. */
export function createGlowMaterial(): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  m.name = 'car-glow';
  return m;
}
