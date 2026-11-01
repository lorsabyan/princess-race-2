import { CHUNK_METERS } from './config';

/** Storybook areas the road passes through, in driving order. */
export type Area = 'town' | 'meadow' | 'forest' | 'lake' | 'castle';

export interface AreaSpan {
  area: Area;
  /** Road distance where the area starts (inclusive). */
  from: number;
  /** Road distance where the area ends (exclusive). */
  to: number;
}

/** Middle of the journey; town always comes first and the castle hill always last. */
const ORDERS: ReadonlyArray<readonly Area[]> = [
  ['meadow', 'forest', 'lake'],
  ['forest', 'meadow', 'lake'],
  ['meadow', 'lake', 'forest'],
  ['lake', 'forest', 'meadow'],
];

const SHARE: Record<Area, number> = { town: 0.21, meadow: 0.22, forest: 0.2, lake: 0.16, castle: 0.21 };

/** How far the first and last spans reach past the drivable road. */
const REACH = 1000;

/** Area layout for a level. Boundaries sit on chunk edges so every chunk has exactly one area. */
export function buildRoute(level: number, length: number): AreaSpan[] {
  const n = Math.max(1, Math.floor(level));
  const order: Area[] = ['town', ...ORDERS[(n - 1) % ORDERS.length], 'castle'];
  const total = order.reduce((sum, a) => sum + SHARE[a], 0);
  const spans: AreaSpan[] = [];
  let used = 0;
  let from = -REACH;
  order.forEach((area, i) => {
    used += SHARE[area] / total;
    const last = i === order.length - 1;
    const to = last ? length + REACH : Math.round((used * length) / CHUNK_METERS) * CHUNK_METERS;
    spans.push({ area, from, to });
    from = to;
  });
  return spans;
}

export function areaAt(route: readonly AreaSpan[], s: number): Area {
  for (const span of route) if (s < span.to) return span.area;
  return route[route.length - 1].area;
}
