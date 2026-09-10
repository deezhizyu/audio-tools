import { intersectRayWithBox } from './rayBoxIntersection';
import { toAxisAlignedBox } from './roomBoxGeometry';
import type { RoomScene } from './roomTypes';
import { horizontalPanPosition } from './stereoPanning';
import { distanceBetweenPoints, normalizeVector } from './vector3';

export interface DirectSoundPath {
  distanceMeters: number;
  isOccluded: boolean;
  /** The source's left/right position as heard from the listener (-1 fully left, +1 fully right, 0 centered)
      — see `horizontalPanPosition` in `stereoPanning.ts`. */
  panPosition: number;
}

const OCCLUSION_EPSILON_METERS = 1e-6;

/** The straight-line source-to-listener path, computed in closed form rather than relying on the stochastic
    rays to happen to find it — with a finite ray count there's no guarantee a random ray travels exactly along
    that line, but the direct sound is the loudest, most perceptually important part of the impulse response. */
export function computeDirectSoundPath(scene: RoomScene): DirectSoundPath {
  const distanceMeters = distanceBetweenPoints(scene.source, scene.listener);
  if (distanceMeters < OCCLUSION_EPSILON_METERS) return { distanceMeters, isOccluded: false, panPosition: 0 };

  const direction = normalizeVector({
    x: scene.listener.x - scene.source.x,
    y: scene.listener.y - scene.source.y,
    z: scene.listener.z - scene.source.z,
  });

  const isOccluded = scene.boxes.some(box => {
    const hit = intersectRayWithBox({ origin: scene.source, direction }, toAxisAlignedBox(box));
    return hit !== null && hit.distance < distanceMeters - OCCLUSION_EPSILON_METERS;
  });

  // The source is heard from the listener along the reverse of `direction` (which points listener-ward).
  const panPosition = horizontalPanPosition({ x: -direction.x, y: -direction.y, z: -direction.z });

  return { distanceMeters, isOccluded, panPosition };
}
