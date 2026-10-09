import * as THREE from 'three';
import { Bins, bake, col, type ColorFn, type Prefab, type Xf } from './bins';
import { LOOK, darker, hexOf, type Scheme } from './look';
import * as P from './prims';
import type { Rng } from './rng';

/**
 * Storybook house kit. Every house is built in its own frame: origin at the
 * front-center at ground level, the front facing +Z, width along X, depth
 * toward -Z. The composer rotates it to face the road.
 */

export type RoofKind = 'gableFront' | 'gableSide' | 'hip';
export type RoofStyle = 'courses' | 'scallop' | 'puffy';
export type WindowStyle = 'rect' | 'arch' | 'round';
export type DoorHood = 'none' | 'gable' | 'round' | 'awning';
export type Face = 'front' | 'back' | 'left' | 'right';

export interface HouseSpec {
  w: number;
  d: number;
  floors: number;
  floorH: number;
  roof: RoofKind;
  roofStyle: RoofStyle;
  pitch: number;
  scheme: Scheme;
  shutters: string | null;
  windows: WindowStyle;
  flowerBoxes: boolean;
  /** Chimney position along the ridge (-0.5..0.5), or null. */
  chimney: number | null;
  dormers: number;
  /** Door offset along the front. */
  doorU: number;
  doorHood: DoorHood;
  bay: boolean;
  balcony: boolean;
  /** 2 = hero front row, 1 = back row, 0 = far. */
  detail: 0 | 1 | 2;
  /** Attached round tower on the left (-1) or right (+1) front corner. */
  tower: -1 | 1 | 0;
  /** Curvy "bell" front gable (tall townhouse). */
  bell: boolean;
  /** Shop front with striped awning and hanging sign. */
  shop: { stripe: string; sign: 'heart' | 'star' | 'cup' | 'flower' } | null;
  /** Gable-end accent color (boards), or null. */
  gableAccent: string | null;
  /** Colors for flower boxes. */
  flowers: readonly string[];
  /**
   * House-local X side whose wall faces the chase camera (world +Z). Faces
   * turned away from the camera get no windows and hidden roof slopes stay plain.
   */
  camSide: -1 | 1;
}

export interface HouseInfo {
  /** Door position in house frame (x along the front). */
  doorU: number;
  /** Total height for bunting attachment etc. */
  height: number;
  /** Wall top height. */
  wallTop: number;
}

const PLINTH = 0.42;
const SILL = 0.8;

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Shapes / geometry helpers
// ---------------------------------------------------------------------------

function rectPath(path: THREE.Path, x0: number, y0: number, x1: number, y1: number, r: number, reverse = false): THREE.Path {
  if (!reverse) {
    path.moveTo(x0 + r, y0);
    path.lineTo(x1 - r, y0);
    if (r > 0) path.quadraticCurveTo(x1, y0, x1, y0 + r);
    path.lineTo(x1, y1 - r);
    if (r > 0) path.quadraticCurveTo(x1, y1, x1 - r, y1);
    path.lineTo(x0 + r, y1);
    if (r > 0) path.quadraticCurveTo(x0, y1, x0, y1 - r);
    path.lineTo(x0, y0 + r);
    if (r > 0) path.quadraticCurveTo(x0, y0, x0 + r, y0);
  } else {
    path.moveTo(x0 + r, y0);
    if (r > 0) path.quadraticCurveTo(x0, y0, x0, y0 + r);
    path.lineTo(x0, y1 - r);
    if (r > 0) path.quadraticCurveTo(x0, y1, x0 + r, y1);
    path.lineTo(x1 - r, y1);
    if (r > 0) path.quadraticCurveTo(x1, y1, x1, y1 - r);
    path.lineTo(x1, y0 + r);
    if (r > 0) path.quadraticCurveTo(x1, y0, x1 - r, y0);
    path.lineTo(x0 + r, y0);
  }
  return path;
}

function archPath(path: THREE.Path, w: number, h: number, y0: number, reverse = false): THREE.Path {
  const r = w / 2;
  const top = y0 + h - r;
  if (!reverse) {
    path.moveTo(-r, y0);
    path.lineTo(r, y0);
    path.lineTo(r, top);
    path.absarc(0, top, r, 0, Math.PI, false);
    path.lineTo(-r, y0);
  } else {
    path.moveTo(-r, y0);
    path.lineTo(-r, top);
    path.absarc(0, top, r, Math.PI, 0, true);
    path.lineTo(r, y0);
    path.lineTo(-r, y0);
  }
  return path;
}

/** Arch-shaped frame open at the bottom (door surrounds): outer arch minus inner arch. */
function horseshoe(wo: number, ho: number, wi: number, hi: number): THREE.Shape {
  const ro = wo / 2;
  const ri = wi / 2;
  const s = new THREE.Shape();
  s.moveTo(-ro, 0);
  s.lineTo(-ri, 0);
  s.lineTo(-ri, hi - ri);
  s.absarc(0, hi - ri, ri, Math.PI, 0, true);
  s.lineTo(ri, 0);
  s.lineTo(ro, 0);
  s.lineTo(ro, ho - ro);
  s.absarc(0, ho - ro, ro, 0, Math.PI, false);
  s.lineTo(-ro, 0);
  return s;
}

function circlePath(path: THREE.Path, cx: number, cy: number, r: number, reverse = false): THREE.Path {
  path.moveTo(cx + r, cy);
  path.absarc(cx, cy, r, 0, TAU, reverse);
  return path;
}

/** Opening outline for a window style, base at y = 0 (+ optional margin grow). */
function openingPath(path: THREE.Path, style: WindowStyle, w: number, h: number, grow: number, reverse = false): THREE.Path {
  if (style === 'round') return circlePath(path, 0, w / 2, w / 2 + grow, reverse);
  if (style === 'arch') return archPath(path, w + grow * 2, h + grow * 2, -grow, reverse);
  return rectPath(path, -w / 2 - grow, -grow, w / 2 + grow, h + grow, 0, reverse);
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

export interface WindowDef {
  style: WindowStyle;
  w: number;
  h: number;
  trim: string;
  shutters: string | null;
}

const windowCache = new Map<string, Prefab>();

/** Cheap window for back rows: glass slab, frame slab and sill (~36 tris). */
export function liteWindowPrefab(w: number, h: number, trim: string): Prefab {
  const key = `lite:${w.toFixed(2)}:${h.toFixed(2)}:${trim}`;
  const hit = windowCache.get(key);
  if (hit) return hit;
  const prefab = bake((b) => {
    b.add('matte', P.box(w + 0.2, h + 0.2, 0.06), trim, { p: [0, h / 2, 0.01] });
    b.add('glass', P.box(w, h, 0.06), '#ffffff', { p: [0, h / 2, 0.03] });
    b.add('matte', P.box(w + 0.3, 0.08, 0.16), trim, { p: [0, -0.1, 0.07] });
  });
  windowCache.set(key, prefab);
  return prefab;
}

export function windowPrefab(def: WindowDef): Prefab {
  const key = `${def.style}:${def.w.toFixed(2)}:${def.h.toFixed(2)}:${def.trim}:${def.shutters ?? '-'}`;
  const hit = windowCache.get(key);
  if (hit) return hit;
  const { style, w, h, trim } = def;
  const fw = 0.1;
  const prefab = bake((b) => {
    const frameKey = `winframe:${style}:${w.toFixed(2)}:${h.toFixed(2)}`;
    const frame = P.extrude(
      frameKey,
      () => {
        const outer = openingPath(new THREE.Shape(), style, w, h, fw) as THREE.Shape;
        outer.holes.push(openingPath(new THREE.Path(), style, w, h, 0, true));
        return outer;
      },
      { depth: 0.1, curveSegments: style === 'round' ? 5 : 2 },
    );
    b.add('matte', frame, trim, { p: [0, 0, 0.03] });
    if (style === 'rect') {
      b.add('glass', P.box(w + 0.02, h + 0.02, 0.04), '#ffffff', { p: [0, h / 2, -0.005] });
    } else {
      const glass = P.extrude(`winglass:${style}:${w.toFixed(2)}:${h.toFixed(2)}`, () => openingPath(new THREE.Shape(), style, w, h, 0.01) as THREE.Shape, {
        depth: 0.04,
        curveSegments: style === 'round' ? 5 : 2,
      });
      b.add('glass', glass, '#ffffff', { p: [0, 0, -0.005] });
    }
    // Mullions.
    const mw = 0.055;
    if (style === 'round') {
      b.add('matte', P.box(mw, w, 0.05), trim, { p: [0, w / 2, 0.035] });
      b.add('matte', P.box(w, mw, 0.05), trim, { p: [0, w / 2, 0.035] });
    } else {
      const top = style === 'arch' ? h : h;
      b.add('matte', P.box(mw, top, 0.05), trim, { p: [0, top / 2, 0.035] });
      const hy = style === 'arch' ? h - w / 2 : h * 0.56;
      b.add('matte', P.box(w, mw, 0.05), trim, { p: [0, hy, 0.035] });
    }
    // Sill.
    if (style !== 'round') {
      b.add('matte', P.box(w + 0.34, 0.09, 0.2), trim, { p: [0, -fw - 0.02, 0.09] });
      if (style === 'arch') {
        // Keystone.
        b.add('matte', P.box(0.16, 0.2, 0.12), trim, { p: [0, h + fw - 0.02, 0.06] });
      }
    }
    // Shutters.
    if (def.shutters) {
      const sh = style === 'arch' ? h - w * 0.2 : h;
      const sw = Math.max(0.26, w * 0.42);
      const slat = darker(def.shutters, 0.86);
      for (const side of [-1, 1]) {
        const x = side * (w / 2 + fw + sw / 2 + 0.02);
        b.add('matte', P.box(sw, sh, 0.05), def.shutters, { p: [x, sh / 2, 0.03] });
        void slat;
      }
    }
  });
  windowCache.set(key, prefab);
  return prefab;
}

const flowerBoxCache = new Map<string, Prefab>();

export function flowerBoxPrefab(w: number, colors: readonly string[], boxColor: string, variant: number): Prefab {
  const key = `${w.toFixed(2)}:${colors.join(',')}:${boxColor}:${variant}`;
  const hit = flowerBoxCache.get(key);
  if (hit) return hit;
  const prefab = bake((b) => {
    const bw = w + 0.12;
    b.add('matte', P.box(bw, 0.22, 0.24), boxColor, { p: [0, 0, 0], shade: { y0: -0.12, y1: 0.1, k: 0.8 } });
    b.add('foliage', P.box(bw - 0.06, 0.12, 0.16), '#5fb86e', { p: [0, 0.15, 0], wind: 0.006 });
    const n = Math.max(3, Math.round(bw / 0.27));
    for (let i = 0; i < n; i += 1) {
      const x = -bw / 2 + 0.1 + (i / (n - 1)) * (bw - 0.2);
      const c = colors[(i + variant) % colors.length];
      b.add('foliage', P.ico(0.095, 0), c, { p: [x, 0.25 + 0.05 * (((i * 7 + variant) % 3) / 2), 0.03], wind: 0.015 });
    }
  });
  flowerBoxCache.set(key, prefab);
  return prefab;
}

/** Window in a facade frame at (u, sillY). */
function addWindow(bins: Bins, u: number, y: number, def: WindowDef, flowers: { colors: readonly string[]; box: string; variant: number } | null, lite = false): void {
  if (lite) {
    bins.stamp(liteWindowPrefab(def.style === 'round' ? 0.7 : def.w, def.style === 'round' ? 0.7 : def.h * 0.92, def.trim), { p: [u, y, 0] });
    return;
  }
  bins.stamp(windowPrefab(def), { p: [u, y, 0] });
  if (flowers && def.style !== 'round') {
    bins.stamp(flowerBoxPrefab(def.w + 0.2, flowers.colors, flowers.box, flowers.variant), { p: [u, y - 0.26, 0.18] });
  }
}

// ---------------------------------------------------------------------------
// Doors
// ---------------------------------------------------------------------------

const doorCache = new Map<string, Prefab>();

export function doorPrefab(w: number, h: number, color: string, trim: string, hood: DoorHood, hoodColor: string, stripe: string, detail: number): Prefab {
  const key = `${w}:${h}:${color}:${trim}:${hood}:${hoodColor}:${stripe}:${detail}`;
  const hit = doorCache.get(key);
  if (hit) return hit;
  if (detail < 2) {
    const lite = bake((b) => {
      b.add('matte', P.box(w + 0.24, h + 0.12, 0.08), trim, { p: [0, (h + 0.12) / 2, 0.02] });
      b.add('matte', P.box(w, h, 0.1), color, { p: [0, h / 2, 0.04] });
      b.add('matte', P.box(w + 0.6, 0.2, 0.5), LOOK.stone, { p: [0, 0.1, 0.25] });
      if (hood !== 'none') b.add('matte', P.box(w + 0.7, 0.1, 0.7), hoodColor, { p: [0, h + 0.25, 0.35], r: [0.3, 0, 0] });
    });
    doorCache.set(key, lite);
    return lite;
  }
  const prefab = bake((b) => {
    const leaf = P.extrude(`doorleaf:${w}:${h}`, () => archPath(new THREE.Shape(), w, h, 0) as THREE.Shape, { depth: 0.1, curveSegments: 4 });
    b.add('matte', leaf, color, { p: [0, 0, 0.02], shade: { y0: 0, y1: 1, k: 0.85 } });
    // Planks.
    const plank = darker(color, 0.84);
    for (const x of [-w / 4, w / 4]) b.add('matte', P.box(0.035, h - w / 2 - 0.15, 0.03), plank, { p: [x, (h - w / 2) / 2, 0.085] });
    const frame = P.extrude(`doorframe2:${w}:${h}`, () => horseshoe(w + 0.26, h + 0.13, w, h), { depth: 0.12, curveSegments: 4 });
    b.add('matte', frame, trim, { p: [0, 0, 0.04] });
    // Round window in the door.
    if (detail >= 2) {
      b.add('glass', P.cyl(0.17, 0.17, 0.04, 10), '#ffffff', { p: [0, h - w / 2 - 0.05, 0.08], r: [Math.PI / 2, 0, 0] });
      b.add('matte', P.torus(0.19, 0.035, 3, 10), trim, { p: [0, h - w / 2 - 0.05, 0.1] });
    }
    // Knob.
    b.add('metal', P.sphere(0.055, 6, 4), LOOK.gold, { p: [w * 0.3, h * 0.45, 0.13] });
    // Step.
    b.add('matte', P.box(w + 0.6, 0.2, 0.55), LOOK.stone, { p: [0, 0.1, 0.25], shade: { y0: 0, y1: 0.2, k: 0.85 } });
    // Hood.
    const hy = h + 0.2;
    if (hood === 'gable') {
      const hw = w / 2 + 0.45;
      const p = 0.62;
      const len = hw / Math.cos(p) + 0.12;
      const ridgeY = hy + Math.tan(p) * hw;
      for (const s of [-1, 1]) {
        b.add('matte', P.box(len, 0.1, 0.9), hoodColor, {
          p: [s * Math.cos(p) * (len / 2), ridgeY - Math.sin(p) * (len / 2) + 0.06, 0.45],
          r: [0, 0, -s * p],
        });
        // Diagonal bracket.
        b.add('matte', P.box(0.08, 0.62, 0.08), trim, { p: [s * (w / 2 + 0.22), hy - 0.18, 0.28], r: [0.78, 0, 0] });
      }
      const tri = P.extrude(`doortri:${hw.toFixed(2)}`, () => P.polyShape([[-hw + 0.12, 0], [hw - 0.12, 0], [0, Math.tan(p) * (hw - 0.12)]]), { depth: 0.06 });
      b.add('matte', tri, trim, { p: [0, hy + 0.02, 0.84] });
    } else if (hood === 'round') {
      b.add('matte', P.dome(w / 2 + 0.35, 10, 3), hoodColor, { p: [0, hy - 0.05, 0.05], s: [1, 0.75, 1.2] });
      b.add('matte', P.box(w + 0.8, 0.08, 0.1), trim, { p: [0, hy - 0.06, 0.05] });
    } else if (hood === 'awning') {
      addStripedAwning(b, w + 0.9, 0.8, hy + 0.35, stripe, trim, 0.55);
    }
  });
  doorCache.set(key, prefab);
  return prefab;
}

/**
 * Striped fabric awning against a wall (frame: wall at z = 0, +z outward).
 * Stripes alternate white and `stripe`; a scalloped valance hangs from the front edge.
 */
export function addStripedAwning(b: Bins, width: number, depth: number, top: number, stripe: string, white: string, drop: number): void {
  const n = Math.max(3, Math.round(width / 0.4) | 1);
  const sw = width / n;
  const slope = Math.atan2(drop, depth);
  const len = Math.hypot(depth, drop);
  for (let i = 0; i < n; i += 1) {
    const x = -width / 2 + (i + 0.5) * sw;
    const c = i % 2 === 0 ? stripe : white;
    b.add('matte', P.box(sw + 0.002, 0.04, len), c, { p: [x, top - drop / 2, depth / 2], r: [slope, 0, 0] });
    // Valance scallop.
    b.add('matte', P.halfDisc(sw / 2, 0.035), c, { p: [x, top - drop - 0.01, depth + 0.005], r: [-slope * 0.3, 0, 0] });
  }
  // Side cheeks.
  const cheek = P.extrude(`cheek:${depth.toFixed(2)}:${drop.toFixed(2)}`, () => P.polyShape([[0, 0], [depth, -drop], [depth, -drop - 0.12], [0, -0.12]]), { depth: 0.03 });
  for (const s of [-1, 1]) b.add('matte', cheek, stripe, { p: [s * (width / 2), top, 0], r: [0, -Math.PI / 2, 0] });
}

// ---------------------------------------------------------------------------
// Roofs
// ---------------------------------------------------------------------------

interface RoofParams {
  span: number;
  length: number;
  pitch: number;
  style: RoofStyle;
  color: string;
  trim: string;
  detail: number;
  /** Decorative bargeboards on the gable ends. */
  gableTrim: boolean;
  /** Which slopes (roof-frame ±X) are visible and get tile courses; others are one smooth slab. */
  fullRight: boolean;
  fullLeft: boolean;
  thickness?: number;
}

/**
 * Gable roof in a frame whose origin is the inner ridge point, ridge along Z,
 * slopes falling toward ±X. `span` is the half width covered by the walls.
 */
function gableRoof(b: Bins, rp: RoofParams): { ridgeY: number } {
  const p = rp.pitch;
  const t = rp.thickness ?? (rp.style === 'puffy' ? 0.3 : 0.17);
  const eave = rp.style === 'puffy' ? 0.5 : 0.42;
  const overhang = rp.style === 'puffy' ? 0.35 : 0.3;
  const L = rp.span / Math.cos(p) + eave;
  const len = rp.length + overhang * 2;
  const deep = hexOf(darker(rp.color, 0.9));
  const cos = Math.cos(p);
  const sin = Math.sin(p);

  const slope = (full: boolean) => {
    if (rp.style === 'puffy') {
      const g = P.rbox(L + 0.1, t, len, t * 0.48, full ? 2 : 1);
      b.add('matte', g, rp.color, { p: [cos * (L / 2 - 0.05) + sin * (t / 2), -sin * (L / 2 - 0.05) + cos * (t / 2), 0], r: [0, 0, -p] });
      return;
    }
    if (!full || rp.detail < 2) {
      const g = P.extrude(`slab:${(L + 0.1).toFixed(2)}:${t.toFixed(2)}`, () => P.rectShape(L + 0.1, t, t * 0.45), { depth: len, curveSegments: 1 });
      b.add('matte', g, rp.color, { p: [cos * (L / 2 - 0.05) + sin * (t / 2), -sin * (L / 2 - 0.05) + cos * (t / 2), 0], r: [0, 0, -p] });
      return;
    }
    const n = Math.max(3, Math.round(L / 0.85));
    const cl = L / n;
    const tilt = 0.1;
    for (let i = 0; i < n; i += 1) {
      const ac = (i + 0.5) * cl;
      const c = i % 2 === 0 ? rp.color : deep;
      const x = cos * ac + sin * (t / 2);
      const y = -sin * ac + cos * (t / 2);
      const scallopRow = rp.style === 'scallop' && rp.detail >= 2 && i > 0;
      if (scallopRow) {
        addScallopCourse(b, cl + 0.12, len, t * 0.8, c, [x, y, 0], p - tilt);
      } else {
        const g = P.extrude(`course:${(cl + 0.1).toFixed(2)}:${t.toFixed(2)}`, () => P.rectShape(cl + 0.1, t, t * 0.45), { depth: len, curveSegments: 1 });
        b.add('matte', g, c, { p: [x, y, 0], r: [0, 0, -(p - tilt)] });
      }
    }
  };
  slope(rp.fullRight);
  b.within({ s: [-1, 1, 1] }, () => slope(rp.fullLeft));

  const ridgeY = t / cos;
  const ridgeColor = hexOf(darker(rp.color, 0.82));
  b.add('matte', P.cyl(t * 0.75, t * 0.75, len + 0.08, 8), ridgeColor, { p: [0, ridgeY * 0.82, 0], r: [Math.PI / 2, 0, 0] });
  // Bargeboards along the rakes at both gable ends.
  if (rp.gableTrim) {
    const bl = rp.span / cos + eave * 0.7;
    for (const zs of [-1, 1]) {
      for (const s of [-1, 1]) {
        b.add('matte', P.box(bl, 0.2, 0.07), rp.trim, {
          p: [s * cos * (bl / 2), -sin * (bl / 2) - 0.05, zs * (len / 2 - 0.04)],
          r: [0, 0, -s * p],
        });
      }
      if (rp.detail >= 2 && zs > 0) b.add('matte', P.sphere(0.11, 6, 4), rp.trim, { p: [0, 0.02, zs * (len / 2 - 0.02)] });
    }
  }
  return { ridgeY };
}

/** One tile course whose lower edge is scalloped, lying on a slope (right side, pitch p). */
function addScallopCourse(b: Bins, cl: number, len: number, t: number, color: string, center: [number, number, number], p: number): void {
  const n = Math.max(4, Math.round(len / 0.6));
  const r = len / (2 * n);
  const g = P.extrude(
    `scallop:${cl.toFixed(2)}:${len.toFixed(2)}:${n}`,
    () => {
      const s = new THREE.Shape();
      const hl = len / 2;
      const top = cl / 2;
      const bot = -cl / 2 + r;
      s.moveTo(-hl, top);
      s.lineTo(-hl, bot);
      for (let k = 0; k < n; k += 1) {
        const cx = -hl + r + k * 2 * r;
        s.absarc(cx, bot, r, Math.PI, 0, false);
      }
      s.lineTo(hl, top);
      s.lineTo(-hl, top);
      return s;
    },
    { depth: t, curveSegments: 2 },
  );
  // Shape X = along ridge (world Z), shape Y = up-slope, extrusion Z = slope normal.
  const up = new THREE.Vector3(-Math.cos(p), Math.sin(p), 0);
  const nrm = new THREE.Vector3(Math.sin(p), Math.cos(p), 0);
  const xAxis = new THREE.Vector3().crossVectors(up, nrm);
  const m = new THREE.Matrix4().makeBasis(xAxis, up, nrm).setPosition(center[0], center[1], center[2]);
  b.push(m);
  // Shape: lower edge is at -cl/2 (down-slope = -up).
  b.add('matte', g, color);
  b.pop();
}

/** Four-sided hip roof built from stacked tile courses. Frame origin at wall top center. */
function hipRoof(b: Bins, w: number, d: number, pitch: number, color: string, trim: string, detail: number): number {
  const e = 0.35;
  const hw = w / 2 + e;
  const hd = d / 2 + e;
  const h = Math.min(hw, hd) * Math.tan(pitch);
  const deep = hexOf(darker(color, 0.86));
  const n = detail >= 1 ? 3 : 1;
  for (let i = 0; i < n; i += 1) {
    const f0 = i / (n + 0.6);
    const f1 = (i + 1) / (n + 0.6);
    const lip = i === 0 ? 1 : 1.06;
    const y0 = f0 * h - 0.1;
    const y1 = f1 * h - 0.1;
    b.add('matte', P.frustum4((1 - f1) / ((1 - f0) * lip)), i % 2 === 0 ? color : deep, {
      p: [0, (y0 + y1) / 2, 0],
      s: [hw * (1 - f0) * lip, y1 - y0, hd * (1 - f0) * lip],
    });
  }
  // Cap.
  const fc = n / (n + 0.6);
  b.add('matte', P.pyramid(), n % 2 === 0 ? color : deep, { p: [0, fc * h - 0.1 + ((1 - fc) * h) / 2, 0], s: [hw * (1 - fc) * 1.03, (1 - fc) * h, hd * (1 - fc) * 1.03] });
  // Fascia.
  b.add('matte', P.box(w + 0.2, 0.16, d + 0.2), trim, { p: [0, -0.02, 0] });
  b.add('matte', P.sphere(0.13, 6, 4), hexOf(darker(color, 0.8)), { p: [0, h - 0.08, 0] });
  return h;
}

// ---------------------------------------------------------------------------
// Chimney / dormer / flags
// ---------------------------------------------------------------------------

function addChimney(b: Bins, x: number, yBase: number, z: number, h: number, scheme: Scheme): void {
  b.add('matte', P.box(0.62, 1, 0.62), LOOK.brick, { p: [x, yBase + h / 2, z], s: [1, h, 1], shade: { y0: yBase, y1: yBase + h, k: 0.85 } });
  b.add('matte', P.box(0.66, 0.07, 0.66), LOOK.brickDeep, { p: [x, yBase + h * 0.6, z] });
  b.add('matte', P.box(0.8, 0.14, 0.8), scheme.trim, { p: [x, yBase + h + 0.05, z] });
  b.add('matte', P.cyl(0.13, 0.15, 0.24, 7), LOOK.terracotta, { p: [x - 0.12, yBase + h + 0.22, z] });
}

export function addFlag(b: Bins, x: number, y: number, z: number, color: string, pole = 1.1): void {
  b.add('metal', P.cyl(0.028, 0.035, pole, 6), LOOK.gold, { p: [x, y + pole / 2, z] });
  b.add('metal', P.sphere(0.07, 8, 6), LOOK.gold, { p: [x, y + pole + 0.04, z] });
  const flag = P.extrude('pennant', () => P.polyShape([[0, 0], [0.62, -0.17], [0, -0.34]]), { depth: 0.02 });
  b.add('foliage', flag, color, {
    p: [x + 0.03, y + pole - 0.04, z],
    wind: (fx) => Math.max(0, fx - x) * 0.09,
  });
}

// ---------------------------------------------------------------------------
// Faces
// ---------------------------------------------------------------------------

function faceXf(face: Face, w: number, d: number): Xf {
  switch (face) {
    case 'front':
      return {};
    case 'back':
      return { p: [0, 0, -d], r: [0, Math.PI, 0] };
    case 'left':
      return { p: [-w / 2, 0, -d / 2], r: [0, -Math.PI / 2, 0] };
    case 'right':
      return { p: [w / 2, 0, -d / 2], r: [0, Math.PI / 2, 0] };
  }
}

function slots(len: number, spacing: number, min = 1): number[] {
  const n = Math.max(min, Math.floor((len - 0.5) / spacing));
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) out.push(-len / 2 + ((i + 0.5) * len) / n);
  return out;
}

// ---------------------------------------------------------------------------
// House
// ---------------------------------------------------------------------------

/** Build one house into `b` (frame: front-center at ground, facing +Z). */
export function buildHouse(b: Bins, spec: HouseSpec, rng: Rng): HouseInfo {
  const { w, d, floors, floorH, scheme } = spec;
  const wallTop = PLINTH + floors * floorH;
  const pitch = spec.pitch;
  const trim = scheme.trim;
  const wall = scheme.wall;
  const wallPaint: ColorFn = (() => {
    const c = col(wall);
    return (_x, y, _z, _nx, _ny, _nz, out) => {
      const t = Math.min(1, Math.max(0, (y - PLINTH) / 2.4));
      out.copy(c).multiplyScalar(0.84 + 0.16 * t * t * (3 - 2 * t));
    };
  })();
  const detail = spec.detail;

  // --- Body --------------------------------------------------------------
  const inset = 0.04;
  let gableH = 0;
  if (spec.roof === 'gableFront') {
    gableH = (w / 2) * Math.tan(pitch);
    const body = P.extrude(
      `bodyF:${w.toFixed(2)}:${wallTop.toFixed(2)}:${gableH.toFixed(2)}`,
      () => P.polyShape([[-w / 2 + inset, 0], [w / 2 - inset, 0], [w / 2 - inset, wallTop], [0, wallTop + gableH - inset], [-w / 2 + inset, wallTop]]),
      { depth: d - inset * 2, bevel: inset, bevelSegments: 1 },
    );
    b.add('matte', body, wallPaint, { p: [0, 0, -d / 2] });
  } else if (spec.roof === 'gableSide') {
    gableH = (d / 2) * Math.tan(pitch);
    const body = P.extrude(
      `bodyS:${d.toFixed(2)}:${wallTop.toFixed(2)}:${gableH.toFixed(2)}`,
      () => P.polyShape([[inset, 0], [d - inset, 0], [d - inset, wallTop], [d / 2, wallTop + gableH - inset], [inset, wallTop]]),
      { depth: w - inset * 2, bevel: inset, bevelSegments: 1 },
    );
    b.add('matte', body, wallPaint, { r: [0, Math.PI / 2, 0] });
  } else {
    b.add('matte', P.extrude(`bodyH:${w.toFixed(2)}:${d.toFixed(2)}:${wallTop.toFixed(2)}`, () => P.rectShape(w - inset * 2, wallTop), { depth: d - inset * 2, bevel: inset }), wallPaint, {
      p: [0, wallTop / 2, -d / 2],
    });
  }

  // Plinth, corner quoins, floor bands.
  b.add('matte', P.extrude(`plinth:${(w + 0.08).toFixed(2)}:${(d + 0.08).toFixed(2)}`, () => P.rectShape(w + 0.08, PLINTH - 0.08), { depth: d + 0.08, bevel: 0.04 }), LOOK.stone, {
    p: [0, PLINTH / 2, -d / 2],
    shade: { y0: 0, y1: PLINTH, k: 0.8 },
  });
  if (detail >= 2) {
    const qh = wallTop - PLINTH;
    for (const sx of [-1, 1]) {
      for (const sz of [0, 1]) {
        b.add('matte', P.box(0.17, qh, 0.17), trim, { p: [sx * (w / 2 - 0.03), PLINTH + qh / 2, sz === 0 ? -0.03 : -d + 0.03] });
      }
    }
    for (let f = 1; f < floors; f += 1) {
      b.add('matte', P.box(w + 0.07, 0.11, d + 0.07), trim, { p: [0, PLINTH + f * floorH, -d / 2] });
    }
  }
  // Eave band where walls meet the roof.
  if (spec.roof !== 'hip') b.add('matte', P.box(w + 0.06, 0.12, d + 0.06), trim, { p: [0, wallTop - 0.04, -d / 2] });

  // --- Roof --------------------------------------------------------------
  let height = wallTop;
  const roofParams = {
    pitch,
    style: spec.roofStyle,
    color: scheme.roof,
    trim,
    detail,
    gableTrim: detail >= 1,
  };
  const cam = spec.camSide;
  if (spec.roof === 'gableFront') {
    const shift = spec.bell ? 0.3 : 0;
    b.within({ p: [0, wallTop + gableH, -d / 2 - shift / 2] }, () => {
      // Slopes face house ±X: only the camera-facing one gets courses.
      const r = gableRoof(b, { ...roofParams, span: w / 2, length: d - shift, fullRight: cam > 0, fullLeft: cam < 0 });
      height = wallTop + gableH + r.ridgeY;
    });
  } else if (spec.roof === 'gableSide') {
    b.within({ p: [0, wallTop + gableH, -d / 2], r: [0, Math.PI / 2, 0] }, () => {
      // Rotated frame: roof-local -X faces the street (house +Z).
      const r = gableRoof(b, { ...roofParams, span: d / 2, length: w, fullRight: false, fullLeft: true });
      height = wallTop + gableH + r.ridgeY;
    });
  } else {
    b.within({ p: [0, wallTop, -d / 2] }, () => {
      height = wallTop + hipRoof(b, w, d, pitch, scheme.roof, trim, detail);
    });
  }

  // Chimney.
  if (spec.chimney !== null && detail >= 1) {
    const ch = 1.1 + rng() * 0.5;
    if (spec.roof === 'gableFront') {
      const zz = -d / 2 + spec.chimney * d * 0.7;
      const xx = (rng() < 0.5 ? -1 : 1) * w * 0.22;
      const yRoof = wallTop + gableH - Math.abs(xx) * Math.tan(pitch);
      addChimney(b, xx, yRoof - 0.3, zz, ch + 0.3, scheme);
    } else if (spec.roof === 'gableSide') {
      const xx = spec.chimney * w * 0.7;
      const zz = -d / 2 - d * 0.18;
      const yRoof = wallTop + gableH - Math.abs(zz + d / 2) * Math.tan(pitch);
      addChimney(b, xx, yRoof - 0.3, zz, ch + 0.3, scheme);
    } else {
      addChimney(b, spec.chimney * w * 0.5, wallTop, -d * 0.6, ch + 0.9, scheme);
    }
  }

  // --- Facades -----------------------------------------------------------
  const winW = spec.windows === 'round' ? 0.9 : 0.86;
  const winH = spec.windows === 'arch' ? 1.3 : 1.15;
  const flowerColors = spec.flowers;
  const boxColor = rng() < 0.5 ? LOOK.woodLight : scheme.trim;
  let fbVariant = 0;
  const flowerFor = (on: boolean) => (on ? { colors: flowerColors, box: boxColor, variant: (fbVariant += 1) % 3 } : null);
  const winDef = (style: WindowStyle, shutters: string | null): WindowDef => ({ style, w: style === 'round' ? 0.9 : winW, h: winH, trim, shutters });

  const frontStyle = spec.windows;
  const frontSlots = slots(w, 1.6, 2);
  // Door goes in the slot closest to doorU.
  let doorSlot = 0;
  frontSlots.forEach((u, i) => {
    if (Math.abs(u - spec.doorU) < Math.abs(frontSlots[doorSlot] - spec.doorU)) doorSlot = i;
  });
  const doorU = frontSlots[doorSlot];

  b.within(faceXf('front', w, d), () => {
    // Door.
    const dw = 1.02;
    const dh = 2.02;
    const hoodColor = scheme.roof;
    const stripe = spec.shop?.stripe ?? LOOK.stripes[Math.floor(rng() * LOOK.stripes.length)];
    b.stamp(doorPrefab(dw, dh, scheme.door, trim, spec.shop ? 'none' : spec.doorHood, hoodColor, stripe, detail), { p: [doorU, PLINTH - 0.2, 0.02] });
    if (detail >= 2 && !spec.shop) {
      // Lantern beside the door.
      const lx = doorU + (doorU > 0 ? -1 : 1) * 0.85;
      addWallLantern(b, lx, PLINTH + 1.85);
    }
    // Ground floor.
    if (spec.shop) {
      addShopFront(b, spec, doorU, w);
    } else {
      frontSlots.forEach((u, i) => {
        if (i === doorSlot || Math.abs(u - doorU) < 1.3) return;
        if (spec.bay && detail >= 2 && i === (doorSlot === 0 ? frontSlots.length - 1 : 0)) {
          addBayWindow(b, u, scheme, trim, spec);
          return;
        }
        addWindow(b, u, PLINTH + SILL, winDef(frontStyle, spec.shutters), flowerFor(spec.flowerBoxes && detail >= 2), detail < 2);
      });
    }
    // Upper floors.
    for (let f = 1; f < floors; f += 1) {
      const y = PLINTH + f * floorH + SILL - 0.1;
      const row = f >= 2 && frontSlots.length > 1 ? [0] : frontSlots;
      row.forEach((u, i) => {
        if (spec.balcony && f === 1 && detail >= 2 && i === doorSlot) {
          addBalcony(b, u, PLINTH + f * floorH, trim, flowerColors, spec);
          return;
        }
        const style = f === floors - 1 && spec.roof === 'gableSide' && frontSlots.length === 3 && i === 1 ? 'round' : frontStyle;
        addWindow(b, u, y, winDef(style, spec.shutters), flowerFor(spec.flowerBoxes && detail >= 2 && f === 1 && i !== doorSlot), detail < 2);
      });
    }
    // Gable window.
    if (spec.roof === 'gableFront' && gableH > 1.3 && !spec.bell) {
      if (spec.gableAccent && detail >= 1) addGableBoards(b, w, wallTop, gableH, spec.gableAccent, trim);
      const gy = wallTop + gableH * 0.3;
      addWindow(b, 0, gy, { style: rng() < 0.5 ? 'round' : 'arch', w: 0.8, h: 1.0, trim, shutters: null }, null, detail < 2);
    }
  });

  // The side wall facing the chase camera (the other side and the back are never seen from the road).
  const sideSlots = slots(d, 1.9, 1);
  const camFace: Face = cam < 0 ? 'left' : 'right';
  if (!(spec.tower !== 0 && Math.sign(spec.tower) === cam)) {
    b.within(faceXf(camFace, w, d), () => {
      for (let f = 0; f < Math.min(floors, 2); f += 1) {
        if (detail === 0 && f > 0) break;
        const y = PLINTH + f * floorH + SILL - (f > 0 ? 0.1 : 0);
        sideSlots.forEach((u) => addWindow(b, u, y, winDef(frontStyle === 'round' ? 'rect' : frontStyle, detail >= 2 ? spec.shutters : null), null, detail < 2));
      }
      if (spec.roof === 'gableSide' && gableH > 1.2 && detail >= 1) {
        addWindow(b, 0, wallTop + gableH * 0.28, { style: 'round', w: 0.78, h: 0.78, trim, shutters: null }, null, detail < 2);
      }
    });
  }

  // Backs are only seen from above: cheap lit-window slabs.
  if (detail >= 1) {
    b.within(faceXf('back', w, d), () => {
      const backSlots = slots(w, 2.7, 1);
      for (let f = 0; f < Math.min(floors, 2); f += 1) {
        backSlots.forEach((u) => addWindow(b, u, PLINTH + f * floorH + SILL, winDef('rect', null), null, true));
      }
    });
  }

  // Dormers on a side-gable roof.
  if (spec.roof === 'gableSide' && spec.dormers > 0 && detail >= 1) {
    const ds = spec.dormers === 1 ? [0] : [-w * 0.24, w * 0.24];
    for (const x of ds) addDormer(b, x, wallTop, d, pitch, scheme, detail < 2);
  }

  // Tower.
  if (spec.tower !== 0) {
    const tr = Math.min(1.7, Math.max(1.2, w * 0.24));
    const th = wallTop + 1.6 + rng() * 1.2;
    const tx = spec.tower * (w / 2 + tr * 0.35);
    b.within({ p: [tx, 0, -tr * 0.9] }, () => {
      const top = buildTower(b, { r: tr, h: th, scheme, detail, windows: spec.windows === 'round' ? 'arch' : spec.windows, flag: rng.pick(LOOK.stripes) }, rng);
      height = Math.max(height, top);
    });
  }

  // Bell gable facade (townhouse).
  if (spec.bell) addBellGable(b, w, wallTop, gableH, scheme);

  return { doorU, height, wallTop };
}

function addWallLantern(b: Bins, x: number, y: number): void {
  b.add('metal', P.box(0.06, 0.06, 0.22), LOOK.iron, { p: [x, y + 0.1, 0.11] });
  b.add('metal', P.cyl(0.02, 0.12, 0.12, 6), LOOK.iron, { p: [x, y + 0.2, 0.22] });
  b.add('glow', P.sphere(0.1, 7, 5), '#fff3cc', { p: [x, y + 0.05, 0.22] });
  b.add('metal', P.cyl(0.05, 0.05, 0.05, 6), LOOK.iron, { p: [x, y - 0.07, 0.22] });
}

function addGableBoards(b: Bins, w: number, wallTop: number, gableH: number, accent: string, trim: string): void {
  const hw = w / 2 - 0.25;
  const hh = gableH * (hw / (w / 2)) - 0.12;
  const tri = P.extrude(`gableAccent:${hw.toFixed(2)}:${hh.toFixed(2)}`, () => P.polyShape([[-hw, 0], [hw, 0], [0, hh]]), { depth: 0.05 });
  b.add('matte', tri, accent, { p: [0, wallTop + 0.1, 0.03] });
  const n = Math.max(2, Math.floor(hw / 0.55));
  for (let i = -n; i <= n; i += 1) {
    const x = (i / (n + 0.5)) * hw;
    const hAt = hh * (1 - Math.abs(x) / hw);
    if (hAt < 0.25) continue;
    b.add('matte', P.box(0.07, hAt, 0.03), trim, { p: [x, wallTop + 0.1 + hAt / 2, 0.065] });
  }
}

function addBayWindow(b: Bins, u: number, scheme: Scheme, trim: string, spec: HouseSpec): void {
  const bw = 1.7;
  const bd = 0.62;
  const bh = 1.75;
  const y0 = PLINTH + 0.25;
  b.add('matte', P.box(bw, bh, bd), scheme.wall, { p: [u, y0 + bh / 2, bd / 2 - 0.02] });
  b.add('matte', P.box(bw + 0.14, 0.12, bd + 0.12), trim, { p: [u, y0 + 0.02, bd / 2] });
  // Windows on three faces.
  b.stamp(windowPrefab({ style: 'rect', w: 1.1, h: 1.05, trim, shutters: null }), { p: [u, y0 + 0.4, bd - 0.01] });
  for (const s of [-1, 1]) {
    b.stamp(windowPrefab({ style: 'rect', w: 0.36, h: 1.05, trim, shutters: null }), { p: [u + s * (bw / 2 - 0.01), y0 + 0.4, bd / 2], r: [0, s * Math.PI / 2, 0] });
  }
  // Little roof.
  b.add('matte', P.box(bw + 0.3, 0.14, bd + 0.35), spec.scheme.roof, { p: [u, y0 + bh + 0.12, bd / 2 + 0.05], r: [0.35, 0, 0] });
}

function addBalcony(b: Bins, u: number, floorY: number, trim: string, flowers: readonly string[], spec: HouseSpec): void {
  const bw = 1.8;
  const bd = 0.75;
  // Door-window behind.
  b.stamp(windowPrefab({ style: 'arch', w: 0.95, h: 1.9, trim, shutters: spec.shutters }), { p: [u, floorY + 0.1, 0] });
  b.add('matte', P.box(bw, 0.14, bd), trim, { p: [u, floorY + 0.02, bd / 2] });
  // Brackets.
  for (const s of [-1, 1]) b.add('matte', P.box(0.1, 0.35, bd * 0.8), trim, { p: [u + s * (bw / 2 - 0.2), floorY - 0.18, bd * 0.4] });
  // Railing: posts + rail.
  const n = 8;
  for (let i = 0; i < n; i += 1) {
    const x = u - bw / 2 + 0.08 + (i / (n - 1)) * (bw - 0.16);
    b.add('matte', P.box(0.05, 0.62, 0.05), trim, { p: [x, floorY + 0.4, bd - 0.07] });
  }
  for (const s of [-1, 1]) b.add('matte', P.box(0.05, 0.62, 0.05), trim, { p: [u + s * (bw / 2 - 0.08), floorY + 0.4, bd / 2] });
  b.add('matte', P.box(bw, 0.07, 0.09), trim, { p: [u, floorY + 0.73, bd - 0.07] });
  for (const s of [-1, 1]) b.add('matte', P.box(0.09, 0.07, bd), trim, { p: [u + s * (bw / 2 - 0.08), floorY + 0.73, bd / 2] });
  // Flower pots on the balcony.
  for (const s of [-1, 1]) {
    const x = u + s * (bw / 2 - 0.3);
    b.add('matte', P.cyl(0.14, 0.1, 0.22, 7), LOOK.terracotta, { p: [x, floorY + 0.2, bd - 0.28] });
    b.add('foliage', P.sphere(0.2, 7, 5), '#63bb6f', { p: [x, floorY + 0.42, bd - 0.28], wind: 0.015 });
    for (let k = 0; k < 3; k += 1) {
      b.add('foliage', P.ico(0.07, 0), flowers[k % flowers.length], { p: [x + Math.cos(k * 2.1) * 0.13, floorY + 0.53, bd - 0.28 + Math.sin(k * 2.1) * 0.13], wind: 0.02 });
    }
  }
}

function addDormer(b: Bins, x: number, wallTop: number, d: number, pitch: number, scheme: Scheme, lite: boolean): void {
  const dw = 1.25;
  const dh = 1.25;
  // Dormer front sits at distance `a` from the facade inward (house z).
  const a = 0.75;
  const zFront = -a;
  const yBase = wallTop + a * Math.tan(pitch) - 0.25;
  const depth = Math.min(d / 2 - a, 1.9);
  b.add('matte', P.box(dw, dh, depth), scheme.wall, { p: [x, yBase + dh / 2, zFront - depth / 2] });
  // Mini gable roof (ridge along z).
  const p = 0.72;
  const hw = dw / 2 + 0.12;
  const len = hw / Math.cos(p);
  for (const s of [-1, 1]) {
    b.add('matte', P.box(len + 0.14, 0.12, depth + 0.3), scheme.roof, {
      p: [x + s * (Math.cos(p) * len) / 2, yBase + dh + (Math.sin(p) * len) / 2 - 0.02, zFront - depth / 2 + 0.12],
      r: [0, 0, -s * p],
    });
  }
  const tri = P.extrude(`dormerTri:${dw}`, () => P.polyShape([[-dw / 2, 0], [dw / 2, 0], [0, Math.tan(p) * (dw / 2)]]), { depth: 0.08 });
  b.add('matte', tri, scheme.wall, { p: [x, yBase + dh, zFront - 0.04] });
  b.within({ p: [x, 0, zFront] }, () => {
    addWindow(b, 0, yBase + 0.28, { style: 'arch', w: 0.62, h: 0.85, trim: scheme.trim, shutters: null }, null, lite);
  });
}

export interface TowerSpec {
  r: number;
  h: number;
  scheme: Scheme;
  detail: number;
  windows: WindowStyle;
  flag: string | null;
}

/** Round tower with a flared cone roof. Frame origin at the tower base center. Returns the top height. */
export function buildTower(b: Bins, t: TowerSpec, rng: Rng): number {
  const { r, h, scheme } = t;
  const wallPaint: ColorFn = (_x, y, _z, _nx, _ny, _nz, out) => {
    const k = Math.min(1, Math.max(0, (y - PLINTH) / 2.4));
    out.copy(col(scheme.wall)).multiplyScalar(0.84 + 0.16 * k);
  };
  b.add('matte', P.cyl(r, r, 1, 18, true), wallPaint, { p: [0, h / 2, 0], s: [1, h, 1] });
  b.add('matte', P.cyl(r + 0.1, r + 0.12, PLINTH, 18, true), LOOK.stone, { p: [0, PLINTH / 2, 0], shade: { y0: 0, y1: PLINTH, k: 0.8 } });
  b.add('matte', P.torus(r, 0.08, 3, 18), scheme.trim, { p: [0, h - 0.05, 0], r: [Math.PI / 2, 0, 0] });
  if (h > 5 && t.detail >= 2) b.add('matte', P.torus(r, 0.06, 3, 18), scheme.trim, { p: [0, PLINTH + 2.5, 0], r: [Math.PI / 2, 0, 0] });
  // Cone roof with flared eave.
  const rr = r + 0.35;
  const ch = Math.round(rr * (1.9 + rng() * 0.5) * 4) / 4;
  const key = `towerRoof:${rr.toFixed(2)}:${ch.toFixed(2)}`;
  const roof = P.lathe(
    key,
    [
      [0.001, ch],
      [rr * 0.1, ch * 0.9],
      [rr * 0.32, ch * 0.58],
      [rr * 0.62, ch * 0.26],
      [rr * 0.9, ch * 0.06],
      [rr * 1.02, -0.02],
      [rr * 0.98, -0.1],
      [r * 0.9, -0.08],
    ],
    16,
    t.detail >= 2 ? 2 : 1,
  );
  const coneColor = scheme.roof === '#ee8d63' ? '#ff8198' : scheme.roof;
  const deep = darker(coneColor, 0.88);
  const roofPaint: ColorFn = (_x, y, _z, _nx, _ny, _nz, out) => {
    const band = Math.floor(((y + 0.2) / ch) * 5) % 2;
    out.copy(band === 0 ? col(coneColor) : deep);
  };
  b.add('matte', roof, roofPaint, { p: [0, h, 0] });
  const top = h + ch;
  b.add('metal', P.sphere(0.12, 8, 6), LOOK.gold, { p: [0, top + 0.02, 0] });
  if (t.flag) addFlag(b, 0, top + 0.05, 0, t.flag, 1.0);
  // Windows around the front half.
  const nWin = t.detail >= 2 ? 2 : 1;
  const floors = Math.max(1, Math.floor((h - PLINTH - 0.4) / 2.5));
  for (let f = 0; f < floors; f += 1) {
    for (let i = 0; i < nWin; i += 1) {
      const a = (nWin === 1 ? 0 : (i / (nWin - 1) - 0.5) * 1.5) + (f % 2 === 1 ? 0.3 : 0);
      if (f === 0 && Math.abs(a) < 0.2) continue;
      b.within({ p: [Math.sin(a) * r, 0, Math.cos(a) * r], r: [0, a, 0] }, () => {
        addWindow(b, 0, PLINTH + f * 2.5 + SILL, { style: t.windows === 'rect' ? 'arch' : t.windows, w: 0.66, h: 1.1, trim: scheme.trim, shutters: null }, null, t.detail < 2);
      });
    }
  }
  // Small door facing front.
  b.within({ p: [0, 0, r] }, () => {
    b.stamp(doorPrefab(0.9, 1.9, scheme.door, scheme.trim, 'none', scheme.roof, LOOK.stripes[0], t.detail), { p: [0, PLINTH - 0.2, 0.02] });
  });
  return top;
}

function addBellGable(b: Bins, w: number, wallTop: number, gableH: number, scheme: Scheme): void {
  const hw = w / 2;
  const gh = gableH + 0.9;
  const shape = () => {
    const s = new THREE.Shape();
    s.moveTo(-hw, 0);
    s.lineTo(hw, 0);
    s.lineTo(hw, 0.25);
    s.bezierCurveTo(hw, gh * 0.45, hw * 0.35, gh * 0.4, hw * 0.35, gh * 0.72);
    s.lineTo(hw * 0.35, gh * 0.82);
    s.quadraticCurveTo(hw * 0.35, gh, 0, gh);
    s.quadraticCurveTo(-hw * 0.35, gh, -hw * 0.35, gh * 0.82);
    s.lineTo(-hw * 0.35, gh * 0.72);
    s.bezierCurveTo(-hw * 0.35, gh * 0.4, -hw, gh * 0.45, -hw, 0.25);
    s.lineTo(-hw, 0);
    return s;
  };
  const key = `bell:${w.toFixed(2)}:${gh.toFixed(2)}`;
  const trimG = P.extrude(`${key}:t`, shape, { depth: 0.22, curveSegments: 5 });
  b.add('matte', trimG, scheme.trim, { p: [0, wallTop - 0.1, 0.08], s: [1.06, 1.05, 1] });
  const panel = P.extrude(`${key}:p`, shape, { depth: 0.26, curveSegments: 5 });
  b.add('matte', panel, scheme.wall, { p: [0, wallTop - 0.1, 0.12] });
  b.add('metal', P.sphere(0.1, 6, 4), LOOK.gold, { p: [0, wallTop - 0.1 + gh * 1.05 + 0.08, 0.12] });
  b.within({ p: [0, 0, 0.26] }, () => {
    addWindow(b, 0, wallTop + gh * 0.3, { style: 'arch', w: 0.7, h: 1.05, trim: scheme.trim, shutters: null }, null);
  });
}

function addShopFront(b: Bins, spec: HouseSpec, doorU: number, w: number): void {
  const trim = spec.scheme.trim;
  const shop = spec.shop!;
  // Big display window beside the door.
  const side = doorU > 0 ? -1 : 1;
  const ww = Math.min(2.6, w / 2 - 0.4);
  const u = side * (w / 4 + 0.1);
  const y0 = PLINTH + 0.55;
  const wh = 1.55;
  b.add('matte', P.box(ww + 0.3, wh + 0.3, 0.1), trim, { p: [u, y0 + wh / 2, 0.03] });
  b.add('glass', P.box(ww, wh, 0.06), '#ffffff', { p: [u, y0 + wh / 2, 0.06] });
  for (let i = 1; i < 3; i += 1) b.add('matte', P.box(0.05, wh, 0.05), trim, { p: [u - ww / 2 + (i * ww) / 3, y0 + wh / 2, 0.1] });
  b.add('matte', P.box(ww + 0.45, 0.1, 0.3), trim, { p: [u, y0 - 0.1, 0.12] });
  // Goods on the sill.
  for (let i = 0; i < 5; i += 1) {
    const c = LOOK.flowers[(i * 3) % LOOK.flowers.length];
    b.add('matte', P.sphere(0.1, 6, 4), c, { p: [u - ww / 2 + 0.3 + i * ((ww - 0.6) / 4), y0 + 0.02, 0.2] });
  }
  // Awning across the ground floor.
  b.within({ p: [0, 0, 0.05] }, () => addStripedAwning(b, w - 0.2, 1.1, PLINTH + 2.55, shop.stripe, trim, 0.6));
  // Sign board over the door area.
  const sy = PLINTH + 3.05;
  b.add('matte', P.box(Math.min(2.6, w - 1), 0.5, 0.1), shop.stripe, { p: [0, sy, 0.07] });
  b.add('matte', P.box(Math.min(2.6, w - 1) + 0.14, 0.62, 0.06), trim, { p: [0, sy, 0.04] });
  // Hanging sign on a bracket.
  const hx = side * (w / 2 - 0.25);
  b.add('metal', P.box(0.05, 0.05, 0.85), LOOK.iron, { p: [hx, PLINTH + 3.3, 0.45] });
  b.add('matte', P.cyl(0.36, 0.36, 0.07, 12), trim, { p: [hx, PLINTH + 2.85, 0.75], r: [0, Math.PI / 2, Math.PI / 2] });
  const icon =
    shop.sign === 'heart' ? P.extrude('icon-heart', () => P.heartShape(0.42), { depth: 0.1 })
    : shop.sign === 'star' ? P.extrude('icon-star', () => P.starShape(0.25, 0.11), { depth: 0.1 })
    : shop.sign === 'flower' ? P.extrude('icon-flower', () => flowerShape(0.24), { depth: 0.1 })
    : P.extrude('icon-cup', () => cupShape(0.4), { depth: 0.1 });
  b.add('matte', icon, shop.stripe, { p: [hx, PLINTH + 2.85, 0.75], r: [0, Math.PI / 2, 0] });
}

function flowerShape(r: number): THREE.Shape {
  const s = new THREE.Shape();
  const n = 5;
  for (let i = 0; i <= n * 12; i += 1) {
    const a = (i / (n * 12)) * TAU;
    const rr = r * (0.62 + 0.38 * Math.abs(Math.cos((a * n) / 2)));
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  }
  return s;
}

function cupShape(size: number): THREE.Shape {
  const s = new THREE.Shape();
  const h = size / 2;
  s.moveTo(-h * 0.55, -h * 0.8);
  s.lineTo(h * 0.55, -h * 0.8);
  s.lineTo(h * 0.75, 0);
  s.quadraticCurveTo(h * 0.9, h * 0.6, 0, h * 0.95);
  s.quadraticCurveTo(-h * 0.9, h * 0.6, -h * 0.75, 0);
  s.lineTo(-h * 0.55, -h * 0.8);
  return s;
}

// ---------------------------------------------------------------------------
// Random specs
// ---------------------------------------------------------------------------

/** Snap to a grid so geometry caches (bodies, roof courses) get reused across houses. */
const snap = (v: number, step: number): number => Math.round(v / step) * step;

export function randomHouse(rng: Rng, scheme: Scheme, detail: 0 | 1 | 2, opts: Partial<HouseSpec> = {}): HouseSpec {
  const roof = rng.weighted<RoofKind>([
    ['gableFront', 5],
    ['gableSide', 4],
    ['hip', detail >= 2 ? 0.6 : 2],
  ]);
  const w = snap(roof === 'gableFront' ? rng.range(5.6, 7.0) : rng.range(6.4, 8.2), 0.4);
  const floors = rng.weighted([
    [1, 3],
    [2, 6],
  ]);
  const spec: HouseSpec = {
    w,
    d: snap(rng.range(5.0, 6.2), 0.4),
    floors,
    floorH: rng.pick([2.5, 2.6]),
    roof,
    roofStyle: rng.weighted<RoofStyle>([
      ['courses', 5],
      ['scallop', detail >= 2 ? 2.2 : 0],
      ['puffy', 2.5],
    ]),
    pitch: rng.pick([0.72, 0.8, 0.88]),
    scheme,
    shutters: rng.chance(0.5) ? rng.pick(LOOK.shutters) : null,
    windows: rng.weighted<WindowStyle>([
      ['rect', 4],
      ['arch', 4],
    ]),
    flowerBoxes: rng.chance(0.75),
    chimney: rng.chance(0.75) ? rng.range(-0.4, 0.4) : null,
    dormers: roof === 'gableSide' ? rng.weighted([
      [0, 1],
      [1, 2],
      [2, 2],
    ]) : 0,
    doorU: rng.chance(0.5) ? 0 : rng.sign() * w * 0.25,
    doorHood: rng.weighted<DoorHood>([
      ['gable', 3],
      ['round', 2],
      ['awning', 2],
      ['none', 1],
    ]),
    bay: rng.chance(0.3),
    balcony: floors >= 2 && rng.chance(0.3),
    detail,
    tower: 0,
    bell: false,
    shop: null,
    gableAccent: rng.chance(0.35) ? rng.pick(['#fff6ea', '#ffe7ef', '#fff1cf']) : null,
    flowers: rng.shuffle([...LOOK.flowers]).slice(0, 3),
    camSide: 1,
    ...opts,
  };
  if (spec.roof === 'hip' && spec.roofStyle !== 'courses') spec.roofStyle = 'courses';
  spec.w = snap(spec.w, 0.2);
  spec.d = snap(spec.d, 0.2);
  spec.pitch = snap(spec.pitch, 0.02);
  return spec;
}
