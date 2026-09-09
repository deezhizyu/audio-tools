import { describe, expect, test } from 'vitest';
import { computeDirectSoundPath } from './directSound';
import type { RoomBox, RoomScene } from './roomTypes';

function buildObjectBox(x: number): RoomBox {
  return {
    id: 'object',
    kind: 'object',
    x,
    y: -1,
    z: -1,
    width: 0.5,
    height: 2,
    depth: 2,
    absorption: { low: 0.1, mid: 0.1, high: 0.1 },
    materialId: 'generic-object',
    textureIntensity: 1,
  };
}

describe('computeDirectSoundPath', () => {
  test('reports the straight-line distance when nothing blocks the path', () => {
    const scene: RoomScene = { boxes: [], source: { x: 0, y: 0, z: 0 }, listener: { x: 3, y: 4, z: 0 } };
    const path = computeDirectSoundPath(scene);
    expect(path.distanceMeters).toBeCloseTo(5);
    expect(path.isOccluded).toBe(false);
  });

  test('is occluded by an object standing between source and listener', () => {
    const scene: RoomScene = { boxes: [buildObjectBox(2)], source: { x: 0, y: 0, z: 0 }, listener: { x: 5, y: 0, z: 0 } };
    expect(computeDirectSoundPath(scene).isOccluded).toBe(true);
  });

  test('is not occluded by an object behind the listener', () => {
    const scene: RoomScene = { boxes: [buildObjectBox(10)], source: { x: 0, y: 0, z: 0 }, listener: { x: 5, y: 0, z: 0 } };
    expect(computeDirectSoundPath(scene).isOccluded).toBe(false);
  });

  test('treats a source and listener at the same point as unoccluded with zero distance', () => {
    const scene: RoomScene = { boxes: [buildObjectBox(0)], source: { x: 1, y: 1, z: 1 }, listener: { x: 1, y: 1, z: 1 } };
    const path = computeDirectSoundPath(scene);
    expect(path.distanceMeters).toBe(0);
    expect(path.isOccluded).toBe(false);
  });
});
