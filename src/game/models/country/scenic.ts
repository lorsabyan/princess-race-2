import * as THREE from 'three';
import type { ScenicKind, ScenicRig } from '../contracts';
import { PAL } from '../kit/palette';
import { Bins } from '../town/bins';
import { makeRng } from '../town/rng';
import { STRIPES, balloonBody, lighthouseBody, sailboatHull, swanBody, windmillBody, windmillSails } from './prefabs';

function meshesOf(fill: (b: Bins) => void, name: string): THREE.Group {
  const b = new Bins();
  fill(b);
  const group = new THREE.Group();
  group.name = name;
  for (const m of b.meshes(name)) group.add(m);
  return group;
}

function rig(group: THREE.Group, update: ScenicRig['update'] = () => {}, react?: () => void): ScenicRig {
  return {
    group,
    update,
    react,
    dispose() {
      group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry.dispose();
      });
      group.removeFromParent();
    },
  };
}

function windmill(seed: number): ScenicRig {
  const rng = makeRng(seed);
  const roof = rng.pick([PAL.roofCoral, PAL.roofTeal, PAL.roofLilac, PAL.roofBerry]);
  const group = meshesOf((b) => windmillBody(b, roof), 'windmill');
  const sails = meshesOf((b) => windmillSails(b, rng.pick(['#fff6ea', '#ffe3ee', '#fff0c8'])), 'windmillSails');
  sails.position.set(0, 7.3, 2.2);
  group.add(sails);
  group.scale.setScalar(1.65);
  const speed = rng.range(0.32, 0.5);
  let boost = 0;
  return rig(
    group,
    (dt) => {
      boost = Math.max(0, boost - dt * 1.4);
      sails.rotation.z += (speed + boost * boost * 1.1) * dt;
    },
    () => {
      boost = 2.4;
    },
  );
}

function balloon(seed: number): ScenicRig {
  const rng = makeRng(seed);
  const group = meshesOf((b) => balloonBody(b, rng.pick([STRIPES.balloonA, STRIPES.balloonB, STRIPES.balloonC])), 'balloon');
  const phase = rng.range(0, 6.28);
  const baseScale = rng.range(1.1, 1.5);
  group.scale.setScalar(baseScale);
  return rig(group, (_dt, time) => {
    group.children[0].position.y = Math.sin(time * 0.42 + phase) * 1.1;
    group.rotation.y = Math.sin(time * 0.1 + phase) * 0.5;
  });
}

function sailboat(seed: number): ScenicRig {
  const rng = makeRng(seed);
  const body = meshesOf((b) => sailboatHull(b, rng.pick(['#ffb3cc', '#fff0c8', '#bfe4ff', '#d9ccff'])), 'sailboat');
  const group = new THREE.Group();
  group.add(body);
  const phase = rng.range(0, 6.28);
  return rig(group, (_dt, time) => {
    body.position.y = Math.sin(time * 0.9 + phase) * 0.08;
    body.rotation.z = Math.sin(time * 0.7 + phase) * 0.05;
    body.rotation.x = Math.sin(time * 0.55 + phase * 2) * 0.03;
  });
}

function swan(seed: number): ScenicRig {
  const rng = makeRng(seed);
  const body = meshesOf(swanBody, 'swan');
  const group = new THREE.Group();
  group.add(body);
  const radius = rng.range(2.5, 5);
  const phase = rng.range(0, 6.28);
  const speed = rng.sign() * rng.range(0.1, 0.2);
  return rig(group, (_dt, time) => {
    const a = time * speed + phase;
    body.position.set(Math.cos(a) * radius, Math.sin(time * 1.1 + phase) * 0.03, Math.sin(a) * radius);
    body.rotation.y = -a + (speed > 0 ? 0 : Math.PI);
  });
}

export function createScenicRig(kind: ScenicKind, seed: number): ScenicRig {
  switch (kind) {
    case 'windmill':
      return windmill(seed);
    case 'balloon':
      return balloon(seed);
    case 'sailboat':
      return sailboat(seed);
    case 'swan':
      return swan(seed);
    case 'lighthouse':
      return rig(meshesOf(lighthouseBody, 'lighthouse'));
  }
}
