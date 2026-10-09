import * as THREE from 'three';
import { PAL } from '../kit/palette';
import { extrude, heartShape, rbox, sphere, tube, valueNoise3, type Vec3 } from '../kit/geo';
import { blend, displace, move, roundBox } from '../kit/sdf';
import { meshSdf } from '../kit/mesher';
import {
  Bag,
  FLOWER_GEO,
  archFrameShape,
  archOutline,
  archWindow,
  bush,
  coneRoof,
  finial,
  garland,
  heartWindow,
  hipRoof,
  latheRings,
  roundTower,
  roundTree,
  roundWindow,
  topiary,
  vgrad,
  type Col,
} from './kit';
import { Cloth } from './cloth';
import { BALUSTER, ROSES, hedgeRow, lantern, tileFloor } from './garden';
import type { PrincessHome } from './types';

/**
 * The princess's home: a little pink manor with a round tower, a mansard roof
 * and a front garden (rose-arbor gate, fountain, topiary, lamp posts). It sits
 * on the LEFT of the road. Origin = road center at the car's parking spot.
 */

const C = {
  wall: '#ffcdd6',
  wallDeep: '#ffb8c6',
  stone: '#fff0e2',
  trim: PAL.trimWhite,
  roof: PAL.roofBerry,
  roofAlt: PAL.roofCoral,
  door: PAL.doorTeal,
  shutter: '#8ed8c8',
  path: '#fff1e4',
  pathAlt: '#ffdce2',
  curb: '#fbe7d8',
  gold: PAL.gold,
  lamp: '#fff0c0',
};

// Layout (meters).
const FX = -7.2; // garden fence line
const LX = -6.45; // front edge of the garden lawn (curb), just behind the town sidewalk
const HX = -14.6; // house facade (faces +x toward the road)
const HD = 7.0; // house depth (x)
const HW = 10.6; // house width (z)
const WH = 6.3; // wall height (two floors)
const GY = 0.24; // lawn level (above the town's lawn at 0.18 so the garden covers it)
const BACK = -25.6; // back of the garden
const ZS = 10; // garden half width (z)
const PORCH = GY + 0.5; // porch floor height

const FLOWERS_A: Col[] = [PAL.flowerRose, PAL.flowerWhite, PAL.blossom, PAL.flowerYellow, PAL.flowerRose];
const FLOWERS_B: Col[] = [PAL.flowerLilac, PAL.flowerWhite, PAL.blossom, PAL.flowerLilac, PAL.flowerBlue];

/** Arched window with shutters, a sill and a flower box, on a wall facing ry. */
function shutteredWindow(bag: Bag, x: number, y: number, z: number, ry: number, w: number, h: number, hearts: boolean, flowers = true): void {
  archWindow(bag, x, y, z, ry, w, h, { frame: C.trim, mullion: true, flowers, sill: flowers ? undefined : C.trim, keystone: C.wallDeep });
  const nx = Math.sin(ry);
  const nz = Math.cos(ry);
  const tx = Math.cos(ry);
  const tz = -Math.sin(ry);
  const sw = w * 0.42;
  const off = w / 2 + 0.12 + sw / 2 + 0.06;
  for (const s of [-1, 1]) {
    const px = x + tx * off * s + nx * 0.08;
    const pz = z + tz * off * s + nz * 0.08;
    bag.matte.add(rbox(sw, h * 0.86, 0.07, 0.025, 1), C.shutter, { p: [px, y + h * 0.45, pz], r: [0, ry, 0] });
    // Louver lines.
    for (let k = 1; k <= 3; k += 1) {
      bag.matte.add(new THREE.BoxGeometry(sw * 0.8, 0.03, 0.03), '#6fc4b2', { p: [px + nx * 0.04, y + h * 0.45 - h * 0.32 + k * h * 0.16, pz + nz * 0.04], r: [0, ry, 0] });
    }
    if (hearts) {
      const hg = extrude(heartShape(sw * 0.5), 0.03, 0, 1, 6);
      bag.matte.add(hg, PAL.flowerRose, { p: [px + nx * 0.05, y + h * 0.78, pz + nz * 0.05], r: [0, ry, 0] });
      hg.dispose();
    }
  }
}

/** Clipped boxwood hedge (SDF rounded box with soft noise), along X or Z. */
function boxHedge(bag: Bag, a0: number, a1: number, c: number, h: number, d: number, alongZ: boolean, seed: number): void {
  const len = Math.abs(a1 - a0);
  const mid = (a0 + a1) / 2;
  const field = displace(
    blend(0.2, move(roundBox(len / 2, h / 2, d / 2, Math.min(0.35, d / 2)), 0, h / 2, 0)),
    (x, y, z) => (valueNoise3(x * 2.4 + seed, y * 2.4, z * 2.4) - 0.5) * 0.12,
  );
  const deep = new THREE.Color(PAL.leafDeep);
  const leaf = new THREE.Color(PAL.leaf);
  const tmp = new THREE.Color();
  const g = meshSdf(field, {
    min: [-len / 2 - 0.3, -0.05, -d / 2 - 0.3],
    max: [len / 2 + 0.3, h + 0.3, d / 2 + 0.3],
    cell: 0.26,
    project: 1,
    colorFn: (x, y, z) => tmp.copy(deep).lerp(leaf, Math.min(1, Math.max(0, y / h)) ** 1.3).offsetHSL(0, 0, (valueNoise3(x * 3, y * 3, z * 3 + seed) - 0.5) * 0.06).getHex(),
    wind: (_x, y) => 0.01 * Math.max(0, y / h),
  });
  bag.foliage.addColored(g, alongZ ? { p: [c, GY, mid], r: [0, Math.PI / 2, 0] } : { p: [mid, GY, c] });
  g.dispose();
}

function picket(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  const w = 0.13;
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, 0.82);
  s.quadraticCurveTo(w / 2, 0.93, 0, 1.0);
  s.quadraticCurveTo(-w / 2, 0.93, -w / 2, 0.82);
  s.lineTo(-w / 2, 0);
  return extrude(s, 0.05, 0, 1, 3);
}

/** Picket fence along a straight line (pickets face the direction perpendicular to the run). */
function fence(bag: Bag, x0: number, z0: number, x1: number, z1: number, pk: THREE.BufferGeometry): void {
  const len = Math.hypot(x1 - x0, z1 - z0);
  const ry = Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2;
  const n = Math.max(1, Math.round(len / 0.27));
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    bag.matte.add(pk, C.trim, { p: [x0 + (x1 - x0) * t, GY, z0 + (z1 - z0) * t], r: [0, ry, 0] });
  }
  for (const ry2 of [0.28, 0.68]) {
    bag.matte.add(new THREE.BoxGeometry(len, 0.07, 0.05), C.trim, { p: [(x0 + x1) / 2, GY + ry2, (z0 + z1) / 2], r: [0, ry, 0], s: [1, 1, 1] });
  }
  // Posts with ball caps at both ends.
  for (const [px, pz] of [[x0, z0], [x1, z1]]) {
    bag.matte.add(rbox(0.2, 1.05, 0.2, 0.05, 1), C.trim, { p: [px, GY + 0.52, pz] });
    bag.matte.add(sphere(0.11, 8, 6), C.trim, { p: [px, GY + 1.14, pz] });
  }
}

function lampPost(bag: Bag, x: number, z: number, h = 2.9): void {
  bag.metal.addColored(
    latheRings(
      [
        [0.24, 0, C.gold],
        [0.26, 0.08],
        [0.2, 0.18],
        [0.1, 0.34],
        [0.08, 0.5],
      ],
      { segments: 12 },
    ),
    { p: [x, GY, z] },
  );
  bag.matte.add(new THREE.CylinderGeometry(0.055, 0.075, h - 0.5, 8), C.trim, { p: [x, GY + 0.5 + (h - 0.5) / 2, z] });
  bag.metal.add(new THREE.TorusGeometry(0.09, 0.03, 4, 10), C.gold, { p: [x, GY + h * 0.55, z], r: [Math.PI / 2, 0, 0] });
  // Lantern head: gold cage, glowing globe, little roof and finial.
  const top = GY + h;
  bag.metal.addColored(
    latheRings(
      [
        [0.02, -0.08, C.gold],
        [0.14, -0.02],
        [0.2, 0.06],
        [0.2, 0.08],
        [0.03, 0.08],
      ],
      { segments: 10 },
    ),
    { p: [x, top, z] },
  );
  bag.glow.add(sphere(0.19, 12, 9), C.lamp, { p: [x, top + 0.3, z], s: [1, 1.15, 1] });
  bag.metal.addColored(
    latheRings(
      [
        [0.24, 0, C.gold],
        [0.26, 0.04],
        [0.1, 0.2],
        [0.03, 0.3],
        [0.0, 0.32],
      ],
      { segments: 10 },
    ),
    { p: [x, top + 0.52, z] },
  );
  bag.metal.add(sphere(0.05, 8, 6), C.gold, { p: [x, top + 0.9, z] });
}

function fountain(bag: Bag, x: number, z: number): void {
  const pink = '#ffc0cf';
  // Paved plaza.
  const plaza = new THREE.CircleGeometry(1.88, 36).rotateX(-Math.PI / 2);
  bag.matte.add(plaza, C.path, { p: [x, GY + 0.022, z] });
  plaza.dispose();
  const ring = new THREE.RingGeometry(1.88, 2.1, 36).rotateX(-Math.PI / 2);
  bag.matte.add(ring, C.pathAlt, { p: [x, GY + 0.022, z] });
  ring.dispose();
  // Lower basin.
  bag.matte.addColored(
    latheRings(
      [
        [1.55, 0, C.stone],
        [1.62, 0.1],
        [1.62, 0.44],
        [1.66, 0.5, C.trim],
        [1.6, 0.58],
        [1.42, 0.58],
        [1.38, 0.5, pink],
        [1.34, 0.36],
        [0.0, 0.36],
      ],
      { segments: 32, shade: { y0: 0, y1: 0.5, k: 0.85 } },
    ),
    { p: [x, GY, z] },
  );
  const water = new THREE.CircleGeometry(1.36, 32).rotateX(-Math.PI / 2);
  bag.gloss.add(water, '#8fd4f5', { p: [x, GY + 0.46, z] });
  water.dispose();
  // Pedestal + upper bowl + top basin.
  bag.matte.addColored(
    latheRings(
      [
        [0.34, 0.3, C.stone],
        [0.3, 0.5],
        [0.18, 0.7],
        [0.24, 0.95],
        [0.16, 1.15],
        [0.18, 1.3, C.trim],
        [0.66, 1.42],
        [0.72, 1.52],
        [0.66, 1.56],
        [0.6, 1.5, pink],
        [0.0, 1.5],
      ],
      { segments: 24 },
    ),
    { p: [x, GY, z] },
  );
  const w2 = new THREE.CircleGeometry(0.6, 24).rotateX(-Math.PI / 2);
  bag.gloss.add(w2, '#8fd4f5', { p: [x, GY + 1.53, z] });
  w2.dispose();
  // Heart-topped spout.
  bag.matte.addColored(
    latheRings(
      [
        [0.14, 1.5, C.stone],
        [0.08, 1.75],
        [0.13, 1.9],
        [0.05, 2.02],
        [0.0, 2.04],
      ],
      { segments: 12 },
    ),
    { p: [x, GY, z] },
  );
  const hh = extrude(heartShape(0.34), 0.08, 0.03, 1, 8);
  bag.gloss.add(hh, PAL.heartGem, { p: [x, GY + 2.2, z], r: [0, Math.PI / 2, 0] });
  hh.dispose();
  // Water arcs spilling from the top bowl into the basin.
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const pts: Vec3[] = [
      [x + Math.cos(a) * 0.7, GY + 1.52, z + Math.sin(a) * 0.7],
      [x + Math.cos(a) * 0.86, GY + 1.3, z + Math.sin(a) * 0.86],
      [x + Math.cos(a) * 0.98, GY + 0.9, z + Math.sin(a) * 0.98],
      [x + Math.cos(a) * 1.02, GY + 0.47, z + Math.sin(a) * 1.02],
    ];
    bag.gloss.add(tube(pts, 0.035, 10, 4), '#bfe9ff');
  }
  // Rim flowers.
  for (let i = 0; i < 10; i += 1) {
    const a = (i / 10) * Math.PI * 2;
    bag.foliage.add(FLOWER_GEO, i % 2 ? PAL.flowerRose : PAL.flowerWhite, { p: [x + Math.cos(a) * 1.78, GY + 0.1, z + Math.sin(a) * 1.78], s: 0.11 });
  }
}

function mailbox(bag: Bag, x: number, z: number): void {
  bag.matte.add(new THREE.BoxGeometry(0.1, 1.0, 0.1), C.trim, { p: [x, 0.5, z] });
  const body = new THREE.Shape();
  body.moveTo(-0.22, 0);
  body.lineTo(0.22, 0);
  body.lineTo(0.22, 0.2);
  body.absarc(0, 0.2, 0.22, 0, Math.PI, false);
  body.lineTo(-0.22, 0);
  bag.gloss.add(extrude(body, 0.52, 0.04, 1, 8), PAL.flowerRose, { p: [x, 1.0, z], r: [0, Math.PI / 2, 0] });
  const hg = extrude(heartShape(0.18), 0.03, 0.01, 1, 6);
  bag.metal.add(hg, C.gold, { p: [x + 0.3, 1.22, z], r: [0, Math.PI / 2, 0] });
  hg.dispose();
  bag.metal.add(new THREE.BoxGeometry(0.03, 0.3, 0.05), C.gold, { p: [x - 0.1, 1.35, z - 0.26] });
  bag.matte.add(new THREE.BoxGeometry(0.03, 0.12, 0.2), PAL.flowerRed, { p: [x - 0.1, 1.52, z - 0.34] });
}

export function createPrincessHome(): PrincessHome {
  const group = new THREE.Group();
  group.name = 'princessHome';
  const bag = new Bag();
  const cloth = new Cloth('homeFlags');
  const S = [-1, 1] as const;
  const FACE = Math.PI / 2; // facade faces +x

  // -------------------------------------------------------------------------
  // Garden ground: lawn with curb border
  // -------------------------------------------------------------------------
  {
    const w = LX - BACK;
    const d = ZS * 2;
    const cx = (LX + BACK) / 2;
    const lawn = new THREE.PlaneGeometry(w, d, 22, 24).rotateX(-Math.PI / 2);
    const gA = new THREE.Color(PAL.grass);
    const gB = new THREE.Color(PAL.grassLight);
    const gC = new THREE.Color(PAL.grassDeep);
    const tmp = new THREE.Color();
    bag.matte.add(lawn, (x, _y, z) => {
      // Large soft patches only (fine noise would alias into streaks on this grid).
      const n = valueNoise3((x + cx) * 0.16, 0.5, z * 0.16);
      tmp.copy(gA).lerp(n > 0.5 ? gB : gC, Math.min(1, Math.abs(n - 0.5) * 0.9));
      return tmp.getHex();
    }, { p: [cx, GY, 0] });
    lawn.dispose();
    // Soil skirt under the lawn so the garden reads as a raised bed.
    // (top face sits 3 cm below the lawn to avoid z-fighting with it)
    // (z-subdivided so the curved-world bend follows it along its length)
    bag.matte.add(new THREE.BoxGeometry(w + 0.1, GY + 0.07, d + 0.1, 1, 1, 8), PAL.grassDeep, { p: [cx, (GY - 0.03) / 2 - 0.05, 0] });
    // Cream curb along the road side (with a gap for the gate).
    for (const s of S) {
      const zl = ZS - 1.3;
      bag.matte.add(rbox(0.32, GY + 0.08, zl, 0.08, 1), C.curb, { p: [LX, (GY + 0.08) / 2, s * (1.3 + zl / 2)] });
    }
    for (const s of S) bag.matte.add(rbox(w, GY + 0.1, 0.3, 0.08, 1), C.curb, { p: [cx, (GY + 0.1) / 2, s * ZS] });
  }

  // -------------------------------------------------------------------------
  // House: two floors, mansard roof, dormers, chimney
  // -------------------------------------------------------------------------
  const hx = HX - HD / 2;
  {
    bag.matte.add(rbox(HD, WH, HW, 0.28, 2), vgrad(C.wall, GY + 1, GY + WH), { p: [hx, GY + WH / 2, 0], shade: { y0: GY, y1: GY + 2.6, k: 0.8 } });
    bag.matte.add(rbox(HD + 0.3, 0.75, HW + 0.3, 0.1, 1), C.stone, { p: [hx, GY + 0.37, 0] });
    bag.matte.add(rbox(HD + 0.16, 0.22, HW + 0.16, 0.06, 1), C.trim, { p: [hx, GY + 3.25, 0] });
    bag.matte.add(rbox(HD + 0.36, 0.34, HW + 0.36, 0.1, 1), C.trim, { p: [hx, GY + WH - 0.12, 0] });
    // Corner quoins on the facade corners.
    for (const s of S) {
      for (let k = 0; k < 7; k += 1) {
        const wq = k % 2 === 0 ? 0.5 : 0.34;
        bag.matte.add(new THREE.BoxGeometry(0.12, 0.6, wq), C.stone, { p: [HX + 0.04, GY + 0.95 + k * 0.72, s * (HW / 2 - wq / 2 - 0.05)] });
      }
    }
    const roofH = 4.3;
    const roofY = GY + WH - 0.02;
    bag.satin.addColored(
      hipRoof({ hw: HD / 2 + 0.6, hd: HW / 2 + 0.6, r: 1.0, H: roofH, color: C.roof, breakInset: 1.35, breakH: 2.5, rows: 8 }),
      { p: [hx, roofY, 0] },
    );
    // Ridge cap and finials.
    const ridgeHalf = HW / 2 - HD / 2;
    bag.metal.add(new THREE.CylinderGeometry(0.09, 0.09, ridgeHalf * 2 + 0.2, 8), C.gold, { p: [hx, roofY + roofH + 0.02, 0], r: [Math.PI / 2, 0, 0] });
    for (const s of S) finial(bag.metal, bag.gloss, hx, roofY + roofH - 0.05, s * ridgeHalf, 0.8, 'heart');
    // Dormers on the front slope.
    for (const s of S) {
      const dz = s * 2.7;
      const dx = HX + 0.05;
      const dy = roofY + 0.55;
      bag.matte.add(rbox(1.9, 1.55, 1.45, 0.08, 1), C.wall, { p: [dx - 0.95, dy + 0.77, dz] });
      const barrel = new THREE.CylinderGeometry(0.82, 0.82, 2.0, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(0);
      bag.satin.add(barrel, C.roof, { p: [dx - 0.95, dy + 1.55, dz], r: [0, 0, 0], s: [1, 0.85, 1] });
      barrel.dispose();
      archWindow(bag, dx, dy + 0.2, dz, FACE, 0.7, 1.1, { frame: C.trim, t: 0.09 });
    }
    // Chimney.
    const chx = hx - 1.7;
    const chz = 3.0;
    bag.matte.add(rbox(0.9, 2.6, 0.9, 0.08, 1), '#f7a6b8', { p: [chx, roofY + 3.2, chz] });
    bag.matte.add(rbox(1.1, 0.24, 1.1, 0.06, 1), C.trim, { p: [chx, roofY + 4.55, chz] });
    bag.matte.add(new THREE.CylinderGeometry(0.2, 0.22, 0.4, 10), '#e98fa4', { p: [chx + 0.2, roofY + 4.85, chz + 0.15] });
    const ch = extrude(heartShape(0.4), 0.05, 0, 1, 6);
    bag.matte.add(ch, PAL.trimWhite, { p: [chx + 0.46, roofY + 3.9, chz], r: [0, FACE, 0] });
    ch.dispose();

    // Facade windows (shuttered, flower boxes) and side windows.
    for (const s of S) {
      shutteredWindow(bag, HX, GY + 1.0, s * 3.3, FACE, 1.1, 1.85, true);
      shutteredWindow(bag, HX, GY + 3.85, s * 3.3, FACE, 0.95, 1.6, false);
    }
    shutteredWindow(bag, hx - 0.3, GY + 3.95, HW / 2, 0, 0.95, 1.55, false, false);
    shutteredWindow(bag, hx + 0.6, GY + 1.0, -HW / 2, Math.PI, 1.05, 1.8, false);
    shutteredWindow(bag, hx - 1.2, GY + 3.85, -HW / 2, Math.PI, 0.95, 1.6, false, false);
  }

  // -------------------------------------------------------------------------
  // Porch with columns, balcony and the front door
  // -------------------------------------------------------------------------
  const doorX = HX + 0.02;
  {
    bag.matte.add(rbox(1.9, 0.5, 3.7, 0.07, 1), C.stone, { p: [HX + 0.95, GY + 0.25, 0] });
    bag.matte.add(rbox(0.48, 0.34, 2.7, 0.05, 1), C.stone, { p: [HX + 2.1, GY + 0.17, 0] });
    bag.matte.add(rbox(0.48, 0.17, 3.0, 0.04, 1), '#fbe6da', { p: [HX + 2.55, GY + 0.085, 0] });
    const col = latheRings(
      [
        [0.24, 0, C.trim],
        [0.24, 0.12],
        [0.15, 0.2],
        [0.13, 2.45],
        [0.17, 2.55],
        [0.26, 2.66],
        [0.26, 2.76],
        [0.0, 2.77],
      ],
      { segments: 12 },
    );
    for (const s of S) bag.matte.addColored(col, { p: [HX + 1.55, PORCH, s * 1.5] });
    // Balcony slab on the columns + balustrade.
    const by = PORCH + 2.77;
    bag.matte.add(rbox(2.1, 0.3, 3.9, 0.08, 1), C.trim, { p: [HX + 1.0, by + 0.15, 0] });
    for (let i = 0; i <= 8; i += 1) bag.matte.addColored(BALUSTER, { p: [HX + 1.85, by + 0.3, -1.6 + (i / 8) * 3.2], s: [0.9, 1.1, 0.9] });
    for (const s of S) for (let i = 1; i <= 2; i += 1) bag.matte.addColored(BALUSTER, { p: [HX + 1.85 - i * 0.55, by + 0.3, s * 1.8], s: [0.9, 1.1, 0.9] });
    bag.matte.add(rbox(0.2, 0.1, 3.9, 0.04, 1), C.trim, { p: [HX + 1.85, by + 0.98, 0] });
    for (const s of S) bag.matte.add(rbox(1.8, 0.1, 0.2, 0.04, 1), C.trim, { p: [HX + 1.0, by + 0.98, s * 1.85] });
    // Flower pots on the balcony corners.
    for (const s of S) bush(bag, HX + 1.62, by + 0.55, s * 1.62, 0.28, s > 0 ? 31 : 32, { flowers: ROSES, flowerCount: 5, detail: 1, squash: 0.9 });
    // Balcony French door.
    archWindow(bag, HX, by + 0.32, 0, FACE, 1.2, 2.2, { frame: C.trim, mullion: true, keystone: C.wallDeep });
    // Door: stone frame, teal leaf with heart window, gold knob.
    const dw = 1.5;
    const dh = 2.55;
    const frame = extrude(archFrameShape(dw, dh, 0.24, 0.01), 0.3, 0.05, 1, 14);
    bag.matte.add(frame, C.stone, { p: [doorX + 0.08, PORCH, 0], r: [0, FACE, 0] });
    frame.dispose();
    const leaf = extrude(archOutline(dw + 0.02, dh + 0.01), 0.12, 0.025, 1, 14);
    bag.gloss.add(leaf, C.door, { p: [doorX + 0.02, PORCH, 0], r: [0, FACE, 0] });
    leaf.dispose();
    const hw2 = extrude(heartShape(0.46), 0.05, 0.015, 1, 8);
    bag.glass.add(hw2, PAL.glass, { p: [doorX + 0.17, PORCH + 1.85, 0], r: [0, FACE, 0] });
    hw2.dispose();
    const hwf = extrude(heartShape(0.6), 0.04, 0, 1, 8);
    bag.metal.add(hwf, C.gold, { p: [doorX + 0.15, PORCH + 1.85, 0], r: [0, FACE, 0] });
    hwf.dispose();
    bag.metal.add(sphere(0.07, 8, 6), C.gold, { p: [doorX + 0.2, PORCH + 1.1, 0.5] });
    for (const hy of [0.45, 1.5]) bag.metal.add(new THREE.BoxGeometry(0.04, 0.1, 0.7), C.gold, { p: [doorX + 0.16, PORCH + hy, -0.4] });
    for (const s of S) lantern(bag, HX, PORCH + 1.75, s * 1.15, FACE);
    // Heart topiaries flanking the steps.
    for (const s of S) topiary(bag, HX + 2.5, s * 1.95, 1.3, 'heart', C.stone, s > 0 ? 41 : 42, GY);
  }

  // -------------------------------------------------------------------------
  // Round tower on the front-left corner (-z side)
  // -------------------------------------------------------------------------
  {
    const tx = HX + 0.15;
    const tz = -HW / 2 - 0.1;
    const top = roundTower(bag, tx, tz, {
      base: GY,
      r: 2.05,
      h: 8.0,
      capH: 0.95,
      flare: 0.32,
      corbelH: 0.55,
      bands: [3.2],
      brackets: 12,
      wall: C.wallDeep,
      trim: C.trim,
      stone: C.stone,
      segments: 26,
      seamPhi: 0,
    });
    bag.satin.addColored(coneRoof({ R: top.r + 0.38, H: 4.7, color: C.roof, segments: 26, kick: 0.16 }), { p: [tx, top.y - 0.04, tz] });
    bag.metal.add(new THREE.TorusGeometry(top.r + 0.05, 0.07, 4, 26), C.gold, { p: [tx, top.y + 0.02, tz], r: [Math.PI / 2, 0, 0] });
    const pole = finial(bag.metal, bag.gloss, tx, top.y + 4.62, tz, 0.95, 'pole');
    cloth.add({ anchor: [tx + 0.04, pole - 0.08, tz], yaw: -0.35, length: 2.1, height: 0.95, shape: 'swallow', color: C.roof, color2: C.roof, emblem: 'heart', emblemColor: C.gold, phase: 0.7 });
    const a1 = 0.85; // toward the road (+x) and the title camera (-z)
    archWindow(bag, tx + Math.sin(FACE) * 2.05, GY + 1.2, tz, FACE, 0.8, 1.5, { frame: C.trim, keystone: C.wallDeep, sill: C.trim });
    archWindow(bag, tx + Math.sin(FACE + a1) * 2.02, GY + 3.9, tz + Math.cos(FACE + a1) * 2.02, FACE + a1, 0.75, 1.4, { frame: C.trim, keystone: C.wallDeep, flowers: true });
    heartWindow(bag, tx + Math.sin(FACE - 0.35) * 2.02, GY + 6.3, tz + Math.cos(FACE - 0.35) * 2.02, FACE - 0.35, 0.75, C.trim);
    for (let i = -1; i <= 1; i += 1) {
      const a = FACE + 0.35 + i * 0.75;
      const rr = top.r - 0.09;
      roundWindow(bag, tx + Math.sin(a) * rr, (top.capY0 + top.capY1) / 2, tz + Math.cos(a) * rr, a, 0.22);
    }
    // Climbing roses up the tower's road side.
    const vine: Vec3[] = [];
    for (let i = 0; i <= 7; i += 1) {
      const t = i / 7;
      const a = FACE + 0.55 + Math.sin(t * 5) * 0.16;
      vine.push([tx + Math.sin(a) * 2.2, GY + 0.3 + t * 3.8, tz + Math.cos(a) * 2.2]);
    }
    garland(bag, vine, { thick: 0.17, seed: 5, density: 0.85, flowers: ROSES, wind: 0.012, out: [Math.sin(FACE + 0.55), 0, Math.cos(FACE + 0.55)] });
  }

  // -------------------------------------------------------------------------
  // Side wing (+z): single story with big arched windows
  // -------------------------------------------------------------------------
  {
    const wx = HX - 3.0;
    const wz = HW / 2 + 1.7;
    const ww = 4.2; // along x
    const wd = 3.4; // along z
    const wh = 3.2;
    bag.matte.add(rbox(ww, wh, wd, 0.25, 2), C.wall, { p: [wx, GY + wh / 2, wz], shade: { y0: GY, y1: GY + 2, k: 0.82 } });
    bag.matte.add(rbox(ww + 0.26, 0.7, wd + 0.26, 0.08, 1), C.stone, { p: [wx, GY + 0.35, wz] });
    bag.matte.add(rbox(ww + 0.3, 0.26, wd + 0.3, 0.08, 1), C.trim, { p: [wx, GY + wh - 0.1, wz] });
    bag.satin.addColored(hipRoof({ hw: ww / 2 + 0.45, hd: wd / 2 + 0.45, r: 0.7, H: 1.9, color: C.roofAlt, breakInset: 0.8, breakH: 1.05, rows: 5 }), { p: [wx, GY + wh - 0.02, wz] });
    finial(bag.metal, bag.gloss, wx - (ww / 2 - wd / 2), GY + wh + 1.82, wz, 0.65, 'ball');
    finial(bag.metal, bag.gloss, wx + (ww / 2 - wd / 2), GY + wh + 1.82, wz, 0.65, 'ball');
    archWindow(bag, wx + ww / 2, GY + 0.85, wz, FACE, 1.2, 1.95, { frame: C.trim, mullion: true, flowers: true, keystone: C.wallDeep });
    for (const ox of [-1.0, 1.0]) archWindow(bag, wx + ox, GY + 0.85, wz + wd / 2, 0, 0.95, 1.85, { frame: C.trim, mullion: true, sill: C.trim, keystone: C.wallDeep });
  }

  // -------------------------------------------------------------------------
  // Front garden: path, fence + rose arbor gate, lamps, fountain, beds, trees
  // -------------------------------------------------------------------------
  {
    // Path from the steps to the curb (checker of cream and blush stones) with curbs.
    const px0 = HX + 2.78;
    const path = tileFloor(px0, LX - 0.14, -0.85, 0.85, GY + 0.012, 0.56, (i, j) => ((i + j) % 2 === 0 ? C.path : C.pathAlt));
    bag.matte.addColored(path);
    path.dispose();
    for (const s of S) bag.matte.add(new THREE.BoxGeometry(FX - 0.3 - px0, 0.08, 0.12), C.curb, { p: [(px0 + FX - 0.3) / 2, GY + 0.03, s * 0.92] });
    // Fountain on the tower side, joined to the path by a short branch.
    const fx = -10.0;
    const fz = -5.7;
    const branch = tileFloor(fx - 0.6, fx + 0.6, fz + 1.95, -0.86, GY + 0.011, 0.56, (i, j) => ((i + j) % 2 === 0 ? C.path : C.pathAlt));
    bag.matte.addColored(branch);
    branch.dispose();
    fountain(bag, fx, fz);

    // Fence along the road side, with the gate opening at z in [-1.3, 1.3].
    const pk = picket();
    fence(bag, FX, -ZS + 0.2, FX, -1.35, pk);
    fence(bag, FX, 1.35, FX, ZS - 0.2, pk);
    fence(bag, FX, ZS - 0.2, HX + 1.0, ZS - 0.2, pk);
    fence(bag, FX, -ZS + 0.2, HX + 1.0, -ZS + 0.2, pk);
    pk.dispose();

    // Rose arbor over the gate.
    const ar = 1.3;
    const ay = GY + 2.05;
    for (const dx of [0.25, -0.25]) {
      const x = FX + dx;
      for (const s of S) bag.matte.add(rbox(0.16, ay - GY, 0.16, 0.04, 1), C.trim, { p: [x, GY + (ay - GY) / 2, s * ar] });
      const arch = new THREE.TorusGeometry(ar, 0.075, 6, 24, Math.PI).rotateY(Math.PI / 2);
      bag.matte.add(arch, C.trim, { p: [x, ay, 0] });
      arch.dispose();
    }
    for (let i = 0; i <= 6; i += 1) {
      const a2 = (i / 6) * Math.PI;
      bag.matte.add(new THREE.BoxGeometry(0.62, 0.06, 0.06), C.trim, { p: [FX, ay + Math.sin(a2) * ar, Math.cos(a2) * ar] });
    }
    const roseArc: Vec3[] = [];
    for (let i = 0; i <= 10; i += 1) {
      const a2 = (i / 10) * Math.PI;
      roseArc.push([FX + 0.02, ay + Math.sin(a2) * (ar + 0.1), Math.cos(a2) * (ar + 0.1)]);
    }
    garland(bag, [[FX + 0.05, GY + 0.2, ar + 0.06], [FX + 0.06, GY + 1.0, ar + 0.12], [FX + 0.05, ay - 0.1, ar + 0.08], ...roseArc.slice(1, -1), [FX + 0.05, ay - 0.1, -ar - 0.08], [FX + 0.06, GY + 1.0, -ar - 0.12], [FX + 0.05, GY + 0.2, -ar - 0.06]], {
      thick: 0.2,
      seed: 17,
      flowers: ROSES,
      density: 1.1,
      wind: 0.015,
      hi: true,
      out: [1, 0, 0],
    });
    // Gate leaves swung open into the garden.
    for (const s of S) {
      const hingeZ = s * (ar - 0.12);
      const dx = -Math.sin(1.25);
      const dz = -s * Math.cos(1.25);
      const ry = Math.atan2(-dz, dx);
      for (let i = 0; i < 4; i += 1) {
        const off = (i + 0.5) * 0.28;
        bag.matte.add(new THREE.BoxGeometry(0.1, 0.85, 0.04), C.trim, { p: [FX + dx * off, GY + 0.5, hingeZ + dz * off], r: [0, ry, 0] });
      }
      for (const ry2 of [0.3, 0.72]) {
        bag.matte.add(new THREE.BoxGeometry(1.12, 0.07, 0.05), C.trim, { p: [FX + dx * 0.56, GY + ry2, hingeZ + dz * 0.56], r: [0, ry, 0] });
      }
    }
    // Lamp posts flanking the gate on the curb, and the mailbox.
    for (const s of S) lampPost(bag, LX, s * 2.05);
    mailbox(bag, LX, 3.0);

    // Flower strip in front of the fence, beds inside, bed along the house front.
    hedgeRow(bag, 3.6, ZS - 0.5, (FX + LX) / 2 - 0.05, 0.5, 0.5, 51, GY, FLOWERS_A, 0.2, true);
    hedgeRow(bag, -ZS + 0.5, -2.6, (FX + LX) / 2 - 0.05, 0.5, 0.5, 52, GY, FLOWERS_A, 0.2, true);
    hedgeRow(bag, 1.9, ZS - 0.8, FX - 0.75, 0.8, 0.8, 53, GY, ROSES, 0.22, true);
    hedgeRow(bag, -ZS + 0.8, -8.0, FX - 0.75, 0.8, 0.8, 54, GY, ROSES, 0.22, true);
    hedgeRow(bag, 2.7, HW / 2 - 0.3, HX + 0.55, 0.75, 0.7, 55, GY, FLOWERS_B, 0.22, true);
    // Clipped hedges along the garden sides, behind the fence returns.
    boxHedge(bag, HX + 0.7, BACK + 0.6, ZS - 0.45, 1.15, 0.8, false, 1);
    boxHedge(bag, HX + 0.7, BACK + 0.6, -ZS + 0.45, 1.15, 0.8, false, 2);
    // Topiary, trees, bench.
    topiary(bag, FX - 1.3, 2.4, 1.5, 'cone', C.stone, 61, GY);
    topiary(bag, FX - 1.3, -2.4, 1.5, 'cone', C.stone, 62, GY);
    topiary(bag, -12.9, 8.1, 1.2, 'balls', C.stone, 63, GY);
    roundTree(bag, -10.6, 6.4, 3.1, 1.75, 71, true, GY);
    roundTree(bag, -23.6, -7.2, 4.4, 2.3, 72, false, GY);
    roundTree(bag, -23.9, 7.4, 4.0, 2.1, 73, true, GY);
    bush(bag, -21.6, GY + 0.5, -4.2, 0.9, 74, { flowers: FLOWERS_A });
    bush(bag, -12.9, GY + 0.45, -8.6, 0.75, 75, { flowers: FLOWERS_B });
    bag.matte.add(rbox(1.5, 0.12, 0.5, 0.05, 1), C.trim, { p: [-11.9, GY + 0.48, 4.4], r: [0, Math.PI / 2 + 0.2, 0] });
    for (const o of [-0.55, 0.55]) bag.matte.add(rbox(0.42, 0.45, 0.16, 0.04, 1), C.stone, { p: [-11.9 + o * Math.sin(0.2), GY + 0.22, 4.4 + o * Math.cos(0.2)], r: [0, Math.PI / 2 + 0.2, 0] });
  }

  // -------------------------------------------------------------------------
  // Assemble
  // -------------------------------------------------------------------------
  const meshes = bag.build('home', group);
  group.add(cloth.build());

  const doorPosition = new THREE.Vector3(HX + 0.45, PORCH, 0);
  const pathPoints = [
    doorPosition.clone(),
    new THREE.Vector3(HX + 1.6, PORCH, 0),
    new THREE.Vector3(HX + 3.0, GY, 0),
    new THREE.Vector3(-9.2, GY, 0),
    new THREE.Vector3(FX + 0.4, GY, 0),
    new THREE.Vector3(-5.3, 0.16, 0.15),
    new THREE.Vector3(-3.3, 0, 0.3),
    new THREE.Vector3(-1.6, 0, 0),
  ];

  return {
    group,
    doorPosition,
    pathPoints,
    update(_dt: number, time: number) {
      cloth.update(time);
    },
    dispose() {
      for (const m of meshes) m.geometry.dispose();
      cloth.dispose();
    },
  };
}
