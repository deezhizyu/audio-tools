import { clampNumber } from '../utils/clampNumber';

const POSITION_TRACKING_INTERVAL_MILLISECONDS = 40;

/** How long a voice takes to fade in when it starts and fade out when it's replaced/stopped. Every buffer
    swap (a room edit re-running the ray tracer) tears down the old audio graph and builds a new one — without
    a fade that's an instant, audible click, and a fast drag can trigger it many times a second. */
const FADE_SECONDS = 0.1;

/** One playable instance of dry-audio-through-a-convolver, plus the gain node that fades it in/out. Kept as a
    unit so an old voice can keep fading out and ringing down on its own schedule while a new one fades in,
    instead of the two having to share state. */
interface PlaybackVoice {
  sourceNode: AudioBufferSourceNode;
  convolverNode: ConvolverNode;
  gainNode: GainNode;
}

/**
 * Plays dry audio through a live `ConvolverNode` fed the room's impulse response, instead of pre-rendering
 * the whole convolved file (via `convolveWithImpulseResponse.ts`'s `OfflineAudioContext`) before playback can
 * start. The browser's own real-time convolution engine produces output continuously as playback proceeds, so
 * listening can begin the instant a freshly simulated impulse response is ready, rather than waiting for the
 * entire dry file to be rendered first. Unlike `PreviewPlaybackController`, there are no silence segments to
 * skip, so play/pause/seek can track one voice directly instead of rebuilding a schedule. Exposes the same
 * `onTimeUpdate`/`onPlaybackStateChange` callback shape so `PlaybackControls.tsx` can be reused unmodified.
 * Only for interactive preview — `convolveWithImpulseResponse.ts`'s full offline render is still what produces
 * the exact samples exported to a file.
 */
export class SimpleAudioPlaybackController {
  private readonly audioContext: AudioContext;
  private dryBuffer: AudioBuffer;
  private impulseResponseBuffer: AudioBuffer;
  private currentVoice: PlaybackVoice | null = null;
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
      needed. Fades out whatever's currently playing (see `FADE_SECONDS`) instead of cutting it off; the
      caller decides whether/how to resume, mirroring `play`'s own "resume from last position" default — and
      since `play` itself fades its new voice in, calling it right after this produces a full crossfade. */
  setBuffers(dryBuffer: AudioBuffer, impulseResponseBuffer: AudioBuffer): void {
    this.fadeOutCurrentVoice();
    this.dryBuffer = dryBuffer;
    this.impulseResponseBuffer = impulseResponseBuffer;
    this.lastKnownTimeSeconds = Math.min(this.lastKnownTimeSeconds, this.durationSeconds);
  }

  play(fromSeconds?: number): void {
    if (this.audioContext.state === 'suspended') void this.audioContext.resume();
    this.fadeOutCurrentVoice();

    const startFromSeconds = clampNumber(fromSeconds ?? this.lastKnownTimeSeconds, 0, this.durationSeconds);
    // A fresh ConvolverNode starts with no internal history, so the only way it can reproduce the reverb
    // tail is by actually playing the dry audio that feeds it — there's no way to "resume" partway into the
    // tail alone. Starting no later than the dry buffer's own end means resuming/restarting from inside the
    // tail replays the tail from its beginning rather than picking up mid-decay: a narrow (at most one
    // impulse-response-length) edge case rather than a silent gap.
    const dryStartOffsetSeconds = Math.min(startFromSeconds, this.dryBuffer.duration);

    this.currentVoice = this.startVoice(dryStartOffsetSeconds);
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
    this.fadeOutCurrentVoice();
    this.isPlaying = false;
    this.onPlaybackStateChange(false);
    this.onTimeUpdate(this.lastKnownTimeSeconds);
    this.stopPositionTracking();
  }

  restart(): void {
    this.play(0);
  }

  dispose(): void {
    this.fadeOutCurrentVoice();
    this.stopPositionTracking();
    void this.audioContext.close();
  }

  /** Builds and starts one voice — a fresh source/convolver pair behind a gain node ramped 0→1 over
      `FADE_SECONDS`, so a brand-new voice (first play, or the fade-in half of a crossfade) never starts with
      an audible step. */
  private startVoice(dryStartOffsetSeconds: number): PlaybackVoice {
    const sourceNode = this.audioContext.createBufferSource();
    sourceNode.buffer = this.dryBuffer;

    const convolverNode = this.audioContext.createConvolver();
    // Matches `convolveWithImpulseResponse.ts`'s offline render, so live preview loudness doesn't drift from
    // what actually gets exported.
    convolverNode.normalize = true;
    convolverNode.buffer = this.impulseResponseBuffer;

    const gainNode = this.audioContext.createGain();
    const now = this.audioContext.currentTime;
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(1, now + FADE_SECONDS);

    sourceNode.connect(convolverNode);
    convolverNode.connect(gainNode);
    gainNode.connect(this.audioContext.destination);
    sourceNode.start(0, dryStartOffsetSeconds);

    return { sourceNode, convolverNode, gainNode };
  }

  /** Ramps the current voice's gain down to 0 over `FADE_SECONDS` from wherever it currently is (so
      interrupting a voice that's still mid fade-in — a burst of edits arriving faster than one fade completes
      — ramps down smoothly from its partial volume rather than jumping), then stops and disconnects it once
      the ramp finishes. Detaches it from `currentVoice` immediately so a new voice (started right after, e.g.
      by `play`) is free to become the current one while this one rings down independently. */
  private fadeOutCurrentVoice(): void {
    const voice = this.currentVoice;
    if (!voice) return;
    this.currentVoice = null;

    const now = this.audioContext.currentTime;
    voice.gainNode.gain.cancelAndHoldAtTime(now);
    voice.gainNode.gain.linearRampToValueAtTime(0, now + FADE_SECONDS);

    let disconnected = false;
    const disconnectVoice = () => {
      if (disconnected) return;
      disconnected = true;
      voice.sourceNode.disconnect();
      voice.convolverNode.disconnect();
      voice.gainNode.disconnect();
    };
    voice.sourceNode.onended = disconnectVoice;
    try {
      voice.sourceNode.stop(now + FADE_SECONDS);
    } catch {
      // Already stopped/ended — nothing to do, but onended won't fire again either, so fall through to the
      // timeout fallback below rather than disconnecting immediately (the fade should still play out).
    }
    // Fallback for a source node that had already ended before this call: onended has already fired once and
    // won't fire again, so nothing above would otherwise ever disconnect this voice.
    setTimeout(disconnectVoice, FADE_SECONDS * 1000 + 50);
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
    this.fadeOutCurrentVoice();
    this.onTimeUpdate(this.lastKnownTimeSeconds);
    this.onPlaybackStateChange(false);
    this.stopPositionTracking();
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
