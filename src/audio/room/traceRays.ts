import { AIR_ABSORPTION_COEFFICIENTS_PER_METER, airAbsorptionGain } from './airAbsorption';
import { lateralPositionInFrame, listenerHorizontalFrame, type ListenerHorizontalFrame } from './listenerHeadModel';
import {
  BOUNDS_STRIDE,
  createRayBoxHit,
  intersectRayWithPackedBounds,
  isBlockedByPackedBounds,
  type RayBoxHit,
} from './rayBoxIntersection';
import { getEffectiveScatterAmount } from './roomMaterials';
import { packBoxBounds } from './roomBoxGeometry';
import {
  energyPerRay,
  INTERACTIVE_MAXIMUM_BOUNCES,
  INTERACTIVE_MAXIMUM_RAY_DISTANCE_METERS,
  INTERACTIVE_NUMBER_OF_RAYS,
  MAXIMUM_BOUNCES,
  MAXIMUM_IMAGE_SOURCE_ORDER,
  MAXIMUM_RAY_DISTANCE_METERS,
  MINIMUM_CONTRIBUTION_DISTANCE_METERS,
  MINIMUM_ENERGY_THRESHOLD,
  NUMBER_OF_RAYS,
  RUSSIAN_ROULETTE_THRESHOLD,
  SPEED_OF_SOUND_METERS_PER_SECOND,
} from './roomAcousticsDefaults';
import type { FrequencyBandValues, RoomScene } from './roomTypes';
import { directivityGain } from './sourceDirectivity';
import { randomCosineWeightedHemisphereVector, randomUnitVector } from './vector3';

export interface RayTracingParams {
  numberOfRays: number;
  maximumBounces: number;
  speedOfSoundMetersPerSecond: number;
  minimumContributionDistanceMeters: number;
  minimumEnergyThreshold: number;
  /** How far a ray may travel before it is abandoned. Doubles as the cap on how long an impulse response
      this pass will render (see `chooseImpulseResponseDurationSeconds`), since a path longer than this was
      never traced and so has nothing to contribute past it. */
  maximumDistanceMeters: number;
  /** Injectable so ray directions/scatter are deterministic in tests; defaults to `Math.random`. */
  randomSource: () => number;
}

export const DEFAULT_RAY_TRACING_PARAMS: RayTracingParams = {
  numberOfRays: NUMBER_OF_RAYS,
  maximumBounces: MAXIMUM_BOUNCES,
  speedOfSoundMetersPerSecond: SPEED_OF_SOUND_METERS_PER_SECOND,
  minimumContributionDistanceMeters: MINIMUM_CONTRIBUTION_DISTANCE_METERS,
  minimumEnergyThreshold: MINIMUM_ENERGY_THRESHOLD,
  maximumDistanceMeters: MAXIMUM_RAY_DISTANCE_METERS,
  randomSource: Math.random,
};

/** The same physical parameters as `DEFAULT_RAY_TRACING_PARAMS`, but with a much smaller ray/bounce budget —
    used for the live preview pass that runs while the room is actively being edited (see
    `INTERACTIVE_NUMBER_OF_RAYS`'s comment for why). */
export const INTERACTIVE_RAY_TRACING_PARAMS: RayTracingParams = {
  ...DEFAULT_RAY_TRACING_PARAMS,
  numberOfRays: INTERACTIVE_NUMBER_OF_RAYS,
  maximumBounces: INTERACTIVE_MAXIMUM_BOUNCES,
  maximumDistanceMeters: INTERACTIVE_MAXIMUM_RAY_DISTANCE_METERS,
};

export interface ImpulseArrival {
  timeSeconds: number;
  /** Absolute energy delivered to the listener — already carrying this ray's share of the source's total
      power (see `energyPerRay`), so it is directly comparable to the direct path's own `1/distance²` and no
      consumer needs to normalize by ray count. */
  energy: FrequencyBandValues;
  /** Where this arrival sits on the listener's own left/right axis (-1 fully left, +1 fully right, 0 straight
      ahead or behind) — see `lateralPositionInFrame` in `listenerHeadModel.ts`. Measured in the listener's
      frame rather than the room's, so turning the listener really does turn the room around them. */
  lateralPosition: number;
}

/** A small offset nudging a point off the surface it sits on, so the next intersection test doesn't
    immediately re-hit the same face due to floating-point rounding. */
const SURFACE_OFFSET_METERS = 1e-4;

/** Below this, a straight line from a hit point to the listener is considered coincident with the hit point
    itself (no meaningful direction to test for occlusion). */
const COINCIDENT_POINT_EPSILON_METERS = 1e-9;

/** Maps a surface's roughness onto how tightly its specular highlight is focused. The standard roughness-to
    -exponent mapping: a near-mirror surface gets a needle-thin lobe, a rough one a broad, soft highlight.
    A single fixed exponent for every material (this used to be a flat 100, Steam Audio's own constant)
    describes a mirror no matter what the material is, so a rough surface's reflections came back as tight
    glints instead of the wide smear a rough surface actually produces. The cap keeps the lobe from becoming
    so narrow that a shadow ray essentially never lands inside it. */
const MAXIMUM_SPECULAR_LOBE_EXPONENT = 2048;

function specularLobeExponent(scatterAmount: number): number {
  const roughness = Math.max(scatterAmount, 1e-3);
  return Math.min(MAXIMUM_SPECULAR_LOBE_EXPONENT, Math.max(0, 2 / (roughness * roughness) - 2));
}

/**
 * Everything a trace needs that doesn't change from ray to ray, resolved once.
 *
 * Several of these are here specifically because they are expensive to recompute: the listener's frame costs
 * two trigonometric calls, the packed bounds are the whole geometry flattened, and each box's effective
 * scattering is a map lookup and a multiply. All three sit inside a loop that runs millions of times, and
 * none of them can change while it does.
 */
interface TraceContext {
  params: RayTracingParams;
  boxBounds: Float64Array;
  /** Per box, parallel to `boxBounds`: its scattering, and whether a ray that reaches it simply stops. */
  scatterAmounts: Float64Array;
  absorbsCompletely: Uint8Array;
  absorptionLow: Float64Array;
  absorptionMid: Float64Array;
  absorptionHigh: Float64Array;
  listenerX: number;
  listenerY: number;
  listenerZ: number;
  listenerFrame: ListenerHorizontalFrame;
  energyPerRayValue: number;
  /** Reused across the whole trace so no intersection test ever allocates. */
  shadowHit: RayBoxHit;
  arrivals: ImpulseArrival[];
}

function buildTraceContext(scene: RoomScene, params: RayTracingParams): TraceContext {
  const boxCount = scene.boxes.length;
  const context: TraceContext = {
    params,
    boxBounds: packBoxBounds(scene.boxes),
    scatterAmounts: new Float64Array(boxCount),
    absorbsCompletely: new Uint8Array(boxCount),
    absorptionLow: new Float64Array(boxCount),
    absorptionMid: new Float64Array(boxCount),
    absorptionHigh: new Float64Array(boxCount),
    listenerX: scene.listener.x,
    listenerY: scene.listener.y,
    listenerZ: scene.listener.z,
    listenerFrame: listenerHorizontalFrame(scene.listener),
    energyPerRayValue: energyPerRay(params.numberOfRays),
    shadowHit: createRayBoxHit(),
    arrivals: [],
  };

  scene.boxes.forEach((box, boxIndex) => {
    context.scatterAmounts[boxIndex] = getEffectiveScatterAmount(box);
    context.absorbsCompletely[boxIndex] = box.kind === 'absorber' ? 1 : 0;
    context.absorptionLow[boxIndex] = box.absorption.low;
    context.absorptionMid[boxIndex] = box.absorption.mid;
    context.absorptionHigh[boxIndex] = box.absorption.high;
  });

  return context;
}

/**
 * Next-event estimation: rather than waiting for a stochastic ray to wander within some capture radius of
 * the listener (which starves nearby listeners of samples and, worse, lets a ray's very first, pre-bounce
 * segment "capture" spurious energy when the listener happens to sit close to the source), every bounce
 * fires one deterministic shadow ray straight at the listener. If it's unobstructed, the bounce contributes
 * energy through the surface's reflection distribution: a Lambertian diffuse lobe (`scatterAmount/π`,
 * weighted by the cosine of how directly the surface faces the listener) plus a specular lobe peaked on the
 * true mirror-reflection direction and weighted by `1 - scatterAmount`. Each lobe integrates to one over the
 * outgoing hemisphere and the two weights sum to one, so raising a surface's roughness *redistributes* its
 * reflected energy from a narrow highlight into a wide spread rather than inflating or losing the total.
 * Firing deterministic shadow rays instead of hoping a ray wanders close enough is what real-time
 * geometric-acoustics engines (e.g. Steam Audio) use to avoid the "rays miss the listener" failure mode.
 *
 * The specular lobe is built around the mirror-reflection direction rather than the half-vector between the
 * incoming ray and the shadow ray. The half-vector form — a graphics convention, and what this used to use —
 * is not energy conserving here: its integral over the outgoing hemisphere comes out as the cosine of the
 * angle of incidence, so it silently discards energy as reflections get more oblique, losing half of it at
 * 60° and five sixths at 80°. Since most wall reflections in a room *are* oblique, that quietly drained the
 * reverberant field of a large part of its energy, leaving rooms far drier than their geometry implies.
 *
 * `throughput*` is the fraction of this ray's original energy still carried after every absorption so far;
 * `context.energyPerRayValue` converts that fraction into absolute energy. Keeping the two separate is what
 * lets Russian roulette below reason about throughput in ray-count-independent terms.
 *
 * `includeSpecularLobe` is false for the low-order all-specular paths that `imageSources.ts` computes
 * exactly, so the same echo is never delivered twice.
 *
 * Takes its geometry as loose numbers rather than vectors and points because it runs once per bounce of
 * every ray: at that rate the objects a tidier signature would allocate cost more than the arithmetic does.
 */
function recordReflectionArrival(
  context: TraceContext,
  hitX: number,
  hitY: number,
  hitZ: number,
  normalAxis: 0 | 1 | 2,
  normalSign: number,
  incomingX: number,
  incomingY: number,
  incomingZ: number,
  hitScatterAmount: number,
  includeSpecularLobe: boolean,
  distanceTraveledToHit: number,
  throughputLow: number,
  throughputMid: number,
  throughputHigh: number,
): void {
  const normalX = normalAxis === 0 ? normalSign : 0;
  const normalY = normalAxis === 1 ? normalSign : 0;
  const normalZ = normalAxis === 2 ? normalSign : 0;

  const originX = hitX + normalX * SURFACE_OFFSET_METERS;
  const originY = hitY + normalY * SURFACE_OFFSET_METERS;
  const originZ = hitZ + normalZ * SURFACE_OFFSET_METERS;

  const toListenerX = context.listenerX - originX;
  const toListenerY = context.listenerY - originY;
  const toListenerZ = context.listenerZ - originZ;
  const distanceToListener = Math.sqrt(toListenerX * toListenerX + toListenerY * toListenerY + toListenerZ * toListenerZ);
  if (distanceToListener < COINCIDENT_POINT_EPSILON_METERS) return;

  const inverseDistance = 1 / distanceToListener;
  const directionX = toListenerX * inverseDistance;
  const directionY = toListenerY * inverseDistance;
  const directionZ = toListenerZ * inverseDistance;

  // Only the normal's own axis contributes, since it is an axis-aligned unit vector.
  const cosineWeight = (normalAxis === 0 ? directionX : normalAxis === 1 ? directionY : directionZ) * normalSign;
  if (cosineWeight <= 0) return;

  const diffuseLobeWeight = (hitScatterAmount / Math.PI) * cosineWeight;

  let specularLobeWeight = 0;
  if (includeSpecularLobe && hitScatterAmount < 1) {
    const incomingAlongNormal = (normalAxis === 0 ? incomingX : normalAxis === 1 ? incomingY : incomingZ) * normalSign;
    const mirrorX = incomingX - 2 * incomingAlongNormal * normalX;
    const mirrorY = incomingY - 2 * incomingAlongNormal * normalY;
    const mirrorZ = incomingZ - 2 * incomingAlongNormal * normalZ;

    const specularAlignment = Math.max(0, mirrorX * directionX + mirrorY * directionY + mirrorZ * directionZ);
    const exponent = specularLobeExponent(hitScatterAmount);
    specularLobeWeight = ((exponent + 1) / (2 * Math.PI)) * (1 - hitScatterAmount) * Math.pow(specularAlignment, exponent);
  }

  const clampedDistance = Math.max(distanceToListener, context.params.minimumContributionDistanceMeters);
  const attenuation = (context.energyPerRayValue * (diffuseLobeWeight + specularLobeWeight)) / (clampedDistance * clampedDistance);

  // Cheap tests first: the shadow ray costs a pass over every box in the scene, so it is only worth firing
  // once this contribution is known to be big enough to matter at all.
  const strongestThroughput = Math.max(throughputLow, throughputMid, throughputHigh);
  if (strongestThroughput * attenuation < context.params.minimumEnergyThreshold) return;
  if (
    isBlockedByPackedBounds(
      originX,
      originY,
      originZ,
      directionX,
      directionY,
      directionZ,
      distanceToListener - COINCIDENT_POINT_EPSILON_METERS,
      context.boxBounds,
      context.shadowHit,
    )
  ) {
    return;
  }

  const totalDistance = distanceTraveledToHit + distanceToListener;

  context.arrivals.push({
    timeSeconds: totalDistance / context.params.speedOfSoundMetersPerSecond,
    energy: {
      low: throughputLow * attenuation * airAbsorptionGain(AIR_ABSORPTION_COEFFICIENTS_PER_METER.low, totalDistance),
      mid: throughputMid * attenuation * airAbsorptionGain(AIR_ABSORPTION_COEFFICIENTS_PER_METER.mid, totalDistance),
      high: throughputHigh * attenuation * airAbsorptionGain(AIR_ABSORPTION_COEFFICIENTS_PER_METER.high, totalDistance),
    },
    // The arrival reaches the listener from `origin`, i.e. along the reverse of the direction just computed.
    lateralPosition: lateralPositionInFrame(context.listenerFrame, -directionX, -directionZ),
  });
}

/** Fires `params.numberOfRays` rays from the scene's source in random directions and bounces them off `object`
    boxes, losing energy per the hit face's absorption and scattering by a per-material amount (see
    `getEffectiveScatterAmount`) so rougher surfaces spread sound more diffusely than smooth ones. A ray
    terminates outright on hitting an `absorber` box. Every reflection point contributes a time-stamped,
    distance- and angle-attenuated energy arrival via next-event estimation (see `recordReflectionArrival`) —
    the raw material `buildEnergyHistogram.ts` turns into a decay curve and
    `synthesizeImpulseResponseFromHistogram.ts` into the reverb tail.

    Each ray leaves carrying its share of the source's power shaped by the source's own directivity, so an
    aimed source genuinely floods one part of the room and starves another rather than lighting it evenly.

    Two paths are deliberately not sampled here, because both are computed exactly elsewhere and would only
    be approximated worse by random sampling: the direct, unreflected path (`directSound.ts`), and the
    low-order all-specular echoes (`imageSources.ts`) that `includeSpecularLobe` excludes. */
export function traceRays(scene: RoomScene, params: RayTracingParams): ImpulseArrival[] {
  const context = buildTraceContext(scene, params);
  const boxCount = scene.boxes.length;
  const nearestHit = createRayBoxHit();

  for (let rayIndex = 0; rayIndex < params.numberOfRays; rayIndex++) {
    let positionX = scene.source.x;
    let positionY = scene.source.y;
    let positionZ = scene.source.z;

    const initialDirection = randomUnitVector(params.randomSource);
    let directionX = initialDirection.x;
    let directionY = initialDirection.y;
    let directionZ = initialDirection.z;

    // The fraction of this ray's starting energy still in flight, per band. It starts at the source's
    // directivity in the direction this ray happens to leave along rather than at 1, so a narrowly-aimed
    // source's off-axis rays start out faint and are dropped here without ever being traced.
    const emittedFraction = directivityGain(scene.source, initialDirection);
    if (emittedFraction < params.minimumEnergyThreshold) continue;
    // Tracked as a fraction rather than as absolute energy so Russian roulette's threshold below means the
    // same thing regardless of how many rays the simulation happens to be firing.
    let throughputLow = emittedFraction;
    let throughputMid = emittedFraction;
    let throughputHigh = emittedFraction;

    let distanceTraveled = 0;
    // Only a ray that has mirror-reflected at every bounce so far is travelling a path the image-source pass
    // also computes; once it scatters, it is carrying diffuse energy that pass knows nothing about, and its
    // specular lobe has to be counted here again.
    let hasOnlySpecularBounces = true;

    for (let bounce = 0; bounce < params.maximumBounces; bounce++) {
      let nearestDistance = params.maximumDistanceMeters - distanceTraveled;
      let nearestBoxIndex = -1;
      let nearestNormalAxis: 0 | 1 | 2 = 0;
      let nearestNormalSign = 1;

      for (let boxIndex = 0; boxIndex < boxCount; boxIndex++) {
        const wasHit = intersectRayWithPackedBounds(
          positionX,
          positionY,
          positionZ,
          directionX,
          directionY,
          directionZ,
          context.boxBounds,
          boxIndex * BOUNDS_STRIDE,
          true,
          nearestHit,
        );
        if (wasHit && nearestHit.distance < nearestDistance) {
          nearestDistance = nearestHit.distance;
          nearestBoxIndex = boxIndex;
          nearestNormalAxis = nearestHit.normalAxis;
          nearestNormalSign = nearestHit.normalSign;
        }
      }

      if (nearestBoxIndex < 0) break;

      distanceTraveled += nearestDistance;
      const hitX = positionX + directionX * nearestDistance;
      const hitY = positionY + directionY * nearestDistance;
      const hitZ = positionZ + directionZ * nearestDistance;

      if (context.absorbsCompletely[nearestBoxIndex] === 1) break;

      const throughputAfterLow = throughputLow * (1 - context.absorptionLow[nearestBoxIndex]);
      const throughputAfterMid = throughputMid * (1 - context.absorptionMid[nearestBoxIndex]);
      const throughputAfterHigh = throughputHigh * (1 - context.absorptionHigh[nearestBoxIndex]);

      const hitScatterAmount = context.scatterAmounts[nearestBoxIndex];
      recordReflectionArrival(
        context,
        hitX,
        hitY,
        hitZ,
        nearestNormalAxis,
        nearestNormalSign,
        directionX,
        directionY,
        directionZ,
        hitScatterAmount,
        !hasOnlySpecularBounces || bounce >= MAXIMUM_IMAGE_SOURCE_ORDER,
        distanceTraveled,
        throughputAfterLow,
        throughputAfterMid,
        throughputAfterHigh,
      );

      const remainingThroughput = Math.max(throughputAfterLow, throughputAfterMid, throughputAfterHigh);
      if (remainingThroughput < params.minimumEnergyThreshold) break;

      // Russian roulette: below the threshold, keep the ray only with probability proportional to what it
      // still carries, and scale survivors up by the reciprocal. The expected energy is unchanged — the tail
      // is simply carried by fewer, heavier rays the deeper it goes — so a long decay costs about what it
      // physically should instead of every ray being traced to a fixed bounce count regardless of whether it
      // still contributes anything.
      let survivalBoost = 1;
      if (remainingThroughput < RUSSIAN_ROULETTE_THRESHOLD) {
        const survivalProbability = remainingThroughput / RUSSIAN_ROULETTE_THRESHOLD;
        if (params.randomSource() >= survivalProbability) break;
        survivalBoost = 1 / survivalProbability;
      }
      throughputLow = throughputAfterLow * survivalBoost;
      throughputMid = throughputAfterMid * survivalBoost;
      throughputHigh = throughputAfterHigh * survivalBoost;

      // A stochastic pick between a pure diffuse direction and the pure specular reflection — never a blend
      // of both — matching Steam Audio's own `bounce()`. Averaging the two directions into one vector (an
      // earlier version of this function) isn't a sample of any real reflection distribution; this is.
      const normalX = nearestNormalAxis === 0 ? nearestNormalSign : 0;
      const normalY = nearestNormalAxis === 1 ? nearestNormalSign : 0;
      const normalZ = nearestNormalAxis === 2 ? nearestNormalSign : 0;

      if (params.randomSource() < hitScatterAmount) {
        const scattered = randomCosineWeightedHemisphereVector({ x: normalX, y: normalY, z: normalZ }, params.randomSource);
        directionX = scattered.x;
        directionY = scattered.y;
        directionZ = scattered.z;
        hasOnlySpecularBounces = false;
      } else {
        const incomingAlongNormal = (nearestNormalAxis === 0 ? directionX : nearestNormalAxis === 1 ? directionY : directionZ) * nearestNormalSign;
        directionX -= 2 * incomingAlongNormal * normalX;
        directionY -= 2 * incomingAlongNormal * normalY;
        directionZ -= 2 * incomingAlongNormal * normalZ;
      }

      positionX = hitX + normalX * SURFACE_OFFSET_METERS;
      positionY = hitY + normalY * SURFACE_OFFSET_METERS;
      positionZ = hitZ + normalZ * SURFACE_OFFSET_METERS;
    }
  }

  return context.arrivals;
}
