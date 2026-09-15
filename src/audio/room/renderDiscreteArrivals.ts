import { buildBandImpulseKernel } from './bandSplitFilters';
import type { DiscreteArrival } from './discreteArrival';
import { addBandLimitedImpulse } from './renderBandLimitedImpulse';
import { stereoPanWeightsFromPosition } from './stereoPanning';

/**
 * Adds every coherent arrival — the direct sound and each specular image-source echo — into the channels as
 * a band-colored impulse at its own exact, fractional delay. Convolved with dry audio later
 * (`convolveWithImpulseResponse.ts`), each one reproduces a true delayed copy of the source, which is what a
 * real specular reflection is: not added texture, but the same sound arriving again slightly later, mildly
 * recolored by whatever it bounced off. That coherence is why these paths fuse with the direct sound into a
 * single perceived event that simply sounds like it is in a room, rather than reading as separate noise
 * layered on top.
 *
 * Mutates `channels` in place. When `stereoSimulationEnabled` is on, each arrival is scaled per channel by
 * Steam Audio's constant-power stereo pan law (`stereoPanning.ts`) applied to its own `panPosition`, so an
 * echo coming in from one side of the listener favors that channel; when it's off, every arrival keeps full
 * amplitude on both channels.
 */
export function renderDiscreteArrivals(
  channels: Float32Array<ArrayBuffer>[],
  arrivals: DiscreteArrival[],
  sampleRate: number,
  stereoSimulationEnabled: boolean,
): void {
  const kernel = buildBandImpulseKernel(sampleRate);

  for (const arrival of arrivals) {
    const panWeights = stereoSimulationEnabled ? stereoPanWeightsFromPosition(arrival.panPosition) : { left: 1, right: 1 };
    const orderedPanWeights = [panWeights.left, panWeights.right];

    channels.forEach((channel, channelIndex) => {
      const channelPanWeight = orderedPanWeights[Math.min(channelIndex, orderedPanWeights.length - 1)];
      addBandLimitedImpulse(channel, arrival.timeSeconds, sampleRate, kernel, {
        low: channelPanWeight * Math.sqrt(arrival.energy.low),
        mid: channelPanWeight * Math.sqrt(arrival.energy.mid),
        high: channelPanWeight * Math.sqrt(arrival.energy.high),
      });
    });
  }
}
