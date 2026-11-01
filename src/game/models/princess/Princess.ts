import * as THREE from 'three';
import type { PrincessMood, PrincessPose, PrincessRig, PrincessState } from '../contracts';
import { HERO_SHADOW_VERTEX, worldUniforms } from '../kit/materials';
import { noiseTexture } from '../kit/noise';
import { createFaceAtlas, type FaceCell } from './faceAtlas';
import { buildPrincessGeometries } from './assemble';
import {
  B,
  BONE_NAMES,
  BONE_PARENT,
  BONE_POS,
  FOREARM,
  PIG_JOINTS,
  pigPath,
  STAND_HEIGHT,
  UPPER_ARM,
  WHEEL,
} from './rigSpec';

export type { PrincessMood, PrincessPose, PrincessRig, PrincessState } from '../contracts';

/** Extra (non-contract) handles, handy for the lab and debugging. */
export interface PrincessRigExt extends PrincessRig {
  bones: Record<string, THREE.Bone>;
  meshes: Record<string, THREE.SkinnedMesh>;
  stats: Record<string, number>;
  readonly pose: PrincessPose;
  readonly mood: PrincessMood;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

/** Light soaking through skin: warm where the shadow begins, never green from the grass below. */
const SKIN_LIGHT = /* glsl */ `
#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
{
  float nl = dot( normal, directionalLights[ 0 ].direction );
  float soak = smoothstep( -0.42, 0.1, nl ) * ( 1.0 - smoothstep( 0.05, 0.6, nl ) );
  reflectedLight.directDiffuse += diffuseColor.rgb * vec3( 0.62, 0.18, 0.13 ) * soak * directionalLights[ 0 ].color * RECIPROCAL_PI;
}
#endif
{
  // Shade stays rosy: keep how bright the bounce light is, but not its green.
  float bounce = dot( reflectedLight.indirectDiffuse / max( diffuseColor.rgb, vec3( 0.06 ) ), vec3( 0.333 ) );
  reflectedLight.indirectDiffuse = mix( reflectedLight.indirectDiffuse, diffuseColor.rgb * bounce * vec3( 1.1, 0.98, 0.95 ), 0.85 );
  float rim = 1.0 - saturate( dot( normal, geometryViewDir ) );
  totalEmissiveRadiance += vec3( 1.0, 0.55, 0.46 ) * rim * rim * rim * 0.34;
}
`;

const HAIR_VERTEX_PARS = /* glsl */ `
#include <common>
attribute vec4 hair;
attribute float flutter;
uniform vec2 uWind;
varying vec3 vFlow;
varying float vStrand;
`;

/** Ribbon tails: they trail straight back at speed, hang down at rest, and always ripple. */
const HAIR_BEGIN = /* glsl */ `
#include <begin_vertex>
if ( flutter > 0.0 ) {
  float wave = uWind.x * ( 5.0 + 5.0 * uWind.y ) - flutter * 8.0 + position.x * 9.0;
  float reach = flutter * flutter;
  transformed.y -= ( 1.0 - uWind.y ) * reach * 0.46;
  transformed.z -= ( 1.0 - uWind.y ) * reach * 0.34;
  transformed.y += sin( wave ) * flutter * ( 0.022 + 0.04 * uWind.y );
  transformed.x += sin( wave * 0.73 + 1.3 ) * flutter * ( 0.016 + 0.026 * uWind.y );
}
`;

const HAIR_SKIN = /* glsl */ `
#include <skinnormal_vertex>
vFlow = normalMatrix * vec3( skinMatrix * vec4( hair.xyz, 0.0 ) );
vStrand = hair.w;
`;

const HAIR_FRAGMENT_PARS = /* glsl */ `
#include <common>
uniform sampler2D uNoise;
varying vec3 vFlow;
varying float vStrand;
`;

const HAIR_STRANDS = /* glsl */ `
#include <color_fragment>
if ( vStrand > 0.005 ) {
  float fine = texture2D( uNoise, vec2( vStrand, 0.31 ) ).b;
  float broad = texture2D( uNoise, vec2( vStrand * 0.31, 0.77 ) ).a;
  diffuseColor.rgb *= 0.74 + 0.34 * fine + 0.34 * broad;
}
`;

/**
 * Hair highlight (Kajiya-Kay): light catches hair across the strands, not at a point, so
 * the shine is a band around the head that slides as she moves. Two lobes: a tight white
 * one and a broader one in the hair's own color, each broken up strand by strand.
 */
const HAIR_LIGHT = /* glsl */ `
#include <lights_fragment_end>
#if NUM_DIR_LIGHTS > 0
if ( vStrand > 0.005 ) {
  vec3 hairL = directionalLights[ 0 ].direction;
  vec3 hairH = normalize( hairL + geometryViewDir );
  vec3 hairT = normalize( vFlow - normal * dot( vFlow, normal ) );
  float hairJit = texture2D( uNoise, vec2( vStrand, 0.53 ) ).b - 0.5;
  float th1 = dot( normalize( hairT + normal * ( 0.1 + hairJit * 0.3 ) ), hairH );
  float th2 = dot( normalize( hairT + normal * ( -0.16 + hairJit * 0.3 ) ), hairH );
  float tight = pow( max( 0.0, 1.0 - th1 * th1 ), 160.0 );
  float broad = pow( max( 0.0, 1.0 - th2 * th2 ), 26.0 );
  float hairLit = smoothstep( -0.25, 0.35, dot( normal, hairL ) );
  reflectedLight.directSpecular += ( vec3( 1.0, 0.92, 0.8 ) * tight * 0.075 + diffuseColor.rgb * broad * 0.2 ) * hairLit * directionalLights[ 0 ].color;
}
#endif
`;

function createMaterials(face: THREE.Texture, wind: { value: THREE.Vector2 }) {
  const skin = new THREE.MeshStandardMaterial({
    name: 'princess.skin',
    map: face,
    emissiveMap: face,
    emissive: new THREE.Color('#ff9f82'),
    emissiveIntensity: 0.16,
    vertexColors: true,
    roughness: 0.52,
    metalness: 0,
  });
  skin.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <shadowmap_vertex>', HERO_SHADOW_VERTEX);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', SKIN_LIGHT);
  };
  skin.customProgramCacheKey = () => 'princess-skin';
  const hair = new THREE.MeshPhysicalMaterial({
    name: 'princess.hair',
    vertexColors: true,
    roughness: 0.5,
    metalness: 0,
    sheen: 0.3,
    sheenRoughness: 0.45,
    sheenColor: new THREE.Color('#ffd0b8'),
    clearcoat: 0.1,
    clearcoatRoughness: 0.4,
  });
  hair.onBeforeCompile = (shader) => {
    worldUniforms.uNoise.value ??= noiseTexture();
    shader.uniforms.uNoise = worldUniforms.uNoise;
    shader.uniforms.uWind = wind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', HAIR_VERTEX_PARS)
      .replace('#include <begin_vertex>', HAIR_BEGIN)
      .replace('#include <skinnormal_vertex>', HAIR_SKIN)
      .replace('#include <shadowmap_vertex>', HERO_SHADOW_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', HAIR_FRAGMENT_PARS)
      .replace('#include <color_fragment>', HAIR_STRANDS)
      .replace('#include <lights_fragment_end>', HAIR_LIGHT);
  };
  hair.customProgramCacheKey = () => 'princess-hair';
  const dress = new THREE.MeshPhysicalMaterial({
    name: 'princess.dress',
    vertexColors: true,
    roughness: 0.62,
    metalness: 0,
    sheen: 0.7,
    sheenRoughness: 0.42,
    sheenColor: new THREE.Color('#ffe0ee'),
    // Keeps the pinks warm (not lilac) on the shaded side.
    emissive: new THREE.Color('#ff7aa8'),
    emissiveIntensity: 0.07,
  });
  const gold = new THREE.MeshStandardMaterial({
    name: 'princess.gold',
    vertexColors: true,
    roughness: 0.26,
    metalness: 1,
    envMapIntensity: 1.2,
    // Warm glow so the gold never picks up the green ground.
    emissive: new THREE.Color('#a86400'),
    emissiveIntensity: 0.5,
  });
  const jewels = new THREE.MeshPhysicalMaterial({
    name: 'princess.jewels',
    vertexColors: true,
    roughness: 0.16,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    iridescence: 0.35,
    iridescenceIOR: 1.35,
    envMapIntensity: 1.2,
  });
  for (const m of [dress, gold, jewels]) {
    m.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace('#include <shadowmap_vertex>', HERO_SHADOW_VERTEX);
    };
    m.customProgramCacheKey = () => 'princess-hero';
  }
  return { skin, hair, dress, gold, jewels };
}

// ---------------------------------------------------------------------------
// Crown sparkle
// ---------------------------------------------------------------------------

/** A four-point star of light. */
function glintTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d')!;
  g.translate(size / 2, size / 2);
  const glow = g.createRadialGradient(0, 0, 0, 0, 0, size * 0.26);
  glow.addColorStop(0, 'rgba(255, 252, 235, 1)');
  glow.addColorStop(1, 'rgba(255, 236, 170, 0)');
  g.fillStyle = glow;
  g.fillRect(-size / 2, -size / 2, size, size);
  g.fillStyle = '#fffdf2';
  for (let i = 0; i < 2; i += 1) {
    g.rotate(Math.PI / 2);
    g.beginPath();
    g.moveTo(-size * 0.49, 0);
    g.quadraticCurveTo(0, -size * 0.022, size * 0.49, 0);
    g.quadraticCurveTo(0, size * 0.022, -size * 0.49, 0);
    g.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Crown points that take turns to catch the sun, in the head bone's frame. */
const GLINT_SPOTS: Array<[number, number, number]> = [
  [0.0, 0.67, -0.15],
  [0.14, 0.64, -0.02],
  [-0.13, 0.645, 0.04],
];
const GLINT_EVERY = 2.3;
const GLINT_LEN = 0.5;

// ---------------------------------------------------------------------------
// Small math helpers
// ---------------------------------------------------------------------------

const DOWN = new THREE.Vector3(0, -1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);

function damp(current: number, target: number, rate: number, dt: number): number {
  return target + (current - target) * Math.exp(-rate * dt);
}

function clamp(x: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, x));
}

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** 0..1..0 envelope for a one-shot of `len` seconds with ramps `inT`/`outT`. */
function envelope(t: number, len: number, inT: number, outT: number): number {
  if (t < 0 || t > len) return 0;
  return smoothstep(0, inT, t) * (1 - smoothstep(len - outT, len, t));
}

// ---------------------------------------------------------------------------
// The rig
// ---------------------------------------------------------------------------

export function createPrincess(): PrincessRigExt {
  const root = new THREE.Group();
  root.name = 'princess';

  // Bones in the bind pose.
  const bones = BONE_NAMES.map((name) => {
    const b = new THREE.Bone();
    b.name = name;
    return b;
  });
  for (const name of BONE_NAMES) {
    const bone = bones[B[name]];
    const parent = BONE_PARENT[name];
    const p = BONE_POS[name];
    if (parent) {
      const pp = BONE_POS[parent];
      bone.position.set(p[0] - pp[0], p[1] - pp[1], p[2] - pp[2]);
      bones[B[parent]].add(bone);
    } else {
      bone.position.set(p[0], p[1], p[2]);
      root.add(bone);
    }
  }
  const restPos = bones.map((b) => b.position.clone());
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const bone = (name: (typeof BONE_NAMES)[number]) => bones[B[name]];

  // Geometry + materials + meshes.
  const face = createFaceAtlas();
  const geos = buildPrincessGeometries();
  // x: time, y: how hard the wind of her speed blows (0..1).
  const wind = { value: new THREE.Vector2() };
  const mats = createMaterials(face.texture, wind);
  const meshes: Record<string, THREE.SkinnedMesh> = {};
  const identity = new THREE.Matrix4();
  const addMesh = (name: string, geo: THREE.BufferGeometry, material: THREE.Material) => {
    const m = new THREE.SkinnedMesh(geo, material);
    m.name = name;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    root.add(m);
    m.bind(skeleton, identity);
    meshes[name] = m;
  };
  addMesh('skin', geos.geometry.skin, mats.skin);
  addMesh('hair', geos.geometry.hair, mats.hair);
  addMesh('dress', geos.geometry.dress, mats.dress);
  addMesh('crownGold', geos.geometry.gold, mats.gold);
  addMesh('jewels', geos.geometry.jewels, mats.jewels);
  // Too small to show in the sun's soft shadow: two fewer draw calls.
  meshes.crownGold.castShadow = false;
  meshes.jewels.castShadow = false;
  const zoneOf: Record<string, keyof typeof geos.ranges> = {
    skin: 'skin',
    hair: 'hair',
    dress: 'dress',
    crownGold: 'gold',
    jewels: 'jewels',
  };

  const glintMap = glintTexture();
  const glint = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glintMap, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false }),
  );
  glint.name = 'crown-glint';
  glint.visible = false;
  bones[B.head].add(glint);

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------
  let pose: PrincessPose = 'stand';
  let mood: PrincessMood = 'happy';
  let moodTimer = Infinity;
  let blinkTimer = 2.2;
  let blinkT = -1;
  let doubleBlink = false;
  let waveT = -1;
  let cheerT = -1;
  let jolt = 0;
  let steerS = 0;
  /** Same filter the car applies before turning its steering wheel, so the hands stay on the rim. */
  let gripSteer = 0;
  let speedS = 0;
  let walkPhase = 0;
  let walkW = 0;
  const WAVE_LEN = 1.6;
  const CHEER_LEN = 2.0;

  // Pigtail chains: per bone, the direction toward the rest of the lock (head frame)
  // and a 3D rotation-vector spring that lags behind the head's motion.
  const pigChains = [-1, 1].map((side) => {
    const path = pigPath(side);
    const names = side < 0 ? (['pigtailL1', 'pigtailL2', 'pigtailL3'] as const) : (['pigtailR1', 'pigtailR2', 'pigtailR3'] as const);
    return names.map((name, i) => {
      const j = path[PIG_JOINTS[i]];
      const rest = path.slice(PIG_JOINTS[i] + 1);
      const c = new THREE.Vector3();
      for (const p of rest) c.add(new THREE.Vector3(p[0], p[1], p[2]));
      c.divideScalar(Math.max(1, rest.length)).sub(new THREE.Vector3(j[0], j[1], j[2]));
      return {
        bone: bones[B[name]],
        side,
        r: c.clone().normalize(),
        x: new THREE.Vector3(),
        v: new THREE.Vector3(),
      };
    });
  });
  const PIG_K = [58, 44, 34];
  const PIG_ZETA = 0.3;
  const PIG_GAIN = [0.02, 0.024, 0.028];

  const headPrev = new THREE.Vector3();
  const headVel = new THREE.Vector3();
  const headAcc = new THREE.Vector3();
  let headInit = false;

  // Scratch
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const v3 = new THREE.Vector3();
  const q1 = new THREE.Quaternion();
  const q2 = new THREE.Quaternion();
  const m1 = new THREE.Matrix4();

  // Parent chains (root-most first) are fixed, so cache them once.
  const chains = new Map<THREE.Object3D, THREE.Object3D[]>();
  const chainOf = (o: THREE.Object3D) => {
    let chain = chains.get(o);
    if (!chain) {
      chain = [];
      let cur: THREE.Object3D | null = o;
      while (cur && cur !== root) {
        chain.unshift(cur);
        cur = cur.parent;
      }
      chains.set(o, chain);
    }
    return chain;
  };
  /** Root-space matrix of an object inside the rig (from local matrices). */
  const rootMatrix = (o: THREE.Object3D, out: THREE.Matrix4) => {
    out.identity();
    for (const c of chainOf(o)) {
      c.updateMatrix();
      out.multiply(c.matrix);
    }
    return out;
  };
  const rootQuat = (o: THREE.Object3D, out: THREE.Quaternion) => {
    out.identity();
    for (const c of chainOf(o)) out.multiply(c.quaternion);
    return out;
  };
  /** Point the bone's rest axis (-Y) along a root-space direction; optional twist about that axis. */
  const aim = (b: THREE.Bone, dirRoot: THREE.Vector3, twist = 0) => {
    rootQuat(b.parent!, q1);
    v3.copy(dirRoot).normalize().applyQuaternion(q2.copy(q1).invert());
    b.quaternion.setFromUnitVectors(DOWN, v3);
    if (twist !== 0) b.quaternion.multiply(q2.setFromAxisAngle(DOWN, twist));
  };

  const wheelNormal = new THREE.Vector3(0, Math.cos(WHEEL.tilt), Math.sin(WHEEL.tilt));
  const wheelUp = new THREE.Vector3(0, Math.sin(WHEEL.tilt), -Math.cos(WHEEL.tilt));
  const gripPoint = (side: number, steer: number, out: THREE.Vector3) => {
    const theta = (side > 0 ? 0 : Math.PI) - steer * WHEEL.steerGain * WHEEL.handFollow;
    const r = WHEEL.gripRadius;
    out.set(WHEEL.center[0], WHEEL.center[1], WHEEL.center[2]);
    out.x += Math.cos(theta) * r;
    out.addScaledVector(wheelUp, Math.sin(theta) * r);
    out.addScaledVector(wheelNormal, WHEEL.gripLift);
    return out;
  };

  const scratchS = new THREE.Vector3();
  const scratchT = new THREE.Vector3();
  const scratchP = new THREE.Vector3();
  const upperDir = [new THREE.Vector3(), new THREE.Vector3()];
  const foreDir = [new THREE.Vector3(), new THREE.Vector3()];
  const handDir = [new THREE.Vector3(), new THREE.Vector3()];
  const tmpU = new THREE.Vector3();
  const tmpF = new THREE.Vector3();
  const tmpH = new THREE.Vector3();

  /** Two-bone IK in root space: writes upper/fore directions. */
  const solveArm = (S: THREE.Vector3, T: THREE.Vector3, pole: THREE.Vector3, outU: THREE.Vector3, outF: THREE.Vector3) => {
    const a = UPPER_ARM;
    const b = FOREARM;
    const d = v1.subVectors(T, S);
    let len = d.length();
    const dir = d.divideScalar(len || 1);
    len = clamp(len, Math.abs(a - b) + 1e-3, a + b - 2e-3);
    const cosA = clamp((a * a + len * len - b * b) / (2 * a * len), -1, 1);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const pn = v2.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
    const elbow = v3.copy(S).addScaledVector(dir, a * cosA).addScaledVector(pn, a * sinA);
    outU.subVectors(elbow, S).normalize();
    outF.copy(S).addScaledVector(dir, len).sub(elbow).normalize();
  };

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------
  const setPose = (p: PrincessPose) => {
    pose = p;
    // Each zone draws one contiguous index range: the seated lap only when sitting,
    // the bell skirt, legs and shoes only when standing.
    for (const [name, mesh] of Object.entries(meshes)) {
      const r = geos.ranges[zoneOf[name]][p];
      mesh.geometry.setDrawRange(r.start, r.count);
    }
  };

  const setMood = (m: PrincessMood, holdSeconds?: number) => {
    mood = m;
    if (m === 'happy') moodTimer = Infinity;
    else moodTimer = holdSeconds ?? (m === 'surprised' ? 1.1 : 2.4);
    if (m === 'surprised') jolt = 1;
  };

  const wave = () => {
    waveT = 0;
  };
  const cheer = () => {
    cheerT = 0;
  };

  // -------------------------------------------------------------------------
  // Update
  // -------------------------------------------------------------------------
  let lastTime = Number.NaN;
  const update = (dtIn: number, state: PrincessState) => {
    // A second call with the same timestamp just re-poses; time does not advance twice.
    const repeated = state.time === lastTime;
    lastTime = state.time;
    const dt = repeated ? 0 : clamp(dtIn, 0, 0.1);
    const t = state.time;
    const sit = pose === 'sit';
    steerS = damp(steerS, clamp(state.steer, -1, 1), 7, dt);
    gripSteer += (clamp(state.steer, -1, 1) - gripSteer) * Math.min(1, dt * 12);
    const speedN = clamp(state.speed / 14, 0, 1.4);
    speedS = damp(speedS, speedN, 3, dt);
    walkW = damp(walkW, sit ? 0 : clamp(state.walk, 0, 1), 8, dt);
    if (walkW > 0.001) walkPhase += dt * Math.PI * 2 * 1.75;
    wind.value.set(t, clamp(speedS * 1.1, 0, 1));

    // Timers.
    if (moodTimer !== Infinity) {
      moodTimer -= dt;
      if (moodTimer <= 0) {
        mood = 'happy';
        moodTimer = Infinity;
      }
    }
    if (waveT >= 0) {
      waveT += dt;
      if (waveT > WAVE_LEN) waveT = -1;
    }
    if (cheerT >= 0) {
      cheerT += dt;
      if (cheerT > CHEER_LEN) cheerT = -1;
    }
    jolt = Math.max(0, jolt - dt * 3.2);
    const wWave = waveT >= 0 ? envelope(waveT, WAVE_LEN, 0.28, 0.3) : 0;
    const wCheer = cheerT >= 0 ? envelope(cheerT, CHEER_LEN, 0.22, 0.35) : 0;

    // --- Body ---------------------------------------------------------------
    const breathe = Math.sin(t * ((Math.PI * 2) / 3.3));
    const hips = bone('hips');
    const spine = bone('spine');
    const neck = bone('neck');
    const head = bone('head');
    hips.position.copy(restPos[B.hips]);
    hips.rotation.set(0, 0, 0);
    spine.rotation.set(0, 0, 0);
    neck.rotation.set(0, 0, 0);
    head.rotation.set(0, 0, 0);

    // Walk: stiff-legged toy stroll with a little waddle.
    const s1 = Math.sin(walkPhase);
    const c2 = Math.cos(walkPhase * 2);
    const legSwing = 0.46 * walkW * s1;
    bone('legL').rotation.set(sit ? 1.3 : legSwing, 0, sit ? 0.06 : 0);
    bone('legR').rotation.set(sit ? 1.3 : -legSwing, 0, sit ? -0.06 : 0);
    hips.position.y += walkW * (-0.028 * s1 * s1 + 0.012 * (1 - c2) * 0.5);
    hips.rotation.z += walkW * 0.05 * s1;
    hips.rotation.y += walkW * 0.06 * s1;
    spine.rotation.z -= walkW * 0.035 * s1;
    bone('skirt').rotation.set(walkW * 0.03 * c2, 0, -walkW * 0.045 * Math.sin(walkPhase - 0.6));

    // Cheer hops.
    if (wCheer > 0) {
      const hop = Math.abs(Math.sin((cheerT - 0.15) * Math.PI * 2.2));
      hips.position.y += wCheer * (sit ? 0.025 : 0.07) * hop;
      spine.rotation.x += wCheer * 0.06;
    }

    if (sit) {
      // Leaning eagerly toward the wheel, turning into curves.
      hips.rotation.x -= 0.07;
      spine.rotation.x -= 0.13 + 0.01 * breathe;
      spine.rotation.z -= steerS * 0.07;
      spine.rotation.y -= steerS * 0.16;
      hips.position.y += 0.0035 * Math.sin(t * 21) * speedS; // road buzz
    } else {
      spine.rotation.x += 0.012 * breathe;
      hips.rotation.z += 0.012 * Math.sin(t * 0.8);
    }

    // Head: idle tilt, lean into turns, jolt on surprise, looks around a little.
    const idleTilt = 0.045 * Math.sin(t * 0.63) + 0.02 * Math.sin(t * 1.37);
    head.rotation.z = idleTilt - steerS * 0.2 + wWave * 0.16 - walkW * 0.03 * s1;
    head.rotation.y = -steerS * 0.24 + 0.05 * Math.sin(t * 0.41) + wWave * 0.12;
    head.rotation.x = 0.02 * Math.sin(t * 0.9) - jolt * 0.16 - wCheer * 0.12 + (sit ? 0.08 : 0);
    neck.rotation.x = sit ? 0.02 : 0;
    // Cheek-squish bounce of the head on the jolt.
    head.position.copy(restPos[B.head]);
    head.position.y += jolt * 0.012;

    // Shoulders: small protraction when driving.
    for (const side of [-1, 1]) {
      const sh = bone(side < 0 ? 'shoulderL' : 'shoulderR');
      sh.position.copy(restPos[B[side < 0 ? 'shoulderL' : 'shoulderR']]);
      if (sit) sh.position.z -= 0.022;
      sh.position.y += 0.004 * breathe;
    }

    // --- Arms ---------------------------------------------------------------
    for (const side of [-1, 1]) {
      const i = side < 0 ? 0 : 1;
      const sh = bone(side < 0 ? 'shoulderL' : 'shoulderR');
      const el = bone(side < 0 ? 'elbowL' : 'elbowR');
      const ha = bone(side < 0 ? 'handL' : 'handR');
      const U = upperDir[i];
      const Fd = foreDir[i];
      const H = handDir[i];
      let twist = 0;
      if (sit) {
        rootMatrix(sh, m1);
        const S = scratchS.setFromMatrixPosition(m1);
        const grip = gripPoint(side, gripSteer, scratchT);
        const approach = tmpH.subVectors(grip, S).normalize();
        grip.addScaledVector(approach, -0.04); // wrist target
        solveArm(S, grip, scratchP.set(side * 1, -0.85, 0.25), U, Fd);
        H.copy(Fd).addScaledVector(wheelNormal, -0.35).normalize();
        twist = side * 0.25;
      } else {
        // Idle: hands folded sweetly in front of the tummy (IK).
        rootMatrix(sh, m1);
        const S = scratchS.setFromMatrixPosition(m1);
        scratchT.set(side * 0.052, 0.3 + 0.004 * breathe, -0.168);
        scratchP.set(side, -0.35, 0.55);
        solveArm(S, scratchT, scratchP, U, Fd);
        H.set(-side * 0.85, -0.45, -0.25).normalize();
        twist = -side * 0.5;
        // Walking: natural swing, arms opposite to the legs.
        if (walkW > 0.001) {
          const sway = 0.03 * Math.sin(t * 0.9 + side);
          const swing = walkW * 0.42 * s1 * side * -1;
          tmpU.set(side * (0.42 + sway), -1, -0.12 + swing).normalize();
          tmpF.set(side * 0.3, -1, -0.36 + swing * 1.3).normalize();
          tmpH.copy(tmpF).add(v2.set(-side * 0.25, 0, -0.1)).normalize();
          U.lerp(tmpU, walkW).normalize();
          Fd.lerp(tmpF, walkW).normalize();
          H.lerp(tmpH, walkW).normalize();
          twist *= 1 - walkW;
        }
      }

      // Wave (right arm).
      if (side > 0 && wWave > 0) {
        const w = Math.sin(Math.max(0, waveT - 0.2) * Math.PI * 2 * 2.4);
        // Upper arm out to the side and up; the forearm swings from the elbow.
        tmpU.set(0.8, 0.42, -0.42).normalize();
        tmpF.set(0.52 + 0.36 * w, 1, -0.3).normalize();
        tmpH.set(0.45 + 0.5 * w, 1, -0.22).normalize();
        blendDir(U, tmpU, wWave, side);
        blendDir(Fd, tmpF, wWave, side);
        blendDir(H, tmpH, wWave, side);
        twist = twist * (1 - wWave) + wWave * 1.2;
      }
      // Cheer (both arms up in a V).
      if (wCheer > 0) {
        const w = Math.sin(cheerT * Math.PI * 2 * 2.2 + side);
        // A wide "yay!" V: arms up and out so the hands clear the big head.
        tmpU.set(side * 0.8, 0.58, -0.2).normalize();
        tmpF.set(side * (0.5 + 0.18 * w), 0.9, -0.18).normalize();
        tmpH.set(side * (0.32 + 0.25 * w), 1, -0.08).normalize();
        blendDir(U, tmpU, wCheer, side);
        blendDir(Fd, tmpF, wCheer, side);
        blendDir(H, tmpH, wCheer, side);
        twist = twist * (1 - wCheer) + wCheer * side * 0.6;
      }

      aim(sh, U);
      aim(el, Fd);
      aim(ha, H, twist);
    }

    // --- Pigtails -------------------------------------------------------------
    // Head acceleration in world space (from the posed head), expressed in head space.
    rootMatrix(head, m1);
    root.updateWorldMatrix(true, false);
    const headWorld = v1.setFromMatrixPosition(m1).applyMatrix4(root.matrixWorld);
    if (!headInit || headWorld.distanceTo(headPrev) > 2) {
      // First frame or a teleport: restart the motion history.
      headPrev.copy(headWorld);
      headVel.set(0, 0, 0);
      headAcc.set(0, 0, 0);
      headInit = true;
    } else if (dt > 0) {
      const vel = v2.subVectors(headWorld, headPrev).divideScalar(dt);
      const acc = v3.subVectors(vel, headVel).divideScalar(dt);
      acc.clampLength(0, 30);
      headAcc.lerp(acc, 1 - Math.exp(-dt * 18));
      headVel.copy(vel);
      headPrev.copy(headWorld);
    }
    const headQ = q1.setFromRotationMatrix(m1);
    root.getWorldQuaternion(q2);
    const headWorldQ = q2.multiply(headQ);
    const accLocal = v2.copy(headAcc).applyQuaternion(headWorldQ.invert());
    // Centrifugal push in curves (the car's own turning) and wind from speed.
    accLocal.x += steerS * speedS * 9;
    accLocal.z -= speedS * 7;
    for (const chain of pigChains) {
      for (let i = 0; i < chain.length; i += 1) {
        const link = chain[i];
        // Lag: the lock rotates away from the acceleration (rotation vector r x -a).
        const target = v3.crossVectors(link.r, accLocal).multiplyScalar(-PIG_GAIN[i]);
        // Idle sway + a little speed flutter.
        target.z += link.side * 0.03 * Math.sin(t * 1.4 + i * 0.6 + link.side);
        target.x += 0.04 * speedS * Math.sin(t * 10 + i * 1.3 + link.side);
        if (wCheer > 0) target.z += link.side * 0.12 * wCheer * Math.sin(cheerT * 14);
        target.clampLength(0, 0.95);
        stepSpring3(link, target, PIG_K[i], PIG_ZETA, dt);
        const angle = link.x.length();
        if (angle > 1e-6) link.bone.quaternion.setFromAxisAngle(v1.copy(link.x).divideScalar(angle), angle);
        else link.bone.quaternion.identity();
      }
    }

    // --- Face -------------------------------------------------------------------
    let cell: FaceCell = 'happy';
    if (wCheer > 0.05 || mood === 'joy') cell = 'joy';
    else if (mood === 'surprised') cell = 'surprised';
    else if (wWave > 0.35) cell = 'wink';
    else {
      blinkTimer -= dt;
      if (blinkTimer <= 0 && blinkT < 0) {
        blinkT = 0;
        doubleBlink = Math.random() < 0.18;
      }
      if (blinkT >= 0) {
        blinkT += dt;
        const bt = blinkT;
        if (bt < 0.045) cell = 'halfBlink';
        else if (bt < 0.12) cell = 'blink';
        else if (bt < 0.165) cell = 'halfBlink';
        else if (doubleBlink && bt < 0.26) cell = 'happy';
        else if (doubleBlink && bt < 0.3) cell = 'halfBlink';
        else if (doubleBlink && bt < 0.37) cell = 'blink';
        else if (doubleBlink && bt < 0.41) cell = 'halfBlink';
        else {
          blinkT = -1;
          blinkTimer = 2.2 + Math.random() * 3.2;
        }
      }
    }
    face.select(cell);

    // --- Crown sparkle ------------------------------------------------------
    const beat = t / GLINT_EVERY;
    const age = (beat - Math.floor(beat)) * GLINT_EVERY;
    glint.visible = age < GLINT_LEN;
    if (glint.visible) {
      const spot = GLINT_SPOTS[Math.floor(beat) % GLINT_SPOTS.length];
      const pop = Math.sin((age / GLINT_LEN) * Math.PI);
      glint.position.set(spot[0], spot[1], spot[2]);
      glint.scale.setScalar(0.34 * pop * pop);
      glint.material.rotation = age * 1.6;
    }
  };

  function blendDir(base: THREE.Vector3, target: THREE.Vector3, w: number, side: number): void {
    // Sweep outward through the side so arms never pass through the body.
    base.lerp(target, w).addScaledVector(X_AXIS, side * Math.sin(Math.PI * w) * 0.5).normalize();
  }

  function stepSpring3(s: { x: THREE.Vector3; v: THREE.Vector3 }, target: THREE.Vector3, k: number, zeta: number, dt: number): void {
    const c = 2 * zeta * Math.sqrt(k);
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    for (let i = 0; i < steps; i += 1) {
      s.v.x += (k * (target.x - s.x.x) - c * s.v.x) * h;
      s.v.y += (k * (target.y - s.x.y) - c * s.v.y) * h;
      s.v.z += (k * (target.z - s.x.z) - c * s.v.z) * h;
      s.x.addScaledVector(s.v, h);
    }
  }

  const dispose = () => {
    for (const m of Object.values(meshes)) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      m.removeFromParent();
    }
    face.dispose();
    skeleton.dispose();
    glintMap.dispose();
    glint.material.dispose();
  };

  setPose('stand');
  update(0, { time: 0, steer: 0, speed: 0, walk: 0 });

  const boneMap: Record<string, THREE.Bone> = {};
  for (const b of bones) boneMap[b.name] = b;

  return {
    root,
    standHeight: STAND_HEIGHT,
    setPose,
    setMood,
    wave,
    cheer,
    update,
    dispose,
    bones: boneMap,
    meshes,
    stats: geos.stats,
    get pose() {
      return pose;
    },
    get mood() {
      return mood;
    },
  };
}
