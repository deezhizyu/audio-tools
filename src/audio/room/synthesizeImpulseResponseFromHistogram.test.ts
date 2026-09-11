import { describe, expect, test } from 'vitest';
import { synthesizeImpulseResponseFromHistogram } from './synthesizeImpulseResponseFromHistogram';
import type { EnergyHistogram } from './buildEnergyHistogram';

function buildSilentHistogram(binCount: number, binDurationSeconds: number): EnergyHistogram {
  return {
    binDurationSeconds,
    low: new Float32Array(binCount),
    mid: new Float32Array(binCount),
    high: new Float32Array(binCount),
    pan: new Float32Array(binCount),
  };
}

/** Deterministic, non-constant "randomness" so band-noise generation is reproducible without depending on
    global RNG seeding. */
function buildCyclingRandomSource(): () => number {
  let counter = 0;
  return () => (counter++ % 11) / 11;
}

describe('synthesizeImpulseResponseFromHistogram', () => {
  test('an all-zero histogram with an unoccluded, centered direct path is silent except at the direct-sound delay, identically on both channels', () => {
    const histogram = buildSilentHistogram(1, 0.005);
    const sampleRate = 1000;

    const channels = synthesizeImpulseResponseFromHistogram(
      histogram,
      sampleRate,
      { distanceMeters: 1, isOccluded: false, panPosition: 0 },
      343,
      true,
      buildCyclingRandomSource(),
    );

    const expectedDirectSampleIndex = Math.round((1 / 343) * sampleRate);
    // A centered position under the constant-power stereo pan law splits the direct sound's amplitude evenly
    // across both channels (cos(π/4) = sin(π/4) = √2/2 each), rather than duplicating the full amplitude onto
    // both the way an unpanned mono-to-stereo copy would.
    const expectedCenteredAmplitude = Math.SQRT1_2;
    for (const impulseResponse of channels) {
      for (let sampleIndex = 0; sampleIndex < impulseResponse.length; sampleIndex++) {
        if (sampleIndex === expectedDirectSampleIndex) {
          expect(impulseResponse[sampleIndex]).toBeCloseTo(expectedCenteredAmplitude);
        } else {
          // `=== 0` rather than `toBe(0)`: a zero-energy bin can legitimately compute to signed `-0`, which is
          // numerically silent but fails `toBe`'s `Object.is`-based comparison against `0`.
          expect(impulseResponse[sampleIndex] === 0).toBe(true);
        }
      }
    }
  });

  test('an occluded direct path produces total silence for an all-zero histogram, on every channel', () => {
    const histogram = buildSilentHistogram(1, 0.005);
    const channels = synthesizeImpulseResponseFromHistogram(
      histogram,
      1000,
      { distanceMeters: 1, isOccluded: true, panPosition: 0 },
      343,
      true,
      buildCyclingRandomSource(),
    );
    for (const impulseResponse of channels) {
      expect(Array.from(impulseResponse).every(value => value === 0)).toBe(true);
    }
  });

  test('energy in a histogram bin produces non-silent output over that bin, on every channel', () => {
    const histogram = buildSilentHistogram(2, 0.005);
    histogram.mid[0] = 1;

    const channels = synthesizeImpulseResponseFromHistogram(
      histogram,
      1000,
      { distanceMeters: 1000, isOccluded: true, panPosition: 0 }, // occluded direct path, so only the histogram contributes
      343,
      true,
      buildCyclingRandomSource(),
    );

    const samplesInFirstBin = Math.round(0.005 * 1000);
    for (const impulseResponse of channels) {
      const firstBinHasEnergy = Array.from(impulseResponse.slice(0, samplesInFirstBin)).some(value => value !== 0);
      const secondBinIsSilent = Array.from(impulseResponse.slice(samplesInFirstBin)).every(value => value === 0);

      expect(firstBinHasEnergy).toBe(true);
      expect(secondBinIsSilent).toBe(true);
    }
  });

  test('output length matches the histogram duration at the given sample rate, on every channel', () => {
    const histogram = buildSilentHistogram(4, 0.01); // 40ms total
    const channels = synthesizeImpulseResponseFromHistogram(
      histogram,
      2000,
      { distanceMeters: 1, isOccluded: true, panPosition: 0 },
      343,
      true,
      buildCyclingRandomSource(),
    );
    for (const impulseResponse of channels) {
      expect(impulseResponse.length).toBe(80);
    }
  });

  test('produces more than one channel, each with independently drawn noise so the reflection tail decorrelates between them', () => {
    const histogram = buildSilentHistogram(4, 0.005);
    histogram.low.fill(1);
    histogram.mid.fill(1);
    histogram.high.fill(1);

    const channels = synthesizeImpulseResponseFromHistogram(
      histogram,
      1000,
      { distanceMeters: 1000, isOccluded: true, panPosition: 0 },
      343,
      true,
      buildCyclingRandomSource(),
    );

    expect(channels.length).toBeGreaterThanOrEqual(2);
    expect(Array.from(channels[0])).not.toEqual(Array.from(channels[1]));
  });

  test('when stereo simulation is enabled, a fully right-panned direct sound is louder on the right channel than the left', () => {
    const histogram = buildSilentHistogram(1, 0.005);
    const channels = synthesizeImpulseResponseFromHistogram(
      histogram,
      1000,
      { distanceMeters: 1, isOccluded: false, panPosition: 1 },
      343,
      true,
      buildCyclingRandomSource(),
    );

    const directSampleIndex = Math.round((1 / 343) * 1000);
    expect(channels[1][directSampleIndex]).toBeGreaterThan(0);
    expect(channels[0][directSampleIndex]).toBeCloseTo(0);
  });

  test('when stereo simulation is disabled, a fully right-panned direct sound still lands identically on both channels', () => {
    const histogram = buildSilentHistogram(1, 0.005);
    const channels = synthesizeImpulseResponseFromHistogram(
      histogram,
      1000,
      { distanceMeters: 1, isOccluded: false, panPosition: 1 },
      343,
      false,
      buildCyclingRandomSource(),
    );

    const directSampleIndex = Math.round((1 / 343) * 1000);
    expect(channels[0][directSampleIndex]).toBeCloseTo(channels[1][directSampleIndex]);
    expect(channels[0][directSampleIndex]).toBeCloseTo(1);
  });

  test('when stereo simulation is enabled, a bin panned fully left produces louder tail energy on the left channel than the right', () => {
    const histogram = buildSilentHistogram(1, 0.005);
    histogram.low.fill(1);
    histogram.pan[0] = -1;

    const channels = synthesizeImpulseResponseFromHistogram(
      histogram,
      1000,
      { distanceMeters: 1000, isOccluded: true, panPosition: 0 },
      343,
      true,
      buildCyclingRandomSource(),
    );

    const leftEnergy = Array.from(channels[0]).reduce((sum, sample) => sum + sample * sample, 0);
    const rightEnergy = Array.from(channels[1]).reduce((sum, sample) => sum + sample * sample, 0);
    expect(leftEnergy).toBeGreaterThan(rightEnergy);
  });
});
