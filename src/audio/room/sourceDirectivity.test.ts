import { describe, expect, test } from 'vitest';
import { directivityGain, orientationForward, OMNIDIRECTIONAL_DIRECTIVITY } from './sourceDirectivity';
import type { RoomSource } from './roomTypes';

function buildSource(overrides: Partial<RoomSource> = {}): RoomSource {
  return { x: 0, y: 0, z: 0, yawDegrees: 0, directivity: OMNIDIRECTIONAL_DIRECTIVITY, ...overrides };
}

const AHEAD = { x: 1, y: 0, z: 0 };
const BEHIND = { x: -1, y: 0, z: 0 };
const TO_THE_SIDE = { x: 0, y: 0, z: 1 };

describe('orientationForward', () => {
  test('points along +x at zero and turns toward +z, matching the editor top view', () => {
    expect(orientationForward(0).x).toBeCloseTo(1);
    expect(orientationForward(0).z).toBeCloseTo(0);
    expect(orientationForward(90).z).toBeCloseTo(1);
    expect(orientationForward(180).x).toBeCloseTo(-1);
  });

  test('stays in the horizontal plane at every angle', () => {
    for (const yawDegrees of [0, 45, 137, 270]) {
      expect(orientationForward(yawDegrees).y).toBe(0);
    }
  });
});

describe('directivityGain', () => {
  test('an all-sided source radiates equally in every direction', () => {
    const source = buildSource();
    for (const direction of [AHEAD, BEHIND, TO_THE_SIDE]) {
      expect(directivityGain(source, direction)).toBe(1);
    }
  });

  test('a directional source is unattenuated straight ahead, whatever pattern it is set to', () => {
    // On-axis gain stays at 1 so aiming a source at the listener never changes what they hear — narrowing the
    // beam takes energy away from everywhere else rather than adding it in front.
    for (const weight of [0.25, 0.5, 0.75, 1]) {
      for (const sharpness of [1, 2, 6]) {
        expect(directivityGain(buildSource({ directivity: { enabled: true, weight, sharpness } }), AHEAD)).toBeCloseTo(1, 10);
      }
    }
  });

  test('a cardioid sends nothing directly backwards', () => {
    const cardioid = buildSource({ directivity: { enabled: true, weight: 0.5, sharpness: 1 } });

    expect(directivityGain(cardioid, BEHIND)).toBeCloseTo(0, 10);
    expect(directivityGain(cardioid, TO_THE_SIDE)).toBeCloseTo(0.5, 10);
  });

  test('narrowing the beam concentrates it further forward', () => {
    const wide = buildSource({ directivity: { enabled: true, weight: 0.3, sharpness: 1 } });
    const narrow = buildSource({ directivity: { enabled: true, weight: 1, sharpness: 6 } });

    const offAxis = { x: Math.cos(Math.PI / 4), y: 0, z: Math.sin(Math.PI / 4) };
    expect(directivityGain(narrow, offAxis)).toBeLessThan(directivityGain(wide, offAxis));
  });

  test('turning the source turns its pattern with it', () => {
    const facingAway = buildSource({ yawDegrees: 180, directivity: { enabled: true, weight: 0.5, sharpness: 1 } });

    expect(directivityGain(facingAway, BEHIND)).toBeCloseTo(1, 10);
    expect(directivityGain(facingAway, AHEAD)).toBeCloseTo(0, 10);
  });

  test('a disabled directivity ignores the pattern it is still carrying', () => {
    // The pattern is kept while switched off so toggling directionality back on restores what the user had
    // dialed in, rather than resetting it.
    const source = buildSource({ yawDegrees: 180, directivity: { enabled: false, weight: 1, sharpness: 8 } });
    expect(directivityGain(source, AHEAD)).toBe(1);
  });
});
