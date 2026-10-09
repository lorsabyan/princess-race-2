import * as THREE from 'three';
import { PAL } from '../kit/palette';
import { SUN_DIR } from '../../view/Lighting';

let envTexture: THREE.DataTexture | null = null;
let users = 0;

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Reflection environment for the hero car. Same sky colors and sun as the
 * world sky, but the ground below the horizon is the warm road/town tone
 * instead of flat grass green, so the pearl paint never picks up muddy olive
 * reflections on its lower flanks. Built on the CPU (no renderer needed);
 * three.js converts it to PMREM on first use.
 */
export function acquireCarEnvironment(): THREE.Texture {
  users += 1;
  if (envTexture) return envTexture;
  const W = 512;
  const H = 256;
  const data = new Float32Array(W * H * 4);
  const top = new THREE.Color(PAL.skyTop);
  const mid = new THREE.Color(PAL.skyMid);
  const horizon = new THREE.Color(PAL.skyHorizon);
  const sunGlow = new THREE.Color(PAL.sunGlow);
  const road = new THREE.Color(PAL.road).multiplyScalar(0.72);
  const verge = new THREE.Color('#e9cfc9').multiplyScalar(0.7);
  const town = new THREE.Color('#f6d9d2').multiplyScalar(0.8);
  const cloud = new THREE.Color('#ffffff');
  const sun = SUN_DIR.clone().normalize();
  const c = new THREE.Color();
  const tmp = new THREE.Color();
  // A few soft clouds around the horizon band (direction, angular radius).
  const clouds: Array<[THREE.Vector3, number]> = [];
  for (let i = 0; i < 9; i += 1) {
    const a = (i / 9) * Math.PI * 2 + 0.4;
    const el = 0.12 + ((i * 37) % 10) / 55;
    clouds.push([new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)), 0.16 + (i % 3) * 0.05]);
  }
  const dir = new THREE.Vector3();
  for (let j = 0; j < H; j += 1) {
    const theta = ((j + 0.5) / H - 0.5) * Math.PI;
    const h = Math.sin(theta);
    for (let i = 0; i < W; i += 1) {
      const phi = ((i + 0.5) / W - 0.5) * Math.PI * 2;
      dir.set(Math.cos(theta) * Math.cos(phi), h, Math.cos(theta) * Math.sin(phi));
      if (h >= 0) {
        c.copy(horizon).lerp(mid, smooth(-0.02, 0.2, h));
        c.lerp(top, smooth(0.16, 0.72, h));
        for (const [cd, r] of clouds) {
          const d = Math.acos(Math.min(1, dir.dot(cd)));
          const k = smooth(r, r * 0.35, d) * 0.85;
          if (k > 0) c.lerp(cloud, k);
        }
        const s = Math.max(0, dir.dot(sun));
        c.add(tmp.copy(sunGlow).multiplyScalar(Math.pow(s, 900) * 7 + Math.pow(s, 40) * 0.35 + Math.pow(s, 5) * 0.1));
      } else {
        // Horizon: pale town band, then verges, then the pink road underneath.
        c.copy(town).lerp(verge, smooth(-0.02, -0.12, h));
        c.lerp(road, smooth(-0.12, -0.45, h));
      }
      const o = (j * W + i) * 4;
      data[o] = c.r;
      data[o + 1] = c.g;
      data[o + 2] = c.b;
      data[o + 3] = 1;
    }
  }
  envTexture = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
  envTexture.mapping = THREE.EquirectangularReflectionMapping;
  envTexture.colorSpace = THREE.LinearSRGBColorSpace;
  envTexture.magFilter = THREE.LinearFilter;
  envTexture.minFilter = THREE.LinearFilter;
  envTexture.generateMipmaps = false;
  envTexture.needsUpdate = true;
  return envTexture;
}

export function releaseCarEnvironment(): void {
  users = Math.max(0, users - 1);
  if (users === 0 && envTexture) {
    envTexture.dispose();
    envTexture = null;
  }
}
