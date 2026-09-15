import { describe, expect, test } from 'vitest';
import { MAXIMUM_IMAGE_SOURCE_ORDER } from './roomAcousticsDefaults';
import { traceRays, type RayTracingParams } from './traceRays';
import type { RoomBox, RoomMaterialId, RoomScene } from './roomTypes';

/** Always returns 0.5, so every `randomUnitVector` call in `traceRays.ts` resolves to the same direction
    (approximately -x) and every test run is fully deterministic. */
const FIXED_RANDOM_SOURCE = () => 0.5;

function buildParams(overrides: Partial<RayTracingParams> = {}): RayTracingParams {
  return {
    numberOfRays: 1,
    maximumBounces: 1,
    speedOfSoundMetersPerSecond: 343,
    minimumContributionDistanceMeters: 0.25,
    minimumEnergyThreshold: 1e-4,
    maximumDistanceMeters: 200,
    randomSource: FIXED_RANDOM_SOURCE,
    ...overrides,
  };
}

/** Uses the `generic-object`/`generic-absorber` materials, whose `scatterAmount` is the `SCATTER_AMOUNT`
    baseline a freshly-drawn box starts on (see `roomMaterials.ts`). */
function buildObjectBox(overrides: Partial<RoomBox> = {}): RoomBox {
  return {
    id: 'box-1',
    kind: 'object',
    x: -1,
    y: -1,
    z: -1,
    width: 2,
    height: 2,
    depth: 2,
    absorption: { low: 0.1, mid: 0.1, high: 0.1 },
    materialId: 'generic-object',
    textureIntensity: 1,
    ...overrides,
  };
}

describe('traceRays', () => {
  test('a reflection off an object arrives with the total bounce distance, not the straight-line distance', () => {
    // Ray travels from source (x=5) in -x, hits the object at x=1, and has a clear shadow-ray path back to the
    // listener behind the source: source -> hit is 4m, hit -> listener is 7m.
    const scene: RoomScene = { boxes: [buildObjectBox()], source: { x: 5, y: 0, z: 0 }, listener: { x: 8, y: 0, z: 0 } };
    const arrivals = traceRays(scene, buildParams());

    expect(arrivals).toHaveLength(1);
    expect(arrivals[0].timeSeconds).toBeCloseTo(11 / 343, 5);
    // The reflection point (around x=1) sits to the left of the listener (x=8) along the left/right axis.
    expect(arrivals[0].panPosition).toBeLessThan(0);
  });

  test('an absorber ends the ray immediately, contributing no reflection arrival', () => {
    const scene: RoomScene = { boxes: [buildObjectBox({ kind: 'absorber', materialId: 'generic-absorber' })], source: { x: 5, y: 0, z: 0 }, listener: { x: 8, y: 0, z: 0 } };
    const arrivals = traceRays(scene, buildParams());
    expect(arrivals).toHaveLength(0);
  });

  test('produces no arrival when a second box blocks the shadow ray from the reflection point to the listener', () => {
    // Object at x:[-1,1] reflects the ray at x=1. A second object at x:[6,7] doesn't touch the source-to-hit
    // path (x from 5 down to 1) but sits squarely between the reflection point and the listener at x=10,
    // blocking the next-event-estimation shadow ray.
    const blockingObject = buildObjectBox({ x: 6, width: 1 });
    const scene: RoomScene = { boxes: [buildObjectBox(), blockingObject], source: { x: 5, y: 0, z: 0 }, listener: { x: 10, y: 0, z: 0 } };
    const arrivals = traceRays(scene, buildParams());
    expect(arrivals).toHaveLength(0);
  });

  test('a single enclosing box works as a room: a ray bounces off its inner surface instead of passing through', () => {
    // Source and listener both sit inside one big box (a 20m room), instead of being surrounded by separate
    // object slabs. The ray (heading -x) must reflect off the box's inner surface at x=-10 and travel back to
    // the listener — if the box were still only hit-testable from outside, this would report zero arrivals.
    const enclosingRoom = buildObjectBox({ x: -10, y: -10, z: -10, width: 20, height: 20, depth: 20 });
    const scene: RoomScene = { boxes: [enclosingRoom], source: { x: 5, y: 0, z: 0 }, listener: { x: 8, y: 0, z: 0 } };
    const arrivals = traceRays(scene, buildParams());

    expect(arrivals).toHaveLength(1);
    // source(5) -> inner surface at x=-10 is 15m, surface -> listener(8) is 18m.
    expect(arrivals[0].timeSeconds).toBeCloseTo(33 / 343, 3);
  });

  test('close source and listener no longer flood the histogram with spurious near-zero-time energy', () => {
    // Regression test for the muffling bug: previously, any ray whose very first segment (before bouncing off
    // anything) passed within a fixed receiver radius of the listener recorded a spurious arrival — so a
    // listener sitting close to the source picked up noise from every ray fired, regardless of where it was
    // headed. Here the only object is well off the ray's path (it travels along y=0, z=0; the object sits
    // entirely outside that line), so the ray never hits anything, and a close listener must not change that.
    const farOffAxisObject = buildObjectBox({ x: -50, y: 40, z: 40, width: 2, height: 2, depth: 2 });
    const scene: RoomScene = { boxes: [farOffAxisObject], source: { x: 0, y: 0, z: 0 }, listener: { x: 0.1, y: 0, z: 0 } };
    const arrivals = traceRays(scene, buildParams());
    expect(arrivals).toHaveLength(0);
  });

  test('a rougher material contributes different reflection energy than a smoother one', () => {
    // Same geometry, only the hit object's material differs. The shadow-ray contribution's diffuse lobe
    // weight is directly proportional to the hit surface's effective scatter amount (see
    // `getEffectiveScatterAmount`/`recordReflectionArrival`), so a near-specular material (smooth metal,
    // scatterAmount 0.05) and a diffuse one (grass, scatterAmount 0.3) must produce measurably different
    // arrival energy for the same bounce — confirming scattering is now read per-hit-box rather than from one
    // fixed global constant.
    const smoothObject = buildObjectBox({ materialId: 'smooth-metal' });
    const roughObject = buildObjectBox({ materialId: 'grass' });

    const smoothResult = traceRays({ boxes: [smoothObject], source: { x: 5, y: 0, z: 0 }, listener: { x: 8, y: 0, z: 0 } }, buildParams());
    const roughResult = traceRays({ boxes: [roughObject], source: { x: 5, y: 0, z: 0 }, listener: { x: 8, y: 0, z: 0 } }, buildParams());

    expect(smoothResult).toHaveLength(1);
    expect(roughResult).toHaveLength(1);
    expect(roughResult[0].energy.low).not.toBeCloseTo(smoothResult[0].energy.low, 6);
  });

  test('a first bounce contributes only its diffuse lobe — its specular part belongs to the image-source pass', () => {
    // This geometry (source(5,0,0) -> hit(1,0,0) -> listener(8,0,0)) puts the listener exactly along the ray's
    // mirror-reflection direction, so a near-specular material would deliver a large specular contribution
    // here if one were counted. None is: a first bounce off a single surface is an exactly-computable specular
    // path, and `imageSources.ts` computes it rather than sampling it. What survives here is the diffuse lobe
    // alone, so the rough material (grass) now out-delivers the near-specular one (smooth metal) — the
    // opposite ordering to a tracer that counts both, and the check that the two mechanisms aren't both
    // claiming the same echo.
    const smoothObject = buildObjectBox({ materialId: 'smooth-metal' });
    const roughObject = buildObjectBox({ materialId: 'grass' });
    const buildScene = (box: RoomBox): RoomScene => ({ boxes: [box], source: { x: 5, y: 0, z: 0 }, listener: { x: 8, y: 0, z: 0 } });

    const [smoothArrival] = traceRays(buildScene(smoothObject), buildParams());
    const [roughArrival] = traceRays(buildScene(roughObject), buildParams());

    expect(roughArrival.energy.low).toBeGreaterThan(smoothArrival.energy.low);
  });

  test('a bounce past the image-source orders counts its specular lobe again', () => {
    // Beyond the orders `imageSources.ts` enumerates, specular energy has nowhere else to be accounted for, so
    // the tracer takes it back. With the fixed random source the ray runs straight down -x, mirroring back and
    // forth between the enclosing room's inner faces, and the listener sits on that line — so every bounce is
    // aimed squarely at it and a counted specular lobe is unmistakable against a diffuse-only one.
    const enclosingRoom = buildObjectBox({ x: -10, y: -10, z: -10, width: 20, height: 20, depth: 20, materialId: 'smooth-metal' });
    const scene: RoomScene = { boxes: [enclosingRoom], source: { x: 5, y: 0, z: 0 }, listener: { x: 8, y: 0, z: 0 } };
    const arrivals = traceRays(scene, buildParams({ maximumBounces: MAXIMUM_IMAGE_SOURCE_ORDER + 1 }));

    expect(arrivals).toHaveLength(MAXIMUM_IMAGE_SOURCE_ORDER + 1);
    const lastArrival = arrivals[arrivals.length - 1];
    for (const earlierArrival of arrivals.slice(0, MAXIMUM_IMAGE_SOURCE_ORDER)) {
      expect(lastArrival.energy.low).toBeGreaterThan(earlierArrival.energy.low);
    }
  });

  test('a ray keeps bouncing and contributing for as many bounces as it is allowed', () => {
    // Same enclosing-room fixture as above, but with room to bounce twice: with the fixed random source the
    // ray travels essentially exactly along -x (see the comment on FIXED_RANDOM_SOURCE), so it hits the inner
    // surface at x=-10 first, reflects to essentially exactly +x, then hits the opposite inner surface at
    // x=10 — two distinct bounces, both with a clear shadow-ray path to the listener at x=8.
    const enclosingRoom = buildObjectBox({ x: -10, y: -10, z: -10, width: 20, height: 20, depth: 20 });
    const scene: RoomScene = { boxes: [enclosingRoom], source: { x: 5, y: 0, z: 0 }, listener: { x: 8, y: 0, z: 0 } };

    expect(traceRays(scene, buildParams({ maximumBounces: 1 }))).toHaveLength(1);
    expect(traceRays(scene, buildParams({ maximumBounces: 2 }))).toHaveLength(2);
  });

  test('air absorption rolls off high-frequency energy over distance faster than low-frequency energy', () => {
    // Same absorption/scatter/geometry shape, just moved much farther away — comparing the high/low energy
    // *ratio* (rather than either band in isolation) cancels out the geometric 1/distance² and material
    // absorption terms, which apply identically to every band, isolating air absorption's frequency-dependent
    // effect (see `airAbsorption.ts`).
    const nearScene: RoomScene = { boxes: [buildObjectBox()], source: { x: 5, y: 0, z: 0 }, listener: { x: 8, y: 0, z: 0 } };
    const farScene: RoomScene = { boxes: [buildObjectBox({ x: -50, width: 2 })], source: { x: 5, y: 0, z: 0 }, listener: { x: 8, y: 0, z: 0 } };

    const [nearArrival] = traceRays(nearScene, buildParams());
    const [farArrival] = traceRays(farScene, buildParams());

    const nearHighToLowRatio = nearArrival.energy.high / nearArrival.energy.low;
    const farHighToLowRatio = farArrival.energy.high / farArrival.energy.low;
    expect(farHighToLowRatio).toBeLessThan(nearHighToLowRatio);
  });

  test('a rough material does not deliver unboundedly more total reflected energy than a smooth one for the same room', () => {
    // Regression test for the "car cabin" energy-inflation bug: before recordReflectionArrival had a specular
    // lobe, raising a material's scatterAmount scaled up its next-event-estimation contribution with nothing to
    // balance it, so a rough material's total delivered energy (summed across many rays and bounces) could run
    // many times a smooth material's for identical geometry — an unnaturally dense, front-loaded reflection
    // burst. With complementary diffuse (scatterAmount) and specular (1 - scatterAmount) lobes, the total should
    // stay within a modest factor of each other instead.
    function seededRandom(seed: number): () => number {
      let state = seed;
      return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
      };
    }

    const totalLowEnergy = (materialId: RoomMaterialId): number => {
      const room = buildObjectBox({ materialId, x: -2.4, y: 0, z: -2.09, width: 4.8, height: 2.5, depth: 4.17 });
      const scene: RoomScene = { boxes: [room], source: { x: -0.8, y: 1.2, z: 0 }, listener: { x: 0.5, y: 1.2, z: 0 } };
      const params = buildParams({ numberOfRays: 300, maximumBounces: 20, randomSource: seededRandom(42) });
      return traceRays(scene, params).reduce((sum, arrival) => sum + arrival.energy.low, 0);
    };

    const smoothTotal = totalLowEnergy('smooth-metal');
    const roughTotal = totalLowEnergy('grass');

    expect(smoothTotal).toBeGreaterThan(0);
    expect(roughTotal).toBeGreaterThan(0);
    expect(roughTotal / smoothTotal).toBeLessThan(3);
    expect(smoothTotal / roughTotal).toBeLessThan(3);
  });
});
