import { describe, expect, test } from 'vitest';
import { computeDirectSoundArrival } from './directSound';
import { estimateReverberationTimeSeconds } from './estimateReverbTime';
import { SPEED_OF_SOUND_METERS_PER_SECOND } from './roomAcousticsDefaults';
import { DEFAULT_ROOM_PRESET_ID, getRoomPreset, ROOM_PRESETS, type RoomPresetId } from './roomPresets';
import { synthesizeRoomImpulseResponse } from './synthesizeRoomImpulseResponse';
import { DEFAULT_RAY_TRACING_PARAMS } from './traceRays';

const SAMPLE_RATE = 16000;

function buildSeededRandomSource(seed = 99): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Fewer rays than a real simulation — enough for the decay time to settle, cheap enough to run six rooms. */
function simulate(presetId: RoomPresetId): { impulseResponse: Float32Array<ArrayBuffer>; energy: Float64Array; directEnergy: number; reverberantEnergy: number } {
  const scene = getRoomPreset(presetId).buildScene();
  const [impulseResponse] = synthesizeRoomImpulseResponse(scene, SAMPLE_RATE, {
    ...DEFAULT_RAY_TRACING_PARAMS,
    numberOfRays: 1024,
    randomSource: buildSeededRandomSource(),
  });

  const energy = new Float64Array(impulseResponse.length);
  for (let sampleIndex = 0; sampleIndex < impulseResponse.length; sampleIndex++) {
    energy[sampleIndex] = impulseResponse[sampleIndex] * impulseResponse[sampleIndex];
  }

  // Everything within a few milliseconds of the straight-line path counts as direct; the rest is the room.
  const directArrival = computeDirectSoundArrival(scene, SPEED_OF_SOUND_METERS_PER_SECOND);
  const splitIndex = Math.floor((directArrival.timeSeconds + 0.004) * SAMPLE_RATE);
  let directEnergy = 0;
  let reverberantEnergy = 0;
  for (let sampleIndex = 0; sampleIndex < energy.length; sampleIndex++) {
    if (sampleIndex < splitIndex) directEnergy += energy[sampleIndex];
    else reverberantEnergy += energy[sampleIndex];
  }

  return { impulseResponse, energy, directEnergy, reverberantEnergy };
}

function reverberationTimeOf(presetId: RoomPresetId): number | null {
  return estimateReverberationTimeSeconds(simulate(presetId).energy, 1 / SAMPLE_RATE);
}

function directToReverberantDecibels(presetId: RoomPresetId): number {
  const { directEnergy, reverberantEnergy } = simulate(presetId);
  return 10 * Math.log10(directEnergy / Math.max(reverberantEnergy, 1e-20));
}

describe('ROOM_PRESETS', () => {
  test('every preset builds a scene whose boxes all have distinct ids', () => {
    // Ids collide easily when presets share helper-built geometry, and a duplicate makes a box unselectable
    // in the editor without failing anywhere obvious.
    for (const preset of ROOM_PRESETS) {
      const ids = preset.buildScene().boxes.map(box => box.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test('every preset places the source and listener apart, above the ground, and facing each other', () => {
    for (const preset of ROOM_PRESETS) {
      const { source, listener } = preset.buildScene();
      expect(Math.hypot(listener.x - source.x, listener.y - source.y, listener.z - source.z)).toBeGreaterThan(0.5);
      expect(source.y).toBeGreaterThan(0);
      expect(listener.y).toBeGreaterThan(0);
      expect(Math.abs(listener.yawDegrees - source.yawDegrees)).toBe(180);
    }
  });

  test('every preset has a unique id and the default resolves to one of them', () => {
    const ids = ROOM_PRESETS.map(preset => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getRoomPreset(DEFAULT_ROOM_PRESET_ID).id).toBe(DEFAULT_ROOM_PRESET_ID);
  });
});

describe('preset acoustics', () => {
  test('furnishing a room shortens its decay, at both sizes', () => {
    // The point of shipping furnished and empty versions of the same shell: they have to actually differ,
    // and by the amount soft furnishings really make. If they came out alike, the material catalog's
    // absorption values would be doing nothing.
    expect(reverberationTimeOf('furnished-small-room')!).toBeLessThan(reverberationTimeOf('empty-small-room')! * 0.6);
    expect(reverberationTimeOf('furnished-large-room')!).toBeLessThan(reverberationTimeOf('empty-large-room')! * 0.6);
  });

  test('a bigger room of the same kind rings for longer', () => {
    expect(reverberationTimeOf('furnished-large-room')!).toBeGreaterThan(reverberationTimeOf('furnished-small-room')!);
    expect(reverberationTimeOf('empty-large-room')!).toBeGreaterThan(reverberationTimeOf('empty-small-room')!);
  });

  test('indoor presets land in the reverberation times their descriptions claim', () => {
    // Loose ranges rather than exact figures — these are bounds a listener would notice being wrong, not
    // calibration targets. A furnished living room measures a few tenths of a second; a bare hall, seconds.
    const expectedRanges: { presetId: RoomPresetId; minimumSeconds: number; maximumSeconds: number }[] = [
      { presetId: 'furnished-small-room', minimumSeconds: 0.15, maximumSeconds: 0.7 },
      { presetId: 'furnished-large-room', minimumSeconds: 0.3, maximumSeconds: 1.2 },
      { presetId: 'empty-small-room', minimumSeconds: 0.7, maximumSeconds: 2.5 },
      { presetId: 'empty-large-room', minimumSeconds: 2, maximumSeconds: 6 },
    ];

    for (const { presetId, minimumSeconds, maximumSeconds } of expectedRanges) {
      const measured = reverberationTimeOf(presetId);
      expect(measured).not.toBeNull();
      expect(measured!).toBeGreaterThan(minimumSeconds);
      expect(measured!).toBeLessThan(maximumSeconds);
    }
  });

  test('the open field is all direct sound and one soft bounce, not a room', () => {
    // The check that outdoors actually sounds outdoors. Grass absorbs almost everything above a few hundred
    // hertz and there is nothing else to reflect off, so the direct sound has to dominate by a wide margin —
    // when this pipeline reported an enclosed-sounding field, this is the number that was wrong.
    expect(directToReverberantDecibels('outdoor-grass-field')).toBeGreaterThan(8);

    // And with nothing to sustain a decay, the impulse response should be short rather than seconds of near
    // silence.
    expect(simulate('outdoor-grass-field').impulseResponse.length / SAMPLE_RATE).toBeLessThan(0.6);
  });

  test('the street is dominated by its direct sound too, but far more reflective than open grass', () => {
    // Two hard façades and hard ground, open to the sky: strong discrete reflections and no enclosed tail.
    const street = directToReverberantDecibels('outdoor-street');
    expect(street).toBeGreaterThan(0);
    expect(street).toBeLessThan(directToReverberantDecibels('outdoor-grass-field'));
  });

  test('an indoor room is far more reverberant than either outdoor scene', () => {
    expect(directToReverberantDecibels('empty-small-room')).toBeLessThan(directToReverberantDecibels('outdoor-street'));
    expect(directToReverberantDecibels('furnished-small-room')).toBeLessThan(directToReverberantDecibels('outdoor-street'));
  });
});
