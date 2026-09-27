import GUI from 'lil-gui';
import type { PlayerTuning } from '../entities/Player';

export type DebugTuning = PlayerTuning & {
  cameraLag: number;
  exposure: number;
  maxDpr: number;
};

export class DebugTools {
  private gui: GUI | null = null;

  constructor(tuning: DebugTuning, onChange: () => void) {
    const enabled = new URLSearchParams(window.location.search).has('debug');
    if (!enabled) return;

    this.gui = new GUI({ title: 'Game tuning' });
    this.gui.add(tuning, 'forwardSpeed', 6, 18, 0.1);
    this.gui.add(tuning, 'steeringSpeed', 4, 14, 0.1);
    this.gui.add(tuning, 'steeringEase', 4, 22, 0.1);
    this.gui.add(tuning, 'cameraLag', 0.02, 0.8, 0.01);
    this.gui.add(tuning, 'maxDpr', 1, 2, 0.25).onChange(onChange);
    this.gui.add(tuning, 'exposure', 0.6, 1.8, 0.01).onChange(onChange);
  }

  dispose(): void {
    this.gui?.destroy();
    this.gui = null;
  }
}
