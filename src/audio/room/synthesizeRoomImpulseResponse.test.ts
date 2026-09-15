import { describe, expect, test } from 'vitest';
import { computeDirectSoundArrival } from './directSound';
import { computeImageSourceArrivals } from './imageSources';
import { MAXIMUM_IMAGE_SOURCE_ORDER } from './roomAcousticsDefaults';
import { synthesizeRoomImpulseResponse } from './synthesizeRoomImpulseResponse';
import { DEFAULT_RAY_TRACING_PARAMS, type RayTracingParams } from './traceRays';
import type { RoomBox, RoomScene } from './roomTypes';
import { buildTestScene } from './testHelpers/buildTestRoomScene';

const SAMPLE_RATE = 1000;
const SPEED_OF_SOUND = 343;

/** Always returns 0.5: every ray direction resolves the same way (see `traceRays.test.ts`), and — just as
    usefully here — every "random" noise sample resolves to exactly 0 (`0.5 * 2 - 1`), so the noise-based
    reflection tail contributes nothing and can't mask assertions about the coherent arrivals. */
const FIXED_RANDOM_SOURCE = () => 0.5;

function buildParams(overrides: Partial<RayTracingParams> = {}): RayTracingParams {
  return {
    ...DEFAULT_RAY_TRACING_PARAMS,
    numberOfRays: 1,
    maximumBounces: 1,
    speedOfSoundMetersPerSecond: SPEED_OF_SOUND,
    randomSource: FIXED_RANDOM_SOURCE,
    ...overrides,
  };
}

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

function sumOverWindow(impulseResponse: Float32Array<ArrayBuffer>, startIndex: number, length: number): number {
  return Array.from(impulseResponse.slice(startIndex, startIndex + length)).reduce((sum, sample) => sum + sample, 0);
}

function totalEnergy(impulseResponse: Float32Array<ArrayBuffer>): number {
  return Array.from(impulseResponse).reduce((sum, sample) => sum + sample * sample, 0);
}

describe('synthesizeRoomImpulseResponse', () => {
  test('the direct path lands at its own delay, at the amplitude its energy implies', () => {
    // Source(5,0,0) and listener(8,0,0), 3m apart. Summed over a short window rather than read at one sample:
    // 3m is 8.75 samples at this rate, so the arrival genuinely falls between two samples and the band-split
    // kernel spreads it over a few more.
    const scene: RoomScene = buildTestScene(buildTestScene({ boxes: [], source: { x: 5, y: 0, z: 0 }, listener: { x: 8, y: 0, z: 0 } }));
    const channels = synthesizeRoomImpulseResponse(scene, SAMPLE_RATE, buildParams());

    const directArrival = computeDirectSoundArrival(scene, SPEED_OF_SOUND);
    const windowStart = Math.floor(directArrival.timeSeconds * SAMPLE_RATE) - 8;
    for (const impulseResponse of channels) {
      expect(sumOverWindow(impulseResponse, windowStart, 24)).toBeCloseTo(Math.sqrt(directArrival.energy.low), 3);
    }
  });

  test('a specular reflection off a nearby surface is rendered as a coherent tap at its own arrival time', () => {
    // Source(5,0,0) -> the box's x=1 face -> listener(8,0,0): an 11m path arriving at ~32ms. The image-source
    // pass finds it exactly; the ray tracer deliberately leaves low-order specular paths alone so the same
    // echo is never counted twice.
    const scene: RoomScene = buildTestScene(buildTestScene({ boxes: [buildObjectBox()], source: { x: 5, y: 0, z: 0 }, listener: { x: 8, y: 0, z: 0 } }));
    const params = buildParams();

    const [reflection] = computeImageSourceArrivals(scene, MAXIMUM_IMAGE_SOURCE_ORDER, SPEED_OF_SOUND, params.maximumDistanceMeters);
    expect(reflection).toBeDefined();
    expect(reflection.timeSeconds).toBeCloseTo(11 / SPEED_OF_SOUND, 5);

    // Stereo simulation off here: this geometry's source and listener differ only along the left/right axis,
    // so an enabled stereo simulation would pan everything hard left and break the "identical on every
    // channel" assertion — panning is covered in its own test below.
    const channels = synthesizeRoomImpulseResponse(scene, SAMPLE_RATE, params);

    // FIXED_RANDOM_SOURCE zeroes out the noise tail, so anything non-zero here is the coherent tap itself.
    const windowStart = Math.floor(reflection.timeSeconds * SAMPLE_RATE) - 8;
    const [firstChannel, ...otherChannels] = channels;
    expect(sumOverWindow(firstChannel, windowStart, 24)).toBeCloseTo(Math.sqrt(reflection.energy.low), 4);
    for (const impulseResponse of otherChannels) {
      expect(sumOverWindow(impulseResponse, windowStart, 24)).toBeCloseTo(sumOverWindow(firstChannel, windowStart, 24), 6);
    }
  });

  test('the impulse response is only as long as the room needs, not a fixed length', () => {
    // An open scene has nothing to decay, so rendering seconds of silence for it is wasted work; a live room
    // needs every bit of its tail or it ends on an abrupt edge. One fixed length cannot serve both.
    const openScene: RoomScene = buildTestScene(buildTestScene({ boxes: [], source: { x: 0, y: 1.5, z: 0 }, listener: { x: 2, y: 1.5, z: 0 } }));
    const liveRoom: RoomScene = buildTestScene({ boxes: [buildObjectBox({ x: -6, y: 0, z: -5, width: 12, height: 4, depth: 10, absorption: { low: 0.04, mid: 0.04, high: 0.05 } })], source: { x: -2, y: 1.5, z: 0 }, listener: { x: 2, y: 1.5, z: 0 } });

    const params = buildParams({ numberOfRays: 512, maximumBounces: 200, randomSource: Math.random });
    const [openChannel] = synthesizeRoomImpulseResponse(openScene, SAMPLE_RATE, params);
    const [liveChannel] = synthesizeRoomImpulseResponse(liveRoom, SAMPLE_RATE, params);

    expect(liveChannel.length).toBeGreaterThan(openChannel.length * 2);
  });

  test("a source to one side of the listener's head is heard louder on that ear", () => {
    // The listener faces +x, so their right ear points along +z (see `YawDegrees`) and a source out along +z
    // arrives from their right. Note this depends on how the listener is turned, not on any world axis —
    // which is the whole point of giving them an orientation.
    const scene: RoomScene = buildTestScene({
      boxes: [buildObjectBox({ x: 2 })],
      source: { x: 0, y: 0, z: 5 },
      listener: { x: 0, y: 0, z: 0, mode: 'binaural', yawDegrees: 0 },
    });
    const [left, right] = synthesizeRoomImpulseResponse(scene, SAMPLE_RATE, buildParams());

    expect(totalEnergy(right)).toBeGreaterThan(totalEnergy(left));
  });

  test('turning the listener to face the source centres it', () => {
    const buildScene = (yawDegrees: number): RoomScene =>
      buildTestScene({
        boxes: [],
        source: { x: 0, y: 0, z: 5 },
        listener: { x: 0, y: 0, z: 0, mode: 'binaural', yawDegrees },
      });

    const [offToTheSideLeft, offToTheSideRight] = synthesizeRoomImpulseResponse(buildScene(0), SAMPLE_RATE, buildParams());
    // Yaw 90 faces +z, straight at the source.
    const [facingLeft, facingRight] = synthesizeRoomImpulseResponse(buildScene(90), SAMPLE_RATE, buildParams());

    const imbalance = (left: Float32Array<ArrayBuffer>, right: Float32Array<ArrayBuffer>) => Math.abs(totalEnergy(left) - totalEnergy(right));
    expect(imbalance(facingLeft, facingRight)).toBeLessThan(imbalance(offToTheSideLeft, offToTheSideRight));
  });

  test('a mono listener hears the same thing on both channels, wherever the source is', () => {
    const scene: RoomScene = buildTestScene({ boxes: [buildObjectBox({ x: 2 })], source: { x: 0, y: 0, z: 5 }, listener: { x: 0, y: 0, z: 0 } });
    const channels = synthesizeRoomImpulseResponse(scene, SAMPLE_RATE, buildParams());

    expect(totalEnergy(channels[0])).toBeCloseTo(totalEnergy(channels[1]));
  });
});
