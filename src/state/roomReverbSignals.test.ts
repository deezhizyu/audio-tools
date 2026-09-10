import { beforeEach, describe, expect, test } from 'vitest';
import { getRoomMaterial } from '../audio/room/roomMaterials';
import type { RoomBox } from '../audio/room/roomTypes';
import {
  moveSelectedBoxes,
  removeSelectedBoxes,
  roomBoxes,
  selectBoxesInRect,
  selectedBoxIds,
  selectSingleBox,
  toggleBoxSelection,
  updateSelectedBoxesAbsorptionBand,
  updateSelectedBoxesMaterial,
  updateSelectedBoxesTextureIntensity,
} from './roomReverbSignals';

const TOP_VIEW_AXES = { horizontal: 'x', vertical: 'z' } as const;

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
    absorption: { low: 0.1, mid: 0.2, high: 0.3 },
    materialId: 'generic-object',
    textureIntensity: 1,
    ...overrides,
  };
}

beforeEach(() => {
  roomBoxes.value = [];
  selectedBoxIds.value = new Set();
});

describe('selectSingleBox', () => {
  test('replaces the whole selection with one box', () => {
    selectedBoxIds.value = new Set(['a', 'b']);
    selectSingleBox('c');
    expect([...selectedBoxIds.value]).toEqual(['c']);
  });

  test('clears the selection when given null', () => {
    selectedBoxIds.value = new Set(['a']);
    selectSingleBox(null);
    expect(selectedBoxIds.value.size).toBe(0);
  });
});

describe('toggleBoxSelection', () => {
  test('adds an unselected box', () => {
    selectedBoxIds.value = new Set(['a']);
    toggleBoxSelection('b');
    expect(selectedBoxIds.value).toEqual(new Set(['a', 'b']));
  });

  test('removes an already-selected box', () => {
    selectedBoxIds.value = new Set(['a', 'b']);
    toggleBoxSelection('b');
    expect(selectedBoxIds.value).toEqual(new Set(['a']));
  });
});

describe('selectBoxesInRect', () => {
  test('replaces the whole selection with the given ids', () => {
    selectedBoxIds.value = new Set(['a']);
    selectBoxesInRect(['b', 'c']);
    expect(selectedBoxIds.value).toEqual(new Set(['b', 'c']));
  });

  test('an empty result clears the selection', () => {
    selectedBoxIds.value = new Set(['a']);
    selectBoxesInRect([]);
    expect(selectedBoxIds.value.size).toBe(0);
  });
});

describe('updateSelectedBoxesAbsorptionBand', () => {
  test('only touches the specified band on selected boxes, leaving other bands and unselected boxes untouched', () => {
    const selected = buildBox({ id: 'selected' });
    const unselected = buildBox({ id: 'unselected' });
    roomBoxes.value = [selected, unselected];
    selectedBoxIds.value = new Set(['selected']);

    updateSelectedBoxesAbsorptionBand('mid', 0.9);

    const [updatedSelected, updatedUnselected] = roomBoxes.value;
    expect(updatedSelected.absorption).toEqual({ low: 0.1, mid: 0.9, high: 0.3 });
    expect(updatedUnselected.absorption).toEqual(unselected.absorption);
  });

  test('applies to every selected box at once', () => {
    roomBoxes.value = [buildBox({ id: 'a' }), buildBox({ id: 'b' }), buildBox({ id: 'c' })];
    selectedBoxIds.value = new Set(['a', 'c']);

    updateSelectedBoxesAbsorptionBand('low', 0.5);

    const byId = Object.fromEntries(roomBoxes.value.map(box => [box.id, box]));
    expect(byId.a.absorption.low).toBe(0.5);
    expect(byId.c.absorption.low).toBe(0.5);
    expect(byId.b.absorption.low).toBe(0.1);
  });
});

describe('updateSelectedBoxesMaterial', () => {
  test('sets materialId and prefills absorption from the material, without touching textureIntensity', () => {
    const box = buildBox({ materialId: 'generic-object', textureIntensity: 1.6 });
    roomBoxes.value = [box];
    selectedBoxIds.value = new Set([box.id]);

    updateSelectedBoxesMaterial('concrete');

    const updated = roomBoxes.value[0];
    expect(updated.materialId).toBe('concrete');
    expect(updated.absorption).toEqual(getRoomMaterial('concrete').absorption);
    expect(updated.textureIntensity).toBe(1.6);
  });

  test('applies to every selected box', () => {
    roomBoxes.value = [buildBox({ id: 'a' }), buildBox({ id: 'b' })];
    selectedBoxIds.value = new Set(['a', 'b']);

    updateSelectedBoxesMaterial('glass');

    for (const box of roomBoxes.value) {
      expect(box.materialId).toBe('glass');
      expect(box.absorption).toEqual(getRoomMaterial('glass').absorption);
    }
  });
});

describe('updateSelectedBoxesTextureIntensity', () => {
  test('sets textureIntensity on every selected box', () => {
    roomBoxes.value = [buildBox({ id: 'a' }), buildBox({ id: 'b' })];
    selectedBoxIds.value = new Set(['a']);

    updateSelectedBoxesTextureIntensity(0.4);

    const byId = Object.fromEntries(roomBoxes.value.map(box => [box.id, box]));
    expect(byId.a.textureIntensity).toBe(0.4);
    expect(byId.b.textureIntensity).toBe(1);
  });

  test('clamps below 0 up to 0', () => {
    const box = buildBox();
    roomBoxes.value = [box];
    selectedBoxIds.value = new Set([box.id]);
    updateSelectedBoxesTextureIntensity(-3);
    expect(roomBoxes.value[0].textureIntensity).toBe(0);
  });

  test('clamps above 2 down to 2', () => {
    const box = buildBox();
    roomBoxes.value = [box];
    selectedBoxIds.value = new Set([box.id]);
    updateSelectedBoxesTextureIntensity(9);
    expect(roomBoxes.value[0].textureIntensity).toBe(2);
  });
});

describe('removeSelectedBoxes', () => {
  test('removes exactly the selected boxes and clears the selection', () => {
    roomBoxes.value = [buildBox({ id: 'a' }), buildBox({ id: 'b' }), buildBox({ id: 'c' })];
    selectedBoxIds.value = new Set(['a', 'c']);

    removeSelectedBoxes();

    expect(roomBoxes.value.map(box => box.id)).toEqual(['b']);
    expect(selectedBoxIds.value.size).toBe(0);
  });

  test('is a no-op when nothing is selected', () => {
    roomBoxes.value = [buildBox({ id: 'a' })];
    selectedBoxIds.value = new Set();

    removeSelectedBoxes();

    expect(roomBoxes.value.map(box => box.id)).toEqual(['a']);
  });
});

describe('moveSelectedBoxes', () => {
  test('applies the same delta to every selected box, leaving unselected boxes untouched', () => {
    roomBoxes.value = [buildBox({ id: 'a', x: 0, z: 0 }), buildBox({ id: 'b', x: 5, z: 5 }), buildBox({ id: 'c', x: 10, z: 10 })];
    selectedBoxIds.value = new Set(['a', 'b']);

    moveSelectedBoxes(TOP_VIEW_AXES, 2, -1);

    const byId = Object.fromEntries(roomBoxes.value.map(box => [box.id, box]));
    expect(byId.a.x).toBe(2);
    expect(byId.a.z).toBe(-1);
    expect(byId.b.x).toBe(7);
    expect(byId.b.z).toBe(4);
    expect(byId.c.x).toBe(10);
    expect(byId.c.z).toBe(10);
  });
});
