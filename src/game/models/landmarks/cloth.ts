import * as THREE from 'three';
import { heartShape, type Vec3 } from '../kit/geo';
import { mat } from '../kit/materials';
import type { Col } from './kit';

/**
 * Waving cloth (pole flags, pennants, hanging banners) animated on the CPU with
 * a traveling wave, so flags ripple convincingly from any camera angle. All
 * cloth of a landmark lives in one dynamic mesh (one draw call).
 */

export type ClothShape = 'pennant' | 'swallow' | 'rect' | 'banner';

export interface ClothSpec {
  /** Pole flags: top attachment point on the pole. Banners: center of the top rod. */
  anchor: Vec3;
  /** Pole flags extend along (cos yaw, 0, -sin yaw); banners run along that direction on the wall. */
  yaw: number;
  /** Length along the cloth (pole flags: horizontal; banners: hanging length). */
  length: number;
  /** Pole flags: height at the pole. Banners: width. */
  height: number;
  shape: ClothShape;
  color: Col;
  /** Pennant: lower half color. Banner/rect: border color. */
  color2?: Col;
  /** Middle stripe for pennants. */
  stripe?: Col;
  checker?: boolean;
  emblem?: 'heart' | null;
  emblemColor?: Col;
  amp?: number;
  waves?: number;
  speed?: number;
  phase?: number;
  nu?: number;
}

interface Runtime {
  start: number;
  end: number;
  N: THREE.Vector3;
  V: THREE.Vector3;
  amp: number;
  waves: number;
  speed: number;
  phase: number;
  length: number;
  banner: boolean;
}

const THICK = 0.014;

export class Cloth {
  readonly mesh: THREE.Mesh;
  readonly geometry = new THREE.BufferGeometry();
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private readonly idx: number[] = [];
  /** Normalized distance from the attachment (0..1) per vertex. */
  private readonly along: number[] = [];
  private rest = new Float32Array(0);
  private alongArr = new Float32Array(0);
  private readonly flags: Runtime[] = [];
  private built = false;

  constructor(name = 'cloth', material: THREE.Material = mat('satin')) {
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.name = name;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
  }

  get count(): number {
    return this.flags.length;
  }

  add(spec: ClothSpec): this {
    const banner = spec.shape === 'banner';
    const A = banner ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(Math.cos(spec.yaw), 0, -Math.sin(spec.yaw));
    const V = banner ? new THREE.Vector3(Math.cos(spec.yaw), 0, -Math.sin(spec.yaw)) : new THREE.Vector3(0, -1, 0);
    const N = new THREE.Vector3().crossVectors(A, V).normalize();
    const L = spec.length;
    const H = spec.height;
    const O = new THREE.Vector3(...spec.anchor);
    const start = this.pos.length / 3;
    const nu = spec.nu ?? Math.max(6, Math.round(L / (banner ? 0.24 : 0.26)));

    // Map (u along 0..1, w across 0..1) -> (a along, s across) in world units.
    const notch = L * 0.26;
    const point = Math.min(L * 0.3, H * 0.5);
    const map = (u: number, w: number): [number, number] => {
      switch (spec.shape) {
        case 'pennant': {
          const a = u * L;
          const width = H * (1 - 0.94 * u);
          return [a, H / 2 + (w - 0.5) * width];
        }
        case 'swallow': {
          const amax = L - notch * (1 - Math.abs(2 * w - 1));
          return [u * amax, w * H];
        }
        case 'banner': {
          const amax = L - point * Math.abs(2 * w - 1);
          return [u * amax, (w - 0.5) * H];
        }
        default:
          return [u * L, w * H];
      }
    };
    const put = (a: number, s: number, n: number, c: THREE.Color, _sgn: number) => {
      this.pos.push(O.x + A.x * a + V.x * s + N.x * n, O.y + A.y * a + V.y * s + N.y * n, O.z + A.z * a + V.z * s + N.z * n);
      this.col.push(c.r, c.g, c.b);
      this.along.push(a / L);
      return this.pos.length / 3 - 1;
    };

    const c1 = new THREE.Color(spec.color);
    const c2 = new THREE.Color(spec.color2 ?? spec.color);
    if (spec.checker) {
      const nv = 4;
      const cu = Math.max(4, Math.round((L / H) * nv));
      for (const sgn of [1, -1]) {
        for (let i = 0; i < cu; i += 1) {
          for (let j = 0; j < nv; j += 1) {
            const c = (i + j) % 2 === 0 ? c1 : c2;
            // Split each checker cell in two along u so the wave bends it.
            for (let h = 0; h < 2; h += 1) {
              const u0 = (i + h / 2) / cu;
              const u1 = (i + (h + 1) / 2) / cu;
              const w0 = j / nv;
              const w1 = (j + 1) / nv;
              const p00 = put(...map(u0, w0), THICK * sgn, c, sgn);
              const p10 = put(...map(u1, w0), THICK * sgn, c, sgn);
              const p11 = put(...map(u1, w1), THICK * sgn, c, sgn);
              const p01 = put(...map(u0, w1), THICK * sgn, c, sgn);
              if (sgn > 0) this.idx.push(p00, p10, p11, p00, p11, p01);
              else this.idx.push(p00, p11, p10, p00, p01, p11);
            }
          }
        }
      }
    } else {
      // Horizontal (w) color regions; region borders get duplicated rows for crisp color.
      const regions: Array<{ w0: number; w1: number; c: THREE.Color; rows: number }> = [];
      if (spec.shape === 'pennant') {
        if (spec.stripe) {
          regions.push({ w0: 0, w1: 0.38, c: c1, rows: 2 }, { w0: 0.38, w1: 0.62, c: new THREE.Color(spec.stripe), rows: 1 }, { w0: 0.62, w1: 1, c: c2, rows: 2 });
        } else {
          regions.push({ w0: 0, w1: 0.5, c: c1, rows: 2 }, { w0: 0.5, w1: 1, c: c2, rows: 2 });
        }
      } else if (spec.color2 !== undefined) {
        regions.push({ w0: 0, w1: 0.13, c: c2, rows: 1 }, { w0: 0.13, w1: 0.87, c: c1, rows: 3 }, { w0: 0.87, w1: 1, c: c2, rows: 1 });
      } else {
        regions.push({ w0: 0, w1: 1, c: c1, rows: 4 });
      }
      for (const sgn of [1, -1]) {
        for (const reg of regions) {
          const grid: number[][] = [];
          for (let i = 0; i <= nu; i += 1) {
            const row: number[] = [];
            for (let j = 0; j <= reg.rows; j += 1) {
              const w = reg.w0 + ((reg.w1 - reg.w0) * j) / reg.rows;
              row.push(put(...map(i / nu, w), THICK * sgn, reg.c, sgn));
            }
            grid.push(row);
          }
          for (let i = 0; i < nu; i += 1) {
            for (let j = 0; j < reg.rows; j += 1) {
              const p00 = grid[i][j];
              const p10 = grid[i + 1][j];
              const p11 = grid[i + 1][j + 1];
              const p01 = grid[i][j + 1];
              if (sgn > 0) this.idx.push(p00, p10, p11, p00, p11, p01);
              else this.idx.push(p00, p11, p10, p00, p01, p11);
            }
          }
        }
      }
    }

    if (spec.emblem === 'heart') {
      const size = Math.min(H, L) * (banner ? 0.5 : 0.46);
      const shape = new THREE.ShapeGeometry(heartShape(size), 6);
      const hp = shape.attributes.position;
      const hi = shape.index!;
      const ec = new THREE.Color(spec.emblemColor ?? '#ffd46b');
      const ac = banner ? L * 0.42 : L * 0.36;
      const sc = banner ? 0 : H / 2;
      // Shape winding maps to -N on pole flags (heart-up = -V) and to +N on banners (heart-up = -A).
      const flipFront = !banner;
      for (const sgn of [1, -1]) {
        const base = this.pos.length / 3;
        for (let i = 0; i < hp.count; i += 1) {
          const hx = hp.getX(i);
          const hy = hp.getY(i);
          const a = banner ? ac - hy : ac + hx;
          const s = banner ? hx : sc - hy;
          put(a, s, THICK * 2.2 * sgn, ec, sgn);
        }
        for (let i = 0; i < hi.count; i += 3) {
          const a = base + hi.getX(i);
          const b = base + hi.getX(i + 1);
          const c = base + hi.getX(i + 2);
          const reverse = sgn > 0 ? flipFront : !flipFront;
          if (reverse) this.idx.push(a, c, b);
          else this.idx.push(a, b, c);
        }
      }
      shape.dispose();
    }

    this.flags.push({
      start,
      end: this.pos.length / 3,
      N,
      V,
      amp: spec.amp ?? (banner ? 0.1 : Math.min(0.28, L * 0.11)),
      waves: spec.waves ?? (banner ? 0.6 : 1.25),
      speed: spec.speed ?? (banner ? 1.5 : 5.2),
      phase: spec.phase ?? Math.random() * Math.PI * 2,
      length: L,
      banner,
    });
    return this;
  }

  /** Finalize buffers. Call once after all add() calls. */
  build(): THREE.Mesh {
    const g = this.geometry;
    this.rest = new Float32Array(this.pos);
    this.alongArr = new Float32Array(this.along);
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    g.setAttribute('wind', new THREE.BufferAttribute(new Float32Array(this.pos.length / 3), 1));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    (g.attributes.normal as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    if (g.boundingSphere) g.boundingSphere.radius += 0.6;
    this.built = true;
    this.update(0);
    return this.mesh;
  }

  update(time: number): void {
    if (!this.built || this.flags.length === 0) return;
    const pos = this.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const rest = this.rest;
    const along = this.alongArr;
    const TAU = Math.PI * 2;
    for (const f of this.flags) {
      const { N, V, amp, waves, speed, phase } = f;
      for (let i = f.start; i < f.end; i += 1) {
        const a = along[i];
        let d: number;
        let droop = 0;
        if (f.banner) {
          const w = a * a;
          d = amp * w * (Math.sin(speed * time + phase + a * TAU * waves) + 0.35 * Math.sin(speed * 1.9 * time + phase * 2.1 + a * 3.1));
        } else {
          const w = Math.pow(a, 1.15);
          const ph = TAU * waves * a - speed * time + phase;
          d = amp * w * (Math.sin(ph) + 0.3 * Math.sin(1.7 * ph + 0.8));
          droop = f.length * 0.035 * a * a * (1.4 + Math.sin(ph * 0.5 + 1.3));
        }
        const k = i * 3;
        arr[k] = rest[k] + N.x * d + V.x * droop;
        arr[k + 1] = rest[k + 1] + N.y * d + V.y * droop;
        arr[k + 2] = rest[k + 2] + N.z * d + V.z * droop;
      }
    }
    pos.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  dispose(): void {
    this.geometry.dispose();
  }
}

// ---------------------------------------------------------------------------
// Sparkles: twinkling 4-point stars (instanced, one draw call).
// ---------------------------------------------------------------------------

export interface SparkleSpot {
  p: Vec3;
  s: number;
}

function sparkleGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const hot = [1.9, 1.75, 1.35];
  const tip = [1.2, 0.95, 0.55];
  const inner = 0.16;
  for (const plane of [0, 1]) {
    for (const sgn of [1, -1]) {
      const base = pos.length / 3;
      const put = (u: number, v: number, c: number[]) => {
        if (plane === 0) pos.push(u, v, 0.001 * sgn);
        else pos.push(0.001 * sgn, v, u);
        col.push(c[0], c[1], c[2]);
      };
      put(0, 0, hot);
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 2;
        const r = i % 2 === 0 ? 0.5 : inner;
        put(Math.cos(a) * r, Math.sin(a) * r, i % 2 === 0 ? tip : hot);
      }
      for (let i = 0; i < 8; i += 1) {
        const a = base + 1 + i;
        const b = base + 1 + ((i + 1) % 8);
        const flip = (plane === 0 ? 1 : -1) * sgn > 0;
        if (flip) idx.push(base, a, b);
        else idx.push(base, b, a);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class Sparkles {
  readonly mesh: THREE.InstancedMesh;
  private readonly spots: Array<SparkleSpot & { phase: number; rate: number }>;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();

  constructor(spots: SparkleSpot[], name = 'sparkles', seed = 1) {
    let s = seed * 9301 + 49297;
    const rnd = () => {
      s = (s * 9301 + 49297) % 233280;
      return s / 233280;
    };
    this.spots = spots.map((sp) => ({ ...sp, phase: rnd() * Math.PI * 2, rate: 1.4 + rnd() * 1.6 }));
    this.mesh = new THREE.InstancedMesh(sparkleGeometry(), mat('glow'), spots.length);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.update(0);
  }

  update(time: number): void {
    for (let i = 0; i < this.spots.length; i += 1) {
      const sp = this.spots[i];
      const t = Math.sin(time * sp.rate + sp.phase);
      const k = Math.pow(Math.max(0, t), 3);
      const scale = sp.s * (0.05 + 0.95 * k);
      this.e.set(0, time * 0.6 + sp.phase, Math.sin(time * 0.4 + sp.phase) * 0.3);
      this.q.setFromEuler(this.e);
      this.v.set(sp.p[0], sp.p[1] + Math.sin(time * 0.9 + sp.phase) * 0.12, sp.p[2]);
      this.sc.setScalar(scale);
      this.m.compose(this.v, this.q, this.sc);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}
