/** Absorption coefficients (0–1, fraction of energy lost per bounce) or captured energy, split into three
    bands — enough to give reverb frequency-dependent character (high frequencies decay faster) without the
    complexity of full octave-band analysis. */
export interface FrequencyBandValues {
  low: number;
  mid: number;
  high: number;
}

export type RoomBoxKind = 'object' | 'absorber';

/** One entry per `RoomMaterial` in `roomMaterials.ts`. Declared here (rather than in `roomMaterials.ts`) so
    that module can depend on this one without a cycle; that module's catalog is keyed by this union, so a
    name added here without a matching entry there is a compile error. */
export type RoomMaterialId =
  // Hard surfaces
  | 'generic-object'
  | 'concrete'
  | 'concrete-block'
  | 'painted-brick'
  | 'bare-brick'
  | 'linoleum'
  | 'parquet'
  | 'wood'
  | 'wood-paneling'
  | 'plastic'
  | 'smooth-metal'
  | 'uneven-metal'
  | 'glass'
  | 'plate-glass'
  | 'gypsum-board'
  // Soft, absorptive surfaces and furnishings
  | 'generic-absorber'
  | 'wool'
  | 'carpet'
  | 'carpet-on-concrete'
  | 'acoustic-foam'
  | 'ceiling-tile'
  | 'curtain'
  | 'upholstered-seat'
  | 'occupied-seating'
  | 'mattress'
  | 'bookshelf'
  // Ground and outdoor surfaces
  | 'grass'
  | 'soil'
  | 'gravel'
  | 'asphalt'
  | 'water'
  | 'snow'
  | 'foliage';

export interface RoomBox {
  id: string;
  kind: RoomBoxKind;
  /** Position of the box's minimum corner and its size, in meters, along each axis. */
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  /** Only meaningful for `kind: 'object'` — a ray that hits an absorber box is always fully consumed rather
      than partially reflected, since that's the "objects that consume the wave" behavior this box kind exists
      for. The field still exists on absorbers so every box shares one editable shape in the room editor. */
  absorption: FrequencyBandValues;
  /** Which `RoomMaterial` (see `roomMaterials.ts`) this box is made of — drives both its default absorption
      (picking a material prefills `absorption`, which stays independently editable afterward) and its
      appearance/roughness in the editor (see `textureIntensity`). */
  materialId: RoomMaterialId;
  /** 0–2 multiplier over the chosen material's baseline roughness (`RoomMaterial.scatterAmount`), default 1.
      A purely acoustic property: it scales how diffusely this box's surface scatters reflected sound in the
      ray tracer (see `getEffectiveScatterAmount` in `roomMaterials.ts`) and has no visual effect. Persists
      across material changes rather than resetting, so a user's dialed-in roughness for a specific box
      survives picking a different material. Only meaningful for `kind: 'object'` (an absorber's ray
      terminates on hit, before any scattering direction would be computed). */
  textureIntensity: number;
}

export interface RoomPoint3D {
  x: number;
  y: number;
  z: number;
}

/**
 * How orientation is expressed throughout the simulator and the editor: a single yaw angle in degrees, in
 * the horizontal plane. 0 faces +x, and increasing yaw turns toward +z — which in the editor's top view
 * (`TOP_VIEW_AXES`, x across and z down) reads as starting out facing right and turning clockwise.
 *
 * Yaw only, no pitch. Turning your head left or right transforms what you hear completely; tilting it up or
 * down barely changes anything a two-eared model can represent, and a source's useful directivity is almost
 * always about which way it is aimed across the room.
 */
export type YawDegrees = number;

/**
 * How a source radiates, as the dipole model Steam Audio uses: `gain(θ) = |(1 - weight) + weight·cos θ|^sharpness`
 * about the direction the source faces. `weight` 0 is omnidirectional, 0.5 is a cardioid, 1 a figure-of-eight;
 * `sharpness` narrows whatever pattern `weight` chose.
 */
export interface SourceDirectivity {
  /** When false the source radiates equally in every direction and the two numbers below are ignored — but
      kept, so toggling directionality back on restores the pattern the user had dialed in. */
  enabled: boolean;
  weight: number;
  sharpness: number;
}

export interface RoomSource extends RoomPoint3D {
  yawDegrees: YawDegrees;
  directivity: SourceDirectivity;
}

/** Whether the listener hears with two ears or one. `binaural` models a head: each ear gets its own arrival
    time and its own frequency-dependent shadowing, which is what lets left, right, front and behind sound
    different from each other. `mono` collapses that to a single omnidirectional capsule, giving two identical
    channels. */
export type ListenerMode = 'binaural' | 'mono';

export interface RoomListener extends RoomPoint3D {
  yawDegrees: YawDegrees;
  mode: ListenerMode;
}

export interface RoomScene {
  boxes: RoomBox[];
  source: RoomSource;
  listener: RoomListener;
}
