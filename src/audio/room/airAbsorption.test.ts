import { describe, expect, test } from 'vitest';
import { applyAirAbsorption } from './airAbsorption';

describe('applyAirAbsorption', () => {
  test('leaves energy unchanged at zero distance', () => {
    const energy = { low: 1, mid: 1, high: 1 };
    expect(applyAirAbsorption(energy, 0)).toEqual(energy);
  });

  test('attenuates every band as distance grows, high frequencies fastest', () => {
    const nearby = applyAirAbsorption({ low: 1, mid: 1, high: 1 }, 10);
    const far = applyAirAbsorption({ low: 1, mid: 1, high: 1 }, 1000);

    expect(far.low).toBeLessThan(nearby.low);
    expect(far.mid).toBeLessThan(nearby.mid);
    expect(far.high).toBeLessThan(nearby.high);

    // The higher a band's coefficient, the faster it decays — low should always be the least attenuated,
    // high the most, at any given distance beyond zero.
    expect(nearby.high).toBeLessThan(nearby.mid);
    expect(nearby.mid).toBeLessThan(nearby.low);
  });

  test('scales each band independently rather than by one shared factor', () => {
    const result = applyAirAbsorption({ low: 2, mid: 3, high: 5 }, 50);
    expect(result.low / 2).not.toBeCloseTo(result.mid / 3);
    expect(result.mid / 3).not.toBeCloseTo(result.high / 5);
  });
});
