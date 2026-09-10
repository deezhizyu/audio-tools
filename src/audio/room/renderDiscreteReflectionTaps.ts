import { buildBandImpulseKernel } from './bandSplitFilters';
import type { ImpulseArrival } from './traceRays';

/** Small per-tap randomization so the two output channels don't stay perfectly identical for the reflection
    taps either (matching the noise-tail decorrelation in `synthesizeImpulseResponseFromHistogram.ts`) —
    without pretending to know which ear a tap should actually favor, since `RoomScene`'s listener has no
    facing direction to compute a real interaural difference from. */
const TAP_DELAY_JITTER_SAMPLES = 1;
const TAP_GAIN_JITTER_FRACTION = 0.15;

function jitteredGain(randomSource: () => number): number {
  return 1 + (randomSource() * 2 - 1) * TAP_GAIN_JITTER_FRACTION;
}

function jitteredDelaySamples(randomSource: () => number): number {
  return Math.round((randomSource() * 2 - 1) * TAP_DELAY_JITTER_SAMPLES);
}

/**
 * Adds a scaled, band-colored, exact-delay impulse into each channel for every first-bounce arrival, in
 * place of the noise-based rendering `buildEnergyHistogram.ts`/`synthesizeImpulseResponseFromHistogram.ts`
 * use for everything else. A first bounce off a single (or few) surface(s) is, at most, `numberOfRays`
 * individually-timed samples of one reflecting patch as seen directly from the source — a tight, highly
 * time-correlated cluster, not the dense, statistically-independent pile of arrivals the noise
 * approximation is actually valid for (that only really happens from the second bounce onward, once paths
 * start multiplying across a scene's surfaces). Rendering a first bounce as noise breaks its natural
 * perceptual fusion with the direct sound — even a short, correctly-leveled burst of *incoherent* texture
 * reads as "added room hiss" where a real, coherent single echo this close in time would just mildly color
 * the direct sound's timbre. A scaled delta at the right delay, convolved with dry audio later
 * (`convolveWithImpulseResponse.ts`), reproduces exactly that: a genuine delayed copy of the source.
 *
 * Mutates `channels` in place, the same way the direct-sound spike in
 * `synthesizeImpulseResponseFromHistogram.ts` already does.
 */
export function renderDiscreteReflectionTaps(
  channels: Float32Array<ArrayBuffer>[],
  firstBounceArrivals: ImpulseArrival[],
  sampleRate: number,
  numberOfRays: number,
  randomSource: () => number = Math.random,
): void {
  const kernel = buildBandImpulseKernel(sampleRate);
  const normalizationFactor = 1 / Math.max(1, numberOfRays);

  for (const channel of channels) {
    for (const arrival of firstBounceArrivals) {
      const delaySampleIndex = Math.round(arrival.timeSeconds * sampleRate) + jitteredDelaySamples(randomSource);
      if (delaySampleIndex < 0 || delaySampleIndex >= channel.length) continue;

      const gain = jitteredGain(randomSource);
      const lowAmplitude = gain * Math.sqrt(arrival.energy.low * normalizationFactor);
      const midAmplitude = gain * Math.sqrt(arrival.energy.mid * normalizationFactor);
      const highAmplitude = gain * Math.sqrt(arrival.energy.high * normalizationFactor);

      const kernelLength = Math.min(kernel.low.length, channel.length - delaySampleIndex);
      for (let kernelIndex = 0; kernelIndex < kernelLength; kernelIndex++) {
        channel[delaySampleIndex + kernelIndex] +=
          lowAmplitude * kernel.low[kernelIndex] + midAmplitude * kernel.mid[kernelIndex] + highAmplitude * kernel.high[kernelIndex];
      }
    }
  }
}
