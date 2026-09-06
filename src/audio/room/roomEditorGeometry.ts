import type { FrequencyBandValues, RoomBox, RoomBoxKind } from './roomTypes';

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

/** The topmost (last-drawn) box containing the point, matching how a click should resolve when boxes overlap
    in this view's projection. */
export function hitTestBox(point: Point2D, boxes: RoomBox[], axes: OrthographicAxes): RoomBox | null {
  for (let index = boxes.length - 1; index >= 0; index--) {
    if (isPointInRect(point, getBoxRectOnAxes(boxes[index], axes))) return boxes[index];
  }
  return null;
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

export function createBoxFromDrag(
  id: string,
  kind: RoomBoxKind,
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

  return { id, kind, absorption, x: position.x, y: position.y, z: position.z, width: size.x, height: size.y, depth: size.z };
}
