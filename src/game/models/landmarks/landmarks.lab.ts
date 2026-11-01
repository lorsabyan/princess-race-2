import * as THREE from 'three';
import type { LabItems } from '../../../lab/types';
import { PartBuilder } from '../kit/geo';
import { worldUniforms } from '../kit/materials';

/** ?curve=1 previews the game's curved-world bend (origin ?co=z, strength ?cy=, default 0.0016). */
function curvePreview(): void {
  const q = new URLSearchParams(location.search);
  if (q.get('curve') !== '1') return;
  worldUniforms.uCurveY.value = Number(q.get('cy') ?? 0.0016);
  worldUniforms.uCurveOrigin.value.set(0, Number(q.get('co') ?? 0));
}
import { createCastleGate } from './castleGate';
import { createPrincessHome } from './princessHome';
import { createBackdrop } from './backdrop';

/** ?prof=1 : attribute merged triangles to call sites in landmark files (dev only). */
function withProfiler<T>(fn: () => T): T {
  if (!new URLSearchParams(location.search).has('prof')) return fn();
  const proto = PartBuilder.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  const origAdd = proto.add;
  const origColored = proto.addColored;
  const tally = new Map<string, number>();
  const site = () => {
    const lines = (new Error().stack ?? '').split('\n').filter((l) => l.includes('/landmarks/') && !l.includes('landmarks.lab'));
    const pick = lines.find((l) => !l.includes('/kit.ts')) ?? lines[0] ?? '?';
    const kitLine = lines.find((l) => l.includes('/kit.ts'));
    const m = pick.match(/landmarks\/(\w+)\.ts[^:]*:(\d+)/);
    const k = kitLine?.match(/at (\w+)/)?.[1];
    return `${m ? `${m[1]}:${m[2]}` : pick.trim()}${k ? ` via ${k}` : ''}`;
  };
  const count = (g: { index: { count: number } | null; attributes: { position: { count: number } } }) => (g.index ? g.index.count : g.attributes.position.count) / 3;
  proto.add = function (this: PartBuilder, ...args: unknown[]) {
    const key = site();
    tally.set(key, (tally.get(key) ?? 0) + count(args[0] as never));
    return origAdd.apply(this, args);
  };
  proto.addColored = function (this: PartBuilder, ...args: unknown[]) {
    const key = site();
    tally.set(key, (tally.get(key) ?? 0) + count(args[0] as never));
    return origColored.apply(this, args);
  };
  try {
    return fn();
  } finally {
    proto.add = origAdd;
    proto.addColored = origColored;
    const rows = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
    console.warn(`PROFILE total=${Math.round([...tally.values()].reduce((a, b) => a + b, 0))}\n` + rows.map(([k, v]) => `${Math.round(v)}\t${k}`).join('\n'));
  }
}

export const items: LabItems = {
  'castle-gate': () => {
    const t0 = performance.now();
    const castle = withProfiler(() => createCastleGate());
    const ms = performance.now() - t0;
    return {
      object: castle.group,
      update: (dt, time) => {
        curvePreview();
        castle.update(dt, time);
      },
      ground: 'road',
      view: { target: [0, 7, 0], dist: 45, yaw: 0, pitch: 6 },
      info: `castle build ${Math.round(ms)}ms`,
    };
  },
  'princess-home': () => {
    const t0 = performance.now();
    const home = withProfiler(() => createPrincessHome());
    const ms = performance.now() - t0;
    return {
      object: home.group,
      update: (dt, time) => {
        curvePreview();
        home.update(dt, time);
      },
      ground: 'road',
      view: { target: [-13, 4, 0], dist: 34, yaw: 40, pitch: 16 },
      info: `home build ${Math.round(ms)}ms  door ${home.doorPosition.toArray().map((v) => v.toFixed(2)).join(',')}  path ${home.pathPoints.length} pts`,
    };
  },
  backdrop: () => {
    const bd = createBackdrop();
    return {
      object: bd.group,
      ground: 'grass',
      // Camera at y~3.6 looking down the road (-Z).
      view: { target: [0, 3.6, -30], dist: 30, yaw: 0, pitch: 0, fov: 52 },
      info: 'backdrop: hills + tree clusters + distant castle',
    };
  },
  'princess-home-path': () => {
    // Debug: door (gold) + walk path (pink) markers over the home.
    const home = createPrincessHome();
    const root = new THREE.Group();
    root.add(home.group);
    const dot = new THREE.SphereGeometry(0.18, 12, 8);
    const doorMat = new THREE.MeshBasicMaterial({ color: '#ffd46b' });
    const pathMat = new THREE.MeshBasicMaterial({ color: '#ff3d8b' });
    const door = new THREE.Mesh(dot, doorMat);
    door.position.copy(home.doorPosition).add(new THREE.Vector3(0, 0.3, 0));
    root.add(door);
    for (const p of home.pathPoints) {
      const m = new THREE.Mesh(dot, pathMat);
      m.position.copy(p).add(new THREE.Vector3(0, 0.2, 0));
      root.add(m);
    }
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(home.pathPoints.map((p) => p.clone().add(new THREE.Vector3(0, 0.2, 0)))),
      new THREE.LineBasicMaterial({ color: '#ff3d8b' }),
    );
    root.add(line);
    return {
      object: root,
      update: (dt, time) => home.update(dt, time),
      ground: 'road',
      view: { target: [-8, 0, 0], dist: 22, yaw: 90, pitch: 55 },
    };
  },
};
