import { describe, expect, test } from 'vitest';
import { parseRoomScene, serializeRoomScene } from './roomFileFormat';
import type { RoomScene } from './roomTypes';

function buildScene(): RoomScene {
  return {
    boxes: [{ id: 'wall-1', kind: 'wall', x: 0, y: 0, z: 0, width: 4, height: 2.5, depth: 0.2, absorption: { low: 0.1, mid: 0.1, high: 0.15 } }],
    source: { x: 1, y: 1, z: 1 },
    listener: { x: 2, y: 1, z: 2 },
  };
}

describe('room file format', () => {
  test('round-trips a scene through serialize and parse', () => {
    const scene = buildScene();
    expect(parseRoomScene(serializeRoomScene(scene))).toEqual(scene);
  });

  test('rejects text that is not JSON', () => {
    expect(() => parseRoomScene('not json')).toThrow();
  });

  test('rejects JSON that is not a room file', () => {
    expect(() => parseRoomScene(JSON.stringify({ hello: 'world' }))).toThrow();
  });

  test('rejects a scene with a malformed box', () => {
    const malformed = { formatVersion: 1, scene: { boxes: [{ id: 'x' }], source: { x: 0, y: 0, z: 0 }, listener: { x: 0, y: 0, z: 0 } } };
    expect(() => parseRoomScene(JSON.stringify(malformed))).toThrow();
  });

  test('rejects an unknown box kind', () => {
    const scene = buildScene();
    // @ts-expect-error deliberately invalid for the test
    scene.boxes[0].kind = 'ceiling';
    expect(() => parseRoomScene(JSON.stringify({ formatVersion: 1, scene }))).toThrow();
  });
});
