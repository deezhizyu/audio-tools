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
 *
 * Each of `numberOfRays` traced rays independently discovers (via next-event estimation) essentially the same
 * handful of early reflection paths — many rays bounce off the same nearby object and each fires its own shadow
 * ray to the listener — so summing their raw contributions would make the early region louder the more rays
 * are fired, rather than converging to a stable result. `buildEnergyHistogram.ts` avoids exactly this by
 * dividing by `numberOfRays` before turning energy into amplitude; this does the same, so the early, discrete
 * region and the late, statistical tail represent the same physical quantity (expected energy per ray) instead
 * of one being effectively `numberOfRays` times louder than intended.
 */
export function stampDiscreteReflectionImpulses(impulseResponse: Float32Array, arrivals: ImpulseArrival[], sampleRate: number, numberOfRays: number): void {
  const normalizationFactor = 1 / Math.max(1, numberOfRays);

  for (const arrival of arrivals) {
    const sampleIndex = Math.round(arrival.timeSeconds * sampleRate);
    if (sampleIndex < 0 || sampleIndex >= impulseResponse.length) continue;

    impulseResponse[sampleIndex] +=
      Math.sqrt(arrival.energy.low * normalizationFactor) +
      Math.sqrt(arrival.energy.mid * normalizationFactor) +
      Math.sqrt(arrival.energy.high * normalizationFactor);
  }
}
