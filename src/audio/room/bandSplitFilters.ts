// Matches Steam Audio's own 3-band split (low: up to 800Hz, mid: 800Hz-8kHz, high: above 8kHz) — the same
// convention the published absorption tables backing `roomMaterials.ts` are measured/labeled against, so a
// material's low/mid/high coefficients get applied to the frequency ranges they actually describe.
export const LOW_BAND_CUTOFF_HERTZ = 800;
export const HIGH_BAND_CUTOFF_HERTZ = 8000;

export function createOnePoleLowpassFilter(cutoffHertz: number, sampleRate: number): (input: number) => number {
  const smoothingFactor = 1 - Math.exp((-2 * Math.PI * cutoffHertz) / sampleRate);
  let previousOutput = 0;
  return (input: number) => {
    previousOutput += smoothingFactor * (input - previousOutput);
    return previousOutput;
  };
}

export interface BandKernel {
  low: Float32Array;
  mid: Float32Array;
  high: Float32Array;
}

/** How long a single arrival's band-split kernel (see `buildBandImpulseKernel`) needs to run before its
    lowest band (the slowest to settle) has decayed to silence. */
const BAND_KERNEL_DURATION_SECONDS = 0.004;

/** The impulse response of the "difference of lowpasses" band split `synthesizeBandLimitedNoiseTracks`
    (in `synthesizeImpulseResponseFromHistogram.ts`) applies to white noise — computed here by feeding the
    same filters a single unit impulse instead. Gives a single discrete arrival (a first-bounce reflection
    tap, see `renderDiscreteReflectionTaps.ts`) the same low/mid/high spectral shape the noise-based
    reflection tail already uses, scaled per band by that arrival's own energy, instead of an unfiltered
    click. */
export function buildBandImpulseKernel(sampleRate: number): BandKernel {
  const kernelLengthSamples = Math.max(1, Math.round(sampleRate * BAND_KERNEL_DURATION_SECONDS));
  const lowLowpass = createOnePoleLowpassFilter(LOW_BAND_CUTOFF_HERTZ, sampleRate);
  const highLowpass = createOnePoleLowpassFilter(HIGH_BAND_CUTOFF_HERTZ, sampleRate);

  const low = new Float32Array(kernelLengthSamples);
  const mid = new Float32Array(kernelLengthSamples);
  const high = new Float32Array(kernelLengthSamples);

  for (let sampleIndex = 0; sampleIndex < kernelLengthSamples; sampleIndex++) {
    const impulseSample = sampleIndex === 0 ? 1 : 0;
    const lowValue = lowLowpass(impulseSample);
    const highLowpassValue = highLowpass(impulseSample);

    low[sampleIndex] = lowValue;
    mid[sampleIndex] = highLowpassValue - lowValue;
    high[sampleIndex] = impulseSample - highLowpassValue;
  }

  return { low, mid, high };
}
