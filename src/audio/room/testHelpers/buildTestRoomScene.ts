import type { RoomBox, RoomListener, RoomScene, RoomSource } from '../roomTypes';
import { OMNIDIRECTIONAL_DIRECTIVITY } from '../sourceDirectivity';

/** A plain omnidirectional source facing +x. Tests that aren't about directivity get the simplest possible
    radiator, so a change in the default directivity can't quietly move their results. */
export function buildTestSource(overrides: Partial<RoomSource> = {}): RoomSource {
  return { x: 0, y: 0, z: 0, yawDegrees: 0, directivity: OMNIDIRECTIONAL_DIRECTIVITY, ...overrides };
}

/** Defaults to a mono listener: one omnidirectional capsule with no head between the ears, which keeps the
    two channels identical and lets a test assert about energy without the binaural model's arrival-time and
    shadowing differences in the way. Tests about hearing pass `mode: 'binaural'` explicitly. */
export function buildTestListener(overrides: Partial<RoomListener> = {}): RoomListener {
  return { x: 0, y: 0, z: 0, yawDegrees: 0, mode: 'mono', ...overrides };
}

export function buildTestScene(scene: { boxes?: RoomBox[]; source?: Partial<RoomSource>; listener?: Partial<RoomListener> }): RoomScene {
  return {
    boxes: scene.boxes ?? [],
    source: buildTestSource(scene.source),
    listener: buildTestListener(scene.listener),
  };
}
