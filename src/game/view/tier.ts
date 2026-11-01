import type { QualityTier } from './Stage';

export interface DeviceInfo {
  /** Touch is the main input: a phone or tablet. */
  coarse: boolean;
  /** Gigabytes, rounded down by the browser. Safari doesn't say. */
  memory?: number;
  cores?: number;
}

/**
 * The tier to start on. Computers start high; phones and tablets start medium, or low if
 * they look old. Starting too high costs a few slow seconds before the frame-time monitor
 * steps down, and a hand-me-down tablet in a child's hands shouldn't have to go through that.
 */
export function pickTier(device: DeviceInfo): QualityTier {
  if (!device.coarse) return 'high';
  const small = (device.memory !== undefined && device.memory <= 3) || (device.cores !== undefined && device.cores <= 4);
  return small ? 'low' : 'medium';
}
