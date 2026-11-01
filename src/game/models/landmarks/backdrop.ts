import * as THREE from 'three';
import { PAL } from '../kit/palette';
import { PartBuilder, cone, cyl, sphere } from '../kit/geo';
import { SUN_DIR } from '../../view/Lighting';
import { LOOK_NOW } from '../../view/look';
import { latheRings, rng } from './kit';
import type { Backdrop } from './types';

/**
 * Far scenery ring: three layers of soft rolling hills around the camera, tree
 * clusters on the nearest layer, and a faint castle silhouette on a hill on the
 * horizon in the real castle's direction. NOT part of the curved world: it is unbent, unfogged, and
 * bakes its own atmospheric perspective (farther = lighter / bluer).
 *
 * Everything is positioned on the GPU relative to the camera. Each layer samples
 * its hill pattern at `world - camera * follow`, so as the camera travels the
 * pattern drifts past slowly (nearest layer drifts most) while the ring itself
 * never gets closer. The camera uniform refreshes automatically before render;
 * update(camera) does the same explicitly.
 */

const LAYERS = [
  // r0, r1: band radii; amp/base: hill heights; follow: 1 = locked to camera.
  { r0: 150, r1: 200, amp: 13, base: 1.5, freq: 0.021, seed: 3.1, follow: 0.84, valley: 0.72, valleyW: 0.42, segs: 288, albedo: '#86cf80', haze: 0.16, hazeMix: 0.25 },
  { r0: 232, r1: 295, amp: 22, base: 3.0, freq: 0.0125, seed: 11.7, follow: 0.92, valley: 0.6, valleyW: 0.3, segs: 224, albedo: '#7fc49e', haze: 0.4, hazeMix: 0.45 },
  { r0: 330, r1: 410, amp: 34, base: 6.0, freq: 0.0085, seed: 23.9, follow: 0.97, valley: 0.0, valleyW: 0.3, segs: 168, albedo: '#99b6db', haze: 0.58, hazeMix: 0.62 },
];
const ROWS = [0, 0.06, 0.16, 0.3, 0.46, 0.62, 0.78, 1.0];
const TREE_TILE = 440;
const CASTLE_DIST = 372;

const NOISE_GLSL = /* glsl */ `
float bdHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float bdNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = bdHash(i);
  float b = bdHash(i + vec2(1.0, 0.0));
  float c = bdHash(i + vec2(0.0, 1.0));
  float d = bdHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
uniform vec3 uCam;
uniform vec3 uR0;
uniform vec3 uR1;
uniform vec3 uAmp;
uniform vec3 uBase;
uniform vec3 uFreq;
uniform vec3 uSeed;
uniform vec3 uFollow;
uniform vec3 uValley;
uniform vec3 uValleyW;
uniform vec3 uSun;
uniform vec3 uSkyAmb;
uniform vec3 uGroundAmb;
uniform vec3 uAlbedo0;
uniform vec3 uAlbedo1;
uniform vec3 uAlbedo2;
uniform vec3 uHazeCol0;
uniform vec3 uHazeCol1;
uniform vec3 uHazeCol2;
uniform vec3 uHaze;
float pick(vec3 v, int i) { return i == 0 ? v.x : (i == 1 ? v.y : v.z); }
vec3 pickC(int i, vec3 a, vec3 b, vec3 c) { return i == 0 ? a : (i == 1 ? b : c); }

// Terrain height for layer li at pattern position q, ring angle theta, band param vr (0 front .. 1 back).
float bdTerrain(vec2 q, float theta, float vr, int li) {
  float fr = pick(uFreq, li);
  float sd = pick(uSeed, li);
  float n = bdNoise(q * fr + sd) * 0.62 + bdNoise(q * fr * 2.03 + sd + 17.0) * 0.28 + bdNoise(q * fr * 4.1 + sd + 5.0) * 0.1;
  float h = pick(uBase, li) + pick(uAmp, li) * smoothstep(0.2, 0.92, n);
  // Valley straight down the road (-Z, theta = PI) so the distant castle shows.
  float dth = abs(atan(sin(theta - 3.14159265), cos(theta - 3.14159265)));
  float w = pick(uValleyW, li);
  h *= 1.0 - pick(uValley, li) * exp(-(dth * dth) / (w * w));
  float env = smoothstep(0.0, 0.5, vr) * (1.0 - 0.22 * smoothstep(0.78, 1.0, vr));
  return h * env;
}

vec3 bdShade(vec3 n, float y, int li, vec3 albedo, vec2 q) {
  float amp = pick(uAmp, li) + pick(uBase, li);
  float ndl = max(dot(n, uSun), 0.0);
  float hemi = n.y * 0.5 + 0.5;
  vec3 alb = albedo * mix(0.9, 1.08, smoothstep(0.0, amp, y));
  // Soft field patches (meadow quilt) on the nearer layers.
  float fld = bdNoise(q * 0.035 + 41.0);
  float fk = li == 0 ? 1.0 : (li == 1 ? 0.5 : 0.0);
  alb = mix(alb, alb * vec3(1.1, 1.08, 0.82), fk * smoothstep(0.55, 0.8, fld) * 0.75);
  alb = mix(alb, alb * vec3(0.84, 0.94, 0.9), fk * smoothstep(0.45, 0.2, fld) * 0.6);
  vec3 col = alb * (mix(uGroundAmb, uSkyAmb, hemi) * 0.62 + vec3(1.0, 0.95, 0.88) * ndl * 0.72);
  float hz = pick(uHaze, li);
  hz += (1.0 - hz) * 0.38 * (1.0 - smoothstep(-6.0, amp * 0.75, y));
  return mix(col, pickC(li, uHazeCol0, uHazeCol1, uHazeCol2), clamp(hz, 0.0, 1.0));
}
`;

const HILL_VERT = /* glsl */ `
${NOISE_GLSL}
varying vec3 vColor;
vec3 bdPos(float theta, float v, int li) {
  vec2 dir = vec2(sin(theta), cos(theta));
  float vr = max(0.0, (v - 0.06) / 0.94);
  float r = mix(pick(uR0, li), pick(uR1, li), vr);
  vec2 p = uCam.xz + dir * r;
  vec2 q = p - uCam.xz * pick(uFollow, li);
  float y = v < 0.03 ? -48.0 : bdTerrain(q, theta, vr, li);
  return vec3(p.x, y, p.y);
}
void main() {
  float theta = position.x;
  float v = position.y;
  int li = int(position.z + 0.5);
  vec3 wp = bdPos(theta, v, li);
  vec3 n;
  if (v < 0.03) {
    n = normalize(vec3(-sin(theta), 0.35, -cos(theta)));
  } else {
    float e = 0.004;
    vec3 dT = bdPos(theta + e, v, li) - bdPos(theta - e, v, li);
    vec3 dV = bdPos(theta, min(1.0, v + 0.02), li) - bdPos(theta, max(0.061, v - 0.02), li);
    n = normalize(cross(dV, dT));
  }
  vColor = bdShade(n, wp.y, li, pickC(li, uAlbedo0, uAlbedo1, uAlbedo2), wp.xz - uCam.xz * pick(uFollow, li));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const TREE_VERT = /* glsl */ `
${NOISE_GLSL}
uniform float uTile;
uniform vec3 uBlossom;
attribute vec4 iTree;
attribute vec3 color;
attribute float kind;
varying vec3 vColor;
void main() {
  float f = uFollow.x;
  vec2 center = uCam.xz * (1.0 - f);
  vec2 q = iTree.xy + uTile * floor((center - iTree.xy) / uTile + 0.5);
  vec2 p = q + uCam.xz * f;
  vec2 d = p - uCam.xz;
  float r = length(d);
  float theta = atan(d.x, d.y);
  float vr = (r - uR0.x) / (uR1.x - uR0.x);
  float vis = step(0.14, vr) * step(vr, 0.86);
  float y = bdTerrain(q, theta, vr, 0);
  vec3 wp = vec3(p.x, y - 0.5 * iTree.z, p.y) + position * iTree.z * vis;
  float blossom = step(1.0, iTree.w);
  vec3 alb = mix(color, uBlossom, kind * blossom) * mix(0.86, 1.12, fract(iTree.w));
  vColor = bdShade(normalize(normal), y + position.y * iTree.z * 0.5, 0, alb, vec2(1000.0));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const CASTLE_VERT = /* glsl */ `
uniform vec3 uCam;
uniform float uDist;
uniform float uSink;
uniform vec2 uBearing;
attribute vec3 color;
varying vec3 vColor;
void main() {
  vColor = color;
  // Stays on the horizon in the castle's direction, turned to face the viewer.
  vec2 d = uBearing;
  vec3 p = vec3(position.x * -d.y - position.z * d.x, position.y, position.x * d.x - position.z * d.y);
  vec3 wp = p + vec3(uCam.x + d.x * uDist, -uSink * 75.0, uCam.z + d.y * uDist);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const FRAG = /* glsl */ `
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor, 1.0);
  #include <colorspace_fragment>
}
`;

function lin(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

/** Tree geometry (unit scale): round canopy on a short trunk. `kind` = 0 trunk, 1 canopy. */
function treeGeometry(): THREE.BufferGeometry {
  const trunk = new PartBuilder();
  trunk.add(cyl(0.12, 0.2, 1.3, 5, true), PAL.trunk, { p: [0, 0.65, 0] });
  const crown = new PartBuilder();
  // Far off on the hills: twenty faces with round normals read as a soft ball.
  const ball = new THREE.IcosahedronGeometry(1, 0);
  (ball.attributes.normal as THREE.BufferAttribute).copy(ball.attributes.position as THREE.BufferAttribute);
  crown.add(ball, PAL.leaf, { p: [0, 1.8, 0], s: [0.95, 0.88, 0.95] });
  const tg = trunk.build()!;
  const cg = crown.build()!;
  tg.setAttribute('kind', new THREE.Float32BufferAttribute(new Float32Array(tg.attributes.position.count).fill(0), 1));
  cg.setAttribute('kind', new THREE.Float32BufferAttribute(new Float32Array(cg.attributes.position.count).fill(1), 1));
  const g = mergeWithKind([tg, cg]);
  tg.dispose();
  cg.dispose();
  return g;
}

function mergeWithKind(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const kinds: number[] = [];
  const index: number[] = [];
  let offset = 0;
  for (const p of parts) {
    const pa = p.attributes.position;
    const na = p.attributes.normal;
    const ca = p.attributes.color;
    const ka = p.attributes.kind;
    for (let i = 0; i < pa.count; i += 1) {
      positions.push(pa.getX(i), pa.getY(i), pa.getZ(i));
      normals.push(na.getX(i), na.getY(i), na.getZ(i));
      colors.push(ca.getX(i), ca.getY(i), ca.getZ(i));
      kinds.push(ka.getX(i));
    }
    const ix = p.index!;
    for (let i = 0; i < ix.count; i += 1) index.push(ix.getX(i) + offset);
    offset += pa.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute('kind', new THREE.Float32BufferAttribute(kinds, 1));
  g.setIndex(index);
  return g;
}

/** Faint distant castle on its own hill, colors pre-hazed. Origin at the hill's center at ground level. */
function castleSilhouette(): THREE.BufferGeometry {
  const b = new PartBuilder();
  const haze = lin(LOOK_NOW.sky.horizon).lerp(lin(LOOK_NOW.sky.mid), 0.4);
  const wall = '#f6c9dc';
  const roof = '#e592b8';
  const hill = '#a9c9d9';
  const sun = new THREE.Vector3().copy(SUN_DIR).normalize();
  const tmp = new THREE.Color();
  const paint = (hex: string, hz: number) => (_x: number, _y: number, _z: number, nx: number, ny: number, nz: number) => {
    const ndl = Math.max(0, nx * sun.x + ny * sun.y + nz * sun.z);
    tmp.set(hex).multiplyScalar(0.72 + 0.42 * ndl);
    return tmp.lerp(haze, hz).getHex();
  };
  // Hill (wide soft dome with a skirt).
  b.add(latheRings([[95, -30], [95, -2], [80, 4], [58, 13], [30, 19], [0, 21]], { segments: 40 }), paint(hill, 0.5));
  const towers: Array<[number, number, number, number, number]> = [
    // x, z, radius, height, roof height
    [0, 0, 2.8, 22, 11.5],
    [-5.7, 2.2, 2.0, 16.5, 8],
    [5.7, 2.2, 2.0, 16.5, 8],
    [-10.5, 4.8, 1.8, 11.5, 6.2],
    [10.5, 4.8, 1.8, 11.5, 6.2],
    [-3.1, -2.6, 1.25, 20, 7],
    [3.5, -2.2, 1.3, 18.5, 6.2],
  ];
  const baseY = 20;
  b.add(new THREE.BoxGeometry(19, 7, 7), paint(wall, 0.45), { p: [0, baseY + 3.5, 3.5] });
  for (const [x, z, r, h, rh] of towers) {
    b.add(cyl(r, r, h, 12), paint(wall, 0.45), { p: [x, baseY + h / 2, z] });
    b.add(cone(r * 1.35, rh, 12), paint(roof, 0.4), { p: [x, baseY + h + rh / 2, z] });
    b.add(sphere(r * 0.18, 6, 4), paint('#ffe7a6', 0.35), { p: [x, baseY + h + rh + r * 0.1, z] });
  }
  const g = b.build()!;
  g.deleteAttribute('wind');
  return g;
}

export function createBackdrop(): Backdrop & { distantCastle: THREE.Object3D } {
  const group = new THREE.Group();
  group.name = 'backdrop';

  const hazeColor = (mixAmt: number) => lin(LOOK_NOW.sky.horizon).lerp(lin(LOOK_NOW.sky.mid), mixAmt);
  const v3 = (k: 'r0' | 'r1' | 'amp' | 'base' | 'freq' | 'seed' | 'follow' | 'valley' | 'valleyW' | 'haze') =>
    new THREE.Vector3(LAYERS[0][k], LAYERS[1][k], LAYERS[2][k]);
  const uCam = { value: new THREE.Vector3() };
  const shared = {
    uCam,
    uR0: { value: v3('r0') },
    uR1: { value: v3('r1') },
    uAmp: { value: v3('amp') },
    uBase: { value: v3('base') },
    uFreq: { value: v3('freq') },
    uSeed: { value: v3('seed') },
    uFollow: { value: v3('follow') },
    uValley: { value: v3('valley') },
    uValleyW: { value: v3('valleyW') },
    uHaze: { value: v3('haze') },
    uSun: { value: SUN_DIR.clone().normalize() },
    uSkyAmb: { value: lin('#dcecff') },
    uGroundAmb: { value: lin('#b9d8a8') },
    uAlbedo0: { value: lin(LAYERS[0].albedo) },
    uAlbedo1: { value: lin(LAYERS[1].albedo) },
    uAlbedo2: { value: lin(LAYERS[2].albedo) },
    uHazeCol0: { value: hazeColor(LAYERS[0].hazeMix) },
    uHazeCol1: { value: hazeColor(LAYERS[1].hazeMix) },
    uHazeCol2: { value: hazeColor(LAYERS[2].hazeMix) },
  };

  // --- Hill bands (all layers in one mesh; nearest first for early depth rejection).
  const pos: number[] = [];
  const idx: number[] = [];
  LAYERS.forEach((L, li) => {
    const base = pos.length / 3;
    const n = ROWS.length;
    for (let i = 0; i <= L.segs; i += 1) {
      const theta = (i / L.segs) * Math.PI * 2;
      for (const v of ROWS) pos.push(theta, v, li);
    }
    for (let i = 0; i < L.segs; i += 1) {
      for (let j = 0; j < n - 1; j += 1) {
        const a = base + i * n + j;
        const b = base + (i + 1) * n + j;
        const c = base + (i + 1) * n + j + 1;
        const d = base + i * n + j + 1;
        idx.push(a, d, b, c, b, d);
      }
    }
  });
  const hillGeo = new THREE.BufferGeometry();
  hillGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hillGeo.setIndex(idx);
  const hillMat = new THREE.ShaderMaterial({ uniforms: shared, vertexShader: HILL_VERT, fragmentShader: FRAG, fog: false });
  hillMat.name = 'backdropHills';
  const hills = new THREE.Mesh(hillGeo, hillMat);
  hills.name = 'backdropHills';
  hills.frustumCulled = false;
  hills.renderOrder = -10;
  group.add(hills);

  // --- Tree clusters on the nearest layer (instanced, placed in pattern space).
  const rand = rng(1234);
  const sites: number[] = [];
  const grid = 8;
  const cell = TREE_TILE / grid;
  for (let c = 0; c < grid * grid; c += 1) {
    if (rand() < 0.1) continue;
    const cx = -TREE_TILE / 2 + ((c % grid) + 0.2 + rand() * 0.6) * cell;
    const cz = -TREE_TILE / 2 + (Math.floor(c / grid) + 0.2 + rand() * 0.6) * cell;
    const count = 3 + Math.floor(rand() * 5);
    const blossom = rand() < 0.35;
    for (let t = 0; t < count; t += 1) {
      const a2 = rand() * Math.PI * 2;
      const d = Math.sqrt(rand()) * (4 + count * 1.5);
      const sc = 2.4 + rand() * 1.9;
      // w: integer part = blossom flag, fraction = brightness variety.
      sites.push(cx + Math.cos(a2) * d, cz + Math.sin(a2) * d, sc, (blossom && rand() < 0.75 ? 1 : 0) + rand() * 0.99);
    }
  }
  const treeMat = new THREE.ShaderMaterial({
    uniforms: { ...shared, uTile: { value: TREE_TILE }, uBlossom: { value: lin('#ffbcd4') } },
    vertexShader: TREE_VERT,
    fragmentShader: FRAG,
    fog: false,
  });
  treeMat.name = 'backdropTrees';
  const trees = new THREE.InstancedMesh(treeGeometry(), treeMat, sites.length / 4);
  trees.geometry.setAttribute('iTree', new THREE.InstancedBufferAttribute(new Float32Array(sites), 4));
  trees.name = 'backdropTrees';
  trees.frustumCulled = false;
  trees.renderOrder = -11;
  group.add(trees);

  // --- Distant castle on its hill, straight down the road.
  const castleMat = new THREE.ShaderMaterial({
    uniforms: { uCam, uDist: { value: CASTLE_DIST }, uSink: { value: 0 }, uBearing: { value: new THREE.Vector2(0, -1) } },
    vertexShader: CASTLE_VERT,
    fragmentShader: FRAG,
    fog: false,
  });
  castleMat.name = 'backdropCastle';
  const castle = new THREE.Mesh(castleSilhouette(), castleMat);
  castle.name = 'backdropCastle';
  castle.frustumCulled = false;
  castle.renderOrder = -12;
  group.add(castle);

  // Hand-off: sink the distant silhouette behind the far hills while the real
  // castle (the 'castleGate' landmark, if present in the scene) rises ahead.
  let realCastle: THREE.Object3D | null = null;
  let searchCooldown = 0;
  const castlePos = new THREE.Vector3();
  const isShown = (o: THREE.Object3D) => {
    for (let n: THREE.Object3D | null = o; n; n = n.parent) if (!n.visible) return false;
    return true;
  };
  const sync = (camera: THREE.Camera) => {
    camera.getWorldPosition(uCam.value);
    if (!realCastle && searchCooldown-- <= 0) {
      let root: THREE.Object3D = group;
      while (root.parent) root = root.parent;
      realCastle = root.getObjectByName('castleGate') ?? null;
      searchCooldown = 90;
    }
    let sink = 0;
    if (realCastle) {
      realCastle.getWorldPosition(castlePos);
      const dx = castlePos.x - uCam.value.x;
      const dz = castlePos.z - uCam.value.z;
      const away = Math.hypot(dx, dz) || 1;
      castleMat.uniforms.uBearing.value.set(dx / away, dz / away);
      if (isShown(realCastle)) sink = 1 - THREE.MathUtils.smoothstep(away, 135, 185);
    }
    castleMat.uniforms.uSink.value = sink;
  };
  // Keep the ring glued to whatever camera renders it (also covers the model lab).
  hills.onBeforeRender = (_r, _s, camera) => sync(camera);

  return {
    group,
    distantCastle: castle,
    update(camera: THREE.Camera) {
      sync(camera);
    },
    applyLook() {
      shared.uSun.value.copy(SUN_DIR).normalize();
      shared.uHazeCol0.value = hazeColor(LAYERS[0].hazeMix);
      shared.uHazeCol1.value = hazeColor(LAYERS[1].hazeMix);
      shared.uHazeCol2.value = hazeColor(LAYERS[2].hazeMix);
    },
    dispose() {
      hillGeo.dispose();
      hillMat.dispose();
      trees.geometry.dispose();
      trees.dispose();
      treeMat.dispose();
      castle.geometry.dispose();
      castleMat.dispose();
    },
  };
}

