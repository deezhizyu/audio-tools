import { describe, expect, test } from 'vitest';
import type { Rect2D } from '../../audio/room/roomEditorGeometry';
import {
  computeBrickCoursingSegments,
  computeCrosshatchSegments,
  computeDottedHolesPositions,
  computeGrainLinesSegments,
  computeGrassTuftsSegments,
  computeWavyLinesSegments,
  derivePhaseForBox,
  hashStringToUint32,
} from './roomViewTextures';

const RECT: Rect2D = { left: 0, top: 0, width: 2, height: 1.5 };
const ZERO_RECT: Rect2D = { left: 0, top: 0, width: 0, height: 0 };
const PHASE = derivePhaseForBox('box-a');
const OTHER_PHASE = derivePhaseForBox('box-b');

function isFiniteSegment(segment: { start: { horizontal: number; vertical: number }; end: { horizontal: number; vertical: number } }): boolean {
  return [segment.start.horizontal, segment.start.vertical, segment.end.horizontal, segment.end.vertical].every(Number.isFinite);
}

const MARGIN_METERS = 0.05;
function isWithinRectMargin(point: { horizontal: number; vertical: number }, rect: Rect2D, margin: number): boolean {
  return (
    point.horizontal >= rect.left - margin &&
    point.horizontal <= rect.left + rect.width + margin &&
    point.vertical >= rect.top - margin &&
    point.vertical <= rect.top + rect.height + margin
  );
}

describe('hashStringToUint32 / derivePhaseForBox', () => {
  test('is deterministic for the same input', () => {
    expect(hashStringToUint32('same-id')).toBe(hashStringToUint32('same-id'));
    expect(derivePhaseForBox('same-id')).toEqual(derivePhaseForBox('same-id'));
  });

  test('different ids produce different phases', () => {
    expect(derivePhaseForBox('box-a')).not.toEqual(derivePhaseForBox('box-b'));
  });

  test('phase components are always within [0, 1)', () => {
    for (const id of ['a', 'box-123', '', 'a-very-long-box-identifier-string']) {
      const phase = derivePhaseForBox(id);
      expect(phase.horizontal).toBeGreaterThanOrEqual(0);
      expect(phase.horizontal).toBeLessThan(1);
      expect(phase.vertical).toBeGreaterThanOrEqual(0);
      expect(phase.vertical).toBeLessThan(1);
    }
  });
});

describe('computeDottedHolesPositions', () => {
  test('is deterministic for identical inputs', () => {
    const first = computeDottedHolesPositions(RECT, 0.12, PHASE);
    const second = computeDottedHolesPositions(RECT, 0.12, PHASE);
    expect(second).toEqual(first);
  });

  test('a different phase shifts the pattern without changing its density', () => {
    const withPhaseA = computeDottedHolesPositions(RECT, 0.12, PHASE);
    const withPhaseB = computeDottedHolesPositions(RECT, 0.12, OTHER_PHASE);
    expect(withPhaseB).not.toEqual(withPhaseA);
    expect(Math.abs(withPhaseB.length - withPhaseA.length)).toBeLessThanOrEqual(2);
  });

  test('every point stays within the rect', () => {
    for (const point of computeDottedHolesPositions(RECT, 0.12, PHASE)) {
      expect(isWithinRectMargin(point, RECT, 0)).toBe(true);
    }
  });

  test('a zero-size rect produces no points and never throws', () => {
    expect(() => computeDottedHolesPositions(ZERO_RECT, 0.12, PHASE)).not.toThrow();
    expect(computeDottedHolesPositions(ZERO_RECT, 0.12, PHASE)).toEqual([]);
  });
});

describe('computeGrainLinesSegments', () => {
  test('is deterministic for identical inputs', () => {
    expect(computeGrainLinesSegments(RECT, 0.08, 0.3)).toEqual(computeGrainLinesSegments(RECT, 0.08, 0.3));
  });

  test('a different phase shifts the pattern without changing its density', () => {
    const withPhaseA = computeGrainLinesSegments(RECT, 0.08, 0.1);
    const withPhaseB = computeGrainLinesSegments(RECT, 0.08, 0.6);
    expect(withPhaseB).not.toEqual(withPhaseA);
    expect(Math.abs(withPhaseB.length - withPhaseA.length)).toBeLessThanOrEqual(1);
  });

  test('every segment stays within the rect and has finite coordinates', () => {
    for (const segment of computeGrainLinesSegments(RECT, 0.08, 0.3)) {
      expect(isFiniteSegment(segment)).toBe(true);
      expect(isWithinRectMargin(segment.start, RECT, 0)).toBe(true);
      expect(isWithinRectMargin(segment.end, RECT, 0)).toBe(true);
    }
  });

  test('a zero-size rect produces no segments and never throws', () => {
    expect(() => computeGrainLinesSegments(ZERO_RECT, 0.08, 0.3)).not.toThrow();
    expect(computeGrainLinesSegments(ZERO_RECT, 0.08, 0.3)).toEqual([]);
  });
});

describe('computeBrickCoursingSegments', () => {
  test('is deterministic for identical inputs', () => {
    expect(computeBrickCoursingSegments(RECT, 0.1, 0.2)).toEqual(computeBrickCoursingSegments(RECT, 0.1, 0.2));
  });

  test('every segment has finite coordinates', () => {
    for (const segment of computeBrickCoursingSegments(RECT, 0.1, 0.2)) {
      expect(isFiniteSegment(segment)).toBe(true);
    }
  });

  test('a zero-size rect produces no segments and never throws', () => {
    expect(() => computeBrickCoursingSegments(ZERO_RECT, 0.1, 0.2)).not.toThrow();
    expect(computeBrickCoursingSegments(ZERO_RECT, 0.1, 0.2)).toEqual([]);
  });
});

describe('computeCrosshatchSegments', () => {
  test('is deterministic for identical inputs', () => {
    expect(computeCrosshatchSegments(RECT, 0.1)).toEqual(computeCrosshatchSegments(RECT, 0.1));
  });

  test('produces both horizontal and vertical segments', () => {
    const segments = computeCrosshatchSegments(RECT, 0.1);
    const hasHorizontal = segments.some(segment => segment.start.vertical === segment.end.vertical);
    const hasVertical = segments.some(segment => segment.start.horizontal === segment.end.horizontal);
    expect(hasHorizontal).toBe(true);
    expect(hasVertical).toBe(true);
  });

  test('a zero-size rect produces no segments and never throws', () => {
    expect(() => computeCrosshatchSegments(ZERO_RECT, 0.1)).not.toThrow();
    expect(computeCrosshatchSegments(ZERO_RECT, 0.1)).toEqual([]);
  });
});

describe('computeWavyLinesSegments', () => {
  test('is deterministic for identical inputs', () => {
    expect(computeWavyLinesSegments(RECT, 0.1, 0.4)).toEqual(computeWavyLinesSegments(RECT, 0.1, 0.4));
  });

  test('every segment has finite coordinates near the rect', () => {
    for (const segment of computeWavyLinesSegments(RECT, 0.1, 0.4)) {
      expect(isFiniteSegment(segment)).toBe(true);
      expect(isWithinRectMargin(segment.start, RECT, MARGIN_METERS)).toBe(true);
      expect(isWithinRectMargin(segment.end, RECT, MARGIN_METERS)).toBe(true);
    }
  });

  test('a zero-size rect produces no segments and never throws', () => {
    expect(() => computeWavyLinesSegments(ZERO_RECT, 0.1, 0.4)).not.toThrow();
    expect(computeWavyLinesSegments(ZERO_RECT, 0.1, 0.4)).toEqual([]);
  });
});

describe('computeGrassTuftsSegments', () => {
  test('is deterministic for identical inputs', () => {
    expect(computeGrassTuftsSegments(RECT, 0.09, PHASE)).toEqual(computeGrassTuftsSegments(RECT, 0.09, PHASE));
  });

  test('a different phase shifts the pattern without changing its density', () => {
    const withPhaseA = computeGrassTuftsSegments(RECT, 0.09, PHASE);
    const withPhaseB = computeGrassTuftsSegments(RECT, 0.09, OTHER_PHASE);
    expect(withPhaseB).not.toEqual(withPhaseA);
    expect(Math.abs(withPhaseB.length - withPhaseA.length)).toBeLessThanOrEqual(2);
  });

  test('every blade starts within the rect and has finite coordinates', () => {
    for (const segment of computeGrassTuftsSegments(RECT, 0.09, PHASE)) {
      expect(isFiniteSegment(segment)).toBe(true);
      expect(isWithinRectMargin(segment.start, RECT, 0)).toBe(true);
    }
  });

  test('a zero-size rect produces no segments and never throws', () => {
    expect(() => computeGrassTuftsSegments(ZERO_RECT, 0.09, PHASE)).not.toThrow();
    expect(computeGrassTuftsSegments(ZERO_RECT, 0.09, PHASE)).toEqual([]);
  });
});
