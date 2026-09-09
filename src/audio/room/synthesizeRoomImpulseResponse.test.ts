import { describe, expect, test } from 'vitest';
import { synthesizeRoomImpulseResponse } from './synthesizeRoomImpulseResponse';
import { traceRays, type RayTracingParams } from './traceRays';
import type { RoomBox, RoomScene } from './roomTypes';

/** Always returns 0.5: every ray direction resolves the same way (see `traceRays.test.ts`), and — just as
    usefully here — every "random" noise sample resolves to exactly 0 (`0.5 * 2 - 1`), so the late-reverb
    noise tail contributes nothing and can't interfere with assertions about the discrete-impulse components. */
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
  test('an early reflection lands as an exact discrete impulse, not smeared noise', () => {
    // Same geometry as traceRays.test.ts's basic bounce case: source(5,0,0) -> object hit(1,0,0) -> listener(8,0,0),
    // an 11m path arriving at ~32ms — well before the 80ms early/late transition.
    const scene: RoomScene = { boxes: [buildObjectBox()], source: { x: 5, y: 0, z: 0 }, listener: { x: 8, y: 0, z: 0 } };
    const params = buildParams();

    const [expectedArrival] = traceRays(scene, params);
    expect(expectedArrival).toBeDefined();
    const expectedAmplitude = Math.sqrt(expectedArrival.energy.low) + Math.sqrt(expectedArrival.energy.mid) + Math.sqrt(expectedArrival.energy.high);
    const expectedSampleIndex = Math.round(expectedArrival.timeSeconds * SAMPLE_RATE);

    const impulseResponse = synthesizeRoomImpulseResponse(scene, SAMPLE_RATE, params);

    // Direct sound (3m, unoccluded) lands at a different sample and is the only other nonzero value expected.
    const directSampleIndex = Math.round((3 / SPEED_OF_SOUND) * SAMPLE_RATE);
    expect(expectedSampleIndex).not.toBe(directSampleIndex);

    expect(impulseResponse[expectedSampleIndex]).toBeCloseTo(expectedAmplitude);
    for (let sampleIndex = 0; sampleIndex < impulseResponse.length; sampleIndex++) {
      if (sampleIndex === expectedSampleIndex || sampleIndex === directSampleIndex) continue;
      expect(impulseResponse[sampleIndex]).toBe(0);
    }
  });

  test('a late reflection is absent from the discrete-impulse output entirely (it feeds the noise tail instead)', () => {
    // Pushed far enough out (source -> hit ~53m, hit -> listener ~56m) that the ~318ms arrival falls well past
    // the 80ms transition. With the fixed random source producing exactly zero noise, the late histogram tail
    // contributes silence too, so this reflection should leave no trace anywhere in the buffer.
    const farObject = buildObjectBox({ x: -50, width: 2 });
    const scene: RoomScene = { boxes: [farObject], source: { x: 5, y: 0, z: 0 }, listener: { x: 8, y: 0, z: 0 } };
    const params = buildParams();

    const [lateArrival] = traceRays(scene, params);
    expect(lateArrival.timeSeconds).toBeGreaterThan(0.08);

    const impulseResponse = synthesizeRoomImpulseResponse(scene, SAMPLE_RATE, params);
    const lateSampleIndex = Math.round(lateArrival.timeSeconds * SAMPLE_RATE);
    expect(impulseResponse[lateSampleIndex]).toBe(0);
  });
});
