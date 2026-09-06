export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export function addVectors(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function scaleVector(vector: Vector3, scale: number): Vector3 {
  return { x: vector.x * scale, y: vector.y * scale, z: vector.z * scale };
}

export function dotVectors(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function vectorLength(vector: Vector3): number {
  return Math.sqrt(dotVectors(vector, vector));
}

export function distanceBetweenPoints(a: Vector3, b: Vector3): number {
  return vectorLength({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
}

export function normalizeVector(vector: Vector3): Vector3 {
  const length = vectorLength(vector);
  if (length < 1e-12) return { x: 0, y: 0, z: 0 };
  return scaleVector(vector, 1 / length);
}

export function reflectVector(direction: Vector3, normal: Vector3): Vector3 {
  const incidence = 2 * dotVectors(direction, normal);
  return { x: direction.x - incidence * normal.x, y: direction.y - incidence * normal.y, z: direction.z - incidence * normal.z };
}

/** Uniformly distributed unit vector (Archimedes' hat-box construction: `z` uniform in [-1, 1] and an
    independent uniform azimuth gives a uniform distribution over the sphere's surface). */
export function randomUnitVector(randomSource: () => number): Vector3 {
  const z = randomSource() * 2 - 1;
  const azimuth = randomSource() * 2 * Math.PI;
  const radiusAtHeight = Math.sqrt(Math.max(0, 1 - z * z));
  return { x: radiusAtHeight * Math.cos(azimuth), y: radiusAtHeight * Math.sin(azimuth), z };
}

/** A random unit vector constrained to the hemisphere `normal` points into, for scattering a reflection into a
    plausible diffuse direction rather than through the surface it just bounced off. */
export function randomHemisphereVector(normal: Vector3, randomSource: () => number): Vector3 {
  const candidate = randomUnitVector(randomSource);
  return dotVectors(candidate, normal) < 0 ? scaleVector(candidate, -1) : candidate;
}

/** Closest point to `point` on the segment from `segmentStart` to `segmentEnd`, returned as the fraction along
    the segment (clamped to [0, 1]) rather than the point itself, since callers need that fraction to convert
    back into a travel distance. */
export function closestFractionOnSegment(segmentStart: Vector3, segmentEnd: Vector3, point: Vector3): number {
  const segment = { x: segmentEnd.x - segmentStart.x, y: segmentEnd.y - segmentStart.y, z: segmentEnd.z - segmentStart.z };
  const segmentLengthSquared = dotVectors(segment, segment);
  if (segmentLengthSquared < 1e-12) return 0;

  const toPoint = { x: point.x - segmentStart.x, y: point.y - segmentStart.y, z: point.z - segmentStart.z };
  const fraction = dotVectors(toPoint, segment) / segmentLengthSquared;
  return Math.min(1, Math.max(0, fraction));
}
