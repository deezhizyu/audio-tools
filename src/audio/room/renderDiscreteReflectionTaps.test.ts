import { describe, expect, test } from 'vitest';
import { renderDiscreteReflectionTaps } from './renderDiscreteReflectionTaps';
import type { ImpulseArrival } from './traceRays';

const FIXED_RANDOM_SOURCE = () => 0.5;

/** Deterministic, non-constant "randomness" so per-tap jitter is reproducible without depending on global
    RNG seeding — matches the pattern used in `synthesizeImpulseResponseFromHistogram.test.ts`. */
function buildCyclingRandomSource(): () => number {
  let counter = 0;
  return () => (counter++ % 11) / 11;
}

function buildChannels(length: number, count = 2): Float32Array<ArrayBuffer>[] {
  return Array.from({ length: count }, () => new Float32Array(length));
}

describe('renderDiscreteReflectionTaps', () => {
  test("places a band-colored impulse at the arrival's exact delay sample, identically on every channel when jitter is zero and the arrival is centered", () => {
    const arrival: ImpulseArrival = { timeSeconds: 0.01, energy: { low: 1, mid: 1, high: 1 }, bounceOrder: 0, panPosition: 0 };
    const channels = buildChannels(50);

    renderDiscreteReflectionTaps(channels, [arrival], 1000, 1, true, FIXED_RANDOM_SOURCE);

    const delaySampleIndex = 10; // 0.01s * 1000Hz
    expect(channels[0][delaySampleIndex]).toBeGreaterThan(0);
    expect(channels[1][delaySampleIndex]).toBeCloseTo(channels[0][delaySampleIndex]);

    // Nothing before the arrival's own delay sample — no acausal leakage.
    expect(channels[0][delaySampleIndex - 1]).toBe(0);
  });

  test('produces no impulse at all for a silent (zero-energy) arrival', () => {
    const arrival: ImpulseArrival = { timeSeconds: 0.01, energy: { low: 0, mid: 0, high: 0 }, bounceOrder: 0, panPosition: 0 };
    const channels = buildChannels(50);

    renderDiscreteReflectionTaps(channels, [arrival], 1000, 1, true, FIXED_RANDOM_SOURCE);

    for (const channel of channels) {
      expect(Array.from(channel).every(value => value === 0)).toBe(true);
    }
  });

  test('decorrelates channels when given a varying random source', () => {
    const arrivals: ImpulseArrival[] = [
      { timeSeconds: 0.01, energy: { low: 1, mid: 1, high: 1 }, bounceOrder: 0, panPosition: 0 },
      { timeSeconds: 0.012, energy: { low: 1, mid: 1, high: 1 }, bounceOrder: 0, panPosition: 0 },
      { timeSeconds: 0.015, energy: { low: 1, mid: 1, high: 1 }, bounceOrder: 0, panPosition: 0 },
    ];
    const channels = buildChannels(50);

    renderDiscreteReflectionTaps(channels, arrivals, 1000, 1, true, buildCyclingRandomSource());

    expect(Array.from(channels[0])).not.toEqual(Array.from(channels[1]));
  });

  test('silently drops an arrival whose delay falls outside the channel bounds', () => {
    const arrivals: ImpulseArrival[] = [
      { timeSeconds: 10, energy: { low: 1, mid: 1, high: 1 }, bounceOrder: 0, panPosition: 0 }, // far past the end of a 50-sample channel at 1000Hz
    ];
    const channels = buildChannels(50);

    expect(() => renderDiscreteReflectionTaps(channels, arrivals, 1000, 1, true, FIXED_RANDOM_SOURCE)).not.toThrow();
    for (const channel of channels) {
      expect(Array.from(channel).every(value => value === 0)).toBe(true);
    }
  });

  test('when stereo simulation is enabled, a fully left-panned arrival lands louder on the left channel than the right', () => {
    const arrival: ImpulseArrival = { timeSeconds: 0.01, energy: { low: 1, mid: 1, high: 1 }, bounceOrder: 0, panPosition: -1 };
    const channels = buildChannels(50);

    renderDiscreteReflectionTaps(channels, [arrival], 1000, 1, true, FIXED_RANDOM_SOURCE);

    const delaySampleIndex = 10;
    expect(channels[0][delaySampleIndex]).toBeGreaterThan(0);
    expect(channels[1][delaySampleIndex]).toBeCloseTo(0);
  });

  test('when stereo simulation is disabled, a fully left-panned arrival still lands identically on every channel', () => {
    const arrival: ImpulseArrival = { timeSeconds: 0.01, energy: { low: 1, mid: 1, high: 1 }, bounceOrder: 0, panPosition: -1 };
    const channels = buildChannels(50);

    renderDiscreteReflectionTaps(channels, [arrival], 1000, 1, false, FIXED_RANDOM_SOURCE);

    const delaySampleIndex = 10;
    expect(channels[0][delaySampleIndex]).toBeGreaterThan(0);
    expect(channels[1][delaySampleIndex]).toBeCloseTo(channels[0][delaySampleIndex]);
  });
});
