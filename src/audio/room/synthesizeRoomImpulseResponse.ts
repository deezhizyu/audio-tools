import { buildEnergyHistogram } from './buildEnergyHistogram';
import { computeDirectSoundPath } from './directSound';
import { EARLY_REFLECTION_TRANSITION_TIME_SECONDS, HISTOGRAM_BIN_DURATION_SECONDS, MAXIMUM_IMPULSE_RESPONSE_DURATION_SECONDS } from './roomAcousticsDefaults';
import type { RoomScene } from './roomTypes';
import { stampDiscreteReflectionImpulses } from './stampDiscreteReflectionImpulses';
import { synthesizeImpulseResponseFromHistogram } from './synthesizeImpulseResponseFromHistogram';
import { traceRays, type RayTracingParams } from './traceRays';

/**
 * Ties the room-acoustics pipeline together: traces reflections, then splits them at
 * `EARLY_REFLECTION_TRANSITION_TIME_SECONDS` — arrivals before it are kept as individually-timed discrete
 * impulses (see `stampDiscreteReflectionImpulses.ts`) so they stay audible as distinct echoes, and only
 * arrivals after it feed the time-binned, noise-based late-reverb tail (`synthesizeImpulseResponseFromHistogram.ts`).
 * The direct, unreflected path is always a discrete impulse regardless of the transition time, handled
 * separately by `directSound.ts`.
 */
export function synthesizeRoomImpulseResponse(scene: RoomScene, sampleRate: number, rayTracingParams: RayTracingParams): Float32Array<ArrayBuffer> {
  const arrivals = traceRays(scene, rayTracingParams);
  const earlyArrivals = arrivals.filter(arrival => arrival.timeSeconds < EARLY_REFLECTION_TRANSITION_TIME_SECONDS);
  const lateArrivals = arrivals.filter(arrival => arrival.timeSeconds >= EARLY_REFLECTION_TRANSITION_TIME_SECONDS);

  const histogram = buildEnergyHistogram(
    lateArrivals,
    rayTracingParams.numberOfRays,
    HISTOGRAM_BIN_DURATION_SECONDS,
    MAXIMUM_IMPULSE_RESPONSE_DURATION_SECONDS,
  );
  const directSound = computeDirectSoundPath(scene);
  const impulseResponse = synthesizeImpulseResponseFromHistogram(
    histogram,
    sampleRate,
    directSound,
    rayTracingParams.speedOfSoundMetersPerSecond,
    rayTracingParams.randomSource,
  );

  stampDiscreteReflectionImpulses(impulseResponse, earlyArrivals, sampleRate);

  return impulseResponse;
}
