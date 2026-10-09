import * as THREE from 'three';
import type { LabItem, LabItems } from '../../../lab/types';
import { extrude, heartShape } from '../kit/geo';
import { PAL } from '../kit/palette';
import { createPrincess } from './Princess';
import type { PrincessMood } from './Princess';
import { WHEEL } from './rigSpec';

const SEAT_Y = 0.62;

/** Standing height (feet to crown top) from the skinned vertices. */
function measureHeight(rig: ReturnType<typeof createPrincess>): number {
  rig.root.updateMatrixWorld(true);
  let top = -Infinity;
  const box = new THREE.Box3();
  for (const mesh of Object.values(rig.meshes)) {
    mesh.computeBoundingBox();
    box.copy(mesh.boundingBox!);
    top = Math.max(top, box.max.y);
  }
  return top + rig.standHeight;
}

function standing(opts: { walk?: number; every?: number; action?: 'wave' | 'cheer' } = {}): LabItem {
  const rig = createPrincess();
  rig.setPose('stand');
  const height = measureHeight(rig);
  rig.root.position.y = rig.standHeight;
  const group = new THREE.Group();
  group.add(rig.root);
  let next = 0.6;
  return {
    object: group,
    ground: 'grass',
    info: `princess height ${height.toFixed(3)} ${JSON.stringify(rig.stats)}`,
    view: { target: [0, 0.78, 0], dist: 3.5, yaw: 210, pitch: 8 },
    update: (dt, time) => {
      if (opts.action && time >= next) {
        if (opts.action === 'wave') rig.wave();
        else rig.cheer();
        next = time + (opts.every ?? 2.4);
      }
      rig.update(dt, { time, steer: 0, speed: 0, walk: opts.walk ?? 0 });
    },
  };
}

/** Placeholder seat, heart seat-back and steering wheel following the car contract. */
function carStub(): { group: THREE.Group; seat: THREE.Object3D; wheel: THREE.Object3D } {
  const group = new THREE.Group();
  const seat = new THREE.Object3D();
  seat.position.set(0, SEAT_Y, 0);
  group.add(seat);
  const cushionMat = new THREE.MeshStandardMaterial({ color: PAL.seat, roughness: 0.8 });
  const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.14, 0.5), cushionMat);
  cushion.position.set(0, -0.07, 0.02);
  const back = new THREE.Mesh(extrude(heartShape(1), 0.1, 0.03, 2, 16), cushionMat);
  back.scale.setScalar(0.72);
  back.position.set(0, 0.19, 0.22);
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.5, 2.6),
    new THREE.MeshStandardMaterial({ color: PAL.carPaint, roughness: 0.4 }),
  );
  body.position.set(0, -0.36, -0.3);
  for (const m of [cushion, back, body]) {
    m.castShadow = true;
    m.receiveShadow = true;
    seat.add(m);
  }
  const tilt = new THREE.Group();
  tilt.position.set(...WHEEL.center);
  tilt.rotation.x = WHEEL.tilt - Math.PI / 2;
  const wheel = new THREE.Group();
  const rimMat = new THREE.MeshStandardMaterial({ color: '#fffaf4', roughness: 0.35 });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(WHEEL.radius, 0.022, 10, 40), rimMat);
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(WHEEL.radius * 2, 0.03, 0.02), rimMat);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 16), new THREE.MeshStandardMaterial({ color: PAL.carPaintDeep }));
  hub.rotation.x = Math.PI / 2;
  wheel.add(rim, spoke, hub);
  tilt.add(wheel);
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 10), rimMat);
  column.position.set(0, 0, -0.25);
  column.rotation.x = Math.PI / 2;
  tilt.add(column);
  seat.add(tilt);
  for (const o of [rim, spoke, hub, column]) o.castShadow = true;
  return { group, seat, wheel };
}

function sitting(steerAmp = 0.9, actions = false): LabItem {
  const rig = createPrincess();
  rig.setPose('sit');
  const stub = carStub();
  stub.seat.add(rig.root);
  let wheelSteer = 0;
  let next = 0.4;
  let count = 0;
  return {
    object: stub.group,
    ground: 'road',
    info: `princess ${JSON.stringify(rig.stats)}`,
    view: { target: [0, 1.0, 0], dist: 4.5, yaw: 0, pitch: 18 },
    update: (dt, time) => {
      if (actions && time >= next) {
        if (count % 2 === 0) rig.wave();
        else {
          rig.cheer();
          rig.setMood('joy', 2);
        }
        count += 1;
        next = time + 2.6;
      }
      const steer = Math.sin(time * 0.9) * steerAmp;
      // Same smoothing as the real car before it turns the wheel.
      wheelSteer += (steer - wheelSteer) * Math.min(1, dt * 12);
      stub.wheel.rotation.z = -wheelSteer * WHEEL.steerGain;
      rig.update(dt, { time, steer, speed: 12, walk: 0 });
    },
  };
}

export const items: LabItems = {
  princess: () => standing(),
  'princess-walk': () => standing({ walk: 1 }),
  'princess-wave': () => standing({ action: 'wave', every: 2.2 }),
  'princess-cheer': () => standing({ action: 'cheer', every: 2.6 }),
  'princess-sit': () => sitting(),
  'princess-sit-still': () => sitting(0),
  'princess-sit-actions': () => sitting(0.3, true),
  // In the real car (loaded lazily so a car module mid-edit only breaks this item).
  'princess-in-car': async () => {
    const mod = (await import('../car/Car')) as unknown as {
      createCar: () => import('../contracts').CarRig;
    };
    const car = mod.createCar();
    const rig = createPrincess();
    rig.setPose('sit');
    car.seat.add(rig.root);
    return {
      object: car.root,
      ground: 'road',
      view: { target: [0, 1.1, 0.2], dist: 3.2, yaw: 20, pitch: 22 },
      update: (dt: number, time: number) => {
        const steer = Math.sin(time * 0.9) * 0.8;
        car.update(dt, { time, speed: 12, steer, bump: 0 });
        rig.update(dt, { time, steer, speed: 12, walk: 0 });
      },
    };
  },
  'princess-faces': () => {
    const group = new THREE.Group();
    const moods: PrincessMood[] = ['happy', 'surprised', 'joy'];
    const rigs = moods.map((mood, i) => {
      const rig = createPrincess();
      rig.root.position.set((i - 1) * 0.72, rig.standHeight, 0);
      rig.setMood(mood, 1e9);
      group.add(rig.root);
      return rig;
    });
    return {
      object: group,
      ground: 'grass',
      view: { target: [0, 1.08, 0], dist: 2.6, yaw: 180, pitch: 4 },
      update: (dt, time) => {
        for (const rig of rigs) rig.update(dt, { time, steer: 0, speed: 0, walk: 0 });
      },
    };
  },
};
