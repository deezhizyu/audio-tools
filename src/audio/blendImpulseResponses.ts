/** Blend weight for `blendImpulseResponses`: 0 keeps entirely the previous impulse response, 1 takes entirely
    the new one. Equal weighting smooths both the room-acoustics simulation's own run-to-run noise (an
    interactive-quality resimulation ray-traces with far fewer rays than a full-quality one — see
    `INTERACTIVE_RAY_TRACING_PARAMS` — so consecutive passes over an otherwise-unchanged room can still sample
    noticeably different reflection patterns) and the transition as the room actually changes underneath a
    live edit. */
export const IMPULSE_RESPONSE_BLEND_WEIGHT = 0.5;

/**
 * Averages a freshly simulated impulse response with the previously played one, sample-for-sample, so live
 * playback's acoustic character evolves smoothly from one simulation to the next instead of snapping straight
 * to whatever the room-acoustics worker just produced. Complements (doesn't replace) crossfading the playback
 * voices themselves (see `SimpleAudioPlaybackController`) — that smooths the *loudness* transition between two
 * takes on the room; this smooths what those takes actually sound like, which matters because a low ray count
 * means real run-to-run variance even when nothing about the room has changed.
 *
 * Falls back to `next` unchanged when there's no previous impulse response to blend with, or its shape
 * doesn't match `next`'s (a different channel count or sample count — e.g. right after a new dry audio file,
 * at a different sample rate, is loaded) — blending buffers of mismatched shape isn't meaningful.
 */
export function blendImpulseResponses(
  previous: Float32Array<ArrayBuffer>[],
  next: Float32Array<ArrayBuffer>[],
  blendWeight: number = IMPULSE_RESPONSE_BLEND_WEIGHT,
): Float32Array<ArrayBuffer>[] {
  const shapesMatch = previous.length === next.length && previous.every((channel, index) => channel.length === next[index].length);
  if (!shapesMatch) return next;

  const previousWeight = 1 - blendWeight;
  return next.map((nextChannel, channelIndex) => {
    const previousChannel = previous[channelIndex];
    const blended = new Float32Array(nextChannel.length);
    for (let sampleIndex = 0; sampleIndex < nextChannel.length; sampleIndex++) {
      blended[sampleIndex] = previousChannel[sampleIndex] * previousWeight + nextChannel[sampleIndex] * blendWeight;
    }
    return blended;
  });
}
