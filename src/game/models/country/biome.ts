import { PAL } from '../kit/palette';
import type { Area } from '../../sim/route';

/** Ground colors per area: shadowed, usual and sunlit grass. Terrain and road strips share these. */
export const BIOME: Record<Area, { deep: string; base: string; light: string }> = {
  town: { deep: PAL.grassDeep, base: PAL.grass, light: PAL.grassLight },
  meadow: { deep: '#86c870', base: '#aee07e', light: '#dcef9b' },
  forest: { deep: '#3e9a70', base: '#58b37c', light: '#80cc8c' },
  lake: { deep: '#a5d88e', base: '#c9e5a0', light: '#f1e6b4' },
  castle: { deep: '#68bd78', base: '#92d98c', light: '#c4efa6' },
};

/** Sandy shore where land meets water. */
export const SHORE = { wet: '#d8c49a', dry: '#f3e4b8' } as const;
