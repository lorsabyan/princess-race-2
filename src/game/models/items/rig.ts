import * as THREE from 'three';
import { itemMaterial } from './surface';

export type ObstacleKind = 'cones' | 'ducks' | 'cart' | 'puddle';

export interface ObstacleRig {
  root: THREE.Group;
  kind: ObstacleKind;
  /** Collision footprint half extents (X, Z) around the root origin. */
  halfWidth: number;
  halfDepth: number;
  /**
   * Idle animation + reaction physics. Call every frame while active.
   * `driftX` (optional): the root's current lateral velocity in units/s when the game
   * slides the obstacle sideways. Ducks face and waddle along it (staggered turns when
   * it changes sign, step speed follows |driftX|); other kinds ignore it. When omitted,
   * ducks run their own small back-and-forth walk cycle instead.
   */
  update(dt: number, time: number, driftX?: number): void;
  /**
   * Hit reaction. `side` is the X direction things get knocked toward
   * (+1 = toward +X, e.g. the car clipped the obstacle's -X half).
   */
  react(side: -1 | 1): void;
  /** Back to the idle state (for pooling). Does not touch root's transform. */
  reset(): void;
  /** Detach and free per-instance resources. Shared geometry/materials stay cached. */
  dispose(): void;
}

/** Shared toy-plastic/plush material for obstacles (clearcoat masked per vertex). */
export function obstacleMaterial(): THREE.MeshStandardMaterial {
  return itemMaterial('obstacle', {
    physical: true,
    params: { clearcoat: 0.7, clearcoatRoughness: 0.22 },
  });
}

/** Same as obstacleMaterial but with the kit's wind sway (flowers, awning fringe). */
export function obstacleWindMaterial(): THREE.MeshStandardMaterial {
  return itemMaterial('obstacle-wind', {
    physical: true,
    wind: true,
    params: { clearcoat: 0.7, clearcoatRoughness: 0.22 },
  });
}

export function shadowed<T extends THREE.Mesh>(mesh: T, cast = true, receive = true): T {
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}
