import { describe, expect, test } from 'vitest';
import { horizontalPanPosition, stereoPanWeightsFromPosition } from './stereoPanning';

describe('horizontalPanPosition', () => {
  test('is -1 for a direction pointing straight left', () => {
    expect(horizontalPanPosition({ x: -1, y: 0, z: 0 })).toBeCloseTo(-1);
  });

  test('is +1 for a direction pointing straight right', () => {
    expect(horizontalPanPosition({ x: 1, y: 0, z: 0 })).toBeCloseTo(1);
  });

  test('is 0 for a direction pointing straight ahead', () => {
    expect(horizontalPanPosition({ x: 0, y: 0, z: 1 })).toBeCloseTo(0);
  });

  test('ignores elevation — a direction straight up has no left/right position', () => {
    expect(horizontalPanPosition({ x: 0, y: 1, z: 0 })).toBe(0);
  });

  test('a direction angled up-and-right still reads as fully right, since only the horizontal plane matters', () => {
    expect(horizontalPanPosition({ x: 1, y: 5, z: 0 })).toBeCloseTo(1);
  });
});

describe('stereoPanWeightsFromPosition', () => {
  test('routes fully to the left channel at position -1', () => {
    const weights = stereoPanWeightsFromPosition(-1);
    expect(weights.left).toBeCloseTo(1);
    expect(weights.right).toBeCloseTo(0);
  });

  test('routes fully to the right channel at position +1', () => {
    const weights = stereoPanWeightsFromPosition(1);
    expect(weights.left).toBeCloseTo(0);
    expect(weights.right).toBeCloseTo(1);
  });

  test('splits evenly between channels when centered', () => {
    const weights = stereoPanWeightsFromPosition(0);
    expect(weights.left).toBeCloseTo(weights.right);
  });

  test('keeps constant power (left² + right² = 1) at every position, not just the extremes', () => {
    for (const panPosition of [-1, -0.6, -0.25, 0, 0.4, 0.75, 1]) {
      const weights = stereoPanWeightsFromPosition(panPosition);
      expect(weights.left * weights.left + weights.right * weights.right).toBeCloseTo(1);
    }
  });
});
