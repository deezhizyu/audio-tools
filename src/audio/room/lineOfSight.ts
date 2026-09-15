import { createRayBoxHit, isBlockedByPackedBounds, type RayBoxHit } from './rayBoxIntersection';
import type { Vector3 } from './vector3';

/** Slack on the segment's own length, so a segment that ends exactly on a box's surface (a reflection point,
    or a listener standing against a wall) isn't reported as blocked by that very surface. */
const OCCLUSION_EPSILON_METERS = 1e-6;

/**
 * Whether a straight line of the given length, starting at `from` and heading along the unit vector
 * `direction`, reaches its far end without passing through any box. Used for three different things that are
 * all the same question: the shadow ray of a next-event-estimation reflection contribution
 * (`traceRays.ts`), each leg of a candidate specular path (`imageSources.ts`), and the direct
 * source-to-listener path (`directSound.ts`).
 *
 * Deliberately tests boxes from the outside only (no `hitFromInside`): a segment whose endpoints both sit
 * *inside* a box — the ordinary case when one big box is being used as a room's enclosing shell — is not
 * obstructed by that shell, and treating it as such would silence every path in such a room.
 *
 * `scratchHit` is somewhere for the intersection test to put its answer. Callers on the hot path pass one
 * they reuse for the whole simulation rather than letting each test allocate.
 */
export function isSegmentUnobstructed(
  from: Vector3,
  direction: Vector3,
  distanceMeters: number,
  boxBounds: Float64Array,
  scratchHit: RayBoxHit = createRayBoxHit(),
): boolean {
  return !isBlockedByPackedBounds(
    from.x,
    from.y,
    from.z,
    direction.x,
    direction.y,
    direction.z,
    distanceMeters - OCCLUSION_EPSILON_METERS,
    boxBounds,
    scratchHit,
  );
}
