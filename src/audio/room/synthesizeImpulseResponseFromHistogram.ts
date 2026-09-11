import { createOnePoleLowpassFilter, HIGH_BAND_CUTOFF_HERTZ, LOW_BAND_CUTOFF_HERTZ } from './bandSplitFilters';
import type { EnergyHistogram } from './buildEnergyHistogram';
import type { DirectSoundPath } from './directSound';
import { stereoPanWeightsFromPosition } from './stereoPanning';

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

/** Per-bin left/right amplitude weights for the diffuse tail — Steam Audio's constant-power stereo pan law
    (`stereoPanWeightsFromPosition`) applied to each bin's energy-weighted average direction, or a flat 1 for
    every bin (no directional bias, today's non-stereo-simulation behavior) when the caller has stereo
    simulation turned off. */
function computeChannelWeightsPerBin(histogram: EnergyHistogram, stereoSimulationEnabled: boolean): { left: Float32Array; right: Float32Array } {
  const binCount = histogram.low.length;
  const left = new Float32Array(binCount);
  const right = new Float32Array(binCount);

  for (let binIndex = 0; binIndex < binCount; binIndex++) {
    const weights = stereoSimulationEnabled ? stereoPanWeightsFromPosition(histogram.pan[binIndex]) : { left: 1, right: 1 };
    left[binIndex] = weights.left;
    right[binIndex] = weights.right;
  }

  return { left, right };
}

/** Builds one channel's waveform from one independent noise realization — the histogram envelope (and so the
    reflections' timing/energy) is identical across channels but for `channelWeightsPerBin`, and only the
    underlying noise texture otherwise differs. */
function buildChannelImpulseResponse(
  histogram: EnergyHistogram,
  sampleCount: number,
  samplesPerBin: number,
  noiseTracks: BandLimitedNoiseTracks,
  channelWeightsPerBin: Float32Array,
): Float32Array<ArrayBuffer> {
  const impulseResponse = new Float32Array(sampleCount);

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    const binIndex = Math.min(histogram.low.length - 1, Math.floor(sampleIndex / samplesPerBin));
    impulseResponse[sampleIndex] =
      channelWeightsPerBin[binIndex] *
      (Math.sqrt(histogram.low[binIndex]) * noiseTracks.low[sampleIndex] +
        Math.sqrt(histogram.mid[binIndex]) * noiseTracks.mid[sampleIndex] +
        Math.sqrt(histogram.high[binIndex]) * noiseTracks.high[sampleIndex]);
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
 * true coherent single arrival, not something that should decorrelate. When `stereoSimulationEnabled` is on,
 * both the diffuse tail (per bin) and the direct-sound spike are additionally panned left/right via Steam
 * Audio's constant-power stereo pan law (`stereoPanning.ts`), giving the result a real interaural level
 * difference instead of only decorrelated noise; when it's off, every bin and the direct sound keep full
 * amplitude on both channels, exactly as before this option existed. The result is meant to be convolved
 * with dry audio via `convolveWithImpulseResponse.ts`.
 */
export function synthesizeImpulseResponseFromHistogram(
  histogram: EnergyHistogram,
  sampleRate: number,
  directSound: DirectSoundPath,
  speedOfSoundMetersPerSecond: number,
  stereoSimulationEnabled: boolean,
  randomSource: () => number = Math.random,
): Float32Array<ArrayBuffer>[] {
  const totalDurationSeconds = histogram.low.length * histogram.binDurationSeconds;
  const sampleCount = Math.max(1, Math.round(totalDurationSeconds * sampleRate));
  const samplesPerBin = Math.max(1, Math.round(histogram.binDurationSeconds * sampleRate));

  const channelWeightsPerBin = computeChannelWeightsPerBin(histogram, stereoSimulationEnabled);
  const orderedChannelWeights = [channelWeightsPerBin.left, channelWeightsPerBin.right];

  const channels = orderedChannelWeights.map(channelWeights => {
    const noiseTracks = synthesizeBandLimitedNoiseTracks(sampleCount, sampleRate, randomSource);
    return buildChannelImpulseResponse(histogram, sampleCount, samplesPerBin, noiseTracks, channelWeights);
  });

  if (!directSound.isOccluded) {
    const directSampleIndex = Math.round((directSound.distanceMeters / speedOfSoundMetersPerSecond) * sampleRate);
    if (directSampleIndex >= 0 && directSampleIndex < sampleCount) {
      // Floored so a source placed right on top of the listener doesn't divide by ~0.
      const directAmplitude = 1 / Math.max(1, directSound.distanceMeters);
      const directWeights = stereoSimulationEnabled ? stereoPanWeightsFromPosition(directSound.panPosition) : { left: 1, right: 1 };
      channels[0][directSampleIndex] += directAmplitude * directWeights.left;
      channels[1][directSampleIndex] += directAmplitude * directWeights.right;
    }
  }

  return channels;
}
