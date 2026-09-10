import type { FrequencyBandValues } from './roomTypes';

/** Per-meter exponential energy decay coefficients for sound traveling through air, split into the same
    low/mid/high bands as the rest of this simulator. Matches Steam Audio's own shipped
    `AirAbsorptionModel::kDefaultCoefficients` — high frequencies lose energy to air over distance
    noticeably faster than low ones, independent of anything the sound reflects off. Absent this, every
    reflection's high band stays exactly as bright as its low band no matter how far it traveled, which
    reads as an unnaturally harsh/hissy sheen on any reflection with real path length behind it. */
export const AIR_ABSORPTION_COEFFICIENTS_PER_METER: FrequencyBandValues = { low: 0.0002, mid: 0.0017, high: 0.0182 };

/** Applies distance-based air absorption to an already-computed energy value. Energy (not amplitude) is
    the unit in play throughout this simulator's ray tracer, so the standard `exp(-coefficient * distance)`
    energy-decay form is used directly — no amplitude/sqrt correction is needed here, unlike Steam Audio's
    own reconstructor, which only needs one because it applies this model after already converting to
    amplitude-domain samples. */
export function applyAirAbsorption(energy: FrequencyBandValues, distanceMeters: number): FrequencyBandValues {
  return {
    low: energy.low * Math.exp(-AIR_ABSORPTION_COEFFICIENTS_PER_METER.low * distanceMeters),
    mid: energy.mid * Math.exp(-AIR_ABSORPTION_COEFFICIENTS_PER_METER.mid * distanceMeters),
    high: energy.high * Math.exp(-AIR_ABSORPTION_COEFFICIENTS_PER_METER.high * distanceMeters),
  };
}
