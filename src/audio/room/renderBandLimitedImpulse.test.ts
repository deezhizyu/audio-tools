import { describe, expect, test } from 'vitest';
import { buildBandImpulseKernel } from './bandSplitFilters';
import { addBandLimitedImpulse } from './renderBandLimitedImpulse';

const SAMPLE_RATE = 1000;

function buildChannel(length = 64): Float32Array {
  return new Float32Array(length);
}

function sumOf(channel: Float32Array): number {
  return Array.from(channel).reduce((sum, sample) => sum + sample, 0);
}

const FLAT_AMPLITUDES = { low: 1, mid: 1, high: 1 };

describe('addBandLimitedImpulse', () => {
  test('a whole-sample delay places a clean impulse on exactly that sample', () => {
    // Equal band amplitudes make the band-split kernel sum back to a single unit impulse, and a zero
    // fractional part makes the interpolator a pass-through — so nothing should smear at all.
    const channel = buildChannel();
    addBandLimitedImpulse(channel, 10 / SAMPLE_RATE, SAMPLE_RATE, buildBandImpulseKernel(SAMPLE_RATE), FLAT_AMPLITUDES);

    expect(channel[10]).toBeCloseTo(1, 6);
    expect(Array.from(channel).filter((_value, index) => index !== 10).every(value => Math.abs(value) < 1e-6)).toBe(true);
  });

  test('an arrival keeps its amplitude wherever between two samples it falls', () => {
    // The property that matters: walking a listener smoothly across a room must not make the direct sound's
    // level wobble with where each delay happens to land between samples. Linear interpolation, which this
    // used to use, loses up to half an arrival's energy at the halfway point.
    for (const fractionalDelay of [0, 0.1, 0.25, 0.5, 0.75, 0.99]) {
      const channel = buildChannel();
      addBandLimitedImpulse(channel, (20 + fractionalDelay) / SAMPLE_RATE, SAMPLE_RATE, buildBandImpulseKernel(SAMPLE_RATE), FLAT_AMPLITUDES);

      expect(sumOf(channel)).toBeCloseTo(1, 5);
    }
  });

  test('an arrival lands later the longer its delay, down to a fraction of a sample', () => {
    const centreOfMass = (fractionalDelay: number): number => {
      const channel = buildChannel();
      addBandLimitedImpulse(channel, (20 + fractionalDelay) / SAMPLE_RATE, SAMPLE_RATE, buildBandImpulseKernel(SAMPLE_RATE), FLAT_AMPLITUDES);
      const weighted = Array.from(channel).reduce((sum, sample, index) => sum + sample * index, 0);
      return weighted / sumOf(channel);
    };

    expect(centreOfMass(0.25)).toBeGreaterThan(centreOfMass(0));
    expect(centreOfMass(0.75)).toBeGreaterThan(centreOfMass(0.25));
    expect(centreOfMass(0.5)).toBeCloseTo(20.5, 2);
  });

  test("scales with the square root of the arrival's energy", () => {
    const channel = buildChannel();
    addBandLimitedImpulse(channel, 10 / SAMPLE_RATE, SAMPLE_RATE, buildBandImpulseKernel(SAMPLE_RATE), { low: 3, mid: 3, high: 3 });
    expect(channel[10]).toBeCloseTo(3, 6);
  });

  test('silently drops an arrival that falls outside the channel, and a nonsensical one', () => {
    const channel = buildChannel();
    addBandLimitedImpulse(channel, 10, SAMPLE_RATE, buildBandImpulseKernel(SAMPLE_RATE), FLAT_AMPLITUDES);
    addBandLimitedImpulse(channel, -1, SAMPLE_RATE, buildBandImpulseKernel(SAMPLE_RATE), FLAT_AMPLITUDES);
    addBandLimitedImpulse(channel, NaN, SAMPLE_RATE, buildBandImpulseKernel(SAMPLE_RATE), FLAT_AMPLITUDES);

    expect(Array.from(channel).every(value => value === 0)).toBe(true);
  });

  test('unequal band amplitudes colour the arrival instead of leaving it a bare spike', () => {
    const channel = buildChannel();
    addBandLimitedImpulse(channel, 10 / SAMPLE_RATE, SAMPLE_RATE, buildBandImpulseKernel(SAMPLE_RATE), { low: 1, mid: 0, high: 0 });

    // A low-pass-shaped arrival rings on past its own sample rather than stopping dead.
    expect(channel[10]).toBeGreaterThan(0);
    expect(Array.from(channel.slice(11, 16)).some(value => Math.abs(value) > 1e-6)).toBe(true);
  });
});
