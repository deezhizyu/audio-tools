import type { FrequencyBandValues, RoomBox, RoomBoxKind, RoomMaterialId } from './roomTypes';

export type RoomAxis = 'x' | 'y' | 'z';
export type ResizeHandle = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/** Which two of the room's three axes a given orthographic view edits — top: x/z, front: x/y, side: z/y. Every
    view (`RoomOrthographicView.tsx`) shares this one set of pure functions rather than three near-duplicate
    implementations, one per view. */
export interface OrthographicAxes {
  horizontal: RoomAxis;
  vertical: RoomAxis;
}

export interface Point2D {
  horizontal: number;
  vertical: number;
}

export interface Rect2D {
  left: number;
  top: number;
  width: number;
  height: number;
}

export const MINIMUM_BOX_SIZE_METERS = 0.1;
/** Used for whichever axis a given 2D view doesn't edit when a box is first created — a typical room height,
    reasonable as a starting size on any axis until the user adjusts it via the numeric readout. */
export const DEFAULT_THIRD_AXIS_EXTENT_METERS = 2.5;

function positionField(axis: RoomAxis): 'x' | 'y' | 'z' {
  return axis;
}

function sizeField(axis: RoomAxis): 'width' | 'height' | 'depth' {
  if (axis === 'x') return 'width';
  if (axis === 'y') return 'height';
  return 'depth';
}

export function getBoxRectOnAxes(box: RoomBox, axes: OrthographicAxes): Rect2D {
  return {
    left: box[positionField(axes.horizontal)],
    top: box[positionField(axes.vertical)],
    width: box[sizeField(axes.horizontal)],
    height: box[sizeField(axes.vertical)],
  };
}

function isPointInRect(point: Point2D, rect: Rect2D): boolean {
  return (
    point.horizontal >= rect.left &&
    point.horizontal <= rect.left + rect.width &&
    point.vertical >= rect.top &&
    point.vertical <= rect.top + rect.height
  );
}

/** Every box containing the point, topmost (last-drawn) first — lets the caller cycle through an occluded
    stack (e.g. clicking through a ceiling to reach a box underneath) instead of only ever reaching the top
    hit. */
export function hitTestAllBoxesAtPoint(point: Point2D, boxes: RoomBox[], axes: OrthographicAxes): RoomBox[] {
  const hits: RoomBox[] = [];
  for (let index = boxes.length - 1; index >= 0; index--) {
    if (isPointInRect(point, getBoxRectOnAxes(boxes[index], axes))) hits.push(boxes[index]);
  }
  return hits;
}

/** The topmost (last-drawn) box containing the point, matching how a click should resolve when boxes overlap
    in this view's projection. */
export function hitTestBox(point: Point2D, boxes: RoomBox[], axes: OrthographicAxes): RoomBox | null {
  return hitTestAllBoxesAtPoint(point, boxes, axes)[0] ?? null;
}

/** Whether two axis-projected rects overlap at all (including edge-touching), used for marquee/rubber-band
    selection. */
export function doRectsIntersect(a: Rect2D, b: Rect2D): boolean {
  return a.left <= b.left + b.width && a.left + a.width >= b.left && a.top <= b.top + b.height && a.top + a.height >= b.top;
}

/** Every box whose projected rect intersects the given rect, in no particular order — used to resolve a
    marquee/rubber-band selection drag. */
export function getBoxesIntersectingRect(rect: Rect2D, boxes: RoomBox[], axes: OrthographicAxes): RoomBox[] {
  return boxes.filter(box => doRectsIntersect(rect, getBoxRectOnAxes(box, axes)));
}

const RESIZE_HANDLES: ResizeHandle[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

function rectCorner(rect: Rect2D, handle: ResizeHandle): Point2D {
  return {
    horizontal: handle === 'top-left' || handle === 'bottom-left' ? rect.left : rect.left + rect.width,
    vertical: handle === 'top-left' || handle === 'top-right' ? rect.top : rect.top + rect.height,
  };
}

function oppositeHandle(handle: ResizeHandle): ResizeHandle {
  if (handle === 'top-left') return 'bottom-right';
  if (handle === 'top-right') return 'bottom-left';
  if (handle === 'bottom-left') return 'top-right';
  return 'top-left';
}

export function hitTestResizeHandle(point: Point2D, box: RoomBox, axes: OrthographicAxes, handleRadius: number): ResizeHandle | null {
  const rect = getBoxRectOnAxes(box, axes);
  for (const handle of RESIZE_HANDLES) {
    const corner = rectCorner(rect, handle);
    if (Math.hypot(point.horizontal - corner.horizontal, point.vertical - corner.vertical) <= handleRadius) return handle;
  }
  return null;
}

export function moveBoxOnAxes(box: RoomBox, axes: OrthographicAxes, deltaHorizontal: number, deltaVertical: number): RoomBox {
  return {
    ...box,
    [positionField(axes.horizontal)]: box[positionField(axes.horizontal)] + deltaHorizontal,
    [positionField(axes.vertical)]: box[positionField(axes.vertical)] + deltaVertical,
  };
}

/** Resizes a box by dragging one corner handle, keeping the opposite corner fixed and enforcing a minimum size
    so a box can never be dragged down to (or past) zero size. */
export function resizeBoxOnAxes(box: RoomBox, axes: OrthographicAxes, handle: ResizeHandle, point: Point2D): RoomBox {
  const rect = getBoxRectOnAxes(box, axes);
  const anchor = rectCorner(rect, oppositeHandle(handle));

  const newLeft = Math.min(anchor.horizontal, point.horizontal);
  const newWidth = Math.max(MINIMUM_BOX_SIZE_METERS, Math.abs(point.horizontal - anchor.horizontal));
  const newTop = Math.min(anchor.vertical, point.vertical);
  const newHeight = Math.max(MINIMUM_BOX_SIZE_METERS, Math.abs(point.vertical - anchor.vertical));

  return {
    ...box,
    [positionField(axes.horizontal)]: newLeft,
    [sizeField(axes.horizontal)]: newWidth,
    [positionField(axes.vertical)]: newTop,
    [sizeField(axes.vertical)]: newHeight,
  };
}

/** Candidate world-space positions a drag can snap to, kept separate per axis since horizontal and vertical
    alignment are resolved independently (a box can align its left edge with one box while its top edge aligns
    with a completely different one). */
export interface SnapCandidates {
  horizontal: number[];
  vertical: number[];
}

/** Builds the set of positions a drag in this view can snap to: the origin (0 — where the two drawn axis
    lines cross) plus every edge and center of every box except `excludeBoxIds` (typically the box(es) being
    dragged themselves, which obviously shouldn't snap to their own edges), plus any caller-supplied extra
    points (e.g. the other marker's position, so the source can snap to the listener and vice versa). */
export function collectSnapCandidates(
  boxes: RoomBox[],
  axes: OrthographicAxes,
  excludeBoxIds: ReadonlySet<string>,
  extraPoints: Point2D[] = [],
): SnapCandidates {
  const horizontal = new Set<number>([0]);
  const vertical = new Set<number>([0]);

  for (const box of boxes) {
    if (excludeBoxIds.has(box.id)) continue;
    const rect = getBoxRectOnAxes(box, axes);
    horizontal.add(rect.left);
    horizontal.add(rect.left + rect.width);
    horizontal.add(rect.left + rect.width / 2);
    vertical.add(rect.top);
    vertical.add(rect.top + rect.height);
    vertical.add(rect.top + rect.height / 2);
  }

  for (const point of extraPoints) {
    horizontal.add(point.horizontal);
    vertical.add(point.vertical);
  }

  return { horizontal: [...horizontal], vertical: [...vertical] };
}

function snapValueToCandidates(value: number, candidates: number[], toleranceWorld: number): number {
  let closestValue = value;
  let closestDistance = toleranceWorld;
  for (const candidate of candidates) {
    const distance = Math.abs(candidate - value);
    if (distance <= closestDistance) {
      closestValue = candidate;
      closestDistance = distance;
    }
  }
  return closestValue;
}

/** Snaps a bare point's horizontal/vertical components independently to the nearest candidate within
    tolerance — used for drags that move a single point directly (a resize handle, a create-box drag corner,
    the source/listener markers), as opposed to a box move, which snaps by edge (see
    `computeBoxMoveSnapOffset`). */
export function snapPointToCandidates(point: Point2D, candidates: SnapCandidates, toleranceWorld: number): Point2D {
  return {
    horizontal: snapValueToCandidates(point.horizontal, candidates.horizontal, toleranceWorld),
    vertical: snapValueToCandidates(point.vertical, candidates.vertical, toleranceWorld),
  };
}

function computeAxisSnapOffset(edges: number[], candidates: number[], toleranceWorld: number): number {
  let bestOffset = 0;
  let bestDistance = toleranceWorld;
  for (const edge of edges) {
    for (const candidate of candidates) {
      const distance = Math.abs(candidate - edge);
      if (distance <= bestDistance) {
        bestDistance = distance;
        bestOffset = candidate - edge;
      }
    }
  }
  return bestOffset;
}

/** Snaps a box being moved (translated, not resized) by checking every one of its edges and its center against
    the candidate positions on each axis independently, returning the offset that would align the single
    closest-matching edge — e.g. dragging a box's right edge flush against a neighboring box's left edge, even
    though the box's own left/center didn't land near anything. Returns `{0, 0}` when nothing is within
    tolerance on either axis, so the caller can just add this to the drag's raw delta unconditionally. */
export function computeBoxMoveSnapOffset(rect: Rect2D, candidates: SnapCandidates, toleranceWorld: number): Point2D {
  const horizontalEdges = [rect.left, rect.left + rect.width, rect.left + rect.width / 2];
  const verticalEdges = [rect.top, rect.top + rect.height, rect.top + rect.height / 2];
  return {
    horizontal: computeAxisSnapOffset(horizontalEdges, candidates.horizontal, toleranceWorld),
    vertical: computeAxisSnapOffset(verticalEdges, candidates.vertical, toleranceWorld),
  };
}

/** Distance from a point to the nearest point on (or inside) a rect — 0 when the point is inside the rect. */
export function distanceFromPointToRect(point: Point2D, rect: Rect2D): number {
  const clampedHorizontal = Math.min(Math.max(point.horizontal, rect.left), rect.left + rect.width);
  const clampedVertical = Math.min(Math.max(point.vertical, rect.top), rect.top + rect.height);
  return Math.hypot(point.horizontal - clampedHorizontal, point.vertical - clampedVertical);
}

/** The distance from `point` to whichever box (projected onto `axes`) is closest, or `null` when there are no
    boxes to measure against. Used to show "how far is the listener from the nearest object" while dragging. */
export function findNearestBoxDistance(point: Point2D, boxes: RoomBox[], axes: OrthographicAxes): number | null {
  if (boxes.length === 0) return null;
  return Math.min(...boxes.map(box => distanceFromPointToRect(point, getBoxRectOnAxes(box, axes))));
}

export function createBoxFromDrag(
  id: string,
  kind: RoomBoxKind,
  materialId: RoomMaterialId,
  absorption: FrequencyBandValues,
  startPoint: Point2D,
  endPoint: Point2D,
  axes: OrthographicAxes,
): RoomBox {
  const position: Record<RoomAxis, number> = { x: 0, y: 0, z: 0 };
  const size: Record<RoomAxis, number> = { x: DEFAULT_THIRD_AXIS_EXTENT_METERS, y: DEFAULT_THIRD_AXIS_EXTENT_METERS, z: DEFAULT_THIRD_AXIS_EXTENT_METERS };

  position[axes.horizontal] = Math.min(startPoint.horizontal, endPoint.horizontal);
  size[axes.horizontal] = Math.max(MINIMUM_BOX_SIZE_METERS, Math.abs(endPoint.horizontal - startPoint.horizontal));
  position[axes.vertical] = Math.min(startPoint.vertical, endPoint.vertical);
  size[axes.vertical] = Math.max(MINIMUM_BOX_SIZE_METERS, Math.abs(endPoint.vertical - startPoint.vertical));

  return { id, kind, materialId, textureIntensity: 1, absorption, x: position.x, y: position.y, z: position.z, width: size.x, height: size.y, depth: size.z };
}
