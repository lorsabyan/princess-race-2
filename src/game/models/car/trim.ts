import * as THREE from 'three';
import { capsule, cone, cyl, extrude, lathe, rbox, sphere, torus } from '../kit/geo';
import { PAL } from '../kit/palette';
import type { SdfNode } from '../kit/sdf';
import { Assembler, ROLE_INTERIOR, ROLE_PAINT } from './assembler';
import { PBR } from './carMaterials';
import { CAR, COVE } from './layout';
import { traceSurface, type SurfaceHit } from './sdfExtra';
import { heartOutline, outlineTube, pathTube, pillow, smileOutline } from './shapes';
import { revolveX, type WheelBuild } from './wheel';

export interface TrimContext {
  /** Static parts sharing the car PBR material. */
  body: Assembler;
  /** Unlit glowing lenses. */
  glow: Assembler;
  /** Final hull field (with cockpit). */
  field: SdfNode;
  /** Hull before the cockpit carve. */
  shell: SdfNode;
}

type V3 = [number, number, number];

const UP = new THREE.Vector3(0, 1, 0);

/** Euler that turns local +Z toward `n` while keeping local +Y as close to `up` as possible. */
function faceEuler(n: THREE.Vector3 | V3, up: THREE.Vector3 = UP): V3 {
  const z = Array.isArray(n) ? new THREE.Vector3(...n) : n.clone();
  z.normalize();
  const x = new THREE.Vector3().crossVectors(up, z);
  if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
  x.normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, z);
  const e = new THREE.Euler().setFromRotationMatrix(m, 'XYZ');
  return [e.x, e.y, e.z];
}

function hit(field: SdfNode, o: V3, d: V3): SurfaceHit {
  const h = traceSurface(field, o, d, 5, 0.01);
  if (!h) throw new Error(`car trim: surface not found from ${o.join(',')}`);
  return h;
}

function add(p: V3, n: V3, s: number): V3 {
  return [p[0] + n[0] * s, p[1] + n[1] * s, p[2] + n[2] * s];
}

// ---------------------------------------------------------------------------
// Seat: puffy cream cushion + reclined tufted heart backrest with gold piping.
// ---------------------------------------------------------------------------
export function addSeat(ctx: TrimContext): void {
  const b = ctx.body;
  const [, sy, sz] = CAR.seat;
  // Pedestal (interior color) and cushion; cushion top surface exactly at the seat height.
  b.add(rbox(0.5, 0.14, 0.38, 0.05, 1), PAL.carInterior, PBR.interior, { p: [0, sy - 0.17, sz + 0.02], role: ROLE_INTERIOR });
  const cushion = new THREE.Vector2(0, 0);
  const cushionOutline: THREE.Vector2[] = [];
  const cw = 0.29;
  const cd = 0.23;
  for (let i = 0; i < 28; i += 1) {
    const a = (i / 28) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    // Superellipse (rounded square) outline.
    cushionOutline.push(new THREE.Vector2(Math.sign(c) * Math.pow(Math.abs(c), 0.45) * cw, Math.sign(s) * Math.pow(Math.abs(s), 0.45) * cd));
  }
  const cushionGeo = pillow(cushionOutline, cushion, {
    front: 0.05,
    back: 0.05,
    flat: 3.2,
    rings: [0.4, 0.72, 0.9, 1],
  });
  // Pillow faces +Z; lay it flat (front up) with its top at the seat height.
  b.add(cushionGeo, PAL.seat, PBR.leather, { p: [0, sy - 0.05, sz], r: [-Math.PI / 2, 0, 0], s: [1, 1, 1] });
  // Front bolster roll.
  b.add(capsule(0.048, 0.44, 3, 9), PAL.seat, PBR.leather, { p: [0, sy - 0.055, sz - 0.2], r: [0, 0, Math.PI / 2] });

  // Heart backrest.
  const size = 0.74;
  const outline = heartOutline(size, 40);
  const center = new THREE.Vector2(0, 0.0);
  const buttons: THREE.Vector2[] = [];
  const rows: Array<[number, number[]]> = [
    [0.19, [-0.2, 0.2]],
    [0.1, [-0.1, 0.1]],
    [0.01, [-0.2, 0, 0.2]],
    [-0.08, [-0.1, 0.1]],
    [-0.17, [0]],
  ];
  for (const [y, xs] of rows) for (const x of xs) buttons.push(new THREE.Vector2(x, y));
  const dent = (x: number, y: number) => {
    let d = 0;
    for (const p of buttons) {
      const r2 = (x - p.x) ** 2 + (y - p.y) ** 2;
      d -= 0.022 * Math.exp(-r2 / 0.0016);
    }
    return d;
  };
  const front = 0.075;
  const heart = pillow(outline, center, {
    front,
    back: 0.05,
    dent,
    flat: 2.6,
    rings: [0.2, 0.42, 0.62, 0.78, 0.9, 1],
  });
  const recline = 0.2;
  const heartTop = size * 0.5 * 0.9;
  const hy = sy + 0.55 - heartTop * Math.cos(recline);
  const hz = sz + 0.28 + front;
  const heartOpts = { p: [0, hy, hz] as V3, r: [recline, Math.PI, 0] as V3 };
  b.add(heart, PAL.seat, PBR.leather, heartOpts);
  // Gold piping around the heart rim.
  const piping = outlineTube(outline, 0.014, (p) => new THREE.Vector3(p.x, p.y, 0), 52, 5);
  b.add(piping, PAL.gold, PBR.gold, heartOpts);
  // Tufting buttons (little pearls sitting in the dents).
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...heartOpts.p),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...heartOpts.r)),
    new THREE.Vector3(1, 1, 1),
  );
  const btn = sphere(0.016, 5, 3);
  for (const p of buttons) {
    const rho = rhoInOutline(outline, center, p);
    const prof = Math.pow(Math.max(0, 1 - Math.pow(rho, 2.6)), 0.5);
    const z = (front + dent(p.x, p.y)) * prof;
    const w = new THREE.Vector3(p.x, p.y, z + 0.004).applyMatrix4(m);
    b.add(btn, PAL.seatTuft, PBR.leather, { p: [w.x, w.y, w.z] });
  }
}

/** Approximate radial position (0 center .. 1 rim) of a point inside a star-shaped outline. */
function rhoInOutline(outline: THREE.Vector2[], c: THREE.Vector2, p: THREE.Vector2): number {
  const a = Math.atan2(p.y - c.y, p.x - c.x);
  let best = outline[0];
  let bestDa = Infinity;
  for (const q of outline) {
    let da = Math.abs(Math.atan2(q.y - c.y, q.x - c.x) - a);
    if (da > Math.PI) da = 2 * Math.PI - da;
    if (da < bestDa) {
      bestDa = da;
      best = q;
    }
  }
  return Math.min(1, p.distanceTo(c) / Math.max(1e-4, best.distanceTo(c)));
}

// ---------------------------------------------------------------------------
// Padded cream coaming around the cockpit opening (hides the paint/interior seam).
// ---------------------------------------------------------------------------
export function addCoaming(ctx: TrimContext, cockpit: { hx: number; hz: number; r: number; cz: number }): void {
  const pts: THREE.Vector3[] = [];
  const { hx, hz, r, cz } = cockpit;
  const N = 72;
  const perim = (t: number): [number, number] => {
    // Rounded rectangle, param t in [0,1).
    const straightX = 2 * (hx - r);
    const straightZ = 2 * (hz - r);
    const arc = (Math.PI / 2) * r;
    const total = 2 * straightX + 2 * straightZ + 4 * arc;
    let s = t * total;
    const segs: Array<[number, (u: number) => [number, number]]> = [
      [straightX, (u) => [-(hx - r) + u, -hz]],
      [arc, (u) => { const a = -Math.PI / 2 + u / r; return [hx - r + Math.cos(a) * r, -(hz - r) + Math.sin(a) * r]; }],
      [straightZ, (u) => [hx, -(hz - r) + u]],
      [arc, (u) => { const a = u / r; return [hx - r + Math.cos(a) * r, hz - r + Math.sin(a) * r]; }],
      [straightX, (u) => [hx - r - u, hz]],
      [arc, (u) => { const a = Math.PI / 2 + u / r; return [-(hx - r) + Math.cos(a) * r, hz - r + Math.sin(a) * r]; }],
      [straightZ, (u) => [-hx, hz - r - u]],
      [arc, (u) => { const a = Math.PI + u / r; return [-(hx - r) + Math.cos(a) * r, -(hz - r) + Math.sin(a) * r]; }],
    ];
    for (const [len, f] of segs) {
      if (s <= len) return f(s);
      s -= len;
    }
    return segs[0][1](0);
  };
  for (let i = 0; i < N; i += 1) {
    const [x, z0] = perim(i / N);
    const z = z0 + cz;
    const h = hit(ctx.shell, [x, 1.6, z], [0, -1, 0]);
    pts.push(new THREE.Vector3(x, h.p[1] - 0.012, z));
  }
  const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  ctx.body.add(new THREE.TubeGeometry(curve, 72, 0.036, 6, true), PAL.seat, PBR.leather);
}

// ---------------------------------------------------------------------------
// Dashboard: two little cream gauges with chrome bezels.
// ---------------------------------------------------------------------------
export function addDash(ctx: TrimContext): void {
  for (const x of [-0.2, 0.2]) {
    const h = hit(ctx.field, [x, 0.8, 0.1], [0, 0, -1]);
    const n: V3 = [h.n[0], h.n[1] + 0.35, h.n[2]];
    const e = faceEuler(n);
    const p = add(h.p, h.n, 0.012);
    ctx.body.add(cyl(0.05, 0.05, 0.03, 24), PAL.chrome, PBR.chrome, { p, r: [e[0] + Math.PI / 2, e[1], e[2]] });
    ctx.body.add(cyl(0.04, 0.04, 0.034, 24), PAL.whitewall, PBR.enamel, { p: add(p, h.n, 0.002), r: [e[0] + Math.PI / 2, e[1], e[2]] });
    // Needle.
    ctx.body.add(new THREE.BoxGeometry(0.007, 0.032, 0.005), PAL.doorBerry, PBR.enamel, { p: add(add(p, h.n, 0.02), [0, 1, 0], 0.008), r: [e[0], e[1], e[2] + (x > 0 ? -0.6 : 0.5)] });
  }
}

// ---------------------------------------------------------------------------
// Windshield: wrap-around raked glass with a gold frame. Returns the glass geometry.
// ---------------------------------------------------------------------------
export function buildWindshield(ctx: TrimContext): THREE.BufferGeometry {
  const halfW = 0.6;
  const height = 0.34;
  const corner = 0.12;
  const rake = (22 * Math.PI) / 180;
  const bend = 1.3;
  const baseZ = -0.6;
  const cols = 24;
  const rows = 6;
  // Local pane coords (u across, v up the glass) -> world.
  const toWorld = (u: number, v: number, base: number): THREE.Vector3 => {
    const a = u / bend;
    const x = Math.sin(a) * bend;
    const zb = baseZ + (1 - Math.cos(a)) * bend;
    return new THREE.Vector3(x, base + v * Math.cos(rake), zb + v * Math.sin(rake));
  };
  // Base height per column: the cowl surface under the glass.
  const baseAt = (u: number): number => {
    const p = toWorld(u, 0, 0);
    const h = hit(ctx.shell, [p.x, 1.6, p.z], [0, -1, 0]);
    return h.p[1] - 0.03;
  };
  const topAt = (u: number, base: number): number => {
    const au = Math.abs(u);
    const top = 0.93 + height - base; // glass top line is level in world space
    if (au <= halfW - corner) return top;
    const dx = au - (halfW - corner);
    return top - corner + Math.sqrt(Math.max(0, corner * corner - dx * dx));
  };
  const pos: number[] = [];
  const idx: number[] = [];
  const bases: number[] = [];
  for (let i = 0; i <= cols; i += 1) {
    const u = -halfW + (2 * halfW * i) / cols;
    const base = baseAt(u);
    bases.push(base);
    const vt = topAt(u, base);
    for (let j = 0; j <= rows; j += 1) {
      const v = (vt * j) / rows;
      const p = toWorld(u, v, base);
      pos.push(p.x, p.y, p.z);
    }
  }
  for (let i = 0; i < cols; i += 1) {
    for (let j = 0; j < rows; j += 1) {
      const a = i * (rows + 1) + j;
      const b2 = (i + 1) * (rows + 1) + j;
      idx.push(a, b2, a + 1, b2, b2 + 1, a + 1);
    }
  }
  const glass = new THREE.BufferGeometry();
  glass.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  glass.setIndex(idx);
  glass.computeVertexNormals();

  // Gold frame along the sides and top.
  const frame: THREE.Vector3[] = [];
  const edgeU = halfW;
  const steps = 26;
  const baseL = bases[0];
  const baseR = bases[bases.length - 1];
  frame.push(toWorld(-edgeU, -0.02, baseL));
  for (let i = 0; i <= steps; i += 1) {
    const u = -halfW + (2 * halfW * i) / steps;
    const base = i === 0 ? baseL : i === steps ? baseR : baseAt(u);
    const vt = topAt(u, base);
    if (i === 0) frame.push(toWorld(u, vt * 0.5, base));
    frame.push(toWorld(u, vt, base));
    if (i === steps) frame.push(toWorld(u, vt * 0.5, base));
  }
  frame.push(toWorld(edgeU, -0.02, baseR));
  ctx.body.add(pathTube(frame, 0.017, 80, 7), PAL.gold, PBR.gold);
  // Bottom seal strip (gold) along the cowl.
  const seal: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i += 1) {
    const u = -halfW + (2 * halfW * i) / 12;
    seal.push(toWorld(u, 0.012, bases[Math.round((i / 12) * cols)]));
  }
  ctx.body.add(pathTube(seal, 0.013, 24, 5), PAL.gold, PBR.gold);

  // Cartoon glints: two diagonal streaks baked into the glass as a `glint` attribute.
  const gl = new Float32Array(pos.length / 3);
  for (let i = 0; i <= cols; i += 1) {
    const u = -halfW + (2 * halfW * i) / cols;
    for (let j = 0; j <= rows; j += 1) {
      const v = j / rows;
      const d = u + v * 0.32;
      const band = (c: number, w: number) => Math.max(0, 1 - Math.abs(d - c) / w);
      gl[i * (rows + 1) + j] = Math.min(1, band(-0.2, 0.06) + band(-0.05, 0.03)) * (0.35 + 0.65 * v);
    }
  }
  glass.setAttribute('glint', new THREE.BufferAttribute(gl, 1));
  return glass;
}

// ---------------------------------------------------------------------------
// Chrome bumpers (oval bars following the nose / tail) with overriders.
// ---------------------------------------------------------------------------
export function addBumpers(ctx: TrimContext): { rearZ: number; rearY: number } {
  const yF = 0.36;
  const yR = 0.36;
  const front: THREE.Vector3[] = [];
  const rear: THREE.Vector3[] = [];
  const xs = [-0.66, -0.58, -0.46, -0.3, -0.15, 0, 0.15, 0.3, 0.46, 0.58, 0.66];
  for (const x of xs) {
    const f = hit(ctx.field, [x, yF, -2.5], [0, 0, 1]);
    front.push(new THREE.Vector3(x * 1.03, yF, f.p[2] - 0.06));
    const r = hit(ctx.field, [x, yR, 2.5], [0, 0, -1]);
    rear.push(new THREE.Vector3(x * 1.03, yR, r.p[2] + 0.06));
  }
  const bar = (pts: THREE.Vector3[], y: number) => {
    const g = pathTube(pts, 0.045, 32, 7);
    // Oval section: stretch vertically around the bar height.
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i += 1) pos.setY(i, y + (pos.getY(i) - y) * 1.45);
    g.computeVertexNormals();
    return g;
  };
  ctx.body.add(bar(front, yF), PAL.chrome, PBR.chrome);
  ctx.body.add(bar(rear, yR), PAL.chrome, PBR.chrome);
  for (const pts of [front, rear]) {
    for (const end of [pts[0], pts[pts.length - 1]]) {
      ctx.body.add(sphere(0.045, 10, 6), PAL.chrome, PBR.chrome, { p: [end.x, end.y, end.z], s: [1, 1.45, 1] });
    }
  }
  // Overriders on the front bumper.
  for (const x of [-0.3, 0.3]) {
    const p = front.find((q) => Math.abs(q.x - x * 1.03) < 1e-3)!;
    ctx.body.add(capsule(0.032, 0.1, 4, 10), PAL.chrome, PBR.chrome, { p: [p.x, p.y + 0.02, p.z - 0.03] });
  }
  const mid = rear[Math.floor(rear.length / 2)];
  return { rearZ: mid.z, rearY: yR };
}

// ---------------------------------------------------------------------------
// Grille "smile": dark inset + chrome surround + two slats, shrink-wrapped onto the nose.
// ---------------------------------------------------------------------------
export function addGrille(ctx: TrimContext): void {
  const cy = 0.46;
  const w = 0.2;
  const thick = 0.085;
  const curl = 0.05;
  const outline = smileOutline(w, thick, curl);
  // Sample the nose surface over the grille area; the grille is shrink-wrapped onto it.
  const gx = 25;
  const gy = 9;
  const x0 = -w - 0.05;
  const x1 = w + 0.05;
  const y0 = cy - 0.07;
  const y1 = cy + 0.09;
  const noseZ: number[] = [];
  for (let j = 0; j < gy; j += 1) {
    for (let i = 0; i < gx; i += 1) {
      const x = x0 + ((x1 - x0) * i) / (gx - 1);
      const y = y0 + ((y1 - y0) * j) / (gy - 1);
      const h = traceSurface(ctx.field, [x, y, -2.5], [0, 0, 1], 5, 0.01);
      noseZ.push(h ? h.p[2] : -1.6);
    }
  }
  const zAt = (x: number, y: number): number => {
    const u = Math.min(gx - 1.001, Math.max(0, ((x - x0) / (x1 - x0)) * (gx - 1)));
    const v = Math.min(gy - 1.001, Math.max(0, ((y - y0) / (y1 - y0)) * (gy - 1)));
    const i = Math.floor(u);
    const j = Math.floor(v);
    const fu = u - i;
    const fv = v - j;
    const a = noseZ[j * gx + i] * (1 - fu) + noseZ[j * gx + i + 1] * fu;
    const b = noseZ[(j + 1) * gx + i] * (1 - fu) + noseZ[(j + 1) * gx + i + 1] * fu;
    return a * (1 - fv) + b * fv;
  };
  const zRef = -1.7;
  const g = new Assembler();
  const e: V3 = [0, Math.PI, 0];
  // Dark slab reaching back into the nose (only its face shows).
  const depth = 0.07;
  const slab = extrude(new THREE.Shape(outline), depth, 0.006, 2, 8);
  slab.translate(0, 0, -depth / 2 - 0.006);
  g.add(slab, '#4b2446', PBR.recess, { p: [0, cy, zRef], r: e });
  const m = new THREE.Matrix4().compose(new THREE.Vector3(0, cy, zRef), new THREE.Quaternion().setFromEuler(new THREE.Euler(...e)), new THREE.Vector3(1, 1, 1));
  // Chrome surround.
  g.add(outlineTube(outline, 0.016, (q) => new THREE.Vector3(q.x, q.y, 0.002).applyMatrix4(m), 44, 5), PAL.chrome, PBR.chrome);
  // Two slim horizontal slats following the smile curve (a grille, not teeth).
  const mid = (x: number) => (thick * 0.42 + curl * 0.7 * (x / w) ** 2 + (-thick * 0.58 + curl * 1.25 * (x / w) ** 2)) / 2;
  for (const off of [-0.017, 0.015]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 10; i += 1) {
      const x = -w * 0.86 + (w * 1.72 * i) / 10;
      pts.push(new THREE.Vector3(x, mid(x) + off * (1 - 0.35 * (x / w) ** 2), 0.004).applyMatrix4(m));
    }
    g.add(pathTube(pts, 0.0075, 16, 4), PAL.chrome, PBR.chrome);
  }
  // Wrap: shift every vertex so the grille face rides ~1 cm in front of the nose.
  const built = g.build();
  const pos = built.geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    pos.setZ(i, pos.getZ(i) + (zAt(x, y) - 0.011 - zRef));
  }
  built.geometry.computeVertexNormals();
  ctx.body.addColored(built.geometry, built.geometry.attributes.pbr.array as Float32Array);
  built.geometry.dispose();
}

// ---------------------------------------------------------------------------
// Headlights: chrome bezel + warm glowing lens in the fender pods.
// ---------------------------------------------------------------------------
export function addHeadlights(ctx: TrimContext): void {
  for (const x of [-0.6, 0.6]) {
    const h = hit(ctx.field, [x, 0.72, -2.5], [0, 0, 1]);
    const n = new THREE.Vector3(...h.n);
    n.y += 0.05;
    const e = faceEuler(n);
    const p = add(h.p, h.n, 0.006);
    ctx.body.add(torus(0.1, 0.022, 8, 28), PAL.chrome, PBR.chrome, { p, r: e });
    // Chrome bucket lip behind the bezel.
    ctx.body.add(cyl(0.118, 0.118, 0.03, 28, true), PAL.chrome, PBR.chrome, { p: add(p, h.n, -0.012), r: [e[0] + Math.PI / 2, e[1], e[2]] });
    const lensOutline: THREE.Vector2[] = [];
    for (let i = 0; i < 36; i += 1) {
      const a = (i / 36) * Math.PI * 2;
      lensOutline.push(new THREE.Vector2(Math.cos(a) * 0.092, Math.sin(a) * 0.092));
    }
    const lens = pillow(lensOutline, new THREE.Vector2(0, 0), { front: 0.035, back: 0, rings: [0.25, 0.5, 0.72, 0.9, 1], flat: 2 });
    const warm = new THREE.Color('#fff0c8');
    const core = new THREE.Color('#fffdf6');
    const tmp = new THREE.Color();
    const lp = new THREE.Vector3(...p);
    ctx.glow.add(
      lens,
      (lx, ly, lz) => {
        const dx = lx - lp.x;
        const dy = ly - lp.y;
        const r = Math.hypot(dx, dy, lz - lp.z) / 0.092;
        // Fresnel-lens rings, a brighter core and a sparkle toward the sun side (upper, world -X).
        const rings = 0.9 + 0.1 * Math.cos(r * Math.PI * 9);
        const sparkle = Math.max(0, 1 - Math.hypot(dx + 0.032, dy - 0.034) / 0.02);
        return tmp.copy(warm).lerp(core, Math.max(0, 1 - r * 1.6)).multiplyScalar(rings * (1 + sparkle * 1.2));
      },
      PBR.enamel,
      { p, r: e, gain: 1.05 },
    );
  }
}

// ---------------------------------------------------------------------------
// Heart tail lights with chrome heart rims.
// ---------------------------------------------------------------------------
export function addTailLights(ctx: TrimContext): void {
  for (const x of [-0.5, 0.5]) {
    const h = hit(ctx.field, [x, 0.66, 2.5], [0, 0, -1]);
    const n = new THREE.Vector3(...h.n);
    n.y += 0.22;
    const e = faceEuler(n);
    const p = add(h.p, h.n, 0.004);
    const outline = heartOutline(0.25, 44);
    const lamp = pillow(outline, new THREE.Vector2(0, 0), { front: 0.045, back: 0, rings: [0.3, 0.6, 0.82, 0.95, 1], flat: 2.2 });
    const base = new THREE.Color(PAL.tailLight);
    const hot = new THREE.Color('#ff8fb0');
    const tmp = new THREE.Color();
    const lp = new THREE.Vector3(...p);
    ctx.glow.add(
      lamp,
      (lx, ly, lz) => {
        const k = Math.max(0, 1 - Math.hypot(lx - lp.x, ly - lp.y - 0.015, lz - lp.z) / 0.075);
        return tmp.copy(base).lerp(hot, k * 0.7).multiplyScalar(1 + k * 0.9);
      },
      PBR.enamel,
      { p, r: e, gain: 2.1 },
    );
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...e)), new THREE.Vector3(1, 1, 1));
    const rim = outlineTube(outline, 0.014, (q) => new THREE.Vector3(q.x * 1.04, q.y * 1.04, 0.0).applyMatrix4(m), 48, 6);
    ctx.body.add(rim, PAL.chrome, PBR.chrome);
  }
}

// ---------------------------------------------------------------------------
// Tiny gold crown hood ornament.
// ---------------------------------------------------------------------------
export function addCrown(ctx: TrimContext): void {
  const h = hit(ctx.field, [0, 2, -1.36], [0, -1, 0]);
  const g = new Assembler();
  const s = 1.25;
  // Band: a flared gold cup with a rolled rim.
  g.add(lathe([[0.046, 0], [0.05, 0.008], [0.052, 0.026], [0.058, 0.038]], 24), PAL.gold, PBR.gold);
  g.add(torus(0.047, 0.008, 6, 24), PAL.gold, PBR.gold, { p: [0, 0.003, 0], r: [Math.PI / 2, 0, 0] });
  // Five rounded points with pearls.
  for (let i = 0; i < 5; i += 1) {
    const a = (i / 5) * Math.PI * 2;
    const x = Math.sin(a) * 0.052;
    const z = -Math.cos(a) * 0.052;
    g.add(cone(0.017, 0.04, 7), PAL.gold, PBR.gold, { p: [x, 0.055, z], r: [-Math.cos(a) * 0.18, 0, -Math.sin(a) * 0.18] });
    g.add(sphere(0.011, 6, 5), PAL.pearl, PBR.enamel, { p: [x * 1.06, 0.078, z * 1.06] });
  }
  // Pink jewel on the front of the band.
  g.add(sphere(0.016, 10, 8), PAL.gemPink, PBR.enamel, { p: [0, 0.02, -0.055], s: [1, 1, 0.6] });
  const built = g.build();
  const tilt = Math.atan2(-h.n[2], h.n[1]);
  const mat4 = new THREE.Matrix4().compose(
    new THREE.Vector3(h.p[0], h.p[1] - 0.006, h.p[2]),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-tilt, 0, 0)),
    new THREE.Vector3(s, s, s),
  );
  ctx.body.addColored(built.geometry, built.geometry.attributes.pbr.array as Float32Array, { matrix: mat4 });
  built.geometry.dispose();
}

// ---------------------------------------------------------------------------
// Spare wheel on the tail (continental kit) with a chrome mount.
// ---------------------------------------------------------------------------
export function addSpare(ctx: TrimContext, wheel: WheelBuild): { center: THREE.Vector3 } {
  const { y, scale, lean } = CAR.spare;
  const h = hit(ctx.field, [0, y, 2.5], [0, 0, -1]);
  const z = h.p[2] + CAR.wheelW * 0.5 * scale + 0.015;
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(0, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(-lean, -Math.PI / 2, 0, 'XYZ')),
    new THREE.Vector3(scale, scale, scale),
  );
  ctx.body.addColored(wheel.geometry, wheel.geometry.attributes.pbr.array as Float32Array, {
    matrix: m,
    role: wheel.recolor.role,
    t: wheel.recolor.t,
    k: wheel.recolor.k,
  });
  // Mount post into the tail.
  ctx.body.add(cyl(0.035, 0.035, 0.2, 14), PAL.chrome, PBR.chrome, { p: [0, y, h.p[2] + 0.02], r: [Math.PI / 2 - lean, 0, 0] });
  // Painted cover over the wheel's face: a big gold-ringed heart right where the chase camera looks.
  const R = CAR.wheelR;
  const a0 = (CAR.wheelW / 2) * 0.74;
  const dome = revolveX(
    [
      [a0 - 0.006, R * 0.6],
      [a0 + 0.02, R * 0.56],
      [a0 + 0.04, R * 0.4],
      [a0 + 0.05, R * 0.001],
    ],
    32,
  );
  dome.applyMatrix4(m);
  ctx.body.add(dome, PAL.carPaint, PBR.paint, { role: ROLE_PAINT, t: 0.25 });
  const ring = torus(R * 0.585, 0.014, 6, 32);
  ring.rotateY(Math.PI / 2);
  ring.translate(a0 + 0.012, 0, 0);
  ring.applyMatrix4(m);
  ctx.body.add(ring, PAL.gold, PBR.gold);
  // Pillows bulge toward +Z: turn it to the wheel's face (+X) with the heart's top up the world.
  const heart = pillow(heartOutline(R * 0.82, 30), new THREE.Vector2(0, 0), { front: 0.022, back: 0, rings: [0.5, 0.85, 1], flat: 2.2 });
  heart.rotateY(Math.PI / 2);
  heart.translate(a0 + 0.05, 0, 0);
  heart.applyMatrix4(m);
  ctx.body.add(heart, PAL.seat, PBR.enamel);
  return { center: new THREE.Vector3(0, y, z) };
}

/**
 * Shrink-wrap a geometry built facing +Z (at the origin) onto the body: it is placed at
 * `p` facing the surface normal, then every vertex is projected onto the surface and
 * lifted by `lift` plus its own local Z (so thin pillows keep their puff).
 */
function wrapOnto(field: SdfNode, g: THREE.BufferGeometry, h: SurfaceHit, lift: number): THREE.BufferGeometry {
  const e = faceEuler(h.n);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...h.p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...e)), new THREE.Vector3(1, 1, 1));
  const out = g.clone();
  const pos = out.attributes.position as THREE.BufferAttribute;
  const n = new THREE.Vector3(...h.n);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 1) {
    const localZ = pos.getZ(i);
    v.set(pos.getX(i), pos.getY(i), 0).applyMatrix4(m);
    const o: V3 = [v.x + n.x * 0.08, v.y + n.y * 0.08, v.z + n.z * 0.08];
    const hitP = traceSurface(field, o, [-n.x, -n.y, -n.z], 0.2, 0.004);
    const base = hitP ? new THREE.Vector3(...hitP.p) : v;
    base.addScaledVector(n, lift + localZ);
    pos.setXYZ(i, base.x, base.y, base.z);
  }
  out.computeVertexNormals();
  return out;
}

// ---------------------------------------------------------------------------
// Door hearts (cream decal with gold piping) + little chrome door handles.
// ---------------------------------------------------------------------------
export function addDoorHearts(ctx: TrimContext): void {
  for (const side of [-1, 1]) {
    const h = hit(ctx.field, [side * 1.4, COVE.y, COVE.z - 0.05], [-side, 0, 0]);
    const outline = heartOutline(0.2, 28);
    const heart = pillow(outline, new THREE.Vector2(0, 0), { front: 0.006, back: 0, rings: [0.5, 0.88, 1], flat: 2.5 });
    const wrapped = wrapOnto(ctx.field, heart, h, 0.0025);
    ctx.body.add(wrapped, PAL.gemPink, PBR.enamel);
    const rim = outlineTube(outline, 0.008, (q) => new THREE.Vector3(q.x * 1.02, q.y * 1.02, 0), 34, 4);
    ctx.body.add(wrapOnto(ctx.field, rim, h, 0.004), PAL.gold, PBR.gold);
    // Door handle: a small chrome capsule behind the heart, near the top of the door.
    const hh = hit(ctx.field, [side * 1.4, 0.8, 0.44], [-side, 0, 0]);
    ctx.body.add(capsule(0.016, 0.1, 4, 8), PAL.chrome, PBR.chrome, {
      p: add(hh.p, hh.n, 0.012),
      r: [Math.PI / 2, 0, 0],
    });
  }
}

// ---------------------------------------------------------------------------
// Heart-shaped wing mirrors on chrome stalks, on top of the doors.
// ---------------------------------------------------------------------------
export function addMirrors(ctx: TrimContext): void {
  const heart = pillow(heartOutline(0.15, 20), new THREE.Vector2(0, 0), { front: 0.026, back: 0.012, rings: [0.5, 1], flat: 2.2 });
  for (const side of [-1, 1]) {
    const h = hit(ctx.field, [side * 0.62, 1.6, -0.34], [0, -1, 0]);
    const base = new THREE.Vector3(...h.p);
    const top = new THREE.Vector3(side * 0.72, h.p[1] + 0.14, -0.36);
    ctx.body.add(pathTube([base, base.clone().lerp(top, 0.5).add(new THREE.Vector3(side * 0.03, 0, 0)), top], 0.011, 8, 6), PAL.chrome, PBR.chrome);
    // Paint-colored back with a mirror on the face that looks rearward at the driver.
    const r: V3 = [0.05, side * 0.18, 0];
    ctx.body.add(heart, PAL.carPaint, PBR.enamel, { p: [top.x, top.y + 0.012, top.z + 0.002], r: [r[0], r[1] + Math.PI, r[2]], role: ROLE_PAINT });
    ctx.body.add(heart, PAL.chrome, PBR.chrome, { p: [top.x, top.y + 0.012, top.z + 0.006], r, s: [0.84, 0.84, 0.6] });
  }
}

// ---------------------------------------------------------------------------
// Twin chrome tail pipes under the bumper and glowing bullets in the fin tips.
// ---------------------------------------------------------------------------
export function addTail(ctx: TrimContext, rear: { rearZ: number }): void {
  for (const side of [-1, 1]) {
    ctx.body.add(cyl(0.04, 0.036, 0.2, 14, true), PAL.chrome, PBR.chrome, { p: [side * 0.34, 0.24, rear.rearZ - 0.08], r: [Math.PI / 2, 0, 0] });
    ctx.body.add(cyl(0.034, 0.034, 0.01, 14), '#2c1a2e', PBR.recess, { p: [side * 0.34, 0.24, rear.rearZ + 0.012], r: [Math.PI / 2, 0, 0] });
    const h = hit(ctx.field, [side * 0.635, 0.9, 2.5], [0, 0, -1]);
    const e = faceEuler(h.n);
    const tip = add(h.p, h.n, 0.004);
    ctx.body.add(torus(0.042, 0.012, 6, 18), PAL.chrome, PBR.chrome, { p: tip, r: e });
    ctx.glow.add(new THREE.SphereGeometry(0.04, 14, 9), PAL.tailLight, PBR.enamel, { p: tip, r: e, s: [1, 1, 0.6], gain: 2.4 });
  }
}

// ---------------------------------------------------------------------------
// Puffy gold crown badge on the rear deck (seen from the chase camera).
// ---------------------------------------------------------------------------
export function addDeckCrown(ctx: TrimContext): void {
  const h = hit(ctx.field, [0, 2, 0.93], [0, -1, 0]);
  const S = 1.4;
  const pts: Array<[number, number]> = [
    [-0.07 * S, -0.035 * S],
    [0.07 * S, -0.035 * S],
    [0.078 * S, 0.03 * S],
    [0.04 * S, 0.004 * S],
    [0, 0.045 * S],
    [-0.04 * S, 0.004 * S],
    [-0.078 * S, 0.03 * S],
  ];
  // Round the outline a little by sampling a closed centripetal spline through the corners.
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, y]) => new THREE.Vector3(x, y, 0)), true, 'centripetal', 0.2);
  const outline = curve.getSpacedPoints(56).slice(0, -1).map((p) => new THREE.Vector2(p.x, p.y));
  const crown = pillow(outline, new THREE.Vector2(0, -0.005 * S), { front: 0.015, back: 0, rings: [0.4, 0.75, 0.93, 1], flat: 2.4 });
  // Face the chase camera a bit more than the deck normal does.
  const n = new THREE.Vector3(...h.n).add(new THREE.Vector3(0, 0, 0.35)).normalize();
  const faced: SurfaceHit = { p: h.p, n: [n.x, n.y, n.z] };
  ctx.body.add(wrapOnto(ctx.field, crown, faced, 0.002), PAL.gold, PBR.gold);
  const m = new THREE.Matrix4().compose(new THREE.Vector3(...h.p), new THREE.Quaternion().setFromEuler(new THREE.Euler(...faceEuler(n))), new THREE.Vector3(1, 1, 1));
  for (const [x, y] of [[-0.078, 0.03], [0, 0.045], [0.078, 0.03]]) {
    const p = new THREE.Vector3(x * S, y * S + 0.005, 0.014).applyMatrix4(m);
    ctx.body.add(sphere(0.014, 8, 6), PAL.pearl, PBR.enamel, { p: [p.x, p.y, p.z] });
  }
  const gem = new THREE.Vector3(0, -0.012 * S, 0.02).applyMatrix4(m);
  ctx.body.add(sphere(0.016, 8, 6), PAL.gemPink, PBR.enamel, { p: [gem.x, gem.y, gem.z], s: [1, 1, 0.7] });
}

/** Where the licence plate goes (center + facing), on the rear bumper. */
export function platePlacement(rear: { rearZ: number; rearY: number }): { p: V3; r: V3 } {
  return { p: [0, rear.rearY + 0.005, rear.rearZ + 0.052], r: [-0.08, 0, 0] };
}
