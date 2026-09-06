import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import {
  getBoxRectOnAxes,
  hitTestBox,
  hitTestResizeHandle,
  resizeBoxOnAxes,
  type OrthographicAxes,
  type Point2D,
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

export type RoomEditorTool = 'select' | 'add-wall' | 'add-absorber';

interface RoomOrthographicViewProps {
  label: string;
  axes: OrthographicAxes;
  horizontalAxisLabel: string;
  verticalAxisLabel: string;
  boxes: RoomBox[];
  selectedBoxId: string | null;
  source: RoomPoint3D;
  listener: RoomPoint3D;
  activeTool: RoomEditorTool;
  onSelectBox: (boxId: string | null) => void;
  onMoveBox: (boxId: string, deltaHorizontal: number, deltaVertical: number) => void;
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
    normal. Without this threshold, selecting a box also fired a near-zero `onMoveBox`, which schedules a full
    resimulation just from clicking. Only once the pointer has actually moved past this many pixels does a
    press-and-drag on a box/marker turn into a real move. */
const CLICK_VS_DRAG_THRESHOLD_PIXELS = 4;

type DragMode =
  | { kind: 'pan'; lastPixelPoint: Point2D }
  | { kind: 'move-source'; startPixelPoint: Point2D; hasCrossedClickThreshold: boolean }
  | { kind: 'move-listener'; startPixelPoint: Point2D; hasCrossedClickThreshold: boolean }
  | { kind: 'move-box'; boxId: string; lastWorldPoint: Point2D; startPixelPoint: Point2D; hasCrossedClickThreshold: boolean }
  | { kind: 'resize-box'; boxId: string; handle: ResizeHandle }
  | { kind: 'create-box'; startWorldPoint: Point2D };

interface SizeLabel {
  pixelPoint: Point2D;
  text: string;
}

function resolveThemeColors(referenceElement: Element): RoomViewTheme {
  const rootStyle = getComputedStyle(referenceElement);
  return {
    gridColor: rootStyle.getPropertyValue('--color-border-subtle').trim(),
    wallColor: rootStyle.getPropertyValue('--color-text-secondary').trim(),
    absorberColor: rootStyle.getPropertyValue('--color-danger').trim(),
    selectedOutlineColor: rootStyle.getPropertyValue('--color-accent').trim(),
    sourceColor: rootStyle.getPropertyValue('--color-accent').trim(),
    listenerColor: rootStyle.getPropertyValue('--color-text-primary').trim(),
  };
}

function formatSizeLabel(horizontalMeters: number, verticalMeters: number): string {
  return `${Math.round(metersToCentimeters(horizontalMeters))} × ${Math.round(metersToCentimeters(verticalMeters))} cm`;
}

/** Keeps the floating size tooltip from hanging off either edge of the canvas — without `white-space: nowrap`
    (set on the label itself) a `left` this close to an edge would also make the browser's shrink-to-fit width
    calculation collapse toward zero and wrap every word onto its own line; this clamp is the belt to that
    braces, keeping the label fully on-screen rather than merely unwrapped. */
const SIZE_LABEL_HALF_WIDTH_ESTIMATE_PIXELS = 48;
function clampSizeLabelHorizontal(pixelHorizontal: number, containerWidthPixels: number): number {
  const maximumLeft = Math.max(SIZE_LABEL_HALF_WIDTH_ESTIMATE_PIXELS, containerWidthPixels - SIZE_LABEL_HALF_WIDTH_ESTIMATE_PIXELS);
  return Math.min(Math.max(pixelHorizontal, SIZE_LABEL_HALF_WIDTH_ESTIMATE_PIXELS), maximumLeft);
}

const RESIZE_HANDLE_CURSORS: Record<ResizeHandle, string> = {
  'top-left': 'nwse-resize',
  'bottom-right': 'nwse-resize',
  'top-right': 'nesw-resize',
  'bottom-left': 'nesw-resize',
};

export function RoomOrthographicView({
  label,
  axes,
  horizontalAxisLabel,
  verticalAxisLabel,
  boxes,
  selectedBoxId,
  source,
  listener,
  activeTool,
  onSelectBox,
  onMoveBox,
  onResizeBox,
  onCreateBox,
  onMoveSource,
  onMoveListener,
}: RoomOrthographicViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const themeRef = useRef<RoomViewTheme | null>(null);
  const dragModeRef = useRef<DragMode | null>(null);
  const [transform, setTransform] = useState<ViewTransform>(DEFAULT_VIEW_TRANSFORM);
  const [previewRect, setPreviewRect] = useState<{ start: Point2D; end: Point2D } | null>(null);
  const [sizeLabel, setSizeLabel] = useState<SizeLabel | null>(null);
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
        selectedBoxId,
        source,
        listener,
        theme: getTheme(canvas),
        transform,
      });

      if (previewRect) {
        const topLeft = worldToPixel(
          { horizontal: Math.min(previewRect.start.horizontal, previewRect.end.horizontal), vertical: Math.min(previewRect.start.vertical, previewRect.end.vertical) },
          widthPixels,
          VIEW_HEIGHT_PIXELS,
          transform,
        );
        const bottomRight = worldToPixel(
          { horizontal: Math.max(previewRect.start.horizontal, previewRect.end.horizontal), vertical: Math.max(previewRect.start.vertical, previewRect.end.vertical) },
          widthPixels,
          VIEW_HEIGHT_PIXELS,
          transform,
        );
        context.setLineDash([4, 3]);
        context.strokeStyle = getTheme(canvas).selectedOutlineColor;
        context.lineWidth = 1.5;
        context.strokeRect(topLeft.horizontal, topLeft.vertical, bottomRight.horizontal - topLeft.horizontal, bottomRight.vertical - topLeft.vertical);
        context.setLineDash([]);
      }
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
  }, [boxes, selectedBoxId, source, listener, axes, previewRect, transform]);

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

  const findResizeHandleUnderPoint = (point: Point2D): { box: RoomBox; handle: ResizeHandle } | null => {
    const selectedBox = boxes.find(box => box.id === selectedBoxId);
    if (!selectedBox) return null;
    const widthPixels = containerRef.current?.clientWidth ?? 1;
    const resizeHandleRadiusWorld = RESIZE_HANDLE_HIT_RADIUS_PIXELS / pixelsPerMeter(widthPixels, transform.spanMeters);
    const handle = hitTestResizeHandle(point, selectedBox, axes, resizeHandleRadiusWorld);
    return handle ? { box: selectedBox, handle } : null;
  };

  const handleWheel = (event: JSX.TargetedWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const widthPixels = containerRef.current?.clientWidth ?? 1;
    const zoomFactor = Math.exp(event.deltaY * ZOOM_SENSITIVITY);
    setTransform(current => zoomViewTransform(current, zoomFactor, eventToPixelPoint(event), widthPixels, VIEW_HEIGHT_PIXELS));
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

    const hitBox = hitTestBox(point, boxes, axes);
    onSelectBox(hitBox?.id ?? null);
    if (hitBox) {
      dragModeRef.current = { kind: 'move-box', boxId: hitBox.id, lastWorldPoint: point, startPixelPoint: pixelPoint, hasCrossedClickThreshold: false };
    }
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
        if (dragMode.kind === 'move-source') onMoveSource(point);
        else onMoveListener(point);
        break;
      }
      case 'move-box': {
        if (!dragMode.hasCrossedClickThreshold) {
          const distance = Math.hypot(pixelPoint.horizontal - dragMode.startPixelPoint.horizontal, pixelPoint.vertical - dragMode.startPixelPoint.vertical);
          if (distance < CLICK_VS_DRAG_THRESHOLD_PIXELS) return;
          dragModeRef.current = { ...dragMode, hasCrossedClickThreshold: true };
        }
        onMoveBox(dragMode.boxId, point.horizontal - dragMode.lastWorldPoint.horizontal, point.vertical - dragMode.lastWorldPoint.vertical);
        dragModeRef.current = { ...dragMode, lastWorldPoint: point, hasCrossedClickThreshold: true };
        break;
      }
      case 'resize-box': {
        const currentBox = boxes.find(box => box.id === dragMode.boxId);
        if (currentBox) {
          const previewBoxRect = getBoxRectOnAxes(resizeBoxOnAxes(currentBox, axes, dragMode.handle, point), axes);
          setSizeLabel({ pixelPoint, text: formatSizeLabel(previewBoxRect.width, previewBoxRect.height) });
        }
        onResizeBox(dragMode.boxId, dragMode.handle, point);
        break;
      }
      case 'create-box':
        setPreviewRect({ start: dragMode.startWorldPoint, end: point });
        setSizeLabel({ pixelPoint, text: formatSizeLabel(Math.abs(point.horizontal - dragMode.startWorldPoint.horizontal), Math.abs(point.vertical - dragMode.startWorldPoint.vertical)) });
        break;
    }
  };

  const handlePointerUp = (event: JSX.TargetedPointerEvent<HTMLCanvasElement>) => {
    const dragMode = dragModeRef.current;
    if (dragMode?.kind === 'create-box') {
      const point = pixelToWorldHere(eventToPixelPoint(event));
      onCreateBox(dragMode.startWorldPoint, point);
      setPreviewRect(null);
    }
    dragModeRef.current = null;
    setSizeLabel(null);
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
        {sizeLabel && (
          <div
            class="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded border border-border-strong bg-surface-overlay px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-text-primary"
            style={{ left: `${clampSizeLabelHorizontal(sizeLabel.pixelPoint.horizontal, containerRef.current?.clientWidth ?? 0)}px`, top: `${Math.max(20, sizeLabel.pixelPoint.vertical - 10)}px` }}
          >
            {sizeLabel.text}
          </div>
        )}
      </div>
    </div>
  );
}
