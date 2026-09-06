/** Absorption coefficients (0–1, fraction of energy lost per bounce) or captured energy, split into three
    bands — enough to give reverb frequency-dependent character (high frequencies decay faster) without the
    complexity of full octave-band analysis. */
export interface FrequencyBandValues {
  low: number;
  mid: number;
  high: number;
}

export type RoomBoxKind = 'wall' | 'absorber';

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
  /** Only meaningful for `kind: 'wall'` — a ray that hits an absorber box is always fully consumed rather
      than partially reflected, since that's the "objects that consume the wave" behavior this box kind exists
      for. The field still exists on absorbers so every box shares one editable shape in the room editor. */
  absorption: FrequencyBandValues;
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
