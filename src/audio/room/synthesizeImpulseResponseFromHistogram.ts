import type { EnergyHistogram } from './buildEnergyHistogram';
import type { DirectSoundPath } from './directSound';

const LOW_BAND_CUTOFF_HERTZ = 500;
const HIGH_BAND_CUTOFF_HERTZ = 4000;

function createOnePoleLowpassFilter(cutoffHertz: number, sampleRate: number): (input: number) => number {
  const smoothingFactor = 1 - Math.exp((-2 * Math.PI * cutoffHertz) / sampleRate);
  let previousOutput = 0;
  return (input: number) => {
    previousOutput += smoothingFactor * (input - previousOutput);
    return previousOutput;
  };
}

interface BandLimitedNoiseTracks {
  low: Float32Array;
  mid: Float32Array;
  high: Float32Array;
}

/** Splits one shared white-noise source into three bands via the "difference of lowpass filters" technique:
    a low band and a separately-cutoff low band are each lowpassed from the same noise, the low band is used
    as-is, the high band is what a high lowpass removes from the raw noise, and the mid band is whatever falls
    between the two lowpass outputs. Cheap (two one-pole filters, no FFT) and enough to give the synthesized
    tail believable frequency-dependent decay. */
function synthesizeBandLimitedNoiseTracks(sampleCount: number, sampleRate: number, randomSource: () => number): BandLimitedNoiseTracks {
  const lowLowpass = createOnePoleLowpassFilter(LOW_BAND_CUTOFF_HERTZ, sampleRate);
  const highLowpass = createOnePoleLowpassFilter(HIGH_BAND_CUTOFF_HERTZ, sampleRate);

  const low = new Float32Array(sampleCount);
  const mid = new Float32Array(sampleCount);
  const high = new Float32Array(sampleCount);

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    const whiteNoiseSample = randomSource() * 2 - 1;
    const lowValue = lowLowpass(whiteNoiseSample);
    const highLowpassValue = highLowpass(whiteNoiseSample);

    low[sampleIndex] = lowValue;
    mid[sampleIndex] = highLowpassValue - lowValue;
    high[sampleIndex] = whiteNoiseSample - highLowpassValue;
  }

  return { low, mid, high };
}

/**
 * Turns an energy-decay histogram (see `buildEnergyHistogram.ts`) into an actual impulse-response waveform:
 * each time bin's per-band energy scales that band's noise for the samples in that bin (amplitude is the
 * square root of energy), summed across bands, plus a direct-sound impulse placed at its own speed-of-sound
 * delay with simple inverse-distance falloff. The result is meant to be convolved with dry audio via
 * `convolveWithImpulseResponse.ts`.
 */
export function synthesizeImpulseResponseFromHistogram(
  histogram: EnergyHistogram,
  sampleRate: number,
  directSound: DirectSoundPath,
  speedOfSoundMetersPerSecond: number,
  randomSource: () => number = Math.random,
): Float32Array<ArrayBuffer> {
  const totalDurationSeconds = histogram.low.length * histogram.binDurationSeconds;
  const sampleCount = Math.max(1, Math.round(totalDurationSeconds * sampleRate));
  const impulseResponse = new Float32Array(sampleCount);

  const noiseTracks = synthesizeBandLimitedNoiseTracks(sampleCount, sampleRate, randomSource);
  const samplesPerBin = Math.max(1, Math.round(histogram.binDurationSeconds * sampleRate));

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    const binIndex = Math.min(histogram.low.length - 1, Math.floor(sampleIndex / samplesPerBin));
    impulseResponse[sampleIndex] =
      Math.sqrt(histogram.low[binIndex]) * noiseTracks.low[sampleIndex] +
      Math.sqrt(histogram.mid[binIndex]) * noiseTracks.mid[sampleIndex] +
      Math.sqrt(histogram.high[binIndex]) * noiseTracks.high[sampleIndex];
  }

  if (!directSound.isOccluded) {
    const directSampleIndex = Math.round((directSound.distanceMeters / speedOfSoundMetersPerSecond) * sampleRate);
    if (directSampleIndex >= 0 && directSampleIndex < impulseResponse.length) {
      // Floored so a source placed right on top of the listener doesn't divide by ~0.
      impulseResponse[directSampleIndex] += 1 / Math.max(1, directSound.distanceMeters);
    }
  }

  return impulseResponse;
}
