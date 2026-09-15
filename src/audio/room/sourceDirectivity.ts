import type { RoomSource, SourceDirectivity } from './roomTypes';
import { dotVectors, type Vector3 } from './vector3';

export const OMNIDIRECTIONAL_DIRECTIVITY: SourceDirectivity = { enabled: false, weight: 0.5, sharpness: 2 };

export const MINIMUM_DIRECTIVITY_WEIGHT = 0;
export const MAXIMUM_DIRECTIVITY_WEIGHT = 1;
export const MINIMUM_DIRECTIVITY_SHARPNESS = 1;
export const MAXIMUM_DIRECTIVITY_SHARPNESS = 8;

/** The world-space direction a source at `yawDegrees` is aimed along — see `YawDegrees` for the convention. */
export function orientationForward(yawDegrees: number): Vector3 {
  const yawRadians = (yawDegrees * Math.PI) / 180;
  return { x: Math.cos(yawRadians), y: 0, z: Math.sin(yawRadians) };
}

/**
 * How much of its power a source sends in a given direction, relative to an omnidirectional source of the
 * same total output. Steam Audio's dipole model: `|(1 - weight) + weight·cos θ|^sharpness`, where θ is the
 * angle away from the direction the source faces.
 *
 * Real sources are not omnidirectional, and the difference is not subtle. A person talking radiates several
 * decibels less behind them than in front, and mostly loses the high end doing it — which is why someone
 * turning away from you goes muffled rather than just quieter, and why a room's reverb barely changes while
 * their direct sound does. Nothing about that is reproducible with a source that radiates a sphere.
 *
 * `direction` is the unit vector the sound leaves along.
 */
export function directivityGain(source: RoomSource, direction: Vector3): number {
  if (!source.directivity.enabled) return 1;

  const cosineFromFacing = dotVectors(orientationForward(source.yawDegrees), direction);
  const lobe = Math.abs((1 - source.directivity.weight) + source.directivity.weight * cosineFromFacing);
  return Math.pow(lobe, source.directivity.sharpness);
}
