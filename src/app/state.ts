import { signal } from '@preact/signals';
import { cleanGarage, emptyGarage, type Garage } from '../game/sim/garage';
import type { Area } from '../game/sim/route';

export type Screen = 'loading' | 'title' | 'intro' | 'play' | 'finish' | 'results';

/** UI-facing game state. The game writes these; Preact components read them. */
export const ui = {
  screen: signal<Screen>('loading'),
  loadProgress: signal(0),
  paused: signal(false),
  muted: signal(false),
  level: signal(1),
  /** The furthest level reached: the map lets her play any level up to here. */
  furthest: signal(1),
  mapOpen: signal(false),
  /** Coins banked, paints bought and the paint on the car. */
  garage: signal<Garage>(emptyGarage()),
  /** Bumps when a paint can't be afforded yet, so its swatch can wiggle. */
  paintNudge: signal<{ id: string; at: number } | null>(null),
  coins: signal(0),
  /** Increments on every pickup so the coin counter can bounce. */
  coinPulse: signal(0),
  progress: signal(0),
  stars: signal(0),
  totalCoins: signal(0),
  bestStars: signal<Record<number, number>>({}),
  /** Shows the drag-to-steer hint at the start of early levels. */
  showSteerHint: signal(false),
  gemFlash: signal(0),
  /** Where each area begins on the progress bar (0..1). */
  areaMarks: signal<Array<{ area: Area; at: number }>>([]),
  /** The area just entered, shown as a big picture for a moment. */
  areaFlash: signal<Area | null>(null),
  areaPulse: signal(0),
};

const SAVE_KEY = 'princess-coin-drive:v1';

interface SaveData {
  level: number;
  bestStars: Record<number, number>;
  muted: boolean;
  garage: Garage;
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as Partial<SaveData>;
      return { level: Math.max(1, data.level ?? 1), bestStars: data.bestStars ?? {}, muted: !!data.muted, garage: cleanGarage(data.garage) };
    }
  } catch {
    // Storage can be unavailable (private mode); play without saving.
  }
  return { level: 1, bestStars: {}, muted: false, garage: emptyGarage() };
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // Ignore: saving is a convenience.
  }
}
