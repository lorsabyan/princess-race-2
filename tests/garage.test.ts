import { describe, expect, it } from 'vitest';
import { PAL } from '../src/game/models/kit/palette';
import { PAINTS, choosePaint, cleanGarage, emptyGarage, nextPaint, owns, savedFor } from '../src/game/sim/garage';
import { generateLevel } from '../src/game/sim/level';

describe('paints', () => {
  it('starts with the car\'s own pink, free', () => {
    expect(PAINTS[0].price).toBe(0);
    expect(PAINTS[0].color).toBe(PAL.carPaint);
    expect(owns(emptyGarage(), PAINTS[0].id)).toBe(true);
  });

  it('gets dearer one step at a time, with the first within reach of one good level', () => {
    for (let i = 1; i < PAINTS.length; i += 1) expect(PAINTS[i].price).toBeGreaterThan(PAINTS[i - 1].price);
    expect(PAINTS[1].price).toBeLessThanOrEqual(generateLevel(1).coins.length);
  });

  it('are bought once, and then free to swap back and forth', () => {
    const garage = emptyGarage();
    garage.wallet = 100;
    expect(choosePaint(garage, 'lilac')).toBe(true);
    expect(garage.wallet).toBe(60);
    expect(garage.paint).toBe('lilac');
    expect(choosePaint(garage, 'rose')).toBe(true);
    expect(choosePaint(garage, 'lilac')).toBe(true);
    expect(garage.wallet).toBe(60);
  });

  it('turn down a paint she can\'t afford yet, and take nothing', () => {
    const garage = emptyGarage();
    garage.wallet = 79;
    expect(choosePaint(garage, 'sky')).toBe(false);
    expect(garage.wallet).toBe(79);
    expect(garage.paint).toBe('rose');
    expect(owns(garage, 'sky')).toBe(false);
  });

  it('fill their gold ring as coins come in', () => {
    const garage = emptyGarage();
    const lilac = PAINTS[1];
    garage.wallet = lilac.price / 2;
    expect(savedFor(garage, lilac)).toBeCloseTo(0.5);
    garage.wallet = lilac.price * 3;
    expect(savedFor(garage, lilac)).toBe(1);
  });
});

describe('next paint', () => {
  it('is the cheapest one not bought, even if a dearer one was bought first', () => {
    expect(nextPaint(emptyGarage())?.id).toBe('lilac');
    const garage = emptyGarage();
    garage.wallet = 1000;
    choosePaint(garage, 'sky');
    expect(nextPaint(garage)?.id).toBe('lilac');
  });

  it('runs out once every paint is bought', () => {
    const garage = emptyGarage();
    garage.wallet = 10000;
    for (const paint of PAINTS) choosePaint(garage, paint.id);
    expect(nextPaint(garage)).toBeUndefined();
  });
});

describe('saved garage', () => {
  it('starts empty on an old save', () => {
    expect(cleanGarage(undefined)).toEqual(emptyGarage());
  });

  it('ignores paints that no longer exist and bad numbers', () => {
    const garage = cleanGarage({ wallet: -5, owned: ['rose', 'plaid'], paint: 'plaid' });
    expect(garage).toEqual(emptyGarage());
    expect(cleanGarage({ wallet: Number.NaN }).wallet).toBe(0);
  });

  it('never wears a paint that was not bought', () => {
    expect(cleanGarage({ wallet: 10, owned: ['rose'], paint: 'ruby' }).paint).toBe('rose');
  });

  it('keeps what was earned', () => {
    expect(cleanGarage({ wallet: 12.8, owned: ['lilac'], paint: 'lilac' })).toEqual({ wallet: 12, owned: ['rose', 'lilac'], paint: 'lilac' });
  });
});
