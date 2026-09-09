import { DEFAULT_ABSORBER_MATERIAL_ID, DEFAULT_OBJECT_MATERIAL_ID, ROOM_MATERIALS } from './roomMaterials';
import type { FrequencyBandValues, RoomBox, RoomBoxKind, RoomMaterialId, RoomPoint3D, RoomScene } from './roomTypes';

const ROOM_FILE_FORMAT_VERSION = 2;

/** Default for a box's `textureIntensity` when a file predates that field entirely, or carries an
    out-of-range value — 1 means "the material's own baseline roughness, unmodified". */
const DEFAULT_TEXTURE_INTENSITY = 1;
const MINIMUM_TEXTURE_INTENSITY = 0;
const MAXIMUM_TEXTURE_INTENSITY = 2;

interface RoomFileContents {
  formatVersion: number;
  scene: RoomScene;
}

/** A box as it comes out of `JSON.parse`, before `migrateRoomBox` normalizes it into a current `RoomBox` —
    `kind` may still be the old `'wall'` literal, and `materialId`/`textureIntensity` may be absent entirely
    (a room file predating materials/roughness) or, for `materialId`, a value from a future or removed
    catalog entry. */
interface RawRoomBox {
  id: string;
  kind: RoomBoxKind | 'wall';
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  absorption: FrequencyBandValues;
  materialId?: unknown;
  textureIntensity?: unknown;
}

interface RawRoomScene {
  boxes: RawRoomBox[];
  source: RoomPoint3D;
  listener: RoomPoint3D;
}

export function serializeRoomScene(scene: RoomScene): string {
  const contents: RoomFileContents = { formatVersion: ROOM_FILE_FORMAT_VERSION, scene };
  return JSON.stringify(contents, null, 2);
}

/** Parses a room file the user picked off disk — validated field-by-field rather than trusted as-is, since
    it's arbitrary user-supplied file content that could be hand-edited, from an older format version, or not
    a room file at all. Every box is then run through `migrateRoomBox` unconditionally (not gated on
    `formatVersion`) so even a hand-edited or partially-stale file self-heals rather than needing an exact
    version match. */
export function parseRoomScene(fileContents: string): RoomScene {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContents);
  } catch {
    throw new Error('This file is not valid JSON.');
  }

  if (!isRecord(parsed) || typeof parsed.formatVersion !== 'number' || !isRoomScene(parsed.scene)) {
    throw new Error('This file is not a recognized room file.');
  }

  return { ...parsed.scene, boxes: parsed.scene.boxes.map(migrateRoomBox) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isFrequencyBandValues(value: unknown): value is FrequencyBandValues {
  return isRecord(value) && isFiniteNumber(value.low) && isFiniteNumber(value.mid) && isFiniteNumber(value.high);
}

function isRoomPoint3D(value: unknown): value is RoomPoint3D {
  return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.z);
}

/** Structural validation only — a box from an old file legitimately has `kind: 'wall'`, no `materialId` at
    all, or a `materialId` this build no longer recognizes; those are normalized by `migrateRoomBox` below
    rather than rejected here. */
function isRawRoomBox(value: unknown): value is RawRoomBox {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    (value.kind === 'object' || value.kind === 'wall' || value.kind === 'absorber') &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.z) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height) &&
    isFiniteNumber(value.depth) &&
    isFrequencyBandValues(value.absorption) &&
    (value.materialId === undefined || typeof value.materialId === 'string') &&
    (value.textureIntensity === undefined || isFiniteNumber(value.textureIntensity))
  );
}

function isRoomScene(value: unknown): value is RawRoomScene {
  return isRecord(value) && Array.isArray(value.boxes) && value.boxes.every(isRawRoomBox) && isRoomPoint3D(value.source) && isRoomPoint3D(value.listener);
}

const KNOWN_MATERIAL_IDS = new Set<string>(ROOM_MATERIALS.map(material => material.id));

function isKnownMaterialId(value: unknown): value is RoomMaterialId {
  return typeof value === 'string' && KNOWN_MATERIAL_IDS.has(value);
}

function clampTextureIntensity(value: unknown): number {
  if (!isFiniteNumber(value)) return DEFAULT_TEXTURE_INTENSITY;
  return Math.min(MAXIMUM_TEXTURE_INTENSITY, Math.max(MINIMUM_TEXTURE_INTENSITY, value));
}

/** Normalizes one already-structurally-valid box into the current shape: maps the old `'wall'` kind literal
    to `'object'`, and fills in/replaces a missing-or-unrecognized `materialId` and a missing-or-out-of-range
    `textureIntensity` with sensible kind-appropriate defaults. Handles every pre-materials-era and
    pre-roughness-era file in one pass, since both are just "this file predates a field this build requires". */
function migrateRoomBox(rawBox: RawRoomBox): RoomBox {
  const kind: RoomBoxKind = rawBox.kind === 'wall' ? 'object' : rawBox.kind;
  const materialId = isKnownMaterialId(rawBox.materialId) ? rawBox.materialId : kind === 'object' ? DEFAULT_OBJECT_MATERIAL_ID : DEFAULT_ABSORBER_MATERIAL_ID;

  return {
    id: rawBox.id,
    kind,
    x: rawBox.x,
    y: rawBox.y,
    z: rawBox.z,
    width: rawBox.width,
    height: rawBox.height,
    depth: rawBox.depth,
    absorption: rawBox.absorption,
    materialId,
    textureIntensity: clampTextureIntensity(rawBox.textureIntensity),
  };
}
