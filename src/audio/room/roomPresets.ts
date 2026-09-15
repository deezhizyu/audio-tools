import { getRoomMaterial } from './roomMaterials';
import type { RoomBox, RoomBoxKind, RoomMaterialId, RoomScene } from './roomTypes';
import { OMNIDIRECTIONAL_DIRECTIVITY } from './sourceDirectivity';

export type RoomPresetId =
  | 'furnished-small-room'
  | 'furnished-large-room'
  | 'empty-small-room'
  | 'empty-large-room'
  | 'outdoor-street'
  | 'outdoor-grass-field';

export interface RoomPreset {
  id: RoomPresetId;
  label: string;
  /** One line on what the space is, shown beside the picker — enough to know what you are about to hear. */
  description: string;
  buildScene: () => RoomScene;
}

/** Thick enough to read as a wall in the editor's views without eating into the room it encloses. Walls are
    solid boxes rather than infinitely thin planes because the tracer works in boxes, and a real wall's
    thickness is what stops a ray slipping through a corner join. */
const WALL_THICKNESS_METERS = 0.2;

interface BoxBounds {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
}

/** Builds a box already carrying its material's own absorption, the same way picking a material in the editor
    prefills it — so a preset is a starting point the user can then edit band by band, not a special case. */
function buildPresetBox(id: string, materialId: RoomMaterialId, bounds: BoxBounds, kind: RoomBoxKind = 'object'): RoomBox {
  return { id, kind, materialId, textureIntensity: 1, absorption: getRoomMaterial(materialId).absorption, ...bounds };
}

interface ShoeboxMaterials {
  floor: RoomMaterialId;
  ceiling: RoomMaterialId;
  walls: RoomMaterialId;
}

/**
 * Six slabs enclosing a room whose interior runs from the origin to (width, height, depth).
 *
 * The floor and ceiling are extended past the walls on every side so the six pieces overlap at every join —
 * butting them edge to edge leaves hairline gaps at the corners that rays escape through, quietly draining a
 * sealed room of its reverberation.
 */
function buildShoeboxRoom(width: number, height: number, depth: number, materials: ShoeboxMaterials): RoomBox[] {
  const outerWidth = width + 2 * WALL_THICKNESS_METERS;
  const outerDepth = depth + 2 * WALL_THICKNESS_METERS;

  return [
    buildPresetBox('floor', materials.floor, {
      x: -WALL_THICKNESS_METERS,
      y: -WALL_THICKNESS_METERS,
      z: -WALL_THICKNESS_METERS,
      width: outerWidth,
      height: WALL_THICKNESS_METERS,
      depth: outerDepth,
    }),
    buildPresetBox('ceiling', materials.ceiling, {
      x: -WALL_THICKNESS_METERS,
      y: height,
      z: -WALL_THICKNESS_METERS,
      width: outerWidth,
      height: WALL_THICKNESS_METERS,
      depth: outerDepth,
    }),
    buildPresetBox('wall-west', materials.walls, {
      x: -WALL_THICKNESS_METERS,
      y: 0,
      z: -WALL_THICKNESS_METERS,
      width: WALL_THICKNESS_METERS,
      height,
      depth: outerDepth,
    }),
    buildPresetBox('wall-east', materials.walls, { x: width, y: 0, z: -WALL_THICKNESS_METERS, width: WALL_THICKNESS_METERS, height, depth: outerDepth }),
    buildPresetBox('wall-north', materials.walls, { x: 0, y: 0, z: -WALL_THICKNESS_METERS, width, height, depth: WALL_THICKNESS_METERS }),
    buildPresetBox('wall-south', materials.walls, { x: 0, y: 0, z: depth, width, height, depth: WALL_THICKNESS_METERS }),
  ];
}

/** A flat expanse of ground, big enough that a listener standing on it never reaches its edge — an outdoor
    scene is defined by everything that isn't there, so the one surface that is has to behave like it goes on. */
function buildGroundPlane(materialId: RoomMaterialId, extentMeters: number): RoomBox {
  return buildPresetBox('ground', materialId, {
    x: -extentMeters / 2,
    y: -WALL_THICKNESS_METERS,
    z: -extentMeters / 2,
    width: extentMeters,
    height: WALL_THICKNESS_METERS,
    depth: extentMeters,
  });
}

/** Ear height for someone standing, and the height most sources people care about sit at. */
const STANDING_EAR_HEIGHT_METERS = 1.6;

/** Source and listener a conversational distance apart, facing each other along the x axis. */
function facingEachOther(centreX: number, centreZ: number, separationMeters: number, heightMeters = STANDING_EAR_HEIGHT_METERS) {
  return {
    source: {
      x: centreX - separationMeters / 2,
      y: heightMeters,
      z: centreZ,
      yawDegrees: 0,
      directivity: OMNIDIRECTIONAL_DIRECTIVITY,
    },
    listener: { x: centreX + separationMeters / 2, y: heightMeters, z: centreZ, yawDegrees: 180, mode: 'binaural' as const },
  };
}

const SMALL_ROOM_WIDTH = 4.5;
const SMALL_ROOM_HEIGHT = 2.5;
const SMALL_ROOM_DEPTH = 3.5;

const LARGE_ROOM_WIDTH = 12;
const LARGE_ROOM_HEIGHT = 3.5;
const LARGE_ROOM_DEPTH = 8;

function buildFurnishedSmallRoom(): RoomScene {
  return {
    boxes: [
      ...buildShoeboxRoom(SMALL_ROOM_WIDTH, SMALL_ROOM_HEIGHT, SMALL_ROOM_DEPTH, {
        floor: 'carpet-on-concrete',
        ceiling: 'gypsum-board',
        walls: 'gypsum-board',
      }),
      buildPresetBox('sofa', 'upholstered-seat', { x: 0.1, y: 0, z: 0.6, width: 0.85, height: 0.8, depth: 2 }),
      buildPresetBox('bookshelf', 'bookshelf', { x: 1.4, y: 0, z: 0.05, width: 1.2, height: 2, depth: 0.35 }),
      buildPresetBox('curtain', 'curtain', { x: SMALL_ROOM_WIDTH - 0.12, y: 0.2, z: 0.8, width: 0.12, height: 2.2, depth: 2 }),
      buildPresetBox('table', 'wood', { x: 2.2, y: 0.4, z: 1.6, width: 1.4, height: 0.05, depth: 0.8 }),
      buildPresetBox('rug', 'carpet', { x: 1.6, y: 0, z: 1.2, width: 2.2, height: 0.02, depth: 1.6 }),
    ],
    ...facingEachOther(SMALL_ROOM_WIDTH / 2, SMALL_ROOM_DEPTH / 2, 2),
  };
}

function buildEmptySmallRoom(): RoomScene {
  return {
    boxes: [
      ...buildShoeboxRoom(SMALL_ROOM_WIDTH, SMALL_ROOM_HEIGHT, SMALL_ROOM_DEPTH, {
        floor: 'linoleum',
        ceiling: 'gypsum-board',
        walls: 'gypsum-board',
      }),
      buildPresetBox('window', 'glass', { x: SMALL_ROOM_WIDTH - 0.04, y: 0.9, z: 0.9, width: 0.04, height: 1.2, depth: 1.6 }),
    ],
    ...facingEachOther(SMALL_ROOM_WIDTH / 2, SMALL_ROOM_DEPTH / 2, 2),
  };
}

function buildFurnishedLargeRoom(): RoomScene {
  const seatingRows = [0, 1, 2].map(rowIndex =>
    buildPresetBox(`seating-row-${rowIndex}`, 'upholstered-seat', {
      x: 7.5 + rowIndex * 1.3,
      y: 0,
      z: 1.5,
      width: 0.7,
      height: 0.9,
      depth: 5,
    }),
  );

  return {
    boxes: [
      ...buildShoeboxRoom(LARGE_ROOM_WIDTH, LARGE_ROOM_HEIGHT, LARGE_ROOM_DEPTH, {
        floor: 'parquet',
        ceiling: 'ceiling-tile',
        walls: 'gypsum-board',
      }),
      ...seatingRows,
      buildPresetBox('rug-front', 'carpet', { x: 1, y: 0, z: 2, width: 4, height: 0.02, depth: 4 }),
      buildPresetBox('bookshelf-west', 'bookshelf', { x: 0.05, y: 0, z: 0.5, width: 0.4, height: 2.2, depth: 3 }),
      buildPresetBox('bookshelf-east', 'bookshelf', { x: LARGE_ROOM_WIDTH - 0.45, y: 0, z: 4.5, width: 0.4, height: 2.2, depth: 3 }),
      buildPresetBox('curtain-wall', 'curtain', { x: 2, y: 0.4, z: LARGE_ROOM_DEPTH - 0.15, width: 7, height: 2.8, depth: 0.15 }),
    ],
    ...facingEachOther(4.5, LARGE_ROOM_DEPTH / 2, 3),
  };
}

function buildEmptyLargeRoom(): RoomScene {
  return {
    boxes: buildShoeboxRoom(LARGE_ROOM_WIDTH, LARGE_ROOM_HEIGHT, LARGE_ROOM_DEPTH, {
      floor: 'concrete',
      ceiling: 'concrete',
      walls: 'painted-brick',
    }),
    ...facingEachOther(LARGE_ROOM_WIDTH / 2, LARGE_ROOM_DEPTH / 2, 3),
  };
}

const STREET_WIDTH_METERS = 11;
const STREET_LENGTH_METERS = 50;
const FACADE_HEIGHT_METERS = 13;

/**
 * A street canyon: hard ground and two facing façades, open above and at both ends. Nothing encloses it, so
 * most of the sound leaves for good and what comes back is a handful of strong lateral reflections between
 * the buildings rather than a decaying tail — the slap-back that makes a street sound like a street and
 * nothing like a room of the same width.
 */
function buildOutdoorStreet(): RoomScene {
  const facadeAt = (id: string, z: number): RoomBox[] => [
    buildPresetBox(`${id}-wall`, 'bare-brick', {
      x: -STREET_LENGTH_METERS / 2,
      y: 0,
      z,
      width: STREET_LENGTH_METERS,
      height: FACADE_HEIGHT_METERS,
      depth: 0.4,
    }),
    buildPresetBox(`${id}-windows`, 'glass', {
      x: -STREET_LENGTH_METERS / 2 + 4,
      y: 2.2,
      z: z + (z < 0 ? 0.4 : -0.05),
      width: STREET_LENGTH_METERS - 8,
      height: 2.4,
      depth: 0.05,
    }),
  ];

  return {
    boxes: [
      buildGroundPlane('asphalt', 120),
      ...facadeAt('north-facade', -STREET_WIDTH_METERS / 2 - 0.4),
      ...facadeAt('south-facade', STREET_WIDTH_METERS / 2),
    ],
    ...facingEachOther(0, 0, 4),
  };
}

/**
 * An open field: one absorbent ground plane and nothing else at all.
 *
 * There is no reverberation here to speak of, and that is the point — an outdoor scene is defined by the
 * surfaces that are missing. What reaches the listener is the direct sound plus a single reflection off the
 * grass, which is itself almost entirely absorbed above a few hundred hertz. The result should sound open and
 * slightly distant, not enclosed, and the way to be sure the simulation has that right is that it produces
 * almost nothing after the first few milliseconds.
 */
function buildOutdoorGrassField(): RoomScene {
  return { boxes: [buildGroundPlane('grass', 300)], ...facingEachOther(0, 0, 8) };
}

export const ROOM_PRESETS: readonly RoomPreset[] = [
  {
    id: 'furnished-small-room',
    label: 'Small room, furnished',
    description: 'A carpeted living room with a sofa, bookshelf and curtains. Close and dry.',
    buildScene: buildFurnishedSmallRoom,
  },
  {
    id: 'empty-small-room',
    label: 'Small room, empty',
    description: 'The same room stripped bare: hard floor, blank drywall, one window. Rings noticeably.',
    buildScene: buildEmptySmallRoom,
  },
  {
    id: 'furnished-large-room',
    label: 'Large room, furnished',
    description: 'A hall with seating, rugs, bookshelves and a curtained wall. Spacious but controlled.',
    buildScene: buildFurnishedLargeRoom,
  },
  {
    id: 'empty-large-room',
    label: 'Large room, empty',
    description: 'Bare concrete and painted brick at hall scale. A long, bright tail.',
    buildScene: buildEmptyLargeRoom,
  },
  {
    id: 'outdoor-street',
    label: 'Outside — street',
    description: 'Asphalt between two building façades, open to the sky. Hard slap-back, no tail.',
    buildScene: buildOutdoorStreet,
  },
  {
    id: 'outdoor-grass-field',
    label: 'Outside — grass field',
    description: 'Open grass and nothing else. Just the direct sound and one soft bounce off the ground.',
    buildScene: buildOutdoorGrassField,
  },
];

export const DEFAULT_ROOM_PRESET_ID: RoomPresetId = 'furnished-small-room';

export function getRoomPreset(id: RoomPresetId): RoomPreset {
  return ROOM_PRESETS.find(preset => preset.id === id) ?? ROOM_PRESETS[0];
}
