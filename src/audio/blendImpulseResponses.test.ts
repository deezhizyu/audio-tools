import { describe, expect, test } from 'vitest';
import { blendImpulseResponses } from './blendImpulseResponses';

function channels(...values: number[][]): Float32Array<ArrayBuffer>[] {
  return values.map(channel => Float32Array.from(channel) as Float32Array<ArrayBuffer>);
}

describe('blendImpulseResponses', () => {
  test('averages each sample of each channel at the default (equal) weight', () => {
    const previous = channels([0, 1, 2], [10, 20, 30]);
    const next = channels([4, 5, 6], [40, 50, 60]);

    const blended = blendImpulseResponses(previous, next);

    expect(Array.from(blended[0])).toEqual([2, 3, 4]);
    expect(Array.from(blended[1])).toEqual([25, 35, 45]);
  });

  test('weighs the new impulse response more heavily as blendWeight increases toward 1', () => {
    const previous = channels([0, 0, 0]);
    const next = channels([10, 10, 10]);

    expect(Array.from(blendImpulseResponses(previous, next, 0.25))[0]).toEqual(Float32Array.from([2.5, 2.5, 2.5]));
    expect(Array.from(blendImpulseResponses(previous, next, 0.75))[0]).toEqual(Float32Array.from([7.5, 7.5, 7.5]));
  });

  test('blendWeight 0 reproduces the previous impulse response exactly', () => {
    const previous = channels([1, 2, 3]);
    const next = channels([9, 9, 9]);
    expect(Array.from(blendImpulseResponses(previous, next, 0)[0])).toEqual([1, 2, 3]);
  });

  test('blendWeight 1 reproduces the next impulse response exactly', () => {
    const previous = channels([1, 2, 3]);
    const next = channels([9, 9, 9]);
    expect(Array.from(blendImpulseResponses(previous, next, 1)[0])).toEqual([9, 9, 9]);
  });

  test('falls back to the next impulse response unchanged when there is no previous one', () => {
    const next = channels([1, 2, 3]);
    expect(blendImpulseResponses([], next)).toBe(next);
  });

  test('falls back to the next impulse response unchanged when channel counts differ', () => {
    const previous = channels([1, 2, 3]);
    const next = channels([4, 5, 6], [7, 8, 9]);
    expect(blendImpulseResponses(previous, next)).toBe(next);
  });

  test('falls back to the next impulse response unchanged when a channel length differs (e.g. a new dry file at a different sample rate)', () => {
    const previous = channels([1, 2, 3, 4]);
    const next = channels([5, 6, 7]);
    expect(blendImpulseResponses(previous, next)).toBe(next);
  });
});
