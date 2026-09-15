import type { BandKernel } from './bandSplitFilters';
import type { FrequencyBandValues } from './roomTypes';

/** Taps either side of the arrival that the windowed sinc spreads it over. Eight holds the interpolator's
    response within 1% all the way to 18kHz at 48kHz — flat across everything anyone can hear, rolling off
    only as it approaches Nyquist, where a band-limited reconstruction has nothing to say anyway. Halving it
    to four pulls that roll-off down to around 10kHz, which is audible on transients. Only a few dozen
    arrivals are rendered per simulation, so the extra taps cost nothing worth counting. */
const FRACTIONAL_DELAY_HALF_WIDTH_SAMPLES = 8;
const FRACTIONAL_DELAY_TAP_COUNT = FRACTIONAL_DELAY_HALF_WIDTH_SAMPLES * 2;

/** How finely the sub-sample position is quantized. At 48kHz, 64 steps puts an arrival within 0.16
    microseconds of its true time — about a twentieth of a millimeter of path length, far below anything that
    could matter. */
const FRACTIONAL_DELAY_PHASE_COUNT = 64;

function sinc(x: number): number {
  if (Math.abs(x) < 1e-9) return 1;
  const scaled = Math.PI * x;
  return Math.sin(scaled) / scaled;
}

/**
 * The interpolation kernels that place an arrival between two samples, one per sub-sample position.
 *
 * A windowed sinc, not linear interpolation between the two neighboring samples. Linear interpolation is a
 * lowpass filter whose strength depends on where the delay happens to fall: an arrival landing exactly on a
 * sample keeps all of its energy, one landing halfway between two loses half of it. That turns a smooth walk
 * across a room into a level that wobbles by up to 3dB for no reason, and quietly costs the direct sound
 * about 3dB on average — enough to throw off the direct-to-reverberant balance the whole simulation is
 * calibrated around. A sinc reconstructs the band-limited impulse that genuinely sits at that fractional
 * position instead, holding its amplitude and energy steady wherever it falls.
 *
 * Built once and shared: the kernels depend only on the sub-sample position, not on the sample rate or on
 * anything about the scene.
 */
function buildFractionalDelayKernels(): Float32Array[] {
  return Array.from({ length: FRACTIONAL_DELAY_PHASE_COUNT }, (_unused, phaseIndex) => {
    const fraction = phaseIndex / FRACTIONAL_DELAY_PHASE_COUNT;
    const kernel = new Float32Array(FRACTIONAL_DELAY_TAP_COUNT);

    let sum = 0;
    for (let tapIndex = 0; tapIndex < FRACTIONAL_DELAY_TAP_COUNT; tapIndex++) {
      const offsetFromArrival = tapIndex - (FRACTIONAL_DELAY_HALF_WIDTH_SAMPLES - 1) - fraction;
      // A Hann window tapers the truncated sinc's ends to zero, so it stops abruptly enough to ring. Gentler
      // than a Blackman of the same length, which buys lower sidelobes at the price of narrowing the flat
      // part of the response — the opposite of the trade wanted here.
      const windowPosition = tapIndex / (FRACTIONAL_DELAY_TAP_COUNT - 1);
      const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * windowPosition);
      kernel[tapIndex] = sinc(offsetFromArrival) * window;
      sum += kernel[tapIndex];
    }

    // Unity gain at DC, so an arrival's amplitude is exactly what its energy says regardless of where between
    // two samples it lands.
    if (sum !== 0) {
      for (let tapIndex = 0; tapIndex < FRACTIONAL_DELAY_TAP_COUNT; tapIndex++) kernel[tapIndex] /= sum;
    }
    return kernel;
  });
}

const FRACTIONAL_DELAY_KERNELS = buildFractionalDelayKernels();

/**
 * Adds one discrete arrival — the direct sound, or a single specular echo — into a channel at its exact
 * fractional delay, colored by its per-band amplitudes.
 *
 * Two things matter here. The arrival is placed at its true sub-sample position via `FRACTIONAL_DELAY_KERNELS`,
 * so a path length that isn't a whole number of samples lands where it actually is; rounding every arrival to
 * the nearest sample (what this pipeline used to do) quantizes path lengths to ~7mm at 48kHz and gives
 * closely-spaced early reflections an audible comb-filtered coloration that has nothing to do with the room.
 * And the arrival is shaped by `kernel` rather than written as a bare spike, so a discrete arrival carries the
 * same low/mid/high spectral split as the noise-based tail it sits alongside — see `buildBandImpulseKernel`.
 * When all three band amplitudes are equal the kernel sums back to a perfect unit impulse, so an unfiltered
 * arrival stays unfiltered.
 */
export function addBandLimitedImpulse(
  channel: Float32Array,
  delaySeconds: number,
  sampleRate: number,
  kernel: BandKernel,
  amplitudes: FrequencyBandValues,
): void {
  const delaySamples = delaySeconds * sampleRate;
  if (!Number.isFinite(delaySamples) || delaySamples < 0) return;

  const baseIndex = Math.floor(delaySamples);
  if (baseIndex >= channel.length) return;

  const phaseIndex = Math.min(FRACTIONAL_DELAY_PHASE_COUNT - 1, Math.floor((delaySamples - baseIndex) * FRACTIONAL_DELAY_PHASE_COUNT));
  const fractionalDelayKernel = FRACTIONAL_DELAY_KERNELS[phaseIndex];
  const firstTapOffset = -(FRACTIONAL_DELAY_HALF_WIDTH_SAMPLES - 1);

  for (let bandKernelIndex = 0; bandKernelIndex < kernel.low.length; bandKernelIndex++) {
    if (baseIndex + bandKernelIndex + firstTapOffset >= channel.length) break;

    const value =
      amplitudes.low * kernel.low[bandKernelIndex] +
      amplitudes.mid * kernel.mid[bandKernelIndex] +
      amplitudes.high * kernel.high[bandKernelIndex];
    if (value === 0) continue;

    for (let tapIndex = 0; tapIndex < FRACTIONAL_DELAY_TAP_COUNT; tapIndex++) {
      const sampleIndex = baseIndex + bandKernelIndex + firstTapOffset + tapIndex;
      if (sampleIndex < 0) continue;
      if (sampleIndex >= channel.length) break;
      channel[sampleIndex] += value * fractionalDelayKernel[tapIndex];
    }
  }
}
