import type { ImpulseArrival } from './traceRays';

/**
 * Adds each arrival into `impulseResponse` as a literal delta at its speed-of-sound delay — the same technique
 * `synthesizeImpulseResponseFromHistogram.ts` uses for the direct-sound path — rather than folding it into a
 * time-binned energy histogram and resynthesizing it as noise. This is what keeps early reflections audible as
 * sharp, individually-timed, individually-positioned echoes (the cues that make a room sound like a specific
 * size and shape) instead of being smeared into the statistical late-reverb tail from the very first bin, which
 * is appropriate only once reflections arrive densely enough that individual echoes are no longer perceptible.
 *
 * Each arrival's three per-band energies are summed into one broadband tap (amplitude is each band's square
 * root, matching the histogram synthesis's energy-to-amplitude conversion) rather than being individually
 * band-filtered: early reflections are dominated by low bounce orders that haven't yet diverged much in
 * spectral coloring, so a broadband tap is an acceptable simplification — the frequency-dependent shaping still
 * fully applies to the late tail.
 */
export function stampDiscreteReflectionImpulses(impulseResponse: Float32Array, arrivals: ImpulseArrival[], sampleRate: number): void {
  for (const arrival of arrivals) {
    const sampleIndex = Math.round(arrival.timeSeconds * sampleRate);
    if (sampleIndex < 0 || sampleIndex >= impulseResponse.length) continue;

    impulseResponse[sampleIndex] += Math.sqrt(arrival.energy.low) + Math.sqrt(arrival.energy.mid) + Math.sqrt(arrival.energy.high);
  }
}
