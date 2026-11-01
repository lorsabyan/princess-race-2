import * as THREE from 'three';
import { BIOME } from '../country/biome';
import type { Area } from '../../sim/route';
import { type Bins } from './bins';
import { memo } from './prims';
import * as P from './prims';

/**
 * Stand-ins drawn far down the road, a few dozen triangles per object, so the
 * player can see the road wind into the distance without paying for the detail.
 */

const ROAD = '#f2c6d6';
const WALK = '#f7e7da';

/** Plain road + verge + lawn strip, with enough rows to follow a bend. */
function stripGeometry(reach: number): THREE.BufferGeometry {
  return memo(`farStrip:${reach}`, () => {
    const xs = [-reach, -6.2, -4.3, 4.3, 6.2, reach];
    const rows = 7;
    const pos: number[] = [];
    const nor: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j < rows; j += 1) {
      const z = -(j / (rows - 1)) * 40;
      for (const x of xs) {
        pos.push(x, 0.02, z);
        nor.push(0, 1, 0);
      }
    }
    const cols = xs.length;
    for (let j = 0; j < rows - 1; j += 1) {
      for (let i = 0; i < cols - 1; i += 1) {
        const a = j * cols + i;
        idx.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    return g;
  });
}

export function farStrip(b: Bins, area: Area, reach: number): void {
  const tone = BIOME[area];
  b.add('matte', stripGeometry(reach), (x, _y, _z, _nx, _ny, _nz, out) => {
    const ax = Math.abs(x);
    if (ax <= 4.31) out.set(ROAD);
    else if (ax <= 6.21) out.set(area === 'town' || area === 'castle' ? WALK : tone.base);
    else out.set(tone.base);
  });
}

export function farBox(b: Bins, x: number, y: number, z: number, yaw: number, w: number, h: number, d: number, wall: string, roof: string): void {
  b.add('matte', P.box(1, 1, 1), wall, { p: [x, y + h / 2, z], r: [0, yaw, 0], s: [d, h, w] });
  b.add('matte', P.pyramid(), roof, { p: [x, y + h, z], r: [0, yaw, 0], s: [d * 1.12, Math.min(d, w) * 0.5, w * 1.12] });
}

export function farCrown(b: Bins, x: number, y: number, z: number, height: number, color: string): void {
  b.add('foliage', P.icoSmooth(1, 1), color, { p: [x, y + height * 0.6, z], s: [height * 0.38, height * 0.46, height * 0.38] });
}
