import type { AxisAlignedBox } from './rayBoxIntersection';
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
