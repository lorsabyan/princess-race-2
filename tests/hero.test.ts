import { describe, expect, it } from 'vitest';
import { hullField } from '../src/game/models/car/hull';
import { CAR } from '../src/game/models/car/layout';
import { buildWheelGeometry } from '../src/game/models/car/wheel';
import { buildRibbons } from '../src/game/models/princess/headParts';

/** The box buildHull meshes. Anything of the body outside it would leave a hole in the car. */
const BOUNDS = { x: 1.08, top: 1.2, z: 1.8 };

describe('car hull', () => {
  it('stays inside the box it is meshed in, so the body has no holes', () => {
    const { field } = hullField();
    const steps = 40;
    for (let i = 0; i <= steps; i += 1) {
      for (let j = 0; j <= steps; j += 1) {
        const u = i / steps;
        const v = j / steps;
        const x = -BOUNDS.x + 2 * BOUNDS.x * u;
        const y = 0.24 + (BOUNDS.top - 0.24) * v;
        const z = -BOUNDS.z + 2 * BOUNDS.z * v;
        expect(field.d(BOUNDS.x, y, z), `side at ${y} ${z}`).toBeGreaterThan(0);
        expect(field.d(x, y, BOUNDS.z), `tail at ${x} ${y}`).toBeGreaterThan(0);
        expect(field.d(x, y, -BOUNDS.z), `nose at ${x} ${y}`).toBeGreaterThan(0);
        expect(field.d(x, BOUNDS.top, z), `top at ${x} ${z}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('wheel', () => {
  it('stays round enough to roll: tread blocks only just stand proud of the tire', () => {
    const pos = buildWheelGeometry().geometry.attributes.position;
    let reach = 0;
    for (let i = 0; i < pos.count; i += 1) reach = Math.max(reach, Math.hypot(pos.getY(i), pos.getZ(i)));
    expect(reach).toBeGreaterThan(CAR.wheelR * 0.98);
    expect(reach).toBeLessThan(CAR.wheelR * 1.05);
  });
});

describe('ribbons', () => {
  it('are pinned at the bow and free at the tip', () => {
    for (const side of [-1, 1]) {
      const flutter = buildRibbons(side).attributes.flutter;
      const values = Array.from({ length: flutter.count }, (_, i) => flutter.getX(i));
      expect(Math.min(...values)).toBeLessThan(0.01);
      expect(Math.max(...values)).toBe(1);
    }
  });

  it('trail back behind her head on the side of their bow', () => {
    const pos = buildRibbons(1).attributes.position;
    let tipZ = -Infinity;
    let tipX = 0;
    for (let i = 0; i < pos.count; i += 1) {
      if (pos.getZ(i) > tipZ) {
        tipZ = pos.getZ(i);
        tipX = pos.getX(i);
      }
    }
    expect(tipZ).toBeGreaterThan(0.5);
    expect(tipX).toBeGreaterThan(0);
  });
});
