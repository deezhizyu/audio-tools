import { describe, expect, test } from 'vitest';
import { buildEnergyHistogram } from './buildEnergyHistogram';
import type { ImpulseArrival } from './traceRays';

describe('buildEnergyHistogram', () => {
  test('sums arrivals into the correct time bin per band, keeping their absolute energy', () => {
    // lateralPosition is irrelevant to this function's band summation — it is covered separately below — so it
    // is set to an arbitrary value here.
    const arrivals: ImpulseArrival[] = [
      { timeSeconds: 0.001, energy: { low: 1, mid: 2, high: 3 }, lateralPosition: 0 },
      { timeSeconds: 0.004, energy: { low: 1, mid: 1, high: 1 }, lateralPosition: 0 }, // same 5ms bin as the arrival above
      { timeSeconds: 0.006, energy: { low: 4, mid: 0, high: 0 }, lateralPosition: 0 }, // next bin
    ];

    const histogram = buildEnergyHistogram(arrivals, 0.005, 0.02);

    // Arrivals already carry each ray's share of the source's power (see `energyPerRay`), so the histogram
    // sums them as-is rather than dividing by the ray count a second time.
    expect(histogram.low[0]).toBeCloseTo(2); // 1 + 1
    expect(histogram.mid[0]).toBeCloseTo(3); // 2 + 1
    expect(histogram.high[0]).toBeCloseTo(4); // 3 + 1
    expect(histogram.low[1]).toBeCloseTo(4);
  });

  test('drops arrivals outside the requested total duration', () => {
    const arrivals: ImpulseArrival[] = [{ timeSeconds: 5, energy: { low: 1, mid: 1, high: 1 }, lateralPosition: 0 }];
    const histogram = buildEnergyHistogram(arrivals, 0.005, 0.02);
    expect(Array.from(histogram.low).every(value => value === 0)).toBe(true);
  });

  test('produces an all-zero histogram of the right length for no arrivals', () => {
    const histogram = buildEnergyHistogram([], 0.005, 0.05);
    expect(histogram.low).toHaveLength(10);
    expect(histogram.mid).toHaveLength(10);
    expect(histogram.high).toHaveLength(10);
    expect(histogram.lateralPosition).toHaveLength(10);
  });

  test('a bin with no arrivals has a centered (zero) lateral position', () => {
    const histogram = buildEnergyHistogram([], 0.005, 0.01);
    expect(Array.from(histogram.lateralPosition).every(value => value === 0)).toBe(true);
  });

  test("a bin's lateral position is the energy-weighted average of its arrivals' lateral positions", () => {
    const arrivals: ImpulseArrival[] = [
      { timeSeconds: 0.001, energy: { low: 1, mid: 0, high: 0 }, lateralPosition: -1 }, // full left, weight 1
      { timeSeconds: 0.002, energy: { low: 3, mid: 0, high: 0 }, lateralPosition: 1 }, // full right, weight 3
    ];
    const histogram = buildEnergyHistogram(arrivals, 0.005, 0.01);
    // (-1 * 1 + 1 * 3) / (1 + 3) = 0.5 — pulled toward the louder, right-panned arrival.
    expect(histogram.lateralPosition[0]).toBeCloseTo(0.5);
  });

  test('a single, fully left-panned arrival gives its bin a lateral position of exactly -1', () => {
    const arrivals: ImpulseArrival[] = [{ timeSeconds: 0.001, energy: { low: 1, mid: 1, high: 1 }, lateralPosition: -1 }];
    const histogram = buildEnergyHistogram(arrivals, 0.005, 0.01);
    expect(histogram.lateralPosition[0]).toBeCloseTo(-1);
  });
});
