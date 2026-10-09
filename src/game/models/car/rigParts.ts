import * as THREE from 'three';
import { capsule, sphere, torus } from '../kit/geo';
import { PAL } from '../kit/palette';
import { Assembler } from './assembler';
import { PBR } from './carMaterials';
import { CAR } from './layout';
import { heartOutline, pillow } from './shapes';

// ---------------------------------------------------------------------------
// Steering wheel: cream rim, chrome spokes, gold heart hub, chrome column.
// Local frame: rim in the XY plane, +Z = axis pointing at the driver.
// ---------------------------------------------------------------------------
export function buildSteeringWheelGeometry(): THREE.BufferGeometry {
  const R = CAR.steerRadius;
  const a = new Assembler();
  a.add(torus(R, 0.024, 8, 36), PAL.seat, PBR.enamel);
  // Three spokes: left, right, bottom.
  for (const ang of [0, Math.PI, -Math.PI / 2]) {
    const len = R - 0.05;
    const cx = Math.cos(ang) * (0.05 + len / 2);
    const cy = Math.sin(ang) * (0.05 + len / 2);
    a.add(capsule(0.011, len, 4, 8), PAL.chrome, PBR.chrome, { p: [cx, cy, -0.012], r: [0, 0, ang + Math.PI / 2] });
  }
  // Hub: chrome boss + gold heart facing the driver.
  a.add(new THREE.CylinderGeometry(0.052, 0.058, 0.04, 24), PAL.chrome, PBR.chrome, { p: [0, 0, -0.015], r: [Math.PI / 2, 0, 0] });
  const heart = pillow(heartOutline(0.085, 48), new THREE.Vector2(0, 0), { front: 0.014, back: 0.004, rings: [0.35, 0.7, 0.9, 1] });
  a.add(heart, PAL.gold, PBR.gold, { p: [0, -0.002, 0.008] });
  // Column into the dash.
  a.add(new THREE.CylinderGeometry(0.019, 0.024, 0.3, 14), PAL.chrome, PBR.chrome, { p: [0, 0, -0.17], r: [Math.PI / 2, 0, 0] });
  return a.build().geometry;
}

// ---------------------------------------------------------------------------
// Antenna + pennant flag. CPU-deformed each frame (tiny mesh): the whip bends
// back with speed and wobbles on bumps; the flag droops when slow and ripples
// when streaming.
// ---------------------------------------------------------------------------
function sdHeart2(px: number, py: number): number {
  const x = Math.abs(px);
  if (py + x > 1) return Math.hypot(x - 0.25, py - 0.75) - Math.SQRT2 / 4;
  const m = 0.5 * Math.max(x + py, 0);
  return Math.sqrt(Math.min(x * x + (py - 1) ** 2, (x - m) ** 2 + (py - m) ** 2)) * Math.sign(x - py);
}

export interface PennantRig {
  mesh: THREE.Mesh;
  /** `swing` (-1..1) pushes the flag sideways (e.g. steering). */
  update(dt: number, time: number, speed: number, kick: number, swing?: number): void;
  dispose(): void;
}

/**
 * @param outward Yaw (radians) of the flag's streaming direction away from straight back.
 *   Negative turns it toward -X. A little outward angle lets the chase camera see the
 *   flag's face instead of its edge.
 */
export function createPennant(material: THREE.Material, outward = -0.5): PennantRig {
  const L = 0.72;
  const flagLen = 0.36;
  const flagHalf = 0.095;
  const attachY = L - 0.125;
  const NS = 22;
  const NT = 10;
  const a = new Assembler();
  // Base grommet + whip rod (many height segments so it can bend) + gold ball.
  a.add(sphere(0.03, 16, 8), PAL.chrome, PBR.chrome, { s: [1, 0.45, 1] });
  a.add(new THREE.CylinderGeometry(0.0055, 0.0085, L, 8, 20), PAL.chrome, PBR.chrome, { p: [0, L / 2, 0] });
  const rodEnd = a.vertexCount;
  a.add(sphere(0.022, 14, 10), PAL.gold, PBR.gold, { p: [0, L + 0.014, 0] });
  const flagStart = a.vertexCount;
  // Flag grid (two layers so both faces show with a front-side material).
  const halfAt = (s: number) => flagHalf * Math.pow(Math.max(0, 1 - s / flagLen), 0.9) + 0.006;
  const heartS = 0.1;
  const heartSize = 0.095;
  const flagColor = new THREE.Color('#ff77a6');
  const white = new THREE.Color('#fffaf6');
  const tmp = new THREE.Color();
  for (const side of [1, -1]) {
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= NS; i += 1) {
      const s = (flagLen * i) / NS;
      const h = halfAt(s);
      for (let j = 0; j <= NT; j += 1) {
        const t = -h + (2 * h * j) / NT;
        pos.push(side * 0.0015, attachY + t, s + 0.006);
      }
    }
    for (let i = 0; i < NS; i += 1) {
      for (let j = 0; j < NT; j += 1) {
        const p0 = i * (NT + 1) + j;
        const p1 = (i + 1) * (NT + 1) + j;
        if (side > 0) idx.push(p0, p0 + 1, p1, p1, p0 + 1, p1 + 1);
        else idx.push(p0, p1, p0 + 1, p1, p1 + 1, p0 + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const hs = heartSize / 1.2;
    a.add(
      g,
      (_x, y, z) => {
        const s = z - 0.006;
        const t = y - attachY;
        const d = sdHeart2((s - heartS) / hs, t / hs + 0.55);
        return tmp.copy(flagColor).lerp(white, d < -0.02 ? 1 : d < 0.02 ? 0.5 : 0);
      },
      PBR.cloth,
    );
  }
  const built = a.build();
  const geometry = built.geometry;
  const posAttr = geometry.attributes.position as THREE.BufferAttribute;
  const rest = new Float32Array(posAttr.array as Float32Array);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'car-pennant';
  mesh.castShadow = true;
  mesh.frustumCulled = false;

  let wobble = 0;
  let wobbleV = 0;
  let stream = 0;
  let yaw = outward;
  const arr = posAttr.array as Float32Array;
  return {
    mesh,
    update(dt, time, speed, kick, swing = 0) {
      const target = Math.min(1, Math.abs(speed) / 12);
      stream += (target - stream) * Math.min(1, dt * 2.5);
      // Whip wobble spring (kicked by bumps and speed changes).
      wobbleV += (-wobble * 90 - wobbleV * 5) * dt + kick * 2.2;
      wobble += wobbleV * dt;
      const bendBack = 0.04 + 0.13 * stream + wobble * 0.5;
      const sway = Math.sin(time * 2.1) * 0.012 + Math.sin(time * 5.3) * 0.006 * stream;
      const bendAt = (y: number): [number, number] => {
        const q = Math.max(0, y) / L;
        return [sway * q * q, bendBack * q * q];
      };
      // Rod + ball.
      for (let v = 0; v < flagStart; v += 1) {
        const y = rest[v * 3 + 1];
        const [bx, bz] = bendAt(v < rodEnd ? y : L);
        arr[v * 3] = rest[v * 3] + bx;
        arr[v * 3 + 1] = y - (bz * bz) * 0.5;
        arr[v * 3 + 2] = rest[v * 3 + 2] + bz;
      }
      // Flag (streams back, angled outward, swings with steering and flutters).
      const yawTarget = outward + swing * 0.45 + Math.sin(time * 1.7) * 0.06;
      yaw += (yawTarget - yaw) * Math.min(1, dt * 3);
      const cy = Math.cos(yaw);
      const sy = Math.sin(yaw);
      const [ax, az] = bendAt(attachY);
      const droop = (1 - stream) * 0.95 + Math.sin(time * 1.3) * 0.08 * (1 - stream);
      const cd = Math.cos(droop);
      const sd = Math.sin(droop);
      const amp = 0.012 + 0.03 * stream;
      const omega = 5 + 11 * stream;
      const count = arr.length / 3;
      for (let v = flagStart; v < count; v += 1) {
        const x0 = rest[v * 3];
        const t = rest[v * 3 + 1] - attachY;
        const s = rest[v * 3 + 2];
        const u = s / flagLen;
        const wave = Math.sin(omega * time - s * 22) * amp * u + Math.sin(omega * 0.6 * time - s * 12 + 1.3) * amp * 0.4 * u;
        const fx = x0 + wave;
        const fz = t * sd + s * cd;
        arr[v * 3] = ax + fx * cy + fz * sy;
        arr[v * 3 + 1] = attachY + t * cd - s * sd;
        arr[v * 3 + 2] = az - fx * sy + fz * cy;
      }
      posAttr.needsUpdate = true;
      geometry.computeVertexNormals();
    },
    dispose() {
      geometry.dispose();
    },
  };
}
