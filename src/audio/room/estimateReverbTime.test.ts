import { describe, expect, test } from 'vitest';
import { estimateReverberationTimeSeconds, schroederDecayCurveDecibels } from './estimateReverbTime';

const STEP_SECONDS = 0.001;

/** An energy record that decays by exactly 60dB over `reverberationTimeSeconds`, run far enough past that to
    keep the backward integral's own truncation out of the evaluation range. */
function buildExponentialDecay(reverberationTimeSeconds: number, stepCount = 4000): Float64Array {
  const decayPerStep = (6 * Math.LN10 * STEP_SECONDS) / reverberationTimeSeconds;
  const energy = new Float64Array(stepCount);
  for (let stepIndex = 0; stepIndex < stepCount; stepIndex++) energy[stepIndex] = Math.exp(-decayPerStep * stepIndex);
  return energy;
}

describe('schroederDecayCurveDecibels', () => {
  test('starts at 0dB and decreases monotonically', () => {
    const curve = schroederDecayCurveDecibels(buildExponentialDecay(0.5));

    expect(curve[0]).toBeCloseTo(0, 10);
    for (let stepIndex = 1; stepIndex < 500; stepIndex++) {
      expect(curve[stepIndex]).toBeLessThan(curve[stepIndex - 1]);
    }
  });

  test('is all -Infinity for a silent record, rather than dividing by zero', () => {
    const curve = schroederDecayCurveDecibels(new Float64Array(16));
    expect(Array.from(curve).every(value => value === -Infinity)).toBe(true);
  });
});

describe('estimateReverberationTimeSeconds', () => {
  test('recovers the reverberation time of a known exponential decay', () => {
    for (const reverberationTimeSeconds of [0.3, 0.8, 2]) {
      const measured = estimateReverberationTimeSeconds(buildExponentialDecay(reverberationTimeSeconds), STEP_SECONDS);
      expect(measured).not.toBeNull();
      expect(measured!).toBeCloseTo(reverberationTimeSeconds, 2);
    }
  });

  test('is unaffected by the overall level of the record, only its slope', () => {
    const quiet = buildExponentialDecay(0.7);
    const loud = quiet.map(value => value * 1e6);

    expect(estimateReverberationTimeSeconds(loud, STEP_SECONDS)).toBeCloseTo(estimateReverberationTimeSeconds(quiet, STEP_SECONDS)!, 6);
  });

  test('returns null for a record with nothing to measure', () => {
    // A silent scene has no sound at all, and an open field is a single arrival with nothing following it.
    // Both are legitimate scenes rather than failures, so callers get "no reverberation here" and size their
    // impulse response accordingly, instead of a fabricated decay.
    const silence = new Float64Array(1000);
    const lonelyArrival = new Float64Array(1000);
    lonelyArrival[0] = 1;

    expect(estimateReverberationTimeSeconds(silence, STEP_SECONDS)).toBeNull();
    expect(estimateReverberationTimeSeconds(lonelyArrival, STEP_SECONDS)).toBeNull();
  });

  test('still estimates from a record that decays too little for the standard fit', () => {
    // A record that never reaches -25dB can't support the standard 20dB fit, so a shorter span is used
    // instead. Backward integration reads a record's abrupt end as part of the decay, so the answer is biased
    // short — but a reverberation time within a factor of two is far more useful for sizing an impulse
    // response than none at all, and a real trace runs long enough that the fit range sits nowhere near the
    // end of the record.
    const measured = estimateReverberationTimeSeconds(buildExponentialDecay(1, 200), STEP_SECONDS);

    expect(measured).not.toBeNull();
    expect(measured!).toBeGreaterThan(0.25);
    expect(measured!).toBeLessThan(2);
  });
});
