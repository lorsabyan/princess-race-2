import * as THREE from 'three';
import { worldUniforms } from '../models/kit/materials';
import { mulberry32 } from '../sim/rng';
import type { Area } from '../sim/route';
import { LOOK_NOW, REDUCED_MOTION } from './look';
import type { QualityTier } from './Stage';

/** The drifting flakes fill a box this big, always centered just ahead of the car. */
const BOX = new THREE.Vector3(30, 11, 44);
const FLAKES = 260;
const WINGS = 16;
const SHAFTS = 13;
/** Share of flakes and butterflies drawn on each quality tier. */
const SHARE: Record<QualityTier, number> = { high: 1, medium: 0.6, low: 0.3 };

/** What floats in the air of each area. `amount` is the share of flakes that show, `flutter` of butterflies. */
const AIR: Record<Area, { a: string; b: string; amount: number; flutter: number; size: number }> = {
  town: { a: '#ffc4d8', b: '#ffffff', amount: 0.4, flutter: 0.4, size: 1 },
  meadow: { a: '#fff7d8', b: '#ffe08a', amount: 0.75, flutter: 1, size: 0.82 },
  forest: { a: '#ffe9a0', b: '#c9ef8e', amount: 0.7, flutter: 0.25, size: 0.74 },
  lake: { a: '#ffffff', b: '#d8f3ff', amount: 0.3, flutter: 0.15, size: 0.8 },
  castle: { a: '#ffc4d8', b: '#ffe08a', amount: 0.75, flutter: 0.6, size: 1 },
};

const FLAKE_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform vec2 uCurveOrigin;
uniform float uCurveY;
uniform float uTime;
uniform float uAmount;
uniform float uSize;
varying vec2 vUv;
varying float vMix;
varying float vFade;
void main() {
  float t = uTime + aSeed.w * 90.0;
  vec3 p = aSeed.xyz * uBox;
  // Sinking slowly, carried on the breeze, rocking side to side.
  p += vec3( t * 0.5 + sin( t * 0.7 ) * 1.1, -t * ( 0.2 + aSeed.w * 0.22 ) + sin( t * 1.1 ) * 0.22, sin( t * 0.53 ) * 1.3 );
  // Fixed in the world, but wrapped around the box, so the car drives through them.
  vec3 local = mod( p - uCenter, uBox ) - uBox * 0.5;
  vec3 w = uCenter + local;
  // Tumble as it falls.
  float a = t * ( 0.8 + aSeed.x ) + aSeed.y * 6.28;
  float b = t * ( 0.6 + aSeed.z ) + aSeed.x * 6.28;
  vec3 axisX = vec3( cos( a ), sin( a ) * cos( b ), sin( a ) * sin( b ) );
  vec3 axisY = vec3( -sin( b ) * sin( a ), cos( b ) * 0.4, cos( b ) );
  float size = ( 0.036 + aSeed.w * 0.042 ) * uSize * step( aSeed.y, uAmount );
  // Eases out at the box's walls so nothing blinks in or out.
  vec3 edge = abs( local ) / ( uBox * 0.5 );
  float fade = 1.0 - smoothstep( 0.8, 1.0, max( edge.x, max( edge.y, edge.z ) ) );
  w += ( axisX * position.x + axisY * position.y ) * size * fade;
  vec2 d = w.xz - uCurveOrigin;
  w.y -= uCurveY * dot( d, d );
  vec4 mv = viewMatrix * vec4( w, 1.0 );
  vUv = position.xy;
  vMix = aSeed.z;
  // Never a big blob across the lens.
  vFade = fade * smoothstep( 1.6, 4.5, -mv.z );
  gl_Position = projectionMatrix * mv;
}
`;

const FLAKE_FRAG = /* glsl */ `
uniform vec3 uTintA;
uniform vec3 uTintB;
varying vec2 vUv;
varying float vMix;
varying float vFade;
void main() {
  float r = vUv.x * vUv.x * 2.2 + vUv.y * vUv.y;
  if ( r > 1.0 ) discard;
  gl_FragColor = vec4( mix( uTintA, uTintB, step( 0.5, vMix ) ), ( 1.0 - r * r ) * vFade * 0.9 );
}
`;

const WING_VERT = /* glsl */ `
attribute vec4 aSeed;
attribute vec3 aColor;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform vec2 uCurveOrigin;
uniform float uCurveY;
uniform float uTime;
uniform float uFlutter;
varying vec2 vUv;
varying vec3 vColor;
varying float vFade;
void main() {
  float t = uTime * ( 0.8 + aSeed.w * 0.5 ) + aSeed.w * 40.0;
  vec3 p = aSeed.xyz * uBox;
  // Wandering in loops.
  p += vec3( sin( t * 0.41 ) * 2.4 + sin( t * 0.93 ) * 0.7, 0.0, cos( t * 0.37 ) * 2.4 + sin( t * 1.1 ) * 0.7 );
  vec3 local = mod( p - uCenter, uBox ) - uBox * 0.5;
  vec2 heading = normalize( vec2( cos( t * 0.41 ) * 0.98 + 0.01, -sin( t * 0.37 ) * 0.89 + 0.01 ) );
  float flap = sin( uTime * ( 15.0 + aSeed.w * 6.0 ) + aSeed.x * 6.28 ) * 0.9 + 0.25;
  float side = position.x;
  vec3 wing = vec3( side * cos( flap ), abs( side ) * sin( flap ), position.y );
  wing = vec3( wing.x * heading.y + wing.z * heading.x, wing.y, -wing.x * heading.x + wing.z * heading.y );
  float height = 0.75 + aSeed.y * 1.9 + sin( t * 1.3 ) * 0.25;
  vec3 edge = abs( local ) / ( uBox * 0.5 );
  float fade = ( 1.0 - smoothstep( 0.8, 1.0, max( edge.x, edge.z ) ) ) * step( aSeed.w, uFlutter );
  vec3 w = vec3( uCenter.x + local.x, uCenter.y + height, uCenter.z + local.z );
  // Tiny close to the lens, so one can never fill the view.
  fade *= smoothstep( 2.0, 6.0, distance( w, cameraPosition ) );
  w += wing * 0.15 * fade;
  vec2 d = w.xz - uCurveOrigin;
  w.y -= uCurveY * dot( d, d );
  vec4 mv = viewMatrix * vec4( w, 1.0 );
  vUv = position.xy;
  vColor = aColor;
  vFade = fade;
  gl_Position = projectionMatrix * mv;
}
`;

const WING_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vColor;
varying float vFade;
void main() {
  // A big round upper wing and a small lower one, with a pale edge.
  vec2 p = vec2( abs( vUv.x ), vUv.y );
  float wing = min( length( p - vec2( 0.5, 0.36 ) ) / 0.56, length( p - vec2( 0.38, -0.44 ) ) / 0.42 );
  if ( wing > 1.0 || vFade < 0.02 ) discard;
  gl_FragColor = vec4( mix( vColor, vec3( 1.0 ), smoothstep( 0.6, 0.95, wing ) * 0.75 ), 1.0 );
}
`;

const SHAFT_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform vec3 uCenter;
uniform vec3 uBox;
uniform vec3 uSunDir;
uniform vec2 uCurveOrigin;
uniform float uCurveY;
uniform float uTime;
uniform float uStrength;
varying vec2 vUv;
varying float vGlow;
void main() {
  vec3 local = mod( aSeed.xyz * uBox - uCenter, uBox ) - uBox * 0.5;
  vec3 root = vec3( uCenter.x + local.x, uCenter.y, uCenter.z + local.z );
  // Turned to face the viewer, around the line toward the sun.
  vec3 side = normalize( cross( uSunDir, root - cameraPosition ) );
  float wide = 0.55 + aSeed.w * 0.95;
  vec3 w = root + uSunDir * position.y * 21.0 + side * position.x * wide * ( 0.55 + position.y * 0.9 );
  vec2 d = w.xz - uCurveOrigin;
  w.y -= uCurveY * dot( d, d );
  vec4 mv = viewMatrix * vec4( w, 1.0 );
  vec2 edge = abs( local.xz ) / ( uBox.xz * 0.5 );
  float breathe = 0.72 + 0.28 * sin( uTime * ( 0.3 + aSeed.w * 0.4 ) + aSeed.x * 6.28 );
  vGlow = uStrength * breathe * ( 1.0 - smoothstep( 0.72, 1.0, max( edge.x, edge.y ) ) ) * smoothstep( 3.0, 11.0, -mv.z );
  vUv = position.xy;
  gl_Position = projectionMatrix * mv;
}
`;

const SHAFT_FRAG = /* glsl */ `
uniform vec3 uTint;
varying vec2 vUv;
varying float vGlow;
void main() {
  float across = 1.0 - vUv.x * vUv.x;
  float along = smoothstep( 0.0, 0.3, vUv.y ) * ( 1.0 - smoothstep( 0.55, 1.0, vUv.y ) );
  gl_FragColor = vec4( uTint * across * across * along * vGlow, 1.0 );
}
`;

function seeded(count: number, salt: number): Float32Array {
  const rng = mulberry32(salt);
  const out = new Float32Array(count * 4);
  for (let i = 0; i < out.length; i += 1) out[i] = rng();
  return out;
}

/**
 * The air between the camera and the world: petals, seeds and motes drifting past
 * at every depth, and butterflies over the grass. They are the strongest depth cue
 * in the game, because near ones slide past fast and far ones barely move. In the
 * forest, soft shafts of sun lean down through the trees. All of it moves in the
 * vertex shader, so a frame only sets a few uniforms.
 */
export class Air {
  readonly group = new THREE.Group();
  private readonly flakes: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly wings: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly shafts: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private readonly center = new THREE.Vector3();
  private readonly wingCenter = new THREE.Vector3();
  private readonly tintA = new THREE.Color();
  private readonly tintB = new THREE.Color();
  private readonly target = new THREE.Color();
  private amount = 0.4;
  private flutter = 0.4;
  private size = 1;
  private shine = 0;

  constructor(sunDir: THREE.Vector3) {
    this.group.name = 'air';
    const shared = {
      uBox: { value: BOX },
      uCurveOrigin: worldUniforms.uCurveOrigin,
      uCurveY: worldUniforms.uCurveY,
      uTime: worldUniforms.uTime,
    };

    const flakeShape = new THREE.InstancedBufferGeometry();
    flakeShape.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    flakeShape.setIndex([0, 1, 2, 0, 2, 3]);
    flakeShape.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeded(FLAKES, 0x51a7), 4));
    flakeShape.instanceCount = FLAKES;
    this.flakes = new THREE.Mesh(
      flakeShape,
      new THREE.ShaderMaterial({
        vertexShader: FLAKE_VERT,
        fragmentShader: FLAKE_FRAG,
        uniforms: {
          ...shared,
          uCenter: { value: this.center },
          uAmount: { value: this.amount },
          uSize: { value: this.size },
          uTintA: { value: this.tintA },
          uTintB: { value: this.tintB },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );

    const wingShape = new THREE.InstancedBufferGeometry();
    wingShape.setAttribute('position', new THREE.Float32BufferAttribute([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0, -1, -1, 0, -1, 1, 0], 3));
    wingShape.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 5, 0, 5, 4]);
    const seeds = seeded(WINGS, 0x7e11);
    wingShape.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    const paints = ['#ff7fae', '#ffd45e', '#7fc3ff', '#b79cff', '#ff9a5e'];
    const colors = new Float32Array(WINGS * 3);
    const tint = new THREE.Color();
    for (let i = 0; i < WINGS; i += 1) tint.set(paints[i % paints.length]).toArray(colors, i * 3);
    wingShape.setAttribute('aColor', new THREE.InstancedBufferAttribute(colors, 3));
    wingShape.instanceCount = WINGS;
    this.wings = new THREE.Mesh(
      wingShape,
      new THREE.ShaderMaterial({
        vertexShader: WING_VERT,
        fragmentShader: WING_FRAG,
        uniforms: { ...shared, uBox: { value: new THREE.Vector3(BOX.x * 0.8, 1, BOX.z) }, uCenter: { value: this.wingCenter }, uFlutter: { value: this.flutter } },
        side: THREE.DoubleSide,
      }),
    );

    const shaftShape = new THREE.InstancedBufferGeometry();
    shaftShape.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3));
    shaftShape.setIndex([0, 1, 2, 0, 2, 3]);
    shaftShape.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeded(SHAFTS, 0x2b3d), 4));
    shaftShape.instanceCount = SHAFTS;
    this.shafts = new THREE.Mesh(
      shaftShape,
      new THREE.ShaderMaterial({
        vertexShader: SHAFT_VERT,
        fragmentShader: SHAFT_FRAG,
        uniforms: {
          ...shared,
          uBox: { value: new THREE.Vector3(46, 1, 76) },
          uCenter: { value: this.wingCenter },
          uSunDir: { value: sunDir.clone().normalize() },
          uStrength: { value: 0 },
          uTint: { value: new THREE.Color(LOOK_NOW.sky.glow) },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      }),
    );
    this.shafts.visible = false;

    for (const mesh of [this.flakes, this.wings, this.shafts]) {
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      this.group.add(mesh);
    }
    this.tintA.set(AIR.town.a);
    this.tintB.set(AIR.town.b);
  }

  /** Center the air ahead of the car and ease toward what floats in this area. */
  update(dt: number, carPos: THREE.Vector3, heading: number, area: Area, tier: QualityTier): void {
    this.center.set(carPos.x + Math.sin(heading) * 13, carPos.y + 3.4, carPos.z - Math.cos(heading) * 13);
    this.wingCenter.set(carPos.x + Math.sin(heading) * 16, carPos.y, carPos.z - Math.cos(heading) * 16);
    const air = AIR[area];
    const k = 1 - Math.exp(-1.6 * dt);
    this.amount += (air.amount - this.amount) * k;
    this.flutter += (air.flutter - this.flutter) * k;
    this.size += (air.size - this.size) * k;
    this.tintA.lerp(this.target.set(air.a), k);
    this.tintB.lerp(this.target.set(air.b), k);
    const share = REDUCED_MOTION ? 0.3 : SHARE[tier];
    const flakes = this.flakes.material.uniforms;
    flakes.uAmount.value = this.amount * share;
    flakes.uSize.value = this.size;
    this.wings.material.uniforms.uFlutter.value = this.flutter * share;
    this.shine += ((area === 'forest' && tier !== 'low' ? 1 : 0) - this.shine) * k;
    this.shafts.visible = this.shine > 0.01;
    this.shafts.material.uniforms.uStrength.value = this.shine * LOOK_NOW.shade.shaft;
  }

  dispose(): void {
    for (const mesh of [this.flakes, this.wings, this.shafts]) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.group.removeFromParent();
  }
}
