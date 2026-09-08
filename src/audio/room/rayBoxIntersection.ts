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

export interface BoxIntersectionOptions {
  /** When the ray's origin is already inside the box (or exactly on its surface), report the exit hit — the
      point where the ray would leave the box, with the normal facing back inward — instead of treating it as
      no hit at all. This is what makes a single box usable as a room's enclosing shell: a ray traced from a
      source placed inside it needs to bounce off the box's *inner* surface, not pass straight through a box
      it never "entered" from outside. Off by default so every other caller (occlusion tests, and a ray
      approaching a box it's genuinely outside of) keeps today's behavior unchanged. */
  hitFromInside?: boolean;
}

/** Ray/axis-aligned-box intersection via the slab method: for each axis, the ray enters and exits an infinite
    slab between the box's min/max on that axis; the box is hit only where all three axes' entry/exit intervals
    overlap. Normally the reported hit is the *entry* into the box (the largest per-axis entry distance, with
    the outward-facing normal of whichever axis produced it) — the box is being approached from outside, as a
    solid obstacle. With `hitFromInside`, a ray whose origin is already inside the box instead reports the
    *exit* (the smallest per-axis exit distance), with the normal flipped to face back into the box — see
    `BoxIntersectionOptions`. */
export function intersectRayWithBox(ray: Ray, box: AxisAlignedBox, options: BoxIntersectionOptions = {}): BoxIntersection | null {
  const slabs: AxisSlab[] = [
    { origin: ray.origin.x, direction: ray.direction.x, min: box.minX, max: box.maxX, normalWhenHit: { x: -1, y: 0, z: 0 } },
    { origin: ray.origin.y, direction: ray.direction.y, min: box.minY, max: box.maxY, normalWhenHit: { x: 0, y: -1, z: 0 } },
    { origin: ray.origin.z, direction: ray.direction.z, min: box.minZ, max: box.maxZ, normalWhenHit: { x: 0, y: 0, z: -1 } },
  ];

  let entryDistance = -Infinity;
  let exitDistance = Infinity;
  let entryNormal: Vector3 | null = null;
  let exitNormal: Vector3 | null = null;

  for (const slab of slabs) {
    if (Math.abs(slab.direction) < PARALLEL_EPSILON) {
      if (slab.origin < slab.min || slab.origin > slab.max) return null;
      continue;
    }

    const enteringFromMin = slab.direction > 0;
    const inverseDirection = 1 / slab.direction;
    const nearDistance = ((enteringFromMin ? slab.min : slab.max) - slab.origin) * inverseDirection;
    const farDistance = ((enteringFromMin ? slab.max : slab.min) - slab.origin) * inverseDirection;
    // The near face's outward normal — also, by the same symmetry that makes the near and far faces of a box
    // opposite one another, the *inward*-facing normal of whichever face this axis contributes as the exit.
    const axisNormal = enteringFromMin ? slab.normalWhenHit : scaleNormal(slab.normalWhenHit, -1);

    if (nearDistance > entryDistance) {
      entryDistance = nearDistance;
      entryNormal = axisNormal;
    }
    if (farDistance < exitDistance) {
      exitDistance = farDistance;
      exitNormal = axisNormal;
    }
    if (entryDistance > exitDistance) return null;
  }

  if (options.hitFromInside && entryDistance < MINIMUM_HIT_DISTANCE) {
    if (exitNormal === null || exitDistance < MINIMUM_HIT_DISTANCE) return null;
    return { distance: exitDistance, normal: exitNormal };
  }

  if (entryNormal === null || entryDistance < MINIMUM_HIT_DISTANCE) return null;
  return { distance: entryDistance, normal: entryNormal };
}

/** The `+ 0` normalizes a `-0` result (e.g. `0 * -1`) back to `0` — mathematically identical, but avoids a
    signed-zero component tripping up strict equality checks on the returned normal elsewhere. */
function scaleNormal(normal: Vector3, scale: number): Vector3 {
  return { x: normal.x * scale + 0, y: normal.y * scale + 0, z: normal.z * scale + 0 };
}
