import { describe, expect, test } from 'vitest';
import { stampDiscreteReflectionImpulses } from './stampDiscreteReflectionImpulses';
import type { ImpulseArrival } from './traceRays';

describe('stampDiscreteReflectionImpulses', () => {
  test('places an arrival as a broadband delta at its rounded sample index', () => {
    const impulseResponse = new Float32Array(10);
    const arrivals: ImpulseArrival[] = [{ timeSeconds: 0.003, energy: { low: 1, mid: 4, high: 9 } }];

    stampDiscreteReflectionImpulses(impulseResponse, arrivals, 1000, 1);

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

    stampDiscreteReflectionImpulses(impulseResponse, arrivals, 1000, 1);

    expect(impulseResponse[5]).toBeCloseTo(1 + 2);
  });

  test('ignores arrivals that fall outside the buffer', () => {
    const impulseResponse = new Float32Array(4);
    const arrivals: ImpulseArrival[] = [
      { timeSeconds: -0.001, energy: { low: 1, mid: 1, high: 1 } },
      { timeSeconds: 1, energy: { low: 1, mid: 1, high: 1 } },
    ];

    expect(() => stampDiscreteReflectionImpulses(impulseResponse, arrivals, 1000, 1)).not.toThrow();
    expect(Array.from(impulseResponse).every(value => value === 0)).toBe(true);
  });

  test('divides energy by the ray count before converting to amplitude, matching the late-tail histogram convention', () => {
    // The same arrival fired against two different ray counts should NOT produce the same amplitude — without
    // this normalization, tracing more rays would make the early region louder rather than converging to a
    // stable result, since next-event estimation lets many rays independently rediscover the same reflection.
    const arrivals: ImpulseArrival[] = [{ timeSeconds: 0.001, energy: { low: 4, mid: 0, high: 0 } }];

    const withOneRay = new Float32Array(4);
    stampDiscreteReflectionImpulses(withOneRay, arrivals, 1000, 1);

    const withFourRays = new Float32Array(4);
    stampDiscreteReflectionImpulses(withFourRays, arrivals, 1000, 4);

    // sqrt(4/1) = 2 versus sqrt(4/4) = 1.
    expect(withOneRay[1]).toBeCloseTo(2);
    expect(withFourRays[1]).toBeCloseTo(1);
  });
});
