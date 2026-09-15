import { applyAirAbsorption } from './airAbsorption';
import type { DiscreteArrival } from './discreteArrival';
import { isSegmentUnobstructed } from './lineOfSight';
import type { AxisAlignedBox } from './rayBoxIntersection';
import { MINIMUM_CONTRIBUTION_DISTANCE_METERS } from './roomAcousticsDefaults';
import { toAxisAlignedBox } from './roomBoxGeometry';
import { getEffectiveScatterAmount } from './roomMaterials';
import type { FrequencyBandValues, RoomBox, RoomScene } from './roomTypes';
import { directivityGain } from './sourceDirectivity';
import { distanceBetweenPoints, normalizeVector, type Vector3 } from './vector3';

type Axis = 'x' | 'y' | 'z';
const AXES: Axis[] = ['x', 'y', 'z'];

/** One flat rectangle a sound can bounce off: an axis-aligned plane plus the bounds of the box face lying in
    it. Both of a box's faces on a given axis are separate entries, and which side of the plane matters only
    when a specific path is validated. */
interface ReflectingFace {
  box: RoomBox;
  axis: Axis;
  planeCoordinate: number;
  bounds: AxisAlignedBox;
}

/** How much slack is left at each end of a path segment when testing it for obstruction. Every reflection
    point lies exactly on a solid box's surface, so without this each leg would report itself blocked by the
    very surface it bounces off. */
const PATH_SEGMENT_EPSILON_METERS = 1e-4;

/** Endpoints closer to a plane than this are treated as lying on it, so a source or listener placed exactly
    against a wall doesn't produce a degenerate zero-length reflection. */
const PLANE_COINCIDENCE_EPSILON_METERS = 1e-9;

function minimumOnAxis(bounds: AxisAlignedBox, axis: Axis): number {
  return axis === 'x' ? bounds.minX : axis === 'y' ? bounds.minY : bounds.minZ;
}

function maximumOnAxis(bounds: AxisAlignedBox, axis: Axis): number {
  return axis === 'x' ? bounds.maxX : axis === 'y' ? bounds.maxY : bounds.maxZ;
}

/** Every face of every reflecting box. Absorber boxes are left out: a ray that reaches one is consumed
    rather than reflected, so they can occlude a specular path but never create one. */
function collectReflectingFaces(boxes: RoomBox[]): ReflectingFace[] {
  const faces: ReflectingFace[] = [];
  for (const box of boxes) {
    if (box.kind !== 'object') continue;
    const bounds = toAxisAlignedBox(box);
    for (const axis of AXES) {
      faces.push({ box, axis, planeCoordinate: minimumOnAxis(bounds, axis), bounds });
      faces.push({ box, axis, planeCoordinate: maximumOnAxis(bounds, axis), bounds });
    }
  }
  return faces;
}

function mirrorAcrossFace(point: Vector3, face: ReflectingFace): Vector3 {
  return { ...point, [face.axis]: 2 * face.planeCoordinate - point[face.axis] };
}

/** Where the straight line from `from` to `to` crosses the face's plane, or `null` when the two endpoints
    are on the same side of it (no crossing, so no reflection off this face for this pair). */
function intersectSegmentWithFacePlane(from: Vector3, to: Vector3, face: ReflectingFace): Vector3 | null {
  const fromOffset = from[face.axis] - face.planeCoordinate;
  const toOffset = to[face.axis] - face.planeCoordinate;
  if (Math.abs(fromOffset) < PLANE_COINCIDENCE_EPSILON_METERS || Math.abs(toOffset) < PLANE_COINCIDENCE_EPSILON_METERS) return null;
  if (fromOffset > 0 === toOffset > 0) return null;

  const blend = fromOffset / (fromOffset - toOffset);
  return {
    x: from.x + (to.x - from.x) * blend,
    y: from.y + (to.y - from.y) * blend,
    z: from.z + (to.z - from.z) * blend,
  };
}

/** Whether a point on a face's plane actually lies within that face's rectangle, rather than somewhere on
    the infinite plane it happens to share. */
function isPointWithinFace(point: Vector3, face: ReflectingFace): boolean {
  return AXES.every(axis => {
    if (axis === face.axis) return true;
    return point[axis] >= minimumOnAxis(face.bounds, axis) && point[axis] <= maximumOnAxis(face.bounds, axis);
  });
}

function isPathLegClear(from: Vector3, to: Vector3, boxBounds: AxisAlignedBox[]): boolean {
  const distance = distanceBetweenPoints(from, to);
  if (distance <= 2 * PATH_SEGMENT_EPSILON_METERS) return false;

  const direction = normalizeVector({ x: to.x - from.x, y: to.y - from.y, z: to.z - from.z });
  const origin = {
    x: from.x + direction.x * PATH_SEGMENT_EPSILON_METERS,
    y: from.y + direction.y * PATH_SEGMENT_EPSILON_METERS,
    z: from.z + direction.z * PATH_SEGMENT_EPSILON_METERS,
  };
  return isSegmentUnobstructed(origin, direction, distance - 2 * PATH_SEGMENT_EPSILON_METERS, boxBounds);
}

/** The fraction of energy a face reflects specularly, per band: what its material doesn't absorb, times the
    part of that which reflects as a mirror rather than scattering. The scattered remainder is not lost — it
    is what the ray tracer's diffuse lobe delivers into the reverb tail (see `traceRays.ts`), which is why
    that module skips its own specular lobe for exactly the orders handled here. */
function faceSpecularReflectance(face: ReflectingFace): FrequencyBandValues {
  const specularFraction = 1 - getEffectiveScatterAmount(face.box);
  return {
    low: (1 - face.box.absorption.low) * specularFraction,
    mid: (1 - face.box.absorption.mid) * specularFraction,
    high: (1 - face.box.absorption.high) * specularFraction,
  };
}

/**
 * Reconstructs the real path a candidate image source implies and returns it, or `null` if that path can't
 * actually be walked. Working backwards from the listener is what makes the image-source method exact: the
 * straight line from the highest-order image to the listener crosses the last mirroring plane at precisely
 * the point where the true path reflects, and repeating that with each lower-order image peels off one
 * reflection at a time.
 */
function resolveReflectionPoints(images: Vector3[], faces: ReflectingFace[], listener: Vector3): Vector3[] | null {
  const reflectionPoints: Vector3[] = new Array(faces.length);
  let nextPoint = listener;

  for (let order = faces.length - 1; order >= 0; order--) {
    const reflectionPoint = intersectSegmentWithFacePlane(images[order + 1], nextPoint, faces[order]);
    if (reflectionPoint === null || !isPointWithinFace(reflectionPoint, faces[order])) return null;
    reflectionPoints[order] = reflectionPoint;
    nextPoint = reflectionPoint;
  }

  return reflectionPoints;
}

function buildArrivalForPath(
  scene: RoomScene,
  faces: ReflectingFace[],
  images: Vector3[],
  boxBounds: AxisAlignedBox[],
  speedOfSoundMetersPerSecond: number,
  maximumDistanceMeters: number,
): DiscreteArrival | null {
  const totalPathLength = distanceBetweenPoints(images[images.length - 1], scene.listener);
  if (totalPathLength > maximumDistanceMeters) return null;

  const reflectionPoints = resolveReflectionPoints(images, faces, scene.listener);
  if (reflectionPoints === null) return null;

  const walkedPoints = [scene.source, ...reflectionPoints, scene.listener];
  for (let legIndex = 0; legIndex < walkedPoints.length - 1; legIndex++) {
    if (!isPathLegClear(walkedPoints[legIndex], walkedPoints[legIndex + 1], boxBounds)) return null;
  }

  let energy: FrequencyBandValues = { low: 1, mid: 1, high: 1 };
  for (const face of faces) {
    const reflectance = faceSpecularReflectance(face);
    energy = { low: energy.low * reflectance.low, mid: energy.mid * reflectance.mid, high: energy.high * reflectance.high };
  }

  const clampedDistance = Math.max(totalPathLength, MINIMUM_CONTRIBUTION_DISTANCE_METERS);
  // The source radiates this path along its first leg, so that is the direction its directivity is read at.
  const emissionDirection = normalizeVector({
    x: reflectionPoints[0].x - scene.source.x,
    y: reflectionPoints[0].y - scene.source.y,
    z: reflectionPoints[0].z - scene.source.z,
  });
  const spreading = directivityGain(scene.source, emissionDirection) / (clampedDistance * clampedDistance);
  const spreadEnergy = { low: energy.low * spreading, mid: energy.mid * spreading, high: energy.high * spreading };

  const lastReflectionPoint = reflectionPoints[reflectionPoints.length - 1];
  const directionFromListener = normalizeVector({
    x: lastReflectionPoint.x - scene.listener.x,
    y: lastReflectionPoint.y - scene.listener.y,
    z: lastReflectionPoint.z - scene.listener.z,
  });

  return {
    timeSeconds: totalPathLength / speedOfSoundMetersPerSecond,
    energy: applyAirAbsorption(spreadEnergy, totalPathLength),
    directionFromListener,
  };
}

/**
 * Every specular echo reaching the listener after one or two bounces, computed exactly rather than sampled.
 *
 * A room's identity lives in its first few reflections: their delays and directions are what the ear reads
 * as the size and shape of the space, long before the diffuse tail arrives. Those early reflections are also
 * the part a stochastic ray tracer is worst at — off a single flat wall there is exactly one specular path,
 * and firing thousands of random rays at it produces thousands of slightly-different near-copies of it, which
 * is both noisy and, when rendered as coherent taps, badly wrong about how much energy it carries (see
 * `DiscreteArrival`). Mirroring the source across each surface instead gives that one path, once, at its true
 * delay — the classic image-source method, and the reason a simulated room can sound like a specific room
 * rather than like generic reverb.
 *
 * Only paths that survive every geometric check are kept: the reflection has to land on the surface's actual
 * rectangle rather than the infinite plane through it, and every leg of the reconstructed path has to be
 * clear of every other box in the scene.
 */
export function computeImageSourceArrivals(
  scene: RoomScene,
  maximumOrder: number,
  speedOfSoundMetersPerSecond: number,
  maximumDistanceMeters: number,
): DiscreteArrival[] {
  if (maximumOrder < 1) return [];

  const faces = collectReflectingFaces(scene.boxes);
  const boxBounds = scene.boxes.map(toAxisAlignedBox);
  const arrivals: DiscreteArrival[] = [];

  const extendPath = (pathFaces: ReflectingFace[], images: Vector3[]): void => {
    for (const face of faces) {
      // A path can't reflect off the same plane twice in a row — the second bounce would have to travel back
      // through the surface it just left.
      if (pathFaces.length > 0 && pathFaces[pathFaces.length - 1] === face) continue;

      const nextImages = [...images, mirrorAcrossFace(images[images.length - 1], face)];
      const nextFaces = [...pathFaces, face];

      const arrival = buildArrivalForPath(scene, nextFaces, nextImages, boxBounds, speedOfSoundMetersPerSecond, maximumDistanceMeters);
      if (arrival !== null) arrivals.push(arrival);

      if (nextFaces.length < maximumOrder) extendPath(nextFaces, nextImages);
    }
  };

  extendPath([], [scene.source]);
  return arrivals;
}
