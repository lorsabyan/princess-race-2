import * as THREE from 'three';
import type { LabItems } from './types';
import { blend, capsule, ellipsoid, mirrorX, move, roundBox, sphere, subtract } from '../game/models/kit/sdf';
import { meshSdf } from '../game/models/kit/mesher';
import { PartBuilder, blob, cyl, rbox } from '../game/models/kit/geo';
import { meshOf } from '../game/models/kit/materials';
import { PAL } from '../game/models/kit/palette';

/** Sanity items for the modeling kit itself. */
export const items: LabItems = {
  'kit-sdf': () => {
    const body = blend(
      0.35,
      roundBox(0.9, 0.35, 1.6, 0.3, 0),
      move(ellipsoid(0.85, 0.4, 0.9), 0, 0.25, -0.9),
      mirrorX(move(sphere(0.45, 0), 0.9, 0.05, 1.0)),
      mirrorX(move(sphere(0.45, 0), 0.9, 0.05, -1.0)),
    );
    const carved = subtract(body, move(roundBox(0.7, 0.4, 0.6, 0.25), 0, 0.55, 0.3), 0.12, 1);
    const handle = capsule(-0.5, 0.6, 1.4, 0.5, 0.6, 1.4, 0.06, 2);
    const t0 = performance.now();
    const g = meshSdf(blend(0.05, carved, handle), {
      min: [-1.6, -0.5, -2.1],
      max: [1.6, 1.0, 2.1],
      cell: 0.03,
      colors: { 0: PAL.carPaint, 1: PAL.carInterior, 2: PAL.gold },
    });
    const ms = performance.now() - t0;
    const mesh = meshOf(g, 'gloss')!;
    mesh.position.y = 0.5;
    const root = new THREE.Group();
    root.add(mesh);
    return {
      object: root,
      info: `sdf mesh ${Math.round(ms)}ms, ${g.index!.count / 3} tris`,
      view: { target: [0, 0.6, 0], dist: 6, yaw: 35, pitch: 22 },
    };
  },
  'kit-parts': () => {
    const b = new PartBuilder();
    b.add(rbox(1.2, 1.4, 1.2, 0.12), PAL.wallBlush, { p: [0, 0.7, 0], shade: { y0: 0, y1: 0.6, k: 0.7 } });
    b.add(cyl(0.12, 0.16, 1.2, 10), PAL.trunk, { p: [2, 0.6, 0] });
    b.add(blob(0.8, 3, 0.12), PAL.leaf, { p: [2, 1.7, 0], wind: 0.05 });
    const root = new THREE.Group();
    root.add(meshOf(b.build(), 'foliage')!);
    return { object: root, view: { target: [1, 0.9, 0], dist: 6 } };
  },
};
