import * as THREE from 'three';

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
  paint: [0.34, 0, 1, 1],
  /** Cockpit tub / padded interior: soft satin, no pearl. */
  interior: [0.6, 0, 0.18, 0],
  /** Dark recesses (wheel wells, grille). */
  recess: [0.7, 0, 0, 0],
  chrome: [0.07, 1, 0, 0],
  /** w = reflection desaturation for metals: toy gold stays warm under a blue sky. */
  gold: [0.24, 1, 0, 0.75],
  tire: [0.82, 0, 0, 0],
  whitewall: [0.5, 0, 0.25, 0],
  leather: [0.46, 0, 0.3, 0],
  enamel: [0.3, 0, 0.8, 0],
  cloth: [0.75, 0, 0, 0],
} as const satisfies Record<string, Pbr>;

const PBR_VERTEX_PARS = /* glsl */ `
#include <color_pars_vertex>
attribute vec4 pbr;
varying vec4 vPbr;
`;

const PBR_FRAGMENT_PARS = /* glsl */ `
#include <color_pars_fragment>
varying vec4 vPbr;
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
    shader.vertexShader = shader.vertexShader
      .replace('#include <color_pars_vertex>', PBR_VERTEX_PARS)
      .replace('#include <color_vertex>', '#include <color_vertex>\nvPbr = pbr;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_pars_fragment>', PBR_FRAGMENT_PARS)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vPbr.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vPbr.y;')
      .replace('#include <lights_physical_fragment>', PBR_LIGHTS)
      .replace('#include <lights_fragment_maps>', PBR_ENV);
  };
  m.customProgramCacheKey = () => 'car-pbr-v2';
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
