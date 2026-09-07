import { intersectRayWithBox, type Ray } from './rayBoxIntersection';
import { toAxisAlignedBox } from './roomBoxGeometry';
import {
  MAXIMUM_BOUNCES,
  MAXIMUM_RAY_DISTANCE_METERS,
  MINIMUM_CONTRIBUTION_DISTANCE_METERS,
  MINIMUM_ENERGY_THRESHOLD,
  NUMBER_OF_RAYS,
  SCATTER_AMOUNT,
  SPEED_OF_SOUND_METERS_PER_SECOND,
} from './roomAcousticsDefaults';
import type { FrequencyBandValues, RoomBox, RoomScene } from './roomTypes';
import {
  addVectors,
  distanceBetweenPoints,
  dotVectors,
  normalizeVector,
  randomHemisphereVector,
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
  scatterAmount: number;
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
  scatterAmount: SCATTER_AMOUNT,
  randomSource: Math.random,
};

export interface ImpulseArrival {
  timeSeconds: number;
  energy: FrequencyBandValues;
}

/** A small offset nudging a point off the surface it sits on, so the next intersection test doesn't
    immediately re-hit the same face due to floating-point rounding. */
const SURFACE_OFFSET_METERS = 1e-4;

/** Below this, a straight line from a hit point to the listener is considered coincident with the hit point
    itself (no meaningful direction to test for occlusion). */
const COINCIDENT_POINT_EPSILON_METERS = 1e-9;

const OCCLUSION_EPSILON_METERS = 1e-6;

function findNearestHit(ray: Ray, boxes: RoomBox[]): { box: RoomBox; distance: number; normal: Vector3 } | null {
  let nearest: { box: RoomBox; distance: number; normal: Vector3 } | null = null;

  for (const box of boxes) {
    const intersection = intersectRayWithBox(ray, toAxisAlignedBox(box));
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

/** Whether a straight line from `from` to `listener` is unobstructed by any box — the shadow ray of a
    next-event-estimation reflection contribution (see `recordReflectionArrival` below). */
function hasLineOfSightToListener(from: Vector3, listener: Vector3, distance: number, boxes: RoomBox[]): boolean {
  if (distance < COINCIDENT_POINT_EPSILON_METERS) return true;

  const direction = normalizeVector({ x: listener.x - from.x, y: listener.y - from.y, z: listener.z - from.z });
  return !boxes.some(box => {
    const hit = intersectRayWithBox({ origin: from, direction }, toAxisAlignedBox(box));
    return hit !== null && hit.distance < distance - OCCLUSION_EPSILON_METERS;
  });
}

/** Next-event estimation: rather than waiting for a stochastic ray to wander within some capture radius of
    the listener (which starves nearby listeners of samples and, worse, lets a ray's very first, pre-bounce
    segment "capture" spurious energy when the listener happens to sit close to the source), every bounce
    fires one deterministic shadow ray straight at the listener. If it's unobstructed, the bounce contributes
    energy scaled by the same physics that governs any reflection reaching a point: it falls off with the
    inverse square of distance, and with how directly the surface faces the listener (a grazing reflection
    spreads its energy over a wider angle than one that faces the listener head-on). This is the same
    technique real-time geometric-acoustics engines (e.g. Steam Audio) use to avoid exactly this "rays miss
    the listener" failure mode. */
function recordReflectionArrival(
  hitPoint: Vector3,
  hitNormal: Vector3,
  distanceTraveledToHit: number,
  energyAtHit: FrequencyBandValues,
  listener: Vector3,
  boxes: RoomBox[],
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

  if (!hasLineOfSightToListener(originPoint, listener, distanceToListener, boxes)) return;

  const clampedDistance = Math.max(distanceToListener, params.minimumContributionDistanceMeters);
  const attenuation = cosineWeight / (clampedDistance * clampedDistance);
  const totalDistance = distanceTraveledToHit + distanceToListener;

  arrivals.push({
    timeSeconds: totalDistance / params.speedOfSoundMetersPerSecond,
    energy: scaleBandValues(energyAtHit, attenuation),
  });
}

/** Fires `params.numberOfRays` rays from the scene's source in random directions and bounces them off `wall`
    boxes, losing energy per the hit face's absorption plus a little diffusion so the tail isn't unnaturally
    metallic. A ray terminates outright on hitting an `absorber` box. Every reflection point contributes a
    time-stamped, distance- and angle-attenuated energy arrival via next-event estimation (see
    `recordReflectionArrival`) — the raw material `synthesizeImpulseResponseFromHistogram.ts` turns into an
    actual impulse response. The direct, unreflected path is handled separately by `directSound.ts` and is
    never sampled here. */
export function traceRays(scene: RoomScene, params: RayTracingParams): ImpulseArrival[] {
  const arrivals: ImpulseArrival[] = [];

  for (let rayIndex = 0; rayIndex < params.numberOfRays; rayIndex++) {
    let position = { ...scene.source };
    let direction = randomUnitVector(params.randomSource);
    let energy: FrequencyBandValues = { low: 1, mid: 1, high: 1 };
    let distanceTraveled = 0;

    for (let bounce = 0; bounce < params.maximumBounces; bounce++) {
      const hit = findNearestHit({ origin: position, direction }, scene.boxes);
      const remainingBudget = params.maximumDistanceMeters - distanceTraveled;
      if (!hit || hit.distance > remainingBudget) break;

      distanceTraveled += hit.distance;
      const hitPoint = addVectors(position, scaleVector(direction, hit.distance));

      if (hit.box.kind === 'absorber') break;

      const energyAfterAbsorption = {
        low: energy.low * (1 - hit.box.absorption.low),
        mid: energy.mid * (1 - hit.box.absorption.mid),
        high: energy.high * (1 - hit.box.absorption.high),
      };

      recordReflectionArrival(hitPoint, hit.normal, distanceTraveled, energyAfterAbsorption, scene.listener, scene.boxes, params, arrivals);

      if (maximumBandValue(energyAfterAbsorption) < params.minimumEnergyThreshold) break;
      energy = energyAfterAbsorption;

      const specularDirection = reflectVector(direction, hit.normal);
      const scatterDirection = randomHemisphereVector(hit.normal, params.randomSource);
      direction = normalizeMixedDirection(specularDirection, scatterDirection, params.scatterAmount);
      position = addVectors(hitPoint, scaleVector(hit.normal, SURFACE_OFFSET_METERS));
    }
  }

  return arrivals;
}

function normalizeMixedDirection(specular: Vector3, scattered: Vector3, scatterAmount: number): Vector3 {
  const mixed = {
    x: specular.x * (1 - scatterAmount) + scattered.x * scatterAmount,
    y: specular.y * (1 - scatterAmount) + scattered.y * scatterAmount,
    z: specular.z * (1 - scatterAmount) + scattered.z * scatterAmount,
  };
  const length = Math.sqrt(mixed.x * mixed.x + mixed.y * mixed.y + mixed.z * mixed.z);
  return length < 1e-9 ? specular : scaleVector(mixed, 1 / length);
}
