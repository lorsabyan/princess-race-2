import * as THREE from 'three';
import {
  blend,
  capsule,
  displace,
  ellipsoid,
  intersect,
  move,
  rotate,
  roundBox,
  sphere,
  subtract,
  type SdfNode,
} from '../kit/sdf';
import { meshSdf } from '../kit/mesher';
import { PAL } from '../kit/palette';
import { boundedTube, stretch } from './sdfx';
import { ELBOW_Y, HIP, SHOULDER, STAND_HEIGHT, WRIST_Y } from './rigSpec';

export const DRESS_ACCENT = '#f25f98';
const TRIM = '#fff4f6';

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Bodice
// ---------------------------------------------------------------------------

export function bodiceField(): SdfNode {
  const torso = blend(
    0.07,
    stretch(capsule(0, 0.29, 0, 0, 0.43, 0, 0.1), 1, 1, 0.82),
    move(ellipsoid(0.126, 0.08, 0.1), 0, 0.435, -0.004),
    move(ellipsoid(0.142, 0.052, 0.088), 0, 0.502, 0.006),
  );
  // Neck opening.
  return subtract(torso, capsule(0, 0.49, 0.004, 0, 0.72, 0.012, 0.05), 0.014);
}

export function buildBodice(): THREE.BufferGeometry {
  const base = new THREE.Color(PAL.dress);
  const light = new THREE.Color(PAL.dressLight);
  const deep = new THREE.Color(PAL.dressDeep);
  return meshSdf(bodiceField(), {
    min: [-0.18, 0.22, -0.13],
    max: [0.18, 0.57, 0.13],
    cell: 0.0095,
    project: 1,
    colorFn: (x, y, z) => {
      // Lighter front panel with deeper side seams, like a stomacher.
      const panel = (1 - smooth(0.038, 0.05, Math.abs(x))) * smooth(0.0, -0.05, z);
      const c = base.clone().lerp(light, panel * 0.55);
      const seam = Math.exp(-Math.pow((Math.abs(x) - 0.05) / 0.005, 2)) * smooth(0.0, -0.05, z);
      c.lerp(deep, seam * 0.5);
      // Slight darkening toward the waist.
      c.multiplyScalar(0.9 + 0.1 * smooth(0.27, 0.4, y));
      return c;
    },
  });
}

// ---------------------------------------------------------------------------
// Puffy sleeves (one mesh per side so each follows its shoulder bone)
// ---------------------------------------------------------------------------

export function sleeveField(side: number): SdfNode {
  const cx = side * (SHOULDER[0] + 0.014);
  const cy = SHOULDER[1] - 0.018;
  const puff = move(ellipsoid(0.079, 0.071, 0.077), cx, cy, 0.002);
  // Gathered pleats radiating from the shoulder top.
  return displace(puff, (x, y, z) => {
    const a = Math.atan2(z - 0.002, (x - cx) * side);
    const top = smooth(cy + 0.07, cy - 0.02, y); // fade near the top gather
    return 0.0045 * Math.pow(0.5 + 0.5 * Math.cos(a * 9), 2) * top;
  });
}

export function buildSleeve(side: number): THREE.BufferGeometry {
  const light = new THREE.Color(PAL.dressLight);
  const base = new THREE.Color(PAL.dress);
  const cx = side * (SHOULDER[0] + 0.014);
  return meshSdf(sleeveField(side), {
    min: [cx - 0.095, SHOULDER[1] - 0.105, -0.095],
    max: [cx + 0.095, SHOULDER[1] + 0.07, 0.095],
    cell: 0.0075,
    project: 1,
    colorFn: (x, y, z) => {
      const a = Math.atan2(z - 0.002, (x - cx) * side);
      const groove = Math.pow(0.5 + 0.5 * Math.cos(a * 9), 2);
      return light.clone().lerp(base, 0.25 + groove * 0.45 * smooth(SHOULDER[1] + 0.05, SHOULDER[1] - 0.02, y));
    },
  });
}

/** Ruffled ring (collar, cuffs): torus in XZ with a wavy tube. */
export function ruffleRing(R: number, r: number, waves: number, amp: number, radial = 10, tubular = 64): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(R, r, radial, tubular);
  g.rotateX(Math.PI / 2);
  const pos = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    v.fromBufferAttribute(pos, i);
    const a = Math.atan2(v.z, v.x);
    const w = Math.sin(a * waves);
    const rad = Math.hypot(v.x, v.z);
    const k = (rad + w * amp) / rad;
    pos.setXYZ(i, v.x * k, v.y + Math.cos(a * waves) * amp * 0.6, v.z * k);
  }
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// Skirt: parametric bell with soft folds, scalloped hem and a rolled edge.
// ---------------------------------------------------------------------------

interface RingSurfaceOpts {
  segments: number;
  rows: number;
  /** Point on the surface for angle a (0 = front, -Z) and row parameter t. */
  at: (a: number, t: number) => [number, number, number];
  color: (a: number, t: number) => THREE.Color;
}

/** Closed-around-Y grid surface (shared seam vertices so normals stay smooth). */
function ringSurface(o: RingSurfaceOpts): THREE.BufferGeometry {
  const { segments: N, rows: M } = o;
  const pos = new Float32Array(N * (M + 1) * 3);
  const col = new Float32Array(N * (M + 1) * 3);
  for (let j = 0; j <= M; j += 1) {
    const t = j / M;
    for (let i = 0; i < N; i += 1) {
      const a = (i / N) * Math.PI * 2;
      const p = o.at(a, t);
      const k = (j * N + i) * 3;
      pos[k] = p[0];
      pos[k + 1] = p[1];
      pos[k + 2] = p[2];
      const c = o.color(a, t);
      col[k] = c.r;
      col[k + 1] = c.g;
      col[k + 2] = c.b;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < M; j += 1) {
    for (let i = 0; i < N; i += 1) {
      const a = j * N + i;
      const b = j * N + ((i + 1) % N);
      const c = (j + 1) * N + ((i + 1) % N);
      const d = (j + 1) * N + i;
      // Outward-facing winding (rows go down, angle turns from front toward +X).
      idx.push(a, b, d, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const SCALLOPS = 8;
const WAIST_Y = 0.282;
const HEM_Y = -0.075;

function scallop(a: number): number {
  // 0 at the cusps between scallops, 1 at their centers.
  const ph = (((a * SCALLOPS) / (Math.PI * 2)) % 1 + 1) % 1;
  return Math.pow(Math.sin(ph * Math.PI), 0.55);
}

/** Bell radius at row parameter t (0 waist .. 1 hem). */
function bellRadius(t: number): number {
  return 0.108 + 0.228 * (1 - Math.pow(1 - t, 2.3)) + 0.012 * t * t;
}

export function buildSkirt(): THREE.BufferGeometry {
  const base = new THREE.Color(PAL.dress);
  const light = new THREE.Color(PAL.dressLight);
  const deep = new THREE.Color(PAL.dressDeep);
  const trim = new THREE.Color(TRIM);
  const inner = new THREE.Color('#d9669a');
  const fold = (a: number) => Math.cos(a * SCALLOPS + Math.PI); // valleys at scallop cusps
  const edgeRows = [0.35, 0.7, 1.0]; // lip curling under the hem
  const bodyRows = 26;
  // Denser rows toward the hem so the trim band stays crisp.
  const rowT = (s: number) => s * 0.6 + (1 - (1 - s) * (1 - s)) * 0.4;
  const M = bodyRows + edgeRows.length;
  return ringSurface({
    segments: 128,
    rows: M,
    at: (a, tt) => {
      const row = tt * M;
      const sc = scallop(a);
      const hem = HEM_Y - 0.032 * sc;
      const outward: [number, number] = [Math.sin(a), -Math.cos(a)];
      if (row <= bodyRows + 1e-6) {
        const t = rowT(row / bodyRows);
        const y = WAIST_Y + (hem - WAIST_Y) * t;
        const fr = 1 + 0.045 * Math.pow(t, 1.4) * fold(a);
        const r = bellRadius(t) * fr;
        return [outward[0] * r, y, outward[1] * r];
      }
      // Rolled lip: curls under and back up inside.
      const e = edgeRows[Math.min(edgeRows.length - 1, Math.round(row - bodyRows - 1))] ?? 1;
      const fr = 1 + 0.045 * fold(a);
      const r0 = bellRadius(1) * fr;
      const ang = e * Math.PI;
      const rr = r0 - 0.009 * (1 - Math.cos(ang));
      const y = hem - 0.009 * Math.sin(ang) + (e > 0.99 ? 0.03 : 0);
      return [outward[0] * rr, y, outward[1] * rr];
    },
    color: (a, tt) => {
      const row = tt * M;
      if (row > bodyRows + 1.5) return inner;
      const t = rowT(Math.min(1, row / bodyRows));
      const c = light.clone().lerp(base, smooth(0.0, 0.35, t));
      // Folds: deeper in the valleys, lighter on the crests.
      const f = fold(a);
      c.lerp(deep, Math.max(0, -f) * 0.4 * smooth(0.1, 0.8, t));
      c.lerp(light, Math.max(0, f) * 0.25 * smooth(0.2, 0.9, t));
      // White trim band following the scallops.
      const sc = scallop(a);
      const hemRow = 1 - (0.028 + 0.012 * sc) / 0.38;
      c.lerp(trim, smooth(hemRow - 0.02, hemRow + 0.015, t));
      return c;
    },
  });
}

/**
 * Little heart appliques on the skirt's fold crests (root space position + outward
 * normal), placed between the waist and the hem.
 */
export function skirtHeartSpots(): Array<{ p: [number, number, number]; n: [number, number, number] }> {
  const out: Array<{ p: [number, number, number]; n: [number, number, number] }> = [];
  const t = 0.56;
  const y = WAIST_Y + (HEM_Y - 0.03 - WAIST_Y) * t;
  for (let k = 0; k < SCALLOPS; k += 1) {
    const a = ((k + 0.5) / SCALLOPS) * Math.PI * 2; // crest angle
    const r = bellRadius(t) * (1 + 0.045 * Math.pow(t, 1.4)) + 0.004;
    // Surface slope of the bell at t for the normal.
    const dr = (bellRadius(t + 0.02) - bellRadius(t - 0.02)) / 0.04;
    const dy = HEM_Y - 0.03 - WAIST_Y;
    const nr = -dy;
    const ny = dr;
    const nl = Math.hypot(nr, ny);
    out.push({
      p: [Math.sin(a) * r, y, -Math.cos(a) * r],
      n: [(Math.sin(a) * nr) / nl, ny / nl, (-Math.cos(a) * nr) / nl],
    });
  }
  return out;
}

/** Pearl positions at the scallop cusps of the hem (root space). */
export function skirtHemCusps(): Array<[number, number, number]> {
  const out: Array<[number, number, number]> = [];
  for (let k = 0; k < SCALLOPS; k += 1) {
    const a = (k / SCALLOPS) * Math.PI * 2;
    const r = bellRadius(1) * (1 - 0.045) + 0.004;
    out.push([Math.sin(a) * r, HEM_Y + 0.004, -Math.cos(a) * r]);
  }
  return out;
}

export function buildPetticoat(): THREE.BufferGeometry {
  const white = new THREE.Color('#fff2f6');
  const pink = new THREE.Color(PAL.dressLight);
  const waves = 26;
  return ringSurface({
    segments: 156,
    rows: 7,
    at: (a, t) => {
      const w = Math.sin(a * waves);
      const y = 0.0 + (-0.14 - 0.0) * t + 0.006 * Math.cos(a * waves) * t;
      const r = (0.29 + 0.047 * t) * (1 + 0.02 * w * (0.4 + t)) - (t > 0.99 ? 0.012 : 0);
      return [Math.sin(a) * r, y - (t > 0.99 ? 0.004 : 0), -Math.cos(a) * r];
    },
    color: (a, t) => white.clone().lerp(pink, (0.5 + 0.5 * Math.sin(a * waves)) * 0.4 * t),
  });
}

// ---------------------------------------------------------------------------
// Seated lap (replaces the bell skirt in the car)
// ---------------------------------------------------------------------------

export function buildLap(): THREE.BufferGeometry {
  // Skirt pooled on the seat: hips under the waist, a soft mound over the thighs
  // and a ruffled edge at the knees. Flat underneath (sits on the cushion).
  const field = blend(
    0.08,
    move(ellipsoid(0.135, 0.15, 0.115), 0, 0.2, 0.0),
    move(ellipsoid(0.2, 0.1, 0.2), 0, 0.095, -0.08),
    move(ellipsoid(0.175, 0.075, 0.1), 0, 0.08, -0.27),
  );
  const folded = displace(field, (x, _y, z) => 0.004 * Math.cos(x * 70) * smooth(0.0, -0.2, z));
  const base = new THREE.Color(PAL.dress);
  const light = new THREE.Color(PAL.dressLight);
  const trim = new THREE.Color(TRIM);
  return meshSdf(intersect(folded, move(roundBox(0.4, 0.2, 0.4, 0.01), 0, 0.2, -0.1)), {
    min: [-0.24, -0.02, -0.4],
    max: [0.24, 0.37, 0.15],
    cell: 0.014,
    project: 1,
    colorFn: (x, y, z) => {
      void x;
      const c = light.clone().lerp(base, smooth(0.26, 0.16, y));
      return c.lerp(trim, smooth(-0.33, -0.36, z));
    },
  });
}

// ---------------------------------------------------------------------------
// Sash and back bow
// ---------------------------------------------------------------------------

export function buildSash(): THREE.BufferGeometry {
  const profile: Array<[number, number]> = [
    [0.1, 0.252],
    [0.109, 0.255],
    [0.113, 0.267],
    [0.113, 0.286],
    [0.108, 0.298],
    [0.098, 0.3],
  ];
  const g = new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    56,
  );
  g.scale(1.02, 1, 0.86);
  g.deleteAttribute('uv');
  return g;
}

// ---------------------------------------------------------------------------
// Legs and shoes
// ---------------------------------------------------------------------------

const FOOT_Y = -STAND_HEIGHT;

export function buildLeg(side: number): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(
    [
      [0.0, FOOT_Y + 0.04],
      [0.029, FOOT_Y + 0.05],
      [0.034, -0.12],
      [0.04, -0.08],
      [0.042, 0.03],
      [0.03, 0.062],
      [0.0, 0.07],
    ].map(([r, y]) => new THREE.Vector2(r, y)),
    14,
  );
  g.translate(side * HIP[0], 0, HIP[2]);
  g.deleteAttribute('uv');
  return g;
}

export function shoeField(side: number): SdfNode {
  const x = side * (HIP[0] + 0.004);
  const body = move(ellipsoid(0.043, 0.036, 0.066), x, FOOT_Y + 0.034, -0.02);
  const flat = intersect(body, move(roundBox(0.1, 0.1, 0.12, 0.004), x, FOOT_Y + 0.1, -0.02));
  const sole = move(roundBox(0.043, 0.008, 0.066, 0.007), x, FOOT_Y + 0.008, -0.02);
  const opening = move(ellipsoid(0.03, 0.03, 0.036), x, FOOT_Y + 0.07, 0.006);
  const shoe = subtract(blend(0.01, flat, sole), opening, 0.008, 1);
  const strap = move(stretch(capsule(-0.036, 0, 0, 0.036, 0, 0, 0.007), 1, 1, 1.4), x, FOOT_Y + 0.058, -0.028);
  const button = move(sphere(0.008, 2), x + side * 0.034, FOOT_Y + 0.052, -0.026);
  return blend(0.004, shoe, strap, button);
}

// ---------------------------------------------------------------------------
// Arms (skin): shoulder ball, tapered arm and a mitten hand, hanging straight
// down in the bind pose, palm facing the body, thumb forward.
// ---------------------------------------------------------------------------

export function armField(side: number): SdfNode {
  const x = side * SHOULDER[0];
  const upper = boundedTube(
    [
      [x, SHOULDER[1] - 0.005, 0, 0.046],
      [x, ELBOW_Y, 0, 0.039],
      [x, WRIST_Y + 0.004, 0, 0.033],
    ],
    0.024,
  );
  const hy = WRIST_Y - 0.048;
  const mitten = move(ellipsoid(0.031, 0.053, 0.044), x - side * 0.002, hy, -0.004);
  const thumb = move(rotate(ellipsoid(0.016, 0.028, 0.017), 0.55, 0, 0), x - side * 0.011, hy + 0.013, -0.035);
  return blend(0.02, upper, blend(0.012, mitten, thumb));
}

export function buildArm(side: number): THREE.BufferGeometry {
  const x = side * SHOULDER[0];
  return meshSdf(armField(side), {
    min: [x - 0.065, WRIST_Y - 0.11, -0.075],
    max: [x + 0.065, SHOULDER[1] + 0.055, 0.065],
    cell: 0.0075,
    project: 1,
    colors: { 0: '#ffffff' },
  });
}

/** Neck (skin). */
export function buildNeck(): THREE.BufferGeometry {
  return meshSdf(capsule(0, 0.49, 0.006, 0, 0.66, 0.012, 0.047), {
    min: [-0.07, 0.43, -0.07],
    max: [0.07, 0.72, 0.08],
    cell: 0.011,
    project: 1,
    colors: { 0: '#ffffff' },
  });
}

export function buildShoe(side: number): THREE.BufferGeometry {
  const pink = new THREE.Color('#ff6aa8');
  const sole = new THREE.Color('#fff3f6');
  const inside = new THREE.Color('#d24a86');
  const x = side * (HIP[0] + 0.004);
  return meshSdf(shoeField(side), {
    min: [x - 0.06, FOOT_Y - 0.01, -0.1],
    max: [x + 0.06, FOOT_Y + 0.085, 0.06],
    cell: 0.0055,
    project: 1,
    colorFn: (px, y, _z, mat) => {
      void px;
      if (mat === 1) return inside;
      if (mat === 2) return '#ffe9a8';
      if (y < FOOT_Y + 0.013) return sole;
      return pink;
    },
  });
}

/** Pearl positions for the necklace (root space) + the pendant anchor. */
export function necklacePoints(): { pearls: Array<[number, number, number]>; pendant: [number, number, number] } {
  const field = bodiceField();
  const pearls: Array<[number, number, number]> = [];
  const n = 13;
  const project = (x: number, y: number, z: number, lift: number): [number, number, number] => {
    // March inward from outside until we hit the bodice's outer surface.
    const dir = new THREE.Vector3(x, 0, z).normalize();
    const p = new THREE.Vector3(0, y, 0.004).addScaledVector(dir, 0.25);
    for (let i = 0; i < 400; i += 1) {
      if (field.d(p.x, p.y, p.z) < 0) break;
      p.addScaledVector(dir, -0.001);
    }
    p.addScaledVector(dir, lift);
    return [p.x, p.y, p.z];
  };
  for (let i = 0; i < n; i += 1) {
    const phi = ((i / (n - 1)) * 2 - 1) * 1.72;
    const x = Math.sin(phi);
    const z = -Math.cos(phi);
    const y = 0.528 - 0.03 * (0.5 + 0.5 * Math.cos(phi));
    pearls.push(project(x, y, z, 0.0055));
  }
  const pendant = project(0, 0.482, -1, 0.006);
  return { pearls, pendant };
}
