/**
 * Minimal stand-ins that satisfy the model contracts, used until (or if) a real
 * model module is unavailable. Deliberately plain.
 */
import * as THREE from 'three';
import { PAL } from './kit/palette';
import { curved, mat } from './kit/materials';
import { PartBuilder, rbox, sphere, torus, cyl, cone } from './kit/geo';
import type {
  Backdrop,
  CarRig,
  Landmark,
  ModelLibrary,
  ObstacleKind,
  ObstacleRig,
  PrincessHome,
  PrincessRig,
  TownChunk,
  TownChunkOptions, ScenicRig } from './contracts';

function box(w: number, h: number, d: number, color: string, y = h / 2): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color }));
  m.position.y = y;
  m.castShadow = true;
  return m;
}

export function createCar(): CarRig {
  const root = new THREE.Group();
  root.add(box(1.9, 0.7, 3.4, PAL.carPaint, 0.6));
  const seat = new THREE.Object3D();
  seat.position.set(0, 0.62, 0.25);
  root.add(seat);
  const steeringWheel = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 8, 20), new THREE.MeshStandardMaterial({ color: '#fff' }));
  steeringWheel.position.set(0, 0.42, -0.52);
  seat.add(steeringWheel);
  return {
    root,
    seat,
    steeringWheel,
    update: (_dt, s) => {
      steeringWheel.rotation.z = -s.steer * 1.2;
    },
    setPaint: () => {},
    dispose: () => {},
  };
}

export function createPrincess(): PrincessRig {
  const root = new THREE.Group();
  const body = box(0.45, 0.6, 0.35, PAL.dress, 0.3);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 20, 14), new THREE.MeshStandardMaterial({ color: PAL.skin }));
  head.position.y = 0.9;
  root.add(body, head);
  return {
    root,
    standHeight: 0.5,
    setPose: () => {},
    setMood: () => {},
    wave: () => {},
    cheer: () => {},
    update: () => {},
    dispose: () => {},
  };
}

export const CHUNK_LENGTH = 40;

export function buildTownChunk(index: number, _seed: number, opts: TownChunkOptions = {}): TownChunk {
  const group = new THREE.Group();
  const b = new PartBuilder();
  b.add(rbox(8.6, 0.1, CHUNK_LENGTH, 0.02), PAL.road, { p: [0, -0.05, -CHUNK_LENGTH / 2] });
  for (const side of [-1, 1]) {
    b.add(rbox(1.9, 0.18, CHUNK_LENGTH, 0.05), PAL.sidewalk, { p: [side * 5.25, 0.02, -CHUNK_LENGTH / 2] });
    b.add(rbox(54, 0.1, CHUNK_LENGTH, 0.02), PAL.grass, { p: [side * 33.2, -0.06, -CHUNK_LENGTH / 2] });
    const cleared = side < 0 ? opts.clearLeft : opts.clearRight;
    if (cleared) continue;
    for (let i = 0; i < 3; i += 1) {
      const z = -6 - i * 13 - (index % 3);
      b.add(rbox(5, 5, 5, 0.3), PAL.wallBlush, { p: [side * 13, 2.5, z] });
      b.add(cone(4, 2.5, 4), PAL.roofBerry, { p: [side * 13, 6.2, z], r: [0, Math.PI / 4, 0] });
      b.add(cyl(0.15, 0.18, 2, 8), PAL.trunk, { p: [side * 8, 1, z - 5] });
      b.add(sphere(1.2, 12, 8), PAL.leaf, { p: [side * 8, 2.6, z - 5] });
    }
  }
  const mesh = new THREE.Mesh(b.build()!, mat('matte'));
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  group.add(mesh);
  return { group, dispose: () => mesh.geometry.dispose() };
}

let coinGeo: THREE.BufferGeometry | null = null;
export function createCoinGeometry(): THREE.BufferGeometry {
  if (!coinGeo) {
    const b = new PartBuilder();
    b.add(cyl(0.46, 0.46, 0.14, 24), PAL.coin, { r: [Math.PI / 2, 0, 0] });
    b.add(torus(0.42, 0.05, 8, 24), PAL.coinDeep);
    coinGeo = b.build()!;
  }
  return coinGeo;
}

export function coinMaterial(): THREE.Material {
  return mat('metal');
}

export function createHeartGemGeometry(): THREE.BufferGeometry {
  const b = new PartBuilder();
  b.add(new THREE.OctahedronGeometry(0.5, 0), PAL.heartGem, { flat: true });
  return b.build()!;
}

let gemMat: THREE.Material | null = null;
export function heartGemMaterial(): THREE.Material {
  gemMat ??= curved(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.1, clearcoat: 1 }));
  return gemMat;
}

export function createObstacle(kind: ObstacleKind): ObstacleRig {
  const root = new THREE.Group();
  const colors: Record<ObstacleKind, string> = { cones: PAL.cone, ducks: PAL.duck, cart: PAL.cart, puddle: PAL.flowerBlue, sheep: PAL.curb, mushrooms: PAL.flowerRed };
  const sizes: Record<ObstacleKind, [number, number, number]> = {
    cones: [2, 0.9, 1],
    ducks: [1.8, 0.6, 1],
    cart: [2.2, 1.6, 1.6],
    puddle: [2.4, 0.04, 2],
    sheep: [2, 0.9, 1.2],
    mushrooms: [2, 1.2, 1.4],
  };
  const [w, h, d] = sizes[kind];
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), curved(new THREE.MeshStandardMaterial({ color: colors[kind] })));
  m.position.y = h / 2;
  m.castShadow = true;
  root.add(m);
  return {
    root,
    kind,
    halfWidth: w / 2,
    halfDepth: d / 2,
    update: () => {},
    react: () => {},
    reset: () => {},
    dispose: () => m.geometry.dispose(),
  };
}

function landmark(build: (g: THREE.Group) => void): Landmark {
  const group = new THREE.Group();
  build(group);
  return { group, update: () => {}, dispose: () => {} };
}

export function createCastleGate(): Landmark {
  return landmark((g) => {
    for (const x of [-7, 7]) {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.3, 12, 16), mat('matte'));
      tower.position.set(x, 6, -2);
      g.add(tower);
    }
  });
}

export function createPrincessHome(): PrincessHome {
  const base = landmark((g) => {
    const house = box(10, 7, 9, PAL.wallBlush);
    house.position.set(-17, 3.5, -2);
    g.add(house);
  });
  return {
    ...base,
    doorPosition: new THREE.Vector3(-12, 0, -2),
    pathPoints: [new THREE.Vector3(-12, 0, -2), new THREE.Vector3(-6, 0, -1), new THREE.Vector3(-1.6, 0, 0)],
  };
}

export function createBackdrop(): Backdrop {
  const group = new THREE.Group();
  return { group, update: () => {}, dispose: () => {} };
}

function buildCountryChunk(index: number, seed: number): TownChunk {
  return buildTownChunk(index, seed);
}

function createScenicRig(): ScenicRig {
  return { group: new THREE.Group(), update: () => {}, dispose: () => {} };
}

export const placeholderLibrary: ModelLibrary = {
  chunkLength: CHUNK_LENGTH,
  createCar,
  createPrincess,
  buildTownChunk,
  buildCountryChunk,
  createScenicRig,
  createCoinGeometry,
  createFarCoinGeometry: createCoinGeometry,
  coinMaterial,
  createHeartGemGeometry,
  heartGemMaterial,
  createObstacle,
  createCastleGate,
  createPrincessHome,
  createBackdrop,
};
