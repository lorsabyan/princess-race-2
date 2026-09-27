import * as THREE from 'three';
import type { Obstacle } from '../entities/Obstacle';
import type { Pickup } from '../entities/Pickup';

export class CollisionSystem {
  private readonly delta = new THREE.Vector3();

  collectPickups(playerPosition: THREE.Vector3, pickups: Pickup[], playerRadius: number): Pickup[] {
    const collected: Pickup[] = [];

    for (const pickup of pickups) {
      if (!pickup.active) continue;
      this.delta.copy(playerPosition).sub(pickup.group.position);
      this.delta.y = 0;
      const radius = playerRadius + pickup.radius;
      if (this.delta.lengthSq() <= radius * radius) {
        pickup.collect();
        collected.push(pickup);
      }
    }

    return collected;
  }

  hitObstacles(playerPosition: THREE.Vector3, obstacles: Obstacle[], playerRadius: number): Obstacle[] {
    const hits: Obstacle[] = [];

    for (const obstacle of obstacles) {
      if (!obstacle.active || !obstacle.canHit()) continue;
      this.delta.copy(playerPosition).sub(obstacle.group.position);
      this.delta.y = 0;
      const radius = playerRadius + obstacle.radius;
      if (this.delta.lengthSq() <= radius * radius) {
        obstacle.markHit();
        hits.push(obstacle);
      }
    }

    return hits;
  }
}
