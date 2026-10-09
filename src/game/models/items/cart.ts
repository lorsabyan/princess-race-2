import * as THREE from 'three';
import { PAL } from '../kit/palette';
import { blob, cyl, extrude, heartShape, lathe, rbox, sphere, torus } from '../kit/geo';
import { ItemBuilder, rng, type Surf } from './surface';
import { obstacleMaterial, obstacleWindMaterial, shadowed, type ObstacleRig } from './rig';

/**
 * 'cart': a parked flower cart, broadside to the road so the big spoked wheel
 * faces the approaching car. Mint painted box with a heart decal, pink-and-white
 * scalloped awning with a pennant, three terracotta pots overflowing with
 * flowers that sway in the breeze. On a bump it rocks and bursts into petals.
 * One draw call (+1 instanced petal burst while reacting).
 */

const COL = {
  box: '#74d3bd',
  boxDeep: '#4fb8ad',
  trim: PAL.trimWhite,
  heart: PAL.flowerRose,
  tire: '#fff2e2',
  spoke: '#ff9cb8',
  hub: PAL.gold,
  wood: PAL.wood,
  awningA: PAL.roofCoral,
  awningB: PAL.trimWhite,
  pot: PAL.roofTerracotta,
  potRim: '#f6a27c',
  leaf: PAL.leaf,
  leafDeep: PAL.leafDeep,
  flag: PAL.flowerRose,
};

const FLOWER_COLORS = [PAL.flowerRose, PAL.flowerYellow, PAL.flowerWhite, PAL.flowerLilac, PAL.flowerBlue, PAL.blossom, PAL.flowerOrange];

const S_PAINT: Surf = { r: 0.4, c: 0.6, g: 0.05 };
const S_TRIM: Surf = { r: 0.36, c: 0.6, g: 0.06 };
const S_CLOTH: Surf = { r: 0.66, g: 0.08 };
const S_CLAY: Surf = { r: 0.8, g: 0.04 };
const S_LEAF: Surf = { r: 0.55, g: 0.1 };
const S_PETAL: Surf = { r: 0.5, g: 0.16 };
const S_GOLD: Surf = { r: 0.22, m: 1 };

// Layout (rig space, meters). Long axis along X, wheels on ±Z.
const BED = { x: 0.7, z: 0.41, floor: 0.55, top: 0.87 };
const WHEEL = { x: 0.34, y: 0.41, z: 0.5, r: 0.4 };
const AWNING = { x: 0.84, z: 0.56, eave: 1.7, ridge: 1.93 };

function awningY(z: number): number {
  const t = Math.min(1, Math.abs(z) / AWNING.z);
  return AWNING.eave + (AWNING.ridge - AWNING.eave) * Math.cos(t * Math.PI * 0.5);
}

/** Parametric grid (u, v in [0,1]) -> indexed geometry with smooth normals. */
function gridGeometry(nu: number, nv: number, f: (u: number, v: number) => [number, number, number]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let j = 0; j <= nv; j += 1) for (let i = 0; i <= nu; i += 1) pos.push(...f(i / nu, j / nv));
  const idx: number[] = [];
  for (let j = 0; j < nv; j += 1) {
    for (let i = 0; i < nu; i += 1) {
      const a = j * (nu + 1) + i;
      const b = a + 1;
      const c = a + nu + 2;
      const d = a + nu + 1;
      idx.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Flat petal flower facing +Z: raised yellow center, cupped petals, back face. Vertex colored. */
function flowerHeadGeometry(color: THREE.ColorRepresentation, r: number, petals = 5): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const center = new THREE.Color(PAL.flowerYellow);
  const petal = new THREE.Color(color);
  const deep = petal.clone().multiplyScalar(0.82);
  const push = (x: number, y: number, z: number, c: THREE.Color) => {
    pos.push(x, y, z);
    col.push(c.r, c.g, c.b);
    return pos.length / 3 - 1;
  };
  const inner = 10;
  const outer = 20;
  const ci = push(0, 0, 0.018, center);
  const innerTop: number[] = [];
  const innerPetal: number[] = [];
  for (let i = 0; i < inner; i += 1) {
    const a = (i / inner) * Math.PI * 2;
    innerTop.push(push(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3, 0.012, center));
    innerPetal.push(push(Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3, 0.004, deep));
  }
  const rim: number[] = [];
  for (let i = 0; i < outer; i += 1) {
    const a = (i / outer) * Math.PI * 2;
    const rr = r * (0.52 + 0.48 * Math.pow(Math.abs(Math.cos((petals * a) / 2)), 0.6));
    rim.push(push(Math.cos(a) * rr, Math.sin(a) * rr, 0.022 * (rr / r) ** 2, petal));
  }
  for (let i = 0; i < inner; i += 1) idx.push(ci, innerTop[i], innerTop[(i + 1) % inner]);
  for (let i = 0; i < inner; i += 1) {
    const a = innerPetal[i];
    const b = innerPetal[(i + 1) % inner];
    const o0 = rim[i * 2];
    const o1 = rim[i * 2 + 1];
    const o2 = rim[(i * 2 + 2) % outer];
    idx.push(a, o0, o1, a, o1, b, b, o1, o2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function setWind(g: THREE.BufferGeometry, w: number): THREE.BufferGeometry {
  g.setAttribute('wind', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(w), 1));
  return g;
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _z = new THREE.Vector3(0, 0, 1);

let cartGeo: THREE.BufferGeometry | null = null;
let petalGeo: THREE.BufferGeometry | null = null;

/** Bush centers (used by the petal burst). */
const BUSHES: Array<{ p: [number, number, number]; r: number }> = [
  { p: [-0.42, 1.03, 0.0], r: 0.22 },
  { p: [0.02, 1.08, -0.02], r: 0.24 },
  { p: [0.44, 1.02, 0.02], r: 0.21 },
];

function cartGeometry(): THREE.BufferGeometry {
  if (cartGeo) return cartGeo;
  const b = new ItemBuilder();
  const random = rng(4242);

  // --- Box
  const slab = new THREE.BoxGeometry(BED.x * 2, 0.06, BED.z * 2);
  b.add(slab, COL.boxDeep, S_PAINT, { p: [0, BED.floor, 0] });
  slab.dispose();
  const wallH = BED.top - BED.floor;
  for (const s of [-1, 1]) {
    b.add(rbox(BED.x * 2, wallH, 0.05, 0.02, 1), COL.box, S_PAINT, { p: [0, BED.floor + wallH / 2, s * BED.z] });
    b.add(rbox(0.05, wallH, BED.z * 2, 0.02, 1), COL.box, S_PAINT, { p: [s * BED.x, BED.floor + wallH / 2, 0] });
    // Cream top rails + deeper bottom rails.
    b.add(rbox(BED.x * 2 + 0.08, 0.05, 0.08, 0.022, 1), COL.trim, S_TRIM, { p: [0, BED.top, s * BED.z] });
    b.add(rbox(0.08, 0.05, BED.z * 2 + 0.08, 0.022, 1), COL.trim, S_TRIM, { p: [s * BED.x, BED.top, 0] });
    const rail = new THREE.BoxGeometry(BED.x * 2 + 0.06, 0.05, 0.07);
    b.add(rail, COL.boxDeep, S_PAINT, { p: [0, BED.floor - 0.01, s * BED.z] });
    rail.dispose();
  }
  // Painted heart on the road-facing side, with a cream outline.
  const heart = extrude(heartShape(0.24), 0.012, 0.008, 1, 6);
  b.add(heart, COL.heart, { r: 0.3, c: 1, g: 0.1 }, { p: [-0.36, 0.71, BED.z + 0.03] });
  const heartBack = extrude(heartShape(0.3), 0.006, 0, 1, 6);
  b.add(heartBack, COL.trim, S_TRIM, { p: [-0.36, 0.713, BED.z + 0.02] });
  heart.dispose();
  heartBack.dispose();

  // --- Wheels (big, spoked) + axle
  const rim = torus(WHEEL.r - 0.045, 0.045, 5, 26);
  const spoke = cyl(0.017, 0.017, WHEEL.r - 0.08, 5, true);
  const hub = cyl(0.075, 0.075, 0.09, 10);
  const cap = sphere(0.05, 8, 5);
  for (const s of [-1, 1]) {
    const z = s * WHEEL.z;
    b.add(rim, COL.tire, S_TRIM, { p: [WHEEL.x, WHEEL.y, z] });
    for (let k = 0; k < 8; k += 1) {
      const a = (k / 8) * Math.PI * 2 + 0.2;
      const m = (WHEEL.r - 0.08) / 2 + 0.04;
      b.add(spoke, COL.spoke, S_PAINT, { p: [WHEEL.x + Math.sin(a) * m, WHEEL.y + Math.cos(a) * m, z], r: [0, 0, -a] });
    }
    b.add(hub, COL.spoke, S_PAINT, { p: [WHEEL.x, WHEEL.y, z], r: [Math.PI / 2, 0, 0] });
    b.add(cap, COL.hub, S_GOLD, { p: [WHEEL.x, WHEEL.y, z + s * 0.045], s: [1, 1, 0.7] });
  }
  rim.dispose();
  spoke.dispose();
  hub.dispose();
  cap.dispose();
  const axle = cyl(0.03, 0.03, WHEEL.z * 2, 6, true);
  b.add(axle, COL.wood, S_PAINT, { p: [WHEEL.x, WHEEL.y, 0], r: [Math.PI / 2, 0, 0] });
  axle.dispose();

  // --- Stand legs + handles (toward -X)
  for (const s of [-1, 1]) {
    const leg = cyl(0.03, 0.026, BED.floor, 6, true);
    b.add(leg, COL.wood, S_PAINT, { p: [-0.56, BED.floor / 2, s * 0.32] });
    leg.dispose();
  }
  const pole = cyl(0.025, 0.025, 0.42, 7, true);
  const grip = sphere(0.04, 6, 5);
  for (const s of [-1, 1]) {
    b.add(pole, COL.wood, S_PAINT, { p: [-0.9, 0.74, s * 0.3], r: [0, 0, Math.PI / 2 - 0.12] });
    b.add(grip, COL.trim, S_TRIM, { p: [-1.1, 0.765, s * 0.3], s: [1.5, 1, 1] });
  }
  pole.dispose();
  grip.dispose();

  // --- Awning: posts, arched striped canopy, scalloped valance, pennant
  const post = cyl(0.024, 0.024, AWNING.eave - BED.top + 0.02, 6, true);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      b.add(post, COL.trim, S_TRIM, { p: [sx * (BED.x - 0.03), (BED.top + AWNING.eave) / 2, sz * (BED.z - 0.01)] });
    }
  }
  post.dispose();
  const stripes = 8;
  const sw = (AWNING.x * 2) / stripes;
  for (let i = 0; i < stripes; i += 1) {
    const x0 = -AWNING.x + i * sw;
    const color = i % 2 === 0 ? COL.awningA : COL.awningB;
    const top = gridGeometry(1, 8, (u, v) => {
      const z = (v - 0.5) * 2 * AWNING.z;
      return [x0 + u * sw, awningY(z), z];
    });
    b.add(top, color, S_CLOTH);
    top.dispose();
    const under = gridGeometry(1, 8, (u, v) => {
      const z = (0.5 - v) * 2 * AWNING.z;
      return [x0 + u * sw, awningY(z) - 0.025, z];
    });
    b.add(under, color, S_CLOTH);
    under.dispose();
  }
  // Scallops hanging from both long eaves, colored to continue the stripes.
  const scallops = stripes * 2;
  const scw = (AWNING.x * 2) / scallops;
  for (const sz of [1]) {
    for (let i = 0; i < scallops; i += 1) {
      const shape = new THREE.Shape();
      shape.moveTo(-scw / 2, 0);
      shape.lineTo(-scw / 2, -0.05);
      shape.absarc(0, -0.05, scw / 2, Math.PI, 0, false);
      shape.lineTo(scw / 2, 0);
      shape.lineTo(-scw / 2, 0);
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false, curveSegments: 4 });
      const x = -AWNING.x + scw * (i + 0.5);
      const color = Math.floor(i / 2) % 2 === 0 ? COL.awningA : COL.awningB;
      b.add(g, color, S_CLOTH, { p: [x, AWNING.eave + 0.012, sz * (AWNING.z + 0.004) - (sz > 0 ? 0 : 0.012)], wind: 0.006 });
      g.dispose();
    }
  }
  // Cream piping along the gable ends and ridge.
  for (const sx of [-1, 1]) {
    const pts: Array<[number, number, number]> = [];
    for (let k = 0; k <= 10; k += 1) {
      const z = (k / 10 - 0.5) * 2 * AWNING.z;
      pts.push([sx * AWNING.x, awningY(z) - 0.01, z]);
    }
    const pipe = new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))),
      12,
      0.02,
      5,
      false,
    );
    b.add(pipe, COL.trim, S_TRIM);
    pipe.dispose();
  }
  const ball = sphere(0.045, 6, 4);
  for (const sx of [-1, 1]) b.add(ball, COL.hub, S_GOLD, { p: [sx * AWNING.x, AWNING.ridge + 0.01, 0] });
  ball.dispose();
  // Pennant on a little mast.
  const mast = cyl(0.012, 0.012, 0.32, 5, true);
  b.add(mast, COL.trim, S_TRIM, { p: [0, AWNING.ridge + 0.16, 0] });
  mast.dispose();
  const flagShape = new THREE.Shape();
  flagShape.moveTo(0, 0);
  flagShape.lineTo(0.2, -0.05);
  flagShape.lineTo(0, -0.11);
  flagShape.lineTo(0, 0);
  const flag = new THREE.ExtrudeGeometry(flagShape, { depth: 0.008, bevelEnabled: false });
  b.add(flag, COL.flag, S_CLOTH, {
    p: [0.012, AWNING.ridge + 0.31, -0.004],
    wind: (x) => Math.max(0, x - 0.01) * 0.25,
  });
  flag.dispose();

  // --- Pots + bushes + flowers
  const pot = lathe(
    [
      [0, 0],
      [0.12, 0],
      [0.13, 0.02],
      [0.155, 0.22],
      [0.162, 0.24],
      [0.19, 0.245],
      [0.192, 0.3],
      [0.17, 0.305],
      [0.16, 0.28],
    ],
    10,
  );
  for (const bush of BUSHES) {
    b.add(pot, (_x, y) => (y > BED.floor + 0.26 ? COL.potRim : COL.pot), S_CLAY, { p: [bush.p[0], BED.floor + 0.03, bush.p[2]] });
  }
  pot.dispose();
  BUSHES.forEach((bush, i) => {
    const leaves = blob(bush.r * 0.82, 1, 0.16, 3.2, i + 3);
    b.add(leaves, (_x, y) => (y < bush.p[1] - bush.r * 0.25 ? COL.leafDeep : COL.leaf), S_LEAF, {
      p: [bush.p[0], bush.p[1] - 0.04, bush.p[2]],
      s: [1.15, 0.8, 1.0],
      wind: (_x, y) => 0.01 + Math.max(0, y - 0.9) * 0.04,
    });
    leaves.dispose();
  });
  // Trailing flower clumps spilling over the road-facing rim.
  const spill: Array<[number, number, number]> = [
    [-0.16, 0.86, BED.z + 0.02],
    [0.2, 0.87, BED.z + 0.01],
  ];
  spill.forEach((p, i) => {
    const clump = blob(0.09, 1, 0.12, 4, i + 9);
    b.add(clump, COL.leaf, S_LEAF, { p, s: [1.3, 0.8, 0.9], wind: 0.015 });
    clump.dispose();
  });

  // Flower heads packed over the upper, road-facing dome of each pot (golden-angle spiral).
  let ci = 0;
  const place = (center: THREE.Vector3, radius: number, count: number, size: number, maxPhi: number) => {
    for (let k = 0; k < count; k += 1) {
      const t = (k + 0.5) / count;
      const phi = Math.acos(1 - t * (1 - Math.cos(maxPhi)));
      const theta = k * 2.39996 + random() * 0.3;
      const n = new THREE.Vector3(Math.sin(phi) * Math.sin(theta), Math.cos(phi), Math.sin(phi) * Math.cos(theta));
      // Favour the road-facing side.
      if (n.z < -0.35) n.z = -n.z * 0.4;
      n.normalize();
      const p = center.clone().addScaledVector(n, radius);
      _q.setFromUnitVectors(_z, n);
      _e.setFromQuaternion(_q);
      const color = FLOWER_COLORS[(ci * 3 + (ci >> 2)) % FLOWER_COLORS.length];
      const head = setWind(flowerHeadGeometry(color, size * (0.85 + random() * 0.3)), 0.012 + Math.max(0, p.y - 0.9) * 0.05);
      ci += 1;
      b.addColored(head, S_PETAL, { p: [p.x, p.y, p.z], r: [_e.x, _e.y, _e.z] });
      head.dispose();
    }
  };
  BUSHES.forEach((bush) => place(new THREE.Vector3(bush.p[0], bush.p[1] - 0.04, bush.p[2]), bush.r * 0.78, 9, 0.1, 1.25));
  spill.forEach((p) => place(new THREE.Vector3(...p), 0.08, 3, 0.07, 1.4));

  cartGeo = b.build();
  cartGeo.name = 'flower-cart';
  return cartGeo;
}

/** Tiny two-sided petal (flat teardrop fan, 12 tris). White: tinted per instance. */
function petalGeometry(): THREE.BufferGeometry {
  if (petalGeo) return petalGeo;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 2;
    const r = 0.06 * (0.75 + 0.25 * Math.sin(a));
    pts.push([Math.cos(a) * r * 0.8, Math.sin(a) * r]);
  }
  const pos: number[] = [0, 0, 0.002, 0, 0, -0.002];
  for (const [x, y] of pts) pos.push(x, y, 0.001);
  for (const [x, y] of pts) pos.push(x, y, -0.001);
  const idx: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    const j = (i + 1) % 6;
    idx.push(0, 2 + i, 2 + j);
    idx.push(1, 8 + j, 8 + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const b = new ItemBuilder();
  b.add(g, '#ffffff', S_PETAL);
  g.dispose();
  petalGeo = b.build();
  petalGeo.name = 'cart-petal';
  return petalGeo;
}

interface Petal {
  p: THREE.Vector3;
  v: THREE.Vector3;
  axis: THREE.Vector3;
  spin: number;
  angle: number;
  age: number;
  life: number;
  size: number;
  phase: number;
}

const PETALS = 20;
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _q2 = new THREE.Quaternion();

class CartRig implements ObstacleRig {
  readonly root = new THREE.Group();
  readonly kind = 'cart' as const;
  readonly halfWidth = 1.1;
  readonly halfDepth = 0.8;
  private readonly body = new THREE.Group();
  private readonly cart: THREE.Mesh;
  private readonly petals: THREE.InstancedMesh;
  private readonly state: Petal[] = [];
  private readonly random: () => number;
  private rock = 0;
  private rockV = 0;
  private hop = 0;
  private hopV = 0;
  private burst = false;

  constructor(seed: number) {
    this.random = rng(seed * 6007 + 3);
    this.root.name = 'obstacle-cart';
    this.body.name = 'flower-cart-pivot';
    this.cart = shadowed(new THREE.Mesh(cartGeometry(), obstacleWindMaterial()));
    this.cart.name = 'flower-cart';
    // Mirror odd seeds (handles on the other side) for variety; still faces +Z.
    if (seed % 2 === 1) this.body.scale.x = -1;
    this.body.add(this.cart);
    this.root.add(this.body);

    this.petals = new THREE.InstancedMesh(petalGeometry(), obstacleMaterial(), PETALS);
    this.petals.name = 'flower-cart-petals';
    this.petals.castShadow = false;
    this.petals.receiveShadow = false;
    this.petals.frustumCulled = false;
    this.petals.visible = false;
    const c = new THREE.Color();
    for (let i = 0; i < PETALS; i += 1) {
      this.petals.setColorAt(i, c.set(FLOWER_COLORS[i % FLOWER_COLORS.length]));
      this.state.push({
        p: new THREE.Vector3(),
        v: new THREE.Vector3(),
        axis: new THREE.Vector3(1, 0, 0),
        spin: 0,
        angle: 0,
        age: 0,
        life: 1,
        size: 1,
        phase: 0,
      });
    }
    this.root.add(this.petals);
    this.reset();
  }

  update(dt: number, time: number): void {
    if (dt <= 0) return;
    const step = Math.min(dt, 1 / 30);
    // Rock on the wheels: damped spring, plus a small hop.
    if (Math.abs(this.rock) > 1e-4 || Math.abs(this.rockV) > 1e-4 || this.hop > 0 || this.hopV !== 0) {
      this.rockV += (-90 * this.rock - 6 * this.rockV) * step;
      this.rock += this.rockV * step;
      this.hopV -= 9.8 * step;
      this.hop += this.hopV * step;
      if (this.hop <= 0) {
        this.hop = 0;
        this.hopV = this.hopV < -0.6 ? -this.hopV * 0.3 : 0;
      }
      this.body.rotation.z = this.rock;
      this.body.rotation.x = -this.rock * 0.25;
      // Lift by the rock angle so the low side rolls on its wheel instead of sinking.
      this.body.position.y = this.hop + Math.abs(this.rock) * 0.55;
    }
    if (this.burst) this.updatePetals(step, time);
  }

  react(side: -1 | 1): void {
    this.rockV += side * -2.6;
    this.hopV = 1.1;
    this.burst = true;
    this.petals.visible = true;
    const mirror = this.body.scale.x;
    this.state.forEach((s, i) => {
      const bush = BUSHES[i % BUSHES.length];
      // Shaken loose from the front of the bouquets: out from under the awning, not through it.
      s.p.set(bush.p[0] * mirror + (this.random() - 0.5) * 0.3, bush.p[1] + this.random() * 0.1, bush.p[2] + 0.12 + this.random() * 0.1);
      s.v.set((this.random() - 0.5) * 2.8 + side * 0.6, 0.8 + this.random() * 0.9, 0.7 + this.random() * 1.3);
      s.axis.set(this.random() - 0.5, this.random() - 0.5, this.random() - 0.5).normalize();
      s.spin = (this.random() - 0.5) * 22;
      s.angle = this.random() * 6;
      s.age = -this.random() * 0.12;
      s.life = 1.7 + this.random() * 0.9;
      s.size = 0.75 + this.random() * 0.5;
      s.phase = this.random() * 6;
    });
  }

  reset(): void {
    this.rock = 0;
    this.rockV = 0;
    this.hop = 0;
    this.hopV = 0;
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.burst = false;
    this.petals.visible = false;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.petals.dispose();
    this.root.clear();
  }

  private updatePetals(dt: number, time: number): void {
    let alive = 0;
    for (let i = 0; i < PETALS; i += 1) {
      const s = this.state[i];
      s.age += dt;
      let scale = 0;
      if (s.age >= 0 && s.age < s.life) {
        alive += 1;
        if (s.p.y > 0.015) {
          // Floaty fall with air drag and a side-to-side flutter.
          s.v.y -= 4.2 * dt;
          s.v.multiplyScalar(Math.exp(-1.6 * dt));
          s.p.addScaledVector(s.v, dt);
          s.p.x += Math.sin(time * 7 + s.phase) * 0.35 * dt;
          s.angle += s.spin * dt;
        } else {
          s.p.y = 0.015;
          s.v.set(0, 0, 0);
        }
        const fade = Math.min(1, (s.life - s.age) / 0.35);
        scale = s.size * Math.min(1, s.age / 0.08) * fade;
      } else if (s.age < 0) {
        alive += 1;
      }
      _q2.setFromAxisAngle(s.axis, s.angle);
      _s.setScalar(Math.max(scale, 1e-4));
      _p.copy(s.p);
      this.petals.setMatrixAt(i, _m.compose(_p, _q2, _s));
    }
    this.petals.instanceMatrix.needsUpdate = true;
    if (alive === 0) {
      this.burst = false;
      this.petals.visible = false;
    }
  }
}

export function createCart(seed = 0): ObstacleRig {
  return new CartRig(seed);
}

export function disposeCartCaches(): void {
  cartGeo?.dispose();
  petalGeo?.dispose();
  cartGeo = null;
  petalGeo = null;
}
