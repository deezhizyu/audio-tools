import { describe, expect, test } from 'vitest';
import { stampDiscreteReflectionImpulses } from './stampDiscreteReflectionImpulses';
import type { ImpulseArrival } from './traceRays';

describe('stampDiscreteReflectionImpulses', () => {
  test('places an arrival as a broadband delta at its rounded sample index', () => {
    const impulseResponse = new Float32Array(10);
    const arrivals: ImpulseArrival[] = [{ timeSeconds: 0.003, energy: { low: 1, mid: 4, high: 9 } }];

    stampDiscreteReflectionImpulses(impulseResponse, arrivals, 1000);

    // sqrt(1) + sqrt(4) + sqrt(9) = 1 + 2 + 3
    expect(impulseResponse[3]).toBeCloseTo(6);
    expect(impulseResponse.filter((_, index) => index !== 3).every(value => value === 0)).toBe(true);
  });

  test('sums multiple arrivals landing on the same sample', () => {
    const impulseResponse = new Float32Array(10);
    const arrivals: ImpulseArrival[] = [
      { timeSeconds: 0.005, energy: { low: 1, mid: 0, high: 0 } },
      { timeSeconds: 0.005, energy: { low: 4, mid: 0, high: 0 } },
    ];

    stampDiscreteReflectionImpulses(impulseResponse, arrivals, 1000);

    expect(impulseResponse[5]).toBeCloseTo(1 + 2);
  });

  test('ignores arrivals that fall outside the buffer', () => {
    const impulseResponse = new Float32Array(4);
    const arrivals: ImpulseArrival[] = [
      { timeSeconds: -0.001, energy: { low: 1, mid: 1, high: 1 } },
      { timeSeconds: 1, energy: { low: 1, mid: 1, high: 1 } },
    ];

    expect(() => stampDiscreteReflectionImpulses(impulseResponse, arrivals, 1000)).not.toThrow();
    expect(Array.from(impulseResponse).every(value => value === 0)).toBe(true);
  });
});
