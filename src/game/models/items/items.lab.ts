import * as THREE from 'three';
import type { LabItem, LabItems, LabView } from '../../../lab/types';
import { createObstacle, type ObstacleKind, type ObstacleRig } from './obstacles';
import { createCoinGeometry, coinMaterial } from './coin';
import { createHeartGemGeometry, heartGemMaterial } from './heartGem';
import { itemEnvMap, itemMaterial, ItemBuilder } from './surface';
import { sphere } from '../kit/geo';
import { worldUniforms } from '../kit/materials';

/**
 * Lab items for pickups and obstacles.
 *
 *   coin, coin-closeup (cy=yaw deg), heart-gem, obstacle-{cones,ducks,cart,puddle}
 *   items-lineup: everything on a road from the chase camera.
 *
 * Obstacles: seed=N picks the variant; animated they get bumped every `every` s.
 * Frozen (anim=0&t=T) replays deterministically from reset to T with a bump at
 * `hit` seconds (side=±1), so reaction poses can be screenshotted.
 */

const params = new URLSearchParams(location.search);
const frozen = params.get('anim') === '0';
const num = (key: string, fallback: number) => {
  const v = params.get(key);
  return v === null || v === '' || Number.isNaN(Number(v)) ? fallback : Number(v);
};

interface Spinner {
  mesh: THREE.InstancedMesh;
  update: (t: number) => void;
}

/** Instanced pickups the way the game uses them: spin around Y + gentle bob. */
function spinners(
  positions: Array<[number, number, number]>,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  opts: { spin?: number; bob?: number; yaw?: number } = {},
): Spinner {
  const spin = opts.spin ?? 2.4;
  const bob = opts.bob ?? 0.06;
  const mesh = new THREE.InstancedMesh(geometry, material, positions.length);
  mesh.name = 'pickups';
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  const e = new THREE.Euler();
  const update = (t: number) => {
    positions.forEach((pos, i) => {
      p.set(pos[0], pos[1] + Math.sin(t * 2.2 + i * 0.7) * bob, pos[2]);
      q.setFromEuler(e.set(0, (opts.yaw ?? 0) + t * spin + i * 0.45, 0));
      mesh.setMatrixAt(i, m.compose(p, q, s));
    });
    mesh.instanceMatrix.needsUpdate = true;
  };
  update(0);
  mesh.computeBoundingSphere();
  return { mesh, update };
}

/**
 * drift=1 slides obstacle roots sideways exactly like the game does
 * (x = x0 + 0.8·sin(0.55·t)) and passes the lateral velocity as `driftX`.
 */
const driftOn = params.get('drift') === '1';
const DRIFT_AMP = 0.8;
const DRIFT_SPEED = 0.55;

function step(rig: ObstacleRig, x0: number, dt: number, t: number): void {
  if (!driftOn) {
    rig.update(dt, t);
    return;
  }
  rig.root.position.x = x0 + DRIFT_AMP * Math.sin(DRIFT_SPEED * t);
  rig.update(dt, t, DRIFT_AMP * DRIFT_SPEED * Math.cos(DRIFT_SPEED * t));
}

/** Replays a rig from reset to time t (fixed steps), bumping it at `hitAt`. */
function replay(rig: ObstacleRig, x0: number, t: number, hitAt: number, side: 1 | -1): void {
  rig.reset();
  const dt = 1 / 60;
  let hit = false;
  for (let s = 0; s <= t; s += dt) {
    if (!hit && hitAt >= 0 && s >= hitAt) {
      rig.react(side);
      hit = true;
    }
    step(rig, x0, dt, s);
  }
}

function obstacleItem(kind: ObstacleKind, view: LabView): () => LabItem {
  return () => {
    const rig = createObstacle(kind, num('seed', 0));
    const root = new THREE.Group();
    root.add(rig.root);
    const every = num('every', 4);
    const hitAt = num('hit', -1);
    const side = (num('side', 1) >= 0 ? 1 : -1) as 1 | -1;
    let lastHit = -1;
    let replayed = false;
    let hits = 0;
    return {
      object: root,
      view,
      ground: 'road',
      info: `footprint ${rig.halfWidth} x ${rig.halfDepth}`,
      update: (dt, t) => {
        if (dt === 0) {
          if (!replayed) replay(rig, 0, t, hitAt, side);
          replayed = true;
          return;
        }
        const slot = Math.floor(t / every);
        if (every > 0 && slot !== lastHit && t % every > every * 0.5) {
          lastHit = slot;
          rig.react(hits % 2 === 0 ? side : (-side as 1 | -1));
          hits += 1;
        }
        step(rig, 0, dt, t);
      },
    };
  };
}

export const items: LabItems = {
  coin: () => {
    const c = spinners([[0, 1, 0]], createCoinGeometry(), coinMaterial(), { yaw: THREE.MathUtils.degToRad(num('cy', 20)) });
    const root = new THREE.Group();
    root.add(c.mesh);
    return { object: root, update: (_dt, t) => c.update(t), view: { target: [0, 1, 0], dist: 3.2, yaw: 0, pitch: 12, fov: 40 }, ground: 'road' };
  },
  'coin-closeup': () => {
    const c = spinners([[0, 1, 0]], createCoinGeometry(), coinMaterial(), {
      spin: frozen ? 0 : 0.6,
      bob: 0,
      yaw: THREE.MathUtils.degToRad(num('cy', 28)),
    });
    const root = new THREE.Group();
    root.add(c.mesh);
    return { object: root, update: (_dt, t) => c.update(t), view: { target: [0, 1, 0], dist: 1.9, yaw: 0, pitch: 8, fov: 40 }, ground: 'road' };
  },
  'heart-gem': () => {
    const c = spinners([[0, 1.1, 0]], createHeartGemGeometry(), heartGemMaterial(), {
      spin: frozen ? 0 : 1.6,
      yaw: THREE.MathUtils.degToRad(num('cy', 22)),
    });
    const root = new THREE.Group();
    root.add(c.mesh);
    return { object: root, update: (_dt, t) => c.update(t), view: { target: [0, 1.1, 0], dist: 2.6, yaw: 0, pitch: 10, fov: 40 }, ground: 'road' };
  },
  'obstacle-cones': obstacleItem('cones', { target: [0, 0.45, 0], dist: 4.2, yaw: 18, pitch: 18, fov: 40 }),
  'obstacle-ducks': obstacleItem('ducks', { target: [0, 0.3, 0], dist: 3.4, yaw: 12, pitch: 16, fov: 40 }),
  'obstacle-cart': obstacleItem('cart', { target: [0, 0.95, 0], dist: 5.2, yaw: 16, pitch: 16, fov: 40 }),
  'obstacle-puddle': obstacleItem('puddle', { target: [0, 0.1, 0], dist: 4.6, yaw: 8, pitch: 24, fov: 40 }),
  'items-lineup': () => {
    const root = new THREE.Group();
    const coinPos: Array<[number, number, number]> = [];
    for (let i = 0; i < 11; i += 1) coinPos.push([-1.9, 1.0, -1 - i * 2.2]);
    for (let i = 0; i < 7; i += 1) coinPos.push([1.9, 1.0, -27 - i * 2.2]);
    for (let i = 0; i < 4; i += 1) coinPos.push([0, 1.0, -46 - i * 2.2]);
    const coinRow = spinners(coinPos, createCoinGeometry(), coinMaterial());
    const gems = spinners([[0.1, 1.1, -3.6]], createHeartGemGeometry(), heartGemMaterial(), { spin: 1.6 });
    root.add(coinRow.mesh, gems.mesh);
    const layout: Array<{ kind: ObstacleKind; seed: number; p: [number, number] }> = [
      { kind: 'cones', seed: 0, p: [2.1, -7] },
      { kind: 'ducks', seed: 0, p: [-0.3, -12.5] },
      { kind: 'cart', seed: 0, p: [2.3, -18.5] },
      { kind: 'puddle', seed: 0, p: [-1.7, -25] },
      { kind: 'cones', seed: 1, p: [-1.6, -32] },
      { kind: 'ducks', seed: 3, p: [1.6, -38] },
      { kind: 'cart', seed: 1, p: [-2.2, -44] },
    ];
    const rigs = layout.map(({ kind, seed, p }) => {
      const rig = createObstacle(kind, seed);
      rig.root.position.set(p[0], 0, p[1]);
      root.add(rig.root);
      return rig;
    });
    let replayed = false;
    if (params.get('curve') === '1') {
      // Re-enable the game's curved world (the lab disables it) to check every material bends.
      worldUniforms.uCurveY.value = 0.0016;
      worldUniforms.uCurveOrigin.value.set(0, 5.5);
    }
    return {
      object: root,
      ground: 'road',
      view: { target: [0, 1, -8], dist: 14, yaw: 0, pitch: 16, fov: 52 },
      update: (dt, t) => {
        coinRow.update(t);
        gems.update(t);
        if (dt === 0) {
          if (!replayed) rigs.forEach((rig, i) => replay(rig, layout[i].p[0], t, -1, 1));
          replayed = true;
          return;
        }
        rigs.forEach((rig, i) => step(rig, layout[i].p[0], dt, t));
      },
    };
  },
  /** Pooling stress test: 24 live rigs, 4 disposed + recreated every second. */
  'obstacle-pool': () => {
    const kinds: ObstacleKind[] = ['cones', 'ducks', 'cart', 'puddle'];
    const root = new THREE.Group();
    const timings: string[] = [];
    for (const kind of kinds) {
      let t0 = performance.now();
      createObstacle(kind, 99).dispose();
      const cold = performance.now() - t0;
      t0 = performance.now();
      for (let i = 0; i < 20; i += 1) createObstacle(kind, i).dispose();
      timings.push(`${kind}: cold ${cold.toFixed(1)}ms, warm ${((performance.now() - t0) / 20).toFixed(2)}ms`);
    }
    const slots: ObstacleRig[] = [];
    let seed = 0;
    const place = (i: number) => {
      const rig = createObstacle(kinds[i % 4], seed++);
      rig.root.position.set((i % 4) * 3.2 - 4.8, 0, -Math.floor(i / 4) * 3.2);
      root.add(rig.root);
      slots[i] = rig;
    };
    for (let i = 0; i < 24; i += 1) place(i);
    let last = 0;
    return {
      object: root,
      ground: 'road',
      info: timings.join('\n'),
      view: { target: [0, 0.5, -8], dist: 18, yaw: 0, pitch: 30, fov: 52 },
      update: (dt, t) => {
        if (dt > 0 && Math.floor(t) !== last) {
          last = Math.floor(t);
          for (let k = 0; k < 4; k += 1) {
            const i = (last * 7 + k * 5) % 24;
            slots[i].dispose();
            place(i);
            slots[(i + 3) % 24].react(k % 2 === 0 ? 1 : -1);
          }
        }
        for (const rig of slots) rig.update(dt, t);
      },
    };
  },
  /** Debug: chrome + gold spheres showing the jewelry studio environment. */
  'items-env-probe': () => {
    const b = new ItemBuilder();
    b.add(sphere(0.5, 48, 32), '#ffffff', { r: 0.02, m: 1 }, { p: [-0.65, 1, 0] });
    b.add(sphere(0.5, 48, 32), '#ffd35e', { r: 0.2, m: 1 }, { p: [0.65, 1, 0] });
    const mesh = new THREE.Mesh(b.build(), itemMaterial('env-probe', { envMap: itemEnvMap() }));
    const root = new THREE.Group();
    root.add(mesh);
    return { object: root, view: { target: [0, 1, 0], dist: 4, yaw: 0, pitch: 10 }, ground: 'road' };
  },
};
