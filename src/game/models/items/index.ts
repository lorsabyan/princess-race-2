/**
 * Pickups and obstacles for Princess Coin Drive.
 *
 *   Coins / heart gems: one merged vertex-colored geometry + one shared curved-world
 *   material each, built for InstancedMesh (faces ±Z, spin around Y).
 *   Obstacles: `createObstacle(kind, seed)` rigs with idle animation, hit reactions,
 *   reset() for pooling and dispose(); geometry/materials are cached per kind.
 */
export { createCoinGeometry, coinMaterial, COIN_SIZE, COIN_COLOR } from './coin';
export { createHeartGemGeometry, heartGemMaterial, HEART_GEM_SIZE } from './heartGem';
export { createObstacle, disposeObstacleCaches, type ObstacleKind, type ObstacleRig } from './obstacles';
export { disposeItemMaterials, itemEnvMap } from './surface';
