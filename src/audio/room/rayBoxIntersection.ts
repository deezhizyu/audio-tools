import type { Vector3 } from './vector3';

export interface Ray {
  origin: Vector3;
  direction: Vector3;
}

export interface AxisAlignedBox {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface BoxIntersection {
  distance: number;
  normal: Vector3;
}

const PARALLEL_EPSILON = 1e-9;
const MINIMUM_HIT_DISTANCE = 1e-6;

interface AxisSlab {
  origin: number;
  direction: number;
  min: number;
  max: number;
  normalWhenHit: Vector3;
}

/** Ray/axis-aligned-box intersection via the slab method: for each axis, the ray enters and exits an infinite
    slab between the box's min/max on that axis; the box is hit only where all three axes' entry/exit intervals
    overlap, and the largest entry time across axes is both the hit distance and identifies which face was hit
    (its axis is whichever slab produced that entry time). */
export function intersectRayWithBox(ray: Ray, box: AxisAlignedBox): BoxIntersection | null {
  const slabs: AxisSlab[] = [
    { origin: ray.origin.x, direction: ray.direction.x, min: box.minX, max: box.maxX, normalWhenHit: { x: -1, y: 0, z: 0 } },
    { origin: ray.origin.y, direction: ray.direction.y, min: box.minY, max: box.maxY, normalWhenHit: { x: 0, y: -1, z: 0 } },
    { origin: ray.origin.z, direction: ray.direction.z, min: box.minZ, max: box.maxZ, normalWhenHit: { x: 0, y: 0, z: -1 } },
  ];

  let entryDistance = -Infinity;
  let exitDistance = Infinity;
  let hitNormal: Vector3 | null = null;

  for (const slab of slabs) {
    if (Math.abs(slab.direction) < PARALLEL_EPSILON) {
      if (slab.origin < slab.min || slab.origin > slab.max) return null;
      continue;
    }

    const enteringFromMin = slab.direction > 0;
    const inverseDirection = 1 / slab.direction;
    const nearDistance = ((enteringFromMin ? slab.min : slab.max) - slab.origin) * inverseDirection;
    const farDistance = ((enteringFromMin ? slab.max : slab.min) - slab.origin) * inverseDirection;

    if (nearDistance > entryDistance) {
      entryDistance = nearDistance;
      hitNormal = enteringFromMin ? slab.normalWhenHit : scaleNormal(slab.normalWhenHit, -1);
    }
    exitDistance = Math.min(exitDistance, farDistance);
    if (entryDistance > exitDistance) return null;
  }

  if (hitNormal === null || entryDistance < MINIMUM_HIT_DISTANCE) return null;
  return { distance: entryDistance, normal: hitNormal };
}

/** The `+ 0` normalizes a `-0` result (e.g. `0 * -1`) back to `0` — mathematically identical, but avoids a
    signed-zero component tripping up strict equality checks on the returned normal elsewhere. */
function scaleNormal(normal: Vector3, scale: number): Vector3 {
  return { x: normal.x * scale + 0, y: normal.y * scale + 0, z: normal.z * scale + 0 };
}
