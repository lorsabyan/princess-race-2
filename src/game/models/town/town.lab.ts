import * as THREE from 'three';
import type { LabItem, LabItems } from '../../../lab/types';
import { worldUniforms } from '../kit/materials';
import { CHUNK_LENGTH, buildTownChunk, townStats } from './Town';
import { Bins } from './bins';
import { buildHouse, doorPrefab, flowerBoxPrefab, randomHouse, windowPrefab, type HouseSpec } from './houses';
import { binsDebug, prefabTriangles, type Prefab } from './bins';
import * as plants from './plants';
import { nanPrimitives, primCacheStats } from './prims';
import { groundTexture } from './ground';
import * as props from './props';
import { SCHEMES } from './look';
import { makeRng } from './rng';

const params = new URLSearchParams(location.search);
const num = (key: string, fallback: number): number => {
  const v = params.get(key);
  return v === null || v === '' || Number.isNaN(Number(v)) ? fallback : Number(v);
};

/** Lab-only: `curve=1` turns on the game's curved-world bend around the camera. */
function curveHook(): LabItem['update'] {
  if (params.get('curve') !== '1') return undefined;
  return () => {
    worldUniforms.uCurveY.value = 0.0016;
    worldUniforms.uCurveOrigin.value.set(0, 8);
  };
}

function street(): LabItem {
  townStats.enabled = params.get('stats') === '1';
  binsDebug.nan = params.get('nan') === '1';
  townStats.tris = {};
  const seed = num('seed', 7);
  const start = num('start', 0);
  const count = num('n', 4);
  const root = new THREE.Group();
  const lines: string[] = [];
  let tris = 0;
  if (params.get('warm') === '1') {
    const t0 = performance.now();
    groundTexture();
    lines.push(`texture ${(performance.now() - t0).toFixed(1)} ms`);
  }
  for (let i = 0; i < count; i += 1) {
    const t0 = performance.now();
    const chunk = buildTownChunk(start + i, seed, {
      clearLeft: params.get('clearLeft') === String(start + i),
      clearRight: params.get('clearRight') === String(start + i),
    });
    const ms = performance.now() - t0;
    // Lab shows chunks from local z = 0 regardless of the index.
    chunk.group.position.z = -i * CHUNK_LENGTH;
    let ct = 0;
    let calls = 0;
    chunk.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      calls += 1;
      ct += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    });
    tris += ct;
    lines.push(`chunk ${start + i} [${String(chunk.group.userData.archetype ?? '?')}]: ${Math.round(ct)} tris, ${calls} meshes, ${ms.toFixed(1)} ms`);
    root.add(chunk.group);
  }
  lines.push(`total ${Math.round(tris)} tris`);
  lines.push(`sdf meshing ${plants.sdfTiming.count} shapes ${plants.sdfTiming.ms.toFixed(1)} ms`);
  const bad = nanPrimitives();
  if (bad.length) lines.push(`NaN prims: ${bad.join(' | ')}`);
  if (townStats.enabled) {
    const entries = Object.entries(townStats.tris).sort((a, b) => b[1] - a[1]);
    lines.push(entries.map(([k, v]) => `${k}=${Math.round(v / count)}`).join(' '));
  }
  console.info(lines.join('\n'));
  return {
    object: root,
    ground: 'none',
    info: lines.join('\n'),
    update: curveHook(),
    view: { yaw: 0, pitch: 10, target: [0, 1.2, -14], dist: 22, fov: 52 },
  };
}

function houses(): LabItem {
  const rng = makeRng(num('seed', 3));
  const b = new Bins();
  const variants: Array<Partial<HouseSpec>> = [
    { roof: 'gableFront', roofStyle: 'scallop', floors: 2 },
    { roof: 'gableSide', roofStyle: 'courses', floors: 2, dormers: 2 },
    { roof: 'gableFront', roofStyle: 'puffy', floors: 1, bay: true },
    { roof: 'gableFront', roofStyle: 'courses', floors: 2, tower: 1 },
    { roof: 'gableFront', roofStyle: 'courses', floors: 3, bell: true, w: 5.2 },
    { roof: 'gableSide', roofStyle: 'puffy', floors: 2, balcony: true },
    { roof: 'hip', roofStyle: 'courses', floors: 2 },
    { roof: 'gableFront', roofStyle: 'courses', floors: 2, shop: { stripe: '#ff7f9f', sign: 'heart' } },
  ];
  let x = 0;
  const t0 = performance.now();
  variants.forEach((v, i) => {
    const spec = randomHouse(rng, SCHEMES[i % SCHEMES.length], 2, v);
    b.within({ p: [x + spec.w / 2, 0, 0] }, () => buildHouse(b, spec, rng));
    x += spec.w + 3.5;
  });
  const ms = performance.now() - t0;
  const root = new THREE.Group();
  for (const m of b.meshes('houses')) root.add(m);
  root.position.x = -x / 2;
  return { object: root, ground: 'grass', info: `${variants.length} houses, ${Math.round(b.triangles())} tris, ${ms.toFixed(1)} ms`, view: { yaw: 0, pitch: 12, target: [0, 3.5, 0], dist: 42, fov: 45 } };
}

function budget(): LabItem {
  const rows: Array<[string, number]> = [];
  const pf = (name: string, p: Prefab) => rows.push([name, Math.round(prefabTriangles(p))]);
  pf('window rect', windowPrefab({ style: 'rect', w: 0.86, h: 1.15, trim: '#fff', shutters: null }));
  pf('window rect+shut', windowPrefab({ style: 'rect', w: 0.86, h: 1.15, trim: '#fff', shutters: '#f00' }));
  pf('window arch', windowPrefab({ style: 'arch', w: 0.86, h: 1.3, trim: '#fff', shutters: null }));
  pf('window round', windowPrefab({ style: 'round', w: 0.9, h: 0.9, trim: '#fff', shutters: null }));
  pf('flowerbox', flowerBoxPrefab(1.06, ['#f00', '#0f0', '#00f'], '#fff', 0));
  for (const hood of ['none', 'gable', 'round', 'awning'] as const) pf(`door ${hood}`, doorPrefab(1.02, 2.02, '#f00', '#fff', hood, '#0f0', '#00f', 2));
  pf('lollipop', plants.lollipopTree(0));
  pf('lollipop2', plants.lollipopTree(1));
  pf('cloudTree', plants.cloudTree(0));
  pf('blossomTree', plants.blossomTree(0));
  pf('cypress', plants.cypress(0));
  pf('fir', plants.fir(0));
  pf('farTree', plants.farTree(0));
  pf('bush', plants.bush(0));
  pf('bush+flowers', plants.bush(0, 0, '#f00'));
  pf('hedge', plants.hedge(0));
  pf('topiary', plants.pottedTopiary(0));
  pf('crookLamp', props.crookLamp());
  pf('twinLamp', props.twinLamp());
  pf('fence2m', props.fenceSegment());
  pf('fencePost', props.fencePost());
  pf('gateArch', props.gateArch('#f00'));
  pf('bench', props.bench('#fff'));
  pf('mailbox', props.mailbox('#f0f'));
  pf('balloons4', props.balloons(1, 4));
  pf('planter', props.planter('#f00', 0));
  pf('roseArch', props.roseArch(6.55, 0));
  pf('fountain', props.fountain(0));
  pf('stall', props.marketStall('#f00', 'flowers', 0));
  pf('cart', props.flowerCart(0));
  pf('pole', props.buntingPole('#f00'));
  const measureHouse = (name: string, v: Partial<HouseSpec>, detail: 0 | 1 | 2) => {
    const b = new Bins();
    buildHouse(b, randomHouse(makeRng(5), SCHEMES[0], detail, v), makeRng(6));
    rows.push([name, Math.round(b.triangles())]);
  };
  measureHouse('house F courses 2fl', { roof: 'gableFront', roofStyle: 'courses', floors: 2, bay: false, balcony: false, shutters: null, flowerBoxes: false }, 2);
  measureHouse('house F scallop 2fl', { roof: 'gableFront', roofStyle: 'scallop', floors: 2, bay: false, balcony: false, shutters: null, flowerBoxes: false }, 2);
  measureHouse('house F puffy 2fl', { roof: 'gableFront', roofStyle: 'puffy', floors: 2, bay: false, balcony: false, shutters: null, flowerBoxes: false }, 2);
  measureHouse('house S courses 2fl dorm2', { roof: 'gableSide', roofStyle: 'courses', floors: 2, dormers: 2, bay: false, balcony: false, shutters: null, flowerBoxes: false }, 2);
  measureHouse('house F full', { roof: 'gableFront', roofStyle: 'scallop', floors: 2, bay: true, balcony: true, shutters: '#f00', flowerBoxes: true }, 2);
  measureHouse('house tower', { roof: 'gableFront', floors: 2, tower: 1 }, 2);
  measureHouse('house bell', { roof: 'gableFront', floors: 3, bell: true, w: 5.2 }, 2);
  measureHouse('house shop', { roof: 'gableFront', floors: 2, shop: { stripe: '#f00', sign: 'heart' } }, 2);
  measureHouse('back house', { roof: 'gableFront', floors: 2 }, 1);
  measureHouse('back house S', { roof: 'gableSide', floors: 2, dormers: 1 }, 1);
  measureHouse('back hip', { roof: 'hip', floors: 2 }, 1);
  return { object: new THREE.Group(), info: rows.map(([k, v]) => `${k}: ${v}`).join('\n') };
}

function propsShowcase(): LabItem {
  const b = new Bins();
  const put = (p: Prefab, x: number, z: number, yaw = 0, sc = 1) => b.stamp(p, { p: [x, 0, z], r: [0, yaw, 0], s: sc });
  // Row 1 (back): trees.
  const trees: Prefab[] = [
    plants.lollipopTree(0, 0),
    plants.lollipopTree(1, 1),
    plants.lollipopTree(2, 2, true),
    plants.cloudTree(0, 0),
    plants.blossomTree(0, 0),
    plants.blossomTree(1, 2),
    plants.cypress(0),
    plants.fir(0),
    plants.farTree(0),
    plants.farTree(1, true),
  ];
  trees.forEach((t, i) => put(t, -18 + i * 4, -6));
  // Row 2: lamps, fence, gate arch, hedge, bushes.
  put(props.crookLamp(), -18, 0);
  put(props.twinLamp(), -15, 0);
  for (let i = 0; i < 3; i += 1) put(props.fenceSegment(), -11 + i * 2, 0);
  for (let i = 0; i < 4; i += 1) put(props.fencePost(), -12 + i * 2, 0);
  put(props.gateArch('#ff5c86'), -4.9, 0);
  for (let i = 0; i < 2; i += 1) put(plants.hedge(i), -2 + i * 2, 0);
  put(plants.bush(0, 0), 2.5, 0);
  put(plants.bush(1, 1, '#ff5c86'), 4, 0);
  put(plants.farBush(0), 5.6, 0);
  put(plants.pottedTopiary(0), 7, 0);
  put(props.planter('#ffd84d', 0), 8.4, 0);
  put(props.birdhouse('#ff9fb8', '#5cc3b6'), 10, 0);
  put(props.signpost(0), 11.5, 0);
  put(props.mailbox('#7fb6f0'), 13, 0, -Math.PI / 2);
  put(props.bench('#ffc9d9'), 15, 0, -Math.PI / 2);
  put(props.balloons(2, 4), 17, 0);
  // Row 3 (front): beds, tulips, stall, cart, picnic, fountain.
  b.within({ p: [-16, 0, 5] }, () => plants.flowerBed(b, 2.4, 0.6, ['#ff5c86', '#ffd84d', '#ffffff'], 3));
  b.within({ p: [-12.5, 0, 5] }, () => plants.tulips(b, 12, 0.6, '#ff4f63', 4));
  put(props.marketStall('#ff7f9f', 'flowers', 0), -8, 5, -Math.PI / 2);
  put(props.marketStall('#5cc3b6', 'fruit', 1), -4.5, 5, -Math.PI / 2);
  put(props.flowerCart(0), -0.8, 5, -Math.PI / 2);
  put(props.picnic('#ff9fb8'), 2.2, 5);
  put(props.fountain(0), 7.5, 5.5);
  put(props.buntingPole('#ff7f9f'), 11.5, 5);
  put(props.buntingPole('#5cc3b6'), 18.5, 5);
  props.bunting(b, [11.5, 6.85, 5], [18.5, 6.85, 5], 0.6, ['#ff7f9f', '#ffffff', '#5cc3b6', '#ffb347', '#a98be6'], 'lab');
  // The rose arch spans the whole lineup at the back.
  put(props.roseArch(6.55, 0), 0, -12);
  const root = new THREE.Group();
  for (const m of b.meshes('props')) root.add(m);
  return { object: root, ground: 'grass', info: `${Math.round(b.triangles())} tris`, view: { yaw: 0, pitch: 17, target: [0, 1.6, -1], dist: 25, fov: 50 } };
}

/** Builds a whole 20-chunk level twice: first pass includes cache warm-up, second is steady state. */
function checksum(g: THREE.Group): string {
  let sum = 0;
  let count = 0;
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const a = m.geometry.attributes.position.array as ArrayLike<number>;
    for (let i = 0; i < a.length; i += 7) sum += a[i] * ((i % 13) + 1);
    count += a.length;
  });
  return `${count}:${sum.toFixed(3)}`;
}

function bench(): LabItem {
  const seed = num('seed', 7);
  const n = num('n', 20);
  const lines: string[] = [];
  // Determinism: chunk 5 built cold must match chunk 5 built after others.
  const cold = buildTownChunk(5, seed);
  const coldSum = checksum(cold.group);
  cold.dispose();
  for (let pass = 0; pass < 2; pass += 1) {
    const times: number[] = [];
    let maxTris = 0;
    let maxCalls = 0;
    for (let i = 0; i < n; i += 1) {
      const t0 = performance.now();
      const chunk = buildTownChunk(i, seed + pass * 1000);
      times.push(performance.now() - t0);
      let tris = 0;
      let calls = 0;
      chunk.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        calls += 1;
        tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
      });
      maxTris = Math.max(maxTris, tris);
      maxCalls = Math.max(maxCalls, calls);
      chunk.dispose();
    }
    const sorted = [...times].sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    lines.push(
      `pass ${pass}: first ${times[0].toFixed(1)} ms, avg ${avg.toFixed(1)} ms, median ${sorted[Math.floor(n / 2)].toFixed(1)} ms, max ${sorted[n - 1].toFixed(1)} ms, total ${times.reduce((a, b) => a + b, 0).toFixed(0)} ms; max tris ${Math.round(maxTris)}, max meshes ${maxCalls}`,
    );
  }
  const warm = buildTownChunk(5, seed);
  lines.push(`determinism chunk 5: ${coldSum === checksum(warm.group) ? 'OK' : `MISMATCH ${coldSum} vs ${checksum(warm.group)}`}`);
  warm.dispose();
  const pc = primCacheStats();
  lines.push(`primitive cache: ${pc.count} geometries, ${pc.vertices} vertices`);
  lines.push(Object.entries(pc.families).sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => `${k}=${v}`).join(' '));
  return { object: new THREE.Group(), info: lines.join('\n') };
}

export const items: LabItems = {
  'town-bench': () => bench(),
  'town-props': () => propsShowcase(),
  'town-budget': () => budget(),
  'town-houses': () => houses(),
  'town-street': () => street(),
  'town-aerial': () => ({ ...street(), view: { yaw: 28, pitch: 48, target: [0, 0, -62], dist: 100, fov: 45 } }),
};
