import type * as THREE from 'three';
import type { Landscape } from '../sim/landscape';
import { bendLateral, newRoadPoint, type Track, type WorldPoint } from '../sim/track';

export interface RoadWorld {
  track: Track;
  land: Landscape;
}

export interface WarpOptions {
  /** Ground surfaces take their normals from the land they lie on (objects keep theirs). */
  ground?: boolean;
}

const p = newRoadPoint();

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Bend a finished, straight chunk onto the road, once, at level load. `zOffset`
 * is the chunk's straight z (its local z = 0). Heights follow the road close in
 * and the land further out, so walls stay plumb and everything sits on the same
 * surface. After this the geometry is plain world-space data: shadows, lighting
 * and culling all just work.
 */
export function warpGeometry(geometry: THREE.BufferGeometry, zOffset: number, world: RoadWorld, opts: WarpOptions = {}): void {
  const { track, land } = world;
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const nor = geometry.attributes.normal as THREE.BufferAttribute | undefined;
  const positions = pos.array as Float32Array;
  const normals = nor?.array as Float32Array | undefined;
  for (let i = 0; i < pos.count; i += 1) {
    const o = i * 3;
    const x = positions[o];
    const y = positions[o + 1];
    const s = -(positions[o + 2] + zOffset);
    track.sample(s, p);
    const sin = Math.sin(p.heading);
    const cos = Math.cos(p.heading);
    const lateral = bendLateral(x, p.curvature);
    const wx = p.x + cos * lateral;
    const wz = p.z + sin * lateral;
    const onLand = smoothstep(6.3, 11, Math.abs(x));
    const base = onLand > 0 ? p.y + (land.heightAt(wx, wz) - p.y) * onLand : p.y;
    positions[o] = wx;
    positions[o + 1] = base + y;
    positions[o + 2] = wz;
    if (!normals) continue;
    const a = normals[o];
    const b = normals[o + 1];
    const c = normals[o + 2];
    let nx = a * cos - c * sin;
    let ny = b;
    let nz = a * sin + c * cos;
    if (opts.ground) {
      // Tilt by the slope of the surface under this vertex.
      const e = 1.5;
      const hx0 = land.heightAt(wx - e, wz);
      const hx1 = land.heightAt(wx + e, wz);
      const hz0 = land.heightAt(wx, wz - e);
      const hz1 = land.heightAt(wx, wz + e);
      const gx = ((hx1 - hx0) / (2 * e)) * onLand;
      const gz = ((hz1 - hz0) / (2 * e)) * onLand;
      // Road pitch applies close in, where the land lookup is faded out.
      const pitchX = sin * p.grade * (1 - onLand);
      const pitchZ = -cos * p.grade * (1 - onLand);
      nx -= (gx + pitchX) * ny;
      nz -= (gz + pitchZ) * ny;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
    }
    normals[o] = nx;
    normals[o + 1] = ny;
    normals[o + 2] = nz;
  }
  pos.needsUpdate = true;
  if (nor) nor.needsUpdate = true;
  geometry.boundingBox = null;
  geometry.boundingSphere = null;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

/** Where the ground lies at road coordinates (x across, s along): the surface chunks are bent onto. */
export function surfaceAt(world: RoadWorld, x: number, s: number, out: WorldPoint): WorldPoint {
  const { track, land } = world;
  track.sample(s, p);
  const lateral = bendLateral(x, p.curvature);
  out.x = p.x + Math.cos(p.heading) * lateral;
  out.z = p.z + Math.sin(p.heading) * lateral;
  const onLand = smoothstep(6.3, 11, Math.abs(x));
  out.y = onLand > 0 ? p.y + (land.heightAt(out.x, out.z) - p.y) * onLand : p.y;
  return out;
}

/** Bend every mesh in a straight chunk. `zOffset` is the chunk's straight z. */
export function warpChunk(group: THREE.Object3D, zOffset: number, world: RoadWorld): void {
  group.position.set(0, 0, 0);
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) warpGeometry(mesh.geometry, zOffset, world, { ground: mesh.name.endsWith('-ground') });
  });
  group.updateMatrixWorld(true);
}
