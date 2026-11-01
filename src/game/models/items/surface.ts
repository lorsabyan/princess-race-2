import * as THREE from 'three';
import { PartBuilder, type ColorFn, type PartOptions } from '../kit/geo';
import { curved } from '../kit/materials';
import { SUN_DIR } from '../../view/Lighting';

/**
 * Item surface kit.
 *
 * Items (coins, gems, obstacles) mix very different finishes inside ONE draw call:
 * polished gold relief on a satin field, a glossy black duck eye on a plush body,
 * a pink crystal inside a gold bezel. Every vertex therefore carries a `surf`
 * attribute (roughness, metalness, glow, coat) that a patched physical material
 * reads per fragment. All item materials are wrapped with the kit's `curved()` so
 * they follow the curved-world shader.
 */

/** Per-vertex surface response. */
export interface Surf {
  /** Roughness (0 = mirror, 1 = chalk). */
  r: number;
  /** Metalness (0..1). */
  m?: number;
  /** Self-illumination as a multiple of the vertex color (0 = none). */
  g?: number;
  /** Coat mask: scales clearcoat / iridescence on physical materials, ripple strength on water. */
  c?: number;
}

export type SurfFn = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => Surf;

/** A few finishes shared across items so everything reads as one toy box. */
export const FINISH = {
  plush: { r: 0.62 } as Surf,
  satin: { r: 0.46 } as Surf,
  paint: { r: 0.36, c: 0.5 } as Surf,
  plastic: { r: 0.3, c: 0.8 } as Surf,
  glossy: { r: 0.12, c: 1 } as Surf,
  wood: { r: 0.7 } as Surf,
  clay: { r: 0.82 } as Surf,
  leaf: { r: 0.55 } as Surf,
  petal: { r: 0.5, g: 0.08 } as Surf,
  gold: { r: 0.2, m: 1 } as Surf,
  goldSatin: { r: 0.36, m: 1 } as Surf,
  eye: { r: 0.06, c: 1 } as Surf,
  sparkle: { r: 0.2, g: 0.9 } as Surf,
} as const;

export interface ItemPartOptions extends PartOptions {
  /** Bone index (only for skinned builders). */
  bone?: number;
}

const KEEP = new Set(['position', 'normal', 'color', 'wind']);

/**
 * PartBuilder wrapper that also writes the per-vertex `surf` channel and (optionally)
 * rigid skinning weights, so a whole animated character stays one draw call.
 */
export class ItemBuilder {
  private readonly pb = new PartBuilder();
  private readonly skinned: boolean;

  constructor(opts: { skinned?: boolean } = {}) {
    this.skinned = opts.skinned ?? false;
  }

  get partCount(): number {
    return this.pb.parts.length;
  }

  /** Add a raw geometry painted with a color (or color function) and a finish. */
  add(
    geo: THREE.BufferGeometry,
    color: THREE.ColorRepresentation | ColorFn,
    surf: Surf | SurfFn,
    opts: ItemPartOptions = {},
  ): this {
    this.pb.add(geo, color, opts);
    this.finish(surf, opts.bone ?? 0);
    return this;
  }

  /**
   * Add an already vertex-colored geometry (e.g. from meshSdf). Surf functions see
   * builder-space coordinates; 'keep' uses the source's own `surf` attribute.
   */
  addColored(geo: THREE.BufferGeometry, surf: Surf | SurfFn | 'keep', opts: ItemPartOptions = {}): this {
    const keep = surf === 'keep' && !!geo.attributes.surf;
    const src = geo.clone();
    for (const name of Object.keys(src.attributes)) if (!KEEP.has(name) && !(keep && name === 'surf')) src.deleteAttribute(name);
    if (!src.attributes.normal) src.computeVertexNormals();
    this.pb.addColored(src, opts);
    src.dispose();
    this.finish(keep ? null : surf === 'keep' ? FINISH.satin : surf, opts.bone ?? 0);
    return this;
  }

  build(): THREE.BufferGeometry {
    const g = this.pb.build();
    if (!g) throw new Error('ItemBuilder: nothing to build');
    for (const part of this.pb.parts) part.dispose();
    return g;
  }

  private finish(surf: Surf | SurfFn | null, bone: number): void {
    const g = this.pb.parts[this.pb.parts.length - 1];
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const n = pos.count;
    if (surf) {
      const arr = new Float32Array(n * 4);
      const isFn = typeof surf === 'function';
      for (let i = 0; i < n; i += 1) {
        const s = isFn
          ? (surf as SurfFn)(pos.getX(i), pos.getY(i), pos.getZ(i), nor.getX(i), nor.getY(i), nor.getZ(i))
          : (surf as Surf);
        arr[i * 4] = s.r;
        arr[i * 4 + 1] = s.m ?? 0;
        arr[i * 4 + 2] = s.g ?? 0;
        arr[i * 4 + 3] = s.c ?? 0;
      }
      g.setAttribute('surf', new THREE.BufferAttribute(arr, 4));
    }
    if (this.skinned) {
      const idx = new Uint16Array(n * 4);
      const w = new Float32Array(n * 4);
      for (let i = 0; i < n; i += 1) {
        idx[i * 4] = bone;
        w[i * 4] = 1;
      }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w, 4));
    }
  }
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

const SURF_VERT_PARS = /* glsl */ `
attribute vec4 surf;
varying vec4 vSurf;
#ifdef ITEM_WATER
varying vec3 vItemWorld;
#endif
`;

const SURF_VERT = /* glsl */ `
vSurf = surf;
#ifdef ITEM_WATER
{
  vec4 iw = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    iw = instanceMatrix * iw;
  #endif
  vItemWorld = ( modelMatrix * iw ).xyz;
}
#endif
`;

const SURF_FRAG_PARS = /* glsl */ `
varying vec4 vSurf;
uniform float uItemGlow;
#ifdef ITEM_WATER
varying vec3 vItemWorld;
#endif
`;

const SURF_COAT = /* glsl */ `
#ifdef USE_CLEARCOAT
  material.clearcoat *= vSurf.w;
#endif
#ifdef USE_IRIDESCENCE
  material.iridescence *= vSurf.w;
#endif
#ifdef USE_SHEEN
  material.sheenColor *= vSurf.w;
#endif
`;

/** Wind-blown ripples for puddles: perturb the view-space normal where vSurf.w > 0. */
const WATER_NORMAL = /* glsl */ `
#ifdef ITEM_WATER
{
  vec2 wp = vItemWorld.xz;
  float wt = uTime;
  vec2 wg = vec2( 0.0 );
  wg += vec2( 0.80, 0.60 ) * cos( dot( wp, vec2( 0.80, 0.60 ) ) * 7.0 - wt * 1.7 );
  wg += vec2( -0.50, 0.87 ) * cos( dot( wp, vec2( -0.50, 0.87 ) ) * 10.5 - wt * 2.3 + 1.3 );
  wg += vec2( 0.96, -0.28 ) * cos( dot( wp, vec2( 0.96, -0.28 ) ) * 15.0 - wt * 3.1 + 4.1 ) * 0.6;
  wg *= 0.05 * vSurf.w;
  normal = normalize( normal + ( viewMatrix * vec4( -wg.x, 0.0, -wg.y, 0.0 ) ).xyz );
}
#endif
`;

export interface ItemMaterialOptions {
  /** Use MeshPhysicalMaterial (clearcoat, iridescence, ior...). */
  physical?: boolean;
  /** Enable the kit's wind sway (uses the geometry `wind` attribute). */
  wind?: boolean;
  /** Animated water normals (puddles). */
  water?: boolean;
  /** Custom environment (defaults to scene.environment). */
  envMap?: THREE.Texture | null;
  envMapIntensity?: number;
  /** Global multiplier for per-vertex glow. */
  glow?: number;
  side?: THREE.Side;
  params?: THREE.MeshPhysicalMaterialParameters;
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();

/**
 * Cached, curved-world item material whose roughness/metalness/glow/coat come
 * from the per-vertex `surf` attribute. `name` is the cache key.
 */
export function itemMaterial(name: string, opts: ItemMaterialOptions = {}): THREE.MeshStandardMaterial {
  const hit = matCache.get(name);
  if (hit) return hit;
  const base: THREE.MeshPhysicalMaterialParameters = {
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    side: opts.side ?? THREE.FrontSide,
    ...opts.params,
  };
  const m = opts.physical ? new THREE.MeshPhysicalMaterial(base) : new THREE.MeshStandardMaterial(base);
  if (opts.envMap) m.envMap = opts.envMap;
  if (opts.envMapIntensity !== undefined) m.envMapIntensity = opts.envMapIntensity;
  if (opts.water) m.defines = { ...(m.defines ?? {}), ITEM_WATER: '' };
  const glow = { value: opts.glow ?? 1 };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uItemGlow = glow;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SURF_VERT_PARS}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${SURF_VERT}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${SURF_FRAG_PARS}`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vSurf.x;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vSurf.y;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${WATER_NORMAL}`)
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * vSurf.z * uItemGlow;',
      )
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>\n${SURF_COAT}`);
  };
  curved(m, { wind: opts.wind });
  // curved() keys programs as 'curved'; our extra patch must not share those programs.
  const key = `curved${opts.wind ? '-wind' : ''}|item-surf${opts.water ? '-water' : ''}`;
  m.customProgramCacheKey = () => key;
  m.name = `item-${name}`;
  m.userData.glow = glow;
  matCache.set(name, m);
  return m;
}

export function disposeItemMaterials(): void {
  for (const m of matCache.values()) m.dispose();
  matCache.clear();
  envTexture?.dispose();
  envTexture = null;
}

// ---------------------------------------------------------------------------
// Jewelry environment
// ---------------------------------------------------------------------------

let envTexture: THREE.DataTexture | null = null;

interface Lobe {
  d: THREE.Vector3;
  c: [number, number, number];
  k: number;
  w: number;
}

function lobe(x: number, y: number, z: number, c: [number, number, number], k: number, w: number): Lobe {
  return { d: new THREE.Vector3(x, y, z).normalize(), c, k, w };
}

/**
 * A small HDR "storybook studio" environment for polished gold and gems.
 *
 * Gold reflecting the real sky + grass reads olive; product shots use a warm studio
 * instead. Tone-wise it matches the world (pale sky above, warm road-colored
 * ground below) but adds a sun softbox, a front fill behind the chase camera
 * (so faces flash as coins turn toward the player) and a few sparkle points just
 * below the horizon that spinning faces sweep through.
 */
export function itemEnvMap(): THREE.DataTexture {
  if (envTexture) return envTexture;
  const W = 256;
  const H = 128;
  const data = new Uint16Array(W * H * 4);
  const lobes: Lobe[] = [
    { d: SUN_DIR.clone().normalize(), c: [1.0, 0.95, 0.84], k: 9, w: 0.02 },
    lobe(0.1, -0.1, 1, [1.0, 0.9, 0.74], 1.15, 0.1),
    lobe(1, 0.3, 0.15, [0.9, 0.95, 1.0], 2.2, 0.035),
    lobe(-0.9, 0.15, -0.5, [1.0, 0.88, 0.76], 1.8, 0.04),
  ];
  for (let i = 0; i < 7; i += 1) {
    const a = (i / 7) * Math.PI * 2 + 0.35;
    lobes.push(lobe(Math.cos(a), -0.12 + (i % 2) * 0.08, Math.sin(a), [1.0, 0.97, 0.9], 5.5, 0.004));
  }
  const skyHigh = [0.5, 0.68, 0.95];
  const skyLow = [1.12, 1.04, 0.94];
  const groundHigh = [1.0, 0.82, 0.64];
  const groundLow = [0.42, 0.28, 0.22];
  const col = [0, 0, 0];
  for (let j = 0; j < H; j += 1) {
    const el = ((j + 0.5) / H - 0.5) * Math.PI;
    const y = Math.sin(el);
    const c = Math.cos(el);
    for (let i = 0; i < W; i += 1) {
      const az = ((i + 0.5) / W - 0.5) * Math.PI * 2;
      const x = Math.cos(az) * c;
      const z = Math.sin(az) * c;
      if (y >= 0) {
        const t = Math.min(1, y / 0.65);
        const s = t * t * (3 - 2 * t);
        for (let k = 0; k < 3; k += 1) col[k] = skyLow[k] + (skyHigh[k] - skyLow[k]) * s;
      } else {
        const t = Math.min(1, -y / 0.55);
        const s = t * t * (3 - 2 * t);
        for (let k = 0; k < 3; k += 1) col[k] = groundHigh[k] + (groundLow[k] - groundHigh[k]) * s;
      }
      // Bright horizon line: the classic studio "cyc" glow that rims spinning edges.
      const hz = Math.exp(-(y * y) / 0.0025) * 0.35;
      col[0] += hz;
      col[1] += hz * 0.96;
      col[2] += hz * 0.9;
      for (const L of lobes) {
        const d = x * L.d.x + y * L.d.y + z * L.d.z;
        const f = Math.exp((d - 1) / L.w) * L.k;
        col[0] += L.c[0] * f;
        col[1] += L.c[1] * f;
        col[2] += L.c[2] * f;
      }
      const o = (j * W + i) * 4;
      data[o] = THREE.DataUtils.toHalfFloat(col[0]);
      data[o + 1] = THREE.DataUtils.toHalfFloat(col[1]);
      data[o + 2] = THREE.DataUtils.toHalfFloat(col[2]);
      data[o + 3] = THREE.DataUtils.toHalfFloat(1);
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  tex.name = 'item-studio-env';
  envTexture = tex;
  return tex;
}

// ---------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------

/** Mulberry32 PRNG (deterministic per seed). */
export function rng(seed: number): () => number {
  let a = (seed | 0) + 0x6d2b79f5;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
