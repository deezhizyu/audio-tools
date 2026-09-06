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
    receiverRadiusMeters: 0.5,
    minimumEnergyThreshold: 1e-4,
    maximumDistanceMeters: 200,
    scatterAmount: 0.15,
    randomSource: FIXED_RANDOM_SOURCE,
    ...overrides,
  };
}

function buildBox(kind: RoomBox['kind']): RoomBox {
  return { id: 'box-1', kind, x: -1, y: -1, z: -1, width: 2, height: 2, depth: 2, absorption: { low: 0.1, mid: 0.1, high: 0.1 } };
}

describe('traceRays', () => {
  test('arrival time reflects the speed of sound over the actual distance traveled', () => {
    const scene: RoomScene = { boxes: [buildBox('wall')], source: { x: 5, y: 0, z: 0 }, listener: { x: 2, y: 0, z: 0 } };
    const arrivals = traceRays(scene, buildParams());

    expect(arrivals).toHaveLength(1);
    // Straight line from source (x=5) through the listener (x=2) to the wall hit at x=1: 3 meters traveled.
    expect(arrivals[0].timeSeconds).toBeCloseTo(3 / 343, 5);
  });

  test('a wall keeps the ray alive after a bounce, an absorber ends it immediately', () => {
    // Listener sits behind the source, reachable only by the ray reflecting straight back off the wall/absorber.
    const scene: RoomScene = { boxes: [buildBox('wall')], source: { x: 5, y: 0, z: 0 }, listener: { x: 8, y: 0, z: 0 } };
    const paramsAllowingOneBounce = buildParams({ maximumBounces: 2 });

    const wallArrivals = traceRays(scene, paramsAllowingOneBounce);
    expect(wallArrivals).toHaveLength(1);
    // Total path length source(5) -> wall hit(1) -> listener(8) = 4 + 7 = 11 meters.
    expect(wallArrivals[0].timeSeconds).toBeCloseTo(11 / 343, 5);

    const absorberScene: RoomScene = { ...scene, boxes: [buildBox('absorber')] };
    const absorberArrivals = traceRays(absorberScene, paramsAllowingOneBounce);
    expect(absorberArrivals).toHaveLength(0);
  });

  test('produces no arrivals when nothing is within the receiver radius', () => {
    const scene: RoomScene = { boxes: [buildBox('wall')], source: { x: 5, y: 0, z: 0 }, listener: { x: 2, y: 20, z: 0 } };
    const arrivals = traceRays(scene, buildParams());
    expect(arrivals).toHaveLength(0);
  });
});
