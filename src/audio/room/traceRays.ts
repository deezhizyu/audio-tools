import { applyAirAbsorption } from './airAbsorption';
import { intersectRayWithBox, type AxisAlignedBox, type Ray } from './rayBoxIntersection';
import { getEffectiveScatterAmount } from './roomMaterials';
import { toAxisAlignedBox } from './roomBoxGeometry';
import { horizontalPanPosition } from './stereoPanning';
import {
  MAXIMUM_BOUNCES,
  MAXIMUM_RAY_DISTANCE_METERS,
  MINIMUM_CONTRIBUTION_DISTANCE_METERS,
  MINIMUM_ENERGY_THRESHOLD,
  NUMBER_OF_RAYS,
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

export interface ImpulseArrival {
  timeSeconds: number;
  energy: FrequencyBandValues;
  /** 0 for a ray's first bounce off any surface, incrementing per bounce after that. A first-bounce arrival
      is one of at most `numberOfRays` samples of a single reflecting surface as seen directly from the
      source — inherently few and tightly clustered in time for simple geometry (e.g. one flat floor).
      Later-order arrivals proliferate combinatorially across a scene's surfaces and genuinely approximate a
      dense, statistically independent field. `synthesizeRoomImpulseResponse.ts` uses this distinction to
      route first-bounce arrivals to a coherent, discrete-tap renderer and everything else to the existing
      noise-based one — see `renderDiscreteReflectionTaps.ts`. */
  bounceOrder: number;
  /** This arrival's left/right position as heard from the listener (-1 fully left, +1 fully right, 0
      centered) — see `horizontalPanPosition` in `stereoPanning.ts`. Always computed, so stereo simulation
      can be toggled purely at consumption time (`renderDiscreteReflectionTaps.ts`, `buildEnergyHistogram.ts`)
      without re-tracing rays. */
  panPosition: number;
}

/** A small offset nudging a point off the surface it sits on, so the next intersection test doesn't
    immediately re-hit the same face due to floating-point rounding. */
const SURFACE_OFFSET_METERS = 1e-4;

/** Below this, a straight line from a hit point to the listener is considered coincident with the hit point
    itself (no meaningful direction to test for occlusion). */
const COINCIDENT_POINT_EPSILON_METERS = 1e-9;

const OCCLUSION_EPSILON_METERS = 1e-6;

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

/** Whether a straight line from `from` to `listener` is unobstructed by any box — the shadow ray of a
    next-event-estimation reflection contribution (see `recordReflectionArrival` below). */
function hasLineOfSightToListener(from: Vector3, listener: Vector3, distance: number, boxes: BoxWithBounds[]): boolean {
  if (distance < COINCIDENT_POINT_EPSILON_METERS) return true;

  const direction = normalizeVector({ x: listener.x - from.x, y: listener.y - from.y, z: listener.z - from.z });
  return !boxes.some(({ bounds }) => {
    const hit = intersectRayWithBox({ origin: from, direction }, bounds);
    return hit !== null && hit.distance < distance - OCCLUSION_EPSILON_METERS;
  });
}

/** How tightly a specular highlight is focused around the true mirror-reflection angle — the `kSpecularExponent`
    Steam Audio's own reflection simulator uses for exactly this term. Higher = a narrower, brighter highlight
    (closer to a perfect point-like mirror echo); this doesn't change with a box's roughness — `scatterAmount`
    already controls how much of a hit's energy uses this lobe vs. the diffuse one (see `recordReflectionArrival`
    below). */
const SPECULAR_LOBE_EXPONENT = 100;

/** Next-event estimation: rather than waiting for a stochastic ray to wander within some capture radius of
    the listener (which starves nearby listeners of samples and, worse, lets a ray's very first, pre-bounce
    segment "capture" spurious energy when the listener happens to sit close to the source), every bounce fires
    one deterministic shadow ray straight at the listener. If it's unobstructed, the bounce contributes energy
    via a normalized Blinn-Phong-style BRDF: a Lambertian diffuse lobe (`scatterAmount / π`, weighted by the
    cosine of how directly the surface faces the listener) plus a specular lobe peaked at the true mirror
    -reflection angle (`(1 - scatterAmount)` weighted, via the half-vector between the incoming ray and the
    shadow ray raised to `SPECULAR_LOBE_EXPONENT`) — the same combined-lobe formula Steam Audio's own reflection
    simulator's `shade()` uses. Both lobes are individually energy-conserving (each integrates to at most 1 over
    the hemisphere) and are complementary, weighted by `scatterAmount` and `1 - scatterAmount` respectively, so
    raising a surface's roughness *redistributes* its reflected energy from a narrow specular highlight into a
    wide diffuse spread rather than inflating the total delivered to the listener — an earlier diffuse-only
    version of this function had no specular term at all, so a near-specular surface (low `scatterAmount`)
    contributed almost nothing here, and a rough surface's contribution grew with `scatterAmount` alone with
    nothing to balance it, letting a rough material's reflected energy grow unboundedly louder than a smooth
    one's for the same geometry — audible as an unnaturally dense, front-loaded, quickly-decaying burst of early
    reflections rather than a spacious reverb tail. This overall technique — deterministic shadow rays instead
    of hoping a ray wanders close enough — is what real-time geometric-acoustics engines (e.g. Steam Audio) use
    to avoid the "rays miss the listener" failure mode. */
function recordReflectionArrival(
  hitPoint: Vector3,
  hitNormal: Vector3,
  incomingDirection: Vector3,
  hitScatterAmount: number,
  distanceTraveledToHit: number,
  energyAtHit: FrequencyBandValues,
  bounceOrder: number,
  listener: Vector3,
  boxes: BoxWithBounds[],
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

  const halfVector = normalizeVector({
    x: directionToListener.x - incomingDirection.x,
    y: directionToListener.y - incomingDirection.y,
    z: directionToListener.z - incomingDirection.z,
  });
  const specularAlignment = Math.max(0, dotVectors(halfVector, hitNormal));

  const clampedDistance = Math.max(distanceToListener, params.minimumContributionDistanceMeters);
  const diffuseLobeWeight = (hitScatterAmount / Math.PI) * cosineWeight;
  const specularLobeWeight =
    ((SPECULAR_LOBE_EXPONENT + 2) / (8 * Math.PI)) * (1 - hitScatterAmount) * Math.pow(specularAlignment, SPECULAR_LOBE_EXPONENT);
  const attenuation = (diffuseLobeWeight + specularLobeWeight) / (clampedDistance * clampedDistance);
  const totalDistance = distanceTraveledToHit + distanceToListener;

  // The arrival reaches the listener from `originPoint`, i.e. along the reverse of `directionToListener`.
  const panPosition = horizontalPanPosition(scaleVector(directionToListener, -1));

  arrivals.push({
    timeSeconds: totalDistance / params.speedOfSoundMetersPerSecond,
    energy: applyAirAbsorption(scaleBandValues(energyAtHit, attenuation), totalDistance),
    bounceOrder,
    panPosition,
  });
}

/** Fires `params.numberOfRays` rays from the scene's source in random directions and bounces them off `object`
    boxes, losing energy per the hit face's absorption plus a per-material amount of diffusion (see
    `getEffectiveScatterAmount`) so the tail isn't unnaturally metallic and rougher surfaces scatter sound more
    diffusely than smooth ones. A ray terminates outright on hitting an `absorber` box. Every reflection point
    contributes a time-stamped, distance- and angle-attenuated energy arrival via next-event estimation (see
    `recordReflectionArrival`) — the raw material `synthesizeImpulseResponseFromHistogram.ts` turns into an
    actual impulse response. The direct, unreflected path is handled separately by `directSound.ts` and is
    never sampled here. */
export function traceRays(scene: RoomScene, params: RayTracingParams): ImpulseArrival[] {
  const arrivals: ImpulseArrival[] = [];
  const boxes = toBoxesWithBounds(scene.boxes);

  for (let rayIndex = 0; rayIndex < params.numberOfRays; rayIndex++) {
    let position = { ...scene.source };
    let direction = randomUnitVector(params.randomSource);
    let energy: FrequencyBandValues = { low: 1, mid: 1, high: 1 };
    let distanceTraveled = 0;

    for (let bounce = 0; bounce < params.maximumBounces; bounce++) {
      const hit = findNearestHit({ origin: position, direction }, boxes);
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

      const hitScatterAmount = getEffectiveScatterAmount(hit.box);
      recordReflectionArrival(hitPoint, hit.normal, direction, hitScatterAmount, distanceTraveled, energyAfterAbsorption, bounce, scene.listener, boxes, params, arrivals);

      if (maximumBandValue(energyAfterAbsorption) < params.minimumEnergyThreshold) break;
      energy = energyAfterAbsorption;

      // A stochastic pick between a pure diffuse (hemisphere) direction and the pure specular reflection —
      // never a blend of both — matching Steam Audio's own `bounce()`. Averaging the two directions into one
      // vector (an earlier version of this function) isn't a sample of any real BRDF lobe; this is.
      direction =
        params.randomSource() < hitScatterAmount ? randomHemisphereVector(hit.normal, params.randomSource) : reflectVector(direction, hit.normal);
      position = addVectors(hitPoint, scaleVector(hit.normal, SURFACE_OFFSET_METERS));
    }
  }

  return arrivals;
}
