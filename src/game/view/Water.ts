import * as THREE from 'three';
import { worldUniforms } from '../models/kit/materials';
import { noiseTexture } from '../models/kit/noise';
import { WATER_Y, type Landscape } from '../sim/landscape';
import { mulberry32, range } from '../sim/rng';
import { LOOK_NOW } from './look';

const VERT = /* glsl */ `
attribute float depth;
uniform vec2 uCurveOrigin;
uniform float uCurveY;
varying vec3 vWorld;
varying float vDepth;
varying float vFogDepth;
void main() {
  vec4 w = modelMatrix * vec4( position, 1.0 );
  vWorld = w.xyz;
  vDepth = depth;
  vec2 d = w.xz - uCurveOrigin;
  w.y -= uCurveY * dot( d, d );
  vec4 mv = viewMatrix * w;
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform sampler2D uNoise;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSky;
uniform vec3 uHigh;
uniform vec3 uHills;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;
varying vec3 vWorld;
varying float vDepth;
varying float vFogDepth;
void main() {
  vec3 V = normalize( cameraPosition - vWorld );
  vec2 p = vWorld.xz;
  // Two sheets of ripples sliding across each other; their channels serve as slopes.
  vec2 broad = texture2D( uNoise, p * 0.019 + vec2( uTime * 0.0052, uTime * 0.0037 ) ).ra - 0.5;
  vec2 small = texture2D( uNoise, p * 0.071 - vec2( uTime * 0.0104, -uTime * 0.0071 ) ).ar - 0.5;
  vec2 slope = ( broad * 0.62 + small * 0.5 ) * mix( 0.34, 0.1, smoothstep( 12.0, 170.0, vFogDepth ) );
  vec3 N = normalize( vec3( -slope.x, 1.0, -slope.y ) );
  float fresnel = pow( 1.0 - max( dot( N, V ), 0.0 ), 4.0 );
  vec3 base = mix( uShallow, uDeep, smoothstep( 0.0, 2.8, vDepth ) );
  // The sky in the water: blue overhead, passing clouds, far green shores at the rim.
  vec3 R = reflect( -V, N );
  float up = max( R.y, 0.0 );
  vec3 sky = mix( uSky, uHigh, smoothstep( 0.02, 0.4, up ) );
  float cloud = texture2D( uNoise, R.xz / ( up + 0.3 ) * 0.11 + uTime * 0.0012 ).r;
  sky = mix( sky, vec3( 1.0 ), smoothstep( 0.54, 0.8, cloud ) * 0.62 );
  sky = mix( sky, uHills, ( 1.0 - smoothstep( 0.0, 0.07, up ) ) * 0.5 );
  vec3 col = mix( base, sky, 0.14 + 0.78 * fresnel );
  // Sun on the water, and little twinkles close to the road.
  col += uSunColor * pow( max( dot( R, uSunDir ), 0.0 ), 140.0 ) * 2.4;
  float twinkle = texture2D( uNoise, p * 0.52 + vec2( uTime * 0.045, -uTime * 0.03 ) ).b * texture2D( uNoise, p * 0.31 - vec2( uTime * 0.036, 0.0 ) ).b;
  col += uSunColor * smoothstep( 0.46, 0.56, twinkle ) * ( 1.0 - smoothstep( 24.0, 120.0, vFogDepth ) ) * 1.25;
  // Foam at the shore, and slow rings rolling in over the shallows.
  float ring = sin( vDepth * 5.5 + uTime * 1.05 + broad.x * 9.0 );
  float foam = 1.0 - smoothstep( 0.06, 0.44, vDepth + small.x * 0.42 );
  foam += smoothstep( 0.78, 1.0, ring ) * ( 1.0 - smoothstep( 0.25, 1.15, vDepth ) ) * 0.5;
  col = mix( col, vec3( 1.0 ), clamp( foam, 0.0, 1.0 ) * 0.62 );
  float alpha = smoothstep( -0.04, 0.12, vDepth );
  if ( alpha < 0.01 ) discard;
  float fog = smoothstep( fogNear, fogFar, vFogDepth );
  gl_FragColor = vec4( mix( col, fogColor, fog ), alpha );
}
`;

const CELL = 10;

/**
 * Lake surface, built only where the land dips under the water line. Its color
 * comes from the depth baked per vertex; ripples, sky reflection and glitter
 * are shaded per pixel, and lily pads float on the shallows.
 */
export class Water {
  readonly group = new THREE.Group();
  private readonly geometry: THREE.BufferGeometry | null;
  private readonly material: THREE.ShaderMaterial;
  private readonly pads: THREE.InstancedMesh | null = null;

  constructor(land: Landscape, sunDir: THREE.Vector3, fog: THREE.Fog, seed: number) {
    this.group.name = 'water';
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uCurveOrigin: worldUniforms.uCurveOrigin,
        uCurveY: worldUniforms.uCurveY,
        uTime: worldUniforms.uTime,
        uNoise: { value: noiseTexture() },
        uDeep: { value: new THREE.Color(LOOK_NOW.water.deep) },
        uShallow: { value: new THREE.Color(LOOK_NOW.water.shallow) },
        uSky: { value: new THREE.Color(LOOK_NOW.sky.mid) },
        uHigh: { value: new THREE.Color(LOOK_NOW.sky.top) },
        uHills: { value: new THREE.Color(LOOK_NOW.haze) },
        uSunDir: { value: sunDir.clone().normalize() },
        uSunColor: { value: new THREE.Color(LOOK_NOW.sky.glow) },
        fogColor: { value: fog.color },
        fogNear: { value: fog.near },
        fogFar: { value: fog.far },
      },
      transparent: true,
      depthWrite: false,
    });
    this.material.name = 'water';
    this.geometry = this.buildSurface(land);
    if (this.geometry) {
      const mesh = new THREE.Mesh(this.geometry, this.material);
      mesh.name = 'water-surface';
      mesh.renderOrder = 1;
      this.group.add(mesh);
      this.pads = this.scatterPads(land, seed);
    }
  }

  private buildSurface(land: Landscape): THREE.BufferGeometry | null {
    const width = (land.nx - 1) * land.cell;
    const height = (land.nz - 1) * land.cell;
    const nx = Math.floor(width / CELL);
    const nz = Math.floor(height / CELL);
    const pos: number[] = [];
    const depth: number[] = [];
    const idx: number[] = [];
    const lookup = new Map<number, number>();
    const vertex = (i: number, j: number): number => {
      const key = i + j * (nx + 1);
      let v = lookup.get(key);
      if (v === undefined) {
        v = pos.length / 3;
        const x = land.x0 + i * CELL;
        const z = land.z0 + j * CELL;
        pos.push(x, WATER_Y, z);
        depth.push(WATER_Y - land.heightAt(x, z));
        lookup.set(key, v);
      }
      return v;
    };
    for (let j = 0; j < nz; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        const lowest = Math.min(
          land.heightAt(land.x0 + i * CELL, land.z0 + j * CELL),
          land.heightAt(land.x0 + (i + 1) * CELL, land.z0 + j * CELL),
          land.heightAt(land.x0 + i * CELL, land.z0 + (j + 1) * CELL),
          land.heightAt(land.x0 + (i + 1) * CELL, land.z0 + (j + 1) * CELL),
        );
        if (lowest > WATER_Y + 0.4) continue;
        const a = vertex(i, j);
        const b = vertex(i + 1, j);
        const c = vertex(i, j + 1);
        const d = vertex(i + 1, j + 1);
        idx.push(a, c, b, b, c, d);
      }
    }
    if (idx.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('depth', new THREE.Float32BufferAttribute(depth, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }

  private scatterPads(land: Landscape, seed: number): THREE.InstancedMesh | null {
    const rng = mulberry32((seed ^ 0x11a7) >>> 0);
    const spots: Array<[number, number, number]> = [];
    for (let i = 0; i < 9000 && spots.length < 160; i += 1) {
      const x = land.x0 + rng() * (land.nx - 1) * land.cell;
      const z = land.z0 + rng() * (land.nz - 1) * land.cell;
      const depth = WATER_Y - land.heightAt(x, z);
      const clumps = Math.sin(x * 0.07) * Math.sin(z * 0.06);
      if (depth > 0.4 && depth < 3.4 && clumps > 0.25 && land.distanceAt(x, z) < 90) spots.push([x, z, range(rng, 0.45, 1.05)]);
    }
    if (spots.length === 0) return null;
    const pad = new THREE.CylinderGeometry(1, 1, 0.03, 10, 1);
    const mat = new THREE.MeshStandardMaterial({ color: '#6fc98a', roughness: 0.55 });
    const mesh = new THREE.InstancedMesh(pad, mat, spots.length);
    mesh.name = 'lily-pads';
    const matrix = new THREE.Matrix4();
    const tint = new THREE.Color();
    spots.forEach(([x, z, r], i) => {
      matrix.makeScale(r, 1, r).setPosition(x, WATER_Y + 0.02, z);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, tint.set(i % 7 === 0 ? '#ffc2dc' : i % 3 === 0 ? '#86d68f' : '#6fc98a'));
    });
    mesh.computeBoundingSphere();
    this.group.add(mesh);
    return mesh;
  }

  dispose(): void {
    this.geometry?.dispose();
    this.material.dispose();
    if (this.pads) {
      this.pads.geometry.dispose();
      (this.pads.material as THREE.Material).dispose();
      this.pads.dispose();
    }
    this.group.removeFromParent();
  }
}
