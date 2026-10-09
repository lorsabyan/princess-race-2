import * as THREE from 'three';
import { worldUniforms } from '../models/kit/materials';
import { PAL } from '../models/kit/palette';

type Shape = 'dot' | 'sparkle' | 'confetti' | 'drop' | 'heart' | 'ring';
const SHAPE_ID: Record<Shape, number> = { dot: 0, sparkle: 1, confetti: 2, drop: 3, heart: 4, ring: 5 };

export interface EmitOptions {
  count: number;
  position: THREE.Vector3;
  spread?: number;
  speed: [number, number];
  up?: number;
  /** Bias direction added to the random direction. */
  bias?: [number, number, number];
  gravity?: number;
  drag?: number;
  life: [number, number];
  size: [number, number];
  /** Size multiplier at end of life (1 = constant). */
  grow?: number;
  colors: THREE.ColorRepresentation[];
  shape: Shape;
  spin?: number;
  /** Brightness multiplier (additive systems bloom above 1). */
  intensity?: number;
  flutter?: boolean;
}

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iColor;
attribute vec4 iMisc; // size, rotation, shape, flip
uniform float uCurveOrigin;
uniform float uCurveY;
uniform float uCurveX;
varying vec2 vUv;
varying vec4 vColor;
varying float vShape;
void main() {
  vec3 w = iPos;
  float dz = abs( uCurveOrigin - w.z );
  w.y -= uCurveY * dz * dz;
  w.x += uCurveX * dz * dz;
  vec4 mv = viewMatrix * vec4( w, 1.0 );
  vec2 corner = position.xy;
  corner.x *= iMisc.w;
  float c = cos( iMisc.y );
  float s = sin( iMisc.y );
  mv.xy += vec2( c * corner.x - s * corner.y, s * corner.x + c * corner.y ) * iMisc.x;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy * 2.0;
  vColor = iColor;
  vShape = iMisc.z;
}
`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vColor;
varying float vShape;
float dot2( vec2 v ) { return dot( v, v ); }
float sdHeart( vec2 p ) {
  p.x = abs( p.x );
  if ( p.y + p.x > 1.0 ) return sqrt( dot2( p - vec2( 0.25, 0.75 ) ) ) - 0.3535534;
  return sqrt( min( dot2( p - vec2( 0.0, 1.0 ) ), dot2( p - 0.5 * max( p.x + p.y, 0.0 ) ) ) ) * sign( p.x - p.y );
}
void main() {
  vec2 p = vUv;
  float d = length( p );
  float a = 0.0;
  if ( vShape < 0.5 ) {
    a = smoothstep( 1.0, 0.0, d );
    a *= a;
  } else if ( vShape < 1.5 ) {
    float rays = max( exp( -abs( p.x ) * 9.0 ) * exp( -abs( p.y ) * 1.8 ), exp( -abs( p.y ) * 9.0 ) * exp( -abs( p.x ) * 1.8 ) );
    a = rays * smoothstep( 1.0, 0.6, d ) + exp( -d * d * 10.0 ) * 0.9;
  } else if ( vShape < 2.5 ) {
    vec2 q = abs( p ) - vec2( 0.55, 0.95 );
    a = 1.0 - smoothstep( -0.06, 0.02, max( q.x, q.y ) );
  } else if ( vShape < 3.5 ) {
    a = 1.0 - smoothstep( 0.72, 0.95, d );
  } else if ( vShape < 4.5 ) {
    // Tip at the bottom of the quad, lobes at the top.
    float h = sdHeart( vec2( p.x * 0.65, ( p.y + 1.0 ) * 0.55 ) );
    a = 1.0 - smoothstep( -0.02, 0.02, h );
  } else {
    a = 1.0 - smoothstep( 0.0, 0.14, abs( d - 0.78 ) );
  }
  float alpha = vColor.a * a;
  if ( alpha < 0.004 ) discard;
  gl_FragColor = vec4( vColor.rgb, alpha );
}
`;

class ParticleSystem {
  readonly mesh: THREE.Mesh;
  private readonly capacity: number;
  private alive = 0;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size: Float32Array;
  private readonly grow: Float32Array;
  private readonly rot: Float32Array;
  private readonly spin: Float32Array;
  private readonly shape: Float32Array;
  private readonly gravity: Float32Array;
  private readonly drag: Float32Array;
  private readonly flutter: Uint8Array;
  private readonly baseColor: Float32Array;
  private readonly iPos: THREE.InstancedBufferAttribute;
  private readonly iColor: THREE.InstancedBufferAttribute;
  private readonly iMisc: THREE.InstancedBufferAttribute;
  private readonly geometry: THREE.InstancedBufferGeometry;

  constructor(capacity: number, additive: boolean) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.grow = new Float32Array(capacity);
    this.rot = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.shape = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.flutter = new Uint8Array(capacity);
    this.baseColor = new Float32Array(capacity * 3);

    const quad = new THREE.PlaneGeometry(1, 1);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = quad.index;
    this.geometry.setAttribute('position', quad.attributes.position);
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.iColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.iMisc = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('iPos', this.iPos);
    this.geometry.setAttribute('iColor', this.iColor);
    this.geometry.setAttribute('iMisc', this.iMisc);
    this.geometry.instanceCount = 0;

    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uCurveOrigin: worldUniforms.uCurveOrigin,
        uCurveY: worldUniforms.uCurveY,
        uCurveX: worldUniforms.uCurveX,
      },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 10;
  }

  emit(o: EmitOptions): void {
    const colors = o.colors.map((c) => new THREE.Color(c).multiplyScalar(o.intensity ?? 1));
    for (let n = 0; n < o.count; n += 1) {
      if (this.alive >= this.capacity) return;
      const i = this.alive++;
      const spread = o.spread ?? 0.2;
      this.pos[i * 3] = o.position.x + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 1] = o.position.y + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 2] = o.position.z + (Math.random() - 0.5) * spread;
      // Random direction on a sphere, biased.
      const u = Math.random() * 2 - 1;
      const t = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const speed = o.speed[0] + Math.random() * (o.speed[1] - o.speed[0]);
      const b = o.bias ?? [0, 0, 0];
      this.vel[i * 3] = (r * Math.cos(t) + b[0]) * speed;
      this.vel[i * 3 + 1] = (u * 0.6 + b[1]) * speed + (o.up ?? 0);
      this.vel[i * 3 + 2] = (r * Math.sin(t) + b[2]) * speed;
      this.maxLife[i] = o.life[0] + Math.random() * (o.life[1] - o.life[0]);
      this.life[i] = this.maxLife[i];
      this.size[i] = o.size[0] + Math.random() * (o.size[1] - o.size[0]);
      this.grow[i] = o.grow ?? 1;
      this.rot[i] = Math.random() * Math.PI * 2;
      this.spin[i] = (Math.random() - 0.5) * 2 * (o.spin ?? 0);
      this.shape[i] = SHAPE_ID[o.shape];
      this.gravity[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 0;
      this.flutter[i] = o.flutter ? 1 : 0;
      const c = colors[Math.floor(Math.random() * colors.length)];
      this.baseColor[i * 3] = c.r;
      this.baseColor[i * 3 + 1] = c.g;
      this.baseColor[i * 3 + 2] = c.b;
    }
  }

  update(dt: number, time: number): void {
    let i = 0;
    while (i < this.alive) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.kill(i);
        continue;
      }
      const drag = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag + this.gravity[i] * dt;
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.rot[i] += this.spin[i] * dt;
      i += 1;
    }
    const pos = this.iPos.array as Float32Array;
    const col = this.iColor.array as Float32Array;
    const misc = this.iMisc.array as Float32Array;
    for (let k = 0; k < this.alive; k += 1) {
      const t = 1 - this.life[k] / this.maxLife[k];
      pos[k * 3] = this.pos[k * 3];
      pos[k * 3 + 1] = this.pos[k * 3 + 1];
      pos[k * 3 + 2] = this.pos[k * 3 + 2];
      const fadeIn = Math.min(1, t * 10);
      const alpha = fadeIn * Math.pow(1 - t, 1.4);
      col[k * 4] = this.baseColor[k * 3];
      col[k * 4 + 1] = this.baseColor[k * 3 + 1];
      col[k * 4 + 2] = this.baseColor[k * 3 + 2];
      col[k * 4 + 3] = alpha;
      misc[k * 4] = this.size[k] * (1 + (this.grow[k] - 1) * t);
      misc[k * 4 + 1] = this.rot[k];
      misc[k * 4 + 2] = this.shape[k];
      misc[k * 4 + 3] = this.flutter[k] ? Math.cos(time * 9 + k * 1.7) : 1;
    }
    this.geometry.instanceCount = this.alive;
    if (this.alive > 0) {
      this.iPos.needsUpdate = true;
      this.iColor.needsUpdate = true;
      this.iMisc.needsUpdate = true;
    }
  }

  clear(): void {
    this.alive = 0;
    this.geometry.instanceCount = 0;
  }

  private kill(i: number): void {
    const last = --this.alive;
    if (i === last) return;
    const copy3 = (a: Float32Array) => {
      a[i * 3] = a[last * 3];
      a[i * 3 + 1] = a[last * 3 + 1];
      a[i * 3 + 2] = a[last * 3 + 2];
    };
    copy3(this.pos);
    copy3(this.vel);
    copy3(this.baseColor);
    this.life[i] = this.life[last];
    this.maxLife[i] = this.maxLife[last];
    this.size[i] = this.size[last];
    this.grow[i] = this.grow[last];
    this.rot[i] = this.rot[last];
    this.spin[i] = this.spin[last];
    this.shape[i] = this.shape[last];
    this.gravity[i] = this.gravity[last];
    this.drag[i] = this.drag[last];
    this.flutter[i] = this.flutter[last];
  }

  dispose(): void {
    this.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

const GOLD = ['#fff6c8', '#ffe07a', '#ffd35e', '#ffffff'];
const PINKS = [PAL.gemPink, '#ff9ccb', '#ffd1e6', '#ffffff', PAL.gold];
const CONFETTI = [PAL.flowerRose, PAL.flowerYellow, PAL.gemBlue, PAL.gemMint, PAL.flowerLilac, '#ffffff', PAL.flowerOrange];

/** Event-driven effects: pickup sparkles, bump puffs, splashes, confetti, hearts, magic trail. */
export class Vfx {
  readonly group = new THREE.Group();
  private readonly glow = new ParticleSystem(900, true);
  private readonly solid = new ParticleSystem(700, false);
  private readonly tmp = new THREE.Vector3();
  private trailAccumulator = 0;

  constructor() {
    this.group.add(this.solid.mesh, this.glow.mesh);
  }

  coin(pos: THREE.Vector3, combo: number): void {
    const boost = Math.min(combo, 8) / 8;
    this.glow.emit({ count: 9 + Math.round(boost * 6), position: pos, speed: [1.6, 3.4], up: 1.2, gravity: -3, drag: 2.5, life: [0.35, 0.6], size: [0.28, 0.5], colors: GOLD, shape: 'sparkle', spin: 3, intensity: 1.6 });
    this.glow.emit({ count: 1, position: pos, speed: [0, 0], life: [0.3, 0.3], size: [0.6, 0.6], grow: 2.6, colors: ['#fff3b0'], shape: 'ring', intensity: 1.4 });
  }

  gem(pos: THREE.Vector3): void {
    this.glow.emit({ count: 30, position: pos, speed: [2.5, 5.5], up: 2, gravity: -3, drag: 1.8, life: [0.6, 1.0], size: [0.3, 0.6], colors: PINKS, shape: 'sparkle', spin: 4, intensity: 1.8 });
    this.solid.emit({ count: 10, position: pos, spread: 0.6, speed: [0.6, 1.4], up: 2.4, gravity: 0.6, drag: 1.2, life: [1.2, 1.8], size: [0.3, 0.45], colors: [PAL.gemPink, '#ff8fc0', '#ffffff'], shape: 'heart', spin: 1.2 });
    this.glow.emit({ count: 1, position: pos, speed: [0, 0], life: [0.45, 0.45], size: [0.9, 0.9], grow: 3.4, colors: ['#ffc1e0'], shape: 'ring', intensity: 1.6 });
  }

  bump(pos: THREE.Vector3): void {
    this.solid.emit({ count: 9, position: this.tmp.copy(pos).setY(0.4), spread: 1.2, speed: [0.8, 2.2], up: 0.8, gravity: 0.5, drag: 3, life: [0.5, 0.8], size: [0.5, 0.9], grow: 1.8, colors: ['#fff4ee', '#f6e2e8', '#efe0d6'], shape: 'dot' });
    this.glow.emit({ count: 6, position: this.tmp.copy(pos).setY(1.9), spread: 0.6, speed: [1.2, 2.2], up: 1.5, gravity: -4, drag: 2, life: [0.6, 0.9], size: [0.35, 0.5], colors: ['#fff09a', '#ffffff'], shape: 'sparkle', spin: 6, intensity: 1.5 });
  }

  splash(pos: THREE.Vector3): void {
    this.solid.emit({ count: 34, position: this.tmp.copy(pos).setY(0.2), spread: 1.4, speed: [2.5, 5.5], up: 4.5, bias: [0, 0.8, 0.4], gravity: -14, drag: 0.6, life: [0.5, 0.9], size: [0.1, 0.22], colors: ['#bfe8ff', '#8fd2ff', '#ffffff'], shape: 'drop' });
    this.glow.emit({ count: 8, position: this.tmp.copy(pos).setY(0.6), spread: 1.2, speed: [1, 2], up: 1, drag: 2, life: [0.4, 0.6], size: [0.25, 0.4], colors: ['#d8f3ff', '#ffffff'], shape: 'sparkle', intensity: 1.3 });
  }

  hearts(pos: THREE.Vector3, count = 5): void {
    this.solid.emit({ count, position: pos, spread: 0.5, speed: [0.4, 1.0], up: 1.8, gravity: 0.4, drag: 1, life: [1.0, 1.5], size: [0.26, 0.4], colors: [PAL.gemPink, '#ff8fc0', PAL.flowerRose], shape: 'heart', spin: 1 });
  }

  confetti(pos: THREE.Vector3, count = 160): void {
    this.solid.emit({ count, position: pos, spread: 6, speed: [3, 9], up: 7, bias: [0, 0.6, 0.3], gravity: -5, drag: 1.6, life: [2.6, 4], size: [0.16, 0.28], colors: CONFETTI, shape: 'confetti', spin: 7, flutter: true });
    this.glow.emit({ count: 40, position: pos, spread: 5, speed: [2, 6], up: 4, gravity: -2, drag: 1.4, life: [0.8, 1.6], size: [0.3, 0.6], colors: GOLD, shape: 'sparkle', spin: 4, intensity: 1.8 });
  }

  /** Soft magic dust behind the car while driving. */
  trail(dt: number, pos: THREE.Vector3, speed: number): void {
    this.trailAccumulator += dt * Math.min(1, speed / 8) * 26;
    while (this.trailAccumulator >= 1) {
      this.trailAccumulator -= 1;
      this.tmp.set(pos.x + (Math.random() - 0.5) * 1.4, 0.45 + Math.random() * 0.4, pos.z + 1.9);
      this.glow.emit({ count: 1, position: this.tmp, spread: 0.2, speed: [0.2, 0.6], up: 0.5, drag: 2, life: [0.35, 0.65], size: [0.12, 0.24], colors: ['#ffd6ea', '#fff3c2', '#ffffff'], shape: 'sparkle', intensity: 1.2 });
    }
  }

  update(dt: number, time: number): void {
    this.glow.update(dt, time);
    this.solid.update(dt, time);
  }

  clear(): void {
    this.glow.clear();
    this.solid.clear();
  }

  dispose(): void {
    this.glow.dispose();
    this.solid.dispose();
  }
}
