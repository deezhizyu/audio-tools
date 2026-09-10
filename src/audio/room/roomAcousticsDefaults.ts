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
    sounding tail built from too-regular specular paths. This used to be the one scatter amount every surface
    in a room shared; scattering is now per-box, driven by the chosen `RoomMaterial`'s own `scatterAmount` times
    the box's `textureIntensity` (see `getEffectiveScatterAmount` in `roomMaterials.ts`). This constant lives on
    only as the `generic-object`/`generic-absorber` catalog entries' baseline value, so a freshly-drawn box
    (which starts on one of those generic materials) reproduces exactly the room-wide behavior this constant
    used to define directly. Calibrated against Steam Audio's own shipped material library, which keeps this
    same parameter at a flat ~0.05 for every one of its built-in materials (see `roomMaterials.ts`) rather than
    using it as a strong per-material differentiator — a much higher value here measurably over-delivers
    reflected energy through `recordReflectionArrival`'s diffuse BRDF lobe in `traceRays.ts`. */
export const SCATTER_AMOUNT = 0.06;

/** 0.1/0.1/0.15 (bare concrete/tile) made a freshly-drawn room, before anyone touches the per-object absorption
    sliders, extremely live — matching the classical room-acoustics "critical distance" formula for a room that
    reflective, not a bug in the simulation. Raised to a "lightly furnished room" ballpark (carpet, some soft
    furnishings) instead, so the out-of-the-box result reads as "a room with reverb" rather than "an empty tiled
    hallway." (An earlier version of this comment cited specific measured reverberant/direct energy ratios for
    these two absorption values; those numbers were measured against the old, much higher `SCATTER_AMOUNT`
    and no longer describe this simulator's behavior now that scattering is calibrated against Steam Audio's
    own shipped materials — see `roomMaterials.ts` — so they've been removed rather than left stale.) Existing
    objects keep whatever absorption they were drawn with — this only changes what new objects start at. Also
    lives on only as the `generic-object`/`generic-absorber` catalog entries' baseline absorption, for the same
    reason as `SCATTER_AMOUNT` above. */
export const DEFAULT_OBJECT_ABSORPTION: FrequencyBandValues = { low: 0.25, mid: 0.25, high: 0.3 };
export const DEFAULT_ABSORBER_ABSORPTION: FrequencyBandValues = { low: 0.9, mid: 0.95, high: 0.98 };
