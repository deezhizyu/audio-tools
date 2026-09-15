import { applyAirAbsorption } from './airAbsorption';
import { isSegmentUnobstructed } from './lineOfSight';
import { intersectRayWithBox, type AxisAlignedBox, type Ray } from './rayBoxIntersection';
import { getEffectiveScatterAmount } from './roomMaterials';
import { toAxisAlignedBox } from './roomBoxGeometry';
import { lateralPositionInListenerFrame } from './listenerHeadModel';
import {
  energyPerRay,
  INTERACTIVE_MAXIMUM_BOUNCES,
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
import type { FrequencyBandValues, RoomBox, RoomListener, RoomScene } from './roomTypes';
import { directivityGain } from './sourceDirectivity';
import {
  addVectors,
  distanceBetweenPoints,
  dotVectors,
  randomCosineWeightedHemisphereVector,
  randomUnitVector,
  reflectVector,
  scaleVector,
  type Vector3,
} from './vector3';

export interface RayTracingParams {
  numberOfRays: number;
  maximumBounces: number;
  speedOfSoundMetersPerSecond: number;
  minimumContributionDistanceMeters: number;
  minimumEnergyThreshold: number;
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
};

export interface ImpulseArrival {
  timeSeconds: number;
  /** Absolute energy delivered to the listener — already carrying this ray's share of the source's total
      power (see `energyPerRay`), so it is directly comparable to the direct path's own `1/distance²` and no
      consumer needs to normalize by ray count. */
  energy: FrequencyBandValues;
  /** Where this arrival sits on the listener's own left/right axis (-1 fully left, +1 fully right, 0 straight
      ahead or behind) — see `lateralPositionInListenerFrame` in `listenerHeadModel.ts`. Measured in the
      listener's frame rather than the room's, so turning the listener really does turn the room around them. */
  lateralPosition: number;
}

/** A small offset nudging a point off the surface it sits on, so the next intersection test doesn't
    immediately re-hit the same face due to floating-point rounding. */
const SURFACE_OFFSET_METERS = 1e-4;

/** Below this, a straight line from a hit point to the listener is considered coincident with the hit point
    itself (no meaningful direction to test for occlusion). */
const COINCIDENT_POINT_EPSILON_METERS = 1e-9;

/** A box paired with its axis-aligned bounds, computed once per `traceRays` call rather than on every one of
    the millions of ray-box tests a simulation runs — the boxes never move during a single simulation, so
    reconstructing this six-number object from scratch on every test was pure, avoidable allocation churn. */
interface BoxWithBounds {
  box: RoomBox;
  bounds: AxisAlignedBox;
}

function toBoxesWithBounds(boxes: RoomBox[]): BoxWithBounds[] {
  return boxes.map(box => ({ box, bounds: toAxisAlignedBox(box) }));
}

/** `hitFromInside: true` lets a box double as a room's enclosing shell: a ray whose origin sits inside a box
    (e.g. because the source/listener were placed inside one big bounding box instead of surrounded by separate
    wall slabs) bounces off that box's inner surface rather than passing straight through it — see
    `rayBoxIntersection.ts`. This has no effect on the ordinary case (a ray outside a box approaching it), so it
    doesn't change behavior for the usual "separate wall boxes with open space between them" room layout. */
function findNearestHit(ray: Ray, boxes: BoxWithBounds[]): { box: RoomBox; distance: number; normal: Vector3 } | null {
  let nearest: { box: RoomBox; distance: number; normal: Vector3 } | null = null;

  for (const { box, bounds } of boxes) {
    const intersection = intersectRayWithBox(ray, bounds, { hitFromInside: true });
    if (intersection && (!nearest || intersection.distance < nearest.distance)) {
      nearest = { box, distance: intersection.distance, normal: intersection.normal };
    }
  }

  return nearest;
}

function scaleBandValues(values: FrequencyBandValues, scale: number): FrequencyBandValues {
  return { low: values.low * scale, mid: values.mid * scale, high: values.high * scale };
}

function maximumBandValue(values: FrequencyBandValues): number {
  return Math.max(values.low, values.mid, values.high);
}

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

/** Next-event estimation: rather than waiting for a stochastic ray to wander within some capture radius of
    the listener (which starves nearby listeners of samples and, worse, lets a ray's very first, pre-bounce
    segment "capture" spurious energy when the listener happens to sit close to the source), every bounce
    fires one deterministic shadow ray straight at the listener. If it's unobstructed, the bounce contributes
    energy through the surface's reflection distribution: a Lambertian diffuse lobe (`scatterAmount/π`,
    weighted by the cosine of how directly the surface faces the listener) plus a specular lobe peaked on the
    true mirror-reflection direction and weighted by `1 - scatterAmount`. Each lobe integrates to one over the
    outgoing hemisphere and the two weights sum to one, so raising a surface's roughness *redistributes* its
    reflected energy from a narrow highlight into a wide spread rather than inflating or losing the total.
    Firing deterministic shadow rays instead of hoping a ray wanders close enough is what real-time
    geometric-acoustics engines (e.g. Steam Audio) use to avoid the "rays miss the listener" failure mode.

    The specular lobe is built around the mirror-reflection direction rather than the half-vector between the
    incoming ray and the shadow ray. The half-vector form — a graphics convention, and what this used to use —
    is not energy conserving here: its integral over the outgoing hemisphere comes out as the cosine of the
    angle of incidence, so it silently discards energy as reflections get more oblique, losing half of it at
    60° and five sixths at 80°. Since most wall reflections in a room *are* oblique, that quietly drained the
    reverberant field of a large part of its energy, leaving rooms far drier than their geometry implies.

    `throughputAtHit` is the fraction of this ray's *original* energy still carried after every absorption so
    far; `energyPerRayValue` converts that fraction into absolute energy (see `energyPerRay`). Keeping the two
    separate is what lets Russian roulette below reason about throughput in ray-count-independent terms.

    `includeSpecularLobe` is false for the low-order all-specular paths that `imageSources.ts` computes
    exactly, so the same echo is never delivered twice. */
function recordReflectionArrival(
  hitPoint: Vector3,
  hitNormal: Vector3,
  incomingDirection: Vector3,
  hitScatterAmount: number,
  includeSpecularLobe: boolean,
  distanceTraveledToHit: number,
  throughputAtHit: FrequencyBandValues,
  energyPerRayValue: number,
  listener: RoomListener,
  boxBounds: AxisAlignedBox[],
  params: RayTracingParams,
  arrivals: ImpulseArrival[],
): void {
  const originPoint = addVectors(hitPoint, scaleVector(hitNormal, SURFACE_OFFSET_METERS));
  const distanceToListener = distanceBetweenPoints(originPoint, listener);

  const directionToListener =
    distanceToListener < COINCIDENT_POINT_EPSILON_METERS
      ? hitNormal
      : scaleVector({ x: listener.x - originPoint.x, y: listener.y - originPoint.y, z: listener.z - originPoint.z }, 1 / distanceToListener);
  const cosineWeight = dotVectors(hitNormal, directionToListener);
  if (cosineWeight <= 0) return;

  const diffuseLobeWeight = (hitScatterAmount / Math.PI) * cosineWeight;

  let specularLobeWeight = 0;
  if (includeSpecularLobe && hitScatterAmount < 1) {
    const mirrorDirection = reflectVector(incomingDirection, hitNormal);
    const specularAlignment = Math.max(0, dotVectors(mirrorDirection, directionToListener));
    const exponent = specularLobeExponent(hitScatterAmount);
    specularLobeWeight = ((exponent + 1) / (2 * Math.PI)) * (1 - hitScatterAmount) * Math.pow(specularAlignment, exponent);
  }

  const clampedDistance = Math.max(distanceToListener, params.minimumContributionDistanceMeters);
  const attenuation = (energyPerRayValue * (diffuseLobeWeight + specularLobeWeight)) / (clampedDistance * clampedDistance);

  // Cheap tests first: the shadow ray costs a pass over every box in the scene, so it is only worth firing
  // once this contribution is known to be big enough to matter at all.
  if (maximumBandValue(throughputAtHit) * attenuation < params.minimumEnergyThreshold) return;
  if (!isSegmentUnobstructed(originPoint, directionToListener, distanceToListener, boxBounds)) return;

  const totalDistance = distanceTraveledToHit + distanceToListener;

  // The arrival reaches the listener from `originPoint`, i.e. along the reverse of `directionToListener`.
  const lateralPosition = lateralPositionInListenerFrame(scaleVector(directionToListener, -1), listener);

  arrivals.push({
    timeSeconds: totalDistance / params.speedOfSoundMetersPerSecond,
    energy: applyAirAbsorption(scaleBandValues(throughputAtHit, attenuation), totalDistance),
    lateralPosition,
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
    low-order all-specular echoes (`imageSources.ts`) that `includeSpecularLobe` below excludes. */
export function traceRays(scene: RoomScene, params: RayTracingParams): ImpulseArrival[] {
  const arrivals: ImpulseArrival[] = [];
  const boxes = toBoxesWithBounds(scene.boxes);
  const boxBounds = boxes.map(({ bounds }) => bounds);
  const energyPerRayValue = energyPerRay(params.numberOfRays);

  for (let rayIndex = 0; rayIndex < params.numberOfRays; rayIndex++) {
    let position: Vector3 = { x: scene.source.x, y: scene.source.y, z: scene.source.z };
    let direction = randomUnitVector(params.randomSource);

    // The fraction of this ray's starting energy still in flight, per band. It starts at the source's
    // directivity in the direction this ray happens to leave along rather than at 1, so a narrowly-aimed
    // source's off-axis rays start out faint and are dropped below without ever being traced.
    const emittedFraction = directivityGain(scene.source, direction);
    if (emittedFraction < params.minimumEnergyThreshold) continue;
    // Tracked as a fraction rather than as absolute energy so Russian roulette's threshold below means the
    // same thing regardless of how many rays the simulation happens to be firing.
    let throughput: FrequencyBandValues = { low: emittedFraction, mid: emittedFraction, high: emittedFraction };
    let distanceTraveled = 0;
    // Only a ray that has mirror-reflected at every bounce so far is travelling a path the image-source pass
    // also computes; once it scatters, it is carrying diffuse energy that pass knows nothing about, and its
    // specular lobe has to be counted here again.
    let hasOnlySpecularBounces = true;

    for (let bounce = 0; bounce < params.maximumBounces; bounce++) {
      const hit = findNearestHit({ origin: position, direction }, boxes);
      const remainingBudget = params.maximumDistanceMeters - distanceTraveled;
      if (!hit || hit.distance > remainingBudget) break;

      distanceTraveled += hit.distance;
      const hitPoint = addVectors(position, scaleVector(direction, hit.distance));

      if (hit.box.kind === 'absorber') break;

      const throughputAfterAbsorption = {
        low: throughput.low * (1 - hit.box.absorption.low),
        mid: throughput.mid * (1 - hit.box.absorption.mid),
        high: throughput.high * (1 - hit.box.absorption.high),
      };

      const hitScatterAmount = getEffectiveScatterAmount(hit.box);
      const includeSpecularLobe = !hasOnlySpecularBounces || bounce >= MAXIMUM_IMAGE_SOURCE_ORDER;
      recordReflectionArrival(
        hitPoint,
        hit.normal,
        direction,
        hitScatterAmount,
        includeSpecularLobe,
        distanceTraveled,
        throughputAfterAbsorption,
        energyPerRayValue,
        scene.listener,
        boxBounds,
        params,
        arrivals,
      );

      const remainingThroughput = maximumBandValue(throughputAfterAbsorption);
      if (remainingThroughput < params.minimumEnergyThreshold) break;

      // Russian roulette: below the threshold, keep the ray only with probability proportional to what it
      // still carries, and scale survivors up by the reciprocal. The expected energy is unchanged — the tail
      // is simply carried by fewer, heavier rays the deeper it goes — so a long decay costs about what it
      // physically should instead of every ray being traced to a fixed bounce count regardless of whether it
      // still contributes anything.
      throughput = throughputAfterAbsorption;
      if (remainingThroughput < RUSSIAN_ROULETTE_THRESHOLD) {
        const survivalProbability = remainingThroughput / RUSSIAN_ROULETTE_THRESHOLD;
        if (params.randomSource() >= survivalProbability) break;
        throughput = scaleBandValues(throughput, 1 / survivalProbability);
      }

      // A stochastic pick between a pure diffuse direction and the pure specular reflection — never a blend
      // of both — matching Steam Audio's own `bounce()`. Averaging the two directions into one vector (an
      // earlier version of this function) isn't a sample of any real reflection distribution; this is.
      const scattersDiffusely = params.randomSource() < hitScatterAmount;
      direction = scattersDiffusely
        ? randomCosineWeightedHemisphereVector(hit.normal, params.randomSource)
        : reflectVector(direction, hit.normal);
      if (scattersDiffusely) hasOnlySpecularBounces = false;
      position = addVectors(hitPoint, scaleVector(hit.normal, SURFACE_OFFSET_METERS));
    }
  }

  return arrivals;
}
