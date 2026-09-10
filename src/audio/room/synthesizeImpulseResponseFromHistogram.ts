import { createOnePoleLowpassFilter, HIGH_BAND_CUTOFF_HERTZ, LOW_BAND_CUTOFF_HERTZ } from './bandSplitFilters';
import type { EnergyHistogram } from './buildEnergyHistogram';
import type { DirectSoundPath } from './directSound';

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

const NUMBER_OF_OUTPUT_CHANNELS = 2;

/** Builds one channel's waveform from one independent noise realization — the histogram envelope (and so the
    reflections' timing/energy) is identical across channels, only the underlying noise texture differs. */
function buildChannelImpulseResponse(
  histogram: EnergyHistogram,
  sampleCount: number,
  samplesPerBin: number,
  noiseTracks: BandLimitedNoiseTracks,
): Float32Array<ArrayBuffer> {
  const impulseResponse = new Float32Array(sampleCount);

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    const binIndex = Math.min(histogram.low.length - 1, Math.floor(sampleIndex / samplesPerBin));
    impulseResponse[sampleIndex] =
      Math.sqrt(histogram.low[binIndex]) * noiseTracks.low[sampleIndex] +
      Math.sqrt(histogram.mid[binIndex]) * noiseTracks.mid[sampleIndex] +
      Math.sqrt(histogram.high[binIndex]) * noiseTracks.high[sampleIndex];
  }

  return impulseResponse;
}

/**
 * Turns an energy-decay histogram (see `buildEnergyHistogram.ts`) into a stereo pair of impulse-response
 * waveforms: each time bin's per-band energy scales that band's noise for the samples in that bin (amplitude
 * is the square root of energy), summed across bands, plus a direct-sound impulse placed at its own
 * speed-of-sound delay with simple inverse-distance falloff. The two channels are built from independently
 * drawn noise realizations of the same histogram envelope — real reflections reach each ear decorrelated,
 * and rendering both channels from one shared noise signal (as a single mono impulse response convolved
 * identically into every output channel would) makes reflections read as glued to the direct sound rather
 * than spatially separate from it, which is what made even a single, physically correct reflection sound
 * like a small enclosed space instead of open air. The direct path stays identical on both channels — it's a
 * true coherent single arrival, not something that should decorrelate. The result is meant to be convolved
 * with dry audio via `convolveWithImpulseResponse.ts`.
 */
export function synthesizeImpulseResponseFromHistogram(
  histogram: EnergyHistogram,
  sampleRate: number,
  directSound: DirectSoundPath,
  speedOfSoundMetersPerSecond: number,
  randomSource: () => number = Math.random,
): Float32Array<ArrayBuffer>[] {
  const totalDurationSeconds = histogram.low.length * histogram.binDurationSeconds;
  const sampleCount = Math.max(1, Math.round(totalDurationSeconds * sampleRate));
  const samplesPerBin = Math.max(1, Math.round(histogram.binDurationSeconds * sampleRate));

  const channels = Array.from({ length: NUMBER_OF_OUTPUT_CHANNELS }, () => {
    const noiseTracks = synthesizeBandLimitedNoiseTracks(sampleCount, sampleRate, randomSource);
    return buildChannelImpulseResponse(histogram, sampleCount, samplesPerBin, noiseTracks);
  });

  if (!directSound.isOccluded) {
    const directSampleIndex = Math.round((directSound.distanceMeters / speedOfSoundMetersPerSecond) * sampleRate);
    if (directSampleIndex >= 0 && directSampleIndex < sampleCount) {
      // Floored so a source placed right on top of the listener doesn't divide by ~0.
      const directAmplitude = 1 / Math.max(1, directSound.distanceMeters);
      for (const channel of channels) channel[directSampleIndex] += directAmplitude;
    }
  }

  return channels;
}
