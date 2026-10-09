import * as THREE from 'three';
import '@fontsource-variable/fredoka';
import { roundedRectShape } from '../kit/geo';
import { PAL } from '../kit/palette';

export const PLATE_W = 0.36;
export const PLATE_H = 0.13;
const FONT = '"Fredoka Variable", "Fredoka", "Arial Rounded MT Bold", "Nunito", system-ui, sans-serif';

function heartPath(g: CanvasRenderingContext2D, cx: number, cy: number, size: number): void {
  const s = size / 2;
  g.beginPath();
  g.moveTo(cx, cy + s * 0.95);
  g.bezierCurveTo(cx - s * 0.2, cy + s * 0.7, cx - s * 1.1, cy + s * 0.2, cx - s, cy - s * 0.35);
  g.bezierCurveTo(cx - s * 0.95, cy - s * 0.85, cx - s * 0.35, cy - s * 1.05, cx, cy - s * 0.6);
  g.bezierCurveTo(cx + s * 0.35, cy - s * 1.05, cx + s * 0.95, cy - s * 0.85, cx + s, cy - s * 0.35);
  g.bezierCurveTo(cx + s * 1.1, cy + s * 0.2, cx + s * 0.2, cy + s * 0.7, cx, cy + s * 0.95);
  g.closePath();
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function drawPlate(canvas: HTMLCanvasElement, text: string): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const W = canvas.width;
  const H = canvas.height;
  g.clearRect(0, 0, W, H);
  // Cream plate with a soft berry border.
  g.fillStyle = '#fff4e6';
  roundRect(g, 0, 0, W, H, 34);
  g.fill();
  g.lineWidth = 9;
  g.strokeStyle = PAL.doorBerry;
  roundRect(g, 14, 14, W - 28, H - 28, 24);
  g.stroke();
  // Little hearts at both ends.
  g.fillStyle = PAL.flowerRose;
  heartPath(g, 58, H / 2, 46);
  g.fill();
  heartPath(g, W - 58, H / 2, 46);
  g.fill();
  // Text.
  g.fillStyle = PAL.doorBerry;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const maxW = W - 200;
  let size = 96;
  g.font = `700 ${size}px ${FONT}`;
  const measured = g.measureText(text).width;
  if (measured > maxW) {
    size = Math.floor((size * maxW) / measured);
    g.font = `700 ${size}px ${FONT}`;
  }
  g.fillText(text, W / 2, H / 2 + size * 0.06);
}

export interface PlateBuild {
  mesh: THREE.Mesh;
  dispose(): void;
}

/** Cute licence plate reading "PRINCESS" (cream plate, berry letters). Faces +Z. */
export function createPlate(text = 'PRINCESS'): PlateBuild {
  const shape = roundedRectShape(PLATE_W, PLATE_H, 0.022);
  const geometry = new THREE.ShapeGeometry(shape, 6);
  const uv = geometry.attributes.uv;
  const pos = geometry.attributes.position;
  for (let i = 0; i < uv.count; i += 1) {
    uv.setXY(i, pos.getX(i) / PLATE_W + 0.5, pos.getY(i) / PLATE_H + 0.5);
  }
  let texture: THREE.CanvasTexture | null = null;
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.42, metalness: 0 });
  material.name = 'car-plate';
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 184;
    drawPlate(canvas, text);
    texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    material.map = texture;
    // Redraw once the rounded font is ready.
    document.fonts?.load(`700 64px "Fredoka Variable"`).then(
      () => {
        if (!texture) return;
        drawPlate(canvas, text);
        texture.needsUpdate = true;
      },
      () => {},
    );
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'car-plate';
  mesh.receiveShadow = true;
  return {
    mesh,
    dispose: () => {
      geometry.dispose();
      material.dispose();
      texture?.dispose();
      texture = null;
    },
  };
}
