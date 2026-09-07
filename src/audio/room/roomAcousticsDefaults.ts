import type { FrequencyBandValues } from './roomTypes';

export const SPEED_OF_SOUND_METERS_PER_SECOND = 343;

/** Ray count/bounce budget chosen to stay comfortably sub-second off the main thread while still producing a
    dense enough reflection pattern to sound like a real room rather than a handful of discrete echoes.
    Rays contribute to the listener via next-event estimation (see `traceRays.ts`) rather than by wandering
    into a capture radius, so far fewer rays are needed than a receiver-sphere approach would require to
    reach the same density — every bounce with line of sight to the listener counts, not just the rare one
    that happens to graze a fixed sphere around it. */
export const NUMBER_OF_RAYS = 2048;
export const MAXIMUM_BOUNCES = 60;
export const MINIMUM_ENERGY_THRESHOLD = 1e-4;

export const HISTOGRAM_BIN_DURATION_SECONDS = 0.005;
export const MAXIMUM_IMPULSE_RESPONSE_DURATION_SECONDS = 3;

/** A ray's distance budget is derived directly from how much of the impulse response we're actually filling —
    not an arbitrary flat number. A fixed distance cap (this used to be a flat 200m) silently favors small
    rooms: a bounce in a small room only costs a couple of meters, so many bounces fit under any reasonable
    cap, but a bounce in a large room can cost tens of meters, so a flat cap starves large rooms of reflections
    long before the 3-second window it's meant to fill — cutting the tail short and making big rooms sound far
    drier than they should. Sizing the budget off the target duration instead means a ray can always keep
    bouncing for the full window regardless of the room's scale. */
export const MAXIMUM_RAY_DISTANCE_METERS = MAXIMUM_IMPULSE_RESPONSE_DURATION_SECONDS * SPEED_OF_SOUND_METERS_PER_SECOND;

/** Floor on the hit-point-to-listener distance used when computing a reflection's inverse-square falloff (see
    `traceRays.ts`), so a bounce landing right next to the listener doesn't produce a divide-by-near-zero
    energy spike. Mirrors the role of Steam Audio's `irradianceMinDistance`. */
export const MINIMUM_CONTRIBUTION_DISTANCE_METERS = 0.25;

/** Fraction of each bounce's reflection that scatters into a random direction instead of reflecting purely
    specularly — real surfaces are never perfect mirrors, and a little diffusion avoids an unnaturally metallic-
    sounding tail built from too-regular specular paths. */
export const SCATTER_AMOUNT = 0.15;

export const DEFAULT_WALL_ABSORPTION: FrequencyBandValues = { low: 0.1, mid: 0.1, high: 0.15 };
export const DEFAULT_ABSORBER_ABSORPTION: FrequencyBandValues = { low: 0.9, mid: 0.95, high: 0.98 };
