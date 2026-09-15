import { createOnePoleLowpassFilter, HIGH_BAND_CUTOFF_HERTZ, LOW_BAND_CUTOFF_HERTZ } from './bandSplitFilters';
import type { EnergyHistogram } from './buildEnergyHistogram';
import { stereoPanWeightsFromPosition } from './stereoPanning';

interface BandLimitedNoiseTracks {
  low: Float32Array;
  mid: Float32Array;
  high: Float32Array;
}

/** Scales a signal so its mean square is exactly 1, i.e. each sample carries an average energy of 1. */
function normalizeToUnitMeanSquare(track: Float32Array): void {
  let sumOfSquares = 0;
  for (let sampleIndex = 0; sampleIndex < track.length; sampleIndex++) sumOfSquares += track[sampleIndex] * track[sampleIndex];
  if (sumOfSquares <= 0) return;

  const scale = Math.sqrt(track.length / sumOfSquares);
  for (let sampleIndex = 0; sampleIndex < track.length; sampleIndex++) track[sampleIndex] *= scale;
}

function dotProduct(a: Float32Array, b: Float32Array): number {
  let total = 0;
  for (let sampleIndex = 0; sampleIndex < a.length; sampleIndex++) total += a[sampleIndex] * b[sampleIndex];
  return total;
}

/** Subtracts whatever part of `track` runs along `basis`, leaving the two with no overlap at all. */
function removeComponentAlong(track: Float32Array, basis: Float32Array): void {
  const basisEnergy = dotProduct(basis, basis);
  if (basisEnergy <= 0) return;

  const overlap = dotProduct(track, basis) / basisEnergy;
  for (let sampleIndex = 0; sampleIndex < track.length; sampleIndex++) track[sampleIndex] -= overlap * basis[sampleIndex];
}

/**
 * Makes the three band tracks mutually independent, then rescales them so their energies still add up to the
 * white noise's.
 *
 * The one-pole filters the bands are split with roll off gently, so neighboring bands genuinely share content
 * and their energies do not add: scaled independently, they interfere, and a bin renders up to about 1.2dB
 * away from the energy the histogram says it holds — a spectrum-dependent error, so it lands hardest on
 * exactly the strongly-shaped tails (a carpeted room, a tiled one) that make rooms sound different from each
 * other. Removing the overlap costs three dot products and makes the module's central promise — a bin renders
 * at the energy it carries — hold for every spectrum rather than only a flat one. The bands keep their
 * relative sizes through the rescale, so each still carries its own share of the spectrum.
 */
function orthogonalizeBandTracks({ low, mid, high }: BandLimitedNoiseTracks): void {
  removeComponentAlong(mid, low);
  removeComponentAlong(high, low);
  removeComponentAlong(high, mid);

  const totalEnergy = dotProduct(low, low) + dotProduct(mid, mid) + dotProduct(high, high);
  if (totalEnergy <= 0) return;

  const scale = Math.sqrt(low.length / totalEnergy);
  for (let sampleIndex = 0; sampleIndex < low.length; sampleIndex++) {
    low[sampleIndex] *= scale;
    mid[sampleIndex] *= scale;
    high[sampleIndex] *= scale;
  }
}

/**
 * Splits one shared white-noise source into three bands via the "difference of lowpass filters" technique:
 * a low band and a separately-cutoff low band are each lowpassed from the same noise, the low band is used
 * as-is, the high band is what a high lowpass removes from the raw noise, and the mid band is whatever falls
 * between the two lowpass outputs. Cheap (two one-pole filters, no FFT) and enough to give the synthesized
 * tail believable frequency-dependent decay.
 *
 * That the three tracks come from one *shared* source is what makes the energy bookkeeping work. Each band's
 * share of the total energy is then its share of the spectrum, so a band covering a tenth of the audible
 * range carries a tenth of the energy — and a flat three-band energy spectrum renders as one flat broadband
 * signal rather than as three stacked copies of it. The bands' very different variances are that bandwidth,
 * not an accident to be corrected: normalizing each band to the same level (or drawing them from independent
 * noise) would make a flat spectrum come out roughly three times too loud, and mis-weight every other one.
 *
 * The white noise is normalized to unit mean square before splitting, and the bands are left mutually
 * independent afterwards (see `orthogonalizeBandTracks`), so a band amplitude in
 * `computeChannelAmplitudePerBin` is a plain square root of the energy that band should carry.
 */
function synthesizeBandLimitedNoiseTracks(sampleCount: number, sampleRate: number, randomSource: () => number): BandLimitedNoiseTracks {
  const whiteNoise = new Float32Array(sampleCount);
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) whiteNoise[sampleIndex] = randomSource() * 2 - 1;
  normalizeToUnitMeanSquare(whiteNoise);

  const lowLowpass = createOnePoleLowpassFilter(LOW_BAND_CUTOFF_HERTZ, sampleRate);
  const highLowpass = createOnePoleLowpassFilter(HIGH_BAND_CUTOFF_HERTZ, sampleRate);

  const low = new Float32Array(sampleCount);
  const mid = new Float32Array(sampleCount);
  const high = new Float32Array(sampleCount);

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    const whiteNoiseSample = whiteNoise[sampleIndex];
    const lowValue = lowLowpass(whiteNoiseSample);
    const highLowpassValue = highLowpass(whiteNoiseSample);

    low[sampleIndex] = lowValue;
    mid[sampleIndex] = highLowpassValue - lowValue;
    high[sampleIndex] = whiteNoiseSample - highLowpassValue;
  }

  const tracks = { low, mid, high };
  orthogonalizeBandTracks(tracks);
  return tracks;
}

/**
 * One channel's per-bin, per-band sample amplitude: the square root of the energy each sample in that bin
 * should carry, times that bin's left/right weight.
 *
 * Dividing the bin's energy by how many samples it spans is the step that makes the tail's level physically
 * meaningful. A bin holds a total energy, and the shared noise it scales delivers one unit of energy per
 * sample across all three bands together, so spreading that total over `samplesPerBin` samples requires
 * exactly this. Writing `sqrt(binEnergy)` per
 * sample instead — what this pipeline used to do — hands every bin `samplesPerBin` times its own energy,
 * which at 48kHz and 5ms bins is a factor of 240: the diffuse tail came out roughly 19dB louder than the
 * early reflections it is supposed to be a seamless continuation of.
 *
 * The stereo weights are folded in here rather than applied afterwards so that they get interpolated along
 * with everything else, and a moving stereo image doesn't step from bin to bin.
 */
function computeChannelAmplitudePerBin(
  histogram: EnergyHistogram,
  samplesPerBin: number,
  stereoSimulationEnabled: boolean,
  channelIndex: number,
): BandLimitedNoiseTracks {
  const binCount = histogram.low.length;
  const low = new Float32Array(binCount);
  const mid = new Float32Array(binCount);
  const high = new Float32Array(binCount);

  for (let binIndex = 0; binIndex < binCount; binIndex++) {
    const weights = stereoSimulationEnabled ? stereoPanWeightsFromPosition(histogram.pan[binIndex]) : { left: 1, right: 1 };
    const channelWeight = channelIndex === 0 ? weights.left : weights.right;
    low[binIndex] = channelWeight * Math.sqrt(histogram.low[binIndex] / samplesPerBin);
    mid[binIndex] = channelWeight * Math.sqrt(histogram.mid[binIndex] / samplesPerBin);
    high[binIndex] = channelWeight * Math.sqrt(histogram.high[binIndex] / samplesPerBin);
  }

  return { low, mid, high };
}

/** Builds one channel's waveform by scaling band-limited noise with the per-bin amplitudes, linearly
    interpolated between neighboring bin centers. The interpolation matters: reading one bin's value flat
    across all of its samples (what this used to do) makes the decay envelope a staircase, stepping every
    5ms — an audible 200Hz buzz riding on the tail that has nothing to do with the room. */
function buildChannelImpulseResponse(
  amplitudePerBin: BandLimitedNoiseTracks,
  sampleCount: number,
  samplesPerBin: number,
  noiseTracks: BandLimitedNoiseTracks,
): Float32Array<ArrayBuffer> {
  const impulseResponse = new Float32Array(sampleCount);
  const lastBinIndex = amplitudePerBin.low.length - 1;

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    // Bin values are treated as sitting at their bin's center, so the interpolation is symmetric rather than
    // lagging half a bin behind.
    const binPosition = sampleIndex / samplesPerBin - 0.5;
    const lowerBinIndex = Math.floor(binPosition);
    const blend = binPosition - lowerBinIndex;
    const beforeIndex = Math.min(Math.max(lowerBinIndex, 0), lastBinIndex);
    const afterIndex = Math.min(Math.max(lowerBinIndex + 1, 0), lastBinIndex);

    const lowAmplitude = amplitudePerBin.low[beforeIndex] * (1 - blend) + amplitudePerBin.low[afterIndex] * blend;
    const midAmplitude = amplitudePerBin.mid[beforeIndex] * (1 - blend) + amplitudePerBin.mid[afterIndex] * blend;
    const highAmplitude = amplitudePerBin.high[beforeIndex] * (1 - blend) + amplitudePerBin.high[afterIndex] * blend;

    impulseResponse[sampleIndex] =
      lowAmplitude * noiseTracks.low[sampleIndex] + midAmplitude * noiseTracks.mid[sampleIndex] + highAmplitude * noiseTracks.high[sampleIndex];
  }

  return impulseResponse;
}

/**
 * Turns an energy-decay histogram (see `buildEnergyHistogram.ts`) into the diffuse reverb tail: a stereo pair
 * of waveforms in which each time bin's per-band energy is spread across that bin's samples as band-limited
 * noise. This is the right model for the late field specifically — thousands of paths arriving from every
 * direction at once, none individually audible — and the wrong one for any single coherent path, which is why
 * the direct sound and the early specular echoes are rendered separately as discrete arrivals
 * (`renderDiscreteArrivals.ts`) and added on top of what this produces.
 *
 * Because a bin's rendered energy is exactly the energy the histogram says it holds, the tail lands on the
 * same absolute scale as those discrete arrivals, and the direct-to-reverberant ratio the whole impulse
 * response comes out with is the one the room's geometry and materials actually imply — the quantity that
 * decides whether a space sounds close or distant.
 *
 * The two channels are built from independently drawn noise realizations of the same histogram envelope —
 * real reflections reach each ear decorrelated, and rendering both channels from one shared noise signal (as
 * a single mono impulse response convolved identically into every output channel would) makes reflections
 * read as glued to the direct sound rather than spatially separate from it, which is what made even a single,
 * physically correct reflection sound like a small enclosed space instead of open air. When
 * `stereoSimulationEnabled` is on, each bin is additionally panned left/right via Steam Audio's
 * constant-power stereo pan law (`stereoPanning.ts`), giving the tail a real interaural level difference
 * instead of only decorrelated noise; when it's off, every bin keeps full amplitude on both channels.
 */
export function synthesizeImpulseResponseFromHistogram(
  histogram: EnergyHistogram,
  sampleRate: number,
  stereoSimulationEnabled: boolean,
  randomSource: () => number = Math.random,
): Float32Array<ArrayBuffer>[] {
  const totalDurationSeconds = histogram.low.length * histogram.binDurationSeconds;
  const sampleCount = Math.max(1, Math.round(totalDurationSeconds * sampleRate));
  const samplesPerBin = Math.max(1, Math.round(histogram.binDurationSeconds * sampleRate));

  return [0, 1].map(channelIndex => {
    const amplitudePerBin = computeChannelAmplitudePerBin(histogram, samplesPerBin, stereoSimulationEnabled, channelIndex);
    const noiseTracks = synthesizeBandLimitedNoiseTracks(sampleCount, sampleRate, randomSource);
    return buildChannelImpulseResponse(amplitudePerBin, sampleCount, samplesPerBin, noiseTracks);
  });
}
