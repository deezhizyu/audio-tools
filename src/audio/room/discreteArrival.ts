import type { FrequencyBandValues } from './roomTypes';

/**
 * One coherent sound path reaching the listener at a single, exact moment: the straight-line direct sound
 * (`directSound.ts`) or a specular echo off one or two surfaces (`imageSources.ts`).
 *
 * The distinction from the diffuse tail matters, and getting it wrong is audible. A discrete arrival is a
 * genuine delayed copy of the source, so it is rendered as a scaled impulse whose amplitude is the square
 * root of its energy (`renderDiscreteArrivals.ts`) — convolved with dry audio, that reproduces exactly the
 * delayed copy it represents. Anything summed into the same sample adds in *amplitude*, which is only correct
 * for paths that really are coherent with each other. Monte Carlo samples of an extended surface are not:
 * rendering thousands of individually-traced ray bounces as discrete impulses (which this pipeline used to
 * do for every first bounce) makes them pile up in amplitude rather than energy, and since amplitude squares
 * into energy, N samples landing in one sample period deliver N times the energy they actually carry —
 * measured at roughly seven times too much reverberation in an ordinary room. Stochastic samples belong in
 * the energy histogram, which sums them as energy; only deterministic, genuinely coherent paths belong here.
 */
export interface DiscreteArrival {
  timeSeconds: number;
  energy: FrequencyBandValues;
  /** Left/right position as heard from the listener (-1 fully left, +1 fully right, 0 centered) — see
      `horizontalPanPosition` in `stereoPanning.ts`. */
  panPosition: number;
}
