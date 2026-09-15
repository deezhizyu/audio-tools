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

/** Two unit vectors perpendicular to `normal` and to each other — a local frame to build directions in.
    Duff et al.'s branchless construction, which stays numerically stable for a normal pointing in any
    direction, including straight down the axes where the naive "cross with an arbitrary vector" approach
    degenerates. */
export function buildOrthonormalBasis(normal: Vector3): { tangent: Vector3; bitangent: Vector3 } {
  const sign = normal.z >= 0 ? 1 : -1;
  const a = -1 / (sign + normal.z);
  const b = normal.x * normal.y * a;
  return {
    tangent: { x: 1 + sign * normal.x * normal.x * a, y: sign * b, z: -sign * normal.x },
    bitangent: { x: b, y: sign + normal.y * normal.y * a, z: -normal.y },
  };
}

/** A random direction in the hemisphere `normal` points into, distributed proportionally to the cosine of
    the angle from the normal — the distribution a Lambertian (perfectly diffusing) surface actually scatters
    into, and the one the diffuse lobe in `traceRays.ts` is paired with. Sampling the hemisphere *uniformly*
    instead, as this used to, sends far too many bounces off at grazing angles: a uniform sample carries the
    same weight whether it leaves along the normal or skims the surface, where a real diffuse reflector sends
    almost nothing along the surface. In a room that biases reflected energy toward long, wall-skimming paths
    and away from the short cross-room ones, which both lengthens and thins the tail.

    Malley's method: a point drawn uniformly on the unit disc, lifted onto the hemisphere above it, is exactly
    cosine-distributed — no rejection sampling and no trigonometric inversion. */
export function randomCosineWeightedHemisphereVector(normal: Vector3, randomSource: () => number): Vector3 {
  const radius = Math.sqrt(randomSource());
  const azimuth = randomSource() * 2 * Math.PI;
  const alongTangent = radius * Math.cos(azimuth);
  const alongBitangent = radius * Math.sin(azimuth);
  const alongNormal = Math.sqrt(Math.max(0, 1 - radius * radius));

  const { tangent, bitangent } = buildOrthonormalBasis(normal);
  return {
    x: tangent.x * alongTangent + bitangent.x * alongBitangent + normal.x * alongNormal,
    y: tangent.y * alongTangent + bitangent.y * alongBitangent + normal.y * alongNormal,
    z: tangent.z * alongTangent + bitangent.z * alongBitangent + normal.z * alongNormal,
  };
}
