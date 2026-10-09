/**
 * Interfaces shared between the game runtime and the model factories.
 * Each model module (car/, princess/, town/, items/, landmarks/) implements these.
 */
import type * as THREE from 'three';

export interface CarState {
  time: number;
  speed: number;
  steer: number;
  bump: number;
}

export interface CarRig {
  root: THREE.Group;
  seat: THREE.Object3D;
  steeringWheel: THREE.Object3D;
  update(dt: number, state: CarState): void;
  setPaint(color: THREE.ColorRepresentation): void;
  dispose(): void;
}

export type PrincessPose = 'stand' | 'sit';
export type PrincessMood = 'happy' | 'surprised' | 'joy';

export interface PrincessState {
  time: number;
  steer: number;
  speed: number;
  walk: number;
}

export interface PrincessRig {
  root: THREE.Group;
  standHeight: number;
  setPose(pose: PrincessPose): void;
  setMood(mood: PrincessMood, holdSeconds?: number): void;
  wave(): void;
  cheer(): void;
  update(dt: number, state: PrincessState): void;
  dispose(): void;
}

export interface TownChunk {
  group: THREE.Group;
  dispose(): void;
}

export interface TownChunkOptions {
  clearLeft?: boolean;
  clearRight?: boolean;
}

export type ObstacleKind = 'cones' | 'ducks' | 'cart' | 'puddle';

export interface ObstacleRig {
  root: THREE.Group;
  kind: ObstacleKind;
  halfWidth: number;
  halfDepth: number;
  /** driftX: the root's lateral velocity (units/s) as moved by the game, so animals can face where they go. */
  update(dt: number, time: number, driftX?: number): void;
  react(side: -1 | 1): void;
  reset(): void;
  dispose(): void;
}

export interface Landmark {
  group: THREE.Group;
  update(dt: number, time: number): void;
  dispose(): void;
}

export interface PrincessHome extends Landmark {
  doorPosition: THREE.Vector3;
  pathPoints: THREE.Vector3[];
}

export interface Backdrop {
  group: THREE.Group;
  update(camera: THREE.Camera): void;
  dispose(): void;
}

/** Everything the game needs from the art side, in one place. */
export interface ModelLibrary {
  chunkLength: number;
  createCar(): CarRig;
  createPrincess(): PrincessRig;
  buildTownChunk(index: number, seed: number, opts?: TownChunkOptions): TownChunk;
  createCoinGeometry(): THREE.BufferGeometry;
  coinMaterial(): THREE.Material;
  createHeartGemGeometry(): THREE.BufferGeometry;
  heartGemMaterial(): THREE.Material;
  createObstacle(kind: ObstacleKind, seed?: number): ObstacleRig;
  createCastleGate(): Landmark;
  createPrincessHome(): PrincessHome;
  createBackdrop(): Backdrop;
}
