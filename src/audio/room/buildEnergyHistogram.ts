import type { ImpulseArrival } from './traceRays';

export interface EnergyHistogram {
  binDurationSeconds: number;
  low: Float32Array;
  mid: Float32Array;
  high: Float32Array;
  /** Each bin's energy-weighted average `lateralPosition` across the arrivals that landed in it (-1 fully
      left, +1 fully right, 0 centered, and 0 for a bin with no energy at all) — lets
      `synthesizeImpulseResponseFromHistogram.ts` shadow the tail toward one ear, without this module needing
      to know anything about how the listener hears. Averaging is all a bin can carry: it summarizes thousands
      of paths arriving from every direction, and a single side-to-side bias is the only part of that which
      survives being summed together. */
  lateralPosition: Float32Array;
}

/** Bins ray arrivals into fixed-width time buckets per frequency band. Arrivals already carry absolute energy
    — each ray was fired carrying its own share of the source's power (see `energyPerRay` in
    `roomAcousticsDefaults.ts`) — so nothing is normalized by ray count here; a bin simply holds the total
    energy that reached the listener during it. That makes the histogram directly comparable to the direct
    path's own energy, which is what `synthesizeImpulseResponseFromHistogram.ts` relies on to place the two on
    one scale. This energy-decay curve is also what `estimateReverbTime.ts` reads to size the impulse
    response. */
export function buildEnergyHistogram(arrivals: ImpulseArrival[], binDurationSeconds: number, totalDurationSeconds: number): EnergyHistogram {
  const binCount = Math.max(1, Math.ceil(totalDurationSeconds / binDurationSeconds));
  const low = new Float32Array(binCount);
  const mid = new Float32Array(binCount);
  const high = new Float32Array(binCount);
  const weightedLateralSum = new Float32Array(binCount);
  const lateralWeightSum = new Float32Array(binCount);

  for (const arrival of arrivals) {
    if (arrival.timeSeconds < 0 || arrival.timeSeconds >= totalDurationSeconds) continue;
    const binIndex = Math.min(binCount - 1, Math.floor(arrival.timeSeconds / binDurationSeconds));
    low[binIndex] += arrival.energy.low;
    mid[binIndex] += arrival.energy.mid;
    high[binIndex] += arrival.energy.high;

    const arrivalTotalEnergy = arrival.energy.low + arrival.energy.mid + arrival.energy.high;
    weightedLateralSum[binIndex] += arrival.lateralPosition * arrivalTotalEnergy;
    lateralWeightSum[binIndex] += arrivalTotalEnergy;
  }

  const lateralPosition = new Float32Array(binCount);
  for (let binIndex = 0; binIndex < binCount; binIndex++) {
    lateralPosition[binIndex] = lateralWeightSum[binIndex] > 0 ? weightedLateralSum[binIndex] / lateralWeightSum[binIndex] : 0;
  }

  return { binDurationSeconds, low, mid, high, lateralPosition };
}

/** A copy of `histogram` covering only its first `durationSeconds` — used to trim the generously-sized
    tracing histogram down to the length actually worth rendering once the room's reverberation time is known
    (see `estimateReverbTime.ts`). Returns the histogram unchanged when it is already short enough. */
export function truncateEnergyHistogram(histogram: EnergyHistogram, durationSeconds: number): EnergyHistogram {
  const binCount = Math.max(1, Math.ceil(durationSeconds / histogram.binDurationSeconds));
  if (binCount >= histogram.low.length) return histogram;

  return {
    binDurationSeconds: histogram.binDurationSeconds,
    low: histogram.low.slice(0, binCount),
    mid: histogram.mid.slice(0, binCount),
    high: histogram.high.slice(0, binCount),
    lateralPosition: histogram.lateralPosition.slice(0, binCount),
  };
}
