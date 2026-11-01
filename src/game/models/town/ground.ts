import * as THREE from 'three';
import { curved } from '../kit/materials';
import { PAL } from '../kit/palette';
import { Bins, col } from './bins';
import { makeRng, noise2, noise2Periodic, type Rng } from './rng';
import { memo } from './prims';
import { BIOME } from '../country/biome';
import type { Area } from '../../sim/route';

/**
 * Street ground for one chunk: rose cobblestone road, cream tiled sidewalks and
 * rolling lawns share ONE textured, vertex-colored mesh (receive-only shadows).
 * The texture is a procedural atlas (cobbles | lawn white | sidewalk tiles |
 * plaza bricks | curbstones) that repeats every TEX_REPEAT meters along the road,
 * so any chunk can follow any other without a seam. Every stone is also drawn into
 * a height map, which becomes the normal map: the sun catches each one. Curbs are
 * part of this mesh; sidewalk edging is a swept profile in the matte bin.
 */

export const CHUNK_LEN = 40;
export const ROAD_HALF = 4.3;
export const CURB_OUT = 4.6;
export const WALK_OUT = 6.2;
export const WALK_Y = 0.16;
export const LAWN_Y = 0.18;
export const LAWN_OUT = 60;
export const TEX_REPEAT = 8;
/** The lawn is flat up to here, then rises into a soft berm under the tree line. */
const BERM_X = 46;
/** Beyond this |x| the lawn uses a coarse grid (flat there, so the T-junction never cracks). */
const LAWN_SPLIT = 34;
/** Between the street band and LAWN_SPLIT the lawn uses 2 m rows (unless a plaza needs 1 m rows). */
const LAWN_MID = 16;

// Atlas layout (px). 128 px per meter along the road.
const PPM = 128;
const TW = 2048;
const TH = TEX_REPEAT * PPM;
const ROAD_PX = { x0: 24, w: Math.round(ROAD_HALF * 2 * PPM) };
const LAWN_PX = { x0: 1168, w: 40 };
const WALK_PX = { x0: 1248, w: Math.round((WALK_OUT - CURB_OUT) * PPM) };
const PLAZA_PX = { x0: 1512, w: 256 };
const CURB_PX = { x0: 1816, w: 128 };
const PLAZA_CELL = 2; // meters per plaza texture period
/** Heights are drawn at half the atlas size, in atlas coordinates. */
const RELIEF = 0.5;

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Baked ambient-occlusion blob on the lawn (rounded rectangle falloff). */
export interface Blob {
  x: number;
  z: number;
  hx: number;
  hz: number;
  /** Falloff distance beyond the core rectangle. */
  f: number;
  /** Darkening strength 0..1. */
  k: number;
}

export interface GroundPlan {
  index: number;
  seed: number;
  plazas: Rect[];
  blobs: Blob[];
  /** Countryside areas swap the sidewalks for grass verges and use their own lawn colors. */
  area?: Area;
  /** How far out the strip is built: 16 m, 34 m or (default) the full 60 m. */
  reach?: 16 | 34 | 60;
}

// ---------------------------------------------------------------------------
// Texture
// ---------------------------------------------------------------------------

let atlas: THREE.CanvasTexture | null = null;
let relief: THREE.CanvasTexture | null = null;
let groundMat: THREE.Material | null = null;
/** While the atlas is painted, stones are also drawn here as heights. */
let heights: CanvasRenderingContext2D | null = null;

function hex(c: THREE.Color): string {
  return `#${c.getHexString()}`;
}

function jitterColor(base: string, rng: Rng, amount: number): string {
  const c = new THREE.Color(base);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  hsl.h += (rng() - 0.5) * amount * 0.08;
  hsl.s *= 1 + (rng() - 0.5) * amount * 0.5;
  hsl.l += (rng() - 0.5) * amount * 0.08;
  c.setHSL(hsl.h, Math.min(1, Math.max(0, hsl.s)), Math.min(0.98, Math.max(0, hsl.l)));
  return hex(c);
}

/** One soft, rounded paving stone with a gentle bevel toward the sun (left / behind). */
function stone(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, rng: Rng, gap = 2.2, round = 0.36): void {
  const ix = x + gap;
  const iy = y + gap;
  const iw = w - gap * 2;
  const ih = h - gap * 2;
  if (iw <= 1 || ih <= 1) return;
  const r = Math.min(iw, ih) * round;
  if (heights) {
    // Stacked steps, smoothed later into a gently domed stone.
    const top = 0.62 + rng() * 0.38;
    for (const [step, lift] of [[0, 0.5], [0.09, 0.78], [0.2, 1]] as const) {
      const v = Math.round(lift * top * 255);
      const inset = Math.min(iw, ih) * step;
      heights.fillStyle = `rgb(${v},${v},${v})`;
      heights.beginPath();
      heights.roundRect(ix + inset, iy + inset, iw - inset * 2, ih - inset * 2, Math.max(1, r - inset));
      heights.fill();
    }
  }
  g.save();
  g.beginPath();
  g.roundRect(ix, iy, iw, ih, r);
  g.fillStyle = fill;
  g.fill();
  g.clip();
  // Bevel: lit toward canvas-left/bottom (world -x / +z = toward the sun), shaded opposite.
  const lg = g.createLinearGradient(ix, iy + ih, ix + iw, iy);
  lg.addColorStop(0, 'rgba(255,250,244,0.22)');
  lg.addColorStop(0.45, 'rgba(255,255,255,0.0)');
  lg.addColorStop(1, 'rgba(150,70,80,0.13)');
  g.fillStyle = lg;
  g.fillRect(ix, iy, iw, ih);
  // Soft rim.
  g.lineWidth = Math.max(1.5, Math.min(iw, ih) * 0.12);
  g.strokeStyle = 'rgba(160,86,96,0.14)';
  g.beginPath();
  g.roundRect(ix, iy, iw, ih, r);
  g.stroke();
  // Specks.
  const specks = Math.floor((iw * ih) / 260);
  for (let i = 0; i < specks; i += 1) {
    g.fillStyle = rng() < 0.5 ? 'rgba(255,250,244,0.16)' : 'rgba(150,84,90,0.09)';
    const sr = 0.6 + rng() * 1.3;
    g.beginPath();
    g.arc(ix + rng() * iw, iy + rng() * ih, sr, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/** Clip a stone-drawing callback on both the atlas and the height map. */
function clipped(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, draw: () => void): void {
  for (const c of [g, heights]) {
    c?.save();
    c?.beginPath();
    c?.rect(x, y, w, h);
    c?.clip();
  }
  draw();
  g.restore();
  heights?.restore();
}

/** Mortar sits below the stones: a dark floor in the height map. */
function floor(x: number, w: number): void {
  if (!heights) return;
  heights.fillStyle = '#000000';
  heights.fillRect(x, 0, w, TH);
}

function drawRoad(g: CanvasRenderingContext2D, rng: Rng): void {
  const { x0, w } = ROAD_PX;
  const grout = '#cf9098';
  g.fillStyle = grout;
  g.fillRect(x0, 0, w, TH);
  floor(x0, w);
  const stones = ['#f9cfca', '#f6c6c5', '#fbd5cd', '#f4c1c2', '#f8ccc0', '#fad6cd', '#f3bdbf'];
  const accents = ['#eda6b0', '#f9d6c8', '#eeb2a8'];
  const band = Math.round(0.42 * PPM);
  // Edge bands: two columns of long setts laid along the road.
  for (const side of [0, 1]) {
    const bx = side === 0 ? x0 : x0 + w - band;
    const colW = band / 2;
    for (let c = 0; c < 2; c += 1) {
      const len = 0.4 * PPM;
      const off = c === 0 ? 0 : len / 2;
      for (let yy = -len; yy < TH + len; yy += len) {
        const y = yy + off;
        const fill = jitterColor(rng() < 0.2 ? '#e6a7a8' : '#eeb6b4', rng, 0.4);
        clipped(g, bx, 0, band, TH, () => {
          stone(g, bx + c * colW, y, colW, len, fill, rng, 2.0, 0.3);
          // Wrap copies so the texture tiles along V.
          stone(g, bx + c * colW, y - TH, colW, len, fill, rng, 2.0, 0.3);
          stone(g, bx + c * colW, y + TH, colW, len, fill, rng, 2.0, 0.3);
        });
      }
    }
  }
  // Field: running courses of rounded cobbles across the road.
  const rowH = 0.25 * PPM;
  const rows = Math.round(TH / rowH);
  const fx0 = x0 + band;
  const fw = w - band * 2;
  for (let row = 0; row < rows; row += 1) {
    const y = row * rowH;
    let x = -rng() * rowH * 0.8;
    while (x < fw) {
      let sw = rowH * (0.95 + rng() * 0.75);
      if (fw - (x + sw) < rowH * 0.55) sw = fw - x;
      const fill = rng() < 0.1 ? jitterColor(rng.pick(accents), rng, 0.3) : jitterColor(rng.pick(stones), rng, 0.35);
      clipped(g, fx0, y, fw, rowH, () => stone(g, fx0 + x, y, sw, rowH, fill, rng));
      x += sw;
    }
  }
  // Center line: inlaid heart tiles every 2 m (gold rim, cream face).
  const cx = x0 + w / 2;
  const heart = (s: number): Path2D => {
    const p = new Path2D();
    const k = s / 2;
    // Canvas y grows downward: flip so the lobes point "forward" (up the texture).
    p.moveTo(0, k * 0.95);
    p.bezierCurveTo(-k * 0.2, k * 0.7, -k * 1.1, k * 0.2, -k * 1.0, -k * 0.35);
    p.bezierCurveTo(-k * 0.95, -k * 0.85, -k * 0.35, -k * 1.05, 0, -k * 0.6);
    p.bezierCurveTo(k * 0.35, -k * 1.05, k * 0.95, -k * 0.85, k * 1.0, -k * 0.35);
    p.bezierCurveTo(k * 1.1, k * 0.2, k * 0.2, k * 0.7, 0, k * 0.95);
    p.closePath();
    return p;
  };
  const spacing = 2 * PPM;
  for (let i = 0; i < TH / spacing; i += 1) {
    const cy = (i + 0.5) * spacing;
    g.save();
    g.translate(cx, cy);
    const size = 0.5 * PPM;
    if (heights) {
      // Inlaid tile: flat and level with the tops of the stones.
      heights.save();
      heights.translate(cx, cy);
      heights.fillStyle = '#c0c0c0';
      heights.fill(heart(size * 1.22));
      heights.restore();
    }
    g.fillStyle = '#d5a3b4';
    g.fill(heart(size * 1.22));
    g.fillStyle = '#f6c65f';
    g.fill(heart(size * 1.06));
    const face = g.createLinearGradient(-size / 2, size / 2, size / 2, -size / 2);
    face.addColorStop(0, '#ffffff');
    face.addColorStop(1, '#fbe7ee');
    g.fillStyle = face;
    g.fill(heart(size * 0.86));
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.beginPath();
    g.ellipse(-size * 0.17, -size * 0.1, size * 0.08, size * 0.05, -0.6, 0, Math.PI * 2);
    g.fill();
    g.restore();
    // Small gold dots between hearts.
    for (const dy of [-0.5, 0.5]) {
      g.fillStyle = '#d5a3b4';
      g.beginPath();
      g.arc(cx, cy + dy * spacing, 7.5, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#f7cf73';
      g.beginPath();
      g.arc(cx, cy + dy * spacing, 5.5, 0, Math.PI * 2);
      g.fill();
    }
  }
}

function drawWalk(g: CanvasRenderingContext2D, rng: Rng): void {
  const { x0, w } = WALK_PX;
  g.fillStyle = '#dfbea4';
  g.fillRect(x0, 0, w, TH);
  floor(x0, w);
  const across = 4;
  const tw = w / across;
  const th = 0.4 * PPM;
  const fills = ['#fbe6d4', '#f8dfca', '#f6dbc2', '#fbebdc', '#f7ddc8'];
  for (let j = 0; j < TH / th; j += 1) {
    for (let i = 0; i < across; i += 1) {
      const x = x0 + i * tw;
      const y = j * th;
      const special = rng() < 0.07;
      const fill = special ? rng.pick(['#fbdcd9', '#fbe2c9']) : jitterColor(rng.pick(fills), rng, 0.35);
      stone(g, x, y, tw, th, fill, rng, 2.0, 0.16);
      if (special) {
        // Tiny flower inlay.
        g.save();
        g.translate(x + tw / 2, y + th / 2);
        g.fillStyle = 'rgba(255,255,255,0.75)';
        for (let p = 0; p < 5; p += 1) {
          const a = (p / 5) * Math.PI * 2;
          g.beginPath();
          g.arc(Math.cos(a) * 6, Math.sin(a) * 6, 4.2, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = '#f7cf73';
        g.beginPath();
        g.arc(0, 0, 3.6, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    }
  }
}

function drawPlaza(g: CanvasRenderingContext2D, rng: Rng): void {
  const { x0, w } = PLAZA_PX;
  g.fillStyle = '#d9a39a';
  g.fillRect(x0, 0, w, TH);
  floor(x0, w);
  const sq = 0.5 * PPM;
  const fills = ['#f4c9b8', '#f1c0b2', '#f6d2c0', '#efbcb1', '#f7d8c8', '#f3c4bd'];
  for (let j = 0; j < TH / sq; j += 1) {
    for (let i = 0; i < w / sq; i += 1) {
      const x = x0 + i * sq;
      const y = j * sq;
      const vertical = (i + j) % 2 === 0;
      for (let b = 0; b < 2; b += 1) {
        const fill = jitterColor(rng.pick(fills), rng, 0.6);
        if (vertical) stone(g, x + b * (sq / 2), y, sq / 2, sq, fill, rng, 2.0, 0.22);
        else stone(g, x, y + b * (sq / 2), sq, sq / 2, fill, rng, 2.0, 0.22);
      }
    }
  }
}

/** Long curbstones with thin joints, along the road. */
function drawCurb(g: CanvasRenderingContext2D, rng: Rng): void {
  const { x0, w } = CURB_PX;
  g.fillStyle = '#cfc4c4';
  g.fillRect(x0, 0, w, TH);
  floor(x0, w);
  const len = TH / 7;
  for (let i = 0; i < 7; i += 1) {
    stone(g, x0 - 8, i * len, w + 16, len, jitterColor(rng.pick(['#fbf5ee', '#f6efe9', '#f2e9e6', '#f9f1e6']), rng, 0.35), rng, 2.4, 0.08);
  }
}

/** Copy wrapped/clamped columns into the gutters so mip filtering never bleeds foreign texels. */
function fillGutters(g: CanvasRenderingContext2D, canvas: HTMLCanvasElement, k = 1): void {
  const gut = 24;
  // Road and curbs: clamp (stretch the edge columns).
  for (const r of [ROAD_PX, CURB_PX]) {
    g.drawImage(canvas, r.x0 * k, 0, 1, TH * k, r.x0 - gut, 0, gut, TH);
    g.drawImage(canvas, (r.x0 + r.w) * k - 1, 0, 1, TH * k, r.x0 + r.w, 0, gut, TH);
  }
  // Periodic regions: wrap.
  for (const r of [WALK_PX, PLAZA_PX]) {
    g.drawImage(canvas, (r.x0 + r.w - gut) * k, 0, gut * k, TH * k, r.x0 - gut, 0, gut, TH);
    g.drawImage(canvas, r.x0 * k, 0, gut * k, TH * k, r.x0 + r.w, 0, gut, TH);
  }
}

/** One soft pass over the heights (wraps along the road, the direction the texture repeats). */
function soften(h: Float32Array, w: number, rows: number): Float32Array {
  const out = new Float32Array(h.length);
  for (let y = 0; y < rows; y += 1) {
    const up = ((y + rows - 1) % rows) * w;
    const down = ((y + 1) % rows) * w;
    const row = y * w;
    for (let x = 0; x < w; x += 1) {
      const l = x > 0 ? x - 1 : x;
      const r = x < w - 1 ? x + 1 : x;
      out[row + x] = (h[row + x] * 4 + (h[row + l] + h[row + r] + h[up + x] + h[down + x]) * 2 + h[up + l] + h[up + r] + h[down + l] + h[down + r]) / 16;
    }
  }
  return out;
}

/** Turn the height canvas into a tangent-space normal map. */
function reliefTexture(source: HTMLCanvasElement): THREE.CanvasTexture {
  const w = source.width;
  const rows = source.height;
  const ctx = source.getContext('2d', { willReadFrequently: true })!;
  const image = ctx.getImageData(0, 0, w, rows);
  let h: Float32Array = new Float32Array(w * rows);
  for (let i = 0; i < h.length; i += 1) h[i] = image.data[i * 4] / 255;
  h = soften(soften(h, w, rows), w, rows);
  const px = image.data;
  // Stone edge height over its width, in the same units: how steep the sun sees it.
  const strength = 2.1;
  for (let y = 0; y < rows; y += 1) {
    const up = ((y + rows - 1) % rows) * w;
    const down = ((y + 1) % rows) * w;
    for (let x = 0; x < w; x += 1) {
      const l = x > 0 ? x - 1 : x;
      const r = x < w - 1 ? x + 1 : x;
      // Canvas rows run opposite to v.
      const nx = (h[y * w + l] - h[y * w + r]) * strength;
      const ny = (h[down + x] - h[up + x]) * strength;
      const len = Math.hypot(nx, ny, 1);
      const o = (x + y * w) * 4;
      px[o] = Math.round((nx / len) * 127.5 + 127.5);
      px[o + 1] = Math.round((ny / len) * 127.5 + 127.5);
      px[o + 2] = Math.round((1 / len) * 127.5 + 127.5);
      px[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  const tex = new THREE.CanvasTexture(source);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.name = 'town-ground-relief';
  return tex;
}

export function groundTexture(): THREE.CanvasTexture {
  if (atlas) return atlas;
  const canvas = document.createElement('canvas');
  canvas.width = TW;
  canvas.height = TH;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, TW, TH);
  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = TW * RELIEF;
  heightCanvas.height = TH * RELIEF;
  const h = heightCanvas.getContext('2d', { willReadFrequently: true })!;
  h.fillStyle = '#808080';
  h.fillRect(0, 0, heightCanvas.width, heightCanvas.height);
  h.scale(RELIEF, RELIEF);
  heights = h;
  const rng = makeRng(20260927);
  drawRoad(g, rng);
  drawWalk(g, rng);
  drawPlaza(g, rng);
  drawCurb(g, rng);
  heights = null;
  fillGutters(g, canvas);
  fillGutters(h, heightCanvas, RELIEF);
  g.fillStyle = '#ffffff';
  g.fillRect(LAWN_PX.x0 - 8, 0, LAWN_PX.w + 16, TH);
  h.fillStyle = '#808080';
  h.fillRect(LAWN_PX.x0 - 8, 0, LAWN_PX.w + 16, TH);
  relief = reliefTexture(heightCanvas);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.name = 'town-ground-atlas';
  atlas = tex;
  return tex;
}

export function groundMaterial(): THREE.Material {
  if (groundMat) return groundMat;
  const m = curved(
    new THREE.MeshStandardMaterial({
      map: groundTexture(),
      normalMap: relief,
      vertexColors: true,
      roughness: 0.8,
      metalness: 0,
    }),
    { detail: 'grass', lawnU: [(LAWN_PX.x0 - 6) / TW, (LAWN_PX.x0 + LAWN_PX.w + 6) / TW] },
  );
  m.name = 'town-ground';
  groundMat = m;
  return m;
}

// ---------------------------------------------------------------------------
// Ground mesh
// ---------------------------------------------------------------------------

/** Lawn height: flat near the street, a soft berm near the far edge. Depends on |x| and periodic z only. */
export function lawnHeight(ax: number, z: number): number {
  if (ax < BERM_X) return LAWN_Y;
  const t = Math.min(1, Math.max(0, (ax - BERM_X) / (LAWN_OUT - BERM_X)));
  const berm = t * t * (3 - 2 * t) * 1.5;
  const roll = (noise2Periodic(ax * 0.12, -z * 0.1, 4, 71) - 0.5) * 1.1 * Math.min(1, (ax - BERM_X) / 8);
  return LAWN_Y + berm + roll;
}

interface Writer {
  pos: number[];
  nor: number[];
  uv: number[];
  colr: number[];
  idx: number[];
}

function vert(w: Writer, x: number, y: number, z: number, u: number, v: number, c: THREE.Color, nx = 0, ny = 1, nz = 0): number {
  w.pos.push(x, y, z);
  w.nor.push(nx, ny, nz);
  w.uv.push(u, v);
  w.colr.push(c.r, c.g, c.b);
  return w.pos.length / 3 - 1;
}

const cA = new THREE.Color();
const cB = new THREE.Color();

function blobShade(blobs: Blob[], x: number, z: number): number {
  let k = 1;
  for (const b of blobs) {
    const dx = Math.max(0, Math.abs(x - b.x) - b.hx);
    const dz = Math.max(0, Math.abs(z - b.z) - b.hz);
    const d = Math.sqrt(dx * dx + dz * dz) / b.f;
    if (d >= 1) continue;
    const t = 1 - d;
    k *= 1 - b.k * t * t * (3 - 2 * t);
  }
  // Fade AO toward chunk borders so neighbours always match.
  const border = Math.min(1, Math.min(-z, CHUNK_LEN + z) / 2.5);
  return 1 - (1 - k) * border;
}

function lawnColor(plan: GroundPlan, x: number, z: number, out: THREE.Color): THREE.Color {
  const ax = Math.abs(x);
  const side = x < 0 ? 0 : 1;
  const n1 = noise2Periodic(ax * 0.2 + side * 17, -z * 0.2, 8, 11);
  const n2 = noise2Periodic(ax * 0.55 + side * 5, -z * 0.5, 20, 12);
  const win = Math.sin((Math.PI * -z) / CHUNK_LEN) ** 2;
  const n3 = noise2(ax * 0.3, -z * 0.3 + plan.index * 12.0, plan.seed % 997) * win + 0.5 * (1 - win);
  let t = 0.5 + (n1 - 0.5) * 0.9 + (n2 - 0.5) * 0.35 + (n3 - 0.5) * 0.5;
  if (plan.area) {
    const tone = BIOME[plan.area];
    t = Math.min(1, Math.max(0, t));
    if (t < 0.5) out.copy(col(tone.deep)).lerp(col(tone.base), t * 2);
    else out.copy(col(tone.base)).lerp(col(tone.light), (t - 0.5) * 2);
    return out;
  }
  // Well-kept verge next to the sidewalk, deeper meadow far out.
  t += 0.18 * (1 - Math.min(1, Math.max(0, (ax - 6.2) / 3)));
  t -= 0.1 * Math.min(1, Math.max(0, (ax - 34) / 16));
  t = Math.min(1, Math.max(0, t));
  if (t < 0.5) out.copy(col(PAL.grassDeep)).lerp(col(PAL.grass), t * 2);
  else out.copy(col(PAL.grass)).lerp(col(PAL.grassLight), (t - 0.5) * 2 * 0.8);
  // A touch of sage far out, like aerial perspective.
  const far = Math.min(1, Math.max(0, (ax - 30) / 25));
  out.lerp(col(PAL.leafSage), far * 0.25);
  // Patchwork meadow fields beyond the back gardens. Field edges coincide with
  // chunk borders and fade to the plain lawn, so neighbours always match.
  if (ax > FIELD_X0) {
    const fx = Math.floor((ax - FIELD_X0) / FIELD_W);
    const fzF = -z / FIELD_L;
    const fz = Math.floor(fzF);
    const ex = Math.min(ax - (FIELD_X0 + fx * FIELD_W), FIELD_X0 + (fx + 1) * FIELD_W - ax);
    const ez = Math.min(fzF - fz, fz + 1 - fzF) * FIELD_L;
    const edge = Math.min(1, Math.max(0, (Math.min(ex, ez) - 0.4) / 1.4));
    const tintIdx = hashField(plan, side, fx, fz);
    if (tintIdx >= 0) out.lerp(col(FIELD_TINTS[tintIdx]), 0.55 * edge * edge * (3 - 2 * edge));
  }
  return out;
}

/** Meadow patchwork (|x| from FIELD_X0 to the berm). */
export const FIELD_X0 = 29;
export const FIELD_W = 9.5;
export const FIELD_L = CHUNK_LEN / 3;
const FIELD_TINTS = ['#b9e59b', '#a6dca2', '#cfe8a2', '#9fdab4', '#c4e3a0', '#e0ecaa', '#a9e0a8'];

function hashField(plan: GroundPlan, side: number, fx: number, fz: number): number {
  const h = Math.abs(Math.sin((plan.index * 7.13 + fx * 3.7 + fz * 11.3 + side * 5.1 + (plan.seed % 97) * 0.37) * 43758.5453)) % 1;
  if (h < 0.18) return -1;
  return Math.floor(((h - 0.18) / 0.82) * FIELD_TINTS.length) % FIELD_TINTS.length;
}

function inRects(rects: Rect[], x: number, z: number): boolean {
  for (const r of rects) if (x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1) return true;
  return false;
}

/** Road + sidewalks + lawns (+ plazas) for one chunk. */
/** Exact triangle count of the ground mesh for a plan (colors skipped). */
export function groundTriangles(plan: GroundPlan): number {
  const w: Writer = { pos: [], nor: [], uv: [], colr: [], idx: [] };
  writeGround(plan, w, true);
  return w.idx.length / 3;
}

export function buildGroundGeometry(plan: GroundPlan): THREE.BufferGeometry {
  const w: Writer = { pos: [], nor: [], uv: [], colr: [], idx: [] };
  writeGround(plan, w, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(w.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(w.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(w.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(w.colr, 3));
  g.setIndex(w.idx);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function writeGround(plan: GroundPlan, w: Writer, dry: boolean): void {
  const L = CHUNK_LEN;
  const uOf = (px: number) => px / TW;
  const vOf = (z: number) => -z / TEX_REPEAT;
  const verge = plan.area !== undefined && plan.area !== 'castle';
  const reach = plan.reach ?? 60;

  // Road strip.
  {
    const xs = [-ROAD_HALF - 0.02, -4.0, -3.5, -2.2, -0.8, 0, 0.8, 2.2, 3.5, 4.0, ROAD_HALF + 0.02];
    const rows = 21;
    const base = w.pos.length / 3;
    for (let j = 0; j < rows; j += 1) {
      const z = -(j / (rows - 1)) * L;
      for (const x of xs) {
        const edge = Math.min(1, Math.max(0, (Math.abs(x) - 3.4) / 0.9));
        const k = 1 - 0.1 * edge * edge;
        cA.setRGB(k, k * 0.995, k);
        vert(w, x, 0, z, uOf(ROAD_PX.x0 + ((x + ROAD_HALF) / (ROAD_HALF * 2)) * ROAD_PX.w), vOf(z), cA);
      }
    }
    grid(w, base, xs.length, rows);
  }

  // Curbs: stone blocks from the atlas, up the road face and across the top.
  for (const s of [-1, 1]) {
    const rows = 21;
    const base = w.pos.length / 3;
    for (let j = 0; j < rows; j += 1) {
      const z = -(j / (rows - 1)) * L;
      CURB_PROFILE.forEach(([x, y], i) => {
        const [nx, ny] = CURB_NORMALS[i];
        const k = y < 0.1 ? 0.8 + 1.8 * Math.max(0, y) : 1;
        cA.setRGB(k, k, k);
        vert(w, s * x, y, z, uOf(CURB_PX.x0 + 6 + CURB_ALONG[i] * (CURB_PX.w - 12)), vOf(z), cA, s * nx, ny, 0);
      });
    }
    grid(w, base, CURB_PROFILE.length, rows, s < 0);
  }

  // Sidewalks.
  for (const s of [-1, 1]) {
    const ax = [CURB_OUT - 0.1, 4.85, 5.4, 5.9, WALK_OUT + 0.06];
    const xs = s < 0 ? ax.map((v) => -v).reverse() : ax;
    const rows = 21;
    const base = w.pos.length / 3;
    for (let j = 0; j < rows; j += 1) {
      const z = -(j / (rows - 1)) * L;
      for (const x of xs) {
        const a = Math.abs(x);
        const nearCurb = 1 - Math.min(1, Math.max(0, (a - CURB_OUT) / 0.35));
        const nearEdge = Math.min(1, Math.max(0, (a - 5.9) / 0.3));
        const k = (1 - 0.1 * nearCurb) * (1 - 0.05 * nearEdge);
        cA.setRGB(k, k, k);
        if (verge) {
          // Grass right up to the curb, with the shared white lawn cell of the atlas.
          lawnColor(plan, x, z, cA);
          cA.multiplyScalar(k);
          vert(w, x, WALK_Y, z, uOf(LAWN_PX.x0 + LAWN_PX.w / 2), 0.5, cA);
          continue;
        }
        const px = WALK_PX.x0 + ((a - CURB_OUT) / (WALK_OUT - CURB_OUT)) * WALK_PX.w;
        vert(w, x, WALK_Y, z, uOf(px), vOf(z), cA);
      }
    }
    grid(w, base, xs.length, rows);
  }

  // Lawns (+ plaza cut-outs): a fine grid near the street, a coarse one beyond.
  const lawnU = uOf(LAWN_PX.x0 + LAWN_PX.w / 2);
  for (const s of [-1, 1]) {
    for (const zone of [0, 1, 2]) {
      if ((zone === 1 && reach < 34) || (zone === 2 && reach < 60)) continue;
      const ax: number[] = [];
      if (zone === 0) {
        for (let x = WALK_OUT; x < LAWN_MID - 0.01; x += 1.3) ax.push(x);
        ax.push(LAWN_MID);
      } else if (zone === 1) {
        for (let x = LAWN_MID; x < LAWN_SPLIT - 0.01; x += 2.3) ax.push(x);
        ax.push(LAWN_SPLIT);
      } else {
        for (let x = LAWN_SPLIT; x < LAWN_OUT - 0.01; x += 3.25) ax.push(x);
        ax.push(LAWN_OUT);
      }
      if (zone < 2) {
        const lo = zone === 0 ? WALK_OUT : LAWN_MID;
        const hi = zone === 0 ? LAWN_MID : LAWN_SPLIT;
        for (const r of plan.plazas) {
          for (const e of [r.x0, r.x1]) {
            if (Math.sign(e) === s && Math.abs(e) > lo && Math.abs(e) < hi) ax.push(Math.abs(e));
          }
        }
      }
      const uniq = Array.from(new Set(ax.map((v) => Math.round(v * 1000) / 1000))).sort((a, b) => a - b);
      const xs = s < 0 ? uniq.map((v) => -v).reverse() : uniq;
      // Plazas need 1 m rows wherever they reach.
      const plazaHere = plan.plazas.some((r) => Math.max(Math.abs(r.x0), Math.abs(r.x1)) > (zone === 0 ? WALK_OUT : LAWN_MID) && zone < 2 && (Math.sign(r.x0) === s || Math.sign(r.x1) === s));
      const rows = zone === 0 || (zone === 1 && plazaHere) ? 41 : 21;
      const base = w.pos.length / 3;
      const hAt = (x: number, z: number) => lawnHeight(Math.abs(x), z);
      for (let j = 0; j < rows; j += 1) {
        const z = -(j / (rows - 1)) * L;
        for (const x of xs) {
          if (dry) {
            vert(w, x, 0, z, 0, 0, cA);
            continue;
          }
          const y = hAt(x, z);
          const e = 0.25;
          const nx = -(hAt(x + e, z) - hAt(x - e, z)) / (2 * e);
          const nz = -(hAt(x, z + e) - hAt(x, z - e)) / (2 * e);
          const nl = Math.hypot(nx, 1, nz);
          lawnColor(plan, x, z, cA);
          cA.multiplyScalar(blobShade(plan.blobs, x, z));
          vert(w, x, y, z, lawnU, 0.5, cA, nx / nl, 1 / nl, nz / nl);
        }
      }
      const cols = xs.length;
      for (let j = 0; j < rows - 1; j += 1) {
        for (let i = 0; i < cols - 1; i += 1) {
          const cx = (xs[i] + xs[i + 1]) / 2;
          const cz = -((j + 0.5) / (rows - 1)) * L;
          if (zone < 2 && inRects(plan.plazas, cx, cz)) continue;
          const a = base + j * cols + i;
          const b = a + 1;
          const c = a + cols;
          const d = c + 1;
          w.idx.push(a, b, c, b, d, c);
        }
      }
    }
  }

  // Plazas: brick basket-weave, 2 m texture cells.
  for (const r of plan.plazas) {
    const nx = Math.max(1, Math.round((r.x1 - r.x0) / PLAZA_CELL));
    const cw = (r.x1 - r.x0) / nx;
    const rows = Math.max(2, Math.round((r.z1 - r.z0) / 1) + 1);
    for (let i = 0; i < nx; i += 1) {
      const xa = r.x0 + i * cw;
      const xb = xa + cw;
      const base = w.pos.length / 3;
      for (let j = 0; j < rows; j += 1) {
        const z = r.z1 - ((r.z1 - r.z0) * j) / (rows - 1);
        for (const [x, px] of [
          [xa, PLAZA_PX.x0],
          [xb, PLAZA_PX.x0 + PLAZA_PX.w],
        ] as const) {
          const ao = blobShade(plan.blobs, x, z);
          const warm = 0.97 + 0.03 * noise2(x * 0.4, z * 0.4, 5);
          cB.setRGB(warm * ao, warm * ao, warm * ao);
          vert(w, x, LAWN_Y + 0.004, z, uOf(px), vOf(z), cB);
        }
      }
      grid(w, base, 2, rows);
    }
  }

}

function grid(w: Writer, base: number, cols: number, rows: number, flip = false): void {
  for (let j = 0; j < rows - 1; j += 1) {
    for (let i = 0; i < cols - 1; i += 1) {
      const a = base + j * cols + i;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      if (flip) w.idx.push(a, c, b, b, c, d);
      else w.idx.push(a, b, c, b, d, c);
    }
  }
}

// ---------------------------------------------------------------------------
// Curbs and sidewalk edging (swept profiles, flat ends so chunks butt together)
// ---------------------------------------------------------------------------

/**
 * Sweep a 2D profile (x, y) along -Z. Each run is smooth-shaded internally;
 * runs meet at hard edges. Normals point toward +x/+y for a profile listed
 * bottom-to-top on the road side (counter-clockwise when seen from +Z).
 */
function sweepZ(key: string, runs: Array<Array<[number, number]>>, length: number, steps: number): THREE.BufferGeometry {
  return memo(`sweep:${key}:${length}:${steps}`, () => {
    const pos: number[] = [];
    const nor: number[] = [];
    const idx: number[] = [];
    for (const run of runs) {
      // Per-point normals: average of adjacent segment normals (segment normal = (dy, -dx) rotated outward).
      const normals: Array<[number, number]> = run.map((_, i) => {
        let nx = 0;
        let ny = 0;
        for (const [a, b] of [
          [i - 1, i],
          [i, i + 1],
        ]) {
          if (a < 0 || b >= run.length) continue;
          const dx = run[b][0] - run[a][0];
          const dy = run[b][1] - run[a][1];
          const l = Math.hypot(dx, dy) || 1;
          nx += -dy / l;
          ny += dx / l;
        }
        const l = Math.hypot(nx, ny) || 1;
        return [nx / l, ny / l];
      });
      const base = pos.length / 3;
      for (let j = 0; j <= steps; j += 1) {
        const z = -(j / steps) * length;
        run.forEach(([x, y], i) => {
          pos.push(x, y, z);
          nor.push(normals[i][0], normals[i][1], 0);
        });
      }
      const n = run.length;
      for (let j = 0; j < steps; j += 1) {
        for (let i = 0; i < n - 1; i += 1) {
          const a = base + j * n + i;
          const b = a + 1;
          const c = a + n;
          const d = c + 1;
          idx.push(a, b, c, b, d, c);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    return g;
  });
}

/**
 * Profiles run from the road side outward ("up and over"), so the (−dy, dx)
 * normal of each segment points toward the road / up / outward.
 */
const CURB_PROFILE: Array<[number, number]> = [
  [ROAD_HALF + 0.001, -0.03],
  [ROAD_HALF, 0.11],
  [ROAD_HALF + 0.012, 0.155],
  [ROAD_HALF + 0.04, 0.183],
  [ROAD_HALF + 0.085, 0.195],
  [CURB_OUT - 0.07, 0.195],
  [CURB_OUT - 0.025, 0.185],
  [CURB_OUT + 0.01, 0.16],
];

/** Smooth normals along the curb (x toward the lawn, y up), one per profile point. */
const CURB_NORMALS: Array<[number, number]> = CURB_PROFILE.map((_, i) => {
  let nx = 0;
  let ny = 0;
  for (const [a, b] of [
    [i - 1, i],
    [i, i + 1],
  ]) {
    if (a < 0 || b >= CURB_PROFILE.length) continue;
    const dx = CURB_PROFILE[b][0] - CURB_PROFILE[a][0];
    const dy = CURB_PROFILE[b][1] - CURB_PROFILE[a][1];
    const l = Math.hypot(dx, dy) || 1;
    nx += -dy / l;
    ny += dx / l;
  }
  const l = Math.hypot(nx, ny) || 1;
  return [nx / l, ny / l];
});

/** How far along the profile each point lies, 0 to 1: where it reads the atlas. */
const CURB_ALONG: number[] = (() => {
  const out = [0];
  for (let i = 1; i < CURB_PROFILE.length; i += 1) {
    out.push(out[i - 1] + Math.hypot(CURB_PROFILE[i][0] - CURB_PROFILE[i - 1][0], CURB_PROFILE[i][1] - CURB_PROFILE[i - 1][1]));
  }
  return out.map((v) => v / out[out.length - 1]);
})();

const EDGE_PROFILE: Array<[number, number]> = [
  [WALK_OUT - 0.09, 0.14],
  [WALK_OUT - 0.09, 0.19],
  [WALK_OUT - 0.065, 0.218],
  [WALK_OUT, 0.228],
  [WALK_OUT + 0.065, 0.218],
  [WALK_OUT + 0.09, 0.19],
  [WALK_OUT + 0.09, 0.15],
];

/** Adds both sidewalk edgings to the matte bin. */
export function addEdging(bins: Bins): void {
  const edge = sweepZ('edge', [EDGE_PROFILE], CHUNK_LEN, 20);
  const edgePaint = (_x: number, y: number, _z: number, _nx: number, _ny: number, _nz: number, out: THREE.Color) => {
    out.copy(col('#efe2d6'));
    if (y < 0.19) out.multiplyScalar(0.9);
  };
  for (const s of [-1, 1]) bins.add('matte', edge, edgePaint, { s: [s, 1, 1] });
}
