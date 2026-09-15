import { describe, expect, test } from 'vitest';
import { AIR_ABSORPTION_COEFFICIENTS_PER_METER } from './airAbsorption';
import { computeImageSourceArrivals } from './imageSources';
import { getEffectiveScatterAmount } from './roomMaterials';
import type { RoomBox, RoomScene } from './roomTypes';

const SPEED_OF_SOUND = 343;
const MAXIMUM_DISTANCE_METERS = 2000;

function buildSlab(overrides: Partial<RoomBox> = {}): RoomBox {
  return {
    id: 'slab',
    kind: 'object',
    x: -50,
    y: -1,
    z: -50,
    width: 100,
    height: 1,
    depth: 100,
    absorption: { low: 0.2, mid: 0.2, high: 0.2 },
    materialId: 'generic-object',
    textureIntensity: 1,
    ...overrides,
  };
}

/** What a single specular bounce off `box` should deliver over a path of `pathLengthMeters`: what the
    material doesn't absorb, times the part of that which reflects specularly rather than scattering, spread
    by inverse-square and rolled off by air. */
function expectedSingleBounceEnergy(box: RoomBox, pathLengthMeters: number): number {
  const reflectance = (1 - box.absorption.low) * (1 - getEffectiveScatterAmount(box));
  return (reflectance / (pathLengthMeters * pathLengthMeters)) * Math.exp(-AIR_ABSORPTION_COEFFICIENTS_PER_METER.low * pathLengthMeters);
}

describe('computeImageSourceArrivals', () => {
  test('a ground plane produces exactly one first-order echo, at the mirrored path length', () => {
    // Source and listener both 2m above a large flat floor, 4m apart. The reflected path is the straight line
    // from the source's mirror image below the floor: sqrt(4² + 4²) = 5.657m, against 4m direct.
    const floor = buildSlab();
    const scene: RoomScene = { boxes: [floor], source: { x: 0, y: 2, z: 0 }, listener: { x: 4, y: 2, z: 0 } };

    const arrivals = computeImageSourceArrivals(scene, 2, SPEED_OF_SOUND, MAXIMUM_DISTANCE_METERS);

    expect(arrivals).toHaveLength(1);
    const pathLengthMeters = Math.hypot(4, 4);
    expect(arrivals[0].timeSeconds).toBeCloseTo(pathLengthMeters / SPEED_OF_SOUND, 6);
    expect(arrivals[0].energy.low).toBeCloseTo(expectedSingleBounceEnergy(floor, pathLengthMeters), 6);
  });

  test('a surface too small to hold the reflection point produces no echo', () => {
    // The same geometry, but the floor is a tile off to one side. The reflection would have to land at x=2,
    // which is not on the tile — an infinite-plane test would wrongly accept it.
    const tile = buildSlab({ x: 20, z: -2, width: 4, depth: 4 });
    const scene: RoomScene = { boxes: [tile], source: { x: 0, y: 2, z: 0 }, listener: { x: 4, y: 2, z: 0 } };

    expect(computeImageSourceArrivals(scene, 2, SPEED_OF_SOUND, MAXIMUM_DISTANCE_METERS)).toHaveLength(0);
  });

  test('an echo whose path is blocked by another object is rejected', () => {
    // A barrier standing on the floor between the source and the reflection point: the geometry still mirrors,
    // but the sound cannot actually travel that way.
    const floor = buildSlab();
    const barrier = buildSlab({ id: 'barrier', x: 1.8, y: 0, z: -2, width: 0.2, height: 3, depth: 4 });
    const scene: RoomScene = { boxes: [floor, barrier], source: { x: 0, y: 2, z: 0 }, listener: { x: 4, y: 2, z: 0 } };

    const floorEchoTimeSeconds = Math.hypot(4, 4) / SPEED_OF_SOUND;
    const arrivals = computeImageSourceArrivals(scene, 1, SPEED_OF_SOUND, MAXIMUM_DISTANCE_METERS);

    expect(arrivals.every(arrival => Math.abs(arrival.timeSeconds - floorEchoTimeSeconds) > 1e-9)).toBe(true);
  });

  test('two parallel walls produce the second-order echo that bounces off both', () => {
    // Walls at x=0 and x=10 with the source at x=3 and the listener at x=7. Bouncing off the near wall then
    // the far one is a 3 + 10 + 3 = 16m path — the kind of echo that gives a corridor its character, and one
    // no single-surface pass would ever find.
    const nearWall = buildSlab({ id: 'near-wall', x: -1, y: -5, z: -5, width: 1, height: 10, depth: 10 });
    const farWall = buildSlab({ id: 'far-wall', x: 10, y: -5, z: -5, width: 1, height: 10, depth: 10 });
    const scene: RoomScene = { boxes: [nearWall, farWall], source: { x: 3, y: 1, z: 0 }, listener: { x: 7, y: 1, z: 0 } };

    const arrivals = computeImageSourceArrivals(scene, 2, SPEED_OF_SOUND, MAXIMUM_DISTANCE_METERS);
    const doubleBounce = arrivals.find(arrival => Math.abs(arrival.timeSeconds - 16 / SPEED_OF_SOUND) < 1e-9);

    expect(doubleBounce).toBeDefined();
    // Two surfaces' worth of reflectance, not one.
    const reflectance = (1 - nearWall.absorption.low) * (1 - getEffectiveScatterAmount(nearWall));
    expect(doubleBounce!.energy.low).toBeCloseTo((reflectance * reflectance) / (16 * 16) * Math.exp(-AIR_ABSORPTION_COEFFICIENTS_PER_METER.low * 16), 8);
  });

  test('a rougher surface returns a weaker specular echo, because more of its energy scatters instead', () => {
    // The scattered remainder is not lost — it is what the ray tracer's diffuse lobe puts into the reverb
    // tail. This is the split that keeps the two mechanisms from both claiming the same energy.
    const buildSceneWith = (materialId: RoomBox['materialId']): RoomScene => ({
      boxes: [buildSlab({ materialId, absorption: { low: 0.2, mid: 0.2, high: 0.2 } })],
      source: { x: 0, y: 2, z: 0 },
      listener: { x: 4, y: 2, z: 0 },
    });

    const [smoothEcho] = computeImageSourceArrivals(buildSceneWith('smooth-metal'), 1, SPEED_OF_SOUND, MAXIMUM_DISTANCE_METERS);
    const [roughEcho] = computeImageSourceArrivals(buildSceneWith('grass'), 1, SPEED_OF_SOUND, MAXIMUM_DISTANCE_METERS);

    expect(smoothEcho.energy.low).toBeGreaterThan(roughEcho.energy.low);
  });

  test('an absorber blocks a path but never creates an echo of its own', () => {
    const absorbingFloor = buildSlab({ kind: 'absorber', materialId: 'generic-absorber' });
    const scene: RoomScene = { boxes: [absorbingFloor], source: { x: 0, y: 2, z: 0 }, listener: { x: 4, y: 2, z: 0 } };

    expect(computeImageSourceArrivals(scene, 2, SPEED_OF_SOUND, MAXIMUM_DISTANCE_METERS)).toHaveLength(0);
  });

  test('an echo arriving from one side of the listener is panned toward that side', () => {
    // A wall off to the listener's left along the x axis, which is the left/right axis in the editor's top
    // view — so its echo must read as coming from the left.
    const leftWall = buildSlab({ id: 'left-wall', x: -6, y: -5, z: -20, width: 1, height: 10, depth: 40 });
    const scene: RoomScene = { boxes: [leftWall], source: { x: 0, y: 1, z: 2 }, listener: { x: 0, y: 1, z: -2 } };

    const [echo] = computeImageSourceArrivals(scene, 1, SPEED_OF_SOUND, MAXIMUM_DISTANCE_METERS);

    expect(echo).toBeDefined();
    expect(echo.panPosition).toBeLessThan(0);
  });

  test('requesting no reflections returns nothing at all', () => {
    const scene: RoomScene = { boxes: [buildSlab()], source: { x: 0, y: 2, z: 0 }, listener: { x: 4, y: 2, z: 0 } };
    expect(computeImageSourceArrivals(scene, 0, SPEED_OF_SOUND, MAXIMUM_DISTANCE_METERS)).toHaveLength(0);
  });
});
