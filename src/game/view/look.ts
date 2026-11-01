import { PAL } from '../models/kit/palette';

/** Everything that defines the game's light and color. Scene code never forks per look. */
export interface LookPreset {
  name: string;
  /** Direction toward the sun (need not be unit length). */
  sunDir: [number, number, number];
  sun: { color: string; intensity: number; shadow: number };
  hemi: { sky: string; ground: string; intensity: number };
  rim: { color: string; intensity: number };
  sky: { top: string; mid: string; horizon: string; glow: string; ground: string };
  cloud: { lit: string; shade: string };
  /** How much sun a passing cloud blocks and the forest canopy does (0 to 1), and how bright shafts of sun are. */
  shade: { cloud: number; canopy: number; shaft: number };
  fog: string;
  env: number;
  /** Distant land and hills fade toward this. */
  haze: string;
  water: { deep: string; shallow: string };
  grade: { saturation: number; contrast: number; brightness: number };
  bloom: { intensity: number; threshold: number };
  vignette: number;
  /** How far evening has come (0 to 1): windows, headlights, stars and fireflies follow it. */
  lights: number;
}

export const LOOKS: Record<string, LookPreset> = {
  /** Bright noon toy diorama: clean pastels, crisp contact shadows. */
  sunny: {
    name: 'sunny',
    // Grafted from `golden`: a lower, warmer sun for longer shadows and a peachier horizon.
    sunDir: [-0.6, 0.72, 0.4],
    sun: { color: '#ffe9c8', intensity: 2.75, shadow: 0.84 },
    hemi: { sky: '#f4f2ff', ground: '#c6e6ae', intensity: 0.36 },
    rim: { color: '#ffe6ee', intensity: 0.78 },
    sky: { top: PAL.skyTop, mid: PAL.skyMid, horizon: '#ffe0c6', glow: PAL.sunGlow, ground: '#e9d6e4' },
    cloud: { lit: '#ffffff', shade: '#c9d4f4' },
    shade: { cloud: 0.36, canopy: 0.6, shaft: 0.19 },
    fog: '#ffe3cf',
    env: 0.7,
    haze: '#bfe4d8',
    water: { deep: '#2f9fd6', shallow: '#7fe4d6' },
    grade: { saturation: 0.1, contrast: 0.08, brightness: 0 },
    bloom: { intensity: 0.75, threshold: 0.92 },
    vignette: 0.34,
    lights: 0,
  },
  /** Low warm sun, long shadows, a picture-book afternoon. */
  golden: {
    name: 'golden',
    sunDir: [-0.74, 0.5, 0.46],
    sun: { color: '#ffd29a', intensity: 3.0, shadow: 0.78 },
    hemi: { sky: '#ffe6d2', ground: '#cdbf8e', intensity: 0.46 },
    rim: { color: '#ffd8e4', intensity: 0.85 },
    sky: { top: '#6ea7ea', mid: '#ffd6ba', horizon: '#ffc592', glow: '#ffdca6', ground: '#e8cdb6' },
    cloud: { lit: '#fff1dc', shade: '#d9b7c4' },
    shade: { cloud: 0.3, canopy: 0.7, shaft: 0.16 },
    fog: '#ffd8b6',
    env: 0.72,
    haze: '#f4d9b6',
    water: { deep: '#55aecf', shallow: '#a8e4c8' },
    grade: { saturation: 0.14, contrast: 0.09, brightness: 0 },
    bloom: { intensity: 0.85, threshold: 0.9 },
    vignette: 0.38,
    lights: 0.22,
  },
  /** Rosy dusk: soft lilac light, lanterns and fairy lights start to glow. */
  dusk: {
    name: 'dusk',
    sunDir: [-0.62, 0.34, -0.72],
    sun: { color: '#ffb6c6', intensity: 1.7, shadow: 0.6 },
    hemi: { sky: '#d6ccff', ground: '#a9b4dc', intensity: 0.86 },
    rim: { color: '#ffc6e0', intensity: 1.0 },
    sky: { top: '#5f6ccd', mid: '#c497e4', horizon: '#ffb9c9', glow: '#ffc8d4', ground: '#cdb6dc' },
    cloud: { lit: '#ffdcea', shade: '#9d8fd2' },
    shade: { cloud: 0.2, canopy: 0.5, shaft: 0.16 },
    fog: '#e9b7d8',
    env: 0.84,
    haze: '#d9bce6',
    water: { deep: '#6a78d0', shallow: '#b0a6ea' },
    grade: { saturation: 0.1, contrast: 0.08, brightness: 0.02 },
    bloom: { intensity: 1.0, threshold: 0.92 },
    vignette: 0.42,
    lights: 1,
  },
};

export const DEFAULT_LOOK = 'sunny';

/** Players who ask for less motion get a steady camera and no bounces. */
export const REDUCED_MOTION = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The day turns as the levels go by: two sunny mornings, a golden afternoon, then dusk. */
export const DAY: readonly string[] = ['sunny', 'sunny', 'golden', 'dusk'];

/** ?look=name holds one look for every level. */
const ASKED = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('look');
const HELD = ASKED && LOOKS[ASKED] ? ASKED : null;

export function lookForLevel(level: number): string {
  return HELD ?? DAY[(Math.max(1, Math.floor(level)) - 1) % DAY.length];
}

/** The look in use. It changes in place, so everything built after a change picks up the new one. */
export const LOOK_NOW: LookPreset = { ...LOOKS[HELD ?? DEFAULT_LOOK] };

export function setLook(name: string): void {
  Object.assign(LOOK_NOW, LOOKS[name]);
}
