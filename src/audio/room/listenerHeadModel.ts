import { SPEED_OF_SOUND_METERS_PER_SECOND } from './roomAcousticsDefaults';
import type { FrequencyBandValues, RoomListener } from './roomTypes';
import { orientationForward } from './sourceDirectivity';
import type { Vector3 } from './vector3';

/** Radius of the head the model is built around — the standard anthropometric value, and the number that
    sets both how far apart the ears are and how strongly the head shadows sound passing it. */
export const HEAD_RADIUS_METERS = 0.0875;

export type Ear = 'left' | 'right';
export const EARS: readonly Ear[] = ['left', 'right'];

/** A direction expressed in the listener's own frame rather than the room's: how far ahead of them it lies,
    how far to their right, and how far above. This is the whole point of giving the listener an orientation —
    what a sound does to two ears depends on where it is relative to the head, and rotating the head changes
    that without anything in the room moving. */
export interface ListenerLocalDirection {
  forward: number;
  right: number;
  up: number;
}

/**
 * How much energy each band loses reaching the ear facing away from a sound. A head is an obstacle roughly
 * the size of the wavelengths it is shadowing: bass diffracts around it almost untouched, treble is blocked
 * substantially. That frequency dependence is what makes a real interaural level difference read as a
 * direction rather than as a balance control — a sound panned with level alone stays obviously inside the
 * head. These are energy ratios at full shadow, so the far ear at 90° loses about 0.7dB low, 4dB mid, and
 * 11.5dB high.
 */
const HEAD_SHADOW_STRENGTH: FrequencyBandValues = { low: 0.15, mid: 0.6, high: 0.93 };

/**
 * Extra high-frequency loss for sounds arriving from behind. A sphere is front/back symmetric, so a head
 * model alone leaves a source in front and the same source behind completely indistinguishable — the
 * so-called cone of confusion. Real ears resolve it mostly with the pinna, which shadows sound from behind
 * above roughly 5kHz. This is a deliberately simple stand-in for that: it reproduces the dominant cue (things
 * behind you sound duller) without pretending to a full head-related transfer function.
 */
const REAR_SHADOW_STRENGTH: FrequencyBandValues = { low: 0, mid: 0.2, high: 0.6 };

/**
 * How alike the two ears' signals are, band by band, in a fully diffuse field — the theoretical coherence
 * `sinc(2πf·d/c)` for ears `d` apart, evaluated at each band's centre.
 *
 * Reverberation is not decorrelated at every frequency, and treating it as if it were is audible. Below a few
 * hundred hertz the wavelength dwarfs the head, both ears receive nearly the same pressure, and bass in a real
 * room sounds solid and centred. Rendering the two channels from entirely independent noise — which is what
 * this pipeline did — makes that bass arrive uncorrelated instead, which reads as phasey and diffuse, and
 * hollows out the bottom of every room.
 */
export const DIFFUSE_FIELD_INTERAURAL_COHERENCE: FrequencyBandValues = { low: 0.75, mid: 0.12, high: 0.02 };

/** A mono listener is one omnidirectional capsule, so both output channels are the same signal: perfectly
    coherent, with no shadowing and no arrival-time difference anywhere. */
const MONO_COHERENCE: FrequencyBandValues = { low: 1, mid: 1, high: 1 };
const NO_ATTENUATION: FrequencyBandValues = { low: 1, mid: 1, high: 1 };

export interface EarResponse {
  /** Arrival time relative to the listener's centre — negative for the nearer ear, positive for the further
      one. Added to the path delay the arrival already carries. */
  delaySeconds: number;
  /** Per-band energy multipliers for this ear. */
  gains: FrequencyBandValues;
}

/** The listener's facing and right-hand directions, which only depend on their yaw. Resolved once and reused
    where the alternative is two trigonometric calls per arrival, of which a simulation has millions. */
export interface ListenerHorizontalFrame {
  forwardX: number;
  forwardZ: number;
  rightX: number;
  rightZ: number;
}

export function listenerHorizontalFrame(listener: RoomListener): ListenerHorizontalFrame {
  const forward = orientationForward(listener.yawDegrees);
  // Completing a right-handed frame with +y up: at yaw 0 the listener faces +x and their right ear points
  // along +z, which is downward in the editor's top view.
  return { forwardX: forward.x, forwardZ: forward.z, rightX: -forward.z, rightZ: forward.x };
}

/** Re-expresses a world-space direction in the listener's frame. `directionFromListener` points from the
    listener out toward where the sound is coming from. */
export function toListenerLocalDirection(directionFromListener: Vector3, listener: RoomListener): ListenerLocalDirection {
  const frame = listenerHorizontalFrame(listener);
  return {
    forward: directionFromListener.x * frame.forwardX + directionFromListener.z * frame.forwardZ,
    right: directionFromListener.x * frame.rightX + directionFromListener.z * frame.rightZ,
    up: directionFromListener.y,
  };
}

function earAxisSign(ear: Ear): number {
  return ear === 'right' ? 1 : -1;
}

/**
 * Woodworth's spherical-head formula for how much later a sound reaches one ear than the other:
 * `(radius/speed)·(φ + sin φ)`, where φ is the angle away from straight ahead measured toward the ear. About
 * 0.66ms at the extreme, split evenly either side of the listener's centre.
 *
 * Interaural time difference is the dominant direction cue below about 1.5kHz — stronger than any level
 * difference — and it is what a pure panning law cannot produce at all.
 */
function interauralDelaySeconds(local: ListenerLocalDirection, ear: Ear): number {
  const lateralAngleRadians = Math.asin(Math.min(1, Math.max(-1, local.right)));
  const farEarExtraPath = (HEAD_RADIUS_METERS / SPEED_OF_SOUND_METERS_PER_SECOND) * (lateralAngleRadians + Math.sin(lateralAngleRadians));
  // A source to the right (positive `right`) reaches the right ear earlier and the left ear later.
  return (-earAxisSign(ear) * farEarExtraPath) / 2;
}

function applyShadow(strength: FrequencyBandValues, shadowedAmount: number): FrequencyBandValues {
  return {
    low: 1 - strength.low * shadowedAmount,
    mid: 1 - strength.mid * shadowedAmount,
    high: 1 - strength.high * shadowedAmount,
  };
}

/** How much this ear is in the head's shadow for a sound at `lateralPosition` (-1 fully left, +1 fully
    right): none when the sound is on this ear's side, full when it is on the opposite one. */
function shadowedAmount(lateralPosition: number, ear: Ear): number {
  return (1 - earAxisSign(ear) * lateralPosition) / 2;
}

function multiplyBands(a: FrequencyBandValues, b: FrequencyBandValues): FrequencyBandValues {
  return { low: a.low * b.low, mid: a.mid * b.mid, high: a.high * b.high };
}

/**
 * What one ear does to a coherent arrival coming from `local`: when it hears it, and how loud each band is by
 * the time it gets there. Together across the two ears this is the whole reason a rotated listener hears a
 * different room — and the reason a source in front is distinguishable from the same source behind, which no
 * amount of left/right panning can achieve.
 */
export function computeEarResponse(local: ListenerLocalDirection, ear: Ear, listener: RoomListener): EarResponse {
  if (listener.mode === 'mono') return { delaySeconds: 0, gains: NO_ATTENUATION };

  const headShadow = applyShadow(HEAD_SHADOW_STRENGTH, shadowedAmount(local.right, ear));
  const rearShadow = applyShadow(REAR_SHADOW_STRENGTH, Math.max(0, -local.forward));

  return { delaySeconds: interauralDelaySeconds(local, ear), gains: multiplyBands(headShadow, rearShadow) };
}

/**
 * The same head shadowing, for the diffuse tail rather than a single arrival. A bin of the reverb histogram
 * summarizes thousands of paths arriving from all over, so it has an average side to it but no meaningful
 * arrival time and no front or back — only the level difference between the ears survives averaging.
 */
export function computeDiffuseEarGains(lateralPosition: number, ear: Ear, listener: RoomListener): FrequencyBandValues {
  if (listener.mode === 'mono') return NO_ATTENUATION;
  return applyShadow(HEAD_SHADOW_STRENGTH, shadowedAmount(lateralPosition, ear));
}

export function interauralCoherence(listener: RoomListener): FrequencyBandValues {
  return listener.mode === 'mono' ? MONO_COHERENCE : DIFFUSE_FIELD_INTERAURAL_COHERENCE;
}

/** Where a direction sits on the listener's left/right axis: -1 fully left, +1 fully right, 0 straight ahead
    or straight behind. Replaces the old world-space-x panning, which ignored the listener entirely — so
    turning the listener around changed nothing about what they heard. */
export function lateralPositionInFrame(frame: ListenerHorizontalFrame, directionX: number, directionZ: number): number {
  const forward = directionX * frame.forwardX + directionZ * frame.forwardZ;
  const right = directionX * frame.rightX + directionZ * frame.rightZ;
  const horizontalLength = Math.hypot(forward, right);
  return horizontalLength < 1e-12 ? 0 : right / horizontalLength;
}

export function lateralPositionInListenerFrame(directionFromListener: Vector3, listener: RoomListener): number {
  return lateralPositionInFrame(listenerHorizontalFrame(listener), directionFromListener.x, directionFromListener.z);
}
