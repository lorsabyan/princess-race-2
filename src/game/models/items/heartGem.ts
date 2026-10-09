import * as THREE from 'three';
import { PAL } from '../kit/palette';
import { hash3, sphere } from '../kit/geo';
import { ItemBuilder, itemEnvMap, itemMaterial, type Surf } from './surface';
import { heartOutline, samplePolygon, scalePolygon } from './shapes';

/**
 * Rare bonus pickup (worth 5 coins): a brilliant-cut pink crystal heart in a
 * polished gold bezel with a halo of tiny gold beads. Faceted flat shading +
 * iridescent clearcoat + a gentle inner glow. One merged geometry, faces ±Z,
 * centered at the origin; spin it around Y like the coin.
 */

export const HEART_GEM_SIZE = { width: 1.1, thickness: 0.48 };

const GEM_SIZE = 0.9;
const GIRDLE = 0.035;
const CROWN_Z = 0.15;
const TABLE_Z = 0.215;

const GEM_COLORS = ['#ff5a95', '#ff4386', '#ff78ab', '#ff3a7c', '#ff8ab8'];
const SURF_GEM: Surf = { r: 0.04, m: 0, g: 0.34, c: 1 };
const SURF_GOLD: Surf = { r: 0.17, m: 1, g: 0.05 };

function centroid(poly: THREE.Vector2[]): THREE.Vector2 {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const cr = p.x * q.y - q.x * p.y;
    a += cr;
    cx += (p.x + q.x) * cr;
    cy += (p.y + q.y) * cr;
  }
  a *= 0.5;
  return new THREE.Vector2(cx / (6 * a), cy / (6 * a));
}

/** Brilliant-cut heart: girdle band, kite crown, table, mirrored pavilion. Non-indexed (flat facets). */
function gemGeometry(): THREE.BufferGeometry {
  const P = heartOutline(GEM_SIZE, 6);
  const n = P.length;
  const c = centroid(P);
  const mids = P.map((p, i) => p.clone().add(P[(i + 1) % n]).multiplyScalar(0.5));
  const Q = scalePolygon(mids, 0.8, c.x, c.y);
  const T = scalePolygon(P, 0.52, c.x, c.y);
  const pos: number[] = [];
  const tri = (a: THREE.Vector2, az: number, b: THREE.Vector2, bz: number, d: THREE.Vector2, dz: number, back: boolean) => {
    if (back) pos.push(a.x, a.y, -az, d.x, d.y, -dz, b.x, b.y, -bz);
    else pos.push(a.x, a.y, az, b.x, b.y, bz, d.x, d.y, dz);
  };
  for (const back of [false, true]) {
    for (let i = 0; i < n; i += 1) {
      const i1 = (i + 1) % n;
      const im = (i - 1 + n) % n;
      // Star/kite facets between the girdle and the crown ring.
      tri(P[i], GIRDLE, P[i1], GIRDLE, Q[i], CROWN_Z, back);
      tri(Q[i], CROWN_Z, P[i1], GIRDLE, Q[i1], CROWN_Z, back);
      // Upper facets from the crown ring to the table edge.
      tri(Q[im], CROWN_Z, Q[i], CROWN_Z, T[i], TABLE_Z, back);
      tri(T[i], TABLE_Z, Q[i], CROWN_Z, T[i1], TABLE_Z, back);
    }
    // Low faceted dome instead of a flat table: every wedge catches the light differently.
    for (let i = 0; i < n; i += 1) tri(T[i], TABLE_Z, T[(i + 1) % n], TABLE_Z, c, TABLE_Z + 0.03, back);
  }
  // Girdle band.
  for (let i = 0; i < n; i += 1) {
    const a = P[i];
    const b = P[(i + 1) % n];
    pos.push(a.x, a.y, -GIRDLE, b.x, b.y, -GIRDLE, b.x, b.y, GIRDLE);
    pos.push(a.x, a.y, -GIRDLE, b.x, b.y, GIRDLE, a.x, a.y, GIRDLE);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Round tube that follows a closed polygon exactly (miter frames), lying in the XY plane. */
function outlineTube(poly: THREE.Vector2[], radius: number, radial = 6): THREE.BufferGeometry {
  const n = poly.length;
  const pos: number[] = [];
  const nor: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = poly[(i - 1 + n) % n];
    const p = poly[i];
    const b = poly[(i + 1) % n];
    const t = new THREE.Vector2(b.x - a.x, b.y - a.y).normalize();
    const m = new THREE.Vector2(t.y, -t.x); // outward for CCW
    for (let j = 0; j < radial; j += 1) {
      const phi = (j / radial) * Math.PI * 2;
      const cx = Math.cos(phi);
      const sz = Math.sin(phi);
      pos.push(p.x + m.x * cx * radius, p.y + m.y * cx * radius, sz * radius);
      nor.push(m.x * cx, m.y * cx, sz);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const i1 = (i + 1) % n;
    for (let j = 0; j < radial; j += 1) {
      const j1 = (j + 1) % radial;
      const a = i * radial + j;
      const b = i1 * radial + j;
      const c2 = i1 * radial + j1;
      const d = i * radial + j1;
      idx.push(a, b, c2, a, c2, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

export function createHeartGemGeometry(): THREE.BufferGeometry {
  const b = new ItemBuilder();
  const gem = gemGeometry();
  const deep = new THREE.Color(PAL.heartGem);
  b.add(
    gem,
    (_x, _y, _z, nx, ny, nz) => {
      // Per-facet tint so the cut reads even in flat light; brighter toward the table.
      const h = hash3(Math.round(nx * 40), Math.round(ny * 40), Math.round(nz * 40));
      const base = new THREE.Color(GEM_COLORS[Math.floor(h * GEM_COLORS.length) % GEM_COLORS.length]);
      if (Math.abs(nz) > 0.93) return base.lerp(new THREE.Color('#ffb0d0'), 0.5);
      if (Math.abs(nz) < 0.2) return deep.clone().multiplyScalar(0.85);
      return base;
    },
    SURF_GEM,
    { flat: false },
  );
  gem.dispose();

  const P = heartOutline(GEM_SIZE, 14);
  const c = centroid(P);
  const bezel = outlineTube(scalePolygon(P, 1.035, c.x, c.y), 0.052, 7);
  b.add(bezel, PAL.gold, SURF_GOLD);
  bezel.dispose();

  // Halo: gold beads strung along the outside of the bezel (skipping the cusp notch).
  const halo = scalePolygon(heartOutline(GEM_SIZE, 30), 1.135, c.x, c.y);
  const bead = sphere(0.04, 8, 5);
  for (const p of samplePolygon(halo, 18)) {
    if (Math.abs(p.x) < 0.12 && p.y > c.y) continue;
    b.add(bead, PAL.gold, SURF_GOLD, { p: [p.x, p.y, 0] });
  }
  bead.dispose();

  const g = b.build();
  // Recenter so the whole gem (bezel + halo) is centered on the origin.
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  g.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, 0);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  g.name = 'heart-gem';
  return g;
}

/** Shared pink-crystal + gold material (physical: iridescent clearcoat, inner glow). */
export function heartGemMaterial(): THREE.Material {
  return itemMaterial('heart-gem', {
    physical: true,
    envMap: itemEnvMap(),
    envMapIntensity: 1.1,
    glow: 1,
    params: {
      ior: 1.9,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      iridescence: 0.85,
      iridescenceIOR: 1.45,
      iridescenceThicknessRange: [240, 620],
      specularIntensity: 1,
    },
  });
}
