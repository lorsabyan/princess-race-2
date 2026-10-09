import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Stage } from '../game/view/Stage';
import { Sky } from '../game/view/Sky';
import { Lighting, SUN_DIR } from '../game/view/Lighting';
import { PAL } from '../game/models/kit/palette';
import { worldUniforms } from '../game/models/kit/materials';
import type { LabItem, LabItems } from './types';

/**
 * Model lab: renders any registered model with the game's real lighting and
 * post-processing. Register items in any `src/**\/*.lab.ts` file:
 *
 *   export const items: LabItems = { car: () => ({ object: createCar().root }) };
 *
 * URL params: m=name[,name2] yaw pitch dist fov tx ty tz ground=grass|road|none
 *             anim=0 (freeze) t=seconds (time offset) q=high|medium|low gap=spacing
 */
const modules = import.meta.glob<{ items: LabItems }>('../**/*.lab.ts');

declare global {
  interface Window {
    __ready?: boolean;
    __labStats?: Record<string, unknown>;
  }
}

const params = new URLSearchParams(location.search);
const num = (key: string, fallback: number) => {
  const v = params.get(key);
  return v === null || v === '' || Number.isNaN(Number(v)) ? fallback : Number(v);
};

async function loadRegistry(): Promise<LabItems> {
  const registry: LabItems = {};
  for (const [path, load] of Object.entries(modules)) {
    try {
      const mod = await load();
      Object.assign(registry, mod.items);
    } catch (error) {
      console.error(`Lab module failed: ${path}`, error);
    }
  }
  return registry;
}

function makeGround(kind: 'grass' | 'road' | 'none', scene: THREE.Scene): void {
  if (kind === 'none') return;
  const grassTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(128, 128, 20, 128, 128, 128);
    grad.addColorStop(0, PAL.grass);
    grad.addColorStop(0.7, PAL.grass);
    grad.addColorStop(1, PAL.grassDeep);
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const grass = new THREE.Mesh(
    new THREE.CircleGeometry(80, 64),
    new THREE.MeshStandardMaterial({ map: grassTex, roughness: 0.95 }),
  );
  grass.rotation.x = -Math.PI / 2;
  grass.receiveShadow = true;
  scene.add(grass);
  if (kind === 'road') {
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(8.6, 160),
      new THREE.MeshStandardMaterial({ color: PAL.road, roughness: 0.8 }),
    );
    road.rotation.x = -Math.PI / 2;
    road.position.y = 0.01;
    road.receiveShadow = true;
    scene.add(road);
  }
}

function countTriangles(root: THREE.Object3D): { meshes: number; triangles: number; materials: number } {
  let meshes = 0;
  let triangles = 0;
  const mats = new Set<THREE.Material>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshes += 1;
    const g = mesh.geometry;
    const count = g.index ? g.index.count : g.attributes.position.count;
    const instances = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1;
    triangles += (count / 3) * instances;
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => mats.add(m));
  });
  return { meshes, triangles: Math.round(triangles), materials: mats.size };
}

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
  const info = document.querySelector<HTMLDivElement>('#lab-info')!;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(num('fov', 40), 1, 0.1, 900);
  const stage = new Stage(canvas, scene, camera);
  stage.adaptive = false;

  const sky = new Sky({ sunDir: SUN_DIR });
  scene.add(sky.group);
  scene.environment = Sky.bakeEnvironment(stage.renderer, SUN_DIR);
  scene.environmentIntensity = 0.8;
  scene.fog = new THREE.Fog(PAL.skyHorizon, 90, 260);
  const lighting = new Lighting(scene);
  stage.shadowLights.push(lighting.sun);
  lighting.follow(new THREE.Vector3(0, 0, 0));
  // The lab has no curved world.
  worldUniforms.uCurveY.value = 0;
  worldUniforms.uCurveOrigin.value = 1e6;

  const registry = await loadRegistry();
  const names = (params.get('m') ?? '').split(',').filter(Boolean);
  const chosen = names.length ? names : Object.keys(registry).slice(0, 1);
  const gap = num('gap', 4);
  const items: LabItem[] = [];
  for (const [i, name] of chosen.entries()) {
    const factory = registry[name];
    if (!factory) {
      console.error(`Unknown lab item "${name}". Available: ${Object.keys(registry).join(', ')}`);
      continue;
    }
    const item = await factory();
    item.object.position.x += (i - (chosen.length - 1) / 2) * gap;
    scene.add(item.object);
    items.push(item);
  }
  makeGround((params.get('ground') as LabItem['ground']) ?? items[0]?.ground ?? 'grass', scene);

  const view = items[0]?.view ?? {};
  const target = new THREE.Vector3(
    num('tx', view.target?.[0] ?? 0),
    num('ty', view.target?.[1] ?? 0.8),
    num('tz', view.target?.[2] ?? 0),
  );
  const dist = num('dist', view.dist ?? 7);
  const yaw = THREE.MathUtils.degToRad(num('yaw', view.yaw ?? 30));
  const pitch = THREE.MathUtils.degToRad(num('pitch', view.pitch ?? 18));
  camera.fov = num('fov', view.fov ?? 40);
  camera.position.set(
    target.x + Math.sin(yaw) * Math.cos(pitch) * dist,
    target.y + Math.sin(pitch) * dist,
    target.z + Math.cos(yaw) * Math.cos(pitch) * dist,
  );
  camera.lookAt(target);
  camera.updateProjectionMatrix();

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.update();

  const animate = params.get('anim') !== '0';
  const timeOffset = num('t', 0);
  const timer = new THREE.Timer();
  timer.connect(document);
  let frames = 0;
  const stats = items.map((it) => countTriangles(it.object));

  const tick = (now: number) => {
    timer.update(now);
    const dt = Math.min(timer.getDelta(), 0.05);
    const time = animate ? timer.getElapsed() + timeOffset : timeOffset;
    worldUniforms.uTime.value = time;
    for (const item of items) item.update?.(animate ? dt : 0, time);
    controls.update();
    sky.update(camera, time);
    stage.render(dt);
    frames += 1;
    if (frames === 6) {
      const s = stage.stats();
      window.__labStats = { items: chosen, perItem: stats, renderer: s };
      info.textContent =
        `${chosen.join(', ')}\n` +
        stats.map((st, i) => `${chosen[i]}: ${st.meshes} meshes, ${st.triangles} tris, ${st.materials} mats`).join('\n') +
        `\ncalls ${s.calls}  tris ${s.triangles}  tier ${s.tier}` +
        (items.map((it) => it.info).filter(Boolean).length ? `\n${items.map((it) => it.info ?? '').join('\n')}` : '') +
        `\navailable: ${Object.keys(registry).join(', ')}`;
      window.__ready = true;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

main().catch((error) => {
  console.error(error);
  document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;top:0;left:0;color:red">${String(error)}</pre>`);
});
