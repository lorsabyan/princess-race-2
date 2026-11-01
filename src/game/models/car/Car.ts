import * as THREE from 'three';
import { PAL } from '../kit/palette';
import { roundedRectShape } from '../kit/geo';
import type { CarRig, CarState } from '../contracts';
import { Assembler, paintSet, recolor, type RecolorInfo } from './assembler';
import { PBR, createCarMaterial, createGlassMaterial, createGlowMaterial } from './carMaterials';
import { acquireCarEnvironment, carEnvironmentNow, releaseCarEnvironment } from './carEnv';
import { LOOK_NOW } from '../../view/look';
import { COCKPIT, buildHull } from './hull';
import { CAR } from './layout';
import { PLATE_H, PLATE_W, createPlate } from './plate';
import { decimate } from '../kit/decimate';
import { buildSteeringWheelGeometry, createPennant } from './rigParts';
import {
  addBumpers,
  addCoaming,
  addCrown,
  addDash,
  addDeckCrown,
  addDoorHearts,
  addGrille,
  addHeadlights,
  addMirrors,
  addSeat,
  addSpare,
  addTail,
  addTailLights,
  buildWindshield,
  platePlacement,
  type TrimContext,
} from './trim';
import { traceSurface } from './sdfExtra';
import { buildWheelGeometry } from './wheel';

export type { CarRig, CarState } from '../contracts';

/**
 * Fill a shape with blurred edges. Safari has no canvas `filter`, so the shape is drawn
 * off the canvas and only its soft shadow lands on it, which works everywhere.
 */
function softFill(g: CanvasRenderingContext2D, blur: number, color: string, shape: () => void): void {
  const away = g.canvas.width * 2;
  g.save();
  g.shadowColor = color;
  g.shadowBlur = blur;
  g.shadowOffsetX = away;
  g.translate(-away, 0);
  g.fillStyle = color;
  g.beginPath();
  shape();
  g.fill();
  g.restore();
}

/** Alpha falls off softly from a car-shaped middle to nothing at the edge. */
function contactTexture(): THREE.CanvasTexture {
  const w = 64;
  const h = 112;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  softFill(g, 11, '#ffffff', () => g.roundRect(14, 13, w - 28, h - 26, 14));
  return new THREE.CanvasTexture(canvas);
}

/** Two pools of headlight on the road, the car's nose at the bottom edge. */
function beamTexture(): THREE.CanvasTexture {
  const w = 128;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  for (const side of [-1, 1]) {
    const x = w / 2 + side * 24;
    softFill(g, 16, '#ffecb2', () => {
      g.moveTo(x - 6, h - 6);
      g.lineTo(x + 6, h - 6);
      g.lineTo(x + side * 20 + 20, 20);
      g.lineTo(x + side * 20 - 20, 20);
      g.closePath();
    });
  }
  // Fade out with distance.
  g.globalCompositeOperation = 'destination-in';
  const reach = g.createLinearGradient(0, h, 0, 0);
  reach.addColorStop(0, 'rgba(0, 0, 0, 1)');
  reach.addColorStop(0.55, 'rgba(0, 0, 0, 0.6)');
  reach.addColorStop(1, 'rgba(0, 0, 0, 0)');
  g.fillStyle = reach;
  g.fillRect(0, 0, w, h);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Princess Coin Drive hero car: a pearl-pink 1950s convertible with tail fins.
 *
 * Hierarchy (all names are set on the objects):
 *   root                      (the game moves / yaws / rolls this)
 *   ├─ car-wheels             InstancedMesh, 4 road wheels (spin + steer)
 *   ├─ car-contact            soft shade on the road
 *   ├─ car-beam               headlight pools, after dark
 *   └─ car-chassis            suspension bob, body roll and pitch
 *      ├─ car-squash          squash & stretch on bumps (origin on the ground)
 *      │   ├─ car-body        hull + all static trim (1 draw call, per-vertex PBR)
 *      │   ├─ car-shadow      rough copy of the body: casts its shadow, never seen
 *      │   ├─ car-lamps       glowing headlight / heart tail-light lenses
 *      │   ├─ car-glass       windshield
 *      │   ├─ car-plate       "PRINCESS" licence plate
 *      │   └─ car-pennant     antenna whip + pennant flag
 *      └─ car-seat            princess anchor: seat cushion top, centered
 *          └─ car-steering-wheel   center of the wheel, local +Z = axis toward the driver
 *
 * Conventions: the car faces -Z; `steer` > 0 turns right (front wheels yaw toward +X,
 * the steering wheel turns clockwise as seen by the driver).
 */
export function createCar(): CarRig {
  const t0 = performance.now();
  const env = acquireCarEnvironment();
  const material = createCarMaterial();
  material.envMap = env;
  material.envMapIntensity = 0.95;
  const glowMaterial = createGlowMaterial();
  const glassMaterial = createGlassMaterial();
  glassMaterial.envMap = env;

  // ---- Geometry -----------------------------------------------------------
  const hull = buildHull();
  const wheel = buildWheelGeometry();
  const body = new Assembler();
  body.addColored(hull.geometry, hull.pbr, hull.recolor);
  hull.geometry.dispose();
  const glow = new Assembler();
  const ctx: TrimContext = { body, glow, field: hull.field, shell: hull.shell };
  addSeat(ctx);
  addCoaming(ctx, COCKPIT);
  addDash(ctx);
  const glassGeometry = buildWindshield(ctx);
  const rear = addBumpers(ctx);
  addGrille(ctx);
  addHeadlights(ctx);
  addTailLights(ctx);
  addCrown(ctx);
  const spare = buildWheelGeometry(20, true);
  addSpare(ctx, spare);
  spare.geometry.dispose();
  addDoorHearts(ctx);
  addMirrors(ctx);
  addTail(ctx, rear);
  addDeckCrown(ctx);
  const plateAt = platePlacement(rear);
  // Chrome plate frame.
  {
    const frame = new THREE.ShapeGeometry(roundedRectShape(PLATE_W + 0.03, PLATE_H + 0.03, 0.03), 6);
    body.add(frame, PAL.chrome, PBR.chrome, { p: [plateAt.p[0], plateAt.p[1], plateAt.p[2] - 0.004], r: plateAt.r });
    const back = new THREE.ShapeGeometry(roundedRectShape(PLATE_W + 0.03, PLATE_H + 0.03, 0.03), 6);
    back.rotateY(Math.PI);
    body.add(back, PAL.chrome, PBR.chrome, { p: [plateAt.p[0], plateAt.p[1], plateAt.p[2] - 0.006], r: plateAt.r });
  }
  // Antenna base position on the rear deck (left side).
  const antennaHit = traceSurface(hull.shell, [-0.5, 1.6, 1.12], [0, -1, 0]);
  const antennaBase = new THREE.Vector3(-0.5, antennaHit ? antennaHit.p[1] - 0.005 : 0.9, 1.12);

  const bodyBuilt = body.build();
  const bodyGeometry = bodyBuilt.geometry;
  const bodyRecolor: RecolorInfo = bodyBuilt.recolor;
  const glowBuilt = glow.build();
  const glowGeometry = glowBuilt.geometry;

  // ---- Scene graph --------------------------------------------------------
  const root = new THREE.Group();
  root.name = 'car';
  const chassis = new THREE.Group();
  chassis.name = 'car-chassis';
  const squash = new THREE.Group();
  squash.name = 'car-squash';
  root.add(chassis);
  chassis.add(squash);

  const bodyMesh = new THREE.Mesh(bodyGeometry, material);
  bodyMesh.name = 'car-body';
  bodyMesh.castShadow = false;
  bodyMesh.receiveShadow = true;
  squash.add(bodyMesh);

  // The sun's shadow is soft, so a rough copy of the body casts the same one for a tenth of the triangles.
  const rough = new THREE.BufferGeometry();
  rough.setAttribute('position', bodyGeometry.attributes.position);
  rough.setAttribute('normal', bodyGeometry.attributes.normal);
  rough.setIndex(bodyGeometry.index);
  const shadowGeometry = decimate(rough, 4000, { normalWeight: 0.05 });
  const shadowMaterial = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, shadowSide: THREE.DoubleSide });
  const shadowMesh = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadowMesh.name = 'car-shadow';
  shadowMesh.castShadow = true;
  squash.add(shadowMesh);

  // A soft pool of shade under the car, so it sits on the road whatever the sun is doing.
  const contactMap = contactTexture();
  const contactMaterial = new THREE.MeshBasicMaterial({ map: contactMap, color: '#6a2f66', transparent: true, depthWrite: false, opacity: 0.62 });
  const contactGeometry = new THREE.PlaneGeometry(2.5, 4.3);
  contactGeometry.rotateX(-Math.PI / 2);
  const contact = new THREE.Mesh(contactGeometry, contactMaterial);
  contact.name = 'car-contact';
  contact.position.y = 0.03;
  root.add(contact);

  // Headlights on the road ahead, once it is dark enough to see them.
  const beamMap = beamTexture();
  const beamMaterial = new THREE.MeshBasicMaterial({ map: beamMap, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const beamGeometry = new THREE.PlaneGeometry(5.4, 15);
  beamGeometry.rotateX(-Math.PI / 2);
  const beam = new THREE.Mesh(beamGeometry, beamMaterial);
  beam.name = 'car-beam';
  beam.position.set(0, 0.035, -9);
  root.add(beam);
  const applyBeam = () => {
    beamMaterial.opacity = LOOK_NOW.lights * 0.8;
    beam.visible = LOOK_NOW.lights > 0.5;
  };
  applyBeam();

  const lampMesh = new THREE.Mesh(glowGeometry, glowMaterial);
  lampMesh.name = 'car-lamps';
  squash.add(lampMesh);

  const glassMesh = new THREE.Mesh(glassGeometry, glassMaterial);
  glassMesh.name = 'car-glass';
  glassMesh.renderOrder = 2;
  squash.add(glassMesh);

  const plate = createPlate();
  plate.mesh.position.set(...plateAt.p);
  plate.mesh.rotation.set(...plateAt.r);
  squash.add(plate.mesh);

  const pennant = createPennant(material);
  pennant.mesh.position.copy(antennaBase);
  squash.add(pennant.mesh);

  const seat = new THREE.Object3D();
  seat.name = 'car-seat';
  seat.position.set(...CAR.seat);
  chassis.add(seat);

  const steeringGeometry = buildSteeringWheelGeometry();
  const steeringWheel = new THREE.Group();
  steeringWheel.name = 'car-steering-wheel';
  steeringWheel.position.set(...CAR.wheelFromSeat);
  const steerBaseX = -(Math.PI / 2 - CAR.steerTilt);
  steeringWheel.rotation.set(steerBaseX, 0, 0);
  const steeringMesh = new THREE.Mesh(steeringGeometry, material);
  steeringMesh.name = 'car-steering-wheel-mesh';
  steeringMesh.castShadow = false;
  steeringWheel.add(steeringMesh);
  seat.add(steeringWheel);

  const wheels = new THREE.InstancedMesh(wheel.geometry, material, 4);
  wheels.name = 'car-wheels';
  wheels.castShadow = true;
  wheels.receiveShadow = true;
  wheels.frustumCulled = false;
  root.add(wheels);
  const wheelSlots = [
    { x: -CAR.trackX, z: CAR.axleF, front: true },
    { x: CAR.trackX, z: CAR.axleF, front: true },
    { x: -CAR.trackX, z: CAR.axleR, front: false },
    { x: CAR.trackX, z: CAR.axleR, front: false },
  ];

  // ---- Animation state ----------------------------------------------------
  let spin = 0;
  let steerSmoothed = 0;
  let lastSpeed = 0;
  let accelSmoothed = 0;
  let lastBump = 0;
  let sq = 0; // squash spring displacement (+ = squashed)
  let sqV = 0;
  let hop = 0;
  let hopV = 0;
  let kickPennant = 0;
  const q = new THREE.Quaternion();
  const qSteer = new THREE.Quaternion();
  const qSpin = new THREE.Quaternion();
  const qFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  const X = new THREE.Vector3(1, 0, 0);
  const Y = new THREE.Vector3(0, 1, 0);
  const m4 = new THREE.Matrix4();
  const v3 = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);

  const writeWheels = (steerAngle: number) => {
    for (let i = 0; i < wheelSlots.length; i += 1) {
      const w = wheelSlots[i];
      qSteer.setFromAxisAngle(Y, w.front ? steerAngle : 0);
      qSpin.setFromAxisAngle(X, -spin);
      q.copy(qSteer).multiply(qSpin);
      if (w.x < 0) q.multiply(qFlip);
      v3.set(w.x, CAR.wheelR, w.z);
      m4.compose(v3, q, one);
      wheels.setMatrixAt(i, m4);
    }
    wheels.instanceMatrix.needsUpdate = true;
  };
  writeWheels(0);

  const baseGlow = glowMaterial.color.clone();
  const buildMs = performance.now() - t0;

  const rig: CarRig & { buildMs: number } = {
    root,
    seat,
    steeringWheel,
    buildMs,
    update(dt: number, state: CarState) {
      const d = Math.min(Math.max(dt, 0), 0.1);
      const speed = state.speed;
      const time = state.time;
      // Wheels.
      spin = (spin + (speed * d) / CAR.wheelR) % (Math.PI * 2);
      steerSmoothed += (state.steer - steerSmoothed) * Math.min(1, d * 12);
      writeWheels(-steerSmoothed * 0.35);
      steeringWheel.rotation.set(steerBaseX, 0, -steerSmoothed * 1.2);

      // Acceleration (for pitch) and bump impulses.
      const accel = d > 0 ? (speed - lastSpeed) / d : 0;
      lastSpeed = speed;
      accelSmoothed += (THREE.MathUtils.clamp(accel, -30, 30) - accelSmoothed) * Math.min(1, d * 6);
      const bump = THREE.MathUtils.clamp(state.bump, 0, 1);
      const rise = Math.max(0, bump - lastBump);
      lastBump = bump;
      if (rise > 0) {
        sqV += rise * 2.4;
        hopV += rise * 1.6;
        kickPennant += rise;
      }
      // Squash spring (underdamped: squash -> stretch -> settle).
      sqV += (-sq * 170 - sqV * 9) * d;
      sq += sqV * d;
      hopV += (-hop * 120 - hopV * 12) * d;
      hop += hopV * d;

      // Gentle suspension bob, stronger with speed.
      const sp = THREE.MathUtils.clamp(Math.abs(speed) / 18, 0, 1);
      const bob =
        Math.sin(time * 2.2) * 0.006 +
        (Math.sin(time * 9.1) * 0.006 + Math.sin(time * 13.7 + 1.1) * 0.004) * sp;
      chassis.position.y = bob + Math.max(-0.02, hop * 0.9);
      // Lean out of turns, nose up under acceleration, small rocking.
      chassis.rotation.z = steerSmoothed * sp * 0.05 + Math.sin(time * 7.3) * 0.004 * sp;
      chassis.rotation.x = THREE.MathUtils.clamp(accelSmoothed * 0.004, -0.04, 0.04) + Math.sin(time * 6.1 + 0.7) * 0.003 * sp;

      // Squash and stretch about the ground (volume-ish preserving).
      const s = THREE.MathUtils.clamp(sq, -0.14, 0.16);
      squash.scale.set(1 + s * 0.45, 1 - s, 1 + s * 0.3);
      seat.position.set(CAR.seat[0], CAR.seat[1] * (1 - s), CAR.seat[2]);

      // Pennant.
      pennant.update(d, time, speed, kickPennant + Math.max(0, -accel) * 0.004 * d, -steerSmoothed * sp);
      kickPennant = 0;

      // Subtle "breathing" headlight glow.
      const breathe = 1 + Math.sin(time * 1.8) * 0.04 + bump * 0.15;
      glowMaterial.color.copy(baseGlow).multiplyScalar(breathe);
    },
    setPaint(color: THREE.ColorRepresentation) {
      const set = paintSet(color);
      recolor(bodyGeometry, bodyRecolor, set);
      recolor(wheel.geometry, wheel.recolor, set);
    },
    applyLook() {
      material.envMap = carEnvironmentNow();
      glassMaterial.envMap = material.envMap;
      applyBeam();
    },
    dispose() {
      bodyGeometry.dispose();
      shadowGeometry.dispose();
      shadowMaterial.dispose();
      glowGeometry.dispose();
      glassGeometry.dispose();
      steeringGeometry.dispose();
      wheel.geometry.dispose();
      wheels.dispose();
      contactGeometry.dispose();
      contactMaterial.dispose();
      contactMap.dispose();
      beamGeometry.dispose();
      beamMaterial.dispose();
      beamMap.dispose();
      plate.dispose();
      pennant.dispose();
      material.dispose();
      glowMaterial.dispose();
      glassMaterial.dispose();
      releaseCarEnvironment();
      root.removeFromParent();
    },
  };
  // Start the pennant in a sensible pose.
  pennant.update(0.016, 0, 0, 0);
  return rig;
}
