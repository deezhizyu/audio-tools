import { describe, expect, test } from 'vitest';
import { traceRays, type RayTracingParams } from './traceRays';
import type { RoomBox, RoomScene } from './roomTypes';

/** Always returns 0.5, so every `randomUnitVector` call in `traceRays.ts` resolves to the same direction
    (approximately -x) and every test run is fully deterministic. */
const FIXED_RANDOM_SOURCE = () => 0.5;

function buildParams(overrides: Partial<RayTracingParams> = {}): RayTracingParams {
  return {
    numberOfRays: 1,
    maximumBounces: 1,
    speedOfSoundMetersPerSecond: 343,
    minimumContributionDistanceMeters: 0.25,
    minimumEnergyThreshold: 1e-4,
    maximumDistanceMeters: 200,
    scatterAmount: 0.15,
    randomSource: FIXED_RANDOM_SOURCE,
    ...overrides,
  };
}

function buildWallBox(overrides: Partial<RoomBox> = {}): RoomBox {
  return {
    id: 'box-1',
    kind: 'wall',
    x: -1,
    y: -1,
    z: -1,
    width: 2,
    height: 2,
    depth: 2,
    absorption: { low: 0.1, mid: 0.1, high: 0.1 },
    ...overrides,
  };
}

describe('traceRays', () => {
  test('a reflection off a wall arrives with the total bounce distance, not the straight-line distance', () => {
    // Ray travels from source (x=5) in -x, hits the wall at x=1, and has a clear shadow-ray path back to the
    // listener behind the source: source -> hit is 4m, hit -> listener is 7m.
    const scene: RoomScene = { boxes: [buildWallBox()], source: { x: 5, y: 0, z: 0 }, listener: { x: 8, y: 0, z: 0 } };
    const arrivals = traceRays(scene, buildParams());

    expect(arrivals).toHaveLength(1);
    expect(arrivals[0].timeSeconds).toBeCloseTo(11 / 343, 5);
  });

  test('an absorber ends the ray immediately, contributing no reflection arrival', () => {
    const scene: RoomScene = { boxes: [buildWallBox({ kind: 'absorber' })], source: { x: 5, y: 0, z: 0 }, listener: { x: 8, y: 0, z: 0 } };
    const arrivals = traceRays(scene, buildParams());
    expect(arrivals).toHaveLength(0);
  });

  test('produces no arrival when a second box blocks the shadow ray from the reflection point to the listener', () => {
    // Wall at x:[-1,1] reflects the ray at x=1. A second wall at x:[6,7] doesn't touch the source-to-hit path
    // (x from 5 down to 1) but sits squarely between the reflection point and the listener at x=10, blocking
    // the next-event-estimation shadow ray.
    const blockingWall = buildWallBox({ x: 6, width: 1 });
    const scene: RoomScene = { boxes: [buildWallBox(), blockingWall], source: { x: 5, y: 0, z: 0 }, listener: { x: 10, y: 0, z: 0 } };
    const arrivals = traceRays(scene, buildParams());
    expect(arrivals).toHaveLength(0);
  });

  test('a single enclosing box works as a room: a ray bounces off its inner surface instead of passing through', () => {
    // Source and listener both sit inside one big box (a 20m room), instead of being surrounded by separate
    // wall slabs. The ray (heading -x) must reflect off the box's inner wall at x=-10 and travel back to the
    // listener — if the box were still only hit-testable from outside, this would report zero arrivals.
    const enclosingRoom = buildWallBox({ x: -10, y: -10, z: -10, width: 20, height: 20, depth: 20 });
    const scene: RoomScene = { boxes: [enclosingRoom], source: { x: 5, y: 0, z: 0 }, listener: { x: 8, y: 0, z: 0 } };
    const arrivals = traceRays(scene, buildParams());

    expect(arrivals).toHaveLength(1);
    // source(5) -> inner wall at x=-10 is 15m, wall -> listener(8) is 18m.
    expect(arrivals[0].timeSeconds).toBeCloseTo(33 / 343, 3);
  });

  test('close source and listener no longer flood the histogram with spurious near-zero-time energy', () => {
    // Regression test for the muffling bug: previously, any ray whose very first segment (before bouncing off
    // anything) passed within a fixed receiver radius of the listener recorded a spurious arrival — so a
    // listener sitting close to the source picked up noise from every ray fired, regardless of where it was
    // headed. Here the only wall is well off the ray's path (it travels along y=0, z=0; the wall sits entirely
    // outside that line), so the ray never hits anything, and a close listener must not change that.
    const farOffAxisWall = buildWallBox({ x: -50, y: 40, z: 40, width: 2, height: 2, depth: 2 });
    const scene: RoomScene = { boxes: [farOffAxisWall], source: { x: 0, y: 0, z: 0 }, listener: { x: 0.1, y: 0, z: 0 } };
    const arrivals = traceRays(scene, buildParams());
    expect(arrivals).toHaveLength(0);
  });
});
