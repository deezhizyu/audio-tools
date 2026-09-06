import { describe, expect, test } from 'vitest';
import { intersectRayWithBox, type AxisAlignedBox } from './rayBoxIntersection';

function buildUnitBox(): AxisAlignedBox {
  return { minX: -1, minY: -1, minZ: -1, maxX: 1, maxY: 1, maxZ: 1 };
}

describe('intersectRayWithBox', () => {
  test('hits the near face straight on and reports the outward normal', () => {
    const hit = intersectRayWithBox({ origin: { x: -5, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, buildUnitBox());

    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeCloseTo(4);
    expect(hit!.normal).toEqual({ x: -1, y: 0, z: 0 });
  });

  test('hits the far face when approaching from the opposite direction', () => {
    const hit = intersectRayWithBox({ origin: { x: 5, y: 0, z: 0 }, direction: { x: -1, y: 0, z: 0 } }, buildUnitBox());

    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeCloseTo(4);
    expect(hit!.normal).toEqual({ x: 1, y: 0, z: 0 });
  });

  test('reports a diagonal hit on whichever face the ray reaches first', () => {
    const hit = intersectRayWithBox({ origin: { x: -5, y: -5, z: 0 }, direction: { x: 1, y: 1, z: 0 } }, buildUnitBox());

    expect(hit).not.toBeNull();
    // Both axes reach the box at the same distance for a 45-degree approach to a cube's corner region — either
    // face normal is a legitimate answer, so just check the ray actually lands on the box surface.
    expect(hit!.normal.x === -1 || hit!.normal.y === -1).toBe(true);
  });

  test('misses a box entirely to one side', () => {
    const hit = intersectRayWithBox({ origin: { x: -5, y: 10, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, buildUnitBox());
    expect(hit).toBeNull();
  });

  test('misses when traveling away from the box', () => {
    const hit = intersectRayWithBox({ origin: { x: -5, y: 0, z: 0 }, direction: { x: -1, y: 0, z: 0 } }, buildUnitBox());
    expect(hit).toBeNull();
  });

  test('treats a ray parallel to a face outside the box slab as a miss', () => {
    const hit = intersectRayWithBox({ origin: { x: -5, y: 10, z: 0 }, direction: { x: 1, y: 0, z: 0.0000001 } }, buildUnitBox());
    expect(hit).toBeNull();
  });

  test('ignores a hit behind the ray origin (already inside/past the box)', () => {
    const hit = intersectRayWithBox({ origin: { x: 0, y: 0, z: 0 }, direction: { x: 1, y: 0, z: 0 } }, buildUnitBox());
    expect(hit).toBeNull();
  });
});
