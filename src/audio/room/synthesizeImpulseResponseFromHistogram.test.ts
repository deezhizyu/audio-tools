import { describe, expect, test } from 'vitest';
import { synthesizeImpulseResponseFromHistogram } from './synthesizeImpulseResponseFromHistogram';
import type { EnergyHistogram } from './buildEnergyHistogram';

function buildSilentHistogram(binCount: number, binDurationSeconds: number): EnergyHistogram {
  return { binDurationSeconds, low: new Float32Array(binCount), mid: new Float32Array(binCount), high: new Float32Array(binCount) };
}

/** Deterministic, non-constant "randomness" so band-noise generation is reproducible without depending on
    global RNG seeding. */
function buildCyclingRandomSource(): () => number {
  let counter = 0;
  return () => (counter++ % 11) / 11;
}

describe('synthesizeImpulseResponseFromHistogram', () => {
  test('an all-zero histogram with an unoccluded direct path is silent except at the direct-sound delay', () => {
    const histogram = buildSilentHistogram(1, 0.005);
    const sampleRate = 1000;

    const impulseResponse = synthesizeImpulseResponseFromHistogram(
      histogram,
      sampleRate,
      { distanceMeters: 1, isOccluded: false },
      343,
      buildCyclingRandomSource(),
    );

    const expectedDirectSampleIndex = Math.round((1 / 343) * sampleRate);
    for (let sampleIndex = 0; sampleIndex < impulseResponse.length; sampleIndex++) {
      if (sampleIndex === expectedDirectSampleIndex) {
        expect(impulseResponse[sampleIndex]).toBeCloseTo(1);
      } else {
        // `=== 0` rather than `toBe(0)`: a zero-energy bin can legitimately compute to signed `-0`, which is
        // numerically silent but fails `toBe`'s `Object.is`-based comparison against `0`.
        expect(impulseResponse[sampleIndex] === 0).toBe(true);
      }
    }
  });

  test('an occluded direct path produces total silence for an all-zero histogram', () => {
    const histogram = buildSilentHistogram(1, 0.005);
    const impulseResponse = synthesizeImpulseResponseFromHistogram(
      histogram,
      1000,
      { distanceMeters: 1, isOccluded: true },
      343,
      buildCyclingRandomSource(),
    );
    expect(Array.from(impulseResponse).every(value => value === 0)).toBe(true);
  });

  test('energy in a histogram bin produces non-silent output over that bin', () => {
    const histogram = buildSilentHistogram(2, 0.005);
    histogram.mid[0] = 1;

    const impulseResponse = synthesizeImpulseResponseFromHistogram(
      histogram,
      1000,
      { distanceMeters: 1000, isOccluded: true }, // occluded direct path, so only the histogram contributes
      343,
      buildCyclingRandomSource(),
    );

    const samplesInFirstBin = Math.round(0.005 * 1000);
    const firstBinHasEnergy = Array.from(impulseResponse.slice(0, samplesInFirstBin)).some(value => value !== 0);
    const secondBinIsSilent = Array.from(impulseResponse.slice(samplesInFirstBin)).every(value => value === 0);

    expect(firstBinHasEnergy).toBe(true);
    expect(secondBinIsSilent).toBe(true);
  });

  test('output length matches the histogram duration at the given sample rate', () => {
    const histogram = buildSilentHistogram(4, 0.01); // 40ms total
    const impulseResponse = synthesizeImpulseResponseFromHistogram(histogram, 2000, { distanceMeters: 1, isOccluded: true }, 343, buildCyclingRandomSource());
    expect(impulseResponse.length).toBe(80);
  });
});
