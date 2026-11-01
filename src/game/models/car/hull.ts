import * as THREE from 'three';
import { blend, ellipsoid, mirrorX, move, planeBelow, rotate, roundBox, subtract, union, type SdfNode } from '../kit/sdf';
import { meshSdf } from '../kit/mesher';
import { smoothstep } from '../kit/geo';
import { PAL } from '../kit/palette';
import { PBR } from './carMaterials';
import { ROLE_FIXED, ROLE_INTERIOR, ROLE_PAINT, type RecolorInfo } from './assembler';
import { bakeSdfAo, custom, xCylinder, zCylinder } from './sdfExtra';
import { decimate } from '../kit/decimate';
import { CAR, COVE } from './layout';

export interface HullBuild {
  geometry: THREE.BufferGeometry;
  pbr: Float32Array;
  recolor: RecolorInfo;
  /** Final body field (with carves) for placing trim on the surface. */
  field: SdfNode;
  /** Body before the cockpit carve. */
  shell: SdfNode;
  ms: number;
}

/** Monotone cubic interpolation through [x, y] control points (no overshoot). */
export function profile(points: Array<[number, number]>): (x: number) => number {
  const n = points.length;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const d: number[] = [];
  const m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i += 1) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i += 1) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i += 1) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x: number) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i += 1;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] +
      (t3 - 2 * t2 + t) * h * m[i] +
      (-2 * t3 + 3 * t2) * ys[i + 1] +
      (t3 - t2) * h * m[i + 1]
    );
  };
}

/** Body section frame at z: half width, top, bottom. */
export interface Frame {
  w: number;
  top: number;
  bot: number;
}

const Z_NOSE_TIP = -1.655;
const Z_TAIL_TIP = 1.52;
const Z_NOSE = -1.18;
const Z_TAIL = 1.06;
const NOSE_Y = 0.5;
const TAIL_Y = 0.55;
const BOTTOM = 0.22;
const HALF_W = 0.72;
const TIP_S = 0.985;
const CAP_K = 0.07;

function smax(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

const topLine = profile([
  [-1.66, 0.7],
  [-1.4, 0.76],
  [-1.05, 0.83],
  [-0.7, 0.89],
  [-0.42, 0.93],
  [0.1, 0.93],
  [0.6, 0.93],
  [0.95, 0.92],
  [1.25, 0.88],
  [1.52, 0.8],
]);

export function frameAt(z: number, out: Frame): Frame {
  let f = 1;
  let c = NOSE_Y;
  // The falloff stops just short of zero (no pinched tip); loftBody then meets the end-cap
  // planes with a smooth max, giving the nose and tail a soft, well-behaved rounded face.
  if (z < Z_NOSE) {
    const s = Math.min(TIP_S, (Z_NOSE - z) / (Z_NOSE - Z_NOSE_TIP));
    f = Math.pow(Math.max(0, 1 - Math.pow(s, 2.7)), 1 / 2.7);
    c = NOSE_Y;
  } else if (z > Z_TAIL) {
    const s = Math.min(TIP_S, (z - Z_TAIL) / (Z_TAIL_TIP - Z_TAIL));
    f = Math.pow(Math.max(0, 1 - Math.pow(s, 3.4)), 1 / 3.4);
    c = TAIL_Y;
  }
  const top = topLine(z);
  out.w = HALF_W * f;
  out.top = c + (top - c) * f;
  out.bot = c - (c - BOTTOM) * f;
  return out;
}

/** Lofted body: rounded-rectangle sections (rounder on top) with a hint of tumblehome. */
function loftBody(): SdfNode {
  const fr: Frame = { w: 0, top: 0, bot: 0 };
  return custom((x, y, z) => {
    const zc = Math.min(Z_TAIL_TIP, Math.max(Z_NOSE_TIP, z));
    frameAt(zc, fr);
    const hy = Math.max(1e-4, (fr.top - fr.bot) / 2);
    const cy = (fr.top + fr.bot) / 2;
    const v = Math.min(1, Math.max(0, (y - fr.bot) / (fr.top - fr.bot + 1e-6)));
    const xs = Math.abs(x) / (1 - 0.08 * v);
    const w = Math.max(1e-4, fr.w);
    const r = y > cy ? Math.min(0.34, w, hy) : Math.min(0.12, w, hy);
    const qx = xs - w + r;
    const qy = Math.abs(y - cy) - hy + r;
    const d = Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
    // Intersect with the end-cap planes using a smooth max: the nose and tail end in a
    // softly rounded, slightly flattened face (no hard crease for the mesher to mangle).
    return smax(smax(d, Z_NOSE_TIP - z, CAP_K), z - Z_TAIL_TIP, CAP_K);
  });
}

/** Cockpit carve (plan-view rounded rectangle), shared with the coaming trim. */
export const COCKPIT = { hx: 0.47, hy: 0.5, hz: 0.52, r: 0.2, cy: 0.92, cz: 0.14 } as const;

export interface HullParts {
  field: SdfNode;
  shell: SdfNode;
  cockpit: SdfNode;
}

export function hullField(): HullParts {
  const body0 = loftBody();
  // Long low fenders that flow into the body instead of bulging out of it.
  const fenderF = mirrorX(move(ellipsoid(0.27, 0.235, 0.68), 0.66, 0.6, CAR.axleF - 0.03));
  const fenderR = mirrorX(move(ellipsoid(0.28, 0.26, 0.7), 0.65, 0.6, CAR.axleR));
  const pods = mirrorX(move(zCylinder(0.12, 0.1, 0.05), 0.6, 0.72, -1.5));
  // A crowned hood, so the fenders and hood read as one clean surface with no dent between them.
  const hood = move(ellipsoid(0.56, 0.14, 0.74), 0, 0.72, -0.84);
  // Tail fins: the car's signature from the chase camera.
  const fin = mirrorX(move(rotate(ellipsoid(0.115, 0.17, 0.66), 0.2, 0, 0), 0.62, 0.82, 1.04));
  let body: SdfNode = blend(0.2, body0, fenderF, fenderR, hood);
  body = blend(0.08, body, pods);
  body = blend(0.15, body, fin);
  // Scooped side panels.
  const cove = mirrorX(move(ellipsoid(COVE.rx, COVE.ry, COVE.rz), COVE.x, COVE.y, COVE.z));
  body = subtract(body, cove, 0.05);

  // Wheel wells.
  // Front wells reach further in (room for the steered tire); rear wells are shallower.
  const well = (z: number, inner: number) => mirrorX(move(xCylinder(0.43, (1.3 - inner) / 2, 0.03), (1.3 + inner) / 2, CAR.wheelR, z));
  body = subtract(body, union(well(CAR.axleF, 0.52), well(CAR.axleR, 0.6)), 0.05);
  // Flat underside.
  body = subtract(body, planeBelow(BOTTOM), 0.05);
  const shell = body;

  // Open cockpit + footwell.
  const C = COCKPIT;
  const cockpitBox = move(roundBox(C.hx, C.hy, C.hz, C.r), 0, C.cy, C.cz);
  const footwell = move(roundBox(0.32, 0.15, 0.3, 0.1), 0, 0.57, -0.6);
  const cockpit = union(cockpitBox, footwell);
  body = subtract(body, cockpit, 0.07);
  return { field: body, shell, cockpit };
}

export function buildHull(cell = 0.03): HullBuild {
  const t0 = performance.now();
  const parts = hullField();
  const { field, shell, cockpit } = parts;
  const fine = meshSdf(field, {
    // The flat underside is never seen: start the grid just above it (saves ~20% triangles;
    // the body material casts shadows double-sided so the open bottom does not matter).
    min: [-1.08, BOTTOM + 0.018, -1.8],
    max: [1.08, 1.2, 1.8],
    cell,
    project: 2,
    colors: { 0: '#ffffff' },
  });
  fine.deleteAttribute('wind');
  // Meshed finely for the crisp edges, then reduced: normals come from the field, so the paint stays smooth.
  const geometry = decimate(fine, 16000);
  const pos = geometry.attributes.position.array as Float32Array;
  const nor = geometry.attributes.normal.array as Float32Array;
  const n = pos.length / 3;

  // AO field: body plus rough stand-ins for wheels and seat so wells and the cockpit darken.
  const wheels = union(
    mirrorX(move(xCylinder(CAR.wheelR, CAR.wheelW / 2, 0.06), CAR.trackX, CAR.wheelR, CAR.axleF)),
    mirrorX(move(xCylinder(CAR.wheelR, CAR.wheelW / 2, 0.06), CAR.trackX, CAR.wheelR, CAR.axleR)),
  );
  const seat = move(roundBox(0.3, 0.2, 0.24, 0.08), 0, 0.5, 0.28);
  const aoField = union(field, wheels, seat);
  const ao = bakeSdfAo(pos, nor, aoField, { step: 0.05, samples: 5, strength: 1.0, minAo: 0.45 });

  const role = new Uint8Array(n);
  const t = new Float32Array(n);
  const k = new Float32Array(n);
  const pbr = new Float32Array(n * 4);
  const col = geometry.attributes.color.array as Float32Array;
  const paint = new THREE.Color(PAL.carPaint);
  const deep = new THREE.Color(PAL.carPaintDeep);
  const interior = new THREE.Color(PAL.carInterior);
  const recess = new THREE.Color('#7a3462');
  const c = new THREE.Color();
  const c2 = new THREE.Color();
  const lerp4 = (a: readonly number[], b: readonly number[], w: number, o: number) => {
    for (let j = 0; j < 4; j += 1) pbr[o + j] = a[j] + (b[j] - a[j]) * w;
  };
  for (let i = 0; i < n; i += 1) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    const a = ao[i];
    // Interior weight: how much the cockpit carve dominates the outer shell here.
    const gIn = -cockpit.d(x, y, z) - shell.d(x, y, z);
    const wIn = smoothstep(-0.012, 0.012, gIn);
    // Wheel-well weight from distance to the nearest axle.
    const dz = Math.min(Math.abs(z - CAR.axleF), Math.abs(z - CAR.axleR));
    const rAx = Math.hypot(y - CAR.wheelR, dz);
    const wWell = Math.abs(x) > 0.46 ? smoothstep(0.445, 0.425, rAx) : 0;
    const wRec = wWell;

    const tt = 0.22 + 0.78 * smoothstep(0.24, 0.84, y);
    // Outer paint gets a gentler AO than the cockpit and wells (keeps the flanks clean).
    const aPaint = 1 - (1 - a) * 0.7;
    const ak = aPaint + (a - aPaint) * Math.max(wIn, wRec);
    c.copy(deep).lerp(paint, tt);
    c.lerp(c2.copy(interior), wIn);
    c.lerp(c2.copy(recess), wRec);
    c.multiplyScalar(ak);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;

    lerp4(PBR.paint, PBR.interior, wIn, i * 4);
    if (wRec > 0) {
      const base = [pbr[i * 4], pbr[i * 4 + 1], pbr[i * 4 + 2], pbr[i * 4 + 3]];
      lerp4(base, PBR.recess, wRec, i * 4);
    }
    // Downward-facing paint reflects less (keeps the underside from mirroring the ground).
    const ny = nor[i * 3 + 1];
    const spec = smoothstep(-0.75, 0.2, ny) * (0.35 + 0.65 * a);
    pbr[i * 4 + 2] *= spec;
    pbr[i * 4 + 3] *= spec;

    if (wRec > 0.5) {
      role[i] = ROLE_FIXED;
    } else if (wIn > 0.5) {
      role[i] = ROLE_INTERIOR;
    } else {
      role[i] = ROLE_PAINT;
    }
    t[i] = tt;
    k[i] = ak;
  }
  return { geometry, pbr, recolor: { role, t, k }, field, shell, ms: performance.now() - t0 };
}
