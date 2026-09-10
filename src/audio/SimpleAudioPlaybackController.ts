import { clampNumber } from '../utils/clampNumber';

const POSITION_TRACKING_INTERVAL_MILLISECONDS = 40;

/**
 * Plays dry audio through a live `ConvolverNode` fed the room's impulse response, instead of pre-rendering
 * the whole convolved file (via `convolveWithImpulseResponse.ts`'s `OfflineAudioContext`) before playback can
 * start. The browser's own real-time convolution engine produces output continuously as playback proceeds, so
 * listening can begin the instant a freshly simulated impulse response is ready, rather than waiting for the
 * entire dry file to be rendered first. Unlike `PreviewPlaybackController`, there are no silence segments to
 * skip, so play/pause/seek can track one source node directly instead of rebuilding a schedule. Exposes the
 * same `onTimeUpdate`/`onPlaybackStateChange` callback shape so `PlaybackControls.tsx` can be reused
 * unmodified. Only for interactive preview — `convolveWithImpulseResponse.ts`'s full offline render is still
 * what produces the exact samples exported to a file.
 */
export class SimpleAudioPlaybackController {
  private readonly audioContext: AudioContext;
  private dryBuffer: AudioBuffer;
  private impulseResponseBuffer: AudioBuffer;
  private sourceNode: AudioBufferSourceNode | null = null;
  private convolverNode: ConvolverNode | null = null;
  private positionTrackingIntervalId: ReturnType<typeof setInterval> | null = null;

  private isPlaying = false;
  private playbackStartContextTime = 0;
  private playbackStartOffsetSeconds = 0;
  private lastKnownTimeSeconds = 0;

  onTimeUpdate: (currentTimeSeconds: number) => void = () => {};
  onPlaybackStateChange: (isPlaying: boolean) => void = () => {};

  constructor(dryBuffer: AudioBuffer, impulseResponseBuffer: AudioBuffer) {
    this.dryBuffer = dryBuffer;
    this.impulseResponseBuffer = impulseResponseBuffer;
    this.audioContext = new AudioContext();
  }

  /** Dry duration plus the impulse response's own length — the reverb tail keeps ringing through the
      `ConvolverNode` after the dry source itself ends, and a listener should be able to hear all of it. */
  get durationSeconds(): number {
    return this.dryBuffer.duration + this.impulseResponseBuffer.duration;
  }

  /** Swaps in a freshly simulated room's dry/impulse-response pair (e.g. after an edit re-runs the ray
      tracer) without tearing down the `AudioContext` — creating a new real-time `AudioContext` on every room
      edit is what used to make resimulating feel laggy, since spinning up an actual audio output stream is
      comparatively expensive and was happening on every debounced edit rather than only when it was actually
      needed. Stops whatever's currently playing; the caller decides whether/how to resume, mirroring `play`'s
      own "resume from last position" default. */
  setBuffers(dryBuffer: AudioBuffer, impulseResponseBuffer: AudioBuffer): void {
    this.stopSourceNode();
    this.dryBuffer = dryBuffer;
    this.impulseResponseBuffer = impulseResponseBuffer;
    this.lastKnownTimeSeconds = Math.min(this.lastKnownTimeSeconds, this.durationSeconds);
  }

  play(fromSeconds?: number): void {
    if (this.audioContext.state === 'suspended') void this.audioContext.resume();
    this.stopSourceNode();

    const startFromSeconds = clampNumber(fromSeconds ?? this.lastKnownTimeSeconds, 0, this.durationSeconds);
    // A fresh ConvolverNode starts with no internal history, so the only way it can reproduce the reverb
    // tail is by actually playing the dry audio that feeds it — there's no way to "resume" partway into the
    // tail alone. Starting no later than the dry buffer's own end means resuming/restarting from inside the
    // tail replays the tail from its beginning rather than picking up mid-decay: a narrow (at most one
    // impulse-response-length) edge case rather than a silent gap.
    const dryStartOffsetSeconds = Math.min(startFromSeconds, this.dryBuffer.duration);

    const sourceNode = this.audioContext.createBufferSource();
    sourceNode.buffer = this.dryBuffer;

    const convolverNode = this.audioContext.createConvolver();
    // Matches `convolveWithImpulseResponse.ts`'s offline render, so live preview loudness doesn't drift from
    // what actually gets exported.
    convolverNode.normalize = true;
    convolverNode.buffer = this.impulseResponseBuffer;

    sourceNode.connect(convolverNode);
    convolverNode.connect(this.audioContext.destination);
    sourceNode.start(0, dryStartOffsetSeconds);

    this.sourceNode = sourceNode;
    this.convolverNode = convolverNode;
    this.playbackStartContextTime = this.audioContext.currentTime;
    this.playbackStartOffsetSeconds = startFromSeconds;
    this.lastKnownTimeSeconds = startFromSeconds;
    this.isPlaying = true;
    this.onPlaybackStateChange(true);
    this.startPositionTracking();
  }

  pause(): void {
    if (!this.isPlaying) return;
    this.lastKnownTimeSeconds = this.getCurrentTimeSeconds();
    this.stopSourceNode();
    this.isPlaying = false;
    this.onPlaybackStateChange(false);
    this.onTimeUpdate(this.lastKnownTimeSeconds);
    this.stopPositionTracking();
  }

  restart(): void {
    this.play(0);
  }

  dispose(): void {
    this.stopSourceNode();
    this.stopPositionTracking();
    void this.audioContext.close();
  }

  private getCurrentTimeSeconds(): number {
    if (!this.isPlaying) return this.lastKnownTimeSeconds;
    return Math.min(this.durationSeconds, this.playbackStartOffsetSeconds + (this.audioContext.currentTime - this.playbackStartContextTime));
  }

  /** The dry source node ends on its own once its buffer is exhausted, but the convolver keeps ringing out
      the reverb tail after that — so "truly finished" is detected by polling elapsed time against
      `durationSeconds` in `startPositionTracking`'s interval, not by the source node's own `onended`. */
  private handlePlaybackEnded(): void {
    this.isPlaying = false;
    this.lastKnownTimeSeconds = this.durationSeconds;
    this.stopSourceNode();
    this.onTimeUpdate(this.lastKnownTimeSeconds);
    this.onPlaybackStateChange(false);
    this.stopPositionTracking();
  }

  private stopSourceNode(): void {
    if (this.sourceNode) {
      try {
        this.sourceNode.stop();
      } catch {
        // Already stopped/ended - nothing to do.
      }
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.convolverNode) {
      this.convolverNode.disconnect();
      this.convolverNode = null;
    }
  }

  private startPositionTracking(): void {
    this.stopPositionTracking();
    this.positionTrackingIntervalId = setInterval(() => {
      const currentTimeSeconds = this.getCurrentTimeSeconds();
      this.onTimeUpdate(currentTimeSeconds);
      if (this.isPlaying && currentTimeSeconds >= this.durationSeconds) this.handlePlaybackEnded();
    }, POSITION_TRACKING_INTERVAL_MILLISECONDS);
  }

  private stopPositionTracking(): void {
    if (this.positionTrackingIntervalId !== null) {
      clearInterval(this.positionTrackingIntervalId);
      this.positionTrackingIntervalId = null;
    }
  }
}
