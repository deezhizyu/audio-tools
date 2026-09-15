import { describe, expect, test } from 'vitest';
import { computeDirectSoundArrival } from './directSound';
import type { RoomBox, RoomScene } from './roomTypes';
import { buildTestScene } from './testHelpers/buildTestRoomScene';

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

const SPEED_OF_SOUND = 343;

function computeArrival(scene: RoomScene) {
  return computeDirectSoundArrival(scene, SPEED_OF_SOUND);
}

describe('computeDirectSoundArrival', () => {
  test('reports the straight-line travel time when nothing blocks the path', () => {
    const scene: RoomScene = buildTestScene({ boxes: [], source: { x: 0, y: 0, z: 0 }, listener: { x: 3, y: 4, z: 0 } });
    const path = computeArrival(scene);
    expect(path.timeSeconds).toBeCloseTo(5 / SPEED_OF_SOUND);
    // Inverse-square spreading over 5m, lightly rolled off by air absorption.
    expect(path.energy.low).toBeGreaterThan(0);
    expect(path.energy.low).toBeCloseTo(1 / 25, 3);
  });

  test('rolls high frequencies off over distance faster than low ones', () => {
    const nearScene: RoomScene = buildTestScene({ boxes: [], source: { x: 0, y: 0, z: 0 }, listener: { x: 1, y: 0, z: 0 } });
    const farScene: RoomScene = buildTestScene({ boxes: [], source: { x: 0, y: 0, z: 0 }, listener: { x: 60, y: 0, z: 0 } });

    const nearPath = computeArrival(nearScene);
    const farPath = computeArrival(farScene);

    // The high/low ratio cancels the geometric spreading, which applies identically to every band, isolating
    // air absorption's frequency dependence — a distant source must arrive duller, not merely quieter.
    expect(farPath.energy.high / farPath.energy.low).toBeLessThan(nearPath.energy.high / nearPath.energy.low);
  });

  test('a source closer than the minimum contribution distance does not blow up, but is still louder than one further away', () => {
    const veryCloseScene: RoomScene = buildTestScene({ boxes: [], source: { x: 0, y: 0, z: 0 }, listener: { x: 0.05, y: 0, z: 0 } });
    const halfMeterScene: RoomScene = buildTestScene({ boxes: [], source: { x: 0, y: 0, z: 0 }, listener: { x: 0.5, y: 0, z: 0 } });

    expect(Number.isFinite(computeArrival(veryCloseScene).energy.mid)).toBe(true);
    expect(computeArrival(halfMeterScene).energy.mid).toBeLessThan(computeArrival(veryCloseScene).energy.mid);
  });

  test('is occluded by an object standing between source and listener', () => {
    const scene: RoomScene = buildTestScene({ boxes: [buildObjectBox(2)], source: { x: 0, y: 0, z: 0 }, listener: { x: 5, y: 0, z: 0 } });
    const path = computeArrival(scene);
    expect(path.energy.low).toBe(0);
    expect(path.energy.mid).toBe(0);
    expect(path.energy.high).toBe(0);
  });

  test('an obstruction that blocks only part of the path muffles the source instead of silencing it', () => {
    // A narrow post on the line of sight: the straight line is blocked, but paths a little to either side get
    // through. A real listener hears a dulled voice, not silence — and the dulling is frequency dependent,
    // because long wavelengths bend around an obstacle that stops short ones.
    const narrowPost: RoomBox = { ...buildObjectBox(2), width: 0.2, y: -0.2, z: -0.2, height: 0.4, depth: 0.4 };
    const scene: RoomScene = buildTestScene({ boxes: [narrowPost], source: { x: 0, y: 0, z: 0 }, listener: { x: 5, y: 0, z: 0 } });
    const clearScene: RoomScene = buildTestScene({ boxes: [], source: { x: 0, y: 0, z: 0 }, listener: { x: 5, y: 0, z: 0 } });

    const occluded = computeArrival(scene);
    const clear = computeArrival(clearScene);

    expect(occluded.energy.mid).toBeGreaterThan(0);
    expect(occluded.energy.mid).toBeLessThan(clear.energy.mid);
    // Dulled, not merely quieter: the high band loses proportionally more than the low band does.
    expect(occluded.energy.high / clear.energy.high).toBeLessThan(occluded.energy.low / clear.energy.low);
  });

  test('is not occluded by an object behind the listener', () => {
    const scene: RoomScene = buildTestScene({ boxes: [buildObjectBox(10)], source: { x: 0, y: 0, z: 0 }, listener: { x: 5, y: 0, z: 0 } });
    expect(computeArrival(scene).energy.mid).toBeGreaterThan(0);
  });

  test('treats a source and listener at the same point as unoccluded with zero distance', () => {
    const scene: RoomScene = buildTestScene({ boxes: [buildObjectBox(0)], source: { x: 1, y: 1, z: 1 }, listener: { x: 1, y: 1, z: 1 } });
    const path = computeArrival(scene);
    expect(path.timeSeconds).toBe(0);
    expect(path.energy.mid).toBeGreaterThan(0);
  });

  test('reports the direction the sound arrives from, pointing from the listener back toward the source', () => {
    // Not a left/right position but a full direction: the listener's head model needs to know front from back
    // as well as side to side, and which of those a given direction is depends on how the listener is turned.
    const scene: RoomScene = buildTestScene({ boxes: [], source: { x: 5, y: 0, z: 0 }, listener: { x: 0, y: 0, z: 0 } });
    const { directionFromListener } = computeArrival(scene);

    expect(directionFromListener.x).toBeCloseTo(1);
    expect(directionFromListener.y).toBeCloseTo(0);
    expect(directionFromListener.z).toBeCloseTo(0);
  });

  test('a directional source aimed away from the listener sends them less, and duller, than one aimed at them', () => {
    // Turning away from someone changes their direct sound and leaves the room's reverb where it was — the
    // whole reason a source has a facing direction at all.
    const buildAimedScene = (yawDegrees: number): RoomScene =>
      buildTestScene({
        boxes: [],
        source: { x: 0, y: 0, z: 0, yawDegrees, directivity: { enabled: true, weight: 0.5, sharpness: 2 } },
        listener: { x: 5, y: 0, z: 0 },
      });

    const facingListener = computeArrival(buildAimedScene(0));
    const facingAway = computeArrival(buildAimedScene(180));

    expect(facingAway.energy.mid).toBeLessThan(facingListener.energy.mid * 0.1);
  });

  test('an omnidirectional source sends the same energy whichever way it is turned', () => {
    const buildTurnedScene = (yawDegrees: number): RoomScene =>
      buildTestScene({ boxes: [], source: { x: 0, y: 0, z: 0, yawDegrees }, listener: { x: 5, y: 0, z: 0 } });

    expect(computeArrival(buildTurnedScene(180)).energy.mid).toBeCloseTo(computeArrival(buildTurnedScene(0)).energy.mid, 10);
  });
});
