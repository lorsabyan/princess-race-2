import * as THREE from 'three';
import { PAL } from '../kit/palette';
import { extrude, heartShape } from '../kit/geo';
import { SkinBuilder, chainWeights, ramp, type PoseRanges, type WeightFn } from './skinBuilder';
import { decimate, decimateTiming } from '../kit/decimate';
import { faceUv } from './faceAtlas';
import { bowMatrix, buildBow, buildHair, buildHead, buildPigtail, buildRibbons } from './headParts';
import {
  DRESS_ACCENT,
  buildArm,
  buildBodice,
  buildLap,
  buildLeg,
  buildNeck,
  buildPetticoat,
  buildSash,
  buildShoe,
  buildSkirt,
  buildSleeve,
  necklacePoints,
  ruffleRing,
  skirtHeartSpots,
  skirtHemCusps,
} from './bodyParts';
import { buildCrown, crownJewels } from './crown';
import { B, ELBOW_Y, HEAD_C, HEAD_R, PIG_JOINTS, SHOULDER, WRIST_Y, headToRoot, pigPath } from './rigSpec';

export type Zone = 'skin' | 'hair' | 'dress' | 'gold' | 'jewels';

export interface PrincessGeometries {
  geometry: Record<Zone, THREE.BufferGeometry>;
  ranges: Record<Zone, PoseRanges>;
  /** Build time in ms and triangle counts. */
  stats: Record<string, number>;
}

const TRIM = '#fff4f6';
const TIGHTS = '#fff6f8';
/** Pigtail bow scale (the bows are the chase camera's favorite detail). */
const BOW_SCALE = 1.3;

/** A big crown: from the chase camera it is the first thing that says "princess". */
const CROWN_SCALE = 1.3;

/** Crown placement in root space: perched on the hair, tilted a little to her left and forward. */
export function crownMatrix(): THREE.Matrix4 {
  const p = new THREE.Vector3(HEAD_C[0] + 0.004, HEAD_C[1] + 0.262, HEAD_C[2] - 0.012);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.05, 0.1, 0.1, 'XYZ'));
  return new THREE.Matrix4().compose(p, q, new THREE.Vector3(CROWN_SCALE, CROWN_SCALE, CROWN_SCALE));
}

function armWeights(side: number): WeightFn {
  const sh = side < 0 ? B.shoulderL : B.shoulderR;
  const el = side < 0 ? B.elbowL : B.elbowR;
  const ha = side < 0 ? B.handL : B.handR;
  return (_x, y) => {
    const we = ramp(ELBOW_Y + 0.035, ELBOW_Y - 0.035, y);
    const wh = ramp(WRIST_Y + 0.014, WRIST_Y - 0.014, y);
    return [
      [sh, 1 - we],
      [el, we * (1 - wh)],
      [ha, we * wh],
    ];
  };
}

export function buildPrincessGeometries(): PrincessGeometries {
  const t0 = performance.now();
  decimateTiming.ms = 0;
  const stats: Record<string, number> = {};
  const time = (label: string, since: number) => {
    stats[`ms.${label}`] = Math.round(performance.now() - since);
  };

  const zones: Record<Zone, SkinBuilder> = {
    skin: new SkinBuilder(),
    hair: new SkinBuilder(),
    dress: new SkinBuilder(),
    gold: new SkinBuilder(),
    jewels: new SkinBuilder(),
  };
  const { skin, hair, dress, gold, jewels } = zones;

  // --- Skin -------------------------------------------------------------
  let t = performance.now();
  skin.add(decimate(buildHead(), 3200), {
    p: HEAD_C,
    bone: B.head,
    uv: (x, y, z) => faceUv(x - HEAD_C[0], y - HEAD_C[1], z - HEAD_C[2]),
  });
  time('head', t);
  skin.add(decimate(buildNeck(), 180), {
    bone: (_x, y) => {
      const w = ramp(0.535, 0.6, y);
      return [
        [B.neck, 1 - w],
        [B.head, w],
      ];
    },
  });
  t = performance.now();
  for (const side of [-1, 1]) skin.add(decimate(buildArm(side), 650), { bone: armWeights(side) });
  time('arms', t);

  // --- Hair ---------------------------------------------------------------
  t = performance.now();
  hair.add(decimate(buildHair(), 4600), { p: HEAD_C, bone: B.head });
  time('hair', t);
  t = performance.now();
  const headT = new THREE.Matrix4().makeTranslation(HEAD_C[0], HEAD_C[1], HEAD_C[2]);
  for (const side of [-1, 1]) {
    const joints = PIG_JOINTS.map((i) => headToRoot(pigPath(side)[i]));
    const bones = side < 0 ? [B.pigtailL1, B.pigtailL2, B.pigtailL3] : [B.pigtailR1, B.pigtailR2, B.pigtailR3];
    hair.add(decimate(buildPigtail(side), 1100), { p: HEAD_C, bone: chainWeights(joints, bones, 0.8) });
    hair.add(decimate(buildBow(BOW_SCALE), 650), { matrix: headT.clone().multiply(bowMatrix(side)), bone: B.head });
    hair.add(buildRibbons(side), { p: HEAD_C, bone: B.head });
  }
  time('pigtails', t);

  // --- Dress --------------------------------------------------------------
  t = performance.now();
  dress.add(decimate(buildBodice(), 1400), { bone: B.spine });
  for (const side of [-1, 1]) {
    const sh = side < 0 ? B.shoulderL : B.shoulderR;
    dress.add(decimate(buildSleeve(side), 600), { bone: sh });
    dress.add(ruffleRing(0.043, 0.0095, 11, 0.0022, 6, 36), {
      p: [side * SHOULDER[0], SHOULDER[1] - 0.083, 0],
      bone: sh,
      color: TRIM,
    });
    dress.add(buildLeg(side), { bone: side < 0 ? B.legL : B.legR, color: TIGHTS, section: 'stand' });
  }
  dress.add(ruffleRing(0.057, 0.0125, 15, 0.0032, 6, 60), {
    p: [0, 0.537, 0.006],
    s: [1.02, 1, 0.94],
    bone: B.spine,
    color: TRIM,
  });
  dress.add(buildSash(), { bone: B.spine, color: DRESS_ACCENT });
  dress.add(decimate(buildBow(0.6), 650), {
    matrix: new THREE.Matrix4().compose(
      new THREE.Vector3(0, 0.278, 0.112),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0.12, 0, 0)),
      new THREE.Vector3(1, 1, 1),
    ),
    bone: B.skirt,
    section: 'stand',
  });
  dress.add(decimate(buildSkirt(), 2600, { colorWeight: 2 }), { bone: B.skirt, section: 'stand' });
  dress.add(decimate(buildPetticoat(), 950), { bone: B.skirt, section: 'stand' });
  dress.add(decimate(buildLap(), 420), { bone: B.lap, section: 'sit' });
  time('dress', t);

  // --- Gold ---------------------------------------------------------------
  t = performance.now();
  const crownM = crownMatrix();
  gold.add(decimate(buildCrown(), 1800), { matrix: crownM, bone: B.head });
  // Little pearly heart appliques on the skirt (standing only).
  const smallHeart = extrude(heartShape(1), 0.22, 0.12, 1, 5);
  smallHeart.center();
  for (const spot of skirtHeartSpots()) {
    const n = new THREE.Vector3(...spot.n);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
    jewels.add(smallHeart, {
      matrix: new THREE.Matrix4().compose(new THREE.Vector3(...spot.p), q, new THREE.Vector3(0.05, 0.05, 0.05)),
      bone: B.skirt,
      color: '#ffeaf3',
      section: 'stand',
    });
  }
  smallHeart.dispose();

  // --- Jewels (pearls, gems, shoes: glossy) ----------------------------------
  for (const j of crownJewels()) {
    jewels.add(j.geometry, { matrix: crownM.clone().multiply(j.matrix), bone: B.head, color: j.color });
  }
  const pearl = new THREE.SphereGeometry(1, 7, 4);
  const { pearls, pendant } = necklacePoints();
  for (const p of pearls) jewels.add(pearl, { p, s: 0.0088, bone: B.spine, color: PAL.pearl });
  const heart = extrude(heartShape(1), 0.3, 0.12, 2, 7);
  heart.center();
  jewels.add(heart, { p: pendant, r: [-0.35, Math.PI, 0], s: 0.03, bone: B.spine, color: PAL.gemPink });
  // Pearl earrings.
  for (const side of [-1, 1]) {
    jewels.add(pearl, {
      p: [HEAD_C[0] + side * (HEAD_R[0] + 0.004), HEAD_C[1] - 0.088, HEAD_C[2] + 0.012],
      s: 0.0105,
      bone: B.head,
      color: PAL.pearl,
    });
  }
  // Pearls at the skirt's scallop cusps + shoes (standing only).
  for (const p of skirtHemCusps()) jewels.add(pearl, { p, s: 0.0095, bone: B.skirt, color: PAL.pearl, section: 'stand' });
  for (const side of [-1, 1]) {
    jewels.add(decimate(buildShoe(side), 450), { bone: side < 0 ? B.legL : B.legR, section: 'stand' });
  }
  time('jewels', t);

  let total = 0;
  let sit = 0;
  let stand = 0;
  for (const [name, b] of Object.entries(zones)) {
    const tri = Math.round(b.triangleCount);
    const pose = b.poseTriangles();
    stats[`tris.${name}`] = tri;
    total += tri;
    sit += pose.sit;
    stand += pose.stand;
  }
  stats['tris.total'] = total;
  stats['tris.stand'] = stand;
  stats['tris.sit'] = sit;

  const geometry = {} as Record<Zone, THREE.BufferGeometry>;
  const ranges = {} as Record<Zone, PoseRanges>;
  for (const [name, b] of Object.entries(zones) as Array<[Zone, SkinBuilder]>) {
    geometry[name] = b.build();
    ranges[name] = b.ranges;
  }
  stats['ms.decimate'] = Math.round(decimateTiming.ms);
  stats['ms.total'] = Math.round(performance.now() - t0);
  pearl.dispose();
  heart.dispose();
  return { geometry, ranges, stats };
}
