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
    that module can depend on this one without a cycle. */
export type RoomMaterialId =
  | 'generic-object'
  | 'generic-absorber'
  | 'concrete'
  | 'painted-brick'
  | 'bare-brick'
  | 'linoleum'
  | 'parquet'
  | 'wood'
  | 'wool'
  | 'plastic'
  | 'smooth-metal'
  | 'uneven-metal'
  | 'glass'
  | 'carpet'
  | 'gypsum-board'
  | 'acoustic-foam'
  | 'grass';

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

export interface RoomScene {
  boxes: RoomBox[];
  source: RoomPoint3D;
  listener: RoomPoint3D;
}
