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

const INK = '#3a1f36';
const EYE_TOP = '#2a1428';
const EYE_MID = PAL.eye;
const EYE_LOW = '#7a4468';
const BROW = '#7b4026';
const LIP = '#a23c55';
const MOUTH = '#7a1f3a';
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

const L: Layout = {
  eyeX: 19.5,
  eyeY: 1.5,
  eyeW: 11.5,
  eyeH: 15,
  browY: -12.5,
  mouthY: 17.5,
  blushX: 28,
  blushY: 11,
};

function blush(g: G, strength = 1): void {
  for (const s of [-1, 1]) {
    g.save();
    g.translate(s * L.blushX, L.blushY);
    g.scale(1, 0.62);
    const r = 8.5;
    const grad = g.createRadialGradient(0, 0, 0, 0, 0, r);
    grad.addColorStop(0, `rgba(255, 128, 150, ${0.62 * strength})`);
    grad.addColorStop(0.55, `rgba(255, 140, 160, ${0.34 * strength})`);
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
  g.lineWidth = 1.7;
  for (const s of [-1, 1]) {
    const cx = s * (L.eyeX + 0.5);
    const cy = L.browY - raise;
    g.beginPath();
    // Soft arc; the outer end sits slightly lower for a gentle look.
    g.moveTo(cx - s * 4.2, cy + 0.5);
    g.quadraticCurveTo(cx, cy - 1.6 - arch, cx + s * 4.4, cy + 1.2);
    g.stroke();
  }
}

function openEye(g: G, side: number, opts: { w?: number; h?: number; lid?: number; round?: boolean } = {}): void {
  const cx = side * L.eyeX;
  const cy = L.eyeY;
  const w = opts.w ?? L.eyeW;
  const h = opts.h ?? L.eyeH;
  const rx = w / 2;
  const ry = h / 2;
  const lid = opts.lid ?? 0; // 0 open .. 1 closed (fraction of height covered from the top)

  g.save();
  // Clip away the lid-covered part.
  g.beginPath();
  g.rect(cx - rx - 4, cy - ry + h * lid, w + 8, h + 8);
  g.clip();

  // Eye body with a vertical gradient (dark top, plum-rose bottom).
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  const grad = g.createLinearGradient(cx, cy - ry, cx, cy + ry);
  grad.addColorStop(0, EYE_TOP);
  grad.addColorStop(0.5, EYE_MID);
  grad.addColorStop(1, EYE_LOW);
  g.fillStyle = grad;
  g.fill();

  // Soft lower iris glow.
  g.save();
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, 0, 0, TAU);
  g.clip();
  const glow = g.createRadialGradient(cx, cy + ry * 0.62, 0, cx, cy + ry * 0.62, rx * 1.05);
  glow.addColorStop(0, 'rgba(214, 140, 190, 0.75)');
  glow.addColorStop(1, 'rgba(214, 140, 190, 0)');
  g.fillStyle = glow;
  g.fillRect(cx - rx, cy - ry, w, h);
  g.restore();

  // Highlights: big one upper-right (sun comes from her left = viewer's right), small one lower-left.
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.ellipse(cx + rx * 0.3, cy - ry * 0.34, rx * 0.36, ry * 0.3, -0.3, 0, TAU);
  g.fill();
  g.beginPath();
  g.arc(cx - rx * 0.36, cy + ry * 0.36, rx * 0.16, 0, TAU);
  g.fill();
  g.globalAlpha = 0.85;
  g.beginPath();
  g.arc(cx + rx * 0.02, cy + ry * 0.52, rx * 0.08, 0, TAU);
  g.fill();
  g.globalAlpha = 1;
  g.restore();

  // Upper lid line + lashes (outer side).
  const top = cy - ry + h * lid;
  g.strokeStyle = INK;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (lid < 0.05) {
    g.lineWidth = 1.35;
    g.beginPath();
    g.ellipse(cx, cy, rx + 0.35, ry + 0.35, 0, Math.PI * 1.1, Math.PI * 1.9);
    g.stroke();
  } else {
    // Lid edge: a gentle curve across the clipped eye.
    const half = rx * Math.sqrt(Math.max(0, 1 - Math.pow((top - cy) / ry, 2))) + 0.6;
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(cx - half, top + 0.6);
    g.quadraticCurveTo(cx, top - 0.9, cx + half, top + 0.6);
    g.stroke();
  }
  // Lashes at the outer upper corner.
  const ox = cx + side * rx * 0.78;
  const oy = Math.max(top + 1.4, cy - ry * 0.55);
  g.lineWidth = 1.25;
  for (let i = 0; i < 3; i += 1) {
    const a = -0.35 - i * 0.42; // fan upward/outward
    const len = 2.6 - i * 0.35;
    const bx = ox - side * i * 1.1;
    const by = oy - i * 1.25;
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
  const cy = L.eyeY + 2.5;
  g.strokeStyle = INK;
  g.lineCap = 'round';
  g.lineWidth = 1.7;
  g.beginPath();
  g.moveTo(cx - 5.4, cy - 0.8);
  g.quadraticCurveTo(cx, cy + 3.6, cx + 5.4, cy - 0.8);
  g.stroke();
  // Two lashes at the outer end.
  g.lineWidth = 1.2;
  const ex = cx + side * 5.2;
  const ey = cy - 0.6;
  g.beginPath();
  g.moveTo(ex, ey);
  g.lineTo(ex + side * 2.1, ey - 1.2);
  g.moveTo(ex - side * 1.3, ey + 0.9);
  g.lineTo(ex + side * 0.7, ey + 0.6);
  g.stroke();
}

/** Happy squint: an upward arc (^). */
function joyEye(g: G, side: number): void {
  const cx = side * L.eyeX;
  const cy = L.eyeY + 1.5;
  g.strokeStyle = INK;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = 2.1;
  g.beginPath();
  g.moveTo(cx - 5.6, cy + 2.4);
  g.quadraticCurveTo(cx, cy - 5.4, cx + 5.6, cy + 2.4);
  g.stroke();
  g.lineWidth = 1.2;
  const ex = cx + side * 5.4;
  const ey = cy + 1.6;
  g.beginPath();
  g.moveTo(ex - side * 0.6, ey - 1.2);
  g.lineTo(ex + side * 1.9, ey - 2.6);
  g.stroke();
}

function smile(g: G, width = 7.5, depth = 3.2): void {
  g.strokeStyle = LIP;
  g.lineCap = 'round';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(-width / 2, L.mouthY - 0.6);
  g.quadraticCurveTo(0, L.mouthY + depth, width / 2, L.mouthY - 0.6);
  g.stroke();
}

function openSmile(g: G, width = 10, height = 6.5): void {
  const y0 = L.mouthY - 1.2;
  g.save();
  g.beginPath();
  g.moveTo(-width / 2, y0);
  g.quadraticCurveTo(0, y0 - 1.0, width / 2, y0);
  g.bezierCurveTo(width / 2, y0 + height * 0.75, width * 0.22, y0 + height, 0, y0 + height);
  g.bezierCurveTo(-width * 0.22, y0 + height, -width / 2, y0 + height * 0.75, -width / 2, y0);
  g.closePath();
  g.fillStyle = MOUTH;
  g.fill();
  g.clip();
  g.fillStyle = TONGUE;
  g.beginPath();
  g.ellipse(0, y0 + height * 0.98, width * 0.34, height * 0.42, 0, 0, TAU);
  g.fill();
  g.restore();
  g.strokeStyle = LIP;
  g.lineWidth = 0.9;
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(-width / 2, y0);
  g.quadraticCurveTo(0, y0 - 1.0, width / 2, y0);
  g.bezierCurveTo(width / 2, y0 + height * 0.75, width * 0.22, y0 + height, 0, y0 + height);
  g.bezierCurveTo(-width * 0.22, y0 + height, -width / 2, y0 + height * 0.75, -width / 2, y0);
  g.closePath();
  g.stroke();
}

function ohMouth(g: G): void {
  const cy = L.mouthY + 1.2;
  g.save();
  g.beginPath();
  g.ellipse(0, cy, 2.5, 3.1, 0, 0, TAU);
  g.fillStyle = MOUTH;
  g.fill();
  g.clip();
  g.fillStyle = TONGUE;
  g.beginPath();
  g.ellipse(0, cy + 2.3, 1.9, 1.5, 0, 0, TAU);
  g.fill();
  g.restore();
  g.strokeStyle = LIP;
  g.lineWidth = 0.8;
  g.beginPath();
  g.ellipse(0, cy, 2.5, 3.1, 0, 0, TAU);
  g.stroke();
}

function paintCell(g: G, cell: FaceCell): void {
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
      openEye(g, -1, { w: 12.5, h: 14.5 });
      openEye(g, 1, { w: 12.5, h: 14.5 });
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
      openSmile(g, 8.5, 5.2);
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
