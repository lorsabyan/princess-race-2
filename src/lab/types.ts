import type * as THREE from 'three';

export interface LabView {
  /** Orbit target. */
  target?: [number, number, number];
  /** Camera distance from target. */
  dist?: number;
  /** Degrees around Y. 0 = camera on +Z looking toward -Z (the chase-camera side). */
  yaw?: number;
  /** Degrees above the horizon. */
  pitch?: number;
  fov?: number;
}

export interface LabItem {
  object: THREE.Object3D;
  /** Per-frame animation hook. */
  update?: (dt: number, time: number) => void;
  view?: LabView;
  /** Ground under the item. Default 'grass'. */
  ground?: 'grass' | 'road' | 'none';
  /** Extra text for the info panel. */
  info?: string;
}

export type LabItems = Record<string, () => LabItem | Promise<LabItem>>;
