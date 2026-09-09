import { describe, expect, test } from 'vitest';
import { parseRoomScene, serializeRoomScene } from './roomFileFormat';
import type { RoomScene } from './roomTypes';

function buildScene(): RoomScene {
  return {
    boxes: [
      {
        id: 'object-1',
        kind: 'object',
        x: 0,
        y: 0,
        z: 0,
        width: 4,
        height: 2.5,
        depth: 0.2,
        absorption: { low: 0.1, mid: 0.1, high: 0.15 },
        materialId: 'generic-object',
        textureIntensity: 1,
      },
    ],
    source: { x: 1, y: 1, z: 1 },
    listener: { x: 2, y: 1, z: 2 },
  };
}

describe('room file format', () => {
  test('round-trips a scene through serialize and parse', () => {
    const scene = buildScene();
    expect(parseRoomScene(serializeRoomScene(scene))).toEqual(scene);
  });

  test('serializes with the current format version', () => {
    const written = JSON.parse(serializeRoomScene(buildScene()));
    expect(written.formatVersion).toBe(2);
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

  test('migrates an old file with kind "wall" and no materialId/textureIntensity into a valid object box', () => {
    const legacyFile = {
      formatVersion: 1,
      scene: {
        boxes: [{ id: 'legacy-wall', kind: 'wall', x: 0, y: 0, z: 0, width: 4, height: 2.5, depth: 0.2, absorption: { low: 0.1, mid: 0.1, high: 0.15 } }],
        source: { x: 0, y: 0, z: 0 },
        listener: { x: 1, y: 0, z: 0 },
      },
    };

    const scene = parseRoomScene(JSON.stringify(legacyFile));
    expect(scene.boxes[0].kind).toBe('object');
    expect(scene.boxes[0].materialId).toBe('generic-object');
    expect(scene.boxes[0].textureIntensity).toBe(1);
  });

  test('migrates a legacy absorber box (no materialId) to the generic absorber material', () => {
    const legacyFile = {
      formatVersion: 1,
      scene: {
        boxes: [{ id: 'legacy-absorber', kind: 'absorber', x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, absorption: { low: 0.9, mid: 0.9, high: 0.9 } }],
        source: { x: 0, y: 0, z: 0 },
        listener: { x: 1, y: 0, z: 0 },
      },
    };

    const scene = parseRoomScene(JSON.stringify(legacyFile));
    expect(scene.boxes[0].materialId).toBe('generic-absorber');
  });

  test('falls back to a default material for an unrecognized materialId instead of throwing', () => {
    const scene = buildScene();
    // @ts-expect-error deliberately invalid for the test
    scene.boxes[0].materialId = 'material-from-the-future';

    const parsed = parseRoomScene(JSON.stringify({ formatVersion: 2, scene }));
    expect(parsed.boxes[0].materialId).toBe('generic-object');
  });

  test('clamps an out-of-range textureIntensity instead of throwing', () => {
    const negative = buildScene();
    negative.boxes[0].textureIntensity = -5;
    expect(parseRoomScene(JSON.stringify({ formatVersion: 2, scene: negative })).boxes[0].textureIntensity).toBe(0);

    const excessive = buildScene();
    excessive.boxes[0].textureIntensity = 99;
    expect(parseRoomScene(JSON.stringify({ formatVersion: 2, scene: excessive })).boxes[0].textureIntensity).toBe(2);
  });
});
