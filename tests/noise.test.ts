import { describe, expect, it } from 'vitest';
import { noiseTexture } from '../src/game/models/kit/noise';

describe('the shared world noise', () => {
  const texture = noiseTexture();
  const { data, width, height } = texture.image as { data: Uint8Array; width: number; height: number };
  const at = (x: number, y: number, channel: number) => data[(x + y * width) * 4 + channel];

  it('tiles: opposite edges differ no more than neighboring rows do', () => {
    for (let channel = 0; channel < 4; channel += 1) {
      let seam = 0;
      let inside = 0;
      for (let i = 0; i < width; i += 1) {
        seam += Math.abs(at(i, 0, channel) - at(i, height - 1, channel)) + Math.abs(at(0, i, channel) - at(width - 1, i, channel));
        inside += Math.abs(at(i, 100, channel) - at(i, 101, channel)) + Math.abs(at(100, i, channel) - at(101, i, channel));
      }
      expect(seam).toBeLessThan(inside * 2.2);
    }
  });

  it('uses the full range in every channel, so shaders can threshold it', () => {
    for (let channel = 0; channel < 4; channel += 1) {
      let low = 255;
      let high = 0;
      for (let i = channel; i < data.length; i += 4) {
        low = Math.min(low, data[i]);
        high = Math.max(high, data[i]);
      }
      expect(high - low).toBeGreaterThan(180);
    }
  });

  it('is shared, not rebuilt for every material', () => {
    expect(noiseTexture()).toBe(texture);
  });
});
