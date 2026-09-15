import { BOUNDS_STRIDE, type AxisAlignedBox } from './rayBoxIntersection';
import type { RoomBox } from './roomTypes';

export function toAxisAlignedBox(box: RoomBox): AxisAlignedBox {
  return {
    minX: box.x,
    minY: box.y,
    minZ: box.z,
    maxX: box.x + box.width,
    maxY: box.y + box.height,
    maxZ: box.z + box.depth,
  };
}

/**
 * Every box's bounds laid out end to end in one array: six numbers each, minimums then maximums.
 *
 * Built once per simulation and then read millions of times. A flat array of numbers is walked contiguously
 * and needs no property lookups, where an array of objects sends the intersection test chasing a pointer per
 * box and per field — and the boxes cannot move partway through a simulation, so there is nothing to keep in
 * sync.
 */
export function packBoxBounds(boxes: RoomBox[]): Float64Array {
  const bounds = new Float64Array(boxes.length * BOUNDS_STRIDE);
  boxes.forEach((box, boxIndex) => {
    const offset = boxIndex * BOUNDS_STRIDE;
    bounds[offset] = box.x;
    bounds[offset + 1] = box.y;
    bounds[offset + 2] = box.z;
    bounds[offset + 3] = box.x + box.width;
    bounds[offset + 4] = box.y + box.height;
    bounds[offset + 5] = box.z + box.depth;
  });
  return bounds;
}
