import { describe, expect, test } from 'vitest';
import { buildEnergyHistogram } from './buildEnergyHistogram';
import type { ImpulseArrival } from './traceRays';

describe('buildEnergyHistogram', () => {
  test('sums arrivals into the correct time bin per band and normalizes by ray count', () => {
    // bounceOrder and panPosition are irrelevant to this function's band summation — panPosition is covered
    // separately below — so both are set to arbitrary values here.
    const arrivals: ImpulseArrival[] = [
      { timeSeconds: 0.001, energy: { low: 1, mid: 2, high: 3 }, bounceOrder: 1, panPosition: 0 },
      { timeSeconds: 0.004, energy: { low: 1, mid: 1, high: 1 }, bounceOrder: 1, panPosition: 0 }, // same 5ms bin as the arrival above
      { timeSeconds: 0.006, energy: { low: 4, mid: 0, high: 0 }, bounceOrder: 1, panPosition: 0 }, // next bin
    ];

    const histogram = buildEnergyHistogram(arrivals, 2, 0.005, 0.02);

    expect(histogram.low[0]).toBeCloseTo(1); // (1 + 1) / 2 rays
    expect(histogram.mid[0]).toBeCloseTo(1.5); // (2 + 1) / 2 rays
    expect(histogram.high[0]).toBeCloseTo(2); // (3 + 1) / 2 rays
    expect(histogram.low[1]).toBeCloseTo(2); // 4 / 2 rays
  });

  test('drops arrivals outside the requested total duration', () => {
    const arrivals: ImpulseArrival[] = [{ timeSeconds: 5, energy: { low: 1, mid: 1, high: 1 }, bounceOrder: 1, panPosition: 0 }];
    const histogram = buildEnergyHistogram(arrivals, 1, 0.005, 0.02);
    expect(Array.from(histogram.low).every(value => value === 0)).toBe(true);
  });

  test('produces an all-zero histogram of the right length for no arrivals', () => {
    const histogram = buildEnergyHistogram([], 100, 0.005, 0.05);
    expect(histogram.low).toHaveLength(10);
    expect(histogram.mid).toHaveLength(10);
    expect(histogram.high).toHaveLength(10);
    expect(histogram.pan).toHaveLength(10);
  });

  test('a bin with no arrivals has a centered (zero) pan position', () => {
    const histogram = buildEnergyHistogram([], 1, 0.005, 0.01);
    expect(Array.from(histogram.pan).every(value => value === 0)).toBe(true);
  });

  test("a bin's pan position is the energy-weighted average of its arrivals' pan positions", () => {
    const arrivals: ImpulseArrival[] = [
      { timeSeconds: 0.001, energy: { low: 1, mid: 0, high: 0 }, bounceOrder: 1, panPosition: -1 }, // full left, weight 1
      { timeSeconds: 0.002, energy: { low: 3, mid: 0, high: 0 }, bounceOrder: 1, panPosition: 1 }, // full right, weight 3
    ];
    const histogram = buildEnergyHistogram(arrivals, 1, 0.005, 0.01);
    // (-1 * 1 + 1 * 3) / (1 + 3) = 0.5 — pulled toward the louder, right-panned arrival.
    expect(histogram.pan[0]).toBeCloseTo(0.5);
  });

  test('a single, fully left-panned arrival gives its bin a pan position of exactly -1', () => {
    const arrivals: ImpulseArrival[] = [{ timeSeconds: 0.001, energy: { low: 1, mid: 1, high: 1 }, bounceOrder: 1, panPosition: -1 }];
    const histogram = buildEnergyHistogram(arrivals, 1, 0.005, 0.01);
    expect(histogram.pan[0]).toBeCloseTo(-1);
  });
});
