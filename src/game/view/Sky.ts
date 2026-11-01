import * as THREE from 'three';
import { PAL } from '../models/kit/palette';
import { blend, ellipsoid, move, planeBelow, sphere, subtract, type SdfNode } from '../models/kit/sdf';
import { meshSdf } from '../models/kit/mesher';
import { noiseTexture } from '../models/kit/noise';
import { LOOK_NOW } from './look';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  gl_Position = p.xyww;
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform vec3 uGlowDir;
uniform float uSunDisc;
uniform sampler2D uNoise;
uniform vec2 uDrift;
varying vec3 vDir;
void main() {
  vec3 d = normalize( vDir );
  float h = d.y;
  vec3 col = mix( uHorizon, uMid, smoothstep( -0.02, 0.2, h ) );
  col = mix( col, uTop, smoothstep( 0.16, 0.72, h ) );
  // High, thin streaks of cloud, far behind the puffy ones.
  if ( h > 0.02 ) {
    vec2 p = d.xz / ( h + 0.16 );
    float wisps = texture2D( uNoise, p * vec2( 0.03, 0.085 ) + uDrift ).r * 0.66 + texture2D( uNoise, p * vec2( 0.085, 0.19 ) - uDrift * 1.7 ).a * 0.5;
    col = mix( col, vec3( 1.0 ), smoothstep( 0.54, 0.86, wisps ) * smoothstep( 0.03, 0.2, h ) * 0.46 );
  }
  col = mix( col, uGround, smoothstep( -0.01, -0.16, h ) );
  // Warm glow band toward the far end of the road.
  float g = max( dot( normalize( vec3( d.x, 0.0, d.z ) ), uGlowDir ), 0.0 );
  col += uSunColor * pow( g, 6.0 ) * 0.22 * smoothstep( 0.45, 0.0, abs( h ) );
  // Sun disc + halo.
  float s = max( dot( d, normalize( uSunDir ) ), 0.0 );
  col += uSunColor * ( pow( s, 1400.0 ) * 18.0 * uSunDisc + pow( s, 48.0 ) * 0.35 + pow( s, 6.0 ) * 0.12 );
  gl_FragColor = vec4( col, 1.0 );
  #include <colorspace_fragment>
}
`;

export interface SkyOptions {
  sunDir: THREE.Vector3;
}

function color(hex: string): THREE.Color {
  return new THREE.Color(hex);
}

export function createSkyMaterial(sunDir: THREE.Vector3, sunDisc = 1): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      uTop: { value: color(LOOK_NOW.sky.top) },
      uMid: { value: color(LOOK_NOW.sky.mid) },
      uHorizon: { value: color(LOOK_NOW.sky.horizon) },
      uGround: { value: color(LOOK_NOW.sky.ground) },
      uSunColor: { value: color(LOOK_NOW.sky.glow) },
      uSunDir: { value: sunDir.clone().normalize() },
      uGlowDir: { value: new THREE.Vector3(0, 0, -1) },
      uSunDisc: { value: sunDisc },
      uNoise: { value: noiseTexture() },
      uDrift: { value: new THREE.Vector2() },
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: true,
  });
}

const CLOUD_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec4 w = modelMatrix * instanceMatrix * vec4( position, 1.0 );
  vNormal = mat3( modelMatrix ) * mat3( instanceMatrix ) * normal;
  vView = cameraPosition - w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

/** Lit like a cloud rather than a solid: bright on top, soft and see-through at the edges. */
const CLOUD_FRAG = /* glsl */ `
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uHaze;
uniform vec3 uSunDir;
varying vec3 vNormal;
varying vec3 vView;
void main() {
  vec3 N = normalize( vNormal );
  vec3 V = normalize( vView );
  float light = smoothstep( 0.22, 0.86, ( dot( N, uSunDir ) * 0.5 + 0.5 ) * 0.42 + ( N.y * 0.5 + 0.5 ) * 0.58 );
  vec3 col = mix( uShade, uLit, light );
  float facing = max( dot( N, V ), 0.0 );
  col = mix( col, uLit, pow( 1.0 - facing, 3.0 ) * 0.7 );
  // Low clouds sink into the haze of the horizon.
  col = mix( uHaze, col, smoothstep( -0.02, 0.2, -V.y ) );
  // Right overhead a cloud is only its flat base, so it fades away.
  gl_FragColor = vec4( col, smoothstep( 0.03, 0.42, facing ) * ( 1.0 - smoothstep( 0.5, 0.82, V.y ) ) );
  #include <colorspace_fragment>
}
`;

/** One fluffy cloud: billowing spheres on a soft flat base. */
function cloudField(seed: number): SdfNode {
  let s = seed * 9301 + 49297;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const puffs: SdfNode[] = [];
  const count = 7 + Math.floor(rnd() * 3);
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1) - 0.5;
    const r = 3.3 + rnd() * 2.8 - Math.abs(t) * 3.4;
    puffs.push(move(sphere(r), t * 21 + (rnd() - 0.5) * 2, r * 0.6 + rnd() * 1.6, (rnd() - 0.5) * 6));
  }
  for (let i = 0; i < 4; i += 1) {
    const r = 2.1 + rnd() * 1.7;
    puffs.push(move(sphere(r), (rnd() - 0.5) * 11, 4.6 + rnd() * 2.6, (rnd() - 0.5) * 4));
  }
  puffs.push(move(ellipsoid(11.5, 2.3, 6), 0, 0.7, 0));
  return subtract(blend(1.2, ...puffs), planeBelow(-0.2), 1.6);
}

export function createCloudGeometry(seed: number): THREE.BufferGeometry {
  return meshSdf(cloudField(seed), {
    min: [-19, -1.5, -11],
    max: [19, 13, 11],
    cell: 1.05,
    project: 2,
    colors: { 0: '#ffffff' },
  });
}

/**
 * Sky dome (follows the camera), drifting parallax clouds, and a PMREM
 * environment map built from the same sky so reflections match the world.
 */
export class Sky {
  readonly group = new THREE.Group();
  readonly dome: THREE.Mesh;
  readonly clouds = new THREE.Group();
  readonly sunDir: THREE.Vector3;
  private readonly cloudMeshes: THREE.InstancedMesh[] = [];
  private readonly cloudSlots: Array<{ mesh: THREE.InstancedMesh; slot: number; x: number; y: number; baseZ: number; drift: number; turn: THREE.Quaternion; scale: THREE.Vector3 }> = [];
  private readonly span = 550;
  private readonly matrix = new THREE.Matrix4();
  private readonly spot = new THREE.Vector3();

  constructor(opts: SkyOptions) {
    this.sunDir = opts.sunDir.clone().normalize();
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), createSkyMaterial(this.sunDir, 0));
    this.dome.renderOrder = -1000;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    const cloudMat = new THREE.ShaderMaterial({
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      uniforms: {
        uLit: { value: color(LOOK_NOW.cloud.lit) },
        uShade: { value: color(LOOK_NOW.cloud.shade) },
        uHaze: { value: color(LOOK_NOW.sky.horizon) },
        uSunDir: { value: this.sunDir },
      },
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    const shapes = 3;
    const rows = 14;
    for (let i = 0; i < shapes; i += 1) {
      const mesh = new THREE.InstancedMesh(createCloudGeometry(i + 3), cloudMat, Math.ceil((rows - i) / shapes));
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.renderOrder = -900;
      this.cloudMeshes.push(mesh);
      this.clouds.add(mesh);
    }
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < rows; i += 1) {
      const side = i % 2 === 0 ? -1 : 1;
      const size = 1.1 + ((i * 29) % 10) / 10;
      this.cloudSlots.push({
        mesh: this.cloudMeshes[i % shapes],
        slot: Math.floor(i / shapes),
        x: side * (70 + ((i * 37) % 110)),
        y: 38 + ((i * 53) % 46),
        baseZ: -(i / rows) * this.span,
        drift: 0.6 + ((i * 13) % 7) / 10,
        turn: new THREE.Quaternion().setFromAxisAngle(up, (i * 1.7) % Math.PI),
        scale: new THREE.Vector3(size, size * 1.08, size),
      });
    }
    this.group.add(this.clouds);
  }

  /** Keep the dome centered on the camera; clouds approach slowly (parallax). */
  update(camera: THREE.Camera, time: number): void {
    this.dome.position.copy(camera.position);
    const camZ = camera.position.z;
    const lo = -480;
    const hi = 70;
    const range = hi - lo;
    for (const c of this.cloudSlots) {
      // Clouds drift toward the camera at a fraction of its speed, so they feel far away,
      // then wrap around once they have passed overhead.
      const rel0 = c.baseZ - camZ * 0.12 + time * c.drift;
      const rel = lo + ((((rel0 - lo) % range) + range) % range);
      this.matrix.compose(this.spot.set(c.x, c.y, camZ + rel), c.turn, c.scale);
      c.mesh.setMatrixAt(c.slot, this.matrix);
    }
    for (const mesh of this.cloudMeshes) mesh.instanceMatrix.needsUpdate = true;
    this.clouds.position.x = camera.position.x * 0.9;
    const drift = (this.dome.material as THREE.ShaderMaterial).uniforms.uDrift.value as THREE.Vector2;
    drift.set(time * 0.0011, time * 0.0004);
  }

  /** Bake a PMREM environment from a sky + ground + cloud scene. */
  static bakeEnvironment(renderer: THREE.WebGLRenderer, sunDir: THREE.Vector3): THREE.Texture {
    const envScene = new THREE.Scene();
    const dome = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), createSkyMaterial(sunDir, 0.6));
    envScene.add(dome);
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(48, 32),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PAL.grass).multiplyScalar(0.75) }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -2.5;
    envScene.add(ground);
    const cloudMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
    for (let i = 0; i < 6; i += 1) {
      const c = new THREE.Mesh(new THREE.SphereGeometry(4 + (i % 3), 16, 10), cloudMat);
      const a = (i / 6) * Math.PI * 2;
      c.position.set(Math.cos(a) * 36, 14 + (i % 2) * 6, Math.sin(a) * 36);
      c.scale.set(2.2, 0.8, 1.2);
      envScene.add(c);
    }
    const pmrem = new THREE.PMREMGenerator(renderer);
    const rt = pmrem.fromScene(envScene, 0.02, 0.1, 120);
    pmrem.dispose();
    envScene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    return rt.texture;
  }
}
