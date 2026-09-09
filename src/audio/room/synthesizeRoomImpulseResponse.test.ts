import { describe, expect, test } from 'vitest';
import { buildEnergyHistogram } from './buildEnergyHistogram';
import { HISTOGRAM_BIN_DURATION_SECONDS, MAXIMUM_IMPULSE_RESPONSE_DURATION_SECONDS } from './roomAcousticsDefaults';
import { synthesizeRoomImpulseResponse } from './synthesizeRoomImpulseResponse';
import { traceRays, type RayTracingParams } from './traceRays';
import type { RoomBox, RoomScene } from './roomTypes';

/** Always returns 0.5: every ray direction resolves the same way (see `traceRays.test.ts`), and — just as
    usefully here — every "random" noise sample resolves to exactly 0 (`0.5 * 2 - 1`), so the noise-based
    reflection synthesis contributes nothing and can't mask assertions about the direct-sound path. */
const FIXED_RANDOM_SOURCE = () => 0.5;
const SAMPLE_RATE = 1000;
const SPEED_OF_SOUND = 343;

function buildParams(overrides: Partial<RayTracingParams> = {}): RayTracingParams {
  return {
    numberOfRays: 1,
    maximumBounces: 1,
    speedOfSoundMetersPerSecond: SPEED_OF_SOUND,
    minimumContributionDistanceMeters: 0.25,
    minimumEnergyThreshold: 1e-4,
    maximumDistanceMeters: 200,
    randomSource: FIXED_RANDOM_SOURCE,
    ...overrides,
  };
}

/** Uses the `generic-object` material, whose `scatterAmount` (0.15) matches what used to be the single global
    `SCATTER_AMOUNT` constant — so with `textureIntensity: 1` (the default), this fixture reproduces the exact
    pre-materials physics these tests were originally written against. */
function buildObjectBox(overrides: Partial<RoomBox> = {}): RoomBox {
  return {
    id: 'box-1',
    kind: 'object',
    x: -1,
    y: -1,
    z: -1,
    width: 2,
    height: 2,
    depth: 2,
    absorption: { low: 0.1, mid: 0.1, high: 0.1 },
    materialId: 'generic-object',
    textureIntensity: 1,
    ...overrides,
  };
}

describe('synthesizeRoomImpulseResponse', () => {
  test('a reflection is no longer stamped as a literal discrete sample — it feeds the noise-based histogram like every other arrival', () => {
    // Same geometry as traceRays.test.ts's basic bounce case: source(5,0,0) -> object hit(1,0,0) -> listener(8,0,0),
    // an 11m path arriving at ~32ms.
    const scene: RoomScene = { boxes: [buildObjectBox()], source: { x: 5, y: 0, z: 0 }, listener: { x: 8, y: 0, z: 0 } };
    const params = buildParams();

    const [reflection] = traceRays(scene, params);
    expect(reflection).toBeDefined();
    const reflectionSampleIndex = Math.round(reflection.timeSeconds * SAMPLE_RATE);

    const impulseResponse = synthesizeRoomImpulseResponse(scene, SAMPLE_RATE, params);

    // With zero-noise randomSource, the reflection contributes silence — it now modulates noise instead of
    // being written as an unconditional literal delta, which is the actual regression check for the fix: the
    // old discrete-stamping path always produced a nonzero sample here regardless of noise.
    expect(impulseResponse[reflectionSampleIndex]).toBe(0);

    // The direct, unreflected path (3m, unoccluded) is a true single impulse (not noise-modulated), so it's
    // unaffected and still shows up exactly.
    const directSampleIndex = Math.round((3 / SPEED_OF_SOUND) * SAMPLE_RATE);
    expect(impulseResponse[directSampleIndex]).toBeCloseTo(1 / 3);
  });

  test('a high-scatter material (grass) is also routed through the histogram, not a special-cased discrete spike', () => {
    const roughObject = buildObjectBox({ materialId: 'grass' });
    const scene: RoomScene = { boxes: [roughObject], source: { x: 5, y: 0, z: 0 }, listener: { x: 8, y: 0, z: 0 } };
    const params = buildParams();

    const [reflection] = traceRays(scene, params);
    expect(reflection).toBeDefined();
    const reflectionSampleIndex = Math.round(reflection.timeSeconds * SAMPLE_RATE);

    const impulseResponse = synthesizeRoomImpulseResponse(scene, SAMPLE_RATE, params);
    expect(impulseResponse[reflectionSampleIndex]).toBe(0);
  });

  test('an early and a late reflection both land in the same time-binned histogram, at their own true arrival time', () => {
    // Near reflection (~32ms, same geometry as above) and a far one (source -> hit ~53m, hit -> listener ~56m,
    // ~318ms) — previously routed through two different representations (a literal early delta vs. a late
    // noise bin); now both are simply energy in the histogram bin matching their own arrival time.
    const params = buildParams();
    const nearScene: RoomScene = { boxes: [buildObjectBox()], source: { x: 5, y: 0, z: 0 }, listener: { x: 8, y: 0, z: 0 } };
    const farScene: RoomScene = { boxes: [buildObjectBox({ x: -50, width: 2 })], source: { x: 5, y: 0, z: 0 }, listener: { x: 8, y: 0, z: 0 } };

    const [nearArrival] = traceRays(nearScene, params);
    const [farArrival] = traceRays(farScene, params);
    expect(nearArrival.timeSeconds).toBeLessThan(0.08);
    expect(farArrival.timeSeconds).toBeGreaterThan(0.08);

    const histogram = buildEnergyHistogram(
      [nearArrival, farArrival],
      params.numberOfRays,
      HISTOGRAM_BIN_DURATION_SECONDS,
      MAXIMUM_IMPULSE_RESPONSE_DURATION_SECONDS,
    );

    expect(histogram.low[Math.floor(nearArrival.timeSeconds / HISTOGRAM_BIN_DURATION_SECONDS)]).toBeGreaterThan(0);
    expect(histogram.low[Math.floor(farArrival.timeSeconds / HISTOGRAM_BIN_DURATION_SECONDS)]).toBeGreaterThan(0);
  });
});
