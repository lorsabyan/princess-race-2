import * as THREE from 'three';
import { PAL } from '../kit/palette';
import { cyl, sphere as sphereGeo } from '../kit/geo';
import { blend, ellipsoid, mirrorX, move, roundCone, sphere } from '../kit/sdf';
import { meshSdf } from '../kit/mesher';
import { ItemBuilder, rng, type Surf } from './surface';
import { obstacleMaterial, type ObstacleRig } from './rig';

/**
 * 'ducks': a mother duck (with a pink bow) leading 2–3 fluffy ducklings across the
 * road. The whole family is ONE skinned mesh (one draw call): rigid bones for each
 * body, the mother's head, every wing and every foot. They waddle (bob, roll,
 * stepping feet, head bob) back and forth over a small range, turning toward the
 * camera at each end; when bumped they flap and hop aside.
 */

const COL = {
  duck: '#ffd955',
  duckBelly: '#fff0a6',
  duckWarm: '#ffb547',
  duckling: '#ffe774',
  ducklingBelly: '#fff8cf',
  beak: PAL.duckBeak,
  beakDeep: '#f5822a',
  eye: PAL.eye,
  shine: '#ffffff',
  blush: '#ffa3a3',
  bow: '#ff5c8e',
  bowKnot: '#ff7aa3',
};

const S_PLUSH: Surf = { r: 0.6, g: 0.14 };
const S_FLUFF: Surf = { r: 0.7, g: 0.13 };
const S_BEAK: Surf = { r: 0.34, c: 0.6, g: 0.05 };
const S_EYE: Surf = { r: 0.05, c: 1 };
const S_SHINE: Surf = { r: 0.3, g: 1.2 };
const S_BOW: Surf = { r: 0.32, c: 0.7, g: 0.05 };

// ---------------------------------------------------------------------------
// Skeleton layout
// ---------------------------------------------------------------------------

interface BoneDef {
  name: string;
  parent: number;
  pos: [number, number, number];
}

const MOTHER = { body: 1, head: 2, wingL: 3, wingR: 4, footL: 5, footR: 6 };
const DUCKLING_BONES = 5;
const ducklingBone = (k: number) => {
  const b = 7 + k * DUCKLING_BONES;
  return { body: b, wingL: b + 1, wingR: b + 2, footL: b + 3, footR: b + 4 };
};

function boneDefs(ducklings: number): BoneDef[] {
  const defs: BoneDef[] = [
    { name: 'root', parent: -1, pos: [0, 0, 0] },
    { name: 'mother', parent: 0, pos: [0, 0, 0] },
    { name: 'mother-head', parent: 1, pos: [0, 0.4, 0.12] },
    { name: 'mother-wingL', parent: 1, pos: [0.165, 0.29, 0.05] },
    { name: 'mother-wingR', parent: 1, pos: [-0.165, 0.29, 0.05] },
    { name: 'mother-footL', parent: 1, pos: [0.075, 0.03, 0.05] },
    { name: 'mother-footR', parent: 1, pos: [-0.075, 0.03, 0.05] },
  ];
  for (let k = 0; k < ducklings; k += 1) {
    const b = ducklingBone(k).body;
    defs.push(
      { name: `duckling${k}`, parent: 0, pos: [0, 0, 0] },
      { name: `duckling${k}-wingL`, parent: b, pos: [0.082, 0.135, 0.02] },
      { name: `duckling${k}-wingR`, parent: b, pos: [-0.082, 0.135, 0.02] },
      { name: `duckling${k}-footL`, parent: b, pos: [0.04, 0.015, 0.03] },
      { name: `duckling${k}-footR`, parent: b, pos: [-0.04, 0.015, 0.03] },
    );
  }
  return defs;
}

// ---------------------------------------------------------------------------
// Modeling (each duck in its own local frame: facing +Z, feet on y = 0)
// ---------------------------------------------------------------------------

const smooth01 = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Eyes with a sparkle highlight, placed on a head sphere. */
function addEyes(
  b: ItemBuilder,
  head: THREE.Vector3,
  headR: number,
  eyeR: number,
  spread: number,
  bone: number,
  seg: [number, number],
): void {
  const eye = sphereGeo(eyeR, seg[0], seg[1]);
  const shine = sphereGeo(eyeR * 0.36, 5, 3);
  for (const s of [-1, 1]) {
    const dir = new THREE.Vector3(s * spread, 0.2, 0.86).normalize();
    const c = head.clone().addScaledVector(dir, headR - eyeR * 0.45);
    b.add(eye, COL.eye, S_EYE, { p: [c.x, c.y, c.z], s: [1, 1.12, 1], bone });
    const hl = c.clone().addScaledVector(dir.clone().add(new THREE.Vector3(-s * 0.25, 0.75, 0)).normalize(), eyeR * 0.82);
    b.add(shine, COL.shine, S_SHINE, { p: [hl.x, hl.y, hl.z], bone });
  }
  eye.dispose();
  shine.dispose();
}

function addMother(b: ItemBuilder): void {
  // Body + neck: one smooth clay form.
  const body = blend(
    0.09,
    move(ellipsoid(0.2, 0.165, 0.25), 0, 0.215, -0.02),
    move(sphere(0.15), 0, 0.225, 0.09),
    roundCone(0, 0.25, -0.15, 0, 0.35, -0.3, 0.1, 0.03),
    roundCone(0, 0.3, 0.09, 0, 0.44, 0.13, 0.1, 0.086),
  );
  const bodyGeo = meshSdf(body, {
    min: [-0.25, 0.02, -0.38],
    max: [0.25, 0.49, 0.29],
    cell: 0.042,
    colorFn: (_x, y, z) =>
      new THREE.Color(COL.duck)
        .lerp(new THREE.Color(COL.duckWarm), smooth01(0.22, 0.05, y) * 0.85)
        .lerp(new THREE.Color(COL.duckBelly), smooth01(0.17, 0.08, y) * smooth01(-0.1, 0.12, z) * 0.6)
        .getHex(),
  });
  b.addColored(bodyGeo, S_PLUSH, { bone: MOTHER.body });
  bodyGeo.dispose();

  // Head with chubby cheeks + neck stub (own bone so it can bob).
  const H = new THREE.Vector3(0, 0.5, 0.14);
  const HR = 0.13;
  const head = blend(
    0.05,
    move(sphere(HR), H.x, H.y, H.z),
    mirrorX(move(sphere(0.062), 0.058, 0.455, 0.195)),
    roundCone(0, 0.39, 0.12, 0, 0.47, 0.14, 0.086, 0.1),
  );
  const blushPts = [-1, 1].map((s) => H.clone().addScaledVector(new THREE.Vector3(s * 0.74, -0.24, 0.63).normalize(), HR));
  const headGeo = meshSdf(head, {
    min: [-0.16, 0.36, -0.02],
    max: [0.16, 0.65, 0.3],
    cell: 0.028,
    colorFn: (x, y, z) => {
      const c = new THREE.Color(COL.duck);
      for (const p of blushPts) {
        const d = Math.hypot(x - p.x, y - p.y, z - p.z);
        c.lerp(new THREE.Color(COL.blush), smooth01(0.05, 0.02, d) * 0.85);
      }
      return c.getHex();
    },
  });
  b.addColored(headGeo, S_PLUSH, { bone: MOTHER.head });
  headGeo.dispose();

  // Bill: a wide soft spoon with a smaller lower mandible (reads as a smile).
  const bill = sphereGeo(1, 10, 6);
  b.add(bill, COL.beak, S_BEAK, { p: [0, 0.468, 0.262], s: [0.078, 0.03, 0.072], r: [0.1, 0, 0], bone: MOTHER.head });
  bill.dispose();
  const jaw = sphereGeo(1, 8, 5);
  b.add(jaw, COL.beakDeep, S_BEAK, { p: [0, 0.444, 0.25], s: [0.058, 0.02, 0.055], r: [0.2, 0, 0], bone: MOTHER.head });
  jaw.dispose();
  addEyes(b, H, HR, 0.029, 0.5, MOTHER.head, [8, 6]);

  // Pink satin bow on top of the head.
  const bowYaw = Math.PI / 4;
  const loop = sphereGeo(1, 8, 5);
  for (const s of [-1, 1]) {
    const lx = s * 0.058 * Math.cos(bowYaw);
    const lz = -s * 0.058 * Math.sin(bowYaw);
    b.add(loop, COL.bow, S_BOW, { p: [lx, 0.628, 0.1 + lz], s: [0.064, 0.042, 0.024], r: [-0.35, bowYaw, s * 0.42], bone: MOTHER.head });
  }
  loop.dispose();
  const knot = sphereGeo(0.027, 7, 5);
  b.add(knot, COL.bowKnot, S_BOW, { p: [0, 0.628, 0.1], bone: MOTHER.head });
  knot.dispose();

  // Wings (rest tucked against the body; pivot at the shoulder).
  const wing = sphereGeo(1, 8, 6);
  for (const s of [-1, 1]) {
    b.add(wing, COL.duck, S_PLUSH, {
      p: [s * 0.185, 0.245, -0.045],
      s: [0.048, 0.095, 0.155],
      r: [0.38, 0, s * 0.14],
      bone: s > 0 ? MOTHER.wingL : MOTHER.wingR,
    });
  }
  wing.dispose();

  // Webbed feet + stubby legs.
  const foot = sphereGeo(1, 8, 4);
  const leg = cyl(0.017, 0.015, 0.07, 5, true);
  for (const s of [-1, 1]) {
    const bone = s > 0 ? MOTHER.footL : MOTHER.footR;
    b.add(foot, COL.beak, S_BEAK, { p: [s * 0.078, 0.013, 0.085], s: [0.052, 0.014, 0.072], bone });
    b.add(leg, COL.beakDeep, S_BEAK, { p: [s * 0.075, 0.05, 0.05], bone });
  }
  foot.dispose();
  leg.dispose();
}

const DUCKLING_H = new THREE.Vector3(0, 0.222, 0.055);
const DUCKLING_HR = 0.09;
let ducklingSdf: THREE.BufferGeometry | null = null;

/** Duckling body + big head as one fluffy clay form (meshed once, shared by every duckling). */
function ducklingBodyGeometry(): THREE.BufferGeometry {
  if (ducklingSdf) return ducklingSdf;
  const H = DUCKLING_H;
  const HR = DUCKLING_HR;
  const shape = blend(
    0.06,
    move(ellipsoid(0.098, 0.083, 0.118), 0, 0.1, -0.012),
    roundCone(0, 0.115, -0.07, 0, 0.165, -0.14, 0.05, 0.016),
    move(sphere(HR), H.x, H.y, H.z),
    mirrorX(move(sphere(0.04), 0.04, 0.195, 0.09)),
  );
  const blushPts = [-1, 1].map((s) => H.clone().addScaledVector(new THREE.Vector3(s * 0.74, -0.26, 0.62).normalize(), HR));
  ducklingSdf = meshSdf(shape, {
    min: [-0.13, 0.0, -0.18],
    max: [0.13, 0.36, 0.16],
    cell: 0.029,
    colorFn: (x, y, z) => {
      const c = new THREE.Color(COL.duckling).lerp(new THREE.Color(COL.ducklingBelly), smooth01(0.08, 0.03, y) * 0.9);
      for (const p of blushPts) {
        const d = Math.hypot(x - p.x, y - p.y, z - p.z);
        c.lerp(new THREE.Color(COL.blush), smooth01(0.034, 0.012, d) * 0.8);
      }
      return c.getHex();
    },
  });
  return ducklingSdf;
}

function addDuckling(b: ItemBuilder, k: number): void {
  const bones = ducklingBone(k);
  const H = DUCKLING_H;
  const HR = DUCKLING_HR;
  const geo = ducklingBodyGeometry();
  b.addColored(geo, S_FLUFF, { bone: bones.body });

  const bill = sphereGeo(1, 8, 5);
  b.add(bill, COL.beak, S_BEAK, { p: [0, 0.213, 0.14], s: [0.044, 0.018, 0.04], r: [0.1, 0, 0], bone: bones.body });
  bill.dispose();
  addEyes(b, H, HR, 0.023, 0.5, bones.body, [8, 5]);

  const wing = sphereGeo(1, 6, 4);
  for (const s of [-1, 1]) {
    b.add(wing, COL.duckling, S_FLUFF, {
      p: [s * 0.094, 0.115, -0.02],
      s: [0.026, 0.048, 0.064],
      r: [0.4, 0, s * 0.2],
      bone: s > 0 ? bones.wingL : bones.wingR,
    });
  }
  wing.dispose();

  const foot = sphereGeo(1, 6, 3);
  for (const s of [-1, 1]) {
    b.add(foot, COL.beak, S_BEAK, { p: [s * 0.042, 0.008, 0.05], s: [0.03, 0.009, 0.042], bone: s > 0 ? bones.footL : bones.footR });
  }
  foot.dispose();
}

const familyCache = new Map<number, THREE.BufferGeometry>();

function familyGeometry(ducklings: number): THREE.BufferGeometry {
  const hit = familyCache.get(ducklings);
  if (hit) return hit;
  const b = new ItemBuilder({ skinned: true });
  addMother(b);
  for (let k = 0; k < ducklings; k += 1) addDuckling(b, k);
  const g = b.build();
  g.name = `duck-family-${ducklings}`;
  familyCache.set(ducklings, g);
  return g;
}

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

interface DuckState {
  body: THREE.Bone;
  head: THREE.Bone | null;
  wingL: THREE.Bone;
  wingR: THREE.Bone;
  footL: THREE.Bone;
  footR: THREE.Bone;
  footRest: [THREE.Vector3, THREE.Vector3];
  home: THREE.Vector2;
  /** Turn delay behind the leader (s). */
  delay: number;
  mother: boolean;
  stepRate: number;
  phase: number;
  /** Persistent scatter offset from hops. */
  off: THREE.Vector2;
  hopV: THREE.Vector3;
  hopY: number;
  airborne: boolean;
  flap: number;
  squash: number;
  pending: number;
  /** Facing while fleeing (blend weight `flee`). */
  fleeYaw: number;
  flee: number;
  // Drift-driven mode (game passes the root's lateral velocity).
  /** Current eased heading. */
  yawNow: number;
  /** Direction currently walked toward (+1/-1), 0 = not initialised yet. */
  headSign: number;
  /** Countdown until this duck follows a sign flip of the drift (-1 = none). */
  flipTimer: number;
  /** Integrated step phase (step speed follows |drift|). */
  stepPh: number;
}

// Walk cycle: the line waddles slowly across a small range, turns around
// (through the camera-facing side, staggered), and waddles back.
const WALK = 5.2;
const TURN = 1.0;
const PERIOD = 2 * (WALK + TURN);
const RANGE = 0.11;
const FACE_BIAS = 0.4;
/** Storybook scale-up for readability from the chase camera (mother ~0.72 tall, ducklings ~0.35). */
const MOTHER_SCALE = 1.2;
const DUCKLING_SCALE = 1.12;
// A gently zigzagging line so the (bigger) ducklings can follow closely without bumping.
const LINE_X: Record<number, number[]> = { 2: [0.4, -0.12, -0.46], 3: [0.44, -0.08, -0.39, -0.68] };
const LINE_Z: Record<number, number[]> = { 2: [0.0, 0.09, -0.08], 3: [0.0, 0.1, -0.08, 0.09] };
// Drift-driven mode tuning.
const DRIFT_EPS = 0.03; // below this |drift| (u/s) the family idles
const DRIFT_WALK = 0.2; // full waddle from this speed
const DRIFT_REF = 0.3; // step rate reference speed
const DRIFT_STAGGER = 1.5; // multiplies the per-duck turn delay (0, .12, .24, .36 s)
const TURN_RATE = 4.5; // heading easing (1/s)
const tmpE = new THREE.Euler();
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

class DucksRig implements ObstacleRig {
  readonly root = new THREE.Group();
  readonly kind = 'ducks' as const;
  readonly halfWidth = 0.9;
  readonly halfDepth = 0.5;
  private readonly mesh: THREE.SkinnedMesh;
  private readonly skeleton: THREE.Skeleton;
  private readonly ducks: DuckState[] = [];
  private readonly random: () => number;
  private readonly cyclePhase: number;
  private readonly facing: number;

  constructor(seed: number) {
    this.random = rng(seed * 104729 + 11);
    const ducklings = seed % 2 === 0 ? 3 : 2;
    this.cyclePhase = this.random() * PERIOD;
    // Mirror the family for some seeds so the mother leads toward -X instead.
    this.facing = Math.floor(seed / 2) % 2 === 0 ? 1 : -1;
    this.root.name = 'obstacle-ducks';

    const defs = boneDefs(ducklings);
    const bones = defs.map((d) => {
      const bone = new THREE.Bone();
      bone.name = d.name;
      bone.position.set(...d.pos);
      return bone;
    });
    defs.forEach((d, i) => {
      if (d.parent >= 0) bones[d.parent].add(bones[i]);
    });
    this.mesh = new THREE.SkinnedMesh(familyGeometry(ducklings), obstacleMaterial());
    this.mesh.name = 'duck-family';
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.add(bones[0]);
    this.skeleton = new THREE.Skeleton(bones);
    this.mesh.bind(this.skeleton);
    // Generous fixed bounds (bind-pose geometry is stacked at the origin).
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.4, 0), 2.6);

    const flip = new THREE.Group();
    flip.name = 'duck-family-dir';
    flip.scale.x = this.facing;
    flip.add(this.mesh);
    this.root.add(flip);

    const mk = (i: number, mother: boolean): DuckState => {
      const ids = mother ? MOTHER : ducklingBone(i - 1);
      const footL = bones[ids.footL];
      const footR = bones[ids.footR];
      return {
        body: bones[ids.body],
        head: mother ? bones[MOTHER.head] : null,
        wingL: bones[ids.wingL],
        wingR: bones[ids.wingR],
        footL,
        footR,
        footRest: [footL.position.clone(), footR.position.clone()],
        home: new THREE.Vector2(LINE_X[ducklings][i], LINE_Z[ducklings][i]),
        delay: i * 0.12,
        mother,
        stepRate: mother ? 11.5 : 16 + this.random() * 2,
        phase: this.random() * Math.PI * 2,
        off: new THREE.Vector2(),
        hopV: new THREE.Vector3(),
        hopY: 0,
        airborne: false,
        flap: 0,
        squash: 0,
        pending: -1,
        fleeYaw: 0,
        flee: 0,
        yawNow: 0,
        headSign: 0,
        flipTimer: -1,
        stepPh: 0,
      };
    };
    this.ducks.push(mk(0, true));
    for (let k = 0; k < ducklings; k += 1) this.ducks.push(mk(k + 1, false));
    this.reset();
  }

  update(dt: number, time: number, driftX?: number): void {
    const step = Math.min(Math.max(dt, 0), 1 / 20);
    let vx: number | undefined;
    if (driftX !== undefined) {
      // Parent-space velocity -> rig space (root may be yawed) -> mirrored family frame.
      tmpV.set(driftX, 0, 0).applyQuaternion(tmpQ.copy(this.root.quaternion).invert());
      vx = tmpV.x * this.facing;
    }
    for (const d of this.ducks) this.animateDuck(d, step, time, vx);
  }

  react(side: -1 | 1): void {
    // `side` is in rig space; the family may be mirrored. Scatter away from the
    // impact point (the car clipped the -side half) and away from the car (-Z).
    const s = side * this.facing;
    const impact = -s * 0.35;
    for (const d of this.ducks) {
      const x = d.body.position.x;
      const out = THREE.MathUtils.clamp((x - impact) * 2.4, -1.4, 1.4) + s * 0.45;
      d.pending = (d.mother ? 0 : 0.04) + this.random() * 0.12;
      d.hopV.set(out * (d.mother ? 0.9 : 1.2), d.mother ? 2.8 : 3.1 + this.random() * 0.4, -(0.35 + this.random() * 0.6));
      d.fleeYaw = Math.sign(out || s) * (Math.PI / 2 - 0.25);
    }
  }

  reset(): void {
    for (const d of this.ducks) {
      d.off.set(0, 0);
      d.hopV.set(0, 0, 0);
      d.hopY = 0;
      d.airborne = false;
      d.flap = 0;
      d.squash = 0;
      d.pending = -1;
      d.flee = 0;
      d.yawNow = 0;
      d.headSign = 0;
      d.flipTimer = -1;
      d.stepPh = 0;
    }
    this.update(0, 0);
  }

  dispose(): void {
    this.root.removeFromParent();
    this.skeleton.dispose();
    this.root.clear();
  }

  private animateDuck(d: DuckState, dt: number, time: number, vx?: number): void {
    // --- hop reaction physics
    if (d.pending >= 0) {
      d.pending -= dt;
      if (d.pending < 0) {
        d.airborne = true;
        d.flap = 1;
        d.flee = 1;
        d.pending = -1;
      }
    }
    if (d.airborne) {
      d.hopV.y -= 13 * dt;
      d.hopY += d.hopV.y * dt;
      d.off.x += d.hopV.x * dt;
      d.off.y += d.hopV.z * dt;
      if (d.hopY <= 0) {
        d.hopY = 0;
        d.airborne = false;
        d.squash = 1;
        // Repeated bumps must not walk the family out of the scene.
        if (d.off.length() > 1.4) d.off.setLength(1.4);
      }
    } else {
      d.flap = Math.max(0, d.flap - dt * 1.1);
      d.flee = Math.max(0, d.flee - dt * 0.45);
    }
    d.squash = Math.max(0, d.squash - dt * 4);

    const yawRight = Math.PI / 2 - FACE_BIAS;
    let x = 0;
    let yaw: number;
    let walking = 1;
    let ph: number;
    let idleBob = 0;
    if (vx === undefined) {
      // --- own walk cycle (lab / standalone): waddle across ±RANGE, staggered turns
      const t = (((time + this.cyclePhase - d.delay) % PERIOD) + PERIOD) % PERIOD;
      const yawLeft = -yawRight;
      if (t < WALK) {
        x = -RANGE + (2 * RANGE * t) / WALK;
        yaw = yawRight;
      } else if (t < WALK + TURN) {
        x = RANGE;
        yaw = THREE.MathUtils.lerp(yawRight, yawLeft, smooth01(0, 1, (t - WALK) / TURN));
        walking = 0.5;
      } else if (t < 2 * WALK + TURN) {
        x = RANGE - (2 * RANGE * (t - WALK - TURN)) / WALK;
        yaw = yawLeft;
      } else {
        x = -RANGE;
        yaw = THREE.MathUtils.lerp(yawLeft, yawRight, smooth01(0, 1, (t - 2 * WALK - TURN) / TURN));
        walking = 0.5;
      }
      ph = time * d.stepRate * 0.5 + d.phase;
    } else {
      // --- drift-driven: face the direction the game slides the root, turn one after
      // another when it reverses (mother first), step speed follows the drift speed.
      const speed = Math.abs(vx);
      const sign = vx >= 0 ? 1 : -1;
      if (d.headSign === 0) {
        d.headSign = sign;
        d.yawNow = sign * yawRight;
        d.flipTimer = -1;
      } else if (sign !== d.headSign) {
        if (d.flipTimer < 0 && speed > DRIFT_EPS) d.flipTimer = d.delay * DRIFT_STAGGER;
      } else d.flipTimer = -1;
      if (d.flipTimer >= 0) {
        d.flipTimer -= dt;
        if (d.flipTimer < 0) {
          d.headSign = sign;
          d.flipTimer = -1;
        }
      }
      // Ease through the camera-facing side (both targets keep the camera bias).
      d.yawNow += (d.headSign * yawRight - d.yawNow) * (1 - Math.exp(-TURN_RATE * dt));
      yaw = d.yawNow;
      walking = smooth01(DRIFT_EPS, DRIFT_WALK, speed);
      d.stepPh += dt * d.stepRate * 0.5 * Math.min(1.6, speed / DRIFT_REF);
      ph = d.stepPh + d.phase;
      // Nearly stationary: a gentle breathing bob instead of steps.
      idleBob = (1 - walking) * (0.5 + 0.5 * Math.sin(time * 2.6 + d.phase)) * 0.012 * (d.mother ? 1 : 0.7);
    }
    const amp = walking * (d.airborne ? 0.2 : 1);
    const sz = d.mother ? 1 : 0.7;
    const bob = Math.abs(Math.sin(ph)) * 0.02 * sz * amp;
    const fleeW = smooth01(0, 1, d.flee);
    yaw += (d.fleeYaw - yaw) * fleeW;
    const squashY = 1 - d.squash * 0.18;
    const squashXZ = 1 + d.squash * 0.1;

    d.body.position.set(d.home.x + x + d.off.x, d.hopY + bob + idleBob, d.home.y + d.off.y);
    // Heading, a little forward lean when airborne, waddle roll + yaw wiggle.
    tmpE.set(Math.sin(ph * 2) * 0.03 * amp - (d.airborne ? 0.25 : 0), yaw + Math.sin(ph) * 0.07 * amp, Math.sin(ph) * 0.13 * amp, 'YXZ');
    d.body.quaternion.setFromEuler(tmpE);
    const k = d.mother ? MOTHER_SCALE : DUCKLING_SCALE;
    d.body.scale.set(squashXZ * k, squashY * k, squashXZ * k);

    if (d.head) {
      d.head.rotation.set(Math.sin(ph * 2 + 0.6) * 0.09 * amp + Math.sin(time * 0.9 + d.phase) * 0.05, Math.sin(time * 0.7 + d.phase) * 0.14, 0);
    }

    // Wings: idle tuck with a tiny breathing flutter; big flaps when scared.
    // Big flaps (wings swing up over the back) so they read from the side-on chase view.
    const flapA = d.flap > 0 ? Math.sin(time * 30 + d.phase) * 0.75 + 1.75 : 0;
    const idle = Math.sin(time * 2.1 + d.phase) * 0.04;
    const wingZ = idle + flapA * Math.min(1, d.flap * 1.5);
    d.wingL.rotation.set(0, 0, wingZ);
    d.wingR.rotation.set(0, 0, -wingZ);

    // Feet step alternately.
    const lift = 0.028 * sz * amp;
    const swing = 0.035 * sz * amp;
    const [rl, rr] = d.footRest;
    const sl = Math.sin(ph);
    d.footL.position.set(rl.x, rl.y + Math.max(0, sl) * lift, rl.z + Math.cos(ph) * swing);
    d.footR.position.set(rr.x, rr.y + Math.max(0, -sl) * lift, rr.z - Math.cos(ph) * swing);
    d.footL.rotation.x = -Math.max(0, sl) * 0.5 * amp;
    d.footR.rotation.x = -Math.max(0, -sl) * 0.5 * amp;
  }
}

export function createDucks(seed = 0): ObstacleRig {
  return new DucksRig(seed);
}

export function disposeDuckCaches(): void {
  for (const g of familyCache.values()) g.dispose();
  familyCache.clear();
  ducklingSdf?.dispose();
  ducklingSdf = null;
}
