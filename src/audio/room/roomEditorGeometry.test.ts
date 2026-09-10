import { describe, expect, test } from 'vitest';
import {
  collectSnapCandidates,
  computeBoxMoveSnapOffset,
  createBoxFromDrag,
  distanceFromPointToRect,
  doRectsIntersect,
  findNearestBoxDistance,
  getBoxesIntersectingRect,
  hitTestAllBoxesAtPoint,
  hitTestBox,
  hitTestResizeHandle,
  moveBoxOnAxes,
  resizeBoxOnAxes,
  snapPointToCandidates,
  type OrthographicAxes,
  type Rect2D,
} from './roomEditorGeometry';
import type { RoomBox } from './roomTypes';

const TOP_VIEW_AXES: OrthographicAxes = { horizontal: 'x', vertical: 'z' };
const ABSORPTION = { low: 0.1, mid: 0.1, high: 0.1 };

function buildBox(overrides: Partial<RoomBox> = {}): RoomBox {
  return {
    id: 'box-1',
    kind: 'object',
    x: 0,
    y: 0,
    z: 0,
    width: 4,
    height: 2.5,
    depth: 3,
    absorption: ABSORPTION,
    materialId: 'generic-object',
    textureIntensity: 1,
    ...overrides,
  };
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

describe('hitTestAllBoxesAtPoint', () => {
  test('returns every overlapping box, topmost first', () => {
    const back = buildBox({ id: 'back' });
    const front = buildBox({ id: 'front' });
    const hits = hitTestAllBoxesAtPoint({ horizontal: 2, vertical: 1 }, [back, front], TOP_VIEW_AXES);
    expect(hits.map(box => box.id)).toEqual(['front', 'back']);
  });

  test('returns an empty array when the point falls outside every box', () => {
    const box = buildBox();
    expect(hitTestAllBoxesAtPoint({ horizontal: 20, vertical: 20 }, [box], TOP_VIEW_AXES)).toEqual([]);
  });

  test('a single hit matches what hitTestBox resolves to', () => {
    const box = buildBox();
    const hits = hitTestAllBoxesAtPoint({ horizontal: 2, vertical: 1 }, [box], TOP_VIEW_AXES);
    expect(hits[0]).toBe(hitTestBox({ horizontal: 2, vertical: 1 }, [box], TOP_VIEW_AXES));
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
    const box = createBoxFromDrag('new-box', 'absorber', 'generic-absorber', ABSORPTION, { horizontal: 1, vertical: 1 }, { horizontal: 3, vertical: 4 }, TOP_VIEW_AXES);

    expect(box.kind).toBe('absorber');
    expect(box.materialId).toBe('generic-absorber');
    expect(box.textureIntensity).toBe(1);
    expect(box.x).toBe(1);
    expect(box.width).toBe(2);
    expect(box.z).toBe(1);
    expect(box.depth).toBe(3);
    expect(box.y).toBe(0);
    expect(box.height).toBeGreaterThan(0);
  });

  test('normalizes a drag made from bottom-right to top-left', () => {
    const box = createBoxFromDrag('new-box', 'object', 'generic-object', ABSORPTION, { horizontal: 5, vertical: 5 }, { horizontal: 2, vertical: 1 }, TOP_VIEW_AXES);
    expect(box.x).toBe(2);
    expect(box.width).toBe(3);
    expect(box.z).toBe(1);
    expect(box.depth).toBe(4);
  });
});

describe('doRectsIntersect', () => {
  const rect = (overrides: Partial<Rect2D> = {}): Rect2D => ({ left: 0, top: 0, width: 4, height: 3, ...overrides });

  test('detects a partial overlap', () => {
    expect(doRectsIntersect(rect(), rect({ left: 2, top: 1 }))).toBe(true);
  });

  test('detects full containment in either direction', () => {
    const outer = rect({ width: 10, height: 10 });
    const inner = rect({ left: 3, top: 3, width: 1, height: 1 });
    expect(doRectsIntersect(outer, inner)).toBe(true);
    expect(doRectsIntersect(inner, outer)).toBe(true);
  });

  test('reports no overlap for rects that are entirely apart', () => {
    expect(doRectsIntersect(rect(), rect({ left: 20, top: 20 }))).toBe(false);
  });

  test('treats touching edges as intersecting', () => {
    expect(doRectsIntersect(rect(), rect({ left: 4, top: 0 }))).toBe(true);
  });
});

describe('getBoxesIntersectingRect', () => {
  test('returns every box whose projected rect overlaps the given rect', () => {
    const inside = buildBox({ id: 'inside' });
    const outside = buildBox({ id: 'outside', x: 100, z: 100 });
    const marqueeRect: Rect2D = { left: -1, top: -1, width: 6, height: 5 };
    const hits = getBoxesIntersectingRect(marqueeRect, [inside, outside], TOP_VIEW_AXES);
    expect(hits.map(box => box.id)).toEqual(['inside']);
  });

  test('returns an empty array when nothing overlaps', () => {
    const box = buildBox();
    const marqueeRect: Rect2D = { left: 100, top: 100, width: 1, height: 1 };
    expect(getBoxesIntersectingRect(marqueeRect, [box], TOP_VIEW_AXES)).toEqual([]);
  });
});

describe('collectSnapCandidates', () => {
  test('always includes the origin (0) on both axes, even with no boxes', () => {
    const candidates = collectSnapCandidates([], TOP_VIEW_AXES, new Set());
    expect(candidates.horizontal).toContain(0);
    expect(candidates.vertical).toContain(0);
  });

  test("includes every box's left/right/center edges and top/bottom/center edges", () => {
    const box = buildBox({ id: 'a', x: 2, z: 5, width: 4, depth: 3 });
    const candidates = collectSnapCandidates([box], TOP_VIEW_AXES, new Set());
    expect(candidates.horizontal).toEqual(expect.arrayContaining([2, 6, 4]));
    expect(candidates.vertical).toEqual(expect.arrayContaining([5, 8, 6.5]));
  });

  test('excludes boxes whose id is in excludeBoxIds', () => {
    const box = buildBox({ id: 'excluded', x: 9, z: 9 });
    const candidates = collectSnapCandidates([box], TOP_VIEW_AXES, new Set(['excluded']));
    expect(candidates.horizontal).not.toContain(9);
    expect(candidates.vertical).not.toContain(9);
  });

  test('includes extra caller-supplied points', () => {
    const candidates = collectSnapCandidates([], TOP_VIEW_AXES, new Set(), [{ horizontal: 1.5, vertical: -2.5 }]);
    expect(candidates.horizontal).toContain(1.5);
    expect(candidates.vertical).toContain(-2.5);
  });
});

describe('snapPointToCandidates', () => {
  test('snaps each axis independently to the nearest candidate within tolerance', () => {
    const candidates = { horizontal: [0, 5], vertical: [0, 3] };
    const snapped = snapPointToCandidates({ horizontal: 0.2, vertical: 2.9 }, candidates, 0.5);
    expect(snapped).toEqual({ horizontal: 0, vertical: 3 });
  });

  test('leaves a point unchanged when nothing is within tolerance', () => {
    const candidates = { horizontal: [0], vertical: [0] };
    const point = { horizontal: 10, vertical: 10 };
    expect(snapPointToCandidates(point, candidates, 0.5)).toEqual(point);
  });
});

describe('computeBoxMoveSnapOffset', () => {
  const candidates = { horizontal: [0, 10], vertical: [0, 10] };

  test('snaps the closest matching edge, not just the top-left corner', () => {
    // Right edge (rect.left + rect.width = 9.8) is within tolerance of the candidate at 10; left edge (5.8)
    // and center (7.8) are not.
    const rect: Rect2D = { left: 5.8, top: 0, width: 4, height: 1 };
    const offset = computeBoxMoveSnapOffset(rect, candidates, 0.5);
    expect(offset.horizontal).toBeCloseTo(0.2);
  });

  test('returns {0, 0} when nothing is within tolerance on either axis', () => {
    const rect: Rect2D = { left: 50, top: 50, width: 4, height: 1 };
    expect(computeBoxMoveSnapOffset(rect, candidates, 0.5)).toEqual({ horizontal: 0, vertical: 0 });
  });

  test('resolves horizontal and vertical independently', () => {
    // Left edge (0.1) is near the horizontal candidate at 0; nothing on the vertical axis is close.
    const rect: Rect2D = { left: 0.1, top: 50, width: 4, height: 1 };
    const offset = computeBoxMoveSnapOffset(rect, candidates, 0.5);
    expect(offset.horizontal).toBeCloseTo(-0.1);
    expect(offset.vertical).toBe(0);
  });
});

describe('distanceFromPointToRect', () => {
  const rect: Rect2D = { left: 0, top: 0, width: 4, height: 3 };

  test('is 0 for a point inside the rect', () => {
    expect(distanceFromPointToRect({ horizontal: 2, vertical: 1 }, rect)).toBe(0);
  });

  test('is the straight-line distance to the nearest edge for a point outside the rect', () => {
    expect(distanceFromPointToRect({ horizontal: 7, vertical: 0 }, rect)).toBeCloseTo(3);
  });

  test('is the distance to the nearest corner when the point is diagonally outside', () => {
    expect(distanceFromPointToRect({ horizontal: 7, vertical: 7 }, rect)).toBeCloseTo(Math.hypot(3, 4));
  });
});

describe('findNearestBoxDistance', () => {
  test('returns null when there are no boxes', () => {
    expect(findNearestBoxDistance({ horizontal: 0, vertical: 0 }, [], TOP_VIEW_AXES)).toBeNull();
  });

  test('returns the distance to the closest of several boxes', () => {
    const near = buildBox({ id: 'near', x: 10, z: 0, width: 1, depth: 1 });
    const far = buildBox({ id: 'far', x: 100, z: 0, width: 1, depth: 1 });
    const distance = findNearestBoxDistance({ horizontal: 8, vertical: 0 }, [near, far], TOP_VIEW_AXES);
    expect(distance).toBeCloseTo(2);
  });
});
