import type { ObstacleKind, ObstacleRig } from './rig';
import { createCones, disposeConeCaches } from './cones';
import { createDucks, disposeDuckCaches } from './ducks';
import { createCart, disposeCartCaches } from './cart';
import { createPuddle, disposePuddleCaches } from './puddle';

export type { ObstacleKind, ObstacleRig } from './rig';

/**
 * Friendly "go around me" obstacles. Each rig's origin is at ground level,
 * centered on its collision footprint, facing +Z (toward the approaching car).
 * Geometry and materials are cached per kind, so pooling many rigs is cheap.
 *
 *   cones  – footprint (1.0, 0.5)  up to 4 draw calls (3 cones, or 2 cones + bar)
 *   ducks  – footprint (0.9, 0.5)  1 draw call (skinned family)
 *   cart   – footprint (1.1, 0.8)  1 draw call (+1 while petals fly)
 *   puddle – footprint (1.2, 1.0)  1 draw call (+3 while splashing)
 */
export function createObstacle(kind: ObstacleKind, seed = 0): ObstacleRig {
  switch (kind) {
    case 'cones':
      return createCones(seed);
    case 'ducks':
      return createDucks(seed);
    case 'cart':
      return createCart(seed);
    case 'puddle':
      return createPuddle(seed);
    default:
      throw new Error(`Unknown obstacle kind: ${String(kind)}`);
  }
}

/** Free the shared per-kind geometry caches (call when leaving the game). */
export function disposeObstacleCaches(): void {
  disposeConeCaches();
  disposeDuckCaches();
  disposeCartCaches();
  disposePuddleCaches();
}
