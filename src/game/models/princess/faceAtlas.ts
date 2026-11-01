import * as THREE from 'three';
import { PAL } from '../kit/palette';

/**
 * Painted face atlas. Each cell is the face seen straight on, drawn in "degree
 * space" (1 unit = 1 degree away from the face axis, +x = viewer's right, +y = down).
 * The head mesh maps its vertices into a cell with an azimuthal projection around
 * the face axis (see `faceUv`), so swapping expressions is just a texture offset.
 */
export type FaceCell = 'happy' | 'halfBlink' | 'blink' | 'surprised' | 'joy' | 'wink';
const ORDER: FaceCell[] = ['happy', 'halfBlink', 'blink', 'surprised', 'joy', 'wink'];

export const FACE_COLS = 3;
export const FACE_ROWS = 2;
const CELL = 512;
/** Half-cell angular span (degrees). */
const SPAN_DEG = 44;
const SPAN = THREE.MathUtils.degToRad(SPAN_DEG);
const PX_PER_DEG = CELL / 2 / SPAN_DEG;
/** Face axis tilted slightly down so the features sit centered in the cell. */
const TILT = THREE.MathUtils.degToRad(6);
const F = new THREE.Vector3(0, -Math.sin(TILT), -Math.cos(TILT));
const R = new THREE.Vector3(-1, 0, 0); // viewer's right = her left
const U = new THREE.Vector3(0, Math.cos(TILT), -Math.sin(TILT));

/** UV inside one atlas cell for a direction from the head center. */
export function faceUv(dx: number, dy: number, dz: number): [number, number] {
  const len = Math.hypot(dx, dy, dz) || 1;
  const x = dx / len;
  const y = dy / len;
  const z = dz / len;
  const cz = x * F.x + y * F.y + z * F.z;
  const cx = x * R.x + y * R.y + z * R.z;
  const cy = x * U.x + y * U.y + z * U.z;
  const alpha = Math.acos(Math.max(-1, Math.min(1, cz)));
  const rho = Math.hypot(cx, cy);
  let u = 0.5;
  let v = 0.5;
  if (rho > 1e-7) {
    const s = (alpha / SPAN) * 0.5;
    u = 0.5 + (s * cx) / rho;
    v = 0.5 + (s * cy) / rho;
  }
  const lo = 0.004;
  const hi = 0.996;
  return [Math.min(hi, Math.max(lo, u)), Math.min(hi, Math.max(lo, v))];
}

// ---------------------------------------------------------------------------
// Painting
// ---------------------------------------------------------------------------

type G = CanvasRenderingContext2D;
const TAU = Math.PI * 2;

const INK = '#33193a';
const IRIS_DEEP = '#3d2277';
const IRIS_MID = '#7e56dc';
const IRIS_LOW = '#cfa8ff';
const PUPIL = '#1d1033';
const BROW = '#7b4026';
const LIP = '#c04a6a';
const MOUTH = '#8a2342';
const TONGUE = '#ff8ba3';

interface Layout {
  eyeX: number;
  eyeY: number;
  eyeW: number;
  eyeH: number;
  browY: number;
  mouthY: number;
  blushX: number;
  blushY: number;
}

// Big eyes set wide and low on the face: the look of a very young, friendly character.
const L: Layout = {
  eyeX: 23.5,
  eyeY: 6,
  eyeW: 21,
  eyeH: 26,
  browY: -11.5,
  mouthY: 25,
  blushX: 37,
  blushY: 19,
};

function blush(g: G, strength = 1): void {
  for (const s of [-1, 1]) {
    g.save();
    g.translate(s * L.blushX, L.blushY);
    g.scale(1, 0.62);
    const r = 10.5;
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
    grad.addColorStop(0, `rgba(255, 112, 140, ${0.5 * strength})`);
    grad.addColorStop(0.55, `rgba(255, 130, 155, ${0.26 * strength})`);
    grad.addColorStop(1, 'rgba(255, 150, 170, 0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.fill();
    g.restore();
    // Tiny sparkle on the blush.
    g.fillStyle = `rgba(255, 255, 255, ${0.55 * strength})`;
    g.beginPath();
    g.ellipse(s * L.blushX + s * 2.4, L.blushY - 1.6, 1.0, 0.75, 0, 0, TAU);
    g.fill();
  }
}

function brows(g: G, raise = 0, arch = 0): void {
  g.strokeStyle = BROW;
  g.lineCap = 'round';
  g.lineWidth = 1.6;
  for (const s of [-1, 1]) {
    const cx = s * (L.eyeX + 0.5);
    const cy = L.browY - raise;
    g.beginPath();
    // Soft arc; the outer end sits slightly lower for a gentle look.
    g.moveTo(cx - s * 5, cy + 0.9);
    g.quadraticCurveTo(cx, cy - 1.8 - arch, cx + s * 5.4, cy + 1.3);
    g.stroke();
  }
}

/** Soft shadow under the little nose: gives the flat paint a bit of shape. */
function nose(g: G): void {
  const grad = g.createRadialGradient(0, 15, 0, 0, 15, 3.2);
  grad.addColorStop(0, 'rgba(226, 132, 110, 0.55)');
  grad.addColorStop(1, 'rgba(226, 132, 110, 0)');
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(0, 15, 3.2, 1.8, 0, 0, TAU);
  g.fill();
}

function openEye(g: G, side: number, opts: { w?: number; h?: number; lid?: number } = {}): void {
  const cx = side * L.eyeX;
  const cy = L.eyeY;
  const w = opts.w ?? L.eyeW;
  const h = opts.h ?? L.eyeH;
  const rx = w / 2;
  const ry = h / 2;
  const lid = opts.lid ?? 0; // 0 open .. 1 closed (fraction of height covered from the top)
  const ri = Math.min(rx * 0.93, ry * 0.8);
  const ix = cx - side * rx * 0.05;
  const iy = cy + ry * 0.08;

  g.save();
  // Clip away the lid-covered part, then keep everything inside the eye.
  g.beginPath();
  g.rect(cx - rx - 4, cy - ry + h * lid, w + 8, h + 8);
  g.clip();
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  g.clip();

  // White of the eye, shaded under the lid.
  const white = g.createLinearGradient(cx, cy - ry, cx, cy + ry * 0.4);
  white.addColorStop(0, '#c9bcde');
  white.addColorStop(0.5, '#f7f2fb');
  white.addColorStop(1, '#ffffff');
  g.fillStyle = white;
  g.fillRect(cx - rx, cy - ry, w, h);

  // Iris: deep at the top, glowing from below.
  const iris = g.createLinearGradient(ix, iy - ri, ix, iy + ri);
  iris.addColorStop(0, IRIS_DEEP);
  iris.addColorStop(0.5, IRIS_MID);
  iris.addColorStop(1, IRIS_LOW);
  g.fillStyle = iris;
  g.beginPath();
  g.arc(ix, iy, ri, 0, TAU);
  g.fill();
  // Fine spokes in the iris.
  g.lineWidth = 0.22;
  for (let i = 0; i < 26; i += 1) {
    const a = (i / 26) * TAU;
    g.strokeStyle = i % 2 === 0 ? 'rgba(255, 230, 255, 0.34)' : 'rgba(40, 16, 90, 0.3)';
    g.beginPath();
    g.moveTo(ix + Math.cos(a) * ri * 0.42, iy + Math.sin(a) * ri * 0.42);
    g.lineTo(ix + Math.cos(a) * ri * 0.92, iy + Math.sin(a) * ri * 0.92);
    g.stroke();
  }
  // Dark ring and pupil.
  g.strokeStyle = IRIS_DEEP;
  g.lineWidth = 0.9;
  g.beginPath();
  g.arc(ix, iy, ri - 0.3, 0, TAU);
  g.stroke();
  g.fillStyle = PUPIL;
  g.beginPath();
  g.ellipse(ix, iy, ri * 0.5, ri * 0.56, 0, 0, TAU);
  g.fill();
  // Upper lid's shadow across the eye.
  const shade = g.createLinearGradient(cx, cy - ry, cx, cy - ry * 0.25);
  shade.addColorStop(0, 'rgba(36, 14, 66, 0.7)');
  shade.addColorStop(1, 'rgba(36, 14, 66, 0)');
  g.fillStyle = shade;
  g.fillRect(cx - rx, cy - ry, w, h);

  // Highlights: big one upper-right (the sun's side) on both eyes, small one lower-left.
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.ellipse(ix + ri * 0.34, iy - ri * 0.42, ri * 0.4, ri * 0.33, -0.35, 0, TAU);
  g.fill();
  g.beginPath();
  g.arc(ix - ri * 0.42, iy + ri * 0.42, ri * 0.17, 0, TAU);
  g.fill();
  g.globalAlpha = 0.8;
  g.beginPath();
  g.arc(ix + ri * 0.34, iy + ri * 0.55, ri * 0.09, 0, TAU);
  g.fill();
  g.globalAlpha = 1;
  g.restore();

  // Lower lid: a thin warm line.
  g.strokeStyle = 'rgba(150, 80, 96, 0.6)';
  g.lineCap = 'round';
  g.lineWidth = 0.55;
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, Math.PI * 0.2, Math.PI * 0.8);
  g.stroke();

  // Upper lid line, thick toward the outside, and lashes.
  const top = cy - ry + h * lid;
  g.strokeStyle = INK;
  g.lineJoin = 'round';
  if (lid < 0.05) {
    g.lineWidth = 1.5;
    g.beginPath();
    g.ellipse(cx, cy, rx + 0.3, ry + 0.3, 0, Math.PI * 1.03, Math.PI * 1.97);
    g.stroke();
    g.lineWidth = 2.1;
    g.beginPath();
    if (side > 0) g.ellipse(cx, cy, rx + 0.45, ry + 0.45, 0, Math.PI * 1.55, Math.PI * 2.03);
    else g.ellipse(cx, cy, rx + 0.45, ry + 0.45, 0, Math.PI * 0.97, Math.PI * 1.45);
    g.stroke();
    // A faint crease above the lid.
    g.strokeStyle = 'rgba(170, 96, 92, 0.45)';
    g.lineWidth = 0.6;
    g.beginPath();
    g.ellipse(cx, cy - 0.4, rx + 1.6, ry + 1.5, 0, Math.PI * 1.22, Math.PI * 1.78);
    g.stroke();
    g.strokeStyle = INK;
  } else {
    // Lid edge: a gentle curve across the clipped eye.
    const half = rx * Math.sqrt(Math.max(0, 1 - Math.pow((top - cy) / ry, 2))) + 0.6;
    g.lineWidth = 1.8;
    g.beginPath();
    g.moveTo(cx - half, top + 0.6);
    g.quadraticCurveTo(cx, top - 0.9, cx + half, top + 0.6);
    g.stroke();
  }
  // Lashes at the outer upper corner.
  const ox = cx + side * rx * 0.86;
  const oy = Math.max(top + 1.6, cy - ry * 0.4);
  g.lineWidth = 1.2;
  for (let i = 0; i < 3; i += 1) {
    const a = -0.1 - i * 0.42; // fan upward/outward
    const len = 3.6 - i * 0.4;
    const bx = ox - side * i * 1.3;
    const by = oy - i * 1.9;
    g.beginPath();
    g.moveTo(bx, by);
    g.quadraticCurveTo(
      bx + side * Math.cos(a) * len * 0.6,
      by + Math.sin(a) * len * 0.9,
      bx + side * Math.cos(a) * len * 1.05,
      by + Math.sin(a) * len * 1.15,
    );
    g.stroke();
  }
}

/** Closed, relaxed eye: a soft downward arc (like a contented blink). */
function closedEye(g: G, side: number): void {
  const cx = side * L.eyeX;
  const cy = L.eyeY + 3;
  g.strokeStyle = INK;
  g.lineCap = 'round';
  g.lineWidth = 1.9;
  g.beginPath();
  g.moveTo(cx - 9.6, cy - 1);
  g.quadraticCurveTo(cx, cy + 5.6, cx + 9.6, cy - 1);
  g.stroke();
  // Two lashes at the outer end.
  g.lineWidth = 1.2;
  const ex = cx + side * 9.4;
  const ey = cy - 0.8;
  g.beginPath();
  g.moveTo(ex, ey);
  g.lineTo(ex + side * 2.6, ey - 1.5);
  g.moveTo(ex - side * 1.6, ey + 1.1);
  g.lineTo(ex + side * 0.9, ey + 0.8);
  g.stroke();
}

/** Happy squint: an upward arc (^). */
function joyEye(g: G, side: number): void {
  const cx = side * L.eyeX;
  const cy = L.eyeY + 2;
  g.strokeStyle = INK;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = 2.3;
  g.beginPath();
  g.moveTo(cx - 9.8, cy + 3.4);
  g.quadraticCurveTo(cx, cy - 8.4, cx + 9.8, cy + 3.4);
  g.stroke();
  g.lineWidth = 1.2;
  const ex = cx + side * 9.5;
  const ey = cy + 2.4;
  g.beginPath();
  g.moveTo(ex - side * 0.6, ey - 1.2);
  g.lineTo(ex + side * 2.3, ey - 3);
  g.stroke();
}

/** Open smile with a line of teeth and a tongue. */
function openSmile(g: G, width = 15, height = 10, teeth = 0.24): void {
  const y0 = L.mouthY - 1.4;
  const path = () => {
    g.beginPath();
    g.moveTo(-width / 2, y0);
    g.quadraticCurveTo(0, y0 + 1.1, width / 2, y0);
    g.bezierCurveTo(width / 2, y0 + height * 0.75, width * 0.24, y0 + height, 0, y0 + height);
    g.bezierCurveTo(-width * 0.24, y0 + height, -width / 2, y0 + height * 0.75, -width / 2, y0);
    g.closePath();
  };
  g.save();
  path();
  g.fillStyle = MOUTH;
  g.fill();
  g.clip();
  g.fillStyle = TONGUE;
  g.beginPath();
  g.ellipse(0, y0 + height * 0.98, width * 0.34, height * 0.44, 0, 0, TAU);
  g.fill();
  g.fillStyle = '#fffdfb';
  g.fillRect(-width / 2, y0 - 1, width, height * teeth + 1.6);
  g.restore();
  g.strokeStyle = LIP;
  g.lineWidth = 0.8;
  g.lineJoin = 'round';
  path();
  g.stroke();
  // Soft lower-lip glow and little smile dents.
  g.strokeStyle = 'rgba(255, 150, 160, 0.5)';
  g.lineWidth = 0.9;
  g.beginPath();
  g.moveTo(-width * 0.2, y0 + height + 1.1);
  g.quadraticCurveTo(0, y0 + height + 2, width * 0.2, y0 + height + 1.1);
  g.stroke();
  g.strokeStyle = 'rgba(200, 90, 100, 0.5)';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(s * (width / 2 + 0.4), y0 - 1);
    g.quadraticCurveTo(s * (width / 2 + 1.1), y0 - 0.1, s * (width / 2 + 0.6), y0 + 0.9);
    g.stroke();
  }
}

/** The everyday mouth: a small sweet open smile. */
function smile(g: G): void {
  openSmile(g, 11.5, 5.4, 0.3);
}

function ohMouth(g: G): void {
  const cy = L.mouthY + 1.6;
  g.save();
  g.beginPath();
  g.ellipse(0, cy, 3.4, 4.2, 0, 0, TAU);
  g.fillStyle = MOUTH;
  g.fill();
  g.clip();
  g.fillStyle = TONGUE;
  g.beginPath();
  g.ellipse(0, cy + 3.1, 2.6, 2, 0, 0, TAU);
  g.fill();
  g.restore();
  g.strokeStyle = LIP;
  g.lineWidth = 0.8;
  g.beginPath();
  g.ellipse(0, cy, 3.4, 4.2, 0, 0, TAU);
  g.stroke();
}

function paintCell(g: G, cell: FaceCell): void {
  nose(g);
  switch (cell) {
    case 'happy':
      blush(g);
      brows(g);
      openEye(g, -1);
      openEye(g, 1);
      smile(g);
      break;
    case 'halfBlink':
      blush(g);
      brows(g);
      openEye(g, -1, { lid: 0.55 });
      openEye(g, 1, { lid: 0.55 });
      smile(g);
      break;
    case 'blink':
      blush(g);
      brows(g);
      closedEye(g, -1);
      closedEye(g, 1);
      smile(g);
      break;
    case 'surprised':
      blush(g, 0.8);
      brows(g, 3.2, 1.2);
      openEye(g, -1, { w: 22, h: 27.5 });
      openEye(g, 1, { w: 22, h: 27.5 });
      ohMouth(g);
      break;
    case 'joy':
      blush(g, 1.25);
      brows(g, 1.6, 0.6);
      joyEye(g, -1);
      joyEye(g, 1);
      openSmile(g);
      break;
    case 'wink':
      blush(g, 1.15);
      brows(g, 1.0);
      joyEye(g, -1); // her right eye (viewer's left) winks
      openEye(g, 1);
      openSmile(g, 13, 7.4, 0.26);
      break;
  }
}

export interface FaceAtlas {
  texture: THREE.CanvasTexture;
  select(cell: FaceCell): void;
  dispose(): void;
}

export function createFaceAtlas(): FaceAtlas {
  const canvas = document.createElement('canvas');
  canvas.width = CELL * FACE_COLS;
  canvas.height = CELL * FACE_ROWS;
  const g = canvas.getContext('2d')!;
  g.fillStyle = PAL.skin;
  g.fillRect(0, 0, canvas.width, canvas.height);
  ORDER.forEach((cell, i) => {
    const col = i % FACE_COLS;
    const row = Math.floor(i / FACE_COLS);
    g.save();
    g.beginPath();
    g.rect(col * CELL, row * CELL, CELL, CELL);
    g.clip();
    g.translate(col * CELL + CELL / 2, row * CELL + CELL / 2);
    g.scale(PX_PER_DEG, PX_PER_DEG);
    paintCell(g, cell);
    g.restore();
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(1 / FACE_COLS, 1 / FACE_ROWS);
  const select = (cell: FaceCell) => {
    const i = ORDER.indexOf(cell);
    const col = i % FACE_COLS;
    const row = Math.floor(i / FACE_COLS);
    texture.offset.set(col / FACE_COLS, 1 - (row + 1) / FACE_ROWS);
  };
  select('happy');
  return { texture, select, dispose: () => texture.dispose() };
}
