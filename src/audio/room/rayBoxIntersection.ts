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

/** How many numbers one box occupies in a packed bounds array: minX, minY, minZ, maxX, maxY, maxZ. */
export const BOUNDS_STRIDE = 6;

/**
 * Where an intersection routine writes its result, instead of returning a new object.
 *
 * A simulation runs millions of ray/box tests, and at that rate allocating even one small object per test is
 * a substantial share of the total cost — the old implementation built an array of three objects, each with a
 * nested normal vector, on every single call. Reusing one of these across a whole trace removes all of it.
 *
 * The surface normal comes back as an axis (0, 1 or 2) and a sign rather than a vector, because that is both
 * cheaper to produce and cheaper to use: reflecting off an axis-aligned face only touches one component.
 */
export interface RayBoxHit {
  distance: number;
  normalAxis: 0 | 1 | 2;
  normalSign: number;
}

export function createRayBoxHit(): RayBoxHit {
  return { distance: 0, normalAxis: 0, normalSign: 1 };
}

/**
 * Ray/axis-aligned-box intersection via the slab method: for each axis, the ray enters and exits an infinite
 * slab between the box's min/max on that axis; the box is hit only where all three axes' entry/exit intervals
 * overlap. Normally the reported hit is the *entry* into the box (the largest per-axis entry distance, with
 * the outward-facing normal of whichever axis produced it) — the box is being approached from outside, as a
 * solid obstacle.
 *
 * `hitFromInside` lets a box double as a room's enclosing shell: a ray whose origin is already inside it (or
 * exactly on its surface) reports the *exit* instead — the point where it would leave, with the normal facing
 * back inward. Without that, a source placed inside one big box would fire rays straight through a box they
 * never "entered" from outside, and the room would have no walls.
 *
 * Reads the box's bounds straight out of a packed array (see `BOUNDS_STRIDE`) and writes its answer into
 * `hit`, so the whole test runs without touching the heap. Returns whether there was one at all.
 */
export function intersectRayWithPackedBounds(
  originX: number,
  originY: number,
  originZ: number,
  directionX: number,
  directionY: number,
  directionZ: number,
  bounds: Float64Array,
  boundsOffset: number,
  hitFromInside: boolean,
  hit: RayBoxHit,
): boolean {
  let entryDistance = -Infinity;
  let exitDistance = Infinity;
  let entryAxis: 0 | 1 | 2 = 0;
  let exitAxis: 0 | 1 | 2 = 0;
  let hasEntryAxis = false;
  let hasExitAxis = false;

  for (let axis: 0 | 1 | 2 = 0; axis < 3; axis = (axis + 1) as 0 | 1 | 2) {
    const origin = axis === 0 ? originX : axis === 1 ? originY : originZ;
    const direction = axis === 0 ? directionX : axis === 1 ? directionY : directionZ;
    const minimum = bounds[boundsOffset + axis];
    const maximum = bounds[boundsOffset + 3 + axis];

    if (direction < PARALLEL_EPSILON && direction > -PARALLEL_EPSILON) {
      // Travelling parallel to this pair of faces: either always between them, or never touching the box.
      if (origin < minimum || origin > maximum) return false;
      continue;
    }

    const inverseDirection = 1 / direction;
    const enteringFromMin = direction > 0;
    const nearDistance = ((enteringFromMin ? minimum : maximum) - origin) * inverseDirection;
    const farDistance = ((enteringFromMin ? maximum : minimum) - origin) * inverseDirection;

    if (nearDistance > entryDistance) {
      entryDistance = nearDistance;
      entryAxis = axis;
      hasEntryAxis = true;
    }
    if (farDistance < exitDistance) {
      exitDistance = farDistance;
      exitAxis = axis;
      hasExitAxis = true;
    }
    if (entryDistance > exitDistance) return false;
  }

  // The face an axis contributes always faces back along the ray, whether it is the one being entered
  // through or — by the symmetry between a box's opposite faces — the one being left through. So the normal's
  // sign is just the opposite of the ray's direction on that axis.
  const reportedAxis = hitFromInside && entryDistance < MINIMUM_HIT_DISTANCE ? exitAxis : entryAxis;
  const directionOnReportedAxis = reportedAxis === 0 ? directionX : reportedAxis === 1 ? directionY : directionZ;

  if (hitFromInside && entryDistance < MINIMUM_HIT_DISTANCE) {
    if (!hasExitAxis || exitDistance < MINIMUM_HIT_DISTANCE) return false;
    hit.distance = exitDistance;
    hit.normalAxis = exitAxis;
    hit.normalSign = directionOnReportedAxis > 0 ? -1 : 1;
    return true;
  }

  if (!hasEntryAxis || entryDistance < MINIMUM_HIT_DISTANCE) return false;
  hit.distance = entryDistance;
  hit.normalAxis = entryAxis;
  hit.normalSign = directionOnReportedAxis > 0 ? -1 : 1;
  return true;
}

/** Whether any box in `bounds` blocks the ray before `maximumDistance`. Answers only yes or no, so it can
    stop at the first blocker and never needs a normal — the question every occlusion test actually asks. */
export function isBlockedByPackedBounds(
  originX: number,
  originY: number,
  originZ: number,
  directionX: number,
  directionY: number,
  directionZ: number,
  maximumDistance: number,
  bounds: Float64Array,
  hit: RayBoxHit,
): boolean {
  for (let boundsOffset = 0; boundsOffset < bounds.length; boundsOffset += BOUNDS_STRIDE) {
    if (
      intersectRayWithPackedBounds(originX, originY, originZ, directionX, directionY, directionZ, bounds, boundsOffset, false, hit) &&
      hit.distance < maximumDistance
    ) {
      return true;
    }
  }
  return false;
}

const AXIS_UNIT_VECTORS: Vector3[] = [
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: 0, z: 1 },
];

export function normalVectorOf(hit: RayBoxHit): Vector3 {
  const axis = AXIS_UNIT_VECTORS[hit.normalAxis];
  // The `+ 0` normalizes a `-0` result back to `0` — identical numerically, but it keeps a signed zero out of
  // strict equality checks on the returned normal elsewhere.
  return { x: axis.x * hit.normalSign + 0, y: axis.y * hit.normalSign + 0, z: axis.z * hit.normalSign + 0 };
}

export interface BoxIntersectionOptions {
  /** See `intersectRayWithPackedBounds` — off by default, so occlusion tests and a ray approaching a box it
      is genuinely outside of behave as a solid obstacle. */
  hitFromInside?: boolean;
}

/** The convenient object-shaped form of the same test, for the callers that run once per surface rather than
    millions of times per simulation (`imageSources.ts`, and this module's own tests). */
export function intersectRayWithBox(ray: Ray, box: AxisAlignedBox, options: BoxIntersectionOptions = {}): BoxIntersection | null {
  const bounds = Float64Array.of(box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ);
  const hit = createRayBoxHit();
  const wasHit = intersectRayWithPackedBounds(
    ray.origin.x,
    ray.origin.y,
    ray.origin.z,
    ray.direction.x,
    ray.direction.y,
    ray.direction.z,
    bounds,
    0,
    options.hitFromInside === true,
    hit,
  );

  return wasHit ? { distance: hit.distance, normal: normalVectorOf(hit) } : null;
}
