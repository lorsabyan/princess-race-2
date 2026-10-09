import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Memoized low-poly primitives for the town kit. Every factory returns a shared
 * geometry (never mutate it); Bins transforms and copies it on add. Segment
 * counts are tuned for the chase camera: round things stay round at 10-30 m,
 * nothing wastes triangles on detail the player can't see.
 */

const cache = new Map<string, THREE.BufferGeometry>();
const q = (n: number): string => (Math.round(n * 1000) / 1000).toString();

/** Debug: number of cached primitive geometries, their vertex total, and counts per key family. */
export function primCacheStats(): { count: number; vertices: number; families: Record<string, number> } {
  let vertices = 0;
  const families: Record<string, number> = {};
  for (const [k, g] of cache) {
    vertices += g.attributes.position.count;
    const parts = k.split(':');
    const fam = parts[0] === 'ext' || parts[0] === 'lathe' || parts[0] === 'tube' ? `${parts[0]}:${parts[1]}` : parts[0];
    families[fam] = (families[fam] ?? 0) + 1;
  }
  return { count: cache.size, vertices, families };
}

/** Debug: keys of cached primitives whose positions contain NaN. */
export function nanPrimitives(): string[] {
  const bad: string[] = [];
  for (const [k, g] of cache) {
    const a = g.attributes.position.array as ArrayLike<number>;
    for (let i = 0; i < a.length; i += 1) {
      if (Number.isNaN(a[i])) {
        bad.push(k);
        break;
      }
    }
    const n = g.attributes.normal?.array as ArrayLike<number> | undefined;
    if (n) {
      for (let i = 0; i < n.length; i += 1) {
        if (Number.isNaN(n[i])) {
          bad.push(`${k} (normal)`);
          break;
        }
      }
    }
  }
  return bad;
}

export function memo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = cache.get(key);
  if (!g) {
    g = make();
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    cache.set(key, g);
  }
  return g;
}

/** Plain box (crisp edges, 12 triangles). */
export function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return memo(`box:${q(w)}:${q(h)}:${q(d)}`, () => new THREE.BoxGeometry(w, h, d));
}

/** Unit box, scale it with `s` for cheap slabs. */
export function unitBox(): THREE.BufferGeometry {
  return box(1, 1, 1);
}

/** Rounded box (segments=1 -> 108 tris, 2 -> 300 tris). */
export function rbox(w: number, h: number, d: number, r = 0.06, seg = 1): THREE.BufferGeometry {
  return memo(`rbox:${q(w)}:${q(h)}:${q(d)}:${q(r)}:${seg}`, () => {
    const rr = Math.max(0.001, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
    return new RoundedBoxGeometry(w, h, d, seg, rr);
  });
}

export function cyl(rTop: number, rBottom: number, h: number, seg = 12, open = false): THREE.BufferGeometry {
  return memo(`cyl:${q(rTop)}:${q(rBottom)}:${q(h)}:${seg}:${open ? 1 : 0}`, () => new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, open));
}

/** Partial cylinder (e.g. half-round awnings, scallops). */
export function cylArc(r: number, h: number, seg: number, thetaStart: number, thetaLength: number, open = false): THREE.BufferGeometry {
  return memo(`cylarc:${q(r)}:${q(h)}:${seg}:${q(thetaStart)}:${q(thetaLength)}:${open ? 1 : 0}`, () =>
    new THREE.CylinderGeometry(r, r, h, seg, 1, open, thetaStart, thetaLength),
  );
}

export function sphere(r: number, ws = 12, hs = 8): THREE.BufferGeometry {
  return memo(`sph:${q(r)}:${ws}:${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
}

/** Hemisphere dome (upper half). */
export function dome(r: number, ws = 12, hs = 5): THREE.BufferGeometry {
  return memo(`dome:${q(r)}:${ws}:${hs}`, () => new THREE.SphereGeometry(r, ws, hs, 0, Math.PI * 2, 0, Math.PI / 2));
}

/** Faceted icosahedron (20 tris at detail 0). Good for flower heads and berries. */
export function ico(r: number, detail = 0): THREE.BufferGeometry {
  return memo(`ico:${q(r)}:${detail}`, () => new THREE.IcosahedronGeometry(r, detail));
}

/** Unit square pyramid: base corners at (±1, -0.5, ±1), apex at y = 0.5. Scale it freely. */
export function pyramid(): THREE.BufferGeometry {
  return memo('pyramid', () => {
    const g = new THREE.ConeGeometry(Math.SQRT2, 1, 4);
    g.rotateY(Math.PI / 4);
    return g.toNonIndexed();
  });
}

/** Unit square frustum: base corners at (±1, -0.5, ±1), top corners at (±top, 0.5, ±top). */
export function frustum4(top: number): THREE.BufferGeometry {
  return memo(`frustum4:${q(top)}`, () => {
    const g = new THREE.CylinderGeometry(Math.SQRT2 * top, Math.SQRT2, 1, 4, 1, false);
    g.rotateY(Math.PI / 4);
    return g.toNonIndexed();
  });
}

/** Half disc hanging below the X axis (flat edge on top), extruded along Z. */
export function halfDisc(r: number, depth: number, seg = 4): THREE.BufferGeometry {
  return memo(`halfdisc:${q(r)}:${q(depth)}:${seg}`, () => {
    const s = new THREE.Shape();
    s.moveTo(-r, 0);
    s.absarc(0, 0, r, Math.PI, Math.PI * 2, false);
    s.lineTo(-r, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: seg / 2 });
    g.translate(0, 0, -depth / 2);
    return g;
  });
}

/** Smooth icosphere (merged vertices, smooth normals). */
export function icoSmooth(r: number, detail = 1): THREE.BufferGeometry {
  return memo(`icos:${q(r)}:${detail}`, () => {
    const g = new THREE.IcosahedronGeometry(r, detail);
    g.deleteAttribute('normal');
    g.deleteAttribute('uv');
    const m = mergeVertices(g, 1e-4);
    m.computeVertexNormals();
    return m;
  });
}

export function capsule(r: number, len: number, cap = 3, radial = 8): THREE.BufferGeometry {
  return memo(`caps:${q(r)}:${q(len)}:${cap}:${radial}`, () => new THREE.CapsuleGeometry(r, len, cap, radial));
}

export function cone(r: number, h: number, seg = 12): THREE.BufferGeometry {
  return memo(`cone:${q(r)}:${q(h)}:${seg}`, () => new THREE.ConeGeometry(r, h, seg));
}

export function torus(R: number, r: number, radial = 6, tubular = 16, arc = Math.PI * 2): THREE.BufferGeometry {
  return memo(`torus:${q(R)}:${q(r)}:${radial}:${tubular}:${q(arc)}`, () => new THREE.TorusGeometry(R, r, radial, tubular, arc));
}

/** Lathe from [radius, y] points, optionally spline-smoothed. `key` must uniquely name the profile. */
export function lathe(key: string, profile: Array<[number, number]>, segments = 12, smooth = 0): THREE.BufferGeometry {
  return memo(`lathe:${key}:${segments}:${smooth}`, () => {
    let pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y));
    if (smooth > 0) pts = new THREE.SplineCurve(pts).getSpacedPoints(Math.max(8, pts.length * smooth));
    const g = new THREE.LatheGeometry(pts, segments);
    // Merge the seam so normals stay smooth all the way around.
    g.deleteAttribute('uv');
    const m = mergeVertices(g, 1e-4);
    m.computeVertexNormals();
    return m;
  });
}

export interface ExtrudeOpts {
  depth: number;
  bevel?: number;
  bevelSegments?: number;
  curveSegments?: number;
}

/** Extrude a 2D shape (XY) along Z, centered on Z. `key` must uniquely name the shape. */
export function extrude(key: string, shape: () => THREE.Shape | THREE.Shape[], o: ExtrudeOpts): THREE.BufferGeometry {
  const bevel = o.bevel ?? 0;
  return memo(`ext:${key}:${q(o.depth)}:${q(bevel)}:${o.bevelSegments ?? 1}:${o.curveSegments ?? 4}`, () => {
    const g = new THREE.ExtrudeGeometry(shape(), {
      depth: o.depth,
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: o.bevelSegments ?? 1,
      curveSegments: o.curveSegments ?? 4,
    });
    g.translate(0, 0, -o.depth / 2);
    return g;
  });
}

/** Uncached tube (for one-off curves such as bunting spans); dispose after use. */
export function tubeOnce(points: Array<[number, number, number]>, radius: number, tubular = 16, radial = 6): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const g = new THREE.TubeGeometry(curve, tubular, radius, radial, false);
  g.deleteAttribute('uv');
  return g;
}

/** Tube along points. */
export function tube(key: string, points: Array<[number, number, number]>, radius: number, tubular = 16, radial = 6): THREE.BufferGeometry {
  return memo(`tube:${key}:${q(radius)}:${tubular}:${radial}`, () => {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    return new THREE.TubeGeometry(curve, tubular, radius, radial, false);
  });
}

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export function rectShape(w: number, h: number, r = 0): THREE.Shape {
  const x = -w / 2;
  const y = -h / 2;
  const s = new THREE.Shape();
  if (r <= 0) {
    s.moveTo(x, y);
    s.lineTo(x + w, y);
    s.lineTo(x + w, y + h);
    s.lineTo(x, y + h);
    s.lineTo(x, y);
    return s;
  }
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Arch (rectangle with a semicircular top) with its base at y = 0. */
export function archPath(w: number, h: number, target: THREE.Path = new THREE.Shape(), reverse = false): THREE.Path {
  const r = w / 2;
  if (!reverse) {
    target.moveTo(-r, 0);
    target.lineTo(r, 0);
    target.lineTo(r, h - r);
    target.absarc(0, h - r, r, 0, Math.PI, false);
    target.lineTo(-r, 0);
  } else {
    target.moveTo(-r, 0);
    target.lineTo(-r, h - r);
    target.absarc(0, h - r, r, Math.PI, 0, true);
    target.lineTo(r, 0);
    target.lineTo(-r, 0);
  }
  return target;
}

export function archShape(w: number, h: number): THREE.Shape {
  return archPath(w, h, new THREE.Shape()) as THREE.Shape;
}

export function circleShape(r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.absarc(0, 0, r, 0, Math.PI * 2, false);
  return s;
}

export function heartShape(size = 1): THREE.Shape {
  const s = size / 2;
  const shape = new THREE.Shape();
  shape.moveTo(0, -s * 0.95);
  shape.bezierCurveTo(-s * 0.2, -s * 0.7, -s * 1.1, -s * 0.2, -s * 1.0, s * 0.35);
  shape.bezierCurveTo(-s * 0.95, s * 0.85, -s * 0.35, s * 1.05, 0, s * 0.6);
  shape.bezierCurveTo(s * 0.35, s * 1.05, s * 0.95, s * 0.85, s * 1.0, s * 0.35);
  shape.bezierCurveTo(s * 1.1, -s * 0.2, s * 0.2, -s * 0.7, 0, -s * 0.95);
  return shape;
}

export function starShape(outer = 0.5, inner = 0.22, points = 5): THREE.Shape {
  const shape = new THREE.Shape();
  for (let i = 0; i <= points * 2; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = Math.PI / 2 + (i / (points * 2)) * Math.PI * 2;
    if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return shape;
}

/** Closed polygon from points. */
export function polyShape(points: Array<[number, number]>): THREE.Shape {
  const s = new THREE.Shape();
  points.forEach(([x, y], i) => (i === 0 ? s.moveTo(x, y) : s.lineTo(x, y)));
  s.lineTo(points[0][0], points[0][1]);
  return s;
}

/** Ring: outer shape with an inner hole path. */
export function withHole(outer: THREE.Shape, hole: THREE.Path): THREE.Shape {
  outer.holes.push(hole);
  return outer;
}
