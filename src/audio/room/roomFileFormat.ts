import type { FrequencyBandValues, RoomBox, RoomPoint3D, RoomScene } from './roomTypes';

const ROOM_FILE_FORMAT_VERSION = 1;

interface RoomFileContents {
  formatVersion: number;
  scene: RoomScene;
}

export function serializeRoomScene(scene: RoomScene): string {
  const contents: RoomFileContents = { formatVersion: ROOM_FILE_FORMAT_VERSION, scene };
  return JSON.stringify(contents, null, 2);
}

/** Parses a room file the user picked off disk — validated field-by-field rather than trusted as-is, since
    it's arbitrary user-supplied file content that could be hand-edited, from an older format version, or not
    a room file at all. */
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

  return parsed.scene;
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

function isRoomBox(value: unknown): value is RoomBox {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    (value.kind === 'wall' || value.kind === 'absorber') &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.z) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height) &&
    isFiniteNumber(value.depth) &&
    isFrequencyBandValues(value.absorption)
  );
}

function isRoomScene(value: unknown): value is RoomScene {
  return isRecord(value) && Array.isArray(value.boxes) && value.boxes.every(isRoomBox) && isRoomPoint3D(value.source) && isRoomPoint3D(value.listener);
}
