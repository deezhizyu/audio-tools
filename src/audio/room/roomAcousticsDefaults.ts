import type { FrequencyBandValues } from './roomTypes';

export const SPEED_OF_SOUND_METERS_PER_SECOND = 343;

/** Ray count chosen to stay comfortably sub-second off the main thread while still producing a dense enough
    reflection pattern to sound like a real room rather than a handful of discrete echoes. Rays contribute to
    the listener via next-event estimation (see `traceRays.ts`) rather than by wandering into a capture radius,
    so far fewer rays are needed than a receiver-sphere approach would require to reach the same density —
    every bounce with line of sight to the listener counts, not just the rare one that happens to graze a fixed
    sphere around it. */
export const NUMBER_OF_RAYS = 2048;

/** Purely a safety cap so a pathological scene can't spin forever — it is not what normally ends a ray. Ray
    lifetime is governed by Russian roulette (`RUSSIAN_ROULETTE_THRESHOLD`) and the distance budget
    (`MAXIMUM_RAY_DISTANCE_METERS`), which together make a ray live exactly as long as the room it's in
    warrants: roughly a dozen bounces in an absorptive room, a hundred or so in a bare concrete one. A fixed
    low cap (this used to be a flat 60) silently truncated reverberant rooms — 60 bounces is only ~0.65s of
    travel in a 10x10x3m room, so the tail simply stopped partway down instead of decaying. */
export const MAXIMUM_BOUNCES = 512;

/** Absolute floor on a ray's remaining reflection throughput — effectively -70dB, low enough that a true
    -60dB reverberation time can actually be represented. (This used to be 1e-4, i.e. -40dB: every ray was
    killed a full 20dB above the level RT60 is defined at, so the measured decay could never reach the point
    it's meant to be extrapolated from.) Russian roulette normally terminates rays well before this; it exists
    for degenerate cases like a fully absorptive scene. */
export const MINIMUM_ENERGY_THRESHOLD = 1e-7;

/** Throughput below which a ray starts being terminated stochastically rather than traced to exhaustion. A
    ray surviving roulette has its throughput divided by its survival probability, so the estimator stays
    unbiased — the tail keeps its true energy, it's just carried by progressively fewer, progressively
    heavier rays. This is what lets `MAXIMUM_BOUNCES` be a mere safety cap instead of the real terminator: a
    ray in an absorptive room dies after ~12 bounces on average, while one in a bare concrete room lives for
    ~110, which is exactly the asymmetry a fixed bounce budget could not express. */
export const RUSSIAN_ROULETTE_THRESHOLD = 0.1;

/** A much smaller ray budget used only while the room is actively being edited (see
    `INTERACTIVE_RAY_TRACING_PARAMS` in `traceRays.ts`) — tracing dominates a simulation's total time
    (histogram/synthesis/tap rendering are cheap by comparison), so this is where the time has to come from to
    make dragging a box or the listener feel live instead of laggy. A noticeably sparser, rougher-sounding
    reflection pattern, but one that updates fast enough to track a drag in real time. Once the room settles
    (`RESIMULATE_DEBOUNCE_MILLISECONDS` after the last edit in `roomReverbSignals.ts`), the full-budget pass
    replaces it with the accurate result. */
export const INTERACTIVE_NUMBER_OF_RAYS = 256;
export const INTERACTIVE_MAXIMUM_BOUNCES = 128;

export const HISTOGRAM_BIN_DURATION_SECONDS = 0.005;

/** How many reflections deep the deterministic image-source pass goes (see `imageSources.ts`). Two is the
    usual choice in hybrid room-acoustics engines: orders one and two are where a room's early reflection
    pattern — the part the ear reads as the size and shape of the space — actually lives, and they are also
    exactly the orders a stochastic ray tracer samples worst. Beyond that, paths multiply too fast to
    enumerate and are dense enough that the ray tracer's statistical treatment is the better model. The ray
    tracer omits its own specular lobe for all-specular paths at these orders so the two never both count the
    same echo. */
export const MAXIMUM_IMAGE_SOURCE_ORDER = 2;

/** The impulse response's length is chosen per simulation from the room's own estimated reverberation time
    (see `estimateReverbTime.ts` and `chooseImpulseResponseDurationSeconds`), not fixed. These are only the
    bounds that choice is clamped into: long enough that a very reverberant hall isn't cut off partway down
    its decay, short enough that an open field doesn't pay to convolve seconds of silence. A fixed length
    (this used to be a flat 3s) is wrong in both directions at once. */
export const MINIMUM_IMPULSE_RESPONSE_DURATION_SECONDS = 0.25;
export const MAXIMUM_IMPULSE_RESPONSE_DURATION_SECONDS = 6;

/** How much longer than the estimated RT60 the rendered impulse response runs, so the audible tail ends by
    decaying into the noise floor rather than at a visible edge. */
export const IMPULSE_RESPONSE_DURATION_HEADROOM = 1.2;

/** A ray's distance budget covers the longest impulse response we would ever render, so tracing is never what
    limits the tail — the adaptive duration above then trims whatever wasn't needed. A fixed distance cap
    (this used to be a flat 200m) silently favors small rooms: a bounce in a small room only costs a couple of
    meters, so many bounces fit under any reasonable cap, but a bounce in a large room can cost tens of
    meters, so a flat cap starves large rooms of reflections long before the window it's meant to fill. */
export const MAXIMUM_RAY_DISTANCE_METERS = MAXIMUM_IMPULSE_RESPONSE_DURATION_SECONDS * SPEED_OF_SOUND_METERS_PER_SECOND;

/** Floor on the hit-point-to-listener distance used when computing a reflection's inverse-square falloff (see
    `traceRays.ts`), so a bounce landing right next to the listener doesn't produce a divide-by-near-zero
    energy spike. The direct path uses the same floor, so a source placed on top of the listener is loud but
    finite. Mirrors the role of Steam Audio's `irradianceMinDistance`. */
export const MINIMUM_CONTRIBUTION_DISTANCE_METERS = 0.25;

/** Fraction of each bounce's reflection that scatters diffusely instead of reflecting specularly. This used
    to be the one scatter amount every surface in a room shared; scattering is now per-box, driven by the
    chosen `RoomMaterial`'s own `scatterAmount` times the box's `textureIntensity` (see
    `getEffectiveScatterAmount` in `roomMaterials.ts`). This constant lives on only as the
    `generic-object`/`generic-absorber` catalog entries' baseline value, so a freshly-drawn box (which starts
    on one of those generic materials) behaves like a typical lightly-textured building surface. */
export const SCATTER_AMOUNT = 0.1;

/** What a freshly-drawn box starts at, before anyone touches the per-object absorption sliders — a "lightly
    furnished room" ballpark (carpet, some soft furnishings) rather than bare concrete, so the out-of-the-box
    result reads as "a room with reverb" instead of "an empty tiled hallway". Existing objects keep whatever
    absorption they were drawn with; this only changes what new objects start at. Also lives on as the
    `generic-object`/`generic-absorber` catalog entries' baseline absorption, for the same reason as
    `SCATTER_AMOUNT` above. */
export const DEFAULT_OBJECT_ABSORPTION: FrequencyBandValues = { low: 0.25, mid: 0.25, high: 0.3 };
export const DEFAULT_ABSORBER_ABSORPTION: FrequencyBandValues = { low: 0.9, mid: 0.95, high: 0.98 };

/**
 * Total acoustic power radiated by the source, in the units the rest of this simulator works in. It is fixed
 * by the direct path rather than chosen freely: `synthesizeImpulseResponseFromHistogram.ts` renders the
 * direct sound at amplitude `1/distance`, i.e. intensity `1/distance²`, and a point source of power `P`
 * produces intensity `P/(4π·distance²)`, so `P = 4π` is the only value that makes reflections and the direct
 * sound share one scale.
 *
 * This is the constant whose absence made every simulated room sound far too dry. Each of `numberOfRays`
 * rays carries an equal share of the source's power — one ray represents a `4π/N` steradian cone of the
 * emission sphere — so a ray must start at `SOURCE_TOTAL_POWER / numberOfRays`. Starting every ray at a bare
 * `1` and dividing the result by `numberOfRays` (what this pipeline used to do, in two separate places)
 * leaves every reflection short by exactly this factor of 4π: about 11dB quieter than the direct sound it
 * should be balanced against, in every room, at every distance.
 */
export const SOURCE_TOTAL_POWER = 4 * Math.PI;

/** Each ray's share of `SOURCE_TOTAL_POWER`. The single place the ray-to-power conversion happens: arrivals
    come out of `traceRays.ts` already carrying absolute energy, so no consumer normalizes by ray count. */
export function energyPerRay(numberOfRays: number): number {
  return SOURCE_TOTAL_POWER / Math.max(1, numberOfRays);
}
