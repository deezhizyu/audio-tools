import { describe, expect, test } from 'vitest';
import { createSeededRandomSource } from './seededRandom';

function draw(randomSource: () => number, count: number): number[] {
  return Array.from({ length: count }, () => randomSource());
}

describe('createSeededRandomSource', () => {
  test('the same seed always produces the same sequence', () => {
    // What the whole module exists for: an unchanged room has to re-simulate to exactly the same impulse
    // response, or live editing hears the reverb's character drifting under a drag that changed nothing.
    expect(draw(createSeededRandomSource(1234), 200)).toEqual(draw(createSeededRandomSource(1234), 200));
  });

  test('different seeds produce different sequences', () => {
    expect(draw(createSeededRandomSource(1), 50)).not.toEqual(draw(createSeededRandomSource(2), 50));
  });

  test('stays within [0, 1)', () => {
    for (const value of draw(createSeededRandomSource(99), 5000)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  test('spreads evenly enough to sample with', () => {
    // Monte Carlo sampling only needs the values not to clump; a visibly lopsided generator would bias ray
    // directions toward one part of the sphere.
    const buckets = new Array(10).fill(0);
    for (const value of draw(createSeededRandomSource(7), 100000)) buckets[Math.floor(value * 10)]++;

    for (const count of buckets) {
      expect(count).toBeGreaterThan(9000);
      expect(count).toBeLessThan(11000);
    }
  });

  test('a zero seed still generates, rather than sticking at zero forever', () => {
    // Zero is xorshift's one fixed point, and a generator that returns nothing but zero would send every ray
    // in the same direction.
    expect(new Set(draw(createSeededRandomSource(0), 100)).size).toBeGreaterThan(50);
  });
});
