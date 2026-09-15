/** Where the decay fit starts. The first few dB of a decay are contaminated by the direct sound and the
    strongest early reflections, which are not part of the statistical decay at all, so ISO 3382 starts its
    evaluation 5dB down rather than at the peak. */
const EVALUATION_START_DECIBELS = -5;

/** How far below `EVALUATION_START_DECIBELS` the fit runs. -25dB gives the standard T20 (a 20dB span,
    extrapolated to 60); a record that never decays that far falls back to the shorter spans below, since a
    rough reverberation time from a 10dB fit is far more useful here than none at all. */
const EVALUATION_END_DECIBELS_CANDIDATES = [-25, -15, -10];

const DECIBELS_IN_REVERBERATION_TIME = 60;

/**
 * Schroeder's backward energy integration: at each point in time, how much of the record's total energy is
 * still to come, in decibels relative to all of it. Integrating backwards this way turns one noisy decaying
 * signal into the smooth, monotonic curve a reverberation time can actually be fitted to — averaging over
 * every possible noise excitation at once, rather than measuring one particular one.
 *
 * `energyOverTime` is energy (not amplitude) per equal-duration step: a histogram bin's summed band energy,
 * or a rendered impulse response's squared samples. Both are used — the pipeline sizes its output from the
 * former, the calibration tests verify the result against the latter.
 */
export function schroederDecayCurveDecibels(energyOverTime: ArrayLike<number>): Float64Array {
  const stepCount = energyOverTime.length;
  const remainingEnergy = new Float64Array(stepCount);

  let runningTotal = 0;
  for (let stepIndex = stepCount - 1; stepIndex >= 0; stepIndex--) {
    runningTotal += energyOverTime[stepIndex];
    remainingEnergy[stepIndex] = runningTotal;
  }

  const decayCurveDecibels = new Float64Array(stepCount);
  const totalEnergy = remainingEnergy[0];
  if (totalEnergy <= 0) {
    decayCurveDecibels.fill(-Infinity);
    return decayCurveDecibels;
  }

  for (let stepIndex = 0; stepIndex < stepCount; stepIndex++) {
    decayCurveDecibels[stepIndex] = remainingEnergy[stepIndex] > 0 ? 10 * Math.log10(remainingEnergy[stepIndex] / totalEnergy) : -Infinity;
  }
  return decayCurveDecibels;
}

function findFirstIndexAtOrBelow(decayCurveDecibels: Float64Array, decibels: number): number | null {
  for (let stepIndex = 0; stepIndex < decayCurveDecibels.length; stepIndex++) {
    if (decayCurveDecibels[stepIndex] <= decibels) return stepIndex;
  }
  return null;
}

/** Least-squares slope (decibels per step) of the decay curve over `[startIndex, endIndex]`. A straight-line
    fit over the whole evaluation range rather than the slope between its two endpoints, so one unlucky bin at
    either end can't tilt the whole estimate. */
function fitDecaySlopeDecibelsPerStep(decayCurveDecibels: Float64Array, startIndex: number, endIndex: number): number | null {
  const sampleCount = endIndex - startIndex + 1;
  if (sampleCount < 2) return null;

  let indexSum = 0;
  let decibelSum = 0;
  for (let stepIndex = startIndex; stepIndex <= endIndex; stepIndex++) {
    indexSum += stepIndex;
    decibelSum += decayCurveDecibels[stepIndex];
  }
  const indexMean = indexSum / sampleCount;
  const decibelMean = decibelSum / sampleCount;

  let covariance = 0;
  let variance = 0;
  for (let stepIndex = startIndex; stepIndex <= endIndex; stepIndex++) {
    const indexDeviation = stepIndex - indexMean;
    covariance += indexDeviation * (decayCurveDecibels[stepIndex] - decibelMean);
    variance += indexDeviation * indexDeviation;
  }
  if (variance === 0) return null;
  return covariance / variance;
}

/**
 * The room's reverberation time — how long the sound takes to decay by 60dB — estimated from an energy-decay
 * record by fitting the Schroeder curve's slope over the standard evaluation range and extrapolating. Returns
 * `null` when the record never decays far enough to fit anything meaningful (an open field, an anechoic
 * scene, or a silent one), which callers read as "this scene has no reverberation to speak of" rather than
 * as a failure.
 *
 * `stepSeconds` is the duration one entry of `energyOverTime` covers: a histogram's bin duration, or `1 /
 * sampleRate` for a rendered impulse response.
 */
export function estimateReverberationTimeSeconds(energyOverTime: ArrayLike<number>, stepSeconds: number): number | null {
  const decayCurveDecibels = schroederDecayCurveDecibels(energyOverTime);
  const startIndex = findFirstIndexAtOrBelow(decayCurveDecibels, EVALUATION_START_DECIBELS);
  if (startIndex === null) return null;

  for (const endDecibels of EVALUATION_END_DECIBELS_CANDIDATES) {
    const endIndex = findFirstIndexAtOrBelow(decayCurveDecibels, endDecibels);
    if (endIndex === null) continue;

    const slopeDecibelsPerStep = fitDecaySlopeDecibelsPerStep(decayCurveDecibels, startIndex, endIndex);
    if (slopeDecibelsPerStep === null || slopeDecibelsPerStep >= 0) continue;

    return (-DECIBELS_IN_REVERBERATION_TIME / slopeDecibelsPerStep) * stepSeconds;
  }

  return null;
}
