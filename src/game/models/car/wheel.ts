import * as THREE from 'three';
import { extrude, starShape } from '../kit/geo';
import { PAL } from '../kit/palette';
import { Assembler, ROLE_PAINT, type RecolorInfo } from './assembler';
import { PBR } from './carMaterials';
import { CAR } from './layout';

/**
 * Revolve an (axial, radius) profile around the X axis. Profiles must run in
 * increasing "outward" order (inner bead -> tread -> outer bead -> hub) so the
 * faces point out.
 */
export function revolveX(points: Array<[number, number]>, segments: number): THREE.BufferGeometry {
  const pts = points.map(([a, r]) => new THREE.Vector2(Math.max(1e-4, r), a));
  const g = new THREE.LatheGeometry(pts, segments);
  g.rotateZ(-Math.PI / 2);
  g.deleteAttribute('uv');
  return g;
}

/** Sample a smooth closed-ish profile with Catmull-Rom, returning points between t0..t1 (0..1). */
function sampler(control: Array<[number, number]>): (t0: number, t1: number, n: number) => Array<[number, number]> {
  const curve = new THREE.SplineCurve(control.map(([a, r]) => new THREE.Vector2(a, r)));
  return (t0, t1, n) => {
    const out: Array<[number, number]> = [];
    for (let i = 0; i <= n; i += 1) {
      const p = curve.getPointAt(t0 + ((t1 - t0) * i) / n);
      out.push([p.x, p.y]);
    }
    return out;
  };
}

export interface WheelBuild {
  geometry: THREE.BufferGeometry;
  recolor: RecolorInfo;
}

/**
 * Chunky balloon toy tire: soft plum rubber, cream whitewall, chrome rim lip,
 * gold hubcap with a raised pink star. Axle along +X, the pretty face at +X.
 * Radius CAR.wheelR, centered at the origin.
 */
export function buildWheelGeometry(segments = 24): WheelBuild {
  const R = CAR.wheelR;
  const hw = CAR.wheelW / 2;
  const asm = new Assembler();
  // Tire cross-section (axial, radius) from the inner bead over the tread to the outer bead.
  const tire = sampler([
    [-hw * 0.74, R * 0.6],
    [-hw * 0.93, R * 0.68],
    [-hw * 1.0, R * 0.8],
    [-hw * 0.94, R * 0.915],
    [-hw * 0.7, R * 0.985],
    [-hw * 0.3, R * 1.0],
    [hw * 0.3, R * 1.0],
    [hw * 0.7, R * 0.985],
    [hw * 0.94, R * 0.915],
    [hw * 1.0, R * 0.8],
    [hw * 0.93, R * 0.68],
    [hw * 0.74, R * 0.6],
  ]);
  const tireColor = '#5a4262';
  // Whitewall band on the outer sidewall between t = 0.8 .. 0.93 (crisp edges: separate strips).
  const tWallA = 0.795;
  const tWallB = 0.935;
  asm.add(revolveX(tire(0, tWallA, 15), segments), tireColor, PBR.tire);
  asm.add(revolveX(tire(tWallA, tWallB, 3), segments), PAL.whitewall, PBR.whitewall);
  asm.add(revolveX(tire(tWallB, 1, 2), segments), tireColor, PBR.tire);

  // Inner closing disc (hidden side).
  asm.add(revolveX([[-hw * 0.7, 0.001], [-hw * 0.74, R * 0.6]], 12), '#4a2c46', PBR.tire);

  // Chrome rim lip, then a cream dish, then the gold hubcap.
  const a0 = hw * 0.74;
  asm.add(
    revolveX(
      [
        [a0, R * 0.6],
        [a0 + 0.012, R * 0.585],
        [a0 + 0.018, R * 0.56],
        [a0 + 0.012, R * 0.53],
        [a0 - 0.002, R * 0.51],
      ],
      segments,
    ),
    PAL.chrome,
    PBR.chrome,
  );
  asm.add(
    revolveX(
      [
        [a0 - 0.002, R * 0.51],
        [a0 - 0.008, R * 0.47],
        [a0 - 0.006, R * 0.43],
      ],
      segments,
    ),
    PAL.whitewall,
    PBR.enamel,
  );
  const hub: Array<[number, number]> = [
    [a0 - 0.006, R * 0.43],
    [a0 + 0.012, R * 0.425],
    [a0 + 0.03, R * 0.39],
    [a0 + 0.04, R * 0.33],
    [a0 + 0.044, R * 0.24],
    [a0 + 0.046, R * 0.001],
  ];
  asm.add(revolveX(hub, segments), PAL.gold, PBR.gold);

  // Raised star on the hubcap face (points toward +X).
  const star = extrude(starShape(R * 0.26, R * 0.12, 5), 0.012, 0.006, 1, 2);
  asm.add(star, PAL.carPaint, PBR.enamel, { p: [a0 + 0.052, 0, 0], r: [0, Math.PI / 2, 0], role: ROLE_PAINT, t: 1 });
  // Tiny gold center pip.
  asm.add(new THREE.SphereGeometry(R * 0.07, 10, 6), PAL.gold, PBR.gold, { p: [a0 + 0.062, 0, 0], s: [0.6, 1, 1] });
  const { geometry, recolor } = asm.build();
  return { geometry, recolor };
}
