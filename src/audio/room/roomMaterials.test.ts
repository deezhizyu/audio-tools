import { describe, expect, test } from 'vitest';
import {
  DEFAULT_ABSORBER_MATERIAL_ID,
  DEFAULT_OBJECT_MATERIAL_ID,
  getEffectiveScatterAmount,
  getRoomMaterial,
  getRoomMaterialsInGroup,
  ROOM_MATERIALS,
} from './roomMaterials';
import type { RoomBox } from './roomTypes';

function buildBox(overrides: Partial<RoomBox> = {}): RoomBox {
  return {
    id: 'box-1',
    kind: 'object',
    x: 0,
    y: 0,
    z: 0,
    width: 1,
    height: 1,
    depth: 1,
    absorption: { low: 0.1, mid: 0.1, high: 0.1 },
    materialId: 'generic-object',
    textureIntensity: 1,
    ...overrides,
  };
}

describe('ROOM_MATERIALS', () => {
  test('every entry has absorption coefficients in [0, 1]', () => {
    for (const material of ROOM_MATERIALS) {
      for (const band of ['low', 'mid', 'high'] as const) {
        expect(material.absorption[band]).toBeGreaterThanOrEqual(0);
        expect(material.absorption[band]).toBeLessThanOrEqual(1);
      }
    }
  });

  test('every entry has a scatterAmount in [0, 1]', () => {
    for (const material of ROOM_MATERIALS) {
      expect(material.scatterAmount).toBeGreaterThanOrEqual(0);
      expect(material.scatterAmount).toBeLessThanOrEqual(1);
    }
  });

  test('every entry has a unique id', () => {
    const ids = ROOM_MATERIALS.map(material => material.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('every entry belongs to a group, and every group has entries', () => {
    // The editor's material picker builds its sections straight from these, so an empty or mislabelled group
    // would silently hide materials from the user.
    for (const group of ['hard', 'soft', 'ground'] as const) {
      expect(getRoomMaterialsInGroup(group).length).toBeGreaterThan(0);
    }
    expect(getRoomMaterialsInGroup('hard').length + getRoomMaterialsInGroup('soft').length + getRoomMaterialsInGroup('ground').length).toBe(
      ROOM_MATERIALS.length,
    );
  });

  test('absorption rises with frequency for the porous materials, and stays flat for the hard ones', () => {
    // Porous and fibrous materials work by letting air move through them, which they do far better at short
    // wavelengths — so any of them absorbing less at 4kHz than at 125Hz means its published octave bands were
    // mapped onto the wrong simulator bands, which is a much easier mistake to make than a wrong number.
    for (const id of ['grass', 'carpet', 'acoustic-foam', 'wool', 'curtain', 'gravel', 'snow'] as const) {
      const { absorption } = getRoomMaterial(id);
      expect(absorption.mid).toBeGreaterThan(absorption.low);
    }
  });

  test('includes ground materials an outdoor scene needs', () => {
    for (const id of ['grass', 'asphalt', 'gravel', 'soil'] as const) {
      expect(getRoomMaterial(id).id).toBe(id);
    }
  });
});

describe('getRoomMaterial', () => {
  test('returns the exact matching entry for a known id', () => {
    expect(getRoomMaterial('concrete').id).toBe('concrete');
  });

  test('falls back to a defined material for an unknown id', () => {
    // @ts-expect-error deliberately invalid for the test
    const material = getRoomMaterial('not-a-real-material');
    expect(material).toBeDefined();
    expect(ROOM_MATERIALS).toContainEqual(material);
  });

  test('both default material ids resolve to catalog entries', () => {
    expect(getRoomMaterial(DEFAULT_OBJECT_MATERIAL_ID).id).toBe(DEFAULT_OBJECT_MATERIAL_ID);
    expect(getRoomMaterial(DEFAULT_ABSORBER_MATERIAL_ID).id).toBe(DEFAULT_ABSORBER_MATERIAL_ID);
  });
});

describe('getEffectiveScatterAmount', () => {
  test('matches the material scatterAmount when textureIntensity is 1', () => {
    const box = buildBox({ materialId: 'concrete', textureIntensity: 1 });
    expect(getEffectiveScatterAmount(box)).toBeCloseTo(getRoomMaterial('concrete').scatterAmount);
  });

  test('scales linearly with textureIntensity below the clamp', () => {
    const box = buildBox({ materialId: 'parquet', textureIntensity: 0.5 });
    expect(getEffectiveScatterAmount(box)).toBeCloseTo(getRoomMaterial('parquet').scatterAmount * 0.5);
  });

  test('clamps to 1 when textureIntensity pushes the product above 1', () => {
    // Scattering is consumed as a specular/diffuse mix fraction, so it can never exceed "entirely diffuse"
    // however far the roughness slider is pushed.
    const roughestMaterial = ROOM_MATERIALS.reduce((roughest, material) => (material.scatterAmount > roughest.scatterAmount ? material : roughest));
    expect(getEffectiveScatterAmount(buildBox({ materialId: roughestMaterial.id, textureIntensity: 2 }))).toBe(1);
  });

  test('clamps to 0 for a zero textureIntensity', () => {
    const box = buildBox({ materialId: 'concrete', textureIntensity: 0 });
    expect(getEffectiveScatterAmount(box)).toBe(0);
  });
});
