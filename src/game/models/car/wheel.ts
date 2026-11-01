import * as THREE from 'three';
import { extrude, heartShape, starShape } from '../kit/geo';
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

/** Round disc with a ring of heart-shaped windows, tips toward the middle. */
function heartDisc(radius: number, ring: number, size: number, count: number): THREE.Shape {
  const disc = new THREE.Shape();
  disc.absarc(0, 0, radius, 0, Math.PI * 2, false);
  const outline = heartShape(size).getPoints(5);
  const box = new THREE.Box2().setFromPoints(outline);
  const mid = box.getCenter(new THREE.Vector2());
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const pts = outline.map((p) => {
      const x = p.x - mid.x;
      const y = p.y - mid.y;
      // The heart's top points away from the hub.
      return new THREE.Vector2(c * y + s * x + c * ring, s * y - c * x + s * ring);
    });
    disc.holes.push(new THREE.Path(pts));
  }
  return disc;
}

export interface WheelBuild {
  geometry: THREE.BufferGeometry;
  recolor: RecolorInfo;
}

/**
 * Chunky balloon toy tire: dark plum rubber with big tread blocks, a cream whitewall
 * and a chrome wheel with five heart windows over a painted dish, so the spin reads.
 * Axle along +X, the pretty face at +X. Radius CAR.wheelR, centered at the origin.
 * A `covered` wheel (the spare) leaves out what its cover hides.
 */
export function buildWheelGeometry(segments = 26, covered = false): WheelBuild {
  const R = CAR.wheelR;
  const hw = CAR.wheelW / 2;
  const asm = new Assembler();
  // Tire cross-section (axial, radius) from the inner bead over the tread to the outer bead.
  const tire = sampler([
    [-hw * 0.74, R * 0.6],
    [-hw * 0.93, R * 0.68],
    [-hw * 1.0, R * 0.8],
    [-hw * 0.94, R * 0.915],
    [-hw * 0.7, R * 0.975],
    [-hw * 0.3, R * 0.985],
    [hw * 0.3, R * 0.985],
    [hw * 0.7, R * 0.975],
    [hw * 0.94, R * 0.915],
    [hw * 1.0, R * 0.8],
    [hw * 0.93, R * 0.68],
    [hw * 0.74, R * 0.6],
  ]);
  const tireColor = '#3b2a45';
  // Whitewall band on the outer sidewall (crisp edges: separate strips).
  const tWallA = 0.765;
  const tWallB = 0.945;
  asm.add(revolveX(tire(0, tWallA, 11), segments), tireColor, PBR.tire);
  asm.add(revolveX(tire(tWallA, tWallB, 4), segments), PAL.whitewall, PBR.whitewall);
  asm.add(revolveX(tire(tWallB, 1, 2), segments), tireColor, PBR.tire);

  // Tread blocks: two staggered rows, so the tire looks like a tire from behind too.
  const block = new THREE.BoxGeometry(hw * 0.66, R * 0.034, R * 0.15);
  const blocks = 20;
  for (let i = 0; i < blocks * 2; i += 1) {
    const a = (i / (blocks * 2)) * Math.PI * 2;
    const axial = (i % 2 === 0 ? -1 : 1) * hw * 0.42;
    asm.add(block, tireColor, PBR.tire, { p: [axial, Math.cos(a) * R * 0.99, Math.sin(a) * R * 0.99], r: [a, 0, 0] });
  }

  // Inner closing disc (hidden side).
  asm.add(revolveX([[-hw * 0.7, 0.001], [-hw * 0.74, R * 0.6]], 12), '#2f2138', PBR.tire);

  const a0 = hw * 0.74;
  if (covered) {
    const { geometry, recolor } = asm.build();
    return { geometry, recolor };
  }

  // Chrome rim lip, then the painted dish seen through the hearts.
  asm.add(
    revolveX(
      [
        [a0, R * 0.6],
        [a0 + 0.014, R * 0.59],
        [a0 + 0.02, R * 0.565],
        [a0 + 0.012, R * 0.54],
        [a0 - 0.012, R * 0.525],
      ],
      segments,
    ),
    PAL.chrome,
    PBR.chrome,
  );
  asm.add(
    revolveX(
      [
        [a0 - 0.012, R * 0.525],
        [a0 - 0.05, R * 0.5],
        [a0 - 0.058, R * 0.001],
      ],
      segments,
    ),
    PAL.carPaint,
    PBR.enamel,
    { role: ROLE_PAINT, t: 0.5 },
  );

  // Chrome disc with five heart windows.
  const disc = extrude(heartDisc(R * 0.525, R * 0.31, R * 0.27, 5), 0.012, 0.005, 1, 10);
  asm.add(disc, PAL.chrome, PBR.chrome, { p: [a0 - 0.026, 0, 0], r: [0, Math.PI / 2, 0] });

  // Gold hub with a raised pink star.
  const hub: Array<[number, number]> = [
    [a0 - 0.014, R * 0.205],
    [a0 + 0.004, R * 0.2],
    [a0 + 0.022, R * 0.17],
    [a0 + 0.032, R * 0.11],
    [a0 + 0.034, R * 0.001],
  ];
  asm.add(revolveX(hub, 20), PAL.gold, PBR.gold);
  const star = extrude(starShape(R * 0.135, R * 0.062, 5), 0.008, 0.004, 1, 2);
  asm.add(star, PAL.carPaint, PBR.enamel, { p: [a0 + 0.036, 0, 0], r: [0, Math.PI / 2, 0], role: ROLE_PAINT, t: 1 });
  const { geometry, recolor } = asm.build();
  return { geometry, recolor };
}
