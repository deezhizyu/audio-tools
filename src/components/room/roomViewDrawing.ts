import type { RoomBox, RoomPoint3D } from '../../audio/room/roomTypes';
import { getBoxRectOnAxes, type OrthographicAxes, type Point2D, type Rect2D } from '../../audio/room/roomEditorGeometry';

/** How many world meters are visible across the canvas width, and which world point sits at the canvas's
    center — together these define one view's pan/zoom state. Kept per-view (not global), since panning the
    Top view has no reason to move the Front or Side view. */
export interface ViewTransform {
  spanMeters: number;
  center: Point2D;
}

export const DEFAULT_VIEW_TRANSFORM: ViewTransform = { spanMeters: 12, center: { horizontal: 0, vertical: 0 } };
export const MINIMUM_VIEW_SPAN_METERS = 1.5;
export const MAXIMUM_VIEW_SPAN_METERS = 60;

const RESIZE_HANDLE_HALF_SIZE_PIXELS = 4;
const MARKER_RADIUS_PIXELS = 6;

export interface RoomViewTheme {
  gridColor: string;
  wallColor: string;
  absorberColor: string;
  selectedOutlineColor: string;
  sourceColor: string;
  listenerColor: string;
}

export interface RoomViewDrawParams {
  widthPixels: number;
  heightPixels: number;
  boxes: RoomBox[];
  axes: OrthographicAxes;
  selectedBoxId: string | null;
  source: RoomPoint3D;
  listener: RoomPoint3D;
  theme: RoomViewTheme;
  transform: ViewTransform;
}

/** Scale is always derived from the canvas width (not `min(width, height)`) so `transform.spanMeters`
    reliably describes what's horizontally visible regardless of how wide a given view's container ends up —
    the vertical extent then just falls out of the canvas's fixed height at that same (isotropic, so a square
    box still looks square) scale. */
export function pixelsPerMeter(widthPixels: number, spanMeters: number): number {
  return widthPixels / spanMeters;
}

export function worldToPixel(point: Point2D, widthPixels: number, heightPixels: number, transform: ViewTransform): Point2D {
  const scale = pixelsPerMeter(widthPixels, transform.spanMeters);
  return {
    horizontal: widthPixels / 2 + (point.horizontal - transform.center.horizontal) * scale,
    vertical: heightPixels / 2 + (point.vertical - transform.center.vertical) * scale,
  };
}

export function pixelToWorld(pixel: Point2D, widthPixels: number, heightPixels: number, transform: ViewTransform): Point2D {
  const scale = pixelsPerMeter(widthPixels, transform.spanMeters);
  return {
    horizontal: transform.center.horizontal + (pixel.horizontal - widthPixels / 2) / scale,
    vertical: transform.center.vertical + (pixel.vertical - heightPixels / 2) / scale,
  };
}

/** Adjusts a view transform to zoom by `zoomFactor` (< 1 zooms in) while keeping the world point currently
    under `cursorPixel` fixed on screen — the usual "zoom toward the cursor" feel, rather than always zooming
    toward the view's center. */
export function zoomViewTransform(transform: ViewTransform, zoomFactor: number, cursorPixel: Point2D, widthPixels: number, heightPixels: number): ViewTransform {
  const worldUnderCursor = pixelToWorld(cursorPixel, widthPixels, heightPixels, transform);
  const newSpanMeters = Math.min(MAXIMUM_VIEW_SPAN_METERS, Math.max(MINIMUM_VIEW_SPAN_METERS, transform.spanMeters * zoomFactor));
  const newScale = pixelsPerMeter(widthPixels, newSpanMeters);

  return {
    spanMeters: newSpanMeters,
    center: {
      horizontal: worldUnderCursor.horizontal - (cursorPixel.horizontal - widthPixels / 2) / newScale,
      vertical: worldUnderCursor.vertical - (cursorPixel.vertical - heightPixels / 2) / newScale,
    },
  };
}

/** Pans a view transform so the content appears to be dragged by `deltaPixels` (e.g. a middle-mouse drag). */
export function panViewTransform(transform: ViewTransform, deltaPixels: Point2D, widthPixels: number): ViewTransform {
  const scale = pixelsPerMeter(widthPixels, transform.spanMeters);
  return {
    spanMeters: transform.spanMeters,
    center: {
      horizontal: transform.center.horizontal - deltaPixels.horizontal / scale,
      vertical: transform.center.vertical - deltaPixels.vertical / scale,
    },
  };
}

function pointOnAxes(point: RoomPoint3D, axes: OrthographicAxes): Point2D {
  return { horizontal: point[axes.horizontal], vertical: point[axes.vertical] };
}

const NICE_GRID_STEP_CANDIDATES_METERS = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100];
const TARGET_GRID_DIVISIONS = 12;

/** Picks a "nice" grid spacing (0.1m, 0.2m, 0.5m, 1m, 2m, ...) close to `spanMeters / 12`, so the grid stays
    readable — neither a handful of lines when zoomed out nor a dense mess when zoomed in. */
function chooseGridStepMeters(spanMeters: number): number {
  const idealStepMeters = spanMeters / TARGET_GRID_DIVISIONS;
  return NICE_GRID_STEP_CANDIDATES_METERS.reduce((closest, candidate) =>
    Math.abs(candidate - idealStepMeters) < Math.abs(closest - idealStepMeters) ? candidate : closest,
  );
}

function drawGrid(context: CanvasRenderingContext2D, widthPixels: number, heightPixels: number, transform: ViewTransform, gridColor: string): void {
  const topLeftWorld = pixelToWorld({ horizontal: 0, vertical: 0 }, widthPixels, heightPixels, transform);
  const bottomRightWorld = pixelToWorld({ horizontal: widthPixels, vertical: heightPixels }, widthPixels, heightPixels, transform);
  const gridStepMeters = chooseGridStepMeters(transform.spanMeters);

  context.strokeStyle = gridColor;
  context.lineWidth = 1;
  context.beginPath();
  const firstVerticalLineX = Math.floor(topLeftWorld.horizontal / gridStepMeters) * gridStepMeters;
  for (let worldX = firstVerticalLineX; worldX <= bottomRightWorld.horizontal; worldX += gridStepMeters) {
    const pixelX = worldToPixel({ horizontal: worldX, vertical: 0 }, widthPixels, heightPixels, transform).horizontal;
    context.moveTo(pixelX, 0);
    context.lineTo(pixelX, heightPixels);
  }
  const firstHorizontalLineY = Math.floor(topLeftWorld.vertical / gridStepMeters) * gridStepMeters;
  for (let worldY = firstHorizontalLineY; worldY <= bottomRightWorld.vertical; worldY += gridStepMeters) {
    const pixelY = worldToPixel({ horizontal: 0, vertical: worldY }, widthPixels, heightPixels, transform).vertical;
    context.moveTo(0, pixelY);
    context.lineTo(widthPixels, pixelY);
  }
  context.stroke();

  // Origin axes drawn brighter than the rest of the grid so it reads as a fixed reference point across views.
  const origin = worldToPixel({ horizontal: 0, vertical: 0 }, widthPixels, heightPixels, transform);
  context.globalAlpha = 0.6;
  context.beginPath();
  context.moveTo(origin.horizontal, 0);
  context.lineTo(origin.horizontal, heightPixels);
  context.moveTo(0, origin.vertical);
  context.lineTo(widthPixels, origin.vertical);
  context.stroke();
  context.globalAlpha = 1;
}

function rectCorners(rect: Rect2D): Point2D[] {
  return [
    { horizontal: rect.left, vertical: rect.top },
    { horizontal: rect.left + rect.width, vertical: rect.top },
    { horizontal: rect.left, vertical: rect.top + rect.height },
    { horizontal: rect.left + rect.width, vertical: rect.top + rect.height },
  ];
}

function drawResizeHandles(context: CanvasRenderingContext2D, rect: Rect2D, params: RoomViewDrawParams): void {
  context.fillStyle = params.theme.selectedOutlineColor;
  for (const corner of rectCorners(rect)) {
    const pixel = worldToPixel(corner, params.widthPixels, params.heightPixels, params.transform);
    context.fillRect(
      pixel.horizontal - RESIZE_HANDLE_HALF_SIZE_PIXELS,
      pixel.vertical - RESIZE_HANDLE_HALF_SIZE_PIXELS,
      RESIZE_HANDLE_HALF_SIZE_PIXELS * 2,
      RESIZE_HANDLE_HALF_SIZE_PIXELS * 2,
    );
  }
}

function drawBox(context: CanvasRenderingContext2D, box: RoomBox, params: RoomViewDrawParams, isSelected: boolean): void {
  const rect = getBoxRectOnAxes(box, params.axes);
  const topLeft = worldToPixel({ horizontal: rect.left, vertical: rect.top }, params.widthPixels, params.heightPixels, params.transform);
  const bottomRight = worldToPixel({ horizontal: rect.left + rect.width, vertical: rect.top + rect.height }, params.widthPixels, params.heightPixels, params.transform);
  const pixelWidth = bottomRight.horizontal - topLeft.horizontal;
  const pixelHeight = bottomRight.vertical - topLeft.vertical;

  const fillColor = box.kind === 'wall' ? params.theme.wallColor : params.theme.absorberColor;
  context.globalAlpha = 0.35;
  context.fillStyle = fillColor;
  context.fillRect(topLeft.horizontal, topLeft.vertical, pixelWidth, pixelHeight);
  context.globalAlpha = 1;

  context.strokeStyle = isSelected ? params.theme.selectedOutlineColor : fillColor;
  context.lineWidth = isSelected ? 2.5 : 1.5;
  context.strokeRect(topLeft.horizontal, topLeft.vertical, pixelWidth, pixelHeight);

  if (isSelected) drawResizeHandles(context, rect, params);
}

function drawMarker(context: CanvasRenderingContext2D, point: Point2D, color: string): void {
  context.fillStyle = color;
  context.beginPath();
  context.arc(point.horizontal, point.vertical, MARKER_RADIUS_PIXELS, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = 'rgba(0, 0, 0, 0.4)';
  context.lineWidth = 1.5;
  context.stroke();
}

export function drawRoomOrthographicView(context: CanvasRenderingContext2D, params: RoomViewDrawParams): void {
  context.clearRect(0, 0, params.widthPixels, params.heightPixels);
  drawGrid(context, params.widthPixels, params.heightPixels, params.transform, params.theme.gridColor);

  for (const box of params.boxes) {
    drawBox(context, box, params, box.id === params.selectedBoxId);
  }

  drawMarker(
    context,
    worldToPixel(pointOnAxes(params.source, params.axes), params.widthPixels, params.heightPixels, params.transform),
    params.theme.sourceColor,
  );
  drawMarker(
    context,
    worldToPixel(pointOnAxes(params.listener, params.axes), params.widthPixels, params.heightPixels, params.transform),
    params.theme.listenerColor,
  );
}
