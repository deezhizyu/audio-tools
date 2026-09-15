import { applyAirAbsorption } from './airAbsorption';
import type { DiscreteArrival } from './discreteArrival';
import { isSegmentUnobstructed } from './lineOfSight';
import { MINIMUM_CONTRIBUTION_DISTANCE_METERS } from './roomAcousticsDefaults';
import { toAxisAlignedBox } from './roomBoxGeometry';
import type { FrequencyBandValues, RoomScene } from './roomTypes';
import { horizontalPanPosition } from './stereoPanning';
import { buildOrthonormalBasis, distanceBetweenPoints, normalizeVector, type Vector3 } from './vector3';

const COINCIDENT_POINT_EPSILON_METERS = 1e-6;

/** How wide a bundle of parallel paths around the straight line is tested for obstruction. Roughly the size
    of the region around a path that actually matters for whether a sound gets through at speech frequencies —
    a couple of wavelengths across. */
const OCCLUSION_SAMPLE_RADIUS_METERS = 0.4;
const OCCLUSION_SAMPLE_RING_COUNT = 8;

/**
 * How much of each band survives when only `visibleFraction` of the path bundle is clear. Low frequencies
 * bend around an obstruction's edges far more readily than high ones — a metre-long wavelength barely
 * notices a chair, while a tweeter-range one is stopped by it — so the exponents rise with frequency and a
 * partly-blocked source goes *dull* rather than merely quiet. A single binary "occluded or not" test, which
 * is what this used to be, has a person step behind a pillar and vanish entirely instead of going muffled.
 */
const OCCLUSION_BAND_EXPONENTS: FrequencyBandValues = { low: 0.5, mid: 1, high: 1.7 };

/** Inverse-square spreading from a point source of `SOURCE_TOTAL_POWER`, which works out to exactly
    `1/distance²` — see `SOURCE_TOTAL_POWER`'s comment for why that constant is what it is. Floored at
    `MINIMUM_CONTRIBUTION_DISTANCE_METERS`, the same floor reflections use, so a source sitting on top of the
    listener is loud but finite. (That floor used to be a flat 1 meter here, which made every distance under a
    meter sound identical — a source at 30cm and one at 1m arrived at exactly the same level.) */
function spreadingEnergy(distanceMeters: number): number {
  const clampedDistance = Math.max(distanceMeters, MINIMUM_CONTRIBUTION_DISTANCE_METERS);
  return 1 / (clampedDistance * clampedDistance);
}

/** The fraction of a bundle of parallel paths around the source-to-listener line that reaches the listener
    unobstructed — Steam Audio's volumetric occlusion, and the reason an obstruction can partly block a path
    instead of only ever blocking it entirely. The bundle's radius shrinks for very short paths so two points
    a few centimeters apart aren't judged by obstructions half a meter off to the side. */
function computeVisibleFraction(scene: RoomScene, direction: Vector3, distanceMeters: number): number {
  const boxBounds = scene.boxes.map(toAxisAlignedBox);
  const radiusMeters = Math.min(OCCLUSION_SAMPLE_RADIUS_METERS, distanceMeters / 4);
  const { tangent, bitangent } = buildOrthonormalBasis(direction);

  let clearCount = 0;
  let totalCount = 0;
  for (let sampleIndex = 0; sampleIndex <= OCCLUSION_SAMPLE_RING_COUNT; sampleIndex++) {
    // Sample 0 is the true straight line; the rest ring around it at `radiusMeters`.
    const offsetScale = sampleIndex === 0 ? 0 : radiusMeters;
    const azimuth = ((sampleIndex - 1) / OCCLUSION_SAMPLE_RING_COUNT) * 2 * Math.PI;
    const offsetAlongTangent = offsetScale * Math.cos(azimuth);
    const offsetAlongBitangent = offsetScale * Math.sin(azimuth);
    const origin = {
      x: scene.source.x + tangent.x * offsetAlongTangent + bitangent.x * offsetAlongBitangent,
      y: scene.source.y + tangent.y * offsetAlongTangent + bitangent.y * offsetAlongBitangent,
      z: scene.source.z + tangent.z * offsetAlongTangent + bitangent.z * offsetAlongBitangent,
    };

    totalCount++;
    if (isSegmentUnobstructed(origin, direction, distanceMeters, boxBounds)) clearCount++;
  }

  return clearCount / totalCount;
}

function applyOcclusion(energy: FrequencyBandValues, visibleFraction: number): FrequencyBandValues {
  if (visibleFraction >= 1) return energy;
  if (visibleFraction <= 0) return { low: 0, mid: 0, high: 0 };
  return {
    low: energy.low * Math.pow(visibleFraction, OCCLUSION_BAND_EXPONENTS.low),
    mid: energy.mid * Math.pow(visibleFraction, OCCLUSION_BAND_EXPONENTS.mid),
    high: energy.high * Math.pow(visibleFraction, OCCLUSION_BAND_EXPONENTS.high),
  };
}

/**
 * The straight-line source-to-listener path, computed in closed form rather than relying on the stochastic
 * rays to happen to find it — with a finite ray count there's no guarantee a random ray travels exactly along
 * that line, but the direct sound is the loudest, most perceptually important part of the impulse response.
 *
 * Air absorption is applied here, not only to reflections: without it a source 50 meters away across an open
 * field arrives exactly as bright as one a meter away, which is the single most obvious thing wrong with a
 * distant outdoor sound.
 */
export function computeDirectSoundArrival(scene: RoomScene, speedOfSoundMetersPerSecond: number): DiscreteArrival {
  const distanceMeters = distanceBetweenPoints(scene.source, scene.listener);
  const timeSeconds = distanceMeters / speedOfSoundMetersPerSecond;
  const spreading = spreadingEnergy(distanceMeters);

  if (distanceMeters < COINCIDENT_POINT_EPSILON_METERS) {
    return { timeSeconds, energy: { low: spreading, mid: spreading, high: spreading }, panPosition: 0 };
  }

  const direction = normalizeVector({
    x: scene.listener.x - scene.source.x,
    y: scene.listener.y - scene.source.y,
    z: scene.listener.z - scene.source.z,
  });

  const spreadAndAbsorbed = applyAirAbsorption({ low: spreading, mid: spreading, high: spreading }, distanceMeters);
  const energy = applyOcclusion(spreadAndAbsorbed, computeVisibleFraction(scene, direction, distanceMeters));

  // The source is heard from the listener along the reverse of `direction` (which points listener-ward).
  const panPosition = horizontalPanPosition({ x: -direction.x, y: -direction.y, z: -direction.z });

  return { timeSeconds, energy, panPosition };
}
