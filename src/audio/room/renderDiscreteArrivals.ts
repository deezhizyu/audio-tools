import { buildBandImpulseKernel } from './bandSplitFilters';
import type { DiscreteArrival } from './discreteArrival';
import { computeEarResponse, EARS, toListenerLocalDirection } from './listenerHeadModel';
import { addBandLimitedImpulse } from './renderBandLimitedImpulse';
import type { RoomListener } from './roomTypes';

/**
 * Adds every coherent arrival — the direct sound and each specular image-source echo — into the channels as
 * a band-colored impulse at its own exact, fractional delay. Convolved with dry audio later
 * (`convolveWithImpulseResponse.ts`), each one reproduces a true delayed copy of the source, which is what a
 * real specular reflection is: not added texture, but the same sound arriving again slightly later, mildly
 * recolored by whatever it bounced off. That coherence is why these paths fuse with the direct sound into a
 * single perceived event that simply sounds like it is in a room, rather than reading as separate noise
 * layered on top.
 *
 * Each ear gets its own version of every arrival — its own arrival time and its own per-band level, from
 * `listenerHeadModel.ts`. That is where the spatial impression actually comes from: the few hundred
 * microseconds between one ear and the other, and how much of the top end the head blocks on the way to the
 * far one. A mono listener collapses all of it and both channels come out identical.
 *
 * Mutates `channels` in place.
 */
export function renderDiscreteArrivals(
  channels: Float32Array<ArrayBuffer>[],
  arrivals: DiscreteArrival[],
  sampleRate: number,
  listener: RoomListener,
): void {
  const kernel = buildBandImpulseKernel(sampleRate);

  for (const arrival of arrivals) {
    const local = toListenerLocalDirection(arrival.directionFromListener, listener);

    channels.forEach((channel, channelIndex) => {
      const ear = EARS[Math.min(channelIndex, EARS.length - 1)];
      const { delaySeconds, gains } = computeEarResponse(local, ear, listener);
      // Floored at zero: the nearer ear's offset is negative, and a source almost on top of the listener can
      // in principle push the arrival before time zero, where it would simply be dropped.
      const earDelaySeconds = Math.max(0, arrival.timeSeconds + delaySeconds);

      addBandLimitedImpulse(channel, earDelaySeconds, sampleRate, kernel, {
        low: Math.sqrt(arrival.energy.low * gains.low),
        mid: Math.sqrt(arrival.energy.mid * gains.mid),
        high: Math.sqrt(arrival.energy.high * gains.high),
      });
    });
  }
}
