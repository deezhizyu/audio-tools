import { buildEnergyHistogram, truncateEnergyHistogram, type EnergyHistogram } from './buildEnergyHistogram';
import { computeDirectSoundArrival } from './directSound';
import type { DiscreteArrival } from './discreteArrival';
import { estimateReverberationTimeSeconds } from './estimateReverbTime';
import { computeImageSourceArrivals } from './imageSources';
import { renderDiscreteArrivals } from './renderDiscreteArrivals';
import {
  HISTOGRAM_BIN_DURATION_SECONDS,
  IMPULSE_RESPONSE_DURATION_HEADROOM,
  MAXIMUM_IMAGE_SOURCE_ORDER,
  MAXIMUM_IMPULSE_RESPONSE_DURATION_SECONDS,
  MINIMUM_IMPULSE_RESPONSE_DURATION_SECONDS,
} from './roomAcousticsDefaults';
import type { RoomScene } from './roomTypes';
import { synthesizeImpulseResponseFromHistogram } from './synthesizeImpulseResponseFromHistogram';
import { traceRays, type RayTracingParams } from './traceRays';

function latestArrivalTimeSeconds(arrivals: DiscreteArrival[]): number {
  let latest = 0;
  for (const arrival of arrivals) {
    if (arrival.timeSeconds > latest) latest = arrival.timeSeconds;
  }
  return latest;
}

/**
 * How long the rendered impulse response should be for this particular room, rather than a fixed length for
 * every room. A hall with a three-second tail and an open field with none are not remotely the same rendering
 * problem: one fixed duration either truncates the hall partway down its decay (an abrupt cut where there
 * should be a fade) or spends most of its samples convolving the field's silence.
 *
 * The reverberation time governs it, with a floor that still guarantees room for the direct sound and the
 * early reflections — an open field has no measurable decay at all, but its ground bounce still has to fit.
 */
export function chooseImpulseResponseDurationSeconds(
  histogram: EnergyHistogram,
  minimumRequiredSeconds: number,
  maximumSeconds: number = MAXIMUM_IMPULSE_RESPONSE_DURATION_SECONDS,
): number {
  const totalEnergyPerBin = histogram.low.map((lowEnergy, binIndex) => lowEnergy + histogram.mid[binIndex] + histogram.high[binIndex]);
  const reverberationTimeSeconds = estimateReverberationTimeSeconds(totalEnergyPerBin, histogram.binDurationSeconds);
  const decaySeconds = reverberationTimeSeconds === null ? 0 : reverberationTimeSeconds * IMPULSE_RESPONSE_DURATION_HEADROOM;

  return Math.min(maximumSeconds, Math.max(MINIMUM_IMPULSE_RESPONSE_DURATION_SECONDS, decaySeconds, minimumRequiredSeconds));
}

/**
 * Ties the room-acoustics pipeline together. A room's impulse response is two physically different things
 * added together, and the whole design of this module is about not confusing them:
 *
 * - **Coherent arrivals** — the straight-line direct sound (`directSound.ts`) and the specular echoes off one
 *   or two surfaces (`imageSources.ts`). Each is a single, exactly-locatable path, so each is rendered as one
 *   scaled impulse at its true fractional delay (`renderDiscreteArrivals.ts`); convolved with dry audio, that
 *   reproduces a genuine delayed copy of the source, which is what those paths physically are. Both are
 *   computed in closed form rather than sampled, because they are precisely the paths a stochastic ray tracer
 *   finds worst and because their timing and direction are what the ear reads as the size and shape of the
 *   room.
 * - **The diffuse tail** — everything after that, where paths multiply across the scene's surfaces into a
 *   dense field no individual reflection of which is audible on its own. Those are traced stochastically,
 *   summed as energy into a time/frequency histogram (`buildEnergyHistogram.ts`), and rendered as shaped noise
 *   (`synthesizeImpulseResponseFromHistogram.ts`).
 *
 * Tracing deliberately fills a histogram far longer than most rooms need, so the room's own reverberation
 * time — not a constant — can then decide how much of it is worth rendering (see
 * `chooseImpulseResponseDurationSeconds`).
 *
 * How any of it reaches two ears is the listener's own business (`listenerHeadModel.ts`): arrival times and
 * shadowing for the coherent paths, shadowing and frequency-dependent coherence for the tail.
 */
export function synthesizeRoomImpulseResponse(
  scene: RoomScene,
  sampleRate: number,
  rayTracingParams: RayTracingParams,
): Float32Array<ArrayBuffer>[] {
  const arrivals = traceRays(scene, rayTracingParams);
  const coherentArrivals = [
    computeDirectSoundArrival(scene, rayTracingParams.speedOfSoundMetersPerSecond),
    ...computeImageSourceArrivals(
      scene,
      MAXIMUM_IMAGE_SOURCE_ORDER,
      rayTracingParams.speedOfSoundMetersPerSecond,
      rayTracingParams.maximumDistanceMeters,
    ),
  ];

  // A path longer than the ray budget was never traced, so it caps how much decay this pass can know about —
  // and with it how much is worth rendering. The live preview lowers that budget deliberately.
  const tracedDurationSeconds = rayTracingParams.maximumDistanceMeters / rayTracingParams.speedOfSoundMetersPerSecond;
  const tracedHistogram = buildEnergyHistogram(arrivals, HISTOGRAM_BIN_DURATION_SECONDS, tracedDurationSeconds);
  const histogram = truncateEnergyHistogram(
    tracedHistogram,
    chooseImpulseResponseDurationSeconds(tracedHistogram, latestArrivalTimeSeconds(coherentArrivals), tracedDurationSeconds),
  );

  const channels = synthesizeImpulseResponseFromHistogram(histogram, sampleRate, scene.listener, rayTracingParams.randomSource);
  renderDiscreteArrivals(channels, coherentArrivals, sampleRate, scene.listener);

  return channels;
}
