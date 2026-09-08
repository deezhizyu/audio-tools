import { describe, expect, test } from 'vitest';
import {
  createBoxFromDrag,
  hitTestBox,
  hitTestResizeHandle,
  moveBoxOnAxes,
  resizeBoxOnAxes,
  type OrthographicAxes,
} from './roomEditorGeometry';
import type { RoomBox } from './roomTypes';

const TOP_VIEW_AXES: OrthographicAxes = { horizontal: 'x', vertical: 'z' };
const ABSORPTION = { low: 0.1, mid: 0.1, high: 0.1 };

function buildBox(overrides: Partial<RoomBox> = {}): RoomBox {
  return { id: 'box-1', kind: 'wall', x: 0, y: 0, z: 0, width: 4, height: 2.5, depth: 3, absorption: ABSORPTION, ...overrides };
}

describe('hitTestBox', () => {
  test('finds a box containing the point, projected onto the view axes', () => {
    const box = buildBox();
    expect(hitTestBox({ horizontal: 2, vertical: 1 }, [box], TOP_VIEW_AXES)).toBe(box);
  });

  test('returns null when the point falls outside every box', () => {
    const box = buildBox();
    expect(hitTestBox({ horizontal: 20, vertical: 20 }, [box], TOP_VIEW_AXES)).toBeNull();
  });

  test('prefers the last (topmost) box when boxes overlap', () => {
    const back = buildBox({ id: 'back' });
    const front = buildBox({ id: 'front' });
    expect(hitTestBox({ horizontal: 2, vertical: 1 }, [back, front], TOP_VIEW_AXES)).toBe(front);
  });
});

describe('hitTestResizeHandle', () => {
  test('detects a point near the bottom-right corner', () => {
    const box = buildBox(); // top view rect: left 0, top 0, width 4, height 3 -> bottom-right at (4, 3)
    expect(hitTestResizeHandle({ horizontal: 4, vertical: 3 }, box, TOP_VIEW_AXES, 0.2)).toBe('bottom-right');
  });

  test('returns null when nowhere near a handle', () => {
    const box = buildBox();
    expect(hitTestResizeHandle({ horizontal: 2, vertical: 1.5 }, box, TOP_VIEW_AXES, 0.2)).toBeNull();
  });
});

describe('moveBoxOnAxes', () => {
  test('shifts position on the view axes and leaves the third axis untouched', () => {
    const box = buildBox();
    const moved = moveBoxOnAxes(box, TOP_VIEW_AXES, 1, -0.5);
    expect(moved.x).toBe(1);
    expect(moved.z).toBe(-0.5);
    expect(moved.y).toBe(box.y);
    expect(moved.width).toBe(box.width);
  });
});

describe('resizeBoxOnAxes', () => {
  test('dragging the bottom-right handle keeps the top-left corner fixed', () => {
    const box = buildBox();
    const resized = resizeBoxOnAxes(box, TOP_VIEW_AXES, 'bottom-right', { horizontal: 6, vertical: 5 });
    expect(resized.x).toBe(0);
    expect(resized.z).toBe(0);
    expect(resized.width).toBe(6);
    expect(resized.depth).toBe(5);
  });

  test('dragging the top-left handle keeps the bottom-right corner fixed', () => {
    const box = buildBox();
    const resized = resizeBoxOnAxes(box, TOP_VIEW_AXES, 'top-left', { horizontal: -1, vertical: -1 });
    expect(resized.x).toBe(-1);
    expect(resized.z).toBe(-1);
    expect(resized.width).toBe(5); // from x=-1 to the fixed right edge at x=4
    expect(resized.depth).toBe(4); // from z=-1 to the fixed bottom edge at z=3
  });

  test('never shrinks a box below the minimum size', () => {
    const box = buildBox();
    const resized = resizeBoxOnAxes(box, TOP_VIEW_AXES, 'bottom-right', { horizontal: 0.01, vertical: 0.01 });
    expect(resized.width).toBeGreaterThanOrEqual(0.1);
    expect(resized.depth).toBeGreaterThanOrEqual(0.1);
  });
});

describe('createBoxFromDrag', () => {
  test('builds a box from a drag rectangle, defaulting the unedited axis', () => {
    const box = createBoxFromDrag('new-box', 'absorber', ABSORPTION, { horizontal: 1, vertical: 1 }, { horizontal: 3, vertical: 4 }, TOP_VIEW_AXES);

    expect(box.kind).toBe('absorber');
    expect(box.x).toBe(1);
    expect(box.width).toBe(2);
    expect(box.z).toBe(1);
    expect(box.depth).toBe(3);
    expect(box.y).toBe(0);
    expect(box.height).toBeGreaterThan(0);
  });

  test('normalizes a drag made from bottom-right to top-left', () => {
    const box = createBoxFromDrag('new-box', 'wall', ABSORPTION, { horizontal: 5, vertical: 5 }, { horizontal: 2, vertical: 1 }, TOP_VIEW_AXES);
    expect(box.x).toBe(2);
    expect(box.width).toBe(3);
    expect(box.z).toBe(1);
    expect(box.depth).toBe(4);
  });
});
