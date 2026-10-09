import * as THREE from 'three';
import { HOUSE_SCHEMES, PAL } from '../kit/palette';
import { col, type ColorFn } from './bins';

/** Town-local colors that extend the shared palette (all harmonious with PAL). */
export const LOOK = {
  trim: PAL.trimWhite,
  cream: '#fff6ea',
  stone: '#eadbcf',
  stoneDeep: '#d4c0b3',
  stoneWarm: '#f0d9c8',
  brick: '#ec9f86',
  brickDeep: '#d88670',
  soil: '#b98069',
  soilDeep: '#9a6656',
  terracotta: '#e98f6a',
  woodLight: '#e2b48c',
  wood: PAL.wood,
  woodDeep: PAL.woodDeep,
  iron: '#7a6fa0',
  gold: PAL.gold,
  water: '#9fdcf0',
  shutters: ['#8fd6c3', '#9cc8f5', '#ff9fb8', '#b9a3ec', '#ffd07a', '#5cbfb3', '#fffaf6', '#f7a0a0'],
  flowers: [PAL.flowerRose, PAL.flowerRed, PAL.flowerYellow, PAL.flowerWhite, PAL.flowerLilac, PAL.flowerBlue, PAL.flowerOrange, '#ff8fc4'],
  stripes: ['#ff7f9f', '#5cc3b6', '#ffb347', '#a98be6', '#7fb6f0', '#ff6b7e'],
  balloon: ['#ff7fae', '#ffd45e', '#7fd9c6', '#b79cff', '#7fc3ff', '#ff9a7a', '#ffffff'],
} as const;

export interface Scheme {
  wall: string;
  roof: string;
  door: string;
  trim: string;
}

/** Palette schemes plus a few extra pastel pairings for a less repetitive street. */
export const SCHEMES: readonly Scheme[] = [
  ...HOUSE_SCHEMES.map((s) => ({ wall: s.wall, roof: s.roof, door: s.door, trim: s.trim })),
  { wall: '#ffe0e9', roof: PAL.roofBlue, door: PAL.doorBerry, trim: PAL.trimWhite },
  { wall: '#e9f6d6', roof: PAL.roofTerracotta, door: PAL.doorLilac, trim: PAL.trimWhite },
  { wall: '#ffe3cc', roof: PAL.roofTeal, door: PAL.doorBerry, trim: PAL.trimWhite },
  { wall: PAL.wallCream, roof: PAL.roofBerry, door: PAL.doorTeal, trim: PAL.trimWhite },
  { wall: '#f3e6ff', roof: PAL.roofCoral, door: PAL.doorTeal, trim: PAL.trimWhite },
];

/** Vertical gradient paint (bottom -> top) in frame space. */
export function vGrad(bottom: THREE.ColorRepresentation, top: THREE.ColorRepresentation, y0: number, y1: number): ColorFn {
  const a = col(bottom);
  const b = col(top);
  return (_x, y, _z, _nx, _ny, _nz, out) => {
    const t = Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
    out.copy(a).lerp(b, t);
  };
}

/**
 * Stylized foliage paint: deep underside, light sun-facing crown (sun from
 * -x/+y/+z), plus a little noise so neighbouring puffs never look identical.
 */
export function foliagePaint(deep: THREE.ColorRepresentation, base: THREE.ColorRepresentation, light: THREE.ColorRepresentation, cy: number, r: number): ColorFn {
  const d = col(deep);
  const m = col(base);
  const l = col(light);
  return (x, y, z, nx, ny, nz, out) => {
    const sun = nx * -0.45 + ny * 0.8 + nz * 0.3;
    const h = (y - cy) / r;
    let t = 0.5 + sun * 0.35 + h * 0.22;
    t += (Math.sin(x * 7.1 + z * 5.3) * Math.sin(y * 6.7 - x * 3.1)) * 0.06;
    t = Math.min(1, Math.max(0, t));
    if (t < 0.5) out.copy(d).lerp(m, t * 2);
    else out.copy(m).lerp(l, (t - 0.5) * 2);
  };
}

export function darker(c: THREE.ColorRepresentation, k: number): THREE.Color {
  return col(c).clone().multiplyScalar(k);
}

export function lighter(c: THREE.ColorRepresentation, t: number): THREE.Color {
  return col(c).clone().lerp(col('#ffffff'), t);
}

export function hexOf(c: THREE.Color): string {
  return `#${c.getHexString()}`;
}
