import { buildEnergyHistogram } from './buildEnergyHistogram';
import { computeDirectSoundPath } from './directSound';
import { renderDiscreteReflectionTaps } from './renderDiscreteReflectionTaps';
import { HISTOGRAM_BIN_DURATION_SECONDS, MAXIMUM_IMPULSE_RESPONSE_DURATION_SECONDS } from './roomAcousticsDefaults';
import type { RoomScene } from './roomTypes';
import { synthesizeImpulseResponseFromHistogram } from './synthesizeImpulseResponseFromHistogram';
import { traceRays, type RayTracingParams } from './traceRays';

/**
 * Ties the room-acoustics pipeline together: traces reflections, then splits them by bounce order before
 * turning them into audio. First-bounce arrivals — at most `numberOfRays` samples of a single reflecting
 * surface as seen directly from the source, and so a tight, highly time-correlated cluster rather than a
 * statistically independent pile — are rendered as discrete, band-colored, exact-delay impulses
 * (`renderDiscreteReflectionTaps.ts`), the same technique the direct-sound spike already uses; convolving
 * a delta at delay τ with dry audio later reproduces a genuine coherent copy of the source at that delay,
 * which is what a real, sparse first bounce actually is. Second-and-later-order arrivals, where paths
 * multiply across a scene's surfaces into a genuinely dense, diffuse field, keep using the existing
 * time-binned, noise-based reconstruction (`buildEnergyHistogram.ts` + `synthesizeImpulseResponseFromHistogram.ts`)
 * — matching how Steam Audio's own reflections engine turns traced energy into audio there. The direct,
 * unreflected path is always a true single impulse (it's a single deterministic straight line, not a Monte
 * Carlo sample), handled separately by `directSound.ts`.
 *
 * `stereoSimulationEnabled` controls whether the direct sound, discrete first-bounce taps, and diffuse tail
 * are panned left/right by direction (Steam Audio's constant-power stereo pan law — see `stereoPanning.ts`)
 * or left centered on both channels, as they were before this option existed.
 */
export function synthesizeRoomImpulseResponse(
  scene: RoomScene,
  sampleRate: number,
  rayTracingParams: RayTracingParams,
  stereoSimulationEnabled: boolean,
): Float32Array<ArrayBuffer>[] {
  const arrivals = traceRays(scene, rayTracingParams);
  const firstBounceArrivals = arrivals.filter(arrival => arrival.bounceOrder === 0);
  const laterBounceArrivals = arrivals.filter(arrival => arrival.bounceOrder > 0);

  const histogram = buildEnergyHistogram(
    laterBounceArrivals,
    rayTracingParams.numberOfRays,
    HISTOGRAM_BIN_DURATION_SECONDS,
    MAXIMUM_IMPULSE_RESPONSE_DURATION_SECONDS,
  );
  const directSound = computeDirectSoundPath(scene);
  const channels = synthesizeImpulseResponseFromHistogram(
    histogram,
    sampleRate,
    directSound,
    rayTracingParams.speedOfSoundMetersPerSecond,
    stereoSimulationEnabled,
    rayTracingParams.randomSource,
  );

  renderDiscreteReflectionTaps(
    channels,
    firstBounceArrivals,
    sampleRate,
    rayTracingParams.numberOfRays,
    stereoSimulationEnabled,
    rayTracingParams.randomSource,
  );

  return channels;
}
