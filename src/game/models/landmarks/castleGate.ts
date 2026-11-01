import * as THREE from 'three';
import { PAL } from '../kit/palette';
import { PartBuilder, extrude, heartShape, rbox, sphere, type Vec3 } from '../kit/geo';
import { curved } from '../kit/materials';
import {
  Bag,
  archFrameShape,
  archOutline,
  archWindow,
  bush,
  coneRoof,
  crownShape,
  finial,
  garland,
  heartWindow,
  latheRings,
  merlonLine,
  mix,
  onionDome,
  onionRibs,
  roundTower,
  roundTree,
  roundWindow,
  swag,
  topiary,
  vgrad,
  type Col,
} from './kit';
import { Cloth, Sparkles, type SparkleSpot } from './cloth';
import { BALUSTER, ROSES, balustrade, hedgeRow, lantern, tileFloor } from './garden';
import type { Landmark } from './types';

/**
 * Rose Town castle: the finish gate. Origin = road level at the center of the
 * finish line; the road runs through the gate toward -Z and the car rolls to a
 * stop in the courtyard (~18 m past the line).
 */

const C = {
  wall: '#ffd3de',
  tower: '#ffb8cc',
  wallDeep: '#f6a3bd',
  stone: '#fff0e2',
  stoneDeep: '#f2dccd',
  trim: PAL.trimWhite,
  berry: PAL.roofBerry,
  coral: PAL.roofCoral,
  lilac: PAL.roofLilac,
  gold: PAL.gold,
  goldDeep: PAL.goldDeep,
  door: PAL.doorBerry,
  paveA: '#ffe7d4',
  paveB: '#fbd9c6',
  path: '#ffd0da',
};

// Layout (meters).
const GZ = -5.2; // gatehouse center z
const GD = 3.4; // gatehouse depth
const GF = GZ + GD / 2; // gatehouse front face z
const AW = 5.3; // arch half width (clear width 10.6)
const AS = 3.4; // arch spring height (apex 8.7, 6.5 clear at the road edge)
const TX = 8.5; // gate tower x
const TR = 2.7; // gate tower radius
const GH = 10.6; // gatehouse wall top
const CX = 19; // corner tower x
const WH = 7.0; // curtain wall height
const WT = 2.0; // curtain wall thickness
// The car rolls to a stop 18 m past the line; the finish camera orbits it at up
// to ~11.5 m (portrait), so the courtyard stays clear back to z = -29.6.
const KS = -5; // keep shift relative to the original layout
const KZ0 = -26 + KS; // keep hall front face
const KZ1 = -33 + KS; // keep hall back face
const KX = 7.6; // keep hall half width
const TER = 1.1; // keep terrace height
const BZ = -40; // back wall z
const CAR_STOP = -18; // TUNING.finishRunout
const WIND_YAW = -0.32; // flags stream toward +x, slightly toward the approaching camera

function sectorShape(r0: number, r1: number, a0: number, a1: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(Math.cos(a0) * r1, Math.sin(a0) * r1);
  s.absarc(0, 0, r1, a0, a1, false);
  s.lineTo(Math.cos(a1) * r0, Math.sin(a1) * r0);
  s.absarc(0, 0, r0, a1, a0, true);
  s.closePath();
  return s;
}

// ---------------------------------------------------------------------------

export function createCastleGate(): Landmark {
  const group = new THREE.Group();
  group.name = 'castleGate';
  const bag = new Bag();
  const cloth = new Cloth('castleFlags');
  const sparkleSpots: SparkleSpot[] = [];
  const heartPos = new THREE.Vector3();
  const wallGrad = vgrad(C.wall, 1, WH);
  const S = [-1, 1] as const;

  const flagPole = (x: number, yTop: number, z: number, len: number, hgt: number, shape: 'pennant' | 'swallow', color: Col, color2: Col, heart = false, stripe?: Col) => {
    cloth.add({
      anchor: [x + 0.04, yTop - 0.08, z],
      yaw: WIND_YAW,
      length: len,
      height: hgt,
      shape,
      color,
      color2,
      stripe,
      emblem: heart ? 'heart' : null,
      emblemColor: C.gold,
    });
  };

  // -------------------------------------------------------------------------
  // Gatehouse: a wall block with a grand round arch tunnel.
  // -------------------------------------------------------------------------
  {
    const s = new THREE.Shape();
    s.moveTo(-TX, 0);
    s.lineTo(-AW, 0);
    s.lineTo(-AW, AS);
    s.absarc(0, AS, AW, Math.PI, 0, true);
    s.lineTo(AW, 0);
    s.lineTo(TX, 0);
    s.lineTo(TX, GH);
    s.lineTo(-TX, GH);
    s.lineTo(-TX, 0);
    const g = extrude(s, GD, 0.07, 2, 40);
    bag.stone.add(g, vgrad(C.wall, 1, GH), { p: [0, 0, GZ], shade: { y0: 0, y1: 3.2, k: 0.78 } });
    g.dispose();

    // Stone base course left/right of the opening, front and back.
    for (const sx of S) {
      const w = TX - AW - 0.1;
      bag.matte.add(rbox(w, 1.0, GD + 0.3, 0.07, 1), C.stone, { p: [sx * (AW + 0.1 + w / 2), 0.5, GZ], shade: { y0: 0, y1: 1, k: 0.82 } });
    }

    // Striped voussoirs (front and back faces) + keystone.
    const n = 11;
    for (const face of [1, -1]) {
      const zf = GZ + (face * GD) / 2;
      for (let i = 0; i < n; i += 1) {
        const a0 = (i / n) * Math.PI + 0.012;
        const a1 = ((i + 1) / n) * Math.PI - 0.012;
        const key = i === (n - 1) / 2;
        const g2 = face > 0
          ? extrude(sectorShape(AW + 0.02, AW + (key ? 1.25 : 0.95), a0, a1), 0.34, 0.05, 1, 4)
          : extrude(sectorShape(AW + 0.02, AW + (key ? 1.25 : 0.95), a0, a1), 0.44, 0, 1, 3);
        bag.matte.add(g2, i % 2 === 0 ? C.stone : C.wallDeep, { p: [0, AS, zf] });
        g2.dispose();
      }
      // Jamb quoins down to the ground.
      for (const sx of S) {
        const blocks = 4;
        for (let b = 0; b < blocks; b += 1) {
          const hB = (AS - 0.1) / blocks;
          const wB = b % 2 === 0 ? 0.95 : 0.65;
          bag.matte.add(face > 0 ? rbox(wB, hB - 0.06, 0.34, 0.05, 1) : new THREE.BoxGeometry(wB, hB - 0.06, 0.34), b % 2 === 0 ? C.wallDeep : C.stone, {
            p: [sx * (AW + 0.02 + wB / 2), 0.1 + hB * (b + 0.5), zf],
          });
        }
      }
      // Gold bead along the intrados.
      const bead = new THREE.TorusGeometry(AW + 0.03, 0.075, 5, 40, Math.PI);
      bag.metal.add(bead, C.gold, { p: [0, AS, zf + face * 0.2] });
      bead.dispose();
      for (const sx of S) {
        bag.metal.add(new THREE.CylinderGeometry(0.075, 0.075, AS - 0.2, 6), C.gold, { p: [sx * (AW + 0.03), 0.2 + (AS - 0.2) / 2, zf + face * 0.2] });
        bag.metal.add(sphere(0.13, 10, 8), C.gold, { p: [sx * (AW + 0.03), AS, zf + face * 0.2] });
      }
    }

    // Cornice + dentils, front and back.
    for (const face of [1, -1]) {
      const zf = GZ + (face * GD) / 2;
      bag.matte.add(rbox(TX * 2 - 1.0, 0.36, 0.5, 0.08, 1), C.trim, { p: [0, GH - 0.2, zf + face * 0.1] });
      if (face > 0) {
        const dent = new THREE.BoxGeometry(0.2, 0.2, 0.16);
        for (let x = -TX + 1.2; x <= TX - 1.2; x += 0.55) {
          bag.matte.add(dent, C.trim, { p: [x, GH - 0.5, zf + face * 0.06] });
        }
        dent.dispose();
      }
      merlonLine(bag.matte, -TX + 1.9, zf - face * 0.35, -2.9, zf - face * 0.35, GH, 1.45, 0.95, 0.95, 0.55, C.wall, undefined, face < 0);
      merlonLine(bag.matte, 2.9, zf - face * 0.35, TX - 1.9, zf - face * 0.35, GH, 1.45, 0.95, 0.95, 0.55, C.wall, undefined, face < 0);
    }

    // Round-topped pediment framing the emblem.
    const ped = extrude(archOutline(5.4, 3.5), 0.8, 0.08, 1, 18);
    bag.matte.add(ped, C.wall, { p: [0, GH - 0.35, GF - 0.45] });
    ped.dispose();
    const pedFrame = extrude(archFrameShape(5.4, 3.5, 0.32, 0.01), 0.9, 0.06, 1, 18);
    bag.matte.add(pedFrame, C.trim, { p: [0, GH - 0.35, GF - 0.42] });
    pedFrame.dispose();
    for (const [px, py] of [[-2.85, GH + 1.35], [2.85, GH + 1.35], [0, GH + 3.52]] as Array<[number, number]>) {
      bag.metal.add(sphere(0.2, 12, 8), C.gold, { p: [px, py, GF - 0.45] });
    }
    for (const sx of S) {
      bag.matte.add(rbox(0.6, 0.5, 0.9, 0.08, 1), C.trim, { p: [sx * 2.85, GH + 0.85, GF - 0.45] });
    }

    // Emblem: glossy heart with a gold rim, crowned.
    const heartY = GH + 0.25;
    // The glossy heart itself is its own mesh so it can beat (see heartbeat below).
    heartPos.set(0, heartY, GF + 0.35);
    const rim = extrude(heartShape(2.95), 0.3, 0.07, 1, 20);
    bag.metal.add(rim, C.gold, { p: [0, heartY + 0.04, GF + 0.12] });
    rim.dispose();
    const crown = extrude(crownShape(1.9, 1.25), 0.3, 0.07, 1, 6);
    bag.metal.add(crown, C.gold, { p: [0, heartY + 1.15, GF + 0.3] });
    crown.dispose();
    const tips: Array<[number, number]> = [[-0.95, 0.82], [-0.475, 0.9], [0, 1.0], [0.475, 0.9], [0.95, 0.82]];
    for (const [tx, ty] of tips) bag.metal.add(sphere(0.1, 10, 8), C.gold, { p: [tx, heartY + 1.15 + ty * 1.25 + 0.06, GF + 0.3] });
    const gems: Array<[number, Col]> = [[-0.55, PAL.gemBlue], [0, PAL.heartGem], [0.55, PAL.gemMint]];
    for (const [gx, gc] of gems) bag.gloss.add(sphere(gx === 0 ? 0.16 : 0.12, 12, 8), gc, { p: [gx, heartY + 1.36, GF + 0.5], s: [1, 1, 0.6] });
    sparkleSpots.push(
      { p: [-1.9, heartY + 1.2, GF + 0.8], s: 1.0 },
      { p: [1.8, heartY - 0.3, GF + 0.8], s: 0.85 },
      { p: [0.3, heartY + 2.9, GF + 0.6], s: 0.9 },
      { p: [-1.2, heartY - 1.0, GF + 0.9], s: 0.7 },
      { p: [2.6, heartY + 1.9, GF + 0.7], s: 0.75 },
      { p: [-3.4, AS + 3.2, GF + 1.2], s: 0.8 },
      { p: [3.7, AS + 2.4, GF + 1.2], s: 0.8 },
      { p: [0.0, AS + 6.9, GF + 1.4], s: 0.7 },
    );

    // Garland draped over the arch, hooked at five points, with fairy lights.
    const hooks: Vec3[] = [];
    const hr = AW + 1.25;
    for (let i = 0; i <= 4; i += 1) {
      const a = Math.PI * (0.94 - (i / 4) * 0.88);
      hooks.push([Math.cos(a) * hr, AS + Math.sin(a) * hr - 0.1, GF + 0.34]);
    }
    for (let i = 0; i < hooks.length - 1; i += 1) {
      if (i === 1 || i === 2) {
        // Middle swags skip under the emblem.
        const a = hooks[i];
        const b = hooks[i + 1];
        garland(bag, swag(a, b, 0.55), { thick: 0.19, seed: 11 + i, lights: true, hi: true, flowers: ROSES });
      } else {
        garland(bag, swag(hooks[i], hooks[i + 1], 0.55), { thick: 0.19, seed: 11 + i, lights: true, hi: true, flowers: ROSES });
      }
    }
    for (const hk of hooks) {
      bag.foliage.add(sphere(1, 8, 6), PAL.flowerRose, { p: [hk[0], hk[1], hk[2] + 0.12], s: 0.2 });
      bag.metal.add(sphere(0.08, 8, 6), C.gold, { p: [hk[0], hk[1] + 0.2, hk[2] + 0.1] });
    }

    // Courtyard face (backdrop of the finish celebration): emblem, garland, sparkles.
    const GB = GZ - GD / 2;
    const bh = extrude(heartShape(1.9), 0.34, 0.13, 2, 16);
    bag.gloss.add(bh, PAL.heartGem, { p: [0, AS + AW + 1.55, GB - 0.3], r: [0, Math.PI, 0] });
    bh.dispose();
    const bhr = extrude(heartShape(2.3), 0.26, 0.06, 1, 16);
    bag.metal.add(bhr, C.gold, { p: [0, AS + AW + 1.58, GB - 0.12], r: [0, Math.PI, 0] });
    bhr.dispose();
    const backHooks: Vec3[] = [0.9, 0.5, 0.1].map((f) => {
      const a = Math.PI * f;
      return [Math.cos(a) * (AW + 1.2), AS + Math.sin(a) * (AW + 1.2) - 0.1, GB - 0.3] as Vec3;
    });
    for (let i = 0; i < backHooks.length - 1; i += 1) {
      garland(bag, swag(backHooks[i], backHooks[i + 1], 0.6), { thick: 0.16, seed: 61 + i, lights: true, flowers: ROSES, density: 0.8, out: [0, 0, -1] });
    }
    sparkleSpots.push({ p: [-1.6, AS + AW + 2.4, GB - 0.8], s: 0.55 }, { p: [1.7, AS + AW + 0.9, GB - 0.8], s: 0.5 });
  }

  // -------------------------------------------------------------------------
  // Towers
  // -------------------------------------------------------------------------

  // Gate towers.
  for (const sx of S) {
    const x = sx * TX;
    const top = roundTower(bag, x, GZ, {
      r: TR,
      h: 9.9,
      capH: 1.25,
      flare: 0.46,
      corbelH: 0.75,
      bands: [4.7],
      brackets: 18,
      wall: C.tower,
      trim: C.trim,
      stone: C.stone,
      segments: 32,
    });
    bag.satin.addColored(coneRoof({ R: top.r + 0.42, H: 5.7, color: C.berry, segments: 32, kick: 0.16 }), { p: [x, top.y - 0.04, GZ] });
    bag.metal.add(new THREE.TorusGeometry(top.r + 0.06, 0.08, 4, 32), C.gold, { p: [x, top.y + 0.02, GZ], r: [Math.PI / 2, 0, 0] });
    const poleTop = finial(bag.metal, bag.gloss, x, top.y + 5.62, GZ, 1.25, 'pole');
    flagPole(x, poleTop, GZ, 2.5, 1.25, 'swallow', C.berry, C.berry, true);
    sparkleSpots.push({ p: [x - sx * 1.2, top.y + 3.6, GZ + 2.2], s: 0.9 }, { p: [x + sx * 2.8, top.y + 1.2, GZ + 1.5], s: 0.75 });

    // Windows: lower window facing front, upper pair beside the banner, attic oculi.
    const inward = -sx; // toward the road
    archWindow(bag, x, 1.9, GZ + TR, 0, 0.8, 1.55, { frame: C.trim, keystone: C.wallDeep, sill: C.trim });
    for (const a of [0.78, -0.78]) {
      archWindow(bag, x + Math.sin(a) * TR, 6.4, GZ + Math.cos(a) * TR, a, 0.72, 1.4, { frame: C.trim, keystone: C.wallDeep, sill: C.trim });
    }
    archWindow(bag, x + Math.sin(sx * 1.6) * TR, 3.4, GZ + Math.cos(sx * 1.6) * TR, sx * 1.6, 0.72, 1.4, { frame: C.trim, keystone: C.wallDeep, sill: C.trim });
    for (let i = -1; i <= 1; i += 1) {
      const a = i * 0.8 - sx * 0.25;
      const rr = top.r - 0.09;
      roundWindow(bag, x + Math.sin(a) * rr, (top.capY0 + top.capY1) / 2, GZ + Math.cos(a) * rr, a, 0.25);
    }
    // Hanging banner on the tower front (rod + cloth).
    const by = top.capY0 - 0.95;
    bag.metal.add(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 8), C.gold, { p: [x, by, GZ + TR + 0.2], r: [0, 0, Math.PI / 2] });
    for (const e of [-0.95, 0.95]) bag.metal.add(sphere(0.09, 8, 6), C.gold, { p: [x + e, by, GZ + TR + 0.2] });
    cloth.add({ anchor: [x, by - 0.03, GZ + TR + 0.2], yaw: 0, length: 3.3, height: 1.45, shape: 'banner', color: C.berry, color2: C.coral, emblem: 'heart', emblemColor: C.gold, phase: sx });

    // Wall lanterns facing the road (outside and courtyard side).
    lantern(bag, x + Math.sin(inward * 1.05) * TR, 4.1, GZ + Math.cos(inward * 1.05) * TR, inward * 1.05);
    const back = Math.PI - inward * 1.05;
    lantern(bag, x + Math.sin(back) * TR, 4.1, GZ + Math.cos(back) * TR, back);
    archWindow(bag, x + Math.sin(Math.PI - inward * 0.35) * TR, 6.2, GZ + Math.cos(Math.PI - inward * 0.35) * TR, Math.PI - inward * 0.35, 0.72, 1.4, { frame: C.trim, keystone: C.wallDeep, sill: C.trim });

    // Climbing rose vine up the road-facing front of the tower.
    const vine: Vec3[] = [];
    for (let i = 0; i <= 8; i += 1) {
      const t = i / 8;
      const a = inward * (0.62 + Math.sin(t * 5.5) * 0.14);
      const rr = TR + 0.12;
      vine.push([x + Math.sin(a) * rr, 0.4 + t * 4.6, GZ + Math.cos(a) * rr]);
    }
    garland(bag, vine, { thick: 0.2, seed: sx > 0 ? 3 : 4, density: 0.85, flowers: ROSES, wind: 0.015, hi: true, out: [Math.sin(inward * 0.62), 0, Math.cos(inward * 0.62)] });
    bush(bag, x + Math.sin(inward * 0.62) * (TR + 0.5), 0.35, GZ + Math.cos(inward * 0.62) * (TR + 0.5), 0.75, sx > 0 ? 21 : 22, { flowers: [PAL.flowerRose, PAL.flowerWhite, PAL.blossom] });
  }

  // Front + back corner towers.
  for (const sx of S) {
    for (const zc of [GZ, BZ]) {
      const x = sx * CX;
      const front = zc === GZ;
      const top = roundTower(bag, x, zc, {
        r: 2.1,
        h: 8.3,
        capH: 0.95,
        flare: 0.36,
        corbelH: 0.62,
        bands: [3.7],
        brackets: front ? 12 : 0,
        wall: C.tower,
        trim: C.trim,
        stone: C.stone,
        segments: front ? 24 : 16,
      });
      bag.satin.addColored(coneRoof({ R: top.r + 0.36, H: 4.6, color: C.coral, segments: front ? 24 : 16 }), { p: [x, top.y - 0.04, zc] });
      bag.metal.add(new THREE.TorusGeometry(top.r + 0.05, 0.07, 4, front ? 24 : 16), C.gold, { p: [x, top.y + 0.02, zc], r: [Math.PI / 2, 0, 0] });
      if (front) {
        const poleTop = finial(bag.metal, bag.gloss, x, top.y + 4.52, zc, 1.0, 'pole');
        flagPole(x, poleTop, zc, 2.3, 0.95, 'pennant', C.berry, C.trim, false, C.gold);
      } else {
        finial(bag.metal, null, x, top.y + 4.52, zc, 1.0, 'ball');
      }
      const side = sx * Math.PI / 2;
      if (front) {
        archWindow(bag, x, 2.5, zc + 2.1, 0, 0.7, 1.35, { frame: C.trim, keystone: C.wallDeep, sill: C.trim });
        archWindow(bag, x + Math.sin(side) * 2.05, 5.4, zc, side, 0.66, 1.3, { frame: C.trim, keystone: C.wallDeep, sill: C.trim });
        for (let i = -1; i <= 1; i += 1) {
          const a = i * 0.75 + sx * 0.3;
          const rr = top.r - 0.09;
          roundWindow(bag, x + Math.sin(a) * rr, (top.capY0 + top.capY1) / 2, zc + Math.cos(a) * rr, a, 0.2);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Curtain walls
  // -------------------------------------------------------------------------
  const wallSeg = (
    x0: number, z0: number, x1: number, z1: number,
    out: [number, number],
    o: { windows?: boolean; innerWindows?: boolean; innerT?: number[]; cheapOut?: boolean; cheapIn?: boolean } = {},
  ) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const ry = Math.atan2(x1 - x0, z1 - z0) + Math.PI / 2; // box local x runs along the wall
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    // Long runs are split into short pieces: the curved-world bend is applied per
    // vertex, so a single long box would follow the chord instead of the curve.
    const pieces = Math.abs(z1 - z0) > 7 ? Math.ceil(Math.abs(z1 - z0) / 6.5) : 1;
    // Walls nobody sees up close (sides, back) use plain boxes.
    const plain = !!(o.cheapOut && o.cheapIn);
    const box = (w: number, h: number, d: number, r: number) => (plain ? new THREE.BoxGeometry(w, h, d) : rbox(w, h, d, r, 1));
    for (let k = 0; k < pieces; k += 1) {
      const t = (k + 0.5) / pieces;
      const pl = len / pieces + (pieces > 1 ? 0.02 : 0);
      const px = x0 + (x1 - x0) * t;
      const pz = z0 + (z1 - z0) * t;
      bag.stone.add(box(pl, WH, WT, 0.1), wallGrad, { p: [px, WH / 2, pz], r: [0, ry, 0], shade: { y0: 0, y1: 3, k: 0.8 } });
      bag.matte.add(box(pl, 1.0, WT + 0.26, 0.07), C.stone, { p: [px, 0.5, pz], r: [0, ry, 0], shade: { y0: 0, y1: 1, k: 0.84 } });
      bag.matte.add(box(pl, 0.32, WT + 0.34, 0.07), C.trim, { p: [px, WH - 0.14, pz], r: [0, ry, 0] });
    }
    const [nx, nz] = out;
    for (const f of [1, -1]) {
      const off = (WT / 2 - 0.28) * f;
      const cheap = f > 0 ? o.cheapOut : o.cheapIn;
      merlonLine(bag.matte, x0 + nx * off, z0 + nz * off, x1 + nx * off, z1 + nz * off, WH, 1.5, 0.9, 0.9, 0.5, C.wall, (px, pz) => {
        const d0 = Math.hypot(px - x0, pz - z0);
        const d1 = Math.hypot(px - x1, pz - z1);
        return d0 < 0.3 || d1 < 0.3;
      }, cheap);
    }
    if (o.windows) {
      heartWindow(bag, cx + nx * (WT / 2 + 0.02), 4.1, cz + nz * (WT / 2 + 0.02), Math.atan2(nx, nz), 0.95, C.trim);
    }
    if (o.innerWindows) {
      for (const t of o.innerT ?? [-0.25, 0.25]) {
        const wx = cx + (x1 - x0) * t - nx * (WT / 2);
        const wz = cz + (z1 - z0) * t - nz * (WT / 2);
        archWindow(bag, wx, 2.2, wz, Math.atan2(-nx, -nz), 0.8, 1.5, { frame: C.trim, keystone: C.wallDeep, sill: C.trim });
      }
    }
  };

  for (const sx of S) {
    // Front walls between gate towers and corner towers.
    wallSeg(sx * (TX + 1.6), GZ, sx * (CX - 1.3), GZ, [0, 1], { windows: true, innerWindows: true, cheapIn: true });
    // Side walls.
    wallSeg(sx * CX, GZ - 1.4, sx * CX, BZ + 1.4, [sx, 0], { cheapOut: true, cheapIn: true, innerWindows: true, innerT: [-0.36, -0.06] });
    // Banners and swags on the outer face of the front walls.
    const wf = GZ + WT / 2 + 0.16;
    for (const bx of [TX + 3.7, CX - 3.4]) {
      const x = sx * bx;
      bag.metal.add(new THREE.CylinderGeometry(0.045, 0.045, 1.6, 8), C.gold, { p: [x, WH - 0.62, wf], r: [0, 0, Math.PI / 2] });
      for (const e of [-0.85, 0.85]) bag.metal.add(sphere(0.08, 8, 6), C.gold, { p: [x + e, WH - 0.62, wf] });
      cloth.add({ anchor: [x, WH - 0.66, wf], yaw: 0, length: 3.0, height: 1.3, shape: 'banner', color: C.coral, color2: C.trim, emblem: 'heart', emblemColor: C.gold, phase: bx + sx });
    }
    const x0 = sx * (TX + 2.3);
    const x1 = sx * (CX - 1.9);
    const n = 2;
    for (let i = 0; i < n; i += 1) {
      const a: Vec3 = [x0 + ((x1 - x0) * i) / n, WH - 0.55, wf + 0.12];
      const b: Vec3 = [x0 + ((x1 - x0) * (i + 1)) / n, WH - 0.55, wf + 0.12];
      garland(bag, swag(a, b, 0.5), { thick: 0.15, seed: 40 + i + (sx > 0 ? 10 : 0), density: 0.8, flowers: ROSES });
    }
    // Rose shrubs along the outside of the front wall.
    hedgeRow(bag, sx * (TX + 2.9), sx * (CX - 2.2), GZ + WT / 2 + 0.8, 1.25, 1.2, sx > 0 ? 5 : 6, 0, ROSES);
    // Topiary cones flanking the finish.
    topiary(bag, sx * 6.35, -1.6, 1.8, 'cone', C.stone, sx > 0 ? 3 : 4);
  }
  // Back wall.
  wallSeg(-CX + 1.4, BZ, CX - 1.4, BZ, [0, -1], { cheapOut: true, cheapIn: true });

  // -------------------------------------------------------------------------
  // Courtyard floor, mosaic and path
  // -------------------------------------------------------------------------
  {
    // The town keeps its road (y 0), curbs/sidewalks (0.16) and lawns (0.18) under
    // landmarks, and the car always drives at road level. So: a tiled carriageway
    // at road level over the road, raised side paving above the town lawn, and
    // cream curbs between them.
    const zFront = GF + 0.25;
    const zBack = -24.6 + KS;
    const RH = 4.3; // road half width
    const SIDE_Y = 0.225;
    const len = zFront - zBack;
    const zc = (zFront + zBack) / 2;
    const road = tileFloor(-RH, RH, zBack, zFront, 0.05, 0.72, (i, j) => ((i + j) % 2 === 0 ? C.path : mix(C.path, '#ffffff', 0.4)));
    bag.matte.addColored(road);
    road.dispose();
    const nz = Math.ceil(len / 3);
    bag.matte.add(new THREE.BoxGeometry(RH * 2, 0.06, len, 1, 1, nz), C.stoneDeep, { p: [0, 0.0, zc] });
    for (const sx of S) {
      const x0 = sx * (RH + 0.2);
      const x1 = sx * (CX - 1.0);
      const side = tileFloor(Math.min(x0, x1), Math.max(x0, x1), zBack, zFront, SIDE_Y, 1.45, (i, j) => ((i + j) % 2 === 0 ? C.paveA : C.paveB));
      bag.matte.addColored(side);
      side.dispose();
      const w = Math.abs(x1 - x0);
      bag.matte.add(new THREE.BoxGeometry(w, 0.2, len, 1, 1, nz), C.stoneDeep, { p: [(x0 + x1) / 2, SIDE_Y - 0.115, zc] });
      const cp = Math.ceil(len / 5);
      for (let k = 0; k < cp; k += 1) {
        bag.matte.add(new THREE.BoxGeometry(0.3, SIDE_Y + 0.06, len / cp + 0.02), C.trim, { p: [sx * (RH + 0.08), (SIDE_Y + 0.06) / 2, zBack + (len * (k + 0.5)) / cp] });
      }
    }
    // Rosette mosaic where the car comes to rest.
    const mz = CAR_STOP;
    const wedges = 16;
    for (let i = 0; i < wedges; i += 1) {
      const g = new THREE.CircleGeometry(3.6, 3, (i / wedges) * Math.PI * 2, (Math.PI * 2) / wedges).rotateX(-Math.PI / 2);
      bag.matte.add(g, i % 2 === 0 ? '#ffb3c9' : '#fff3e8', { p: [0, 0.062, mz] });  // 1.2 cm over the tiles
      g.dispose();
    }
    const ring = new THREE.RingGeometry(3.6, 3.98, 48).rotateX(-Math.PI / 2);
    // Painted, not metal: flat gold on the ground would only mirror the green of the sky light.
    bag.satin.add(ring, C.gold, { p: [0, 0.075, mz] });
    ring.dispose();
    const ring2 = new THREE.RingGeometry(1.35, 1.6, 32).rotateX(-Math.PI / 2);
    bag.satin.add(ring2, C.gold, { p: [0, 0.078, mz] });
    ring2.dispose();
    const disc = new THREE.CircleGeometry(1.35, 32).rotateX(-Math.PI / 2);
    bag.matte.add(disc, '#fff6ee', { p: [0, 0.075, mz] });
    disc.dispose();
    const mh = new THREE.ShapeGeometry(heartShape(1.7), 10).rotateX(-Math.PI / 2);
    bag.gloss.add(mh, PAL.heartGem, { p: [0, 0.088, mz - 0.05] });
    mh.dispose();
  }

  // -------------------------------------------------------------------------
  // Keep: terrace, hall, towers
  // -------------------------------------------------------------------------
  {
    const tz0 = -24.6 + KS;
    const tz1 = BZ + 1.2;
    const tzc = (tz0 + tz1) / 2;
    bag.matte.add(rbox(25, TER, tz0 - tz1, 0.1, 1), C.stone, { p: [0, TER / 2, tzc], shade: { y0: 0, y1: TER, k: 0.8 } });
    bag.matte.add(rbox(25.3, 0.16, tz0 - tz1 + 0.3, 0.06, 1), C.trim, { p: [0, TER, tzc] });
    // Stairs up to the keep door.
    const steps = 4;
    for (let i = 0; i < steps; i += 1) {
      const top = ((i + 1) / steps) * TER;
      const zf = -22.4 + KS - i * 0.55;
      const depth = zf - tz0;
      bag.matte.add(rbox(7.4, top, depth, 0.05, 1), i % 2 === 0 ? C.stone : '#fbe6da', { p: [0, top / 2, zf - depth / 2] });
    }
    for (const sx of S) {
      bag.matte.add(rbox(0.7, TER + 0.5, 3.0, 0.08, 1), C.stone, { p: [sx * 4.05, (TER + 0.5) / 2, -23.9 + KS] });
      bag.matte.addColored(
        latheRings(
          [
            [0.25, 0, C.wallDeep],
            [0.3, 0.1],
            [0.18, 0.25],
            [0.34, 0.55],
            [0.4, 0.66],
            [0.36, 0.7, PAL.soil],
            [0.0, 0.71],
          ],
          { segments: 16 },
        ),
        { p: [sx * 4.05, TER + 0.5, -22.8 + KS] },
      );
      bush(bag, sx * 4.05, TER + 1.55, -22.8 + KS, 0.52, sx > 0 ? 71 : 72, { squash: 0.95 });
      balustrade(bag, sx * 4.4, tz0 + 0.1, sx * 12.2, tz0 + 0.1, TER + 0.08);
    }

    // Hall block.
    const hallH = 9.1;
    const hy = TER + hallH / 2;
    bag.matte.add(rbox(KX * 2, hallH, KZ0 - KZ1, 0.12, 1), vgrad(C.wall, TER + 1, TER + hallH), { p: [0, hy, (KZ0 + KZ1) / 2], shade: { y0: TER, y1: TER + 3, k: 0.84 } });
    bag.matte.add(rbox(KX * 2 + 0.3, 0.9, KZ0 - KZ1 + 0.3, 0.08, 1), C.stone, { p: [0, TER + 0.45, (KZ0 + KZ1) / 2] });
    bag.matte.add(rbox(KX * 2 + 0.4, 0.36, KZ0 - KZ1 + 0.4, 0.08, 1), C.trim, { p: [0, TER + hallH - 0.1, (KZ0 + KZ1) / 2] });
    const hallTop = TER + hallH + 0.08;
    merlonLine(bag.matte, -KX + 0.4, KZ0 - 0.3, -3.9, KZ0 - 0.3, hallTop, 1.35, 0.85, 0.85, 0.5, C.wall);
    merlonLine(bag.matte, 3.9, KZ0 - 0.3, KX - 0.4, KZ0 - 0.3, hallTop, 1.35, 0.85, 0.85, 0.5, C.wall);
    // Pilasters.
    for (const px of [-6.2, -2.7, 2.7, 6.2]) {
      bag.matte.add(new THREE.BoxGeometry(0.46, hallH - 1.2, 0.2), C.trim, { p: [px, TER + 0.9 + (hallH - 1.2) / 2, KZ0 + 0.08] });
    }

    // Grand door.
    const dw = 2.9;
    const dh = 4.5;
    const frame = extrude(archFrameShape(dw, dh, 0.4, 0.01), 0.42, 0.06, 1, 16);
    bag.matte.add(frame, C.stone, { p: [0, TER + 0.05, KZ0 + 0.12] });
    frame.dispose();
    const leaf = extrude(archOutline(dw + 0.04, dh + 0.02), 0.16, 0.03, 1, 16);
    bag.gloss.add(leaf, C.door, { p: [0, TER + 0.05, KZ0 + 0.04] });
    leaf.dispose();
    bag.matte.add(rbox(0.06, dh - 0.2, 0.06, 0.02, 1), '#b8406a', { p: [0, TER + (dh - 0.2) / 2 + 0.05, KZ0 + 0.16] });
    for (const sx of S) {
      for (const hy2 of [1.0, 3.0]) bag.metal.add(rbox(0.9, 0.14, 0.06, 0.03, 1), C.gold, { p: [sx * (dw / 2 - 0.5), TER + hy2, KZ0 + 0.17] });
      const knob = extrude(heartShape(0.3), 0.06, 0.02, 1, 8);
      bag.metal.add(knob, C.gold, { p: [sx * 0.3, TER + 2.1, KZ0 + 0.19] });
      knob.dispose();
      lantern(bag, sx * 2.25, TER + 3.3, KZ0 + 0.02, 0);
    }
    const keyH = extrude(heartShape(0.55), 0.2, 0.05, 1, 10);
    bag.gloss.add(keyH, PAL.heartGem, { p: [0, TER + dh + 0.35, KZ0 + 0.35] });
    keyH.dispose();

    // Rose window: stained-glass wedges, gold tracery, stone ring.
    const rwY = TER + 7.05;
    const rwR = 1.15;
    for (let i = 0; i < 8; i += 1) {
      const g = new THREE.CircleGeometry(rwR, 4, (i / 8) * Math.PI * 2, Math.PI / 4);
      bag.gloss.add(g, [PAL.blossom, PAL.flowerLilac, PAL.gemBlue, PAL.gemMint][i % 4], { p: [0, rwY, KZ0 + 0.1] });
      g.dispose();
      const a = (i / 8) * Math.PI * 2;
      bag.metal.add(new THREE.BoxGeometry(0.07, rwR, 0.06), C.gold, { p: [Math.cos(a) * rwR * 0.5, rwY + Math.sin(a) * rwR * 0.5, KZ0 + 0.14], r: [0, 0, a - Math.PI / 2] });
    }
    bag.metal.add(new THREE.TorusGeometry(0.32, 0.06, 6, 20), C.gold, { p: [0, rwY, KZ0 + 0.15] });
    const rc = extrude(heartShape(0.42), 0.06, 0.02, 1, 8);
    bag.gloss.add(rc, PAL.heartGem, { p: [0, rwY - 0.02, KZ0 + 0.17] });
    rc.dispose();
    bag.matte.add(new THREE.TorusGeometry(rwR + 0.12, 0.2, 8, 40), C.stone, { p: [0, rwY, KZ0 + 0.1] });

    // Facade windows.
    for (const sx of S) {
      archWindow(bag, sx * 4.45, TER + 1.3, KZ0, 0, 1.2, 2.4, { frame: C.trim, mullion: true, sill: C.trim, keystone: C.wallDeep });
      archWindow(bag, sx * 4.45, TER + 5.5, KZ0, 0, 1.05, 2.05, { frame: C.trim, mullion: true, flowers: true, keystone: C.wallDeep });
    }

    // Front keep towers.
    for (const sx of S) {
      const x = sx * 7.8;
      const z = -26.3 + KS;
      const top = roundTower(bag, x, z, {
        base: TER,
        r: 2.25,
        h: 12.4,
        capH: 1.05,
        flare: 0.38,
        corbelH: 0.66,
        bands: [4.4, 8.8],
        brackets: 12,
        wall: C.tower,
        trim: C.trim,
        stone: C.stone,
        segments: 26,
      });
      bag.satin.addColored(coneRoof({ R: top.r + 0.38, H: 5.4, color: C.berry, segments: 26 }), { p: [x, top.y - 0.04, z] });
      bag.metal.add(new THREE.TorusGeometry(top.r + 0.05, 0.075, 4, 26), C.gold, { p: [x, top.y + 0.02, z], r: [Math.PI / 2, 0, 0] });
      const poleTop = finial(bag.metal, bag.gloss, x, top.y + 5.32, z, 1.05, 'pole');
      flagPole(x, poleTop, z, 2.3, 0.95, 'pennant', C.coral, C.trim, false, C.gold);
      archWindow(bag, x, TER + 1.6, z + 2.25, 0, 0.78, 1.5, { frame: C.trim, keystone: C.wallDeep, sill: C.trim });
      archWindow(bag, x + Math.sin(sx * 0.9) * 2.2, TER + 6.0, z + Math.cos(sx * 0.9) * 2.2, sx * 0.9, 0.72, 1.4, { frame: C.trim, keystone: C.wallDeep, sill: C.trim });
      archWindow(bag, x, TER + 9.8, z + 2.2, 0, 0.72, 1.4, { frame: C.trim, keystone: C.wallDeep, sill: C.trim });
      for (let i = -1; i <= 1; i += 1) {
        const a = i * 0.72 + sx * 0.3;
        const rr = top.r - 0.09;
        roundWindow(bag, x + Math.sin(a) * rr, (top.capY0 + top.capY1) / 2, z + Math.cos(a) * rr, a, 0.21);
      }
    }

    // Back keep towers with lilac onion domes.
    for (const sx of S) {
      const x = sx * 7.6;
      const z = -32.7 + KS;
      const top = roundTower(bag, x, z, {
        base: TER,
        r: 2.45,
        h: 14.6,
        capH: 1.1,
        flare: 0.36,
        corbelH: 0.66,
        bands: [5.2, 10.4],
        brackets: 10,
        wall: C.tower,
        trim: C.trim,
        stone: C.stone,
        segments: 24,
      });
      const dR = top.r - 0.25;
      const dH = 5.0;
      bag.satin.addColored(onionDome(dR, dH, C.lilac, 28), { p: [x, top.y - 0.05, z] });
      onionRibs(bag.metal, x, top.y - 0.05, z, dR, dH, 4, C.gold);
      bag.metal.add(new THREE.TorusGeometry(dR * 0.9, 0.09, 4, 26), C.gold, { p: [x, top.y, z], r: [Math.PI / 2, 0, 0] });
      const ft = finial(bag.metal, bag.gloss, x, top.y + dH - 0.12, z, 1.0, 'pole');
      flagPole(x, ft, z, 2.2, 1.05, 'swallow', C.lilac, C.lilac, true);
      archWindow(bag, x + Math.sin(sx * 0.5) * 2.45, TER + 11.4, z + Math.cos(sx * 0.5) * 2.45, sx * 0.5, 0.75, 1.45, { frame: C.trim, keystone: C.wallDeep, sill: C.trim });
      archWindow(bag, x + Math.sin(sx * 1.3) * 2.45, TER + 7.0, z + Math.cos(sx * 1.3) * 2.45, sx * 1.3, 0.75, 1.45, { frame: C.trim, keystone: C.wallDeep, sill: C.trim });

    }

    // Great central tower with a balcony and the tallest spire.
    {
      const x = 0;
      const z = -29.4 + KS;
      const r = 3.4;
      const top = roundTower(bag, x, z, {
        base: TER,
        r,
        h: 16.4,
        capH: 1.45,
        flare: 0.5,
        corbelH: 0.8,
        taper: 0.97,
        bands: [12.1],
        brackets: 22,
        wall: C.tower,
        trim: C.trim,
        stone: C.stone,
        segments: 36,
        noPlinth: true,
      });
      const spireH = 9.6;
      bag.satin.addColored(coneRoof({ R: top.r + 0.5, H: spireH, color: C.berry, p: 1.5, kick: 0.2, rows: 11, segments: 36 }), { p: [x, top.y - 0.04, z] });
      bag.metal.add(new THREE.TorusGeometry(top.r + 0.06, 0.1, 4, 36), C.gold, { p: [x, top.y + 0.02, z], r: [Math.PI / 2, 0, 0] });
      // Gold bands on the spire.
      for (const t of [0.34, 0.62]) {
        const rr = (top.r + 0.5) * (Math.pow(1 - t, 1.5) * 0.8 + 0.2 * Math.pow(1 - t, 9)) + 0.05;
        bag.metal.add(new THREE.TorusGeometry(rr, 0.07, 4, 28), C.gold, { p: [x, top.y + 0.14 + t * (spireH - 0.14), z], r: [Math.PI / 2, 0, 0] });
      }
      const pt = finial(bag.metal, bag.gloss, x, top.y + spireH - 0.1, z, 1.5, 'pole');
      cloth.add({ anchor: [x + 0.06, pt - 0.1, z], yaw: WIND_YAW, length: 3.6, height: 1.8, shape: 'swallow', color: C.berry, color2: C.berry, emblem: 'heart', emblemColor: C.gold, phase: 0.4 });
      sparkleSpots.push(
        { p: [x - 2.2, top.y + spireH + 1.6, z + 1.0], s: 1.3 },
        { p: [x + 2.6, top.y + spireH * 0.7, z + 1.8], s: 1.0 },
        { p: [x - 3.4, top.y + spireH * 0.35, z + 2.4], s: 0.9 },
        { p: [x + 1.2, top.y + spireH + 3.2, z + 0.5], s: 1.1 },
        { p: [x + 4.6, top.y - 1.5, z + 3.0], s: 0.8 },
        { p: [x - 5.0, top.y + 2.0, z + 3.0], s: 0.9 },
      );
      // Balcony.
      const byy = TER + 13.2;
      bag.matte.addColored(
        latheRings(
          [
            [r - 0.1, -0.9, C.trim],
            [r + 0.25, -0.6],
            [r + 0.85, -0.12],
            [r + 0.95, -0.02],
            [r + 0.95, 0.12],
            [r - 0.2, 0.14],
          ],
          { segments: 28, phiStart: Math.PI * 0.5, phiLength: Math.PI },
        ),
        { p: [x, byy, z] },
      );
      const posts = 12;
      for (let i = 0; i <= posts; i += 1) {
        const a = -Math.PI / 2 + (i / posts) * Math.PI;
        bag.matte.addColored(BALUSTER, { p: [x + Math.sin(a) * (r + 0.78), byy + 0.12, z + Math.cos(a) * (r + 0.78)], s: [0.8, 1.05, 0.8] });
      }
      const rail = new THREE.TorusGeometry(r + 0.78, 0.07, 5, 28, Math.PI);
      bag.matte.add(rail, C.trim, { p: [x, byy + 0.8, z], r: [Math.PI / 2, 0, Math.PI] });
      rail.dispose();
      // Windows: tall front window above the hall roof, balcony door, oculi.
      archWindow(bag, x, TER + 9.55, z + r, 0, 1.15, 2.2, { frame: C.trim, mullion: true, keystone: C.wallDeep });
      for (const a of [-0.85, 0.85]) archWindow(bag, x + Math.sin(a) * r, TER + 9.7, z + Math.cos(a) * r, a, 0.9, 1.7, { frame: C.trim, keystone: C.wallDeep, sill: C.trim });
      archWindow(bag, x, byy + 0.16, z + r - 0.02, 0, 1.1, 2.1, { frame: C.trim, mullion: true, keystone: C.wallDeep });
      for (const a of [-0.7, 0.7]) archWindow(bag, x + Math.sin(a) * r * 0.985, byy + 0.3, z + Math.cos(a) * r * 0.985, a, 0.8, 1.5, { frame: C.trim, keystone: C.wallDeep });
      for (let i = -1; i <= 1; i += 1) {
        const a = i * 0.75;
        const rr = top.r - 0.1;
        roundWindow(bag, x + Math.sin(a) * rr, (top.capY0 + top.capY1) / 2, z + Math.cos(a) * rr, a, 0.32);
      }
      // Bartizans corbelled off the tower sides.
      for (const sx of S) {
        const a = sx * 1.32;
        const bx = x + Math.sin(a) * (r + 0.55);
        const bz = z + Math.cos(a) * (r + 0.55);
        const b0 = TER + 12.6;
        bag.matte.addColored(
          latheRings(
            [
              [0.0, 0, C.trim],
              [0.25, 0.15],
              [0.75, 0.9],
              [0.95, 1.2],
              [0.95, 1.2, C.tower],
              [0.95, 3.4],
              [0.95, 3.4, C.trim],
              [1.05, 3.5],
              [1.05, 3.7],
              [0.6, 3.72],
            ],
            { segments: 16 },
          ),
          { p: [bx, b0, bz] },
        );
        bag.satin.addColored(coneRoof({ R: 1.3, H: 2.6, color: C.coral, segments: 16, rows: 4 }), { p: [bx, b0 + 3.68, bz] });
        finial(bag.metal, bag.gloss, bx, b0 + 3.68 + 2.55, bz, 0.7, 'ball');
        archWindow(bag, bx + Math.sin(a) * 0.93, b0 + 1.7, bz + Math.cos(a) * 0.93, a, 0.45, 0.95, { frame: C.trim, t: 0.07 });
      }
    }

    // Slim turrets with needle spires (silhouette variety).
    const slim = (x: number, z: number, r: number, h: number, roofH: number, color: Col, topKind: 'star' | 'heart', flag: boolean) => {
      const top = roundTower(bag, x, z, {
        base: TER + hallH - 0.2,
        r,
        h,
        capH: 0.7,
        flare: 0.26,
        corbelH: 0.5,
        bands: [h * 0.5],
        wall: C.tower,
        trim: C.trim,
        stone: C.stone,
        segments: 20,
        noPlinth: true,
      });
      bag.satin.addColored(coneRoof({ R: top.r + 0.3, H: roofH, color, p: 1.2, kick: 0.12, segments: 20 }), { p: [x, top.y - 0.04, z] });
      if (flag) {
        const pt = finial(bag.metal, bag.gloss, x, top.y + roofH - 0.1, z, 0.95, 'pole');
        flagPole(x, pt, z, 2.0, 0.8, 'pennant', C.lilac, C.trim, false, C.gold);
      } else {
        finial(bag.metal, bag.gloss, x, top.y + roofH - 0.1, z, 1.0, topKind);
      }
      archWindow(bag, x, top.capY0 - 2.4, z + r, 0, 0.55, 1.1, { frame: C.trim, t: 0.08 });
      roundWindow(bag, x, (top.capY0 + top.capY1) / 2, z + top.r - 0.08, 0, 0.18);
      sparkleSpots.push({ p: [x + 1.2, top.y + roofH + 0.8, z + 1.0], s: 0.55 });
    };
    slim(-3.9, -32.5 + KS, 1.3, 8.6, 6.0, C.coral, 'star', true);
    slim(4.6, -32.0 + KS, 1.12, 6.8, 4.6, C.lilac, 'heart', false);

    // Blossom trees in the courtyard corners peek over the walls.
    roundTree(bag, -16.0, -17.0, 5.4, 2.3, 83, true, 0, { lumps: 2, lumpDetail: 1 });
    roundTree(bag, 16.0, -18.2, 5.2, 2.4, 84, false, 0, { lumps: 2, lumpDetail: 1 });
    // Flower beds along the courtyard side of the front walls (finish-shot backdrop).
    for (const sx of S) hedgeRow(bag, sx * (TX + 2.9), sx * (CX - 2.2), GZ - WT / 2 - 0.75, 1.05, 1.0, sx > 0 ? 93 : 94, 0, ROSES, 0.25);

  }

  // -------------------------------------------------------------------------
  // Finish line: berry/white checkers with gold edges, plus flag posts.
  // -------------------------------------------------------------------------
  {
    const cols = 14;
    const rowsN = 4;
    const w = 8.6 / cols;
    const d = 2.4 / rowsN;
    const cell = new THREE.BoxGeometry(w, 0.05, d);
    for (let i = 0; i < cols; i += 1) {
      for (let j = 0; j < rowsN; j += 1) {
        bag.matte.add(cell, (i + j) % 2 === 0 ? '#ffffff' : C.berry, { p: [-4.3 + w * (i + 0.5), 0.028, -1.2 + d * (j + 0.5)] });
      }
    }
    cell.dispose();
    for (const ez of [-1.3, 1.3]) bag.metal.add(rbox(8.6, 0.06, 0.2, 0.025, 1), C.gold, { p: [0, 0.035, ez] });
    for (const sx of S) {
      const x = sx * 5.6;
      bag.matte.add(rbox(0.7, 0.45, 0.7, 0.1, 1), C.stone, { p: [x, 0.225, 0] });
      const stripes: Array<[number, number, Col?]> = [[0.13, 0.4, C.trim]];
      const n = 9;
      for (let i = 0; i < n; i += 1) {
        const y0 = 0.45 + (i / n) * 3.9;
        const colr = i % 2 === 0 ? C.trim : '#ff7fa6';
        stripes.push([0.13, y0, colr], [0.13, y0 + 3.9 / n]);
      }
      stripes.push([0.13, 4.35, C.trim], [0.0, 4.36]);
      bag.matte.addColored(latheRings(stripes, { segments: 10 }), { p: [x, 0, 0] });
      bag.metal.add(sphere(0.2, 14, 10), C.gold, { p: [x, 4.5, 0] });
      cloth.add({ anchor: [x + 0.12, 4.25, 0], yaw: WIND_YAW, length: 1.35, height: 0.95, shape: 'rect', color: '#ffffff', color2: '#3b2438', checker: true, phase: sx * 1.7 });
    }
  }

  // -------------------------------------------------------------------------
  // Assemble
  // -------------------------------------------------------------------------
  const meshes = bag.build('castle', group);
  const flags = cloth.build();
  group.add(flags);
  const sparkles = new Sparkles(sparkleSpots, 'castleSparkles', 3);
  group.add(sparkles.mesh);

  // Heartbeat emblem: glossy heart that gently swells and glows.
  const hb = new PartBuilder();
  const heartGeo = extrude(heartShape(2.5), 0.4, 0.16, 2, 18);
  hb.add(heartGeo, PAL.heartGem);
  heartGeo.dispose();
  const heartMat = curved(
    new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.3,
      metalness: 0,
      clearcoat: 0.7,
      clearcoatRoughness: 0.15,
      emissive: new THREE.Color(PAL.heartGem),
      emissiveIntensity: 0.15,
    }),
  );
  heartMat.name = 'castleHeart';
  const heartMesh = new THREE.Mesh(hb.build()!, heartMat);
  heartMesh.name = 'castleHeart';
  heartMesh.position.copy(heartPos);
  heartMesh.castShadow = true;
  heartMesh.receiveShadow = true;
  group.add(heartMesh);

  return {
    group,
    update(_dt: number, time: number) {
      cloth.update(time);
      sparkles.update(time);
      // Soft "lub-dub" every ~1.7 s.
      const t = (time % 1.7) / 1.7;
      const beat = Math.exp(-Math.pow((t - 0.12) / 0.06, 2)) + 0.6 * Math.exp(-Math.pow((t - 0.3) / 0.07, 2));
      heartMesh.scale.setScalar(1 + 0.05 * beat);
      heartMat.emissiveIntensity = 0.12 + 0.26 * beat;
    },
    dispose() {
      for (const m of meshes) m.geometry.dispose();
      cloth.dispose();
      sparkles.dispose();
      heartMesh.geometry.dispose();
      heartMat.dispose();
    },
  };
}
