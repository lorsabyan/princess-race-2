import * as THREE from 'three';
import {
  blend,
  ellipsoid,
  mirrorX,
  move,
  rotate,
  roundBox,
  sphere,
  subtract,
  union,
  type SdfNode,
} from '../kit/sdf';
import { meshSdf } from '../kit/mesher';
import { PAL } from '../kit/palette';
import { boundedTube, displaceNear, smoothPath, stretch, type TubePoint } from './sdfx';
import { HEAD_R, PIG_PATH, pigPath } from './rigSpec';

const [HX, HY, HZ] = HEAD_R;
const DEG = Math.PI / 180;

/** Point on the (inflated) head ellipsoid. lon: + toward her right (+X); lat: + up. */
export function onHead(lonDeg: number, latDeg: number, lift = 0): [number, number, number] {
  const lon = lonDeg * DEG;
  const lat = latDeg * DEG;
  const k = 1 + lift;
  return [HX * k * Math.sin(lon) * Math.cos(lat), HY * k * Math.sin(lat), -HZ * k * Math.cos(lon) * Math.cos(lat)];
}

function lock(points: Array<[number, number, number, number]>, lift: number, k = 0.012): SdfNode {
  // points: lon, lat, radius, extra lift
  const path: TubePoint[] = points.map(([lon, lat, r, extra]) => {
    const p = onHead(lon, lat, lift + extra);
    return [p[0], p[1], p[2], r];
  });
  return boundedTube(smoothPath(path, 3), k);
}

// ---------------------------------------------------------------------------
// Head
// ---------------------------------------------------------------------------

/** Narrows the lower half of the head into a soft little jaw. */
function jaw(n: SdfNode): SdfNode {
  return {
    d: (x, y, z) => {
      const k = 1 - 0.1 * smooth(0.0, -0.24, y);
      return n.d(x / k, y, z) * k;
    },
    m: n.m,
  };
}

export function headField(): SdfNode {
  const base = jaw(ellipsoid(HX, HY, HZ));
  // Round baby cheeks, and a small chin to finish the face.
  const cheeks = mirrorX(move(ellipsoid(0.1, 0.084, 0.09), 0.122, -0.09, -0.13));
  let head = blend(0.075, base, cheeks);
  // Tiny button nose.
  head = blend(0.02, head, move(ellipsoid(0.024, 0.019, 0.018), 0, -0.073, -0.238));
  // Small ears with a soft cup.
  const ear = subtract(
    move(rotate(ellipsoid(0.022, 0.04, 0.026), 0, -0.25, -0.1), HX - 0.004, -0.04, 0.02),
    move(sphere(0.016), HX + 0.012, -0.04, 0.008),
    0.008,
  );
  head = blend(0.022, head, mirrorX(ear));
  return head;
}

export function buildHead(): THREE.BufferGeometry {
  return meshSdf(headField(), {
    min: [-0.32, -0.28, -0.29],
    max: [0.32, 0.28, 0.29],
    cell: 0.0125,
    project: 1,
    colors: { 0: '#ffffff' },
  });
}

// ---------------------------------------------------------------------------
// Hair: snug swept-up cap, scalloped side-swept bangs, a center part down the
// back, and two pigtails tied with pink bows.
// ---------------------------------------------------------------------------

const TIE_R = new THREE.Vector3(PIG_PATH[0][0], PIG_PATH[0][1], PIG_PATH[0][2]).normalize();
const TIE_L = TIE_R.clone().setX(-TIE_R.x);
const PART = new THREE.Vector3(...onHead(24, 64)).normalize();

/** Frame around an axis for angular grooves. */
function axisFrame(a: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const ref = Math.abs(a.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const e1 = ref.clone().addScaledVector(a, -ref.dot(a)).normalize();
  const e2 = new THREE.Vector3().crossVectors(a, e1).normalize();
  return [e1, e2];
}
const [TR_E1, TR_E2] = axisFrame(TIE_R);
const [TL_E1, TL_E2] = axisFrame(TIE_L);
const [PART_E1, PART_E2] = axisFrame(PART);

/** How far the bangs' combing takes over from the back's (0 = back of the head, 1 = bangs). */
function bangWeight(x: number, y: number, z: number): number {
  void x;
  return smooth(-0.02, -0.15, z) * smooth(-0.02, 0.08, y);
}

function grooveAround(
  x: number,
  y: number,
  z: number,
  a: THREE.Vector3,
  e1: THREE.Vector3,
  e2: THREE.Vector3,
  n: number,
  sharp: number,
): number {
  const len = Math.hypot(x, y, z) || 1;
  const c = (x * a.x + y * a.y + z * a.z) / len;
  const fade = 1 - smooth(0.82, 0.97, c);
  const psi = Math.atan2(x * e2.x + y * e2.y + z * e2.z, x * e1.x + y * e1.y + z * e1.z);
  return Math.pow(0.5 + 0.5 * Math.cos(n * psi), sharp) * fade;
}

/** Center part line down the back of the head (0..1). */
function partLine(x: number, y: number, z: number): number {
  return Math.exp(-Math.pow(x / 0.0075, 2)) * smooth(-0.04, 0.06, z) * smooth(-0.06, 0.08, y);
}

/** 0..1 groove intensity: bangs sweep from the side part, the back fans out toward each pigtail. */
function capGroove(x: number, y: number, z: number): number {
  const front = bangWeight(x, y, z);
  // Each groove system fades out before the other starts, so they never mix into bumps.
  const wBack = smooth(0.4, 0.1, front);
  const wBang = smooth(0.6, 0.9, front);
  const back =
    wBack > 0
      ? x >= 0
        ? grooveAround(x, y, z, TIE_R, TR_E1, TR_E2, 15, 2.4)
        : grooveAround(x, y, z, TIE_L, TL_E1, TL_E2, 15, 2.4)
      : 0;
  const bang = wBang > 0 ? grooveAround(x, y, z, PART, PART_E1, PART_E2, 9, 2.4) : 0;
  return Math.max(back * wBack + bang * wBang, partLine(x, y, z));
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function hairField(): SdfNode {
  const capBase = move(ellipsoid(0.292, 0.286, 0.292), 0, 0.016, 0.012);
  // Hair bunches up where it gathers into each pigtail.
  const gathers = mirrorX(move(ellipsoid(0.09, 0.085, 0.09), 0.205, 0.155, 0.045));
  let cap: SdfNode = blend(0.07, capBase, gathers);
  cap = displaceNear(cap, (x, y, z) => 0.0034 * capGroove(x, y, z) + 0.0016 * partLine(x, y, z), 0.035);
  // Face window: the lower face plus three arcs that scallop the side-swept bang edge.
  const window = union(
    move(ellipsoid(0.252, 0.25, 0.33), 0, -0.2, -0.27),
    move(rotate(ellipsoid(0.128, 0.094, 0.15), 0, 0, -0.32), -0.11, 0.026, -0.25),
    move(rotate(ellipsoid(0.078, 0.088, 0.15), 0, 0, 0.12), 0.05, 0.036, -0.25),
    move(rotate(ellipsoid(0.068, 0.11, 0.15), 0, 0, 0.4), 0.192, -0.002, -0.21),
    // Temples: the sides are swept back toward the ears.
    mirrorX(move(rotate(ellipsoid(0.07, 0.13, 0.13), 0.3, 0, 0), 0.245, -0.045, -0.135)),
  );
  cap = subtract(cap, window, 0.018);
  // Ears peek out below the swept-up sides.
  cap = subtract(cap, mirrorX(move(ellipsoid(0.05, 0.066, 0.054), HX + 0.012, -0.066, 0.02)), 0.02);
  // Nape hairline: low, so no scalp shows from behind.
  cap = subtract(cap, move(ellipsoid(0.5, 0.24, 0.5), 0, -0.49, 0.14), 0.05);

  // Little kiss curls at the temples.
  const tendrils: SdfNode[] = [];
  for (const s of [-1, 1]) {
    tendrils.push(
      lock(
        [
          [s * 60, 26, 0.02, 0.0],
          [s * 64, 12, 0.021, 0.04],
          [s * 66, -2, 0.018, 0.07],
          [s * 63, -12, 0.013, 0.08],
          [s * 57, -13, 0.008, 0.075],
          [s * 54, -7, 0.004, 0.07],
        ],
        0.03,
        0.008,
      ),
    );
  }
  return blend(0.018, cap, ...tendrils);
}

const HAIR_BASE = new THREE.Color(PAL.hair).lerp(new THREE.Color(PAL.hairLight), 0.4);
const HAIR_LIGHT = new THREE.Color(PAL.hairLight).lerp(new THREE.Color('#d08a55'), 0.35);
const HAIR_DEEP = new THREE.Color('#6a3620');

function hairColor(x: number, y: number, z: number): THREE.Color {
  const len = Math.hypot(x, y, z) || 1;
  const up = y / len;
  // Lighter crown, deeper toward the nape and tips.
  const c = HAIR_BASE.clone().lerp(HAIR_LIGHT, smooth(0.1, 0.85, up) * 0.7);
  c.lerp(HAIR_DEEP, smooth(0.0, -0.6, up) * 0.5);
  // Grooves read as deeper strands.
  c.lerp(HAIR_DEEP, capGroove(x, y, z) * 0.34);
  return c;
}

/**
 * Which way the hair runs, for the moving highlight: toward each pigtail on the back, away from
 * the part on the bangs. xyz = direction, w = position across the strands (mirrored around the
 * axis, so the streaks have no seam).
 */
function capFlow(x: number, y: number, z: number, out: THREE.Vector4): void {
  const len = Math.hypot(x, y, z) || 1;
  const p = new THREE.Vector3(x / len, y / len, z / len);
  const front = bangWeight(x, y, z);
  const tie = x >= 0 ? TIE_R : TIE_L;
  const back = tie.clone().addScaledVector(p, -tie.dot(p)).normalize();
  const bang = p.clone().multiplyScalar(p.dot(PART)).sub(PART).normalize();
  const flow = back.lerp(bang, front).normalize();
  const [e1, e2] = front > 0.5 ? [PART_E1, PART_E2] : x >= 0 ? [TR_E1, TR_E2] : [TL_E1, TL_E2];
  const psi = Math.atan2(p.dot(e2), p.dot(e1));
  out.set(flow.x, flow.y, flow.z, 0.02 + (Math.abs(psi) / Math.PI) * 0.46);
}

/** Bakes the flow of the hair into a `hair` attribute (see Princess.ts). */
function bakeFlow(g: THREE.BufferGeometry, flowAt: (x: number, y: number, z: number, out: THREE.Vector4) => void): THREE.BufferGeometry {
  const pos = g.attributes.position;
  const arr = new Float32Array(pos.count * 4);
  const v = new THREE.Vector4();
  for (let i = 0; i < pos.count; i += 1) {
    flowAt(pos.getX(i), pos.getY(i), pos.getZ(i), v);
    v.toArray(arr, i * 4);
  }
  g.setAttribute('hair', new THREE.BufferAttribute(arr, 4));
  return g;
}

export function buildHair(): THREE.BufferGeometry {
  const g = meshSdf(hairField(), {
    min: [-0.33, -0.29, -0.33],
    max: [0.33, 0.35, 0.35],
    cell: 0.0098,
    project: 1,
    colorFn: (x, y, z) => hairColor(x, y, z),
  });
  return bakeFlow(g, capFlow);
}

// ---------------------------------------------------------------------------
// Pigtails: three twisted strands blended into one bouncy lock per side.
// ---------------------------------------------------------------------------

export function pigtailField(side: number): SdfNode {
  const path = smoothPath(pigPath(side), 3);
  const n = path.length;
  const acc = [0];
  for (let i = 1; i < n; i += 1) {
    acc.push(acc[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2]));
  }
  const total = acc[n - 1];
  const strands: SdfNode[] = [];
  const ref = new THREE.Vector3(0, 0, 1);
  for (let j = 0; j < 3; j += 1) {
    const pts: TubePoint[] = [];
    for (let i = 0; i < n; i += 1) {
      const a = path[Math.max(0, i - 1)];
      const b = path[Math.min(n - 1, i + 1)];
      const t = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
      const u = ref.clone().addScaledVector(t, -ref.dot(t)).normalize();
      const w = new THREE.Vector3().crossVectors(t, u).normalize();
      const s = acc[i] / total;
      const ang = (j * Math.PI * 2) / 3 + side * s * Math.PI * 1.2 + 0.3;
      const r = path[i][3];
      const off = r * 0.4 * (1 - 0.3 * s);
      pts.push([
        path[i][0] + (Math.cos(ang) * u.x + Math.sin(ang) * w.x) * off,
        path[i][1] + (Math.cos(ang) * u.y + Math.sin(ang) * w.y) * off,
        path[i][2] + (Math.cos(ang) * u.z + Math.sin(ang) * w.z) * off,
        r * (0.68 + 0.1 * s),
      ]);
    }
    strands.push(boundedTube(pts, 0.016));
  }
  return blend(0.02, ...strands);
}

export function buildPigtail(side: number): THREE.BufferGeometry {
  const field = pigtailField(side);
  const x0 = side > 0 ? 0.17 : -0.48;
  const geo = meshSdf(field, {
    min: [x0, -0.3, -0.03],
    max: [x0 + 0.31, 0.25, 0.18],
    cell: 0.0098,
    project: 1,
    colorFn: (_x, y) => {
      const t = smooth(-0.27, 0.18, y);
      return HAIR_DEEP.clone().lerp(HAIR_BASE, smooth(0, 0.35, t)).lerp(HAIR_LIGHT, smooth(0.45, 1, t) * 0.85);
    },
  });
  // Deepen the crevices between strands: vertices facing back toward the lock's axis.
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const col = geo.attributes.color;
  const path = smoothPath(pigPath(side), 4);
  const flow = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < path.length; k += 1) {
      const d = (x - path[k][0]) ** 2 + (y - path[k][1]) ** 2 + (z - path[k][2]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    const c = path[best];
    const rx = x - c[0];
    const ry = y - c[1];
    const rz = z - c[2];
    const rl = Math.hypot(rx, ry, rz) || 1;
    const facing = (rx * nor.getX(i) + ry * nor.getY(i) + rz * nor.getZ(i)) / rl;
    const k = 0.84 + 0.16 * smooth(0.55, 0.95, facing);
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
    // Along the lock, twisting a little as it goes.
    const a = path[Math.max(0, best - 1)];
    const b = path[Math.min(path.length - 1, best + 1)];
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const tz = b[2] - a[2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    const turn = Math.atan2(rz, rx) + (best / path.length) * Math.PI * 1.2;
    const wrapped = Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)));
    flow.set([tx / tl, ty / tl, tz / tl, 0.52 + (wrapped / Math.PI) * 0.2], i * 4);
  }
  geo.setAttribute('hair', new THREE.BufferAttribute(flow, 4));
  return geo;
}

// ---------------------------------------------------------------------------
// Satin bows at the pigtail ties.
// ---------------------------------------------------------------------------

export const BOW_PINK = '#ff5a9f';
const BOW_LIGHT = '#ff8cc0';
const BOW_DEEP = '#dc3f86';

/** Bow in its own frame: x sideways, y "up" in the bow plane, z out of the plane. */
export function bowLocalField(scale = 1): SdfNode {
  const s = scale;
  // Plump knot sitting proud of the loops.
  const knot = move(roundBox(0.03 * s, 0.027 * s, 0.022 * s, 0.02 * s), 0, 0, 0.012 * s);
  const loops: SdfNode[] = [];
  const tails: SdfNode[] = [];
  for (const side of [-1, 1]) {
    // Loop: narrow at the knot, broad rounded end, flattened.
    const body = stretch(
      boundedTube(
        [
          [side * 0.016 * s, 0.0, 0, 0.02 * s],
          [side * 0.068 * s, 0.018 * s, 0, 0.043 * s],
          [side * 0.112 * s, 0.028 * s, 0, 0.05 * s],
        ],
        0.02 * s,
      ),
      1,
      1,
      0.64,
    );
    // A shallow, elongated fold on the front face reads as the ribbon loop's opening.
    const fold = move(
      rotate(stretch(sphere(0.04 * s), 1.25, 0.42, 0.5), 0, 0, side * 0.2),
      side * 0.085 * s,
      0.022 * s,
      0.036 * s,
    );
    loops.push(subtract(body, fold, 0.01 * s, 1));
    // Tail: flat ribbon with a V-notched end.
    const tail = stretch(
      boundedTube(
        [
          [side * 0.012 * s, -0.016 * s, -0.004 * s, 0.02 * s],
          [side * 0.042 * s, -0.07 * s, -0.01 * s, 0.022 * s],
          [side * 0.066 * s, -0.122 * s, -0.016 * s, 0.024 * s],
        ],
        0.01 * s,
      ),
      1,
      1,
      0.42,
    );
    const notch = move(rotate(ellipsoid(0.03 * s, 0.03 * s, 0.05 * s), 0, 0, Math.PI / 4), side * 0.07 * s, -0.152 * s, 0);
    tails.push(subtract(tail, notch, 0.004 * s));
  }
  return blend(0.01 * s, knot, ...loops, ...tails);
}

export function bowColor(x: number, y: number, z: number, s = 1, mat = 0): THREE.Color {
  // Lighter on the upper outer loop surfaces, deeper near the knot and in the folds.
  if (mat === 1) return new THREE.Color(BOW_DEEP).lerp(new THREE.Color('#c23577'), 0.3);
  const c = new THREE.Color(BOW_PINK);
  const r = Math.hypot(x, y) / s;
  c.lerp(new THREE.Color(BOW_DEEP), (1 - smooth(0.02, 0.06, r)) * 0.5);
  c.lerp(new THREE.Color(BOW_LIGHT), smooth(0.0, 0.02, z / s) * smooth(0.05, 0.12, Math.abs(x) / s) * 0.5);
  return c;
}

/**
 * Two long ribbon tails streaming back from a bow, in head space. `flutter` runs 0 at the knot to
 * 1 at the tip; Princess.ts drops them when she stops and waves them in the wind.
 */
export function buildRibbons(side: number): THREE.BufferGeometry {
  const segs = 12;
  const knot = new THREE.Vector3().setFromMatrixPosition(bowMatrix(side));
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const flut: number[] = [];
  const idx: number[] = [];
  const deep = new THREE.Color('#c92a74');
  const pink = new THREE.Color(BOW_PINK);
  const c = new THREE.Color();
  for (const tail of [0, 1]) {
    const base = pos.length / 3;
    const len = tail === 0 ? 0.7 : 0.56;
    const out = side * (tail === 0 ? 0.34 : 0.08);
    for (let i = 0; i <= segs; i += 1) {
      const t = i / segs;
      const cx = knot.x + out * t * len;
      const cy = knot.y - 0.02 + (tail === 0 ? -0.08 : -0.26) * t * len + 0.1 * t * t * len;
      const cz = knot.z + t * len;
      const hw = 0.042 * (1 - 0.2 * t) * (i === segs ? 0.45 : 1);
      c.copy(deep).lerp(pink, t);
      for (const e of [-1, 1]) {
        pos.push(cx + e * hw, cy, cz);
        nor.push(0, 1, 0);
        col.push(c.r, c.g, c.b);
        flut.push(Math.max(0.001, t));
      }
    }
    for (let i = 0; i < segs; i += 1) {
      const a = base + i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('flutter', new THREE.Float32BufferAttribute(flut, 1));
  g.setIndex(idx);
  return g;
}

/** Bow placement (head space) at a pigtail tie: faces back-and-out toward the chase camera. */
export function bowMatrix(side: number): THREE.Matrix4 {
  const n = new THREE.Vector3(side * 0.5, 0.34, 0.8).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  // Tilt the loops a little so they follow the head's curve.
  q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -side * 0.38));
  const tie = pigPath(side)[0];
  const p = new THREE.Vector3(tie[0], tie[1], tie[2])
    .addScaledVector(n, 0.034)
    .add(new THREE.Vector3(side * 0.022, 0.016, 0));
  return new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1));
}

export function buildBow(scale = 1): THREE.BufferGeometry {
  const field = bowLocalField(scale);
  const s = scale;
  return meshSdf(field, {
    min: [-0.18 * s, -0.17 * s, -0.06 * s],
    max: [0.18 * s, 0.1 * s, 0.06 * s],
    cell: Math.max(0.0048, 0.0068 * s),
    project: 1,
    colorFn: (x, y, z, mat) => bowColor(x, y, z, s, mat),
  });
}
