import { normalizeVector, type Vector3 } from './vector3';

export interface StereoPanWeights {
  left: number;
  right: number;
}

/** The left/right component of a direction (-1 fully left, +1 fully right, 0 centered), discarding height —
    mirrors Steam Audio's own stereo panning effect (`PanningEffect::stereoPanningWeight` in
    `panning_effect.cpp`), which projects onto this same x/z plane before panning since elevation doesn't move
    a sound between two stereo speakers. */
export function horizontalPanPosition(directionFromListener: Vector3): number {
  return normalizeVector({ x: directionFromListener.x, y: 0, z: directionFromListener.z }).x;
}

/** Constant-power stereo pan law, ported directly from Steam Audio's `PanningEffect::stereoPanningWeight`:
    the normalized left/right position is remapped onto a quarter turn of a cosine/sine crossfade, so
    `left² + right²` stays 1 at every pan position instead of the perceived loudness dipping in the center the
    way a straight linear crossfade would. */
export function stereoPanWeightsFromPosition(panPosition: number): StereoPanWeights {
  const quarterTurnAngle = (panPosition + 1) * (Math.PI / 4);
  return { left: Math.cos(quarterTurnAngle), right: Math.sin(quarterTurnAngle) };
}
