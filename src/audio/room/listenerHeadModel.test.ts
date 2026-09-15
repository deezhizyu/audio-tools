import { describe, expect, test } from 'vitest';
import {
  computeDiffuseEarGains,
  computeEarResponse,
  DIFFUSE_FIELD_INTERAURAL_COHERENCE,
  HEAD_RADIUS_METERS,
  interauralCoherence,
  lateralPositionInListenerFrame,
  toListenerLocalDirection,
} from './listenerHeadModel';
import { SPEED_OF_SOUND_METERS_PER_SECOND } from './roomAcousticsDefaults';
import { buildTestListener } from './testHelpers/buildTestRoomScene';

/** Facing +x, so forward is +x, the right ear points along +z and the left along -z — see `YawDegrees`. */
const BINAURAL = buildTestListener({ mode: 'binaural' });
const MONO = buildTestListener();

const AHEAD = { x: 1, y: 0, z: 0 };
const BEHIND = { x: -1, y: 0, z: 0 };
const RIGHT = { x: 0, y: 0, z: 1 };
const LEFT = { x: 0, y: 0, z: -1 };
const ABOVE = { x: 0, y: 1, z: 0 };

describe('toListenerLocalDirection', () => {
  test('resolves a direction into ahead, to the right, and above', () => {
    expect(toListenerLocalDirection(AHEAD, BINAURAL)).toEqual({ forward: 1, right: 0, up: 0 });
    expect(toListenerLocalDirection(RIGHT, BINAURAL).right).toBeCloseTo(1);
    expect(toListenerLocalDirection(LEFT, BINAURAL).right).toBeCloseTo(-1);
    expect(toListenerLocalDirection(ABOVE, BINAURAL).up).toBeCloseTo(1);
  });

  test('turning the listener turns the room around them', () => {
    // Nothing in the room moved; the listener did. A sound that was on their right is now on their left.
    const turnedAround = buildTestListener({ mode: 'binaural', yawDegrees: 180 });
    expect(toListenerLocalDirection(RIGHT, turnedAround).right).toBeCloseTo(-1);
    expect(toListenerLocalDirection(AHEAD, turnedAround).forward).toBeCloseTo(-1);
  });

  test('a quarter turn puts what was ahead onto one side', () => {
    const turnedRight = buildTestListener({ mode: 'binaural', yawDegrees: 90 });
    const local = toListenerLocalDirection(AHEAD, turnedRight);

    expect(local.forward).toBeCloseTo(0);
    expect(local.right).toBeCloseTo(-1);
  });
});

describe('computeEarResponse', () => {
  test('a sound straight ahead reaches both ears at once, equally loud', () => {
    const left = computeEarResponse(toListenerLocalDirection(AHEAD, BINAURAL), 'left', BINAURAL);
    const right = computeEarResponse(toListenerLocalDirection(AHEAD, BINAURAL), 'right', BINAURAL);

    expect(left.delaySeconds).toBeCloseTo(0, 10);
    expect(right.delaySeconds).toBeCloseTo(0, 10);
    expect(left.gains).toEqual(right.gains);
  });

  test('a sound from one side reaches the near ear earlier, by about the time it takes to travel round a head', () => {
    const local = toListenerLocalDirection(RIGHT, BINAURAL);
    const left = computeEarResponse(local, 'left', BINAURAL);
    const right = computeEarResponse(local, 'right', BINAURAL);

    expect(right.delaySeconds).toBeLessThan(0);
    expect(left.delaySeconds).toBeGreaterThan(0);

    // Woodworth's maximum for a source fully to one side: (radius/speed)·(π/2 + 1), split across the two ears.
    const expectedSpread = (HEAD_RADIUS_METERS / SPEED_OF_SOUND_METERS_PER_SECOND) * (Math.PI / 2 + 1);
    expect(left.delaySeconds - right.delaySeconds).toBeCloseTo(expectedSpread, 6);
    // Around two thirds of a millisecond, the well-known ceiling on interaural time difference.
    expect(expectedSpread).toBeGreaterThan(0.0006);
    expect(expectedSpread).toBeLessThan(0.0007);
  });

  test('the head shadows the far ear, and shadows treble far more than bass', () => {
    // The frequency dependence is what makes this read as a direction rather than as a balance control: a
    // head is an obstacle comparable to the wavelengths it blocks, so bass bends around it nearly untouched.
    const { gains } = computeEarResponse(toListenerLocalDirection(RIGHT, BINAURAL), 'left', BINAURAL);

    expect(gains.high).toBeLessThan(gains.mid);
    expect(gains.mid).toBeLessThan(gains.low);
    expect(gains.low).toBeGreaterThan(0.8);
    expect(gains.high).toBeLessThan(0.2);
  });

  test('a sound from behind loses treble that the same sound in front keeps', () => {
    // A sphere cannot tell front from back at all, so without this cue the two are identical.
    const ahead = computeEarResponse(toListenerLocalDirection(AHEAD, BINAURAL), 'left', BINAURAL).gains;
    const behind = computeEarResponse(toListenerLocalDirection(BEHIND, BINAURAL), 'left', BINAURAL).gains;

    expect(behind.high).toBeLessThan(ahead.high);
    expect(behind.low).toBeCloseTo(ahead.low, 10);
  });

  test('a mono listener has no ears to tell apart', () => {
    for (const direction of [AHEAD, BEHIND, LEFT, RIGHT]) {
      for (const ear of ['left', 'right'] as const) {
        const response = computeEarResponse(toListenerLocalDirection(direction, MONO), ear, MONO);
        expect(response.delaySeconds).toBe(0);
        expect(response.gains).toEqual({ low: 1, mid: 1, high: 1 });
      }
    }
  });
});

describe('computeDiffuseEarGains', () => {
  test('shadows a tail biased to one side, and leaves a centred one alone', () => {
    expect(computeDiffuseEarGains(0, 'left', BINAURAL)).toEqual(computeDiffuseEarGains(0, 'right', BINAURAL));
    expect(computeDiffuseEarGains(1, 'left', BINAURAL).high).toBeLessThan(computeDiffuseEarGains(1, 'right', BINAURAL).high);
  });

  test('a mono listener hears the tail unshadowed', () => {
    expect(computeDiffuseEarGains(1, 'left', MONO)).toEqual({ low: 1, mid: 1, high: 1 });
  });
});

describe('interauralCoherence', () => {
  test('falls with frequency, matching how alike the two ears really are in a diffuse field', () => {
    // Bass arrives at both ears almost identically, which is what makes it sound solid and placed rather than
    // phasey; by the top of the spectrum the ears are effectively independent.
    const coherence = interauralCoherence(BINAURAL);
    expect(coherence.low).toBeGreaterThan(coherence.mid);
    expect(coherence.mid).toBeGreaterThan(coherence.high);
    expect(coherence.low).toBeGreaterThan(0.5);
    expect(coherence.high).toBeLessThan(0.1);
  });

  test('matches the theoretical sinc coherence for the modelled head width', () => {
    const earSpacingMeters = 2 * HEAD_RADIUS_METERS;
    const theoreticalCoherence = (frequencyHertz: number) => {
      const argument = (2 * Math.PI * frequencyHertz * earSpacingMeters) / SPEED_OF_SOUND_METERS_PER_SECOND;
      return Math.sin(argument) / argument;
    };

    expect(DIFFUSE_FIELD_INTERAURAL_COHERENCE.low).toBeCloseTo(theoreticalCoherence(400), 1);
    expect(DIFFUSE_FIELD_INTERAURAL_COHERENCE.mid).toBeCloseTo(theoreticalCoherence(2530), 1);
  });

  test('a mono listener is perfectly coherent, so both channels come out identical', () => {
    expect(interauralCoherence(MONO)).toEqual({ low: 1, mid: 1, high: 1 });
  });
});

describe('lateralPositionInListenerFrame', () => {
  test('reports which side a direction is on, ignoring how far ahead or behind it is', () => {
    expect(lateralPositionInListenerFrame(RIGHT, BINAURAL)).toBeCloseTo(1);
    expect(lateralPositionInListenerFrame(LEFT, BINAURAL)).toBeCloseTo(-1);
    expect(lateralPositionInListenerFrame(AHEAD, BINAURAL)).toBeCloseTo(0);
    expect(lateralPositionInListenerFrame(BEHIND, BINAURAL)).toBeCloseTo(0);
  });

  test('is measured in the listener’s frame, so turning them re-sides the room', () => {
    const turnedAround = buildTestListener({ mode: 'binaural', yawDegrees: 180 });
    expect(lateralPositionInListenerFrame(RIGHT, turnedAround)).toBeCloseTo(-1);
  });

  test('a direction straight up has no side to it', () => {
    expect(lateralPositionInListenerFrame(ABOVE, BINAURAL)).toBe(0);
  });
});
