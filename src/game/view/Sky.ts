import * as THREE from 'three';
import { PAL } from '../models/kit/palette';
import { blend, ellipsoid, move, planeBelow, sphere, subtract, type SdfNode } from '../models/kit/sdf';
import { meshSdf } from '../models/kit/mesher';

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
varying vec3 vDir;
void main() {
  vec3 d = normalize( vDir );
  float h = d.y;
  vec3 col = mix( uHorizon, uMid, smoothstep( -0.02, 0.2, h ) );
  col = mix( col, uTop, smoothstep( 0.16, 0.72, h ) );
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
      uTop: { value: color(PAL.skyTop) },
      uMid: { value: color(PAL.skyMid) },
      uHorizon: { value: color(PAL.skyHorizon) },
      uGround: { value: color('#e9d6e4') },
      uSunColor: { value: color(PAL.sunGlow) },
      uSunDir: { value: sunDir.clone().normalize() },
      uGlowDir: { value: new THREE.Vector3(0, 0, -1) },
      uSunDisc: { value: sunDisc },
    },
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: true,
  });
}

/** One fluffy cloud: blended spheres with a soft flat underside. */
function cloudField(seed: number): SdfNode {
  let s = seed * 9301 + 49297;
  const rnd = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const puffs: SdfNode[] = [];
  const count = 5 + Math.floor(rnd() * 3);
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1) - 0.5;
    const r = 3.2 + rnd() * 2.6 - Math.abs(t) * 2.2;
    puffs.push(move(sphere(r), t * 17 + (rnd() - 0.5) * 2, r * 0.45 + rnd() * 1.4, (rnd() - 0.5) * 5));
  }
  puffs.push(move(ellipsoid(10, 2.6, 5.5), 0, 0.6, 0));
  const body = blend(2.4, ...puffs);
  return subtract(body, planeBelow(-0.2), 1.2);
}

export function createCloudGeometry(seed: number): THREE.BufferGeometry {
  const top = color('#ffffff');
  const bottom = color('#dcd6f5');
  const tmp = new THREE.Color();
  return meshSdf(cloudField(seed), {
    min: [-17, -1.5, -9],
    max: [17, 12, 9],
    cell: 0.75,
    project: 2,
    colorFn: (_x, y) => tmp.copy(bottom).lerp(top, Math.min(1, Math.max(0, (y + 0.4) / 5))).getHex(),
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
  private readonly cloudMeshes: Array<{ mesh: THREE.Mesh; baseZ: number; drift: number }> = [];
  private readonly span = 550;

  constructor(opts: SkyOptions) {
    this.sunDir = opts.sunDir.clone().normalize();
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), createSkyMaterial(this.sunDir, 0));
    this.dome.renderOrder = -1000;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    const cloudMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      metalness: 0,
      emissive: new THREE.Color('#fff4fb'),
      emissiveIntensity: 0.42,
      fog: false,
    });
    const geometries = [0, 1, 2, 3, 4].map((i) => createCloudGeometry(i + 3));
    const rows = 14;
    for (let i = 0; i < rows; i += 1) {
      const mesh = new THREE.Mesh(geometries[i % geometries.length], cloudMat);
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (70 + ((i * 37) % 110));
      const y = 38 + ((i * 53) % 46);
      const baseZ = -(i / rows) * this.span;
      const s = 1.1 + ((i * 29) % 10) / 10;
      mesh.position.set(x, y, baseZ);
      mesh.scale.setScalar(s);
      mesh.rotation.y = (i * 1.7) % Math.PI;
      mesh.frustumCulled = false;
      this.clouds.add(mesh);
      this.cloudMeshes.push({ mesh, baseZ, drift: 0.6 + ((i * 13) % 7) / 10 });
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
    for (const c of this.cloudMeshes) {
      // Clouds drift toward the camera at a fraction of its speed, so they feel far away,
      // then wrap around once they have passed overhead.
      const rel0 = c.baseZ - camZ * 0.12 + time * c.drift;
      const rel = lo + ((((rel0 - lo) % range) + range) % range);
      c.mesh.position.z = camZ + rel;
    }
    this.clouds.position.x = camera.position.x * 0.9;
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
