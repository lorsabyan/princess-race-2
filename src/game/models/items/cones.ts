import * as THREE from 'three';
import { PAL } from '../kit/palette';
import { lathe, rbox, torus } from '../kit/geo';
import { ItemBuilder, rng } from './surface';
import { obstacleMaterial, shadowed, type ObstacleRig } from './rig';

/**
 * 'cones': 2–3 soft-orange traffic cones with white reflective bands on little
 * square bases, sometimes with a striped bar between two of them. They rock like
 * weebles when bumped: tip away from the car, hop, wobble and settle upright.
 */

const BASE = 0.54;
const BASE_H = 0.075;
const BAR_Y = 0.655;

const COL = {
  body: PAL.cone,
  stripe: PAL.coneStripe,
  base: '#ff925c',
  barA: '#ff8a4f',
  barB: PAL.coneStripe,
};

const STRIPES: Array<[number, number]> = [
  [0.27, 0.37],
  [0.46, 0.53],
];

/** Plump, slightly convex toy-cone silhouette. */
function bodyRadius(y: number): number {
  const t = (y - 0.1) / 0.56;
  return THREE.MathUtils.lerp(0.215, 0.074, t) + 0.016 * Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
}

/** Soft toy plastic: a touch of glow keeps the orange pastel in shadow. */
const BODY_SURF = { r: 0.34, c: 0.7, g: 0.07 };
const STRIPE_SURF = { r: 0.3, c: 0.35, g: 0.14 };

let coneGeo: THREE.BufferGeometry | null = null;
let barGeo: THREE.BufferGeometry | null = null;

function coneGeometry(): THREE.BufferGeometry {
  if (coneGeo) return coneGeo;
  const b = new ItemBuilder();
  // Square base with soft corners, a slightly raised collar where the cone sits.
  b.add(rbox(BASE, BASE_H, BASE, 0.036, 2), COL.base, BODY_SURF, { p: [0, BASE_H / 2, 0] });
  b.add(rbox(0.44, 0.03, 0.44, 0.014, 1), COL.base, BODY_SURF, { p: [0, BASE_H + 0.01, 0] });

  // Body profile (radius, y) with crisp raised tape bands.
  const prof: Array<[number, number]> = [
    [0.226, BASE_H + 0.012],
    [0.232, BASE_H + 0.03],
    [0.214, BASE_H + 0.046],
    [bodyRadius(0.13), 0.13],
  ];
  const tape = 0.006;
  const e = 0.003;
  const body = (y: number) => prof.push([bodyRadius(y), y]);
  let y = 0.13;
  for (const [a, c] of STRIPES) {
    for (let yy = y + 0.07; yy < a - 0.04; yy += 0.07) body(yy);
    prof.push([bodyRadius(a - e), a - e]);
    prof.push([bodyRadius(a) + tape, a]);
    prof.push([bodyRadius((a + c) / 2) + tape, (a + c) / 2]);
    prof.push([bodyRadius(c) + tape, c]);
    prof.push([bodyRadius(c + e), c + e]);
    y = c + e;
  }
  body(0.6);
  body(0.645);
  // Soft rounded tip.
  prof.push([0.072, 0.675], [0.066, 0.7], [0.055, 0.722], [0.04, 0.739], [0.021, 0.75], [0, 0.754]);
  const isStripe = (py: number) => STRIPES.some(([a, c]) => py > a - 1e-4 && py < c + 1e-4);
  const g = lathe(prof, 24);
  b.add(g, (_x, py) => (isStripe(py) ? COL.stripe : COL.body), (_x, py) => (isStripe(py) ? STRIPE_SURF : BODY_SURF));
  g.dispose();

  coneGeo = b.build();
  coneGeo.name = 'cone';
  return coneGeo;
}

/** Candy-striped cone bar with ring ends that slip over the cone tips; length = cone spacing. */
function barGeometry(span: number): THREE.BufferGeometry {
  if (barGeo) return barGeo;
  const b = new ItemBuilder();
  const blocks = 7;
  const inner = span - 0.2;
  const w = inner / blocks;
  for (let i = 0; i < blocks; i += 1) {
    const x = -inner / 2 + w * (i + 0.5);
    b.add(rbox(w + 0.004, 0.11, 0.05, 0.02, 1), i % 2 === 0 ? COL.barA : COL.barB, BODY_SURF, { p: [x, 0, 0] });
  }
  const ring = torus(0.096, 0.022, 6, 18);
  for (const s of [-1, 1]) {
    b.add(ring, COL.barA, BODY_SURF, { p: [(s * span) / 2, 0, 0], r: [Math.PI / 2, 0, 0] });
    b.add(rbox(0.1, 0.06, 0.04, 0.016, 1), COL.barA, BODY_SURF, { p: [s * (span / 2 - 0.1), 0, 0] });
  }
  ring.dispose();
  barGeo = b.build();
  barGeo.name = 'cone-bar';
  return barGeo;
}

interface ConeState {
  mesh: THREE.Mesh;
  home: THREE.Vector3;
  yaw: number;
  tilt: THREE.Vector2;
  tiltV: THREE.Vector2;
  y: number;
  vy: number;
  slide: THREE.Vector2;
  slideV: THREE.Vector2;
  delay: number;
  pending: THREE.Vector3 | null;
}

const K = 70;
const C = 5.2;
const G = 14;
const PIVOT = BASE * 0.46;
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpAxis = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);

class ConesRig implements ObstacleRig {
  readonly root = new THREE.Group();
  readonly kind = 'cones' as const;
  readonly halfWidth = 1.0;
  readonly halfDepth = 0.5;
  private readonly cones: ConeState[] = [];
  private readonly bar: THREE.Mesh | null = null;
  private readonly barPair: [number, number] = [0, 1];
  private readonly random: () => number;
  private active = false;

  constructor(seed: number) {
    this.random = rng(seed * 7919 + 17);
    this.root.name = 'obstacle-cones';
    const variant = ((seed % 3) + 3) % 3;
    const layout: Array<[number, number]> =
      variant === 1
        ? [
            [-0.62, 0.02],
            [0.62, -0.02],
          ]
        : variant === 2
          ? [
              [-0.72, 0.13],
              [0, -0.12],
              [0.72, 0.1],
            ]
          : [
              [-0.72, 0.02],
              [0, -0.03],
              [0.72, 0.03],
            ];
    const geo = coneGeometry();
    const mat = obstacleMaterial();
    layout.forEach(([x, z], i) => {
      const mesh = shadowed(new THREE.Mesh(geo, mat));
      mesh.name = `cone-${i}`;
      const yaw = (this.random() - 0.5) * 0.9;
      this.cones.push({
        mesh,
        home: new THREE.Vector3(x, 0, z),
        yaw,
        tilt: new THREE.Vector2(),
        tiltV: new THREE.Vector2(),
        y: 0,
        vy: 0,
        slide: new THREE.Vector2(),
        slideV: new THREE.Vector2(),
        delay: 0,
        pending: null,
      });
      this.root.add(mesh);
    });
    if (variant === 1) {
      const span = layout[1][0] - layout[0][0];
      this.bar = shadowed(new THREE.Mesh(barGeometry(span), mat));
      this.bar.name = 'cone-bar';
      this.root.add(this.bar);
    }
    this.reset();
  }

  update(dt: number): void {
    if (!this.active || dt <= 0) return;
    let moving = false;
    const step = Math.min(dt, 1 / 30);
    for (const c of this.cones) {
      if (c.pending) {
        c.delay -= step;
        if (c.delay <= 0) {
          c.tiltV.x += c.pending.x;
          c.tiltV.y += c.pending.z;
          c.vy += c.pending.y;
          c.slideV.set(c.pending.x * 0.22, c.pending.z * 0.22);
          c.pending = null;
        }
        moving = true;
      }
      // Weeble spring: gravity pulls the tilt back upright.
      c.tiltV.x += (-K * c.tilt.x - C * c.tiltV.x) * step;
      c.tiltV.y += (-K * c.tilt.y - C * c.tiltV.y) * step;
      c.tilt.x += c.tiltV.x * step;
      c.tilt.y += c.tiltV.y * step;
      const len = c.tilt.length();
      if (len > 1.15) c.tilt.multiplyScalar(1.15 / len);
      // Hop.
      if (c.y > 0 || c.vy > 0) {
        c.vy -= G * step;
        c.y += c.vy * step;
        if (c.y < 0) {
          c.y = 0;
          c.vy = c.vy < -0.8 ? -c.vy * 0.28 : 0;
        }
      }
      c.slide.x += c.slideV.x * step;
      c.slide.y += c.slideV.y * step;
      const f = Math.exp(-5 * step);
      c.slideV.multiplyScalar(f);
      if (len > 0.002 || c.tiltV.lengthSq() > 1e-4 || c.y > 0 || c.slideV.lengthSq() > 1e-5) moving = true;
      this.pose(c);
    }
    this.poseBar();
    if (!moving) this.active = false;
  }

  react(side: -1 | 1): void {
    this.active = true;
    const n = this.cones.length;
    this.cones.forEach((c, i) => {
      // Cones nearer the impact side go first; everything tips away from the car.
      const order = side > 0 ? i : n - 1 - i;
      c.delay = order * 0.06 + this.random() * 0.05;
      const push = 5.5 + this.random() * 2.5;
      const sideways = side * (0.5 + this.random() * 0.5);
      c.pending = new THREE.Vector3(sideways * push * 0.55, 1.6 + this.random() * 1.2, -push);
    });
  }

  reset(): void {
    this.active = false;
    for (const c of this.cones) {
      c.tilt.set(0, 0);
      c.tiltV.set(0, 0);
      c.y = 0;
      c.vy = 0;
      c.slide.set(0, 0);
      c.slideV.set(0, 0);
      c.delay = 0;
      c.pending = null;
      this.pose(c);
    }
    this.poseBar();
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.clear();
  }

  private pose(c: ConeState): void {
    const ang = c.tilt.length();
    tmpQ2.setFromAxisAngle(UP, c.yaw);
    c.mesh.position.set(c.home.x + c.slide.x, c.y, c.home.z + c.slide.y);
    if (ang < 1e-5) {
      c.mesh.quaternion.copy(tmpQ2);
      return;
    }
    const dx = c.tilt.x / ang;
    const dz = c.tilt.y / ang;
    tmpAxis.set(dz, 0, -dx);
    tmpQ.setFromAxisAngle(tmpAxis, ang);
    // Rock on the base edge in the tilt direction.
    tmpV.set(dx * PIVOT, 0, dz * PIVOT);
    tmpV2.copy(tmpV).applyQuaternion(tmpQ);
    c.mesh.position.x += tmpV.x - tmpV2.x;
    c.mesh.position.y += tmpV.y - tmpV2.y;
    c.mesh.position.z += tmpV.z - tmpV2.z;
    c.mesh.quaternion.copy(tmpQ).multiply(tmpQ2);
  }

  private poseBar(): void {
    if (!this.bar) return;
    const a = this.cones[this.barPair[0]].mesh;
    const b = this.cones[this.barPair[1]].mesh;
    a.updateMatrix();
    b.updateMatrix();
    const pa = tmpV.set(0, BAR_Y, 0).applyMatrix4(a.matrix);
    const pb = tmpV2.set(0, BAR_Y, 0).applyMatrix4(b.matrix);
    this.bar.position.copy(pa).add(pb).multiplyScalar(0.5);
    const dir = pb.sub(pa).normalize();
    this.bar.quaternion.setFromUnitVectors(X, dir);
  }
}

export function createCones(seed = 0): ObstacleRig {
  return new ConesRig(seed);
}

export function disposeConeCaches(): void {
  coneGeo?.dispose();
  barGeo?.dispose();
  coneGeo = null;
  barGeo = null;
}
