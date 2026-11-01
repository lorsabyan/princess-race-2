import type { Vec3 } from '../kit/geo';
import type { TubePoint } from './sdfx';

/**
 * Bind-pose layout, in the rig root's space. Root origin = pelvis bottom (seat
 * contact point); +Y up; she faces -Z; her right hand is on +X.
 */
export const BONE_NAMES = [
  'hips',
  'spine',
  'neck',
  'head',
  'pigtailL1',
  'pigtailL2',
  'pigtailL3',
  'pigtailR1',
  'pigtailR2',
  'pigtailR3',
  'shoulderL',
  'elbowL',
  'handL',
  'shoulderR',
  'elbowR',
  'handR',
  'legL',
  'legR',
  'skirt',
  'lap',
] as const;
export type BoneName = (typeof BONE_NAMES)[number];

export const B = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i])) as Record<BoneName, number>;

/** Feet-to-root height when standing. */
export const STAND_HEIGHT = 0.23;

/** Head center and radii. */
export const HEAD_C: Vec3 = [0, 0.815, 0];
export const HEAD_R: Vec3 = [0.272, 0.248, 0.256];

/** Right pigtail spine in HEAD space (x, y, z, radius); the left one is mirrored. */
export const PIG_PATH: TubePoint[] = [
  [0.228, 0.172, 0.05, 0.036],
  [0.292, 0.172, 0.066, 0.054],
  [0.346, 0.126, 0.078, 0.068],
  [0.374, 0.05, 0.084, 0.074],
  [0.376, -0.036, 0.084, 0.07],
  [0.356, -0.118, 0.078, 0.058],
  [0.338, -0.192, 0.072, 0.044],
  [0.356, -0.25, 0.068, 0.028],
  [0.404, -0.262, 0.064, 0.012],
];
/** Indices into PIG_PATH where the three pigtail bones sit, plus the tip. */
export const PIG_JOINTS = [0, 3, 5, 8];

export function pigPath(side: number): TubePoint[] {
  return PIG_PATH.map(([x, y, z, r]) => [x * side, y, z, r] as TubePoint);
}

export const SHOULDER: Vec3 = [0.165, 0.525, 0];
export const ELBOW_Y = 0.325;
export const WRIST_Y = 0.135;
export const UPPER_ARM = SHOULDER[1] - ELBOW_Y;
export const FOREARM = ELBOW_Y - WRIST_Y;
export const HIP: Vec3 = [0.066, 0.04, 0];

function headToRoot(p: TubePoint | Vec3): Vec3 {
  return [p[0] + HEAD_C[0], p[1] + HEAD_C[1], p[2] + HEAD_C[2]];
}

/** Absolute bind positions of each bone (root space). */
export const BONE_POS: Record<BoneName, Vec3> = {
  hips: [0, 0.08, 0],
  spine: [0, 0.265, 0],
  neck: [0, 0.54, 0.0],
  head: [0, 0.575, 0.012],
  pigtailL1: headToRoot(pigPath(-1)[PIG_JOINTS[0]]),
  pigtailL2: headToRoot(pigPath(-1)[PIG_JOINTS[1]]),
  pigtailL3: headToRoot(pigPath(-1)[PIG_JOINTS[2]]),
  pigtailR1: headToRoot(pigPath(1)[PIG_JOINTS[0]]),
  pigtailR2: headToRoot(pigPath(1)[PIG_JOINTS[1]]),
  pigtailR3: headToRoot(pigPath(1)[PIG_JOINTS[2]]),
  shoulderL: [-SHOULDER[0], SHOULDER[1], SHOULDER[2]],
  elbowL: [-SHOULDER[0], ELBOW_Y, SHOULDER[2]],
  handL: [-SHOULDER[0], WRIST_Y, SHOULDER[2]],
  shoulderR: [SHOULDER[0], SHOULDER[1], SHOULDER[2]],
  elbowR: [SHOULDER[0], ELBOW_Y, SHOULDER[2]],
  handR: [SHOULDER[0], WRIST_Y, SHOULDER[2]],
  legL: [-HIP[0], HIP[1], HIP[2]],
  legR: [HIP[0], HIP[1], HIP[2]],
  skirt: [0, 0.265, 0],
  lap: [0, 0.1, 0],
};

export const BONE_PARENT: Record<BoneName, BoneName | null> = {
  hips: null,
  spine: 'hips',
  neck: 'spine',
  head: 'neck',
  pigtailL1: 'head',
  pigtailL2: 'pigtailL1',
  pigtailL3: 'pigtailL2',
  pigtailR1: 'head',
  pigtailR2: 'pigtailR1',
  pigtailR3: 'pigtailR2',
  shoulderL: 'spine',
  elbowL: 'shoulderL',
  handL: 'elbowL',
  shoulderR: 'spine',
  elbowR: 'shoulderR',
  handR: 'elbowR',
  legL: 'hips',
  legR: 'hips',
  skirt: 'hips',
  lap: 'hips',
};

/** Steering-wheel contract (relative to the root when seated). */
export const WHEEL = {
  center: [0, 0.42, -0.52] as Vec3,
  radius: 0.2,
  tilt: (55 * Math.PI) / 180,
  /** Hands rest at 9 and 3 o'clock, slightly inside the rim and toward her. */
  gripRadius: 0.16,
  gripLift: 0.05,
  steerGain: 1.2,
  /** Hands slide along the rim: they follow this fraction of the wheel's rotation. */
  handFollow: 0.75,
};

export { headToRoot };
