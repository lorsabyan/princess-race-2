import * as THREE from 'three';
import { PAL } from '../kit/palette';
import { lathe } from '../kit/geo';
import { ItemBuilder, itemEnvMap, itemMaterial, type Surf } from './surface';
import { heartOutline, reliefGeometry } from './shapes';

/**
 * The main collectible: a chunky gold coin with a rounded rim, a recessed satin
 * field and a polished pillowy heart embossed on both faces.
 *
 * One merged vertex-colored geometry (instancing friendly) centered at the
 * origin with the disc faces toward ±Z; spin it around Y.
 */

export const COIN_SIZE = { diameter: 0.954, thickness: 0.164 };

const FIELD_Z = 0.04;
const FIELD_R = 0.316;
const SEGMENTS = 36;

const COL = {
  rim: '#ffd455',
  edge: '#ffc648',
  field: '#f6a936',
  heart: '#ffdc58',
};

const SURF_RIM: Surf = { r: 0.16, m: 1, g: 0.05 };
const SURF_FIELD: Surf = { r: 0.34, m: 1, g: 0.03 };
const SURF_HEART: Surf = { r: 0.12, m: 1, g: 0.06 };

export function createCoinGeometry(): THREE.BufferGeometry {
  // Half profile (radius, z) from the field edge out to the rim edge. The flat field
  // itself is a separate disc (a lathe fan to the axis wastes degenerate triangles).
  const half: Array<[number, number]> = [
    [FIELD_R, FIELD_Z],
    [0.34, FIELD_Z + 0.012],
    [0.358, 0.07],
    [0.382, 0.081],
    [0.418, 0.081],
    [0.449, 0.07],
    [0.469, 0.046],
    [0.477, 0.016],
  ];
  // Lathe normals face outward when the profile runs from the back center,
  // around the edge, to the front center.
  const profile: Array<[number, number]> = [...half.map(([r, z]) => [r, -z] as [number, number]), ...half.slice().reverse()];
  const body = lathe(profile, SEGMENTS);
  body.rotateX(Math.PI / 2);

  const b = new ItemBuilder();
  const inField = (x: number, y: number, z: number) => Math.hypot(x, y) < FIELD_R + 0.012 && Math.abs(z) < FIELD_Z + 0.006;
  b.add(
    body,
    (x, y, z) => {
      if (inField(x, y, z)) return COL.field;
      return Math.abs(z) < 0.045 && Math.hypot(x, y) > 0.465 ? COL.edge : COL.rim;
    },
    (x, y, z) => (inField(x, y, z) ? SURF_FIELD : SURF_RIM),
  );
  body.dispose();

  // Field discs; vertices coincide with the lathe's first ring (same segment count, rotated to match).
  const disc = new THREE.CircleGeometry(FIELD_R, SEGMENTS);
  b.add(disc, COL.field, SURF_FIELD, { p: [0, 0, FIELD_Z] });
  b.add(disc, COL.field, SURF_FIELD, { p: [0, 0, -FIELD_Z], r: [0, Math.PI, 0] });
  disc.dispose();

  const heart = reliefGeometry(heartOutline(0.47, 8), 0.034, 0.032);
  b.add(heart, COL.heart, SURF_HEART, { p: [0, -0.004, FIELD_Z - 0.002] });
  b.add(heart, COL.heart, SURF_HEART, { p: [0, -0.004, -FIELD_Z + 0.002], r: [0, Math.PI, 0] });
  heart.dispose();

  const g = b.build();
  g.name = 'coin';
  return g;
}

/** Shared polished-gold material (curved world, studio reflections, bright highlights bloom). */
export function coinMaterial(): THREE.Material {
  return itemMaterial('coin', { envMap: itemEnvMap(), envMapIntensity: 1, glow: 1 });
}

/** Palette hook so UI can match the coin color. */
export const COIN_COLOR = PAL.coin;
