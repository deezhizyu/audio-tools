import { describe, expect, test } from 'vitest';
import type { DiscreteArrival } from './discreteArrival';
import { renderDiscreteArrivals } from './renderDiscreteArrivals';
import { buildTestListener } from './testHelpers/buildTestRoomScene';

const SAMPLE_RATE = 1000;

/** Facing +x, so their right ear points along +z and their left along -z — see `YawDegrees`. */
const BINAURAL_LISTENER = buildTestListener({ mode: 'binaural' });
const MONO_LISTENER = buildTestListener();

const STRAIGHT_AHEAD = { x: 1, y: 0, z: 0 };
const FROM_BEHIND = { x: -1, y: 0, z: 0 };
const FROM_THE_RIGHT = { x: 0, y: 0, z: 1 };
const FROM_THE_LEFT = { x: 0, y: 0, z: -1 };

function buildChannels(length = 128, count = 2): Float32Array<ArrayBuffer>[] {
  return Array.from({ length: count }, () => new Float32Array(length));
}

/** A whole-sample delay, so a centered arrival lands on exactly one sample and assertions can be exact. */
function buildArrival(overrides: Partial<DiscreteArrival> = {}): DiscreteArrival {
  return {
    timeSeconds: 40 / SAMPLE_RATE,
    energy: { low: 1, mid: 1, high: 1 },
    directionFromListener: STRAIGHT_AHEAD,
    ...overrides,
  };
}

function totalEnergy(channel: Float32Array<ArrayBuffer>): number {
  return Array.from(channel).reduce((sum, sample) => sum + sample * sample, 0);
}

/** Where an arrival's energy sits in time, in samples — the measure that shows an interaural delay without
    depending on exactly how the band kernel spreads it. */
function centreOfMassSamples(channel: Float32Array<ArrayBuffer>): number {
  const weighted = Array.from(channel).reduce((sum, sample, index) => sum + sample * sample * index, 0);
  return weighted / totalEnergy(channel);
}

describe('renderDiscreteArrivals', () => {
  test("places each arrival at its own delay, at the square root of its energy", () => {
    const channels = buildChannels();
    renderDiscreteArrivals(channels, [buildArrival({ energy: { low: 4, mid: 4, high: 4 } })], SAMPLE_RATE, MONO_LISTENER);

    for (const channel of channels) {
      expect(channel[40]).toBeCloseTo(2, 5);
    }
  });

  test('several arrivals accumulate, each at its own time', () => {
    const channels = buildChannels();
    renderDiscreteArrivals(
      channels,
      [buildArrival(), buildArrival({ timeSeconds: 60 / SAMPLE_RATE }), buildArrival({ timeSeconds: 80 / SAMPLE_RATE })],
      SAMPLE_RATE,
      MONO_LISTENER,
    );

    for (const sampleIndex of [40, 60, 80]) {
      expect(channels[0][sampleIndex]).toBeCloseTo(1, 5);
    }
  });

  test('two arrivals at the same instant add coherently, the way two real paths of equal length do', () => {
    // Amplitudes add, so the pair carries four times one arrival's energy rather than twice. That is correct
    // for genuinely coherent paths, and precisely why stochastic ray samples must not be rendered this way —
    // see `DiscreteArrival`.
    const channels = buildChannels();
    renderDiscreteArrivals(channels, [buildArrival(), buildArrival()], SAMPLE_RATE, MONO_LISTENER);

    expect(channels[0][40]).toBeCloseTo(2, 5);
  });

  test('produces no output at all for a silent arrival', () => {
    const channels = buildChannels();
    renderDiscreteArrivals(channels, [buildArrival({ energy: { low: 0, mid: 0, high: 0 } })], SAMPLE_RATE, BINAURAL_LISTENER);

    for (const channel of channels) {
      expect(Array.from(channel).every(value => value === 0)).toBe(true);
    }
  });

  test('a sound from one side reaches the near ear first and louder', () => {
    // Both halves of a real direction cue at once: a few hundred microseconds of head start, and the head
    // itself blocking part of what reaches the far ear. A panning law can only produce the second.
    const channels = buildChannels();
    renderDiscreteArrivals(channels, [buildArrival({ directionFromListener: FROM_THE_RIGHT })], SAMPLE_RATE, BINAURAL_LISTENER);
    const [left, right] = channels;

    expect(totalEnergy(right)).toBeGreaterThan(totalEnergy(left));
    expect(centreOfMassSamples(right)).toBeLessThan(centreOfMassSamples(left));
  });

  test('turning the listener around swaps which ear a sound reaches first', () => {
    const renderFacing = (yawDegrees: number) => {
      const channels = buildChannels();
      renderDiscreteArrivals(
        channels,
        [buildArrival({ directionFromListener: FROM_THE_RIGHT })],
        SAMPLE_RATE,
        buildTestListener({ mode: 'binaural', yawDegrees }),
      );
      return channels;
    };

    const [forwardLeft, forwardRight] = renderFacing(0);
    const [turnedLeft, turnedRight] = renderFacing(180);

    expect(totalEnergy(forwardRight)).toBeGreaterThan(totalEnergy(forwardLeft));
    expect(totalEnergy(turnedLeft)).toBeGreaterThan(totalEnergy(turnedRight));
  });

  test('a sound from behind is duller than the same sound in front', () => {
    // A head alone is front/back symmetric, so without a rear cue these two would be indistinguishable — the
    // cone of confusion. The difference is in the top end, which is where real ears resolve it.
    const renderFrom = (directionFromListener: DiscreteArrival['directionFromListener']) => {
      const channels = buildChannels();
      renderDiscreteArrivals(channels, [buildArrival({ directionFromListener })], SAMPLE_RATE, BINAURAL_LISTENER);
      return channels[0];
    };

    expect(totalEnergy(renderFrom(FROM_BEHIND))).toBeLessThan(totalEnergy(renderFrom(STRAIGHT_AHEAD)));
  });

  test('a mono listener hears the same thing on both channels, wherever the sound comes from', () => {
    for (const directionFromListener of [STRAIGHT_AHEAD, FROM_BEHIND, FROM_THE_LEFT, FROM_THE_RIGHT]) {
      const channels = buildChannels();
      renderDiscreteArrivals(channels, [buildArrival({ directionFromListener })], SAMPLE_RATE, MONO_LISTENER);

      expect(Array.from(channels[0])).toEqual(Array.from(channels[1]));
      expect(channels[0][40]).toBeCloseTo(1, 5);
    }
  });
});
