import { clampNumber } from '../utils/clampNumber';

const POSITION_TRACKING_INTERVAL_MILLISECONDS = 40;

/** Plays a single continuous `AudioBuffer` start to finish — unlike `PreviewPlaybackController`, there are no
    silence segments to skip, so play/pause/seek can track one source node directly instead of rebuilding a
    schedule. Exposes the same `onTimeUpdate`/`onPlaybackStateChange` callback shape so `PlaybackControls.tsx`
    can be reused unmodified. */
export class SimpleAudioPlaybackController {
  private readonly audioContext: AudioContext;
  private audioBuffer: AudioBuffer;
  private sourceNode: AudioBufferSourceNode | null = null;
  private positionTrackingIntervalId: ReturnType<typeof setInterval> | null = null;

  private isPlaying = false;
  private playbackStartContextTime = 0;
  private playbackStartOffsetSeconds = 0;
  private lastKnownTimeSeconds = 0;

  onTimeUpdate: (currentTimeSeconds: number) => void = () => {};
  onPlaybackStateChange: (isPlaying: boolean) => void = () => {};

  constructor(audioBuffer: AudioBuffer) {
    this.audioBuffer = audioBuffer;
    this.audioContext = new AudioContext();
  }

  get durationSeconds(): number {
    return this.audioBuffer.duration;
  }

  /** Swaps in a newly rendered buffer (e.g. after a room edit re-runs the simulation) without tearing down the
      `AudioContext` — creating a new real-time `AudioContext` on every edit is what was making resimulating
      feel laggy, since spinning up an actual audio output stream is comparatively expensive and was happening
      far more often than the audio itself actually changed hands. */
  setBuffer(audioBuffer: AudioBuffer): void {
    this.stopSourceNode();
    this.audioBuffer = audioBuffer;
    this.lastKnownTimeSeconds = Math.min(this.lastKnownTimeSeconds, audioBuffer.duration);
  }

  play(fromSeconds?: number): void {
    if (this.audioContext.state === 'suspended') void this.audioContext.resume();
    this.stopSourceNode();

    const startFromSeconds = clampNumber(fromSeconds ?? this.lastKnownTimeSeconds, 0, this.audioBuffer.duration);
    const sourceNode = this.audioContext.createBufferSource();
    sourceNode.buffer = this.audioBuffer;
    sourceNode.connect(this.audioContext.destination);
    sourceNode.onended = () => {
      if (this.sourceNode === sourceNode) this.handlePlaybackEnded();
    };
    sourceNode.start(0, startFromSeconds);

    this.sourceNode = sourceNode;
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
    return Math.min(this.audioBuffer.duration, this.playbackStartOffsetSeconds + (this.audioContext.currentTime - this.playbackStartContextTime));
  }

  private handlePlaybackEnded(): void {
    this.isPlaying = false;
    this.lastKnownTimeSeconds = this.audioBuffer.duration;
    this.sourceNode = null;
    this.onTimeUpdate(this.lastKnownTimeSeconds);
    this.onPlaybackStateChange(false);
    this.stopPositionTracking();
  }

  private stopSourceNode(): void {
    if (!this.sourceNode) return;
    this.sourceNode.onended = null;
    try {
      this.sourceNode.stop();
    } catch {
      // Already stopped/ended - nothing to do.
    }
    this.sourceNode.disconnect();
    this.sourceNode = null;
  }

  private startPositionTracking(): void {
    this.stopPositionTracking();
    this.positionTrackingIntervalId = setInterval(() => this.onTimeUpdate(this.getCurrentTimeSeconds()), POSITION_TRACKING_INTERVAL_MILLISECONDS);
  }

  private stopPositionTracking(): void {
    if (this.positionTrackingIntervalId !== null) {
      clearInterval(this.positionTrackingIntervalId);
      this.positionTrackingIntervalId = null;
    }
  }
}
