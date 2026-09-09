import { buildEnergyHistogram } from './buildEnergyHistogram';
import { computeDirectSoundPath } from './directSound';
import { HISTOGRAM_BIN_DURATION_SECONDS, MAXIMUM_IMPULSE_RESPONSE_DURATION_SECONDS } from './roomAcousticsDefaults';
import type { RoomScene } from './roomTypes';
import { synthesizeImpulseResponseFromHistogram } from './synthesizeImpulseResponseFromHistogram';
import { traceRays, type RayTracingParams } from './traceRays';

/**
 * Ties the room-acoustics pipeline together: traces reflections, then feeds every arrival (early and late
 * alike) into one time-binned, noise-based reconstruction (`buildEnergyHistogram.ts` +
 * `synthesizeImpulseResponseFromHistogram.ts`) — matching how Steam Audio's own reflections engine turns
 * traced energy into audio (band-limited noise modulated per fixed-width time bin, uniformly across the whole
 * impulse response, never a literal single-sample delta). A sparse, isolated reflection still reads as a
 * short, distinct transient this way; a dense cluster of contributions from a rough/diffuse surface correctly
 * blends into smooth texture instead of piling up as coincident raw clicks. The direct, unreflected path is
 * always a true single impulse (it's a single deterministic straight line, not a Monte Carlo sample), handled
 * separately by `directSound.ts`.
 */
export function synthesizeRoomImpulseResponse(scene: RoomScene, sampleRate: number, rayTracingParams: RayTracingParams): Float32Array<ArrayBuffer> {
  const arrivals = traceRays(scene, rayTracingParams);

  const histogram = buildEnergyHistogram(
    arrivals,
    rayTracingParams.numberOfRays,
    HISTOGRAM_BIN_DURATION_SECONDS,
    MAXIMUM_IMPULSE_RESPONSE_DURATION_SECONDS,
  );
  const directSound = computeDirectSoundPath(scene);
  return synthesizeImpulseResponseFromHistogram(
    histogram,
    sampleRate,
    directSound,
    rayTracingParams.speedOfSoundMetersPerSecond,
    rayTracingParams.randomSource,
  );
}
