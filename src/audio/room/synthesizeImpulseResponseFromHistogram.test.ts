import { describe, expect, test } from 'vitest';
import { synthesizeImpulseResponseFromHistogram } from './synthesizeImpulseResponseFromHistogram';
import type { EnergyHistogram } from './buildEnergyHistogram';
import { buildTestListener } from './testHelpers/buildTestRoomScene';

function buildSilentHistogram(binCount: number, binDurationSeconds: number): EnergyHistogram {
  return {
    binDurationSeconds,
    low: new Float32Array(binCount),
    mid: new Float32Array(binCount),
    high: new Float32Array(binCount),
    lateralPosition: new Float32Array(binCount),
  };
}

/** Deterministic, well-distributed "randomness" so band-noise generation is reproducible without depending on
    global RNG seeding. A plain short cycle won't do here — the noise is fed through band-split filters, and a
    periodic source would correlate with them rather than exercising them. */
function buildSeededRandomSource(seed = 1): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function totalEnergy(impulseResponse: Float32Array<ArrayBuffer>): number {
  return Array.from(impulseResponse).reduce((sum, sample) => sum + sample * sample, 0);
}

describe('synthesizeImpulseResponseFromHistogram', () => {
  test('an all-zero histogram is silent on every channel', () => {
    const channels = synthesizeImpulseResponseFromHistogram(buildSilentHistogram(4, 0.005), 1000, buildTestListener({ mode: 'binaural' }), buildSeededRandomSource());
    for (const impulseResponse of channels) {
      expect(Array.from(impulseResponse).every(value => value === 0)).toBe(true);
    }
  });

  test("a bin's rendered energy equals the energy the histogram says it holds", () => {
    // The central calibration invariant of this module, and the one the whole simulation's
    // direct-to-reverberant balance rests on. A bin holds a total energy; spreading it over that bin's samples
    // must neither create nor destroy any. Writing sqrt(binEnergy) per sample — which is what this used to do
    // — instead multiplies every bin by however many samples it spans, which at a realistic sample rate is a
    // factor of a couple of hundred.
    //
    // A flat spectrum makes this exact rather than statistical: the three band tracks sum back to the unit
    // white noise they were split from, so scaling them equally reproduces that noise exactly.
    const binCount = 200;
    const sampleRate = 8000;
    const energyPerBin = 0.25;

    const histogram = buildSilentHistogram(binCount, 0.005);
    histogram.low.fill(energyPerBin);
    histogram.mid.fill(energyPerBin);
    histogram.high.fill(energyPerBin);

    for (const impulseResponse of synthesizeImpulseResponseFromHistogram(histogram, sampleRate, buildTestListener(), buildSeededRandomSource())) {
      expect(totalEnergy(impulseResponse)).toBeCloseTo(energyPerBin * binCount, 4);
    }
  });

  test("each band carries its own share of the spectrum, so the three bands' energies add up to the full-band one", () => {
    // A band's energy is the energy in *that part of the spectrum*, so a band spanning a tenth of the audible
    // range contributes a tenth as much to a broadband total. Normalizing each band's noise to the same level
    // — which looks like a fix for their very different variances, but isn't — would make all three
    // contribute equally and inflate a flat spectrum roughly threefold.
    const binCount = 200;
    const sampleRate = 8000;
    const renderBandEnergy = (bands: ('low' | 'mid' | 'high')[]): number => {
      const histogram = buildSilentHistogram(binCount, 0.005);
      for (const band of bands) histogram[band].fill(1);
      return totalEnergy(synthesizeImpulseResponseFromHistogram(histogram, sampleRate, buildTestListener(), buildSeededRandomSource())[0]);
    };

    const fullBand = renderBandEnergy(['low', 'mid', 'high']);
    const separately = renderBandEnergy(['low']) + renderBandEnergy(['mid']) + renderBandEnergy(['high']);

    expect(separately / fullBand).toBeCloseTo(1, 4);
    // And no single band accounts for the whole thing, which is what a per-band normalization would produce.
    expect(renderBandEnergy(['low'])).toBeLessThan(fullBand * 0.9);
  });

  test("a bin's energy tapers smoothly into its neighbors instead of stopping at a hard bin edge", () => {
    // Reading one bin's value flat across every one of its samples makes the decay envelope a staircase that
    // steps at the bin rate — an audible buzz on the tail. Interpolating between bin centers is what removes
    // it, and it necessarily means a loud bin bleeds into a silent neighbor.
    const histogram = buildSilentHistogram(4, 0.005);
    histogram.mid[1] = 1;

    const [firstChannel] = synthesizeImpulseResponseFromHistogram(histogram, 1000, buildTestListener(), buildSeededRandomSource());

    const samplesPerBin = 5;
    const binEnergy = (binIndex: number) =>
      totalEnergy(firstChannel.slice(binIndex * samplesPerBin, (binIndex + 1) * samplesPerBin) as Float32Array<ArrayBuffer>);

    expect(binEnergy(1)).toBeGreaterThan(0);
    expect(binEnergy(0)).toBeGreaterThan(0); // tapering in
    expect(binEnergy(2)).toBeGreaterThan(0); // tapering out
    expect(binEnergy(0)).toBeLessThan(binEnergy(1));
    expect(binEnergy(3)).toBe(0); // two bins away is untouched
  });

  test('output length matches the histogram duration at the given sample rate, on every channel', () => {
    const histogram = buildSilentHistogram(4, 0.01); // 40ms total
    for (const impulseResponse of synthesizeImpulseResponseFromHistogram(histogram, 2000, buildTestListener({ mode: 'binaural' }), buildSeededRandomSource())) {
      expect(impulseResponse.length).toBe(80);
    }
  });

  test('a binaural listener gets two channels that differ, since real reflections do not reach both ears alike', () => {
    const histogram = buildSilentHistogram(4, 0.005);
    histogram.low.fill(1);
    histogram.mid.fill(1);
    histogram.high.fill(1);

    const channels = synthesizeImpulseResponseFromHistogram(histogram, 1000, buildTestListener({ mode: 'binaural' }), buildSeededRandomSource());

    expect(channels.length).toBeGreaterThanOrEqual(2);
    expect(Array.from(channels[0])).not.toEqual(Array.from(channels[1]));
  });

  test("a tail arriving from one side is shadowed by the head on its way to the other ear", () => {
    const histogram = buildSilentHistogram(4, 0.005);
    histogram.low.fill(1);
    histogram.mid.fill(1);
    histogram.lateralPosition.fill(-1);

    const channels = synthesizeImpulseResponseFromHistogram(histogram, 1000, buildTestListener({ mode: 'binaural' }), buildSeededRandomSource());

    expect(totalEnergy(channels[0])).toBeGreaterThan(totalEnergy(channels[1]));
  });

  test('a mono listener hears the same tail on both channels, wherever it comes from', () => {
    const histogram = buildSilentHistogram(4, 0.005);
    histogram.low.fill(1);
    histogram.mid.fill(1);
    histogram.lateralPosition.fill(-1);

    const channels = synthesizeImpulseResponseFromHistogram(histogram, 1000, buildTestListener(), buildSeededRandomSource());

    // One omnidirectional capsule: no shadowing, and fully coherent, so the two channels are identical.
    expect(Array.from(channels[0])).toEqual(Array.from(channels[1]));
  });
});
