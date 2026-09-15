import { createOnePoleLowpassFilter, HIGH_BAND_CUTOFF_HERTZ, LOW_BAND_CUTOFF_HERTZ } from './bandSplitFilters';
import type { EnergyHistogram } from './buildEnergyHistogram';
import { computeDiffuseEarGains, EARS, interauralCoherence } from './listenerHeadModel';
import type { FrequencyBandValues, RoomListener } from './roomTypes';

interface BandLimitedNoiseTracks {
  low: Float32Array;
  mid: Float32Array;
  high: Float32Array;
}

const BAND_NAMES = ['low', 'mid', 'high'] as const;

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
 * Makes the three band tracks mutually independent, then rescales them so their energies add up to one unit
 * per sample.
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
 * Splits one white-noise source into three bands via the "difference of lowpass filters" technique: a low
 * band and a separately-cutoff low band are each lowpassed from the same noise, the low band is used as-is,
 * the high band is what a high lowpass removes from the raw noise, and the mid band is whatever falls between
 * the two lowpass outputs. Cheap (two one-pole filters, no FFT) and enough to give the synthesized tail
 * believable frequency-dependent decay.
 *
 * That the three tracks come from one shared source is what makes the energy bookkeeping work. Each band's
 * share of the total energy is its share of the spectrum, so a band covering a tenth of the audible range
 * carries a tenth of the energy — and a flat three-band energy spectrum renders as one flat broadband signal
 * rather than as three stacked copies of it. The bands' very different variances are that bandwidth, not an
 * accident to be corrected: normalizing each band to the same level would make a flat spectrum come out
 * roughly three times too loud, and mis-weight every other one.
 */
function splitWhiteNoiseIntoBands(sampleCount: number, sampleRate: number, randomSource: () => number): BandLimitedNoiseTracks {
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

  return { low, mid, high };
}

/**
 * One ear's noise: a blend of the realization shared with the other ear and one drawn only for this one,
 * weighted per band by how alike the two ears' signals should be (`interauralCoherence`). The weights are
 * `γ` and `√(1 - γ²)`, which reproduces exactly that correlation while leaving the level untouched.
 *
 * Reverberation is not equally decorrelated at every frequency. Below a few hundred hertz the wavelength
 * dwarfs the head and both ears receive nearly the same pressure, which is why bass in a real room sounds
 * solid and placed; by the top of the spectrum the two ears are effectively independent. Building both
 * channels from entirely separate noise — which is what this used to do — throws the low end's coherence away
 * and leaves the bottom of every room sounding phasey and hollow. A mono listener sits at the other extreme,
 * fully coherent at every frequency, so both channels come out identical.
 */
function buildEarNoiseTracks(
  sharedTracks: BandLimitedNoiseTracks,
  sampleCount: number,
  sampleRate: number,
  randomSource: () => number,
  coherence: FrequencyBandValues,
): BandLimitedNoiseTracks {
  const independentTracks = splitWhiteNoiseIntoBands(sampleCount, sampleRate, randomSource);

  for (const band of BAND_NAMES) {
    const sharedWeight = coherence[band];
    const independentWeight = Math.sqrt(Math.max(0, 1 - sharedWeight * sharedWeight));
    const shared = sharedTracks[band];
    const independent = independentTracks[band];
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
      independent[sampleIndex] = sharedWeight * shared[sampleIndex] + independentWeight * independent[sampleIndex];
    }
  }

  orthogonalizeBandTracks(independentTracks);
  return independentTracks;
}

/**
 * One ear's per-bin, per-band sample amplitude: the square root of the energy each sample in that bin should
 * carry at that ear.
 *
 * Dividing the bin's energy by how many samples it spans is the step that makes the tail's level physically
 * meaningful. A bin holds a total energy, and the noise it scales delivers one unit of energy per sample
 * across all three bands together, so spreading that total over `samplesPerBin` samples requires exactly
 * this. Writing `sqrt(binEnergy)` per sample instead — what this pipeline used to do — hands every bin
 * `samplesPerBin` times its own energy, which at 48kHz and 5ms bins is a factor of 240: the diffuse tail came
 * out roughly 19dB louder than the early reflections it is supposed to be a seamless continuation of.
 *
 * The head's shadowing is folded in here rather than applied afterwards so that it gets interpolated along
 * with everything else, and a tail whose direction drifts over time doesn't step from bin to bin.
 */
function computeEarAmplitudePerBin(
  histogram: EnergyHistogram,
  samplesPerBin: number,
  listener: RoomListener,
  channelIndex: number,
): BandLimitedNoiseTracks {
  const binCount = histogram.low.length;
  const ear = EARS[Math.min(channelIndex, EARS.length - 1)];
  const amplitudes = { low: new Float32Array(binCount), mid: new Float32Array(binCount), high: new Float32Array(binCount) };

  for (let binIndex = 0; binIndex < binCount; binIndex++) {
    const gains = computeDiffuseEarGains(histogram.lateralPosition[binIndex], ear, listener);
    for (const band of BAND_NAMES) {
      amplitudes[band][binIndex] = Math.sqrt((histogram[band][binIndex] * gains[band]) / samplesPerBin);
    }
  }

  return amplitudes;
}

/** Builds one channel's waveform by scaling band-limited noise with the per-bin amplitudes, linearly
    interpolated between neighboring bin centers. The interpolation matters: reading one bin's value flat
    across all of its samples (what this used to do) makes the decay envelope a staircase, stepping every
    5ms — an audible buzz riding on the tail that has nothing to do with the room. */
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
 * The two channels differ in two ways, both taken from the listener's head (`listenerHeadModel.ts`): how
 * alike their noise is, band by band, and how much of the tail's average direction each ear is shadowed from.
 */
export function synthesizeImpulseResponseFromHistogram(
  histogram: EnergyHistogram,
  sampleRate: number,
  listener: RoomListener,
  randomSource: () => number = Math.random,
): Float32Array<ArrayBuffer>[] {
  const totalDurationSeconds = histogram.low.length * histogram.binDurationSeconds;
  const sampleCount = Math.max(1, Math.round(totalDurationSeconds * sampleRate));
  const samplesPerBin = Math.max(1, Math.round(histogram.binDurationSeconds * sampleRate));

  const sharedTracks = splitWhiteNoiseIntoBands(sampleCount, sampleRate, randomSource);
  const coherence = interauralCoherence(listener);

  return EARS.map((_ear, channelIndex) => {
    const noiseTracks = buildEarNoiseTracks(sharedTracks, sampleCount, sampleRate, randomSource, coherence);
    const amplitudePerBin = computeEarAmplitudePerBin(histogram, samplesPerBin, listener, channelIndex);
    return buildChannelImpulseResponse(amplitudePerBin, sampleCount, samplesPerBin, noiseTracks);
  });
}
