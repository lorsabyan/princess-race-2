import * as THREE from 'three';
import {
  PartBuilder,
  blob,
  extrude,
  heartShape,
  rbox,
  smoothstep,
  sphere,
  tube,
  valueNoise3,
  type Vec3,
} from '../kit/geo';
import { meshOf } from '../kit/materials';
import { PAL } from '../kit/palette';

/**
 * Landmark modeling kit: storybook architecture parts (round towers, flared
 * shingle roofs, onion domes, finials, arched windows, merlons, garlands,
 * flower clusters) built on the shared PartBuilder so each landmark renders
 * as one merged mesh per material role.
 */

export type Role = 'matte' | 'stone' | 'satin' | 'gloss' | 'metal' | 'glass' | 'glow' | 'foliage' | 'matteWind';
export type Col = THREE.ColorRepresentation;

/** One PartBuilder per material role. */
export class Bag {
  private readonly map = new Map<Role, PartBuilder>();

  get(role: Role): PartBuilder {
    let b = this.map.get(role);
    if (!b) {
      b = new PartBuilder();
      this.map.set(role, b);
    }
    return b;
  }

  get matte(): PartBuilder { return this.get('matte'); }
  get stone(): PartBuilder { return this.get('stone'); }
  get satin(): PartBuilder { return this.get('satin'); }
  get gloss(): PartBuilder { return this.get('gloss'); }
  get metal(): PartBuilder { return this.get('metal'); }
  get glass(): PartBuilder { return this.get('glass'); }
  get glow(): PartBuilder { return this.get('glow'); }
  get foliage(): PartBuilder { return this.get('foliage'); }

  /** Merge every role into one mesh, named `${prefix}${Role}` (e.g. castleMatte). */
  build(prefix: string, root: THREE.Object3D, noShadow: Role[] = ['glow']): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [role, b] of this.map) {
      if (b.isEmpty) continue;
      const cast = !noShadow.includes(role);
      const mesh = meshOf(b.build(), role, { cast, receive: role !== 'glow' });
      if (!mesh) continue;
      mesh.name = `${prefix}${role[0].toUpperCase()}${role.slice(1)}`;
      root.add(mesh);
      out.push(mesh);
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

const tmpA = new THREE.Color();
const tmpB = new THREE.Color();

export function mix(a: Col, b: Col, t: number): THREE.Color {
  return new THREE.Color(a).lerp(tmpB.set(b), t);
}

/** Color fn: `base` lightening toward `top` between world heights y0..y1 (painterly lift). */
export function vgrad(base: Col, y0: number, y1: number, lift = 0.14, top: Col = '#fff6f0'): (x: number, y: number) => number {
  const a = new THREE.Color(base);
  const b = new THREE.Color(top);
  const c = new THREE.Color();
  return (_x: number, y: number) => c.copy(a).lerp(b, lift * smoothstep(y0, y1, y)).getHex();
}

// ---------------------------------------------------------------------------
// Lathes
// ---------------------------------------------------------------------------

/** [radius, y, color?] — a missing color inherits the previous ring's color. */
export type Ring = [number, number, Col?];

export interface LatheOpts {
  segments?: number;
  phiStart?: number;
  phiLength?: number;
  shade?: { y0: number; y1: number; k: number };
}

/**
 * Lathe with one color per profile ring. Repeating a point (same r, y) makes a
 * hard edge (and a crisp color change); tiny segments between long ones read
 * as sculpted bevels because three.js weights lathe normals by segment length.
 */
export function latheRings(rings: Ring[], opts: LatheOpts = {}): THREE.BufferGeometry {
  const pts = rings.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y));
  const g = new THREE.LatheGeometry(pts, opts.segments ?? 32, opts.phiStart ?? 0, opts.phiLength ?? Math.PI * 2);
  g.deleteAttribute('uv');
  const n = pts.length;
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const count = pos.count;
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i += 1) {
    v.fromBufferAttribute(nor, i);
    if (v.lengthSq() > 0) v.normalize();
    nor.setXYZ(i, v.x, v.y, v.z);
  }
  const cols: THREE.Color[] = [];
  let last = new THREE.Color('#ffffff');
  for (const ring of rings) {
    if (ring[2] !== undefined) last = new THREE.Color(ring[2]);
    cols.push(last);
  }
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const c = cols[i % n];
    let k = 1;
    if (opts.shade) k = opts.shade.k + (1 - opts.shade.k) * smoothstep(opts.shade.y0, opts.shade.y1, pos.getY(i));
    colors[i * 3] = c.r * k;
    colors[i * 3 + 1] = c.g * k;
    colors[i * 3 + 2] = c.b * k;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('wind', new THREE.BufferAttribute(new Float32Array(count), 1));
  return g;
}

/** Smooth a sparse [r, y] profile with a Catmull-Rom spline, then color it by height. */
export function smoothRings(pts: Array<[number, number]>, samples: number, color: (t: number, y: number) => Col): Ring[] {
  const curve = new THREE.SplineCurve(pts.map(([r, y]) => new THREE.Vector2(r, y)));
  const out: Ring[] = [];
  const sp = curve.getSpacedPoints(samples);
  sp.forEach((p, i) => out.push([Math.max(0, p.x), p.y, color(i / (sp.length - 1), p.y)]));
  return out;
}

// ---------------------------------------------------------------------------
// Towers
// ---------------------------------------------------------------------------

export interface TowerSpec {
  r: number;
  /** Height of the plain shaft (corbel starts here), above base. */
  h: number;
  base?: number;
  taper?: number;
  plinthH?: number;
  plinthOut?: number;
  corbelH?: number;
  flare?: number;
  /** Attic/parapet ring above the corbel. */
  capH?: number;
  wall: Col;
  trim: Col;
  stone: Col;
  segments?: number;
  /** Trim band heights (relative to base). */
  bands?: number[];
  /** Number of little corbel brackets under the flare. */
  brackets?: number;
  /** Skip the plinth (towers that start on a roof). */
  noPlinth?: boolean;
  /** Rotate the lathe seam away from the viewer. */
  seamPhi?: number;
}

export interface TowerTop {
  /** y of the top of the tower (where a roof sits). */
  y: number;
  /** Outer radius at the top. */
  r: number;
  /** Radius of the plain shaft at mid height. */
  shaftR: number;
  /** y range of the attic ring (for windows). */
  capY0: number;
  capY1: number;
}

export function roundTower(bag: Bag, x: number, z: number, o: TowerSpec): TowerTop {
  const base = o.base ?? 0;
  const r0 = o.r;
  const r1 = o.r * (o.taper ?? 0.97);
  const ph = o.noPlinth ? 0 : (o.plinthH ?? 1.0);
  const po = o.plinthOut ?? 0.3;
  const ch = o.corbelH ?? 0.7;
  const fl = o.flare ?? 0.42;
  const cap = o.capH ?? 0.9;
  const rf = r1 + fl;
  const y1 = o.h;
  const seg = o.segments ?? 32;
  // Painterly lift: shafts lighten slightly toward the top.
  const wallTop = mix(o.wall, '#fff6f0', 0.14);
  const rings: Ring[] = [];
  if (!o.noPlinth) {
    rings.push(
      [r0 + po, -0.2, o.stone],
      [r0 + po, ph - 0.12],
      [r0 + po - 0.1, ph],
      [r0 + 0.02, ph + 0.04],
      [r0, ph + 0.05, o.wall],
    );
  } else {
    rings.push([r0, -0.3, o.wall]);
  }
  rings.push(
    [r1, y1, wallTop],
    [r1, y1, o.trim],
    [r1 + fl * 0.08, y1 + ch * 0.2],
    [r1 + fl * 0.45, y1 + ch * 0.62],
    [rf - 0.02, y1 + ch - 0.07],
    [rf, y1 + ch],
    [rf, y1 + ch, wallTop],
    [rf, y1 + ch + cap - 0.14],
    [rf, y1 + ch + cap - 0.14, o.trim],
    [rf + 0.09, y1 + ch + cap - 0.07],
    [rf + 0.06, y1 + ch + cap],
    [rf - 0.4, y1 + ch + cap + 0.02],
  );
  const g = latheRings(rings, { segments: seg, phiStart: o.seamPhi ?? Math.PI, shade: { y0: -0.2, y1: 3.2, k: 0.78 } });
  bag.matte.addColored(g, { p: [x, base, z] });

  const band = new THREE.TorusGeometry(1, 0.07, 5, seg);
  for (const by of o.bands ?? []) {
    const t = by / Math.max(1e-3, y1);
    const rr = r0 + (r1 - r0) * t + 0.015;
    bag.matte.add(band, o.trim, { p: [x, base + by, z], r: [Math.PI / 2, 0, 0], s: [rr, rr, 1] });
  }
  if (o.brackets) {
    const br = new THREE.BoxGeometry(0.24, 0.5, 0.36);
    for (let i = 0; i < o.brackets; i += 1) {
      const a = (i / o.brackets) * Math.PI * 2 + Math.PI / o.brackets;
      bag.matte.add(br, o.trim, {
        p: [x + Math.sin(a) * (r1 + 0.1), base + y1 - 0.12, z + Math.cos(a) * (r1 + 0.1)],
        r: [0, a, 0],
      });
    }
  }
  return { y: base + y1 + ch + cap, r: rf + 0.09, shaftR: (r0 + r1) / 2, capY0: base + y1 + ch, capY1: base + y1 + ch + cap - 0.14 };
}

// ---------------------------------------------------------------------------
// Roofs
// ---------------------------------------------------------------------------

export interface ConeRoofSpec {
  /** Eave radius. */
  R: number;
  H: number;
  color: Col;
  /** Alternate tile row color (defaults to a slightly lighter color). */
  color2?: Col;
  /** Tile rows. */
  rows?: number;
  /** Profile exponent (>1 = concave witch hat). */
  p?: number;
  /** Eave flare amount (0..0.3). */
  kick?: number;
  segments?: number;
  /** Tile step size. */
  step?: number;
}

/** Flared conical roof with overlapping shingle rows and a closed soffit. */
export function coneRoof(o: ConeRoofSpec): THREE.BufferGeometry {
  const rows = o.rows ?? Math.max(3, Math.round(o.H / 0.78));
  const p = o.p ?? 1.25;
  const kick = o.kick ?? 0.14;
  const step = o.step ?? 0.07;
  const c1 = new THREE.Color(o.color);
  const c2 = o.color2 !== undefined ? new THREE.Color(o.color2) : c1.clone().lerp(new THREE.Color('#ffffff'), 0.06);
  const under = c1.clone().multiplyScalar(0.62);
  const r = (t: number) => o.R * (Math.pow(1 - t, p) * (1 - kick) + kick * Math.pow(1 - t, 9));
  const y = (t: number) => 0.14 + t * (o.H - 0.14);
  const colOf = (k: number) => (k % 2 === 0 ? c1 : c2);
  const rings: Ring[] = [
    [o.R * 0.7, 0.55, under],
    [o.R + step * 0.3, -0.05, under],
    [o.R + step * 0.3, -0.05, c1],
  ];
  for (let k = 0; k < rows; k += 1) {
    const t0 = k / rows;
    const t1 = (k + 1) / rows;
    const col = colOf(k);
    const s = step * (0.5 + 0.5 * (1 - t0));
    const ax = r(t0) + s;
    const ay = y(t0);
    // Lip of this tile row; the ledge below it shades from dark (hard edge at its root) to lit.
    rings.push([ax, ay, col]);
    if (k === rows - 1) break;
    const bx = r(t1) + 0.004;
    const by = y(t1);
    rings.push([bx, by, col], [bx, by, colOf(k + 1)]);
  }
  rings.push([o.R * 0.015, o.H - 0.02], [0, o.H]);
  return latheRings(rings, { segments: o.segments ?? 32, phiStart: Math.PI });
}

export interface HipRoofSpec {
  /** Half extents of the eave outline (x, z). */
  hw: number;
  hd: number;
  /** Corner radius at the eave (soft, toy-like corners). */
  r: number;
  H: number;
  color: Col;
  color2?: Col;
  rows?: number;
  /** Mansard break: inset and height where the steep lower slope meets the gentle top. */
  breakInset?: number;
  breakH?: number;
  /** Eave kick (fraction of the break inset spent right at the eave). */
  kick?: number;
  step?: number;
  /** Points per corner arc. */
  arc?: number;
}

/**
 * Rounded hip / mansard roof swept around a rounded rectangle, with the same
 * overlapping shingle rows as coneRoof. The top collapses to a ridge along the
 * longer axis. Base (eave) at y = 0, centered on the origin.
 */
export function hipRoof(o: HipRoofSpec): THREE.BufferGeometry {
  const rows = o.rows ?? Math.max(3, Math.round(o.H / 0.62));
  const ridge = Math.min(o.hw, o.hd);
  const bi = o.breakInset ?? ridge * 0.45;
  const bh = o.breakH ?? o.H * 0.62;
  const kick = o.kick ?? 0.3;
  const step = o.step ?? 0.07;
  const arc = o.arc ?? 5;
  const c1 = new THREE.Color(o.color);
  const c2 = o.color2 !== undefined ? new THREE.Color(o.color2) : c1.clone().lerp(new THREE.Color('#ffffff'), 0.06);
  const under = c1.clone().multiplyScalar(0.62);
  // Profile: t in [0,1] -> [inset, y]. Lower slope flares at the eave, upper slope runs to the ridge.
  const tb = bh / o.H;
  const prof = (t: number): [number, number] => {
    if (t <= tb) {
      const u = t / tb;
      return [bi * (kick * (1 - Math.pow(1 - u, 5)) + (1 - kick) * u), 0.12 + (bh - 0.12) * u];
    }
    const v = (t - tb) / (1 - tb);
    return [bi + (ridge - bi) * Math.pow(v, 0.9), bh + (o.H - bh) * v];
  };
  const rings: Array<[number, number, THREE.Color]> = [
    [0.9, 0.5, under],
    [-step * 0.3, -0.05, under],
    [-step * 0.3, -0.05, c1],
  ];
  const colOf = (k: number) => (k % 2 === 0 ? c1 : c2);
  for (let k = 0; k < rows; k += 1) {
    const [i0, y0] = prof(k / rows);
    const s = step * (0.5 + 0.5 * (1 - k / rows));
    rings.push([i0 - s, y0, colOf(k)]);
    if (k === rows - 1) break;
    const [i1, y1] = prof((k + 1) / rows);
    rings.push([i1 - 0.004, y1, colOf(k)], [i1 - 0.004, y1, colOf(k + 1)]);
  }
  rings.push([ridge, o.H, colOf(rows - 1)]);

  // Rounded-rectangle loop, parametrized like LatheGeometry (x = sin, z = cos) so winding matches.
  const P = arc * 4;
  const loop = (inset: number, out: Array<[number, number]>) => {
    out.length = 0;
    const ex = Math.max(0, o.hw - inset);
    const ez = Math.max(0, o.hd - inset);
    const rc = Math.max(0, Math.min(o.r - inset * 0.55, ex, ez));
    const corners: Array<[number, number]> = [
      [ex - rc, ez - rc],
      [ex - rc, -(ez - rc)],
      [-(ex - rc), -(ez - rc)],
      [-(ex - rc), ez - rc],
    ];
    for (let c = 0; c < 4; c += 1) {
      for (let a = 0; a < arc; a += 1) {
        const phi = (c + a / (arc - 1)) * (Math.PI / 2);
        out.push([corners[c][0] + Math.sin(phi) * rc, corners[c][1] + Math.cos(phi) * rc]);
      }
    }
  };
  const n = rings.length;
  const pos = new Float32Array((P + 1) * n * 3);
  const col = new Float32Array((P + 1) * n * 3);
  const pts: Array<[number, number]> = [];
  for (let j = 0; j < n; j += 1) {
    const [inset, y, c] = rings[j];
    loop(inset, pts);
    for (let i = 0; i <= P; i += 1) {
      const [x, z] = pts[i % P];
      const k = (i * n + j) * 3;
      pos[k] = x;
      pos[k + 1] = y;
      pos[k + 2] = z;
      col[k] = c.r;
      col[k + 1] = c.g;
      col[k + 2] = c.b;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < P; i += 1) {
    for (let j = 0; j < n - 1; j += 1) {
      const a = i * n + j;
      const b = (i + 1) * n + j;
      const c = (i + 1) * n + j + 1;
      const d = i * n + j + 1;
      idx.push(a, b, d, c, d, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('wind', new THREE.BufferAttribute(new Float32Array(pos.length / 3), 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Onion dome with a neck ring; returns geometry whose base is at y=0. */
export function onionDome(R: number, H: number, color: Col, segments = 28): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  const light = c.clone().lerp(new THREE.Color('#ffffff'), 0.14);
  const rings = smoothRings(
    [
      [R * 0.86, 0],
      [R * 0.97, H * 0.1],
      [R * 1.16, H * 0.3],
      [R * 1.06, H * 0.47],
      [R * 0.66, H * 0.66],
      [R * 0.24, H * 0.83],
      [R * 0.08, H * 0.94],
      [0.0, H],
    ],
    18,
    (t) => (t < 0.5 ? c : c.clone().lerp(light, (t - 0.5) * 2)),
  );
  rings.unshift([R * 0.7, 0.02, c.clone().multiplyScalar(0.7)]);
  return latheRings(rings, { segments, phiStart: Math.PI });
}

/** Gold ribs running up an onion dome (adds sparkle and structure). */
export function onionRibs(b: PartBuilder, x: number, y: number, z: number, R: number, H: number, count: number, color: Col): void {
  const prof: Array<[number, number]> = [
    [R * 0.9, 0.05],
    [R * 1.0, H * 0.1],
    [R * 1.19, H * 0.3],
    [R * 1.09, H * 0.47],
    [R * 0.69, H * 0.66],
    [R * 0.27, H * 0.83],
    [R * 0.1, H * 0.93],
  ];
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2;
    const pts: Vec3[] = prof.map(([r, yy]) => [x + Math.sin(a) * r, y + yy, z + Math.cos(a) * r]);
    b.add(tube(pts, 0.05, 14, 4), color);
  }
}

// ---------------------------------------------------------------------------
// Finials, flag poles, emblems
// ---------------------------------------------------------------------------

/** Crown silhouette: band + five rounded peaks. */
export function crownShape(w: number, h: number): THREE.Shape {
  const s = new THREE.Shape();
  const hw = w / 2;
  const peaks = [
    [-hw, h * 0.82],
    [-hw * 0.5, h * 0.9],
    [0, h],
    [hw * 0.5, h * 0.9],
    [hw, h * 0.82],
  ];
  const valley = h * 0.46;
  s.moveTo(-hw * 0.9, 0);
  s.lineTo(hw * 0.9, 0);
  s.lineTo(peaks[4][0], peaks[4][1]);
  for (let i = 4; i > 0; i -= 1) {
    const [x0] = peaks[i];
    const [x1, y1] = peaks[i - 1];
    const mx = (x0 + x1) / 2;
    s.quadraticCurveTo(mx + (x0 - mx) * 0.25, valley, mx, valley);
    s.quadraticCurveTo(mx + (x1 - mx) * 0.25, valley, x1, y1);
  }
  s.lineTo(-hw * 0.9, 0);
  return s;
}

export type FinialTop = 'heart' | 'star' | 'ball' | 'pole';

/**
 * Gold finial at (x, y, z) scaled by s. 'pole' leaves a slim mast; returns the
 * y of its top so a flag can be attached.
 */
export function finial(metal: PartBuilder, gloss: PartBuilder | null, x: number, y: number, z: number, s: number, top: FinialTop, gem: Col = PAL.heartGem): number {
  const g = PAL.gold;
  const body = latheRings(
    [
      [0.2 * s, -0.1 * s, g],
      [0.24 * s, 0.04 * s],
      [0.09 * s, 0.2 * s],
      [0.07 * s, 0.32 * s],
      [0.0, 0.34 * s],
    ],
    { segments: 9 },
  );
  metal.addColored(body, { p: [x, y, z] });
  metal.add(sphere(0.16 * s, 9, 6), g, { p: [x, y + 0.46 * s, z] });
  if (top === 'pole') {
    const len = 2.1 * s;
    metal.add(new THREE.CylinderGeometry(0.035 * s, 0.05 * s, len, 6), g, { p: [x, y + 0.5 * s + len / 2, z] });
    metal.add(sphere(0.085 * s, 8, 6), g, { p: [x, y + 0.5 * s + len + 0.05 * s, z] });
    return y + 0.5 * s + len;
  }
  metal.add(new THREE.CylinderGeometry(0.03 * s, 0.06 * s, 0.5 * s, 6), g, { p: [x, y + 0.8 * s, z] });
  if (top === 'heart') {
    const hs = heartShape(0.46 * s);
    (gloss ?? metal).add(extrude(hs, 0.1 * s, 0.035 * s, 2, 10), gloss ? gem : g, { p: [x, y + 1.24 * s, z] });
    return y + 1.5 * s;
  }
  if (top === 'star') {
    const st = new THREE.Shape();
    for (let i = 0; i <= 10; i += 1) {
      const rr = i % 2 === 0 ? 0.26 * s : 0.11 * s;
      const a = Math.PI / 2 + (i / 10) * Math.PI * 2;
      if (i === 0) st.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else st.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    metal.add(extrude(st, 0.08 * s, 0.03 * s, 2, 4), g, { p: [x, y + 1.25 * s, z] });
    return y + 1.5 * s;
  }
  metal.add(sphere(0.12 * s, 12, 8), g, { p: [x, y + 1.1 * s, z] });
  return y + 1.2 * s;
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

function archPath(path: THREE.Path, w: number, h: number, y0 = 0): void {
  const r = w / 2;
  path.moveTo(-r, y0);
  path.lineTo(r, y0);
  path.lineTo(r, y0 + h - r);
  path.absarc(0, y0 + h - r, r, 0, Math.PI, false);
  path.lineTo(-r, y0);
}

export function archOutline(w: number, h: number, y0 = 0): THREE.Shape {
  const s = new THREE.Shape();
  archPath(s, w, h, y0);
  return s;
}

/** Arch frame: outer arch minus inner arch (inner sits t above the outer base). */
export function archFrameShape(w: number, h: number, t: number, tb = t): THREE.Shape {
  const s = new THREE.Shape();
  archPath(s, w + t * 2, h + t + tb, -tb);
  const hole = new THREE.Path();
  archPath(hole, w, h, 0);
  s.holes.push(hole);
  return s;
}

export interface WindowStyle {
  frame: Col;
  sill?: Col;
  /** Mullions (cross bars) on the glass. */
  mullion?: boolean;
  /** Little berry keystone at the top of the frame. */
  keystone?: Col;
  /** Flower box under the window. */
  flowers?: boolean;
  /** Frame thickness. */
  t?: number;
  curve?: number;
}

const windowCache = new Map<string, { frame: THREE.BufferGeometry; glass: THREE.BufferGeometry }>();

function windowGeos(w: number, h: number, t: number, curve: number): { frame: THREE.BufferGeometry; glass: THREE.BufferGeometry } {
  const key = `${w.toFixed(3)}:${h.toFixed(3)}:${t.toFixed(3)}:${curve}`;
  let hit = windowCache.get(key);
  if (!hit) {
    // Small windows skip the bevel (invisible at play distance, saves ~half the triangles).
    const bevel = w >= 0.95 ? 0.035 : 0;
    hit = {
      frame: extrude(archFrameShape(w, h, t, t * 0.8), bevel ? 0.14 : 0.2, bevel, 1, curve),
      glass: extrude(archOutline(w + 0.02, h + 0.01), 0.04, 0, 1, curve),
    };
    windowCache.set(key, hit);
  }
  return hit;
}

/**
 * Arched window facing along `ry` (0 = +Z). (x, y, z) is the bottom center on
 * the wall surface. Frame goes to matte, glass to glass, flower box to foliage.
 */
export function archWindow(bag: Bag, x: number, y: number, z: number, ry: number, w: number, h: number, st: WindowStyle): void {
  const t = st.t ?? Math.max(0.08, w * 0.12);
  const { frame, glass } = windowGeos(w, h, t, st.curve ?? (w >= 0.95 ? 10 : 7));
  const nx = Math.sin(ry);
  const nz = Math.cos(ry);
  const at = (d: number): Vec3 => [x + nx * d, y, z + nz * d];
  bag.matte.add(frame, st.frame, { p: at(0.05), r: [0, ry, 0] });
  bag.glass.add(glass, PAL.glass, { p: at(0.02), r: [0, ry, 0] });
  if (st.mullion) {
    const bar = new THREE.BoxGeometry(0.05, h - 0.05, 0.05);
    bag.matte.add(bar, st.frame, { p: [x + nx * 0.06, y + (h - 0.05) / 2, z + nz * 0.06], r: [0, ry, 0] });
    const hb = new THREE.BoxGeometry(w, 0.05, 0.05);
    bag.matte.add(hb, st.frame, { p: [x + nx * 0.06, y + (h - w / 2) * 0.72, z + nz * 0.06], r: [0, ry, 0] });
  }
  if (st.sill) {
    bag.matte.add(new THREE.BoxGeometry(w + t * 2 + 0.16, 0.12, 0.26), st.sill, { p: [x + nx * 0.12, y - t * 0.8 - 0.04, z + nz * 0.12], r: [0, ry, 0] });
  }
  if (st.keystone) {
    bag.matte.add(new THREE.BoxGeometry(0.16 + w * 0.08, 0.26 + w * 0.08, 0.2), st.keystone, { p: [x + nx * 0.09, y + h + t * 0.45, z + nz * 0.09], r: [0, ry, 0] });
  }
  if (st.flowers) {
    const bw = w + t * 2 + 0.1;
    bag.matte.add(rbox(bw, 0.28, 0.32, 0.06, 1), PAL.wood, { p: [x + nx * 0.22, y - t * 0.8 - 0.22, z + nz * 0.22], r: [0, ry, 0] });
    const n = Math.max(3, Math.round(bw / 0.16));
    const tx = Math.cos(ry);
    const tz = -Math.sin(ry);
    for (let i = 0; i < n; i += 1) {
      const u = (i / (n - 1) - 0.5) * (bw - 0.12);
      const px = x + nx * 0.26 + tx * u;
      const pz = z + nz * 0.26 + tz * u;
      bag.foliage.add(leafGeo, PAL.leafDeep, { p: [px, y - t * 0.8 - 0.04, pz], s: 0.12, wind: 0.01 });
      bag.foliage.add(flowerGeo, FLOWER_COLORS[(i * 7 + Math.round(x * 3)) % FLOWER_COLORS.length], {
        p: [px + nx * 0.07, y - t * 0.8 + 0.06 + (i % 2) * 0.05, pz + nz * 0.07],
        s: 0.075,
        wind: 0.012,
      });
    }
  }
}

/** Round (oculus) window with a gold ring. */
export function roundWindow(bag: Bag, x: number, y: number, z: number, ry: number, r: number, ring: Col = PAL.gold): void {
  const nx = Math.sin(ry);
  const nz = Math.cos(ry);
  const disc = new THREE.CircleGeometry(r, 10).rotateY(ry);
  bag.glass.add(disc, PAL.glass, { p: [x + nx * 0.02, y, z + nz * 0.02] });
  disc.dispose();
  const tor = new THREE.TorusGeometry(r + 0.03, Math.max(0.045, r * 0.17), 3, 12).rotateY(ry);
  bag.metal.add(tor, ring, { p: [x + nx * 0.06, y, z + nz * 0.06] });
  tor.dispose();
}

/** Heart-shaped window with a frame. */
export function heartWindow(bag: Bag, x: number, y: number, z: number, ry: number, size: number, frame: Col): void {
  const nx = Math.sin(ry);
  const nz = Math.cos(ry);
  const outer = heartShape(size * 1.28);
  const inner = heartShape(size);
  bag.matte.add(extrude(outer, 0.16, 0, 1, 7), frame, { p: [x + nx * 0.04, y, z + nz * 0.04], r: [0, ry, 0] });
  bag.glass.add(extrude(inner, 0.06, 0.0, 1, 7), PAL.glass, { p: [x + nx * 0.1, y + size * 0.02, z + nz * 0.1], r: [0, ry, 0] });
}

// ---------------------------------------------------------------------------
// Crenellations
// ---------------------------------------------------------------------------

const merlonCache = new Map<string, THREE.BufferGeometry>();
/** Soft merlon (rounded, 108 tris) or cheap box merlon for walls seen from afar. */
function merlonGeo(w: number, h: number, d: number, cheap = false): THREE.BufferGeometry {
  const key = `${w}:${h}:${d}:${cheap}`;
  let g = merlonCache.get(key);
  if (!g) {
    g = cheap ? new THREE.BoxGeometry(w, h, d) : rbox(w, h, d, Math.min(0.14, w * 0.2), 1);
    merlonCache.set(key, g);
  }
  return g;
}

/** Merlons along a straight wall top from (x0,z0) to (x1,z1). */
export function merlonLine(
  b: PartBuilder,
  x0: number, z0: number, x1: number, z1: number, y: number,
  spacing: number, w: number, h: number, d: number, color: Col,
  skip?: (x: number, z: number) => boolean,
  cheap = false,
): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.max(1, Math.floor(len / spacing));
  const g = merlonGeo(w, h, d, cheap);
  const ry = Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2;
  for (let i = 0; i <= n; i += 1) {
    const t = n === 0 ? 0.5 : i / n;
    const px = x0 + (x1 - x0) * t;
    const pz = z0 + (z1 - z0) * t;
    if (skip?.(px, pz)) continue;
    b.add(g, color, { p: [px, y + h / 2, pz], r: [0, ry, 0] });
  }
}

// ---------------------------------------------------------------------------
// Foliage: flowers, garlands, bushes
// ---------------------------------------------------------------------------

export const FLOWER_COLORS: Col[] = [PAL.flowerRose, PAL.flowerWhite, PAL.flowerYellow, PAL.blossom, PAL.flowerLilac, PAL.flowerRose, PAL.flowerOrange];

/** Tiny deterministic RNG. */
export function rng(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** Shared low-poly templates (smooth 20-tri blobs read as leaves / blossoms at a distance). */
const flowerGeo = blob(1, 0, 0.06, 2, 1);
const leafGeo = blob(1, 0, 0.12, 2, 2);
const FLOWER_HI = blob(1, 1, 0.05, 2, 4);
export const FLOWER_GEO = flowerGeo;

/**
 * Leafy garland along a curve through `pts`: a lumpy, noise-displaced foliage
 * rope with leaf tufts, rose clusters at the ends and the low point, and
 * scattered blossoms. Wind is zero at the ends and largest mid-span.
 */
export function garland(
  bag: Bag,
  pts: Vec3[],
  opts: { thick?: number; seed?: number; flowers?: Col[]; density?: number; wind?: number; lights?: boolean; hi?: boolean; endRoses?: boolean; out?: Vec3 } = {},
): void {
  // Direction the garland faces (blossoms and lights sit on this side of the rope).
  const [ox, oy, oz] = opts.out ?? [0, 0, 1];
  const thick = opts.thick ?? 0.16;
  const flowerT = opts.hi ? FLOWER_HI : flowerGeo;
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)));
  const len = curve.getLength();
  const windAmp = opts.wind ?? 0.05;
  const seed = opts.seed ?? 7;
  const rand = rng(seed);
  const start = new THREE.Vector3(...pts[0]);
  const end = new THREE.Vector3(...pts[pts.length - 1]);
  const span = start.distanceTo(end) || 1;
  const pv = new THREE.Vector3();
  const windAt = (x: number, y: number, z: number) => {
    pv.set(x, y, z);
    const a = pv.distanceTo(start) / span;
    const c = pv.distanceTo(end) / span;
    return windAmp * Math.min(1, Math.min(a, c) * 2.2);
  };
  // Foliage rope: tube displaced by 3D noise so it reads as bunched leaves.
  const radial = opts.hi ? 6 : 5;
  const tubular = Math.max(8, Math.round(len / (opts.hi ? 0.09 : 0.12)));
  const rope = new THREE.TubeGeometry(curve, tubular, thick, radial, false);
  const pos = rope.attributes.position;
  const nor = rope.attributes.normal;
  const f = 7.5 / Math.max(0.1, thick * 6);
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = valueNoise3(x * f + seed, y * f, z * f) * 0.75 + valueNoise3(x * f * 2.3, y * f * 2.3 + seed, z * f * 2.3) * 0.25;
    const d = (n - 0.45) * thick * 1.25;
    pos.setXYZ(i, x + nor.getX(i) * d, y + nor.getY(i) * d, z + nor.getZ(i) * d);
  }
  rope.deleteAttribute('normal');
  rope.computeVertexNormals();
  const deep = new THREE.Color(PAL.leafDeep);
  const lite = new THREE.Color(PAL.leaf);
  const sage = new THREE.Color(PAL.leafSage);
  const c = new THREE.Color();
  bag.foliage.add(rope, (x, y, z, _nx, ny) => {
    const n = valueNoise3(x * 3.1 + seed, y * 3.1, z * 3.1);
    c.copy(deep).lerp(lite, Math.min(1, Math.max(0, 0.35 + ny * 0.45 + (n - 0.5) * 0.6)));
    if (n > 0.72) c.lerp(sage, 0.5);
    return c.getHex();
  }, { wind: windAt });
  rope.dispose();

  const flowers = opts.flowers ?? FLOWER_COLORS;
  const p = new THREE.Vector3();
  const tan = new THREE.Vector3();
  const addFlower = (u: number, size: number, lift: number, hero = false) => {
    curve.getPointAt(Math.min(1, Math.max(0, u)), p);
    const fc = flowers[Math.floor(rand() * flowers.length)];
    const jx = (rand() - 0.5) * thick * 0.8;
    const jz = (rand() - 0.5) * thick * 0.6;
    bag.foliage.add(hero ? flowerT : flowerGeo, fc, {
      p: [p.x + jx * (1 - Math.abs(ox)) + ox * thick * 0.75, p.y + thick * lift + oy * thick * 0.75, p.z + jz * (1 - Math.abs(oz)) + oz * thick * 0.75],
      s: [size, size * 0.85, size],
      wind: windAt(p.x, p.y, p.z),
    });
  };
  // Leaf tufts poking out of the rope.
  const tufts = Math.round((len / 0.32) * (opts.density ?? 1));
  for (let i = 0; i < tufts; i += 1) {
    const u = (i + rand() * 0.8) / tufts;
    curve.getPointAt(Math.min(1, u), p);
    curve.getTangentAt(Math.min(1, u), tan);
    const a = rand() * Math.PI * 2;
    const lx = Math.cos(a) * thick * 0.9;
    const ly = Math.sin(a) * thick * 0.9;
    const s = thick * (0.55 + rand() * 0.35);
    bag.foliage.add(leafGeo, rand() < 0.5 ? PAL.leaf : PAL.leafSage, {
      p: [p.x + lx * (1 - Math.abs(tan.x)) + ox * thick * 0.4, p.y + ly + oy * thick * 0.4, p.z + oz * thick * 0.4 + Math.abs(lx) * 0.3 * oz],
      s: [s * 1.4, s * 0.55, s],
      r: [rand() * 0.8, rand() * Math.PI, a],
      wind: windAt(p.x, p.y, p.z),
    });
  }
  // Rose clusters: low point + ends, then scattered blossoms.
  const big = thick * (opts.hi ? 0.95 : 0.85);
  addFlower(0.5, big * 1.15, 0.2, true);
  addFlower(0.5 - 0.05 * (2 / Math.max(1, len)), big * 0.8, -0.4, true);
  addFlower(0.5 + 0.06 * (2 / Math.max(1, len)), big * 0.8, 0.5, true);
  if (opts.endRoses !== false) {
    addFlower(0.02, big, 0.2, true);
    addFlower(0.98, big, 0.2, true);
  }
  const scatter = Math.round((len / 0.45) * (opts.density ?? 1));
  for (let i = 0; i < scatter; i += 1) addFlower((i + 0.5) / scatter + (rand() - 0.5) * 0.05, thick * (0.45 + rand() * 0.3), (rand() - 0.3) * 1.2);
  if (opts.lights) {
    const n = Math.round(len / 0.55);
    for (let i = 0; i < n; i += 1) {
      curve.getPointAt((i + 0.5) / n, p);
      bag.glow.add(flowerGeo, '#fff4c2', { p: [p.x + ox * thick * 0.35, p.y - thick * 1.05, p.z + oz * thick * 0.35], s: 0.065 });
    }
  }
}

/** Sagging swag points between two anchors (catenary-ish parabola). */
export function swag(a: Vec3, b: Vec3, sag: number, n = 7): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t]);
  }
  return out;
}

/** A round leafy bush with blossoms sprinkled over its upper half. */
export function bush(bag: Bag, x: number, y: number, z: number, r: number, seed: number, opts: { flowers?: Col[]; flowerCount?: number; leaf?: Col; leaf2?: Col; squash?: number; detail?: number } = {}): void {
  const leaf = new THREE.Color(opts.leaf ?? PAL.leaf);
  const leaf2 = new THREE.Color(opts.leaf2 ?? PAL.leafDeep);
  const squash = opts.squash ?? 0.85;
  const g = blob(r, opts.detail ?? 2, 0.14, 1.6 / r, seed);
  bag.foliage.add(g, (_x, yy) => {
    const t = smoothstep(y - r * squash, y + r * squash * 0.8, yy);
    return tmpA.copy(leaf2).lerp(leaf, t).getHex();
  }, { p: [x, y, z], s: [1, squash, 1], wind: (_x, yy) => 0.03 * smoothstep(y - r, y + r, yy) });
  g.dispose();
  const flowers = opts.flowers ?? FLOWER_COLORS;
  const n = opts.flowerCount ?? Math.round(r * r * 10);
  const rand = rng(seed * 31 + 5);
  for (let i = 0; i < n; i += 1) {
    const u = rand() * Math.PI * 2;
    const v = Math.acos(1 - rand() * 1.15);
    const dx = Math.sin(v) * Math.cos(u);
    const dy = Math.cos(v);
    const dz = Math.sin(v) * Math.sin(u);
    const fr = r * (0.075 + rand() * 0.05);
    bag.foliage.add(flowerGeo, flowers[Math.floor(rand() * flowers.length)], {
      p: [x + dx * r * 0.98, y + dy * r * squash * 0.98, z + dz * r * 0.98],
      s: fr,
      wind: 0.03 * smoothstep(-0.2, 1, dy),
    });
  }
}

/**
 * Storybook tree: tapered trunk with two short limbs and a clustered canopy
 * (a main puff plus satellites) shaded dark-below / light-above. Blossom trees
 * get a warm pink canopy with a few white petals; green trees get blossom dots.
 */
export function roundTree(
  bag: Bag, x: number, z: number, h: number, r: number, seed: number, blossom = false, y = 0,
  opts: { lumps?: number; lumpDetail?: number } = {},
): void {
  const rand = rng(seed * 7 + 3);
  const lean = (rand() - 0.5) * 0.18;
  const trunkG = new THREE.CylinderGeometry(r * 0.075, r * 0.14, h + r * 0.3, 8, 3);
  bag.matte.add(trunkG, PAL.trunk, { p: [x + lean * h * 0.5, y + (h + r * 0.3) / 2, z], r: [0, 0, -lean], shade: { y0: y, y1: y + h, k: 0.72 } });
  trunkG.dispose();
  for (const side of [-1, 1]) {
    const a = rand() * Math.PI * 2;
    const limb = new THREE.CylinderGeometry(r * 0.035, r * 0.06, r * 0.9, 6);
    bag.matte.add(limb, PAL.trunk, {
      p: [x + Math.cos(a) * r * 0.25 + lean * h * 0.8, y + h * 0.82 + side * 0.05, z + Math.sin(a) * r * 0.25],
      r: [Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7],
    });
    limb.dispose();
  }
  const cx = x + lean * h;
  const cy = y + h + r * 0.4;
  const deep = new THREE.Color(blossom ? '#f08bb0' : PAL.leafDeep);
  const mid = new THREE.Color(blossom ? '#ffb3cc' : PAL.leaf);
  const lite = new THREE.Color(blossom ? '#ffe1ec' : PAL.leafSage);
  const tmp = new THREE.Color();
  const shadeFn = (_x: number, yy: number, _z: number, _nx: number, ny: number) => {
    const t = Math.min(1, Math.max(0, (yy - (cy - r * 0.9)) / (r * 2.1)));
    tmp.copy(deep).lerp(mid, Math.min(1, t * 1.6));
    if (t > 0.55) tmp.lerp(lite, (t - 0.55) * 1.3);
    if (ny < 0) tmp.multiplyScalar(1 + ny * 0.18);
    return tmp.getHex();
  };
  const windFn = (_x: number, yy: number) => 0.035 * smoothstep(cy - r, cy + r, yy);
  const main = blob(r, 2, 0.12, 1.6 / r, seed);
  bag.foliage.add(main, shadeFn, { p: [cx, cy, z], s: [1, 0.88, 1], wind: windFn });
  main.dispose();
  const lumps = opts.lumps ?? 4;
  for (let i = 0; i < lumps; i += 1) {
    const a = (i / lumps) * Math.PI * 2 + rand() * 0.8;
    const lr = r * (0.52 + rand() * 0.16);
    const up = i === lumps - 1 ? r * 0.55 : r * (0.05 + rand() * 0.3);
    const out = i === lumps - 1 ? r * 0.12 : r * (0.62 + rand() * 0.12);
    const g = blob(lr, opts.lumpDetail ?? 2, 0.14, 1.8 / lr, seed + i + 1);
    bag.foliage.add(g, shadeFn, { p: [cx + Math.cos(a) * out, cy + up, z + Math.sin(a) * out], s: [1, 0.9, 1], wind: windFn });
    g.dispose();
  }
  const dots = Math.round(r * r * (blossom ? 2.2 : 2.6));
  const colors: Col[] = blossom ? [PAL.flowerWhite, '#fff0f5', PAL.flowerRose] : [PAL.flowerWhite, PAL.flowerRose, PAL.blossom];
  for (let i = 0; i < dots; i += 1) {
    const u = rand() * Math.PI * 2;
    const v = Math.acos(1 - rand() * 1.1);
    const rr = r * 1.02;
    bag.foliage.add(flowerGeo, colors[Math.floor(rand() * colors.length)], {
      p: [cx + Math.sin(v) * Math.cos(u) * rr, cy + Math.cos(v) * rr * 0.88 + r * 0.08, z + Math.sin(v) * Math.sin(u) * rr],
      s: r * (0.05 + rand() * 0.03),
      wind: 0.035,
    });
  }
}

/** Spiral/cone topiary in a pot. */
export function topiary(bag: Bag, x: number, z: number, h: number, kind: 'cone' | 'balls' | 'heart', pot: Col, seed: number, y = 0): void {
  const potH = 0.55;
  bag.matte.addColored(
    latheRings(
      [
        [0.28, 0, pot],
        [0.34, 0.05],
        [0.42, potH - 0.1],
        [0.48, potH - 0.06],
        [0.48, potH],
        [0.4, potH + 0.01, PAL.soil],
        [0.0, potH + 0.02],
      ],
      { segments: 16, shade: { y0: 0, y1: potH, k: 0.8 } },
    ),
    { p: [x, y, z] },
  );
  const base = y + potH;
  const leaf = new THREE.Color(PAL.leaf);
  const deep = new THREE.Color(PAL.leafDeep);
  if (kind === 'cone') {
    const g = latheRings(
      smoothRings(
        [
          [0.0, 0],
          [0.42, 0.15],
          [0.46, h * 0.3],
          [0.3, h * 0.65],
          [0.1, h * 0.92],
          [0.0, h],
        ],
        11,
        (t) => deep.clone().lerp(leaf, t),
      ),
      { segments: 10 },
    );
    bag.foliage.addColored(g, { p: [x, base, z] });
    for (let i = 0; i < 6; i += 1) {
      const a = i * 2.4 + seed;
      const t = 0.2 + (i / 6) * 0.6;
      const rr = 0.42 * (1 - t) + 0.05;
      bag.foliage.add(flowerGeo, i % 2 ? PAL.flowerRose : PAL.flowerWhite, { p: [x + Math.sin(a) * rr, base + t * h, z + Math.cos(a) * rr], s: 0.07 });
    }
  } else if (kind === 'balls') {
    bag.matte.add(new THREE.CylinderGeometry(0.05, 0.06, h, 6), PAL.trunk, { p: [x, base + h / 2, z] });
    bush(bag, x, base + h * 0.35, z, 0.36, seed, { flowerCount: 3, squash: 0.95, detail: 1 });
    bush(bag, x, base + h * 0.85, z, 0.28, seed + 1, { flowerCount: 2, squash: 0.95, detail: 1 });
  } else {
    bag.matte.add(new THREE.CylinderGeometry(0.05, 0.06, h * 0.5, 6), PAL.trunk, { p: [x, base + h * 0.25, z] });
    const hs = heartShape(h * 0.62);
    const hg = extrude(hs, 0.34, 0.12, 2, 12);
    bag.foliage.add(hg, (_x, yy) => deep.clone().lerp(leaf, smoothstep(-h * 0.3, h * 0.3, yy)).getHex(), { p: [x, base + h * 0.72, z], wind: 0.01 });
    hg.dispose();
  }
}
