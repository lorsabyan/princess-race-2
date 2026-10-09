import * as THREE from 'three';
import type { LabItem, LabItems } from '../../../lab/types';
import { PAL } from '../kit/palette';
import { createCar } from './Car';

function stats(root: THREE.Object3D): string {
  let tris = 0;
  let meshes = 0;
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes += 1;
    const inst = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).count : 1;
    tris += ((m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3) * inst;
  });
  return `${meshes} meshes, ${Math.round(tris)} tris`;
}

function carItem(opts: { driving?: boolean; dummy?: boolean; paint?: string } = {}): LabItem {
  const t0 = performance.now();
  const car = createCar();
  const ms = performance.now() - t0;
  if (opts.paint) car.setPaint(opts.paint);
  if (opts.dummy) {
    // Placeholder princess: capsule torso + sphere head, head top 1.25 above the seat.
    const mat = new THREE.MeshStandardMaterial({ color: PAL.dress, roughness: 0.6 });
    const skin = new THREE.MeshStandardMaterial({ color: PAL.skin, roughness: 0.7 });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.4, 6, 14), mat);
    torso.scale.set(1.1, 1, 0.8);
    torso.position.set(0, 0.4, 0.05);
    torso.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 24, 16), skin);
    head.position.set(0, 1.03, 0.02);
    head.castShadow = true;
    const hands = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), skin);
    hands.position.set(-0.17, 0, 0.02);
    const hand2 = hands.clone();
    hand2.position.x = 0.17;
    car.steeringWheel.add(hands, hand2);
    car.seat.add(torso, head);
  }
  let time = 0;
  let bumpT = 0;
  const state = { time: 0, speed: 0, steer: 0, bump: 0 };
  return {
    object: car.root,
    ground: 'road',
    info: `createCar ${Math.round(ms)}ms · ${stats(car.root)}`,
    view: { target: [0, 0.8, 0], dist: 6.5, yaw: 150, pitch: 12 },
    update: (dt, t) => {
      time = t;
      state.time = time;
      if (opts.driving) {
        state.speed = 12;
        state.steer = Math.sin(time * 0.9) * 0.8;
        bumpT += dt;
        if (bumpT > 2.6) {
          bumpT = 0;
          state.bump = 1;
        }
        state.bump = Math.max(0, state.bump - dt * 2.5);
      } else {
        state.speed = 1.2;
        state.steer = 0;
      }
      car.update(dt, state);
    },
  };
}

export const items: LabItems = {
  car: () => carItem(),
  'car-driving': () => carItem({ driving: true }),
  'car-with-dummy': () => carItem({ dummy: true }),
  'car-lilac': () => carItem({ paint: PAL.wallLavender }),
};
