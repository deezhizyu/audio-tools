import type { ImpulseArrival } from './traceRays';

export interface EnergyHistogram {
  binDurationSeconds: number;
  low: Float32Array;
  mid: Float32Array;
  high: Float32Array;
}

/** Bins ray arrivals into fixed-width time buckets per frequency band, normalized by the number of rays fired
    so the result reads as "expected energy density over time" regardless of how many rays were used to sample
    it. This energy-decay curve is what `synthesizeImpulseResponseFromHistogram.ts` turns into actual audio. */
export function buildEnergyHistogram(
  arrivals: ImpulseArrival[],
  numberOfRays: number,
  binDurationSeconds: number,
  totalDurationSeconds: number,
): EnergyHistogram {
  const binCount = Math.max(1, Math.ceil(totalDurationSeconds / binDurationSeconds));
  const low = new Float32Array(binCount);
  const mid = new Float32Array(binCount);
  const high = new Float32Array(binCount);

  for (const arrival of arrivals) {
    if (arrival.timeSeconds < 0 || arrival.timeSeconds >= totalDurationSeconds) continue;
    const binIndex = Math.min(binCount - 1, Math.floor(arrival.timeSeconds / binDurationSeconds));
    low[binIndex] += arrival.energy.low;
    mid[binIndex] += arrival.energy.mid;
    high[binIndex] += arrival.energy.high;
  }

  const normalizationFactor = 1 / Math.max(1, numberOfRays);
  for (let binIndex = 0; binIndex < binCount; binIndex++) {
    low[binIndex] *= normalizationFactor;
    mid[binIndex] *= normalizationFactor;
    high[binIndex] *= normalizationFactor;
  }

  return { binDurationSeconds, low, mid, high };
}
