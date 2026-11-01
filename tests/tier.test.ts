import { describe, expect, it } from 'vitest';
import { pickTier } from '../src/game/view/tier';

describe('starting quality', () => {
  it('starts computers high', () => {
    expect(pickTier({ coarse: false })).toBe('high');
    expect(pickTier({ coarse: false, memory: 2, cores: 2 })).toBe('high');
  });

  it('starts ordinary phones and tablets medium', () => {
    expect(pickTier({ coarse: true, memory: 8, cores: 8 })).toBe('medium');
  });

  it('starts medium when a device keeps its specs to itself, like Safari', () => {
    expect(pickTier({ coarse: true })).toBe('medium');
  });

  it('starts old phones and tablets low', () => {
    expect(pickTier({ coarse: true, memory: 2, cores: 8 })).toBe('low');
    expect(pickTier({ coarse: true, memory: 8, cores: 4 })).toBe('low');
  });
});
