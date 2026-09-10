import { describe, expect, test } from 'vitest';
import { DEFAULT_ABSORBER_MATERIAL_ID, DEFAULT_OBJECT_MATERIAL_ID, getEffectiveScatterAmount, getRoomMaterial, ROOM_MATERIALS } from './roomMaterials';
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

  test('includes grass', () => {
    expect(ROOM_MATERIALS.some(material => material.id === 'grass')).toBe(true);
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
    // No catalog material's scatterAmount is high enough on its own to clamp at the maximum textureIntensity
    // (2) — every entry is calibrated well below 0.5 (see roomMaterials.ts) — so this isolates the clamp math
    // directly on a box rather than depending on a specific catalog value staying above 0.5.
    const roughestMaterial = ROOM_MATERIALS.reduce((roughest, material) => (material.scatterAmount > roughest.scatterAmount ? material : roughest));
    expect(roughestMaterial.scatterAmount * 2).toBeLessThan(1); // sanity check: the catalog really can't reach the clamp unaided
    const box = buildBox({ materialId: roughestMaterial.id, textureIntensity: 2 / roughestMaterial.scatterAmount });
    expect(getEffectiveScatterAmount(box)).toBe(1);
  });

  test('clamps to 0 for a zero textureIntensity', () => {
    const box = buildBox({ materialId: 'concrete', textureIntensity: 0 });
    expect(getEffectiveScatterAmount(box)).toBe(0);
  });
});
