import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import {
  collectSnapCandidates,
  computeBoxMoveSnapOffset,
  findNearestBoxDistance,
  getBoxesIntersectingRect,
  getBoxRectOnAxes,
  hitTestAllBoxesAtPoint,
  hitTestResizeHandle,
  resizeBoxOnAxes,
  snapPointToCandidates,
  type OrthographicAxes,
  type Point2D,
  type Rect2D,
  type ResizeHandle,
} from '../../audio/room/roomEditorGeometry';
import type { RoomBox, RoomPoint3D } from '../../audio/room/roomTypes';
import { metersToCentimeters } from '../../utils/unitConversion';
import {
  DEFAULT_VIEW_TRANSFORM,
  drawRoomOrthographicView,
  panViewTransform,
  pixelToWorld,
  pixelsPerMeter,
  worldToPixel,
  zoomViewTransform,
  type RoomViewTheme,
  type ViewTransform,
} from './roomViewDrawing';

export type RoomEditorTool = 'select' | 'add-object' | 'add-absorber';

interface RoomOrthographicViewProps {
  label: string;
  axes: OrthographicAxes;
  horizontalAxisLabel: string;
  verticalAxisLabel: string;
  boxes: RoomBox[];
  selectedBoxIds: ReadonlySet<string>;
  source: RoomPoint3D;
  listener: RoomPoint3D;
  activeTool: RoomEditorTool;
  snapEnabled: boolean;
  onSelectBox: (boxId: string | null) => void;
  onToggleBoxSelection: (boxId: string) => void;
  onMarqueeSelect: (boxIds: string[]) => void;
  onMoveSelectedBoxes: (deltaHorizontal: number, deltaVertical: number) => void;
  onResizeBox: (boxId: string, handle: ResizeHandle, point: Point2D) => void;
  onCreateBox: (startPoint: Point2D, endPoint: Point2D) => void;
  onMoveSource: (point: Point2D) => void;
  onMoveListener: (point: Point2D) => void;
}

const VIEW_HEIGHT_PIXELS = 260;
const MARKER_HIT_RADIUS_PIXELS = 10;
const RESIZE_HANDLE_HIT_RADIUS_PIXELS = 9;
/** Wheel delta -> zoom factor: negative deltaY (scroll up/away) zooms in. Exponential so repeated small wheel
    ticks feel smooth rather than jumping by a fixed step regardless of how hard the wheel was spun. */
const ZOOM_SENSITIVITY = 0.0015;
/** A plain click almost never has zero movement between pointerdown and pointerup — a sub-pixel hand tremor is
    normal. Without this threshold, selecting a box also fired a near-zero move, which schedules a full
    resimulation just from clicking. Only once the pointer has actually moved past this many pixels does a
    press-and-drag on a box/marker turn into a real move. Also doubles as the "same spot" tolerance for
    click-through selection cycling below. */
const CLICK_VS_DRAG_THRESHOLD_PIXELS = 4;
/** How close (in pixels) a drag has to land to a candidate alignment position — an object edge/center or an
    axis — before it snaps to it. Deliberately a bit larger than the click-vs-drag threshold: snapping is meant
    to be easy to land on without fighting the cursor. */
const SNAP_THRESHOLD_PIXELS = 8;

type DragMode =
  | { kind: 'pan'; lastPixelPoint: Point2D }
  | { kind: 'move-source'; startPixelPoint: Point2D; hasCrossedClickThreshold: boolean }
  | { kind: 'move-listener'; startPixelPoint: Point2D; hasCrossedClickThreshold: boolean }
  | {
      kind: 'move-selected-boxes';
      /** The box a plain click resolved to, so `handlePointerUp` can collapse a multi-selection down to just
          this box if the pointer never actually moved (a real click, not a drag) — dragging one member of an
          existing multi-selection should move the whole group, but merely clicking it (no drag) should still
          narrow the selection to that one box, matching conventional design-tool behavior. `null` for a
          Shift+click-started drag, which already applied its own toggle and shouldn't also collapse. */
      clickedBoxId: string | null;
      /** The single box snapping is computed against — its hypothetical position (tracked independently of
          any snap correction already applied, see `dragStartWorldPoint`/`anchorStartPosition` below) is what
          gets tested against other boxes' edges; the resulting per-axis correction is then applied to every
          selected box equally, so the whole group moves together without drifting apart. */
      anchorBoxId: string;
      /** The pointer's world position when this drag started, paired with `anchorStartPosition` (the anchor
          box's position at that same moment) so each frame can recompute the anchor's *unsnapped* hypothetical
          position directly from total cursor movement since drag start — rather than accumulating already-
          snapped deltas frame over frame, which would let a snap correction permanently bias later frames
          instead of releasing cleanly once the cursor moves back out of tolerance. */
      dragStartWorldPoint: Point2D;
      anchorStartPosition: Point2D;
      startPixelPoint: Point2D;
      hasCrossedClickThreshold: boolean;
    }
  | { kind: 'resize-box'; boxId: string; handle: ResizeHandle }
  | { kind: 'create-box'; startWorldPoint: Point2D }
  | { kind: 'marquee'; startWorldPoint: Point2D };

interface FloatingLabel {
  pixelPoint: Point2D;
  text: string;
  /** Resize/create-box labels float above the cursor (their existing, established position); the source/
      listener distance-to-axes readout floats below the marker instead, per how it was asked for. */
  placement: 'above' | 'below';
}

/** Tracks click-through selection cycling (see `resolveClickTarget` below): the screen point and hit stack the
    last plain click resolved against, and which box in that stack was picked. Kept per-view (a `useRef`, not a
    shared/global signal) since overlap is a property of this view's own 2D projection — Top/Front/Side each
    cycle independently. */
interface ClickCycleState {
  pixelPoint: Point2D;
  hitBoxIds: string[];
  currentIndex: number;
}

function resolveThemeColors(referenceElement: Element): RoomViewTheme {
  const rootStyle = getComputedStyle(referenceElement);
  return {
    gridColor: rootStyle.getPropertyValue('--color-border-subtle').trim(),
    axisColor: rootStyle.getPropertyValue('--color-accent').trim(),
    selectedOutlineColor: rootStyle.getPropertyValue('--color-accent').trim(),
    sourceColor: rootStyle.getPropertyValue('--color-accent').trim(),
    listenerColor: rootStyle.getPropertyValue('--color-text-primary').trim(),
  };
}

function formatSizeLabel(horizontalMeters: number, verticalMeters: number): string {
  return `${Math.round(metersToCentimeters(horizontalMeters))} × ${Math.round(metersToCentimeters(verticalMeters))} cm`;
}

/** Shown below the source/listener marker while it's being dragged: how far it currently sits from each of
    the two drawn axis lines, plus (when the room has any objects) the distance to the nearest one — the
    numeric complement to the visual axis lines and grid, for placing a marker precisely without needing to
    open its exact-position fields. */
function formatDistanceLabel(
  horizontalAxisLabel: string,
  horizontalMeters: number,
  verticalAxisLabel: string,
  verticalMeters: number,
  nearestObjectMeters: number | null,
): string {
  const axisPart = `${horizontalAxisLabel}${Math.round(metersToCentimeters(Math.abs(horizontalMeters)))} ${verticalAxisLabel}${Math.round(metersToCentimeters(Math.abs(verticalMeters)))}cm`;
  if (nearestObjectMeters === null) return axisPart;
  return `${axisPart} · obj ${Math.round(metersToCentimeters(nearestObjectMeters))}cm`;
}

/** Keeps a floating label from hanging off either edge of the canvas — without `white-space: nowrap` (set on
    the label itself) a `left` this close to an edge would also make the browser's shrink-to-fit width
    calculation collapse toward zero and wrap every word onto its own line; this clamp is the belt to that
    braces, keeping the label fully on-screen rather than merely unwrapped. The half-width is estimated from
    the label's own text (monospace, so character count is a reliable proxy for rendered width) rather than a
    single fixed constant, since the distance-to-axes label can run noticeably longer than the size label. */
const FLOATING_LABEL_MINIMUM_HALF_WIDTH_PIXELS = 32;
const FLOATING_LABEL_CHARACTER_WIDTH_ESTIMATE_PIXELS = 5.6;
const FLOATING_LABEL_HORIZONTAL_PADDING_PIXELS = 14;
function estimateFloatingLabelHalfWidthPixels(text: string): number {
  return Math.max(FLOATING_LABEL_MINIMUM_HALF_WIDTH_PIXELS, (text.length * FLOATING_LABEL_CHARACTER_WIDTH_ESTIMATE_PIXELS + FLOATING_LABEL_HORIZONTAL_PADDING_PIXELS) / 2);
}
function clampFloatingLabelHorizontal(pixelHorizontal: number, containerWidthPixels: number, halfWidthEstimatePixels: number): number {
  const maximumLeft = Math.max(halfWidthEstimatePixels, containerWidthPixels - halfWidthEstimatePixels);
  return Math.min(Math.max(pixelHorizontal, halfWidthEstimatePixels), maximumLeft);
}

const RESIZE_HANDLE_CURSORS: Record<ResizeHandle, string> = {
  'top-left': 'nwse-resize',
  'bottom-right': 'nwse-resize',
  'top-right': 'nesw-resize',
  'bottom-left': 'nesw-resize',
};

function pixelDistance(a: Point2D, b: Point2D): number {
  return Math.hypot(a.horizontal - b.horizontal, a.vertical - b.vertical);
}

function haveSameBoxIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const bIds = new Set(b);
  return a.every(id => bIds.has(id));
}

/** Resolves which box a plain click at `pixelPoint` should select, given every box under the cursor
    (`hitBoxIds`, topmost first). Clicking the same screen spot again — within `CLICK_VS_DRAG_THRESHOLD_PIXELS`
    and while the same set of boxes still sits there — advances to the next box underneath, wrapping back to
    the top; anything else (a different spot, or a hit stack that changed since the last click) restarts at the
    topmost box. This is how an occluding box (e.g. a ceiling covering everything below it in the Top view) can
    still be clicked through to reach what's underneath. */
function resolveClickTarget(previous: ClickCycleState | null, pixelPoint: Point2D, hitBoxIds: string[]): ClickCycleState {
  const isSameSpot = previous !== null && pixelDistance(previous.pixelPoint, pixelPoint) <= CLICK_VS_DRAG_THRESHOLD_PIXELS;
  const isSameStack = isSameSpot && haveSameBoxIds(previous!.hitBoxIds, hitBoxIds);
  const currentIndex = isSameStack ? (previous!.currentIndex + 1) % hitBoxIds.length : 0;
  return { pixelPoint, hitBoxIds, currentIndex };
}

function worldRectFromDrag(start: Point2D, end: Point2D): Rect2D {
  return {
    left: Math.min(start.horizontal, end.horizontal),
    top: Math.min(start.vertical, end.vertical),
    width: Math.abs(end.horizontal - start.horizontal),
    height: Math.abs(end.vertical - start.vertical),
  };
}

export function RoomOrthographicView({
  label,
  axes,
  horizontalAxisLabel,
  verticalAxisLabel,
  boxes,
  selectedBoxIds,
  source,
  listener,
  activeTool,
  snapEnabled,
  onSelectBox,
  onToggleBoxSelection,
  onMarqueeSelect,
  onMoveSelectedBoxes,
  onResizeBox,
  onCreateBox,
  onMoveSource,
  onMoveListener,
}: RoomOrthographicViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const themeRef = useRef<RoomViewTheme | null>(null);
  const dragModeRef = useRef<DragMode | null>(null);
  const clickCycleRef = useRef<ClickCycleState | null>(null);
  const [transform, setTransform] = useState<ViewTransform>(DEFAULT_VIEW_TRANSFORM);
  const [previewRect, setPreviewRect] = useState<{ start: Point2D; end: Point2D } | null>(null);
  const [marqueeRect, setMarqueeRect] = useState<{ start: Point2D; end: Point2D } | null>(null);
  const [floatingLabel, setFloatingLabel] = useState<FloatingLabel | null>(null);
  const [cursorStyle, setCursorStyle] = useState('default');

  const getTheme = (referenceElement: Element): RoomViewTheme => {
    if (!themeRef.current) themeRef.current = resolveThemeColors(referenceElement);
    return themeRef.current;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const draw = () => {
      const devicePixelRatio = window.devicePixelRatio || 1;
      const widthPixels = Math.max(1, container.clientWidth);
      canvas.width = widthPixels * devicePixelRatio;
      canvas.height = VIEW_HEIGHT_PIXELS * devicePixelRatio;
      canvas.style.width = `${widthPixels}px`;
      canvas.style.height = `${VIEW_HEIGHT_PIXELS}px`;

      const context = canvas.getContext('2d');
      if (!context) return;
      context.scale(devicePixelRatio, devicePixelRatio);

      drawRoomOrthographicView(context, {
        widthPixels,
        heightPixels: VIEW_HEIGHT_PIXELS,
        boxes,
        axes,
        horizontalAxisLabel,
        verticalAxisLabel,
        selectedBoxIds,
        source,
        listener,
        theme: getTheme(canvas),
        transform,
      });

      const drawDashedRect = (rect: { start: Point2D; end: Point2D }) => {
        const topLeft = worldToPixel(
          { horizontal: Math.min(rect.start.horizontal, rect.end.horizontal), vertical: Math.min(rect.start.vertical, rect.end.vertical) },
          widthPixels,
          VIEW_HEIGHT_PIXELS,
          transform,
        );
        const bottomRight = worldToPixel(
          { horizontal: Math.max(rect.start.horizontal, rect.end.horizontal), vertical: Math.max(rect.start.vertical, rect.end.vertical) },
          widthPixels,
          VIEW_HEIGHT_PIXELS,
          transform,
        );
        context.setLineDash([4, 3]);
        context.strokeStyle = getTheme(canvas).selectedOutlineColor;
        context.lineWidth = 1.5;
        context.strokeRect(topLeft.horizontal, topLeft.vertical, bottomRight.horizontal - topLeft.horizontal, bottomRight.vertical - topLeft.vertical);
        context.setLineDash([]);
      };

      if (previewRect) drawDashedRect(previewRect);
      if (marqueeRect) drawDashedRect(marqueeRect);
    };

    draw();

    let resizeAnimationFrameId: number | null = null;
    const scheduleRedraw = () => {
      if (resizeAnimationFrameId !== null) return;
      resizeAnimationFrameId = requestAnimationFrame(() => {
        resizeAnimationFrameId = null;
        draw();
      });
    };

    const resizeObserver = new ResizeObserver(scheduleRedraw);
    resizeObserver.observe(container);
    return () => {
      resizeObserver.disconnect();
      if (resizeAnimationFrameId !== null) cancelAnimationFrame(resizeAnimationFrameId);
    };
  }, [boxes, selectedBoxIds, source, listener, axes, previewRect, marqueeRect, transform]);

  const eventToPixelPoint = (event: { offsetX: number; offsetY: number }): Point2D => ({ horizontal: event.offsetX, vertical: event.offsetY });

  const pixelToWorldHere = (pixel: Point2D): Point2D => {
    const widthPixels = containerRef.current?.clientWidth ?? 1;
    return pixelToWorld(pixel, widthPixels, VIEW_HEIGHT_PIXELS, transform);
  };

  const findMarkerUnderPoint = (point: Point2D): 'source' | 'listener' | null => {
    const widthPixels = containerRef.current?.clientWidth ?? 1;
    const handleRadiusWorld = MARKER_HIT_RADIUS_PIXELS / pixelsPerMeter(widthPixels, transform.spanMeters);
    const sourcePoint = { horizontal: source[axes.horizontal], vertical: source[axes.vertical] };
    const listenerPoint = { horizontal: listener[axes.horizontal], vertical: listener[axes.vertical] };
    if (Math.hypot(point.horizontal - sourcePoint.horizontal, point.vertical - sourcePoint.vertical) <= handleRadiusWorld) return 'source';
    if (Math.hypot(point.horizontal - listenerPoint.horizontal, point.vertical - listenerPoint.vertical) <= handleRadiusWorld) return 'listener';
    return null;
  };

  /** Resize handles only appear/respond when exactly one box is selected — resizing a multi-selection isn't
      meaningful (there's no single shape to drag a corner of), so it stays a single-box-only operation. */
  const findResizeHandleUnderPoint = (point: Point2D): { box: RoomBox; handle: ResizeHandle } | null => {
    if (selectedBoxIds.size !== 1) return null;
    const [onlySelectedId] = selectedBoxIds;
    const selectedBox = boxes.find(box => box.id === onlySelectedId);
    if (!selectedBox) return null;
    const widthPixels = containerRef.current?.clientWidth ?? 1;
    const resizeHandleRadiusWorld = RESIZE_HANDLE_HIT_RADIUS_PIXELS / pixelsPerMeter(widthPixels, transform.spanMeters);
    const handle = hitTestResizeHandle(point, selectedBox, axes, resizeHandleRadiusWorld);
    return handle ? { box: selectedBox, handle } : null;
  };

  const getSnapToleranceWorld = (): number => {
    const widthPixels = containerRef.current?.clientWidth ?? 1;
    return SNAP_THRESHOLD_PIXELS / pixelsPerMeter(widthPixels, transform.spanMeters);
  };

  /** Snaps a single dragged point (a resize handle, a create-box drag corner) to nearby object edges/centers
      and the origin axes — `excludeBoxIds` leaves out the box being resized itself, if any. No-ops when
      snapping is disabled or nothing is within tolerance. */
  const snapDraggedPoint = (point: Point2D, excludeBoxIds: ReadonlySet<string>): Point2D => {
    if (!snapEnabled) return point;
    const candidates = collectSnapCandidates(boxes, axes, excludeBoxIds);
    return snapPointToCandidates(point, candidates, getSnapToleranceWorld());
  };

  /** Snaps a marker (source/listener) drag to object edges/centers, the origin axes, and the *other*
      marker's position (so the source and listener can snap to each other too). */
  const snapMarkerPoint = (point: Point2D, otherMarkerPoint: Point2D): Point2D => {
    if (!snapEnabled) return point;
    const candidates = collectSnapCandidates(boxes, axes, new Set(), [otherMarkerPoint]);
    return snapPointToCandidates(point, candidates, getSnapToleranceWorld());
  };

  const handleWheel = (event: JSX.TargetedWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const widthPixels = containerRef.current?.clientWidth ?? 1;
    const zoomFactor = Math.exp(event.deltaY * ZOOM_SENSITIVITY);
    setTransform(current => zoomViewTransform(current, zoomFactor, eventToPixelPoint(event), widthPixels, VIEW_HEIGHT_PIXELS));
  };

  const startMoveSelectedBoxesDrag = (anchorBox: RoomBox, clickedBoxId: string | null, worldPoint: Point2D, pixelPoint: Point2D): void => {
    const anchorRect = getBoxRectOnAxes(anchorBox, axes);
    dragModeRef.current = {
      kind: 'move-selected-boxes',
      clickedBoxId,
      anchorBoxId: anchorBox.id,
      dragStartWorldPoint: worldPoint,
      anchorStartPosition: { horizontal: anchorRect.left, vertical: anchorRect.top },
      startPixelPoint: pixelPoint,
      hasCrossedClickThreshold: false,
    };
  };

  const handlePointerDown = (event: JSX.TargetedPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);

    if (event.button === 1) {
      event.preventDefault();
      dragModeRef.current = { kind: 'pan', lastPixelPoint: eventToPixelPoint(event) };
      return;
    }
    if (event.button !== 0) return;

    const pixelPoint = eventToPixelPoint(event);
    const point = pixelToWorldHere(pixelPoint);

    const markerHit = findMarkerUnderPoint(point);
    if (markerHit === 'source') {
      dragModeRef.current = { kind: 'move-source', startPixelPoint: pixelPoint, hasCrossedClickThreshold: false };
      return;
    }
    if (markerHit === 'listener') {
      dragModeRef.current = { kind: 'move-listener', startPixelPoint: pixelPoint, hasCrossedClickThreshold: false };
      return;
    }

    if (activeTool !== 'select') {
      dragModeRef.current = { kind: 'create-box', startWorldPoint: point };
      setPreviewRect({ start: point, end: point });
      return;
    }

    const resizeHandleHit = findResizeHandleUnderPoint(point);
    if (resizeHandleHit) {
      dragModeRef.current = { kind: 'resize-box', boxId: resizeHandleHit.box.id, handle: resizeHandleHit.handle };
      return;
    }

    const hitStack = hitTestAllBoxesAtPoint(point, boxes, axes);

    if (event.shiftKey) {
      clickCycleRef.current = null;
      if (hitStack.length === 0) return; // Shift+click on empty space is a no-op — Shift is strictly a toggle gesture.
      const topHit = hitStack[0];
      const wasSelected = selectedBoxIds.has(topHit.id);
      onToggleBoxSelection(topHit.id);
      if (!wasSelected) {
        startMoveSelectedBoxesDrag(topHit, null, point, pixelPoint);
      }
      return;
    }

    if (hitStack.length === 0) {
      clickCycleRef.current = null;
      dragModeRef.current = { kind: 'marquee', startWorldPoint: point };
      setMarqueeRect({ start: point, end: point });
      return;
    }

    const cycleState = resolveClickTarget(clickCycleRef.current, pixelPoint, hitStack.map(box => box.id));
    clickCycleRef.current = cycleState;
    const resolvedBox = hitStack[cycleState.currentIndex];
    // A box that's already part of the current selection (single or multi) keeps the whole selection intact
    // for now — dragging it should move the whole group. Only a box outside the current selection replaces it
    // immediately, so an unselected box highlights right away even before any drag starts.
    if (!selectedBoxIds.has(resolvedBox.id)) onSelectBox(resolvedBox.id);
    startMoveSelectedBoxesDrag(resolvedBox, resolvedBox.id, point, pixelPoint);
  };

  const updateHoverCursor = (point: Point2D) => {
    if (activeTool !== 'select') {
      setCursorStyle('crosshair');
      return;
    }
    if (findMarkerUnderPoint(point)) {
      setCursorStyle('grab');
      return;
    }
    const resizeHandleHit = findResizeHandleUnderPoint(point);
    setCursorStyle(resizeHandleHit ? RESIZE_HANDLE_CURSORS[resizeHandleHit.handle] : 'default');
  };

  const handlePointerMove = (event: JSX.TargetedPointerEvent<HTMLCanvasElement>) => {
    const dragMode = dragModeRef.current;
    const pixelPoint = eventToPixelPoint(event);

    if (!dragMode) {
      updateHoverCursor(pixelToWorldHere(pixelPoint));
      return;
    }

    const point = pixelToWorldHere(pixelPoint);

    switch (dragMode.kind) {
      case 'pan': {
        const widthPixels = containerRef.current?.clientWidth ?? 1;
        const delta = { horizontal: pixelPoint.horizontal - dragMode.lastPixelPoint.horizontal, vertical: pixelPoint.vertical - dragMode.lastPixelPoint.vertical };
        setTransform(current => panViewTransform(current, delta, widthPixels));
        dragModeRef.current = { ...dragMode, lastPixelPoint: pixelPoint };
        break;
      }
      case 'move-source':
      case 'move-listener': {
        if (!dragMode.hasCrossedClickThreshold) {
          const distance = Math.hypot(pixelPoint.horizontal - dragMode.startPixelPoint.horizontal, pixelPoint.vertical - dragMode.startPixelPoint.vertical);
          if (distance < CLICK_VS_DRAG_THRESHOLD_PIXELS) return;
          dragModeRef.current = { ...dragMode, hasCrossedClickThreshold: true };
        }
        const otherMarker = dragMode.kind === 'move-source' ? listener : source;
        const otherMarkerPoint = { horizontal: otherMarker[axes.horizontal], vertical: otherMarker[axes.vertical] };
        const snappedPoint = snapMarkerPoint(point, otherMarkerPoint);
        if (dragMode.kind === 'move-source') onMoveSource(snappedPoint);
        else onMoveListener(snappedPoint);

        const snappedPixelPoint = worldToPixel(snappedPoint, containerRef.current?.clientWidth ?? 1, VIEW_HEIGHT_PIXELS, transform);
        setFloatingLabel({
          pixelPoint: snappedPixelPoint,
          placement: 'below',
          text: formatDistanceLabel(
            horizontalAxisLabel,
            snappedPoint.horizontal,
            verticalAxisLabel,
            snappedPoint.vertical,
            findNearestBoxDistance(snappedPoint, boxes, axes),
          ),
        });
        break;
      }
      case 'move-selected-boxes': {
        if (!dragMode.hasCrossedClickThreshold) {
          const distance = Math.hypot(pixelPoint.horizontal - dragMode.startPixelPoint.horizontal, pixelPoint.vertical - dragMode.startPixelPoint.vertical);
          if (distance < CLICK_VS_DRAG_THRESHOLD_PIXELS) return;
          dragModeRef.current = { ...dragMode, hasCrossedClickThreshold: true };
        }

        const anchorBox = boxes.find(box => box.id === dragMode.anchorBoxId);
        if (!anchorBox) break;
        const currentAnchorRect = getBoxRectOnAxes(anchorBox, axes);

        // Recomputed from total cursor movement since the drag started (not from the anchor's current,
        // possibly already-snapped position) — see the `dragStartWorldPoint`/`anchorStartPosition` doc comment
        // on `DragMode` for why: this is what lets a snap correction release cleanly once the cursor moves
        // back out of tolerance, instead of permanently biasing every later frame.
        const virtualAnchorPosition = {
          horizontal: dragMode.anchorStartPosition.horizontal + (point.horizontal - dragMode.dragStartWorldPoint.horizontal),
          vertical: dragMode.anchorStartPosition.vertical + (point.vertical - dragMode.dragStartWorldPoint.vertical),
        };
        const hypotheticalAnchorRect: Rect2D = { left: virtualAnchorPosition.horizontal, top: virtualAnchorPosition.vertical, width: currentAnchorRect.width, height: currentAnchorRect.height };

        let snapOffset: Point2D = { horizontal: 0, vertical: 0 };
        if (snapEnabled) {
          const candidates = collectSnapCandidates(boxes, axes, selectedBoxIds);
          snapOffset = computeBoxMoveSnapOffset(hypotheticalAnchorRect, candidates, getSnapToleranceWorld());
        }

        const snappedAnchorPosition = { horizontal: virtualAnchorPosition.horizontal + snapOffset.horizontal, vertical: virtualAnchorPosition.vertical + snapOffset.vertical };
        onMoveSelectedBoxes(snappedAnchorPosition.horizontal - currentAnchorRect.left, snappedAnchorPosition.vertical - currentAnchorRect.top);
        break;
      }
      case 'resize-box': {
        const currentBox = boxes.find(box => box.id === dragMode.boxId);
        const snappedPoint = snapDraggedPoint(point, new Set([dragMode.boxId]));
        if (currentBox) {
          const previewBoxRect = getBoxRectOnAxes(resizeBoxOnAxes(currentBox, axes, dragMode.handle, snappedPoint), axes);
          setFloatingLabel({ pixelPoint, placement: 'above', text: formatSizeLabel(previewBoxRect.width, previewBoxRect.height) });
        }
        onResizeBox(dragMode.boxId, dragMode.handle, snappedPoint);
        break;
      }
      case 'create-box': {
        const snappedPoint = snapDraggedPoint(point, new Set());
        setPreviewRect({ start: dragMode.startWorldPoint, end: snappedPoint });
        setFloatingLabel({
          pixelPoint,
          placement: 'above',
          text: formatSizeLabel(Math.abs(snappedPoint.horizontal - dragMode.startWorldPoint.horizontal), Math.abs(snappedPoint.vertical - dragMode.startWorldPoint.vertical)),
        });
        break;
      }
      case 'marquee':
        setMarqueeRect({ start: dragMode.startWorldPoint, end: point });
        break;
    }
  };

  const handlePointerUp = (event: JSX.TargetedPointerEvent<HTMLCanvasElement>) => {
    const dragMode = dragModeRef.current;
    if (dragMode?.kind === 'create-box') {
      const point = snapDraggedPoint(pixelToWorldHere(eventToPixelPoint(event)), new Set());
      onCreateBox(dragMode.startWorldPoint, point);
      setPreviewRect(null);
    }
    if (dragMode?.kind === 'marquee') {
      const point = pixelToWorldHere(eventToPixelPoint(event));
      const intersecting = getBoxesIntersectingRect(worldRectFromDrag(dragMode.startWorldPoint, point), boxes, axes);
      onMarqueeSelect(intersecting.map(box => box.id));
      setMarqueeRect(null);
    }
    // A plain click (never crossed the drag threshold) on a box that was already part of a multi-selection
    // didn't touch the selection at pointerdown, to keep a potential group-drag possible — now that the
    // pointer is up without ever having moved, it resolves to what a plain click normally does: narrow the
    // selection down to just that one box.
    if (dragMode?.kind === 'move-selected-boxes' && !dragMode.hasCrossedClickThreshold && dragMode.clickedBoxId !== null) {
      onSelectBox(dragMode.clickedBoxId);
    }
    dragModeRef.current = null;
    setFloatingLabel(null);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between text-xs text-text-tertiary">
        <span class="font-medium text-text-secondary">{label}</span>
        <span class="font-mono">
          {horizontalAxisLabel} / {verticalAxisLabel}
        </span>
      </div>
      <div ref={containerRef} class="relative w-full overflow-hidden rounded-lg border border-border-subtle bg-surface-raised">
        <canvas
          ref={canvasRef}
          style={{ display: 'block', width: '100%', height: `${VIEW_HEIGHT_PIXELS}px`, touchAction: 'none', cursor: cursorStyle }}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
        {floatingLabel && (
          <div
            class={`pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded border border-border-strong bg-surface-overlay px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-text-primary ${
              floatingLabel.placement === 'above' ? '-translate-y-full' : ''
            }`}
            style={{
              left: `${clampFloatingLabelHorizontal(floatingLabel.pixelPoint.horizontal, containerRef.current?.clientWidth ?? 0, estimateFloatingLabelHalfWidthPixels(floatingLabel.text))}px`,
              top:
                floatingLabel.placement === 'above'
                  ? `${Math.max(20, floatingLabel.pixelPoint.vertical - 10)}px`
                  : `${Math.min(VIEW_HEIGHT_PIXELS - 16, floatingLabel.pixelPoint.vertical + MARKER_HIT_RADIUS_PIXELS)}px`,
            }}
          >
            {floatingLabel.text}
          </div>
        )}
      </div>
    </div>
  );
}
