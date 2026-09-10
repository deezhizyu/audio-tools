import { buildAudioBufferFromChannels } from './buildAudioBufferFromChannels';

export interface ConvolutionResult {
  channelData: Float32Array<ArrayBuffer>[];
  sampleRate: number;
}

/**
 * Convolves dry audio with an impulse response using a native `ConvolverNode` rather than a hand-written FFT —
 * browsers implement this as hardware/SIMD-optimized partitioned convolution, so this is both the simplest and
 * the fastest way to get the wet signal. The impulse response must already be at `drySampleRate` (the room-
 * acoustics worker synthesizes it at whatever rate it's asked for) since `OfflineAudioContext`'s sample rate is
 * fixed at construction and a `ConvolverNode` buffer can't be resampled after the fact.
 */
export async function convolveWithImpulseResponse(
  dryChannelData: Float32Array<ArrayBuffer>[],
  drySampleRate: number,
  impulseResponseChannelData: Float32Array<ArrayBuffer>[],
): Promise<ConvolutionResult> {
  const dryBuffer = buildAudioBufferFromChannels(dryChannelData, drySampleRate);
  const impulseResponseBuffer = buildAudioBufferFromChannels(impulseResponseChannelData, drySampleRate);

  const renderedLengthFrames = dryBuffer.length + impulseResponseBuffer.length;
  // At least as many channels as the (now stereo, decorrelated) impulse response — otherwise a mono dry file
  // would down-mix the ConvolverNode's true-stereo output back to mono right at the destination, silently
  // discarding the reflections' left/right decorrelation for exactly the files most likely to need it.
  const numberOfChannels = Math.max(dryBuffer.numberOfChannels, impulseResponseBuffer.numberOfChannels);
  const offlineContext = new OfflineAudioContext(numberOfChannels, renderedLengthFrames, drySampleRate);

  const sourceNode = offlineContext.createBufferSource();
  sourceNode.buffer = dryBuffer;

  const convolverNode = offlineContext.createConvolver();
  convolverNode.normalize = true;
  convolverNode.buffer = impulseResponseBuffer;

  sourceNode.connect(convolverNode);
  convolverNode.connect(offlineContext.destination);
  sourceNode.start();

  const renderedBuffer = await offlineContext.startRendering();
  const channelData = Array.from({ length: renderedBuffer.numberOfChannels }, (_, channelIndex) => renderedBuffer.getChannelData(channelIndex).slice());

  return { channelData, sampleRate: renderedBuffer.sampleRate };
}
