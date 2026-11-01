import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { levelSpec } from '../src/game/sim/config';
import { Landscape } from '../src/game/sim/landscape';
import { buildRoute } from '../src/game/sim/route';
import { Track } from '../src/game/sim/track';
import { surfaceAt, warpGeometry, type RoadWorld } from '../src/game/view/warp';

const spec = levelSpec(1);
const track = new Track(spec.length, buildRoute(1, spec.length), spec.seed);
const world: RoadWorld = { track, land: new Landscape(track, spec.seed) };

function line(points: Array<[number, number, number]>): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(points.flatMap(() => [0, 1, 0]), 3));
  return g;
}

describe('bending chunks onto the road', () => {
  it('puts the road centerline exactly on the track, at every distance', () => {
    for (const s of [0, 137, 320, 555, 700, 880]) {
      const g = line([[0, 0, 0]]);
      warpGeometry(g, -s, world);
      const p = track.sample(s);
      const pos = g.attributes.position;
      expect(pos.getX(0)).toBeCloseTo(p.x, 3);
      expect(pos.getY(0)).toBeCloseTo(p.y, 3);
      expect(pos.getZ(0)).toBeCloseTo(p.z, 3);
    }
  });

  it('keeps heights relative to the road, so walls stay plumb', () => {
    const s = 420;
    const g = line([[3, 0, 0], [3, 5, 0]]);
    warpGeometry(g, -s, world);
    const pos = g.attributes.position;
    expect(pos.getY(1) - pos.getY(0)).toBeCloseTo(5, 3);
    expect(pos.getX(1)).toBeCloseTo(pos.getX(0), 4);
    expect(pos.getZ(1)).toBeCloseTo(pos.getZ(0), 4);
  });

  it('joins neighboring chunks without a seam', () => {
    for (const x of [-34, -12, -5, 0, 7, 20, 34]) {
      const a = line([[x, 0.18, -40]]);
      const b = line([[x, 0.18, 0]]);
      warpGeometry(a, -320, world);
      warpGeometry(b, -360, world);
      for (const axis of ['getX', 'getY', 'getZ'] as const) {
        expect(a.attributes.position[axis](0)).toBeCloseTo(b.attributes.position[axis](0), 4);
      }
    }
  });

  it('turns normals with the road and keeps them unit length on the ground', () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([20, 0, 0], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([1, 0, 0], 3));
    warpGeometry(g, -555, world);
    const p = track.sample(555);
    expect(g.attributes.normal.getX(0)).toBeCloseTo(Math.cos(p.heading), 4);
    expect(g.attributes.normal.getZ(0)).toBeCloseTo(Math.sin(p.heading), 4);

    const flat = line([[25, 0, 0]]);
    warpGeometry(flat, -555, world, { ground: true });
    const n = new THREE.Vector3().fromBufferAttribute(flat.attributes.normal as THREE.BufferAttribute, 0);
    expect(n.length()).toBeCloseTo(1, 4);
    expect(n.y).toBeGreaterThan(0.7);
  });

  it('finds the same ground the chunks are bent onto, so grass stands on it', () => {
    const spot = { x: 0, y: 0, z: 0 };
    for (const [x, s] of [[5, 120], [-9, 300], [14, 520], [-22, 700]] as const) {
      const g = line([[x, 0, 0]]);
      warpGeometry(g, -s, world);
      const p = g.attributes.position;
      surfaceAt(world, x, s, spot);
      expect(spot.x).toBeCloseTo(p.getX(0), 3);
      expect(spot.y).toBeCloseTo(p.getY(0), 3);
      expect(spot.z).toBeCloseTo(p.getZ(0), 3);
    }
  });

  it('updates bounds so chunks cull in their real place', () => {
    const g = line([[0, 0, 0], [0, 0, -40]]);
    g.computeBoundingSphere();
    const before = g.boundingSphere!.center.clone();
    warpGeometry(g, -520, world);
    expect(g.boundingSphere!.center.distanceTo(before)).toBeGreaterThan(100);
  });
});
