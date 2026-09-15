import { describe, expect, test } from 'vitest';
import type { DiscreteArrival } from './discreteArrival';
import { renderDiscreteArrivals } from './renderDiscreteArrivals';

const SAMPLE_RATE = 1000;

function buildChannels(length = 64, count = 2): Float32Array<ArrayBuffer>[] {
  return Array.from({ length: count }, () => new Float32Array(length));
}

/** A whole-sample delay, so the arrival lands on exactly one sample and assertions can be exact. */
function buildArrival(overrides: Partial<DiscreteArrival> = {}): DiscreteArrival {
  return { timeSeconds: 10 / SAMPLE_RATE, energy: { low: 1, mid: 1, high: 1 }, panPosition: 0, ...overrides };
}

describe('renderDiscreteArrivals', () => {
  test("places each arrival at its own delay, at the square root of its energy", () => {
    const channels = buildChannels();
    renderDiscreteArrivals(channels, [buildArrival({ energy: { low: 4, mid: 4, high: 4 } })], SAMPLE_RATE, false);

    for (const channel of channels) {
      expect(channel[10]).toBeCloseTo(2, 5);
    }
  });

  test('several arrivals accumulate, each at its own time', () => {
    const channels = buildChannels();
    renderDiscreteArrivals(
      channels,
      [buildArrival(), buildArrival({ timeSeconds: 20 / SAMPLE_RATE }), buildArrival({ timeSeconds: 30 / SAMPLE_RATE })],
      SAMPLE_RATE,
      false,
    );

    for (const sampleIndex of [10, 20, 30]) {
      expect(channels[0][sampleIndex]).toBeCloseTo(1, 5);
    }
  });

  test('two arrivals at the same instant add coherently, the way two real paths of equal length do', () => {
    // Amplitudes add, so the pair carries four times one arrival's energy rather than twice. That is correct
    // for genuinely coherent paths, and precisely why stochastic ray samples must not be rendered this way —
    // see `DiscreteArrival`.
    const channels = buildChannels();
    renderDiscreteArrivals(channels, [buildArrival(), buildArrival()], SAMPLE_RATE, false);

    expect(channels[0][10]).toBeCloseTo(2, 5);
  });

  test('produces no output at all for a silent arrival', () => {
    const channels = buildChannels();
    renderDiscreteArrivals(channels, [buildArrival({ energy: { low: 0, mid: 0, high: 0 } })], SAMPLE_RATE, true);

    for (const channel of channels) {
      expect(Array.from(channel).every(value => value === 0)).toBe(true);
    }
  });

  test('with stereo simulation on, an arrival from the left lands louder on the left channel', () => {
    const channels = buildChannels();
    renderDiscreteArrivals(channels, [buildArrival({ panPosition: -1 })], SAMPLE_RATE, true);

    expect(channels[0][10]).toBeGreaterThan(0);
    expect(channels[1][10]).toBeCloseTo(0, 6);
  });

  test('with stereo simulation off, an arrival from the left still lands identically on both channels', () => {
    const channels = buildChannels();
    renderDiscreteArrivals(channels, [buildArrival({ panPosition: -1 })], SAMPLE_RATE, false);

    expect(channels[0][10]).toBeCloseTo(1, 5);
    expect(channels[1][10]).toBeCloseTo(channels[0][10], 6);
  });

  test('a centered arrival under the constant-power pan law splits evenly rather than duplicating', () => {
    const channels = buildChannels();
    renderDiscreteArrivals(channels, [buildArrival()], SAMPLE_RATE, true);

    for (const channel of channels) {
      expect(channel[10]).toBeCloseTo(Math.SQRT1_2, 5);
    }
  });
});
