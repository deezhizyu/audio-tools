import { describe, expect, test } from 'vitest';
import { AIR_ABSORPTION_COEFFICIENTS_PER_METER } from './airAbsorption';
import { computeDirectSoundArrival } from './directSound';
import { estimateReverberationTimeSeconds } from './estimateReverbTime';
import { SPEED_OF_SOUND_METERS_PER_SECOND } from './roomAcousticsDefaults';
import type { RoomBox, RoomScene } from './roomTypes';
import { synthesizeRoomImpulseResponse } from './synthesizeRoomImpulseResponse';
import { DEFAULT_RAY_TRACING_PARAMS, type RayTracingParams } from './traceRays';

/**
 * End-to-end calibration against textbook room acoustics.
 *
 * Every other test in this directory checks that one piece of the pipeline does what it says. These check the
 * only thing that actually decides whether a simulated space sounds like a real one: that a room of known
 * dimensions and known absorption comes out with the reverberation time and the direct-to-reverberant ratio
 * that a century of room-acoustics theory says it must. Both quantities are emergent — no constant in this
 * codebase sets either of them — so they only land in the right place if the ray tracer, the image-source
 * pass, the energy histogram and the synthesizer all agree on one absolute energy scale.
 *
 * They are deliberately measured from the rendered impulse response, not from any intermediate, so a mistake
 * anywhere between tracing a ray and writing a sample has somewhere to show up.
 */

const SAMPLE_RATE = 16000;
const NUMBER_OF_RAYS = 4096;

const ROOM_WIDTH_METERS = 7;
const ROOM_HEIGHT_METERS = 3;
const ROOM_DEPTH_METERS = 5;
const ROOM_VOLUME_CUBIC_METERS = ROOM_WIDTH_METERS * ROOM_HEIGHT_METERS * ROOM_DEPTH_METERS;
const ROOM_SURFACE_AREA_SQUARE_METERS =
  2 * (ROOM_WIDTH_METERS * ROOM_DEPTH_METERS + ROOM_WIDTH_METERS * ROOM_HEIGHT_METERS + ROOM_DEPTH_METERS * ROOM_HEIGHT_METERS);

const SOURCE = { x: 2, y: 1.5, z: 2.5 };
const LISTENER = { x: 4.5, y: 1.5, z: 2.5 };
const SOURCE_TO_LISTENER_METERS = LISTENER.x - SOURCE.x;

/** Absorption coefficients spanning most of the useful range, so the tests track how the simulation responds
    to absorption rather than one tuned operating point. */
const TEST_ABSORPTION_COEFFICIENTS = [0.1, 0.2, 0.35];

function buildSeededRandomSource(seed = 12345): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** One box enclosing the source and listener, which `intersectRayWithBox`'s `hitFromInside` turns into a
    shoebox room — the exact geometry Sabine's and Eyring's formulae are derived for. */
function buildShoeboxScene(absorptionCoefficient: number): RoomScene {
  const shell: RoomBox = {
    id: 'shell',
    kind: 'object',
    x: 0,
    y: 0,
    z: 0,
    width: ROOM_WIDTH_METERS,
    height: ROOM_HEIGHT_METERS,
    depth: ROOM_DEPTH_METERS,
    absorption: { low: absorptionCoefficient, mid: absorptionCoefficient, high: absorptionCoefficient },
    materialId: 'generic-object',
    textureIntensity: 1,
  };
  return { boxes: [shell], source: SOURCE, listener: LISTENER };
}

function buildParams(): RayTracingParams {
  return { ...DEFAULT_RAY_TRACING_PARAMS, numberOfRays: NUMBER_OF_RAYS, randomSource: buildSeededRandomSource() };
}

function simulateShoebox(absorptionCoefficient: number): Float32Array<ArrayBuffer> {
  return synthesizeRoomImpulseResponse(buildShoeboxScene(absorptionCoefficient), SAMPLE_RATE, buildParams(), false)[0];
}

/**
 * Eyring's reverberation time. Preferred over Sabine's `0.161V/(Sα)` here because Sabine's systematically
 * overestimates once absorption climbs past about 0.2, where Eyring's `-S·ln(1-α)` stays right. The `4mV`
 * term is the air's own absorption over the path; the mid band's coefficient stands in for it, since the mid
 * band covers most of the spectrum (800Hz-8kHz) and so dominates a broadband decay.
 */
function eyringReverberationTimeSeconds(absorptionCoefficient: number): number {
  const surfaceAbsorption = -ROOM_SURFACE_AREA_SQUARE_METERS * Math.log(1 - absorptionCoefficient);
  const airAbsorption = 4 * AIR_ABSORPTION_COEFFICIENTS_PER_METER.mid * ROOM_VOLUME_CUBIC_METERS;
  return (0.161 * ROOM_VOLUME_CUBIC_METERS) / (surfaceAbsorption + airAbsorption);
}

/** The room constant: how much absorbing surface the room effectively presents to a steady sound field. */
function roomConstant(absorptionCoefficient: number): number {
  return (ROOM_SURFACE_AREA_SQUARE_METERS * absorptionCoefficient) / (1 - absorptionCoefficient);
}

/** The textbook direct-to-reverberant energy ratio at a given distance in a diffuse field, `R/(16πd²)` —
    equivalently `(criticalDistance/distance)²`. */
function predictedDirectToReverberantRatio(absorptionCoefficient: number): number {
  return roomConstant(absorptionCoefficient) / (16 * Math.PI * SOURCE_TO_LISTENER_METERS * SOURCE_TO_LISTENER_METERS);
}

function energyOverTime(impulseResponse: Float32Array<ArrayBuffer>): Float64Array {
  const energy = new Float64Array(impulseResponse.length);
  for (let sampleIndex = 0; sampleIndex < impulseResponse.length; sampleIndex++) {
    energy[sampleIndex] = impulseResponse[sampleIndex] * impulseResponse[sampleIndex];
  }
  return energy;
}

function sumRange(values: ArrayLike<number>, startIndex: number, endIndex: number): number {
  let total = 0;
  for (let index = Math.max(0, startIndex); index < Math.min(values.length, endIndex); index++) total += values[index];
  return total;
}

function toDecibels(ratio: number): number {
  return 10 * Math.log10(ratio);
}

/** The direct sound ends, and reflections begin, at the earliest moment any reflected path could possibly
    arrive — here the floor and ceiling bounces, which are the shortest detour available in this geometry. */
function firstReflectionSampleIndex(): number {
  const shortestReflectedPathMeters = Math.hypot(SOURCE_TO_LISTENER_METERS, ROOM_HEIGHT_METERS);
  return Math.floor((shortestReflectedPathMeters / SPEED_OF_SOUND_METERS_PER_SECOND) * SAMPLE_RATE);
}

describe('room acoustics calibration', () => {
  test("a shoebox room's reverberation time matches Eyring's prediction across a range of absorptions", () => {
    for (const absorptionCoefficient of TEST_ABSORPTION_COEFFICIENTS) {
      const measured = estimateReverberationTimeSeconds(energyOverTime(simulateShoebox(absorptionCoefficient)), 1 / SAMPLE_RATE);
      const predicted = eyringReverberationTimeSeconds(absorptionCoefficient);

      expect(measured).not.toBeNull();
      // 20% is roughly the spread between Sabine's and Eyring's own predictions for these rooms, and well
      // inside what distinguishes a room that sounds right from one that doesn't. Beyond it, something in the
      // energy bookkeeping has drifted.
      expect(measured!).toBeGreaterThan(predicted * 0.8);
      expect(measured!).toBeLessThan(predicted * 1.2);
    }
  });

  test('a more absorptive room decays faster, monotonically', () => {
    const reverberationTimes = TEST_ABSORPTION_COEFFICIENTS.map(
      absorptionCoefficient => estimateReverberationTimeSeconds(energyOverTime(simulateShoebox(absorptionCoefficient)), 1 / SAMPLE_RATE)!,
    );

    for (let index = 1; index < reverberationTimes.length; index++) {
      expect(reverberationTimes[index]).toBeLessThan(reverberationTimes[index - 1]);
    }
  });

  test('the direct-to-reverberant ratio matches diffuse-field theory across a range of absorptions', () => {
    // This is the ratio the ear reads as distance, and the one every energy-scaling mistake shows up in: a
    // reflection path that carries the wrong absolute energy, or a tail rendered at the wrong level, moves
    // this and little else. Getting it wrong by 10dB — which this pipeline did, in both directions at once —
    // is the difference between someone speaking a couple of meters away and someone down a corridor.
    for (const absorptionCoefficient of TEST_ABSORPTION_COEFFICIENTS) {
      const energy = energyOverTime(simulateShoebox(absorptionCoefficient));
      const reflectionStart = firstReflectionSampleIndex();

      const measuredRatio = sumRange(energy, 0, reflectionStart) / sumRange(energy, reflectionStart, energy.length);
      const predictedRatio = predictedDirectToReverberantRatio(absorptionCoefficient);

      expect(Math.abs(toDecibels(measuredRatio) - toDecibels(predictedRatio))).toBeLessThan(2);
    }
  });

  test('moving the listener further away lowers the direct-to-reverberant ratio, as distance does in a real room', () => {
    const measureAtDistance = (distanceMeters: number): number => {
      const scene = buildShoeboxScene(0.2);
      const energy = energyOverTime(
        synthesizeRoomImpulseResponse(
          { ...scene, listener: { ...SOURCE, x: SOURCE.x + distanceMeters } },
          SAMPLE_RATE,
          buildParams(),
          false,
        )[0],
      );
      const reflectionStart = Math.floor((Math.hypot(distanceMeters, ROOM_HEIGHT_METERS) / SPEED_OF_SOUND_METERS_PER_SECOND) * SAMPLE_RATE);
      return sumRange(energy, 0, reflectionStart) / sumRange(energy, reflectionStart, energy.length);
    };

    expect(measureAtDistance(4)).toBeLessThan(measureAtDistance(1));
  });

  test('with no surfaces at all, the impulse response is just the direct sound at its inverse-square level', () => {
    const scene: RoomScene = { boxes: [], source: SOURCE, listener: LISTENER };
    const [impulseResponse] = synthesizeRoomImpulseResponse(scene, SAMPLE_RATE, buildParams(), false);
    const renderedEnergy = sumRange(energyOverTime(impulseResponse), 0, impulseResponse.length);
    const expectedEnergy = computeDirectSoundArrival(scene, SPEED_OF_SOUND_METERS_PER_SECOND).energy.low;

    expect(expectedEnergy).toBeCloseTo(1 / (SOURCE_TO_LISTENER_METERS * SOURCE_TO_LISTENER_METERS), 3);
    // Within 1dB: the arrival is reconstructed band-limited (see `renderBandLimitedImpulse.ts`), so the small
    // shortfall is content above ~18kHz that a fractional-delay reconstruction legitimately does not produce.
    expect(Math.abs(toDecibels(renderedEnergy / expectedEnergy))).toBeLessThan(1);
  });
});
