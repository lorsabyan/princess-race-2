import * as THREE from 'three';
import { PAL } from '../kit/palette';
import { SUN_DIR } from '../../view/Lighting';
import { LOOK_NOW } from '../../view/look';

/** One studio per look, built the first time that look is needed. */
const studios = new Map<string, THREE.DataTexture>();
let users = 0;

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Rough little hills: the line where the land meets the sky, 0..1 around the horizon. */
function ridge(phi: number): number {
  return 0.5 + 0.28 * Math.sin(phi * 3 + 0.7) + 0.14 * Math.sin(phi * 7 + 2.1) + 0.08 * Math.sin(phi * 17 + 0.4);
}

/**
 * Reflection environment for the hero car: a little studio made of the world's sky.
 * Car paint looks like paint because of what it mirrors, so this one is built for that:
 * a bright horizon above a dark line of hills draws the crisp line that runs along every
 * flank, and a long white cloud overhead lays a clean highlight down the hood and deck.
 * The ground stays warm road tones, never grass, so the pink never turns muddy.
 * Built on the CPU (no renderer needed); three.js converts it to PMREM on first use.
 */
export function acquireCarEnvironment(): THREE.Texture {
  users += 1;
  return carEnvironmentNow();
}

/** The studio for the current look (no new reference: the car already holds one). */
export function carEnvironmentNow(): THREE.Texture {
  const built = studios.get(LOOK_NOW.name);
  if (built) return built;
  const W = 512;
  const H = 256;
  const data = new Float32Array(W * H * 4);
  const top = new THREE.Color(LOOK_NOW.sky.top);
  const mid = new THREE.Color(LOOK_NOW.sky.mid);
  const horizon = new THREE.Color(LOOK_NOW.sky.horizon).lerp(new THREE.Color('#ffffff'), 0.35).multiplyScalar(1.5);
  const sunGlow = new THREE.Color(LOOK_NOW.sky.glow);
  const road = new THREE.Color(PAL.road).multiplyScalar(0.62);
  const nadir = new THREE.Color(PAL.carPaintDeep).lerp(new THREE.Color(PAL.road), 0.4).multiplyScalar(0.42);
  const hills = new THREE.Color('#3f6f78').multiplyScalar(0.55);
  const cloud = new THREE.Color('#ffffff');
  const sun = SUN_DIR.clone().normalize();
  const c = new THREE.Color();
  const tmp = new THREE.Color();
  // A few soft clouds around the horizon band (direction, angular radius).
  const clouds: Array<[THREE.Vector3, number]> = [];
  for (let i = 0; i < 9; i += 1) {
    const a = (i / 9) * Math.PI * 2 + 0.4;
    const el = 0.2 + ((i * 37) % 10) / 45;
    clouds.push([new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)), 0.14 + (i % 3) * 0.05]);
  }
  const dir = new THREE.Vector3();
  for (let j = 0; j < H; j += 1) {
    const theta = ((j + 0.5) / H - 0.5) * Math.PI;
    const h = Math.sin(theta);
    for (let i = 0; i < W; i += 1) {
      const phi = ((i + 0.5) / W - 0.5) * Math.PI * 2;
      dir.set(Math.cos(theta) * Math.cos(phi), h, Math.cos(theta) * Math.sin(phi));
      const line = 0.012 + ridge(phi) * 0.06;
      if (h >= line) {
        c.copy(horizon).lerp(mid, smooth(line, 0.3, h));
        c.lerp(top, smooth(0.24, 0.82, h));
        for (const [cd, r] of clouds) {
          const d = Math.acos(Math.min(1, dir.dot(cd)));
          const k = smooth(r, r * 0.35, d) * 0.85;
          if (k > 0) c.lerp(cloud, k);
        }
        // The long cloud overhead, laid along the car's length.
        const u = Math.abs(dir.x / h);
        const v = Math.abs(dir.z / h);
        const strip = smooth(0.42, 0.3, u) * smooth(1.9, 1.5, v) * smooth(0.25, 0.4, h);
        c.lerp(tmp.copy(cloud).multiplyScalar(4.2), strip);
        const s = Math.max(0, dir.dot(sun));
        c.add(tmp.copy(sunGlow).multiplyScalar(Math.pow(s, 900) * 7 + Math.pow(s, 40) * 0.35 + Math.pow(s, 5) * 0.1));
      } else if (h >= -0.05) {
        c.copy(hills);
      } else {
        c.copy(hills).lerp(road, smooth(-0.05, -0.12, h));
        c.lerp(nadir, smooth(-0.3, -0.9, h));
      }
      const o = (j * W + i) * 4;
      data[o] = c.r;
      data[o + 1] = c.g;
      data[o + 2] = c.b;
      data[o + 3] = 1;
    }
  }
  const studio = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
  studio.mapping = THREE.EquirectangularReflectionMapping;
  studio.colorSpace = THREE.LinearSRGBColorSpace;
  studio.magFilter = THREE.LinearFilter;
  studio.minFilter = THREE.LinearFilter;
  studio.generateMipmaps = false;
  studio.needsUpdate = true;
  studios.set(LOOK_NOW.name, studio);
  return studio;
}

export function releaseCarEnvironment(): void {
  users = Math.max(0, users - 1);
  if (users > 0) return;
  for (const studio of studios.values()) studio.dispose();
  studios.clear();
}
