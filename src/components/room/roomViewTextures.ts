import { getEffectiveScatterAmount, getRoomMaterial } from '../../audio/room/roomMaterials';
import type { Point2D, Rect2D } from '../../audio/room/roomEditorGeometry';
import type { RoomBox } from '../../audio/room/roomTypes';

export interface LineSegment {
  start: Point2D;
  end: Point2D;
}

/** Safety cap on primitives generated along one axis — guards against a pathologically large box or tiny
    spacing constant producing an unbounded loop; in practice a box on screen never gets remotely this dense. */
const MAXIMUM_PRIMITIVES_PER_AXIS = 500;

/** Small FNV-1a-style string hash — deterministic, no `Math.random()` involved anywhere in this module, so a
    given box's texture never jitters between redraws of the same state. */
export function hashStringToUint32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function hashToUnitInterval(hash: number): number {
  return (hash % 1_000_000) / 1_000_000;
}

/** A box's stable per-box phase offset, in [0, 1) on each axis, derived from its id — gives adjacent
    same-material boxes visibly distinct pattern alignment instead of reading as one contiguous grid. */
export function derivePhaseForBox(boxId: string): Point2D {
  return {
    horizontal: hashToUnitInterval(hashStringToUint32(`${boxId}:h`)),
    vertical: hashToUnitInterval(hashStringToUint32(`${boxId}:v`)),
  };
}

function isDegenerateRect(rect: Rect2D, spacingMeters: number): boolean {
  return rect.width <= 0 || rect.height <= 0 || spacingMeters <= 0;
}

/** A grid of points spaced `spacingMeters` apart, offset by `phase` (each component in `[0, 1)`) and clipped
    to `rect`. Shared by the dotted-holes texture and, as a base grid, by grass tufts. */
export function computeDottedHolesPositions(rect: Rect2D, spacingMeters: number, phase: Point2D): Point2D[] {
  const positions: Point2D[] = [];
  if (isDegenerateRect(rect, spacingMeters)) return positions;

  const firstHorizontal = rect.left + phase.horizontal * spacingMeters;
  const firstVertical = rect.top + phase.vertical * spacingMeters;

  for (let horizontal = firstHorizontal, columnCount = 0; horizontal <= rect.left + rect.width && columnCount < MAXIMUM_PRIMITIVES_PER_AXIS; horizontal += spacingMeters, columnCount++) {
    for (let vertical = firstVertical, rowCount = 0; vertical <= rect.top + rect.height && rowCount < MAXIMUM_PRIMITIVES_PER_AXIS; vertical += spacingMeters, rowCount++) {
      positions.push({ horizontal, vertical });
    }
  }
  return positions;
}

/** Straight lines running the full horizontal extent of `rect`, spaced `spacingMeters` apart vertically —
    approximates wood/parquet grain. */
export function computeGrainLinesSegments(rect: Rect2D, spacingMeters: number, phase: number): LineSegment[] {
  const segments: LineSegment[] = [];
  if (isDegenerateRect(rect, spacingMeters)) return segments;

  const firstVertical = rect.top + phase * spacingMeters;
  for (let vertical = firstVertical, count = 0; vertical <= rect.top + rect.height && count < MAXIMUM_PRIMITIVES_PER_AXIS; vertical += spacingMeters, count++) {
    segments.push({ start: { horizontal: rect.left, vertical }, end: { horizontal: rect.left + rect.width, vertical } });
  }
  return segments;
}

const BRICK_LENGTH_METERS = 0.2;

/** Horizontal mortar-coursing lines plus vertical brick joints, offset by half a brick on alternating courses
    (a running-bond pattern) — approximates painted/bare brick. */
export function computeBrickCoursingSegments(rect: Rect2D, courseHeightMeters: number, phase: number): LineSegment[] {
  const segments: LineSegment[] = [];
  if (isDegenerateRect(rect, courseHeightMeters)) return segments;

  const firstVertical = rect.top + phase * courseHeightMeters;
  let courseIndex = 0;
  for (let vertical = firstVertical, count = 0; vertical <= rect.top + rect.height && count < MAXIMUM_PRIMITIVES_PER_AXIS; vertical += courseHeightMeters, count++, courseIndex++) {
    segments.push({ start: { horizontal: rect.left, vertical }, end: { horizontal: rect.left + rect.width, vertical } });

    const rowOffset = (courseIndex % 2 === 0 ? 0 : BRICK_LENGTH_METERS / 2) + phase * BRICK_LENGTH_METERS;
    const rowBottom = Math.min(rect.top + rect.height, vertical + courseHeightMeters);
    for (let horizontal = rect.left + rowOffset, jointCount = 0; horizontal <= rect.left + rect.width && jointCount < MAXIMUM_PRIMITIVES_PER_AXIS; horizontal += BRICK_LENGTH_METERS, jointCount++) {
      segments.push({ start: { horizontal, vertical }, end: { horizontal, vertical: rowBottom } });
    }
  }
  return segments;
}

/** A simple axis-aligned grid (not diagonal, to keep clipping trivial and the output cheap to bound) —
    approximates corrugated/uneven metal's mesh-like irregularity. */
export function computeCrosshatchSegments(rect: Rect2D, spacingMeters: number): LineSegment[] {
  const segments: LineSegment[] = [];
  if (isDegenerateRect(rect, spacingMeters)) return segments;

  for (let vertical = rect.top, count = 0; vertical <= rect.top + rect.height && count < MAXIMUM_PRIMITIVES_PER_AXIS; vertical += spacingMeters, count++) {
    segments.push({ start: { horizontal: rect.left, vertical }, end: { horizontal: rect.left + rect.width, vertical } });
  }
  for (let horizontal = rect.left, count = 0; horizontal <= rect.left + rect.width && count < MAXIMUM_PRIMITIVES_PER_AXIS; horizontal += spacingMeters, count++) {
    segments.push({ start: { horizontal, vertical: rect.top }, end: { horizontal, vertical: rect.top + rect.height } });
  }
  return segments;
}

const WAVE_AMPLITUDE_METERS = 0.02;
const WAVE_STEP_METERS = 0.03;

/** Rows of short connected segments tracing a low-amplitude sine wave — approximates the soft, uneven surface
    of wool/carpet. */
export function computeWavyLinesSegments(rect: Rect2D, spacingMeters: number, phase: number): LineSegment[] {
  const segments: LineSegment[] = [];
  if (isDegenerateRect(rect, spacingMeters)) return segments;

  const wobbleAt = (horizontal: number): number => Math.sin((horizontal / spacingMeters + phase) * Math.PI * 2) * WAVE_AMPLITUDE_METERS;

  for (let vertical = rect.top + phase * spacingMeters, rowCount = 0; vertical <= rect.top + rect.height && rowCount < MAXIMUM_PRIMITIVES_PER_AXIS; vertical += spacingMeters, rowCount++) {
    let previous: Point2D = { horizontal: rect.left, vertical: vertical + wobbleAt(rect.left) };
    for (let horizontal = rect.left + WAVE_STEP_METERS, stepCount = 0; horizontal <= rect.left + rect.width && stepCount < MAXIMUM_PRIMITIVES_PER_AXIS; horizontal += WAVE_STEP_METERS, stepCount++) {
      const current: Point2D = { horizontal, vertical: vertical + wobbleAt(horizontal) };
      segments.push({ start: previous, end: current });
      previous = current;
    }
  }
  return segments;
}

const TUFT_BASE_LENGTH_METERS = 0.04;
const TUFT_LENGTH_JITTER_METERS = 0.02;
const TUFT_ANGLE_JITTER_RADIANS = 0.6;

/** Short, mostly-upright blade strokes at a grid of positions, each with its own deterministic angle/length
    jitter — approximates grass. */
export function computeGrassTuftsSegments(rect: Rect2D, spacingMeters: number, phase: Point2D): LineSegment[] {
  const positions = computeDottedHolesPositions(rect, spacingMeters, phase);

  return positions.map((base, index) => {
    const jitter = hashToUnitInterval(hashStringToUint32(`${index}:${phase.horizontal}:${phase.vertical}`));
    const angle = -Math.PI / 2 + (jitter * 2 - 1) * TUFT_ANGLE_JITTER_RADIANS;
    const length = TUFT_BASE_LENGTH_METERS + jitter * TUFT_LENGTH_JITTER_METERS;
    return { start: base, end: { horizontal: base.horizontal + Math.cos(angle) * length, vertical: base.vertical + Math.sin(angle) * length } };
  });
}

function hexToRgb(hexColor: string): { red: number; green: number; blue: number } {
  const normalized = hexColor.replace('#', '');
  return { red: parseInt(normalized.slice(0, 2), 16), green: parseInt(normalized.slice(2, 4), 16), blue: parseInt(normalized.slice(4, 6), 16) };
}

/** Whether a material's fill reads as dark enough that a light (rather than dark) texture stroke stays
    visible against it. */
function isDarkColor(hexColor: string): boolean {
  const { red, green, blue } = hexToRgb(hexColor);
  return (0.299 * red + 0.587 * green + 0.114 * blue) / 255 < 0.5;
}

const DOTTED_HOLES_SPACING_METERS = 0.12;
const DOTTED_HOLES_RADIUS_METERS = 0.012;
const GRAIN_LINES_SPACING_METERS = 0.08;
const BRICK_COURSE_HEIGHT_METERS = 0.1;
const CROSSHATCH_SPACING_METERS = 0.1;
const WAVY_LINES_SPACING_METERS = 0.1;
const GRASS_TUFTS_SPACING_METERS = 0.09;

function strokeSegments(context: CanvasRenderingContext2D, segments: LineSegment[], project: (point: Point2D) => Point2D, strokeColor: string, lineWidth: number): void {
  if (segments.length === 0) return;
  context.strokeStyle = strokeColor;
  context.lineWidth = lineWidth;
  context.beginPath();
  for (const segment of segments) {
    const start = project(segment.start);
    const end = project(segment.end);
    context.moveTo(start.horizontal, start.vertical);
    context.lineTo(end.horizontal, end.vertical);
  }
  context.stroke();
}

/** Renders `box`'s material texture into `pixelRect` (its already-projected on-screen rect), clipped to that
    rect so primitives outside it are cheaply discarded by the canvas itself. `worldRect` is the same box in
    world (meters) space, which the pure position/segment generators above operate in; `project` converts a
    world point to a pixel point (typically `roomViewDrawing.ts`'s `worldToPixel`, passed in rather than
    imported directly to avoid a module cycle between the two files). No-ops for a `'flat'` texture or a box
    whose effective scatter amount is zero (see `getEffectiveScatterAmount`) — a perfectly smooth surface has
    nothing to draw. */
export function drawMaterialTexture(context: CanvasRenderingContext2D, box: RoomBox, worldRect: Rect2D, pixelRect: Rect2D, project: (point: Point2D) => Point2D): void {
  const material = getRoomMaterial(box.materialId);
  if (material.texture.kind === 'flat') return;

  const effectiveScatterAmount = getEffectiveScatterAmount(box);
  if (effectiveScatterAmount <= 0) return;

  const alpha = Math.min(0.6, 0.15 + effectiveScatterAmount * 0.45);
  const strokeColor = isDarkColor(material.color) ? `rgba(255, 255, 255, ${alpha})` : `rgba(0, 0, 0, ${alpha})`;
  const phase = derivePhaseForBox(box.id);

  context.save();
  context.beginPath();
  context.rect(pixelRect.left, pixelRect.top, pixelRect.width, pixelRect.height);
  context.clip();

  switch (material.texture.kind) {
    case 'dotted-holes': {
      const scale = worldRect.width > 0 ? pixelRect.width / worldRect.width : 1;
      const pixelRadius = Math.max(0.75, DOTTED_HOLES_RADIUS_METERS * scale);
      context.fillStyle = strokeColor;
      for (const position of computeDottedHolesPositions(worldRect, DOTTED_HOLES_SPACING_METERS, phase)) {
        const projected = project(position);
        context.beginPath();
        context.arc(projected.horizontal, projected.vertical, pixelRadius, 0, Math.PI * 2);
        context.fill();
      }
      break;
    }
    case 'grain-lines':
      strokeSegments(context, computeGrainLinesSegments(worldRect, GRAIN_LINES_SPACING_METERS, phase.vertical), project, strokeColor, 1);
      break;
    case 'brick-coursing':
      strokeSegments(context, computeBrickCoursingSegments(worldRect, BRICK_COURSE_HEIGHT_METERS, phase.vertical), project, strokeColor, 1);
      break;
    case 'crosshatch':
      strokeSegments(context, computeCrosshatchSegments(worldRect, CROSSHATCH_SPACING_METERS), project, strokeColor, 1);
      break;
    case 'wavy-lines':
      strokeSegments(context, computeWavyLinesSegments(worldRect, WAVY_LINES_SPACING_METERS, phase.vertical), project, strokeColor, 1);
      break;
    case 'tufts':
      strokeSegments(context, computeGrassTuftsSegments(worldRect, GRASS_TUFTS_SPACING_METERS, phase), project, strokeColor, 1.25);
      break;
  }

  context.restore();
}
