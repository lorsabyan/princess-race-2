import * as THREE from 'three';
import { PAL } from '../kit/palette';
import { sphere, torus } from '../kit/geo';
import { ItemBuilder, itemMaterial, rng, type Surf } from './surface';
import { shadowed, type ObstacleRig } from './rig';

/**
 * 'puddle': a shiny blue rain puddle with an organic outline, a soft wet rim on
 * the road, a bright meniscus and cartoon shine strokes. The water reflects the
 * sky and ripples gently (shader normals, driven by the shared world time).
 * Driving through it makes a cartoon splash: a water crown, droplets and an
 * expanding ripple ring. 1 draw call idle, 4 while splashing.
 */

const COL = {
  deep: '#2f8ff0',
  mid: '#4aabfa',
  shallow: '#86cfff',
  meniscus: '#e6f7ff',
  wet: '#e4c1ce',
  road: PAL.road,
  shine: '#ffffff',
  splash: '#effaff',
  splashDeep: '#a6dcff',
};

const S_WATER: Surf = { r: 0.04, c: 1, g: 0.22 };
const S_EDGE: Surf = { r: 0.12, c: 0.4, g: 0.1 };
const S_WET: Surf = { r: 0.45 };
const S_ROAD: Surf = { r: 0.8 };
const S_SHINE: Surf = { r: 0.2, g: 0.75 };
const S_SPLASH: Surf = { r: 0.1, g: 0.5 };

const WATER_Y = 0.03;
const SHAPES = 3;
const RX = 1.12;
const RZ = 0.9;

function waterMaterial(): THREE.MeshStandardMaterial {
  return itemMaterial('puddle-water', {
    physical: true,
    water: true,
    // Tamed grazing reflections keep the water saturated blue from the low chase camera.
    params: { ior: 1.333, specularIntensity: 0.55 },
  });
}

/** Organic outline radius (unit) for a shape variant. */
function outline(variant: number): (a: number) => number {
  const r = rng(variant * 31 + 7);
  const p = [r() * 6, r() * 6, r() * 6, r() * 6];
  return (a) => 1 + 0.09 * Math.sin(2 * a + p[0]) + 0.06 * Math.sin(3 * a + p[1]) + 0.035 * Math.sin(5 * a + p[2]) + 0.02 * Math.sin(7 * a + p[3]);
}

const waterCache = new Map<number, THREE.BufferGeometry>();

function waterGeometry(variant: number): THREE.BufferGeometry {
  const hit = waterCache.get(variant);
  if (hit) return hit;
  const R = outline(variant);
  const N = 40;
  // Rings: [radius fraction, height, color, finish]. The meniscus/wet rings are doubled for crisp bands.
  const rings: Array<{ f: number; y: number; c: string; s: Surf }> = [
    { f: 0.0, y: WATER_Y, c: COL.deep, s: S_WATER },
    { f: 0.35, y: WATER_Y, c: COL.deep, s: S_WATER },
    { f: 0.7, y: WATER_Y, c: COL.mid, s: S_WATER },
    { f: 0.9, y: WATER_Y, c: COL.shallow, s: S_WATER },
    { f: 0.975, y: WATER_Y, c: COL.shallow, s: S_WATER },
    { f: 0.985, y: WATER_Y + 0.002, c: COL.meniscus, s: S_EDGE },
    { f: 1.0, y: WATER_Y - 0.002, c: COL.meniscus, s: S_EDGE },
    { f: 1.005, y: WATER_Y - 0.006, c: COL.wet, s: S_WET },
    { f: 1.05, y: 0.018, c: COL.wet, s: S_WET },
    { f: 1.12, y: 0.012, c: COL.road, s: S_ROAD },
  ];
  const pos: number[] = [];
  const col: number[] = [];
  const surf: number[] = [];
  const c = new THREE.Color();
  for (const ring of rings) {
    const count = ring.f === 0 ? 1 : N;
    for (let i = 0; i < count; i += 1) {
      const a = (i / N) * Math.PI * 2;
      const rr = R(a) * ring.f;
      pos.push(Math.cos(a) * rr * RX, ring.y, -Math.sin(a) * rr * RZ);
      c.set(ring.c);
      col.push(c.r, c.g, c.b);
      surf.push(ring.s.r, ring.s.m ?? 0, ring.s.g ?? 0, ring.s.c ?? 0);
    }
  }
  const idx: number[] = [];
  // Center fan.
  for (let i = 0; i < N; i += 1) idx.push(0, 1 + i, 1 + ((i + 1) % N));
  for (let k = 1; k < rings.length - 1; k += 1) {
    const a0 = 1 + (k - 1) * N;
    const b0 = 1 + k * N;
    for (let i = 0; i < N; i += 1) {
      const j = (i + 1) % N;
      idx.push(a0 + i, b0 + i, b0 + j, a0 + i, b0 + j, a0 + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('wind', new THREE.BufferAttribute(new Float32Array(pos.length / 3), 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.setAttribute('surf', new THREE.Float32BufferAttribute(surf, 4));

  // Cartoon shine strokes on the far-left of the water (painted highlights).
  const b = new ItemBuilder();
  const stroke = (cx: number, cz: number, len: number, w: number, bend: number) => {
    const shape = new THREE.Shape();
    const steps = 8;
    const top: THREE.Vector2[] = [];
    const bot: THREE.Vector2[] = [];
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = (t - 0.5) * len;
      const y = Math.sin(t * Math.PI) * bend;
      const hw = w * Math.sin(t * Math.PI) ** 0.6;
      top.push(new THREE.Vector2(x, y + hw));
      bot.push(new THREE.Vector2(x, y - hw));
    }
    shape.setFromPoints([...top, ...bot.reverse()]);
    const sg = new THREE.ShapeGeometry(shape);
    b.add(sg, COL.shine, S_SHINE, { p: [cx, WATER_Y + 0.003, cz], r: [-Math.PI / 2, 0, 0.35] });
    sg.dispose();
  };
  stroke(-0.4 * RX, -0.28 * RZ, 0.62, 0.045, 0.08);
  stroke(-0.02 * RX, -0.48 * RZ, 0.2, 0.032, 0.02);
  const dot = new THREE.CircleGeometry(0.05, 10);
  b.add(dot, COL.shine, S_SHINE, { p: [0.3 * RX, WATER_Y + 0.003, 0.34 * RZ], r: [-Math.PI / 2, 0, 0] });
  dot.dispose();
  b.addColored(g, 'keep');
  const merged = b.build();
  g.dispose();
  merged.name = `puddle-water-${variant}`;
  waterCache.set(variant, merged);
  return merged;
}

let crownGeo: THREE.BufferGeometry | null = null;
let dropGeo: THREE.BufferGeometry | null = null;
let ringGeo: THREE.BufferGeometry | null = null;

/** Cartoon splash crown: a flared water wall with pointy tips, two-sided. Unit height. */
function crownGeometry(): THREE.BufferGeometry {
  if (crownGeo) return crownGeo;
  const N = 40;
  const lobes = 9;
  const rows = 4;
  const pos: number[] = [];
  const col: number[] = [];
  const c0 = new THREE.Color(COL.splashDeep);
  const c1 = new THREE.Color(COL.splash);
  const c = new THREE.Color();
  for (const side of [1, -1]) {
    for (let j = 0; j <= rows; j += 1) {
      const v = j / rows;
      for (let i = 0; i <= N; i += 1) {
        const a = (i / N) * Math.PI * 2;
        const tip = Math.pow(0.5 + 0.5 * Math.cos(lobes * a), 2.2);
        const h = (0.55 + 0.45 * tip) * v;
        const r = 0.3 + 0.18 * v * v + (side < 0 ? -0.012 : 0);
        pos.push(Math.cos(a) * r, h, Math.sin(a) * r);
        c.copy(c0).lerp(c1, v);
        col.push(c.r, c.g, c.b);
      }
    }
  }
  const idx: number[] = [];
  const layer = (rows + 1) * (N + 1);
  for (let s = 0; s < 2; s += 1) {
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < N; i += 1) {
        const a = s * layer + j * (N + 1) + i;
        const b = a + 1;
        const cc = a + N + 2;
        const d = a + N + 1;
        if (s === 0) idx.push(a, cc, b, a, d, cc);
        else idx.push(a, b, cc, a, cc, d);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const b = new ItemBuilder();
  b.addColored(g, S_SPLASH);
  g.dispose();
  crownGeo = b.build();
  crownGeo.name = 'puddle-splash-crown';
  return crownGeo;
}

function dropGeometry(): THREE.BufferGeometry {
  if (dropGeo) return dropGeo;
  const b = new ItemBuilder();
  const s = sphere(0.05, 8, 6);
  b.add(s, COL.splash, S_SPLASH, { s: [1, 1.25, 1] });
  s.dispose();
  dropGeo = b.build();
  dropGeo.name = 'puddle-drop';
  return dropGeo;
}

function ringGeometry(): THREE.BufferGeometry {
  if (ringGeo) return ringGeo;
  const b = new ItemBuilder();
  const t = torus(1, 0.03, 4, 48);
  b.add(t, COL.meniscus, S_SPLASH, { r: [Math.PI / 2, 0, 0], s: [1, 1, 0.5] });
  t.dispose();
  ringGeo = b.build();
  ringGeo.name = 'puddle-ripple';
  return ringGeo;
}

const DROPS = 14;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

interface Drop {
  p: THREE.Vector3;
  v: THREE.Vector3;
  alive: boolean;
}

class PuddleRig implements ObstacleRig {
  readonly root = new THREE.Group();
  readonly kind = 'puddle' as const;
  readonly halfWidth = 1.2;
  readonly halfDepth = 1.0;
  private readonly water: THREE.Mesh;
  private readonly crown: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly drops: THREE.InstancedMesh;
  private readonly dropState: Drop[] = [];
  private readonly random: () => number;
  private readonly origin = new THREE.Vector3();
  private t = -1;

  constructor(seed: number) {
    this.random = rng(seed * 3571 + 5);
    this.root.name = 'obstacle-puddle';
    const variant = ((seed % SHAPES) + SHAPES) % SHAPES;
    const mat = waterMaterial();
    this.water = shadowed(new THREE.Mesh(waterGeometry(variant), mat), false, true);
    this.water.name = 'puddle-water';
    this.water.rotation.y = (this.random() - 0.5) * 0.5;
    this.root.add(this.water);

    this.crown = new THREE.Mesh(crownGeometry(), mat);
    this.crown.name = 'puddle-splash-crown';
    this.crown.castShadow = true;
    this.ring = new THREE.Mesh(ringGeometry(), mat);
    this.ring.name = 'puddle-ripple';
    this.drops = new THREE.InstancedMesh(dropGeometry(), mat, DROPS);
    this.drops.name = 'puddle-drops';
    this.drops.frustumCulled = false;
    this.drops.castShadow = true;
    for (let i = 0; i < DROPS; i += 1) this.dropState.push({ p: new THREE.Vector3(), v: new THREE.Vector3(), alive: false });
    this.root.add(this.crown, this.ring, this.drops);
    this.reset();
  }

  update(dt: number): void {
    if (this.t < 0 || dt <= 0) return;
    const step = Math.min(dt, 1 / 30);
    this.t += step;
    const t = this.t;

    // Crown: shoots up fast, then collapses back into the water while flaring out.
    if (t < 0.62) {
      const up = Math.min(1, t / 0.1);
      const rise = 1 - (1 - up) * (1 - up);
      const fall = t < 0.16 ? 1 : Math.max(0, 1 - (t - 0.16) / 0.46);
      const h = 0.62 * rise * fall * fall;
      const spread = 0.85 + 0.4 * rise + 0.5 * (1 - fall);
      this.crown.visible = h > 0.004;
      this.crown.scale.set(spread, Math.max(h, 1e-3), spread);
    } else this.crown.visible = false;

    // Ripple ring expands and flattens into the water.
    if (t < 1.2) {
      const u = t / 1.2;
      const r = 0.35 + 0.95 * (1 - (1 - u) * (1 - u));
      this.ring.visible = true;
      this.ring.scale.set(r, Math.max(1e-3, 1 - u), r);
    } else this.ring.visible = false;

    // Droplets: ballistic, vanish into the water.
    let alive = 0;
    for (let i = 0; i < DROPS; i += 1) {
      const d = this.dropState[i];
      let s = 0;
      if (d.alive) {
        d.v.y -= 9.8 * step;
        d.p.addScaledVector(d.v, step);
        if (d.p.y < WATER_Y && d.v.y < 0) d.alive = false;
        else {
          alive += 1;
          s = 1;
        }
      }
      _q.identity();
      _s.setScalar(Math.max(s, 1e-4));
      this.drops.setMatrixAt(i, _m.compose(_p.copy(d.p), _q, _s));
    }
    this.drops.instanceMatrix.needsUpdate = true;
    this.drops.visible = alive > 0;

    if (!this.crown.visible && !this.ring.visible && alive === 0) this.t = -1;
  }

  react(side: -1 | 1): void {
    // Splash where the car ploughs in: slightly toward the car and the hit side.
    this.origin.set(-side * 0.25, WATER_Y, 0.25);
    this.crown.position.copy(this.origin);
    this.ring.position.set(this.origin.x, WATER_Y + 0.004, this.origin.z);
    this.t = 0;
    for (let i = 0; i < DROPS; i += 1) {
      const d = this.dropState[i];
      const a = (i / DROPS) * Math.PI * 2 + this.random() * 0.4;
      const out = 0.9 + this.random() * 1.1;
      d.p.set(this.origin.x + Math.cos(a) * 0.4, WATER_Y + 0.3 + this.random() * 0.2, this.origin.z + Math.sin(a) * 0.4);
      d.v.set(Math.cos(a) * out + side * 0.4, 2.2 + this.random() * 1.8, Math.sin(a) * out);
      d.alive = true;
    }
    this.crown.visible = true;
    this.ring.visible = true;
    this.drops.visible = true;
  }

  reset(): void {
    this.t = -1;
    this.crown.visible = false;
    this.ring.visible = false;
    this.drops.visible = false;
    for (const d of this.dropState) d.alive = false;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.drops.dispose();
    this.root.clear();
  }
}

export function createPuddle(seed = 0): ObstacleRig {
  return new PuddleRig(seed);
}

export function disposePuddleCaches(): void {
  for (const g of waterCache.values()) g.dispose();
  waterCache.clear();
  crownGeo?.dispose();
  dropGeo?.dispose();
  ringGeo?.dispose();
  crownGeo = null;
  dropGeo = null;
  ringGeo = null;
}
