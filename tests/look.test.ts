import { describe, expect, it } from 'vitest';
import { DAY, LOOKS, LOOK_NOW, lookForLevel, setLook } from '../src/game/view/look';

describe('time of day', () => {
  it('turns from morning to evening over the levels, then starts a new day', () => {
    expect([1, 2, 3, 4, 5].map(lookForLevel)).toEqual(['sunny', 'sunny', 'golden', 'dusk', 'sunny']);
  });

  it('only ever names looks that exist', () => {
    for (const name of DAY) expect(LOOKS[name]).toBeDefined();
    for (let level = 1; level < 40; level += 1) expect(LOOKS[lookForLevel(level)]).toBeDefined();
  });

  it('copes with odd level numbers', () => {
    expect(lookForLevel(0)).toBe('sunny');
    expect(lookForLevel(-3)).toBe('sunny');
  });

  it('swaps the look in place, so code holding it sees the new day', () => {
    const held = LOOK_NOW;
    setLook('dusk');
    expect(held.name).toBe('dusk');
    expect(held.lights).toBe(1);
    setLook('sunny');
    expect(held.name).toBe('sunny');
    expect(held.lights).toBe(0);
  });

  it('keeps every look its own name', () => {
    for (const [name, look] of Object.entries(LOOKS)) expect(look.name).toBe(name);
  });
});
