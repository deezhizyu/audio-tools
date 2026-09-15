/**
 * A small, fast, deterministic random source for the room simulation.
 *
 * Determinism is the point, not speed. Ray tracing and noise synthesis both draw millions of numbers, and
 * with `Math.random` the same room simulated twice produces two different impulse responses — the paths and
 * the noise texture differ even though nothing about the room changed. Live editing runs a simulation on
 * every edit and crossfades between consecutive results (`blendImpulseResponses.ts`), so that variation is
 * audible as the reverb's character shifting continuously under a drag, with nothing to settle onto. Seeding
 * from a fixed value instead means an unchanged room re-simulates to exactly the same answer, and only a real
 * change to the room changes what is heard.
 *
 * xorshift32: one of the cheapest generators with a full period and no obvious structure, which is all this
 * needs — the sequence feeds Monte Carlo sampling, not anything that has to withstand scrutiny.
 */
export function createSeededRandomSource(seed: number): () => number {
  // Zero is xorshift's one fixed point, where it would return nothing but zero forever.
  let state = seed >>> 0 || 0x9e3779b9;

  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}
