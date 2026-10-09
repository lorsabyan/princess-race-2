import { signal } from '@preact/signals';

export type Screen = 'loading' | 'title' | 'intro' | 'play' | 'finish' | 'results';

/** UI-facing game state. The game writes these; Preact components read them. */
export const ui = {
  screen: signal<Screen>('loading'),
  loadProgress: signal(0),
  paused: signal(false),
  muted: signal(false),
  level: signal(1),
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
};

const SAVE_KEY = 'princess-coin-drive:v1';

interface SaveData {
  level: number;
  bestStars: Record<number, number>;
  muted: boolean;
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as Partial<SaveData>;
      return { level: Math.max(1, data.level ?? 1), bestStars: data.bestStars ?? {}, muted: !!data.muted };
    }
  } catch {
    // Storage can be unavailable (private mode); play without saving.
  }
  return { level: 1, bestStars: {}, muted: false };
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // Ignore: saving is a convenience.
  }
}
