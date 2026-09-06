import { intersectRayWithBox, type Ray } from './rayBoxIntersection';
import { toAxisAlignedBox } from './roomBoxGeometry';
import {
  MAXIMUM_BOUNCES,
  MAXIMUM_RAY_DISTANCE_METERS,
  MINIMUM_ENERGY_THRESHOLD,
  NUMBER_OF_RAYS,
  RECEIVER_RADIUS_METERS,
  SCATTER_AMOUNT,
  SPEED_OF_SOUND_METERS_PER_SECOND,
} from './roomAcousticsDefaults';
import type { FrequencyBandValues, RoomBox, RoomScene } from './roomTypes';
import {
  addVectors,
  closestFractionOnSegment,
  distanceBetweenPoints,
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
  receiverRadiusMeters: number;
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
  receiverRadiusMeters: RECEIVER_RADIUS_METERS,
  minimumEnergyThreshold: MINIMUM_ENERGY_THRESHOLD,
  maximumDistanceMeters: MAXIMUM_RAY_DISTANCE_METERS,
  scatterAmount: SCATTER_AMOUNT,
  randomSource: Math.random,
};

export interface ImpulseArrival {
  timeSeconds: number;
  energy: FrequencyBandValues;
}

/** A small offset nudging a reflected ray's origin off the surface it just left, so the next intersection test
    doesn't immediately re-hit the same face due to floating-point rounding. */
const SURFACE_OFFSET_METERS = 1e-4;

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

/** Records an arrival if the segment from `segmentStart` to `segmentEnd` passes within the receiver radius of
    the listener. The contribution is weighted by how much of the sound's expanding spherical wavefront a
    receiver of that radius would actually intercept at the distance traveled — a standard correction for
    energy-based ray tracing with a finite receiver, without which every ray that merely grazes the receiver
    sphere would contribute as much energy as one that scores a direct hit. */
function recordArrivalIfWithinReceiver(
  segmentStart: Vector3,
  segmentEnd: Vector3,
  distanceTraveledBeforeSegment: number,
  energyAtSegmentStart: FrequencyBandValues,
  listener: Vector3,
  params: RayTracingParams,
  arrivals: ImpulseArrival[],
): void {
  const fraction = closestFractionOnSegment(segmentStart, segmentEnd, listener);
  const closestPoint = addVectors(segmentStart, scaleVector({ x: segmentEnd.x - segmentStart.x, y: segmentEnd.y - segmentStart.y, z: segmentEnd.z - segmentStart.z }, fraction));
  const distanceToListener = distanceBetweenPoints(closestPoint, listener);
  if (distanceToListener > params.receiverRadiusMeters) return;

  const segmentLength = distanceBetweenPoints(segmentStart, segmentEnd);
  const totalDistance = Math.max(0.1, distanceTraveledBeforeSegment + fraction * segmentLength);
  const captureFraction = Math.min(1, (params.receiverRadiusMeters * params.receiverRadiusMeters) / (4 * totalDistance * totalDistance));

  arrivals.push({
    timeSeconds: totalDistance / params.speedOfSoundMetersPerSecond,
    energy: scaleBandValues(energyAtSegmentStart, captureFraction),
  });
}

/** Fires `params.numberOfRays` rays from the scene's source in random directions, bounces them off `wall`
    boxes (losing energy per the hit face's absorption, plus a little diffusion so the tail isn't unnaturally
    metallic), and terminates a ray outright on hitting an `absorber` box. Every ray segment passing near the
    listener contributes a time-stamped, distance-attenuated energy arrival — the raw material `synthesizeImpulseResponseFromHistogram.ts` turns into an actual impulse response. */
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
      if (remainingBudget <= 0) break;

      const segmentDistance = hit ? Math.min(hit.distance, remainingBudget) : remainingBudget;
      const segmentEnd = addVectors(position, scaleVector(direction, segmentDistance));

      recordArrivalIfWithinReceiver(position, segmentEnd, distanceTraveled, energy, scene.listener, params, arrivals);
      distanceTraveled += segmentDistance;

      if (!hit || hit.distance > remainingBudget) break;
      if (hit.box.kind === 'absorber') break;

      energy = {
        low: energy.low * (1 - hit.box.absorption.low),
        mid: energy.mid * (1 - hit.box.absorption.mid),
        high: energy.high * (1 - hit.box.absorption.high),
      };
      if (maximumBandValue(energy) < params.minimumEnergyThreshold) break;

      const specularDirection = reflectVector(direction, hit.normal);
      const scatterDirection = randomHemisphereVector(hit.normal, params.randomSource);
      direction = normalizeMixedDirection(specularDirection, scatterDirection, params.scatterAmount);
      position = addVectors(segmentEnd, scaleVector(hit.normal, SURFACE_OFFSET_METERS));
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
