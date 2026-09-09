import { DEFAULT_ABSORBER_ABSORPTION, DEFAULT_OBJECT_ABSORPTION, SCATTER_AMOUNT } from './roomAcousticsDefaults';
import type { FrequencyBandValues, RoomBox, RoomMaterialId } from './roomTypes';

export type RoomMaterialTextureKind = 'flat' | 'dotted-holes' | 'wavy-lines' | 'grain-lines' | 'brick-coursing' | 'crosshatch' | 'tufts';

export interface RoomMaterialTexture {
  kind: RoomMaterialTextureKind;
}

export interface RoomMaterial {
  id: RoomMaterialId;
  label: string;
  absorption: FrequencyBandValues;
  /** 0 (mirror-like specular) – 1 (fully diffuse). Physically "how rough/bumpy" this surface's reflections
      are — consumed by the ray tracer (`traceRays.ts`, via `getEffectiveScatterAmount` below), not just
      cosmetic. */
  scatterAmount: number;
  /** Hex fill color used for this material's boxes in the room editor's canvas views. */
  color: string;
  texture: RoomMaterialTexture;
}

/** Absorption coefficients are 3-band (low/mid/high) approximations of published Sabine-style absorption
    tables, matching the simulator's existing simplification (see `FrequencyBandValues`). `scatterAmount` is an
    engineering judgment of how irregular each surface physically is, not a measured constant. The two
    `generic-*` entries deliberately reuse today's tuned defaults (`DEFAULT_OBJECT_ABSORPTION`/
    `DEFAULT_ABSORBER_ABSORPTION`/`SCATTER_AMOUNT`) rather than a "real" material's numbers, so a freshly-drawn
    box's physics exactly match pre-materials behavior until the user actually picks a material — see
    `DEFAULT_OBJECT_MATERIAL_ID`/`DEFAULT_ABSORBER_MATERIAL_ID`. */
export const ROOM_MATERIALS: readonly RoomMaterial[] = [
  { id: 'generic-object', label: 'Generic surface', absorption: DEFAULT_OBJECT_ABSORPTION, scatterAmount: SCATTER_AMOUNT, color: '#9aa3af', texture: { kind: 'flat' } },
  { id: 'generic-absorber', label: 'Generic absorptive material', absorption: DEFAULT_ABSORBER_ABSORPTION, scatterAmount: SCATTER_AMOUNT, color: '#ef4444', texture: { kind: 'flat' } },
  { id: 'concrete', label: 'Concrete', absorption: { low: 0.01, mid: 0.02, high: 0.02 }, scatterAmount: 0.7, color: '#9a9a94', texture: { kind: 'dotted-holes' } },
  { id: 'painted-brick', label: 'Painted brick', absorption: { low: 0.01, mid: 0.02, high: 0.02 }, scatterAmount: 0.6, color: '#a6432e', texture: { kind: 'brick-coursing' } },
  { id: 'bare-brick', label: 'Unpainted brick', absorption: { low: 0.03, mid: 0.03, high: 0.05 }, scatterAmount: 0.75, color: '#b1553a', texture: { kind: 'brick-coursing' } },
  { id: 'linoleum', label: 'Linoleum', absorption: { low: 0.02, mid: 0.03, high: 0.02 }, scatterAmount: 0.15, color: '#c9b896', texture: { kind: 'flat' } },
  { id: 'parquet', label: 'Parquet', absorption: { low: 0.04, mid: 0.07, high: 0.06 }, scatterAmount: 0.35, color: '#b8874c', texture: { kind: 'grain-lines' } },
  { id: 'wood', label: 'Wood panel', absorption: { low: 0.15, mid: 0.11, high: 0.1 }, scatterAmount: 0.4, color: '#8a5a34', texture: { kind: 'grain-lines' } },
  { id: 'wool', label: 'Wool felt', absorption: { low: 0.15, mid: 0.65, high: 0.85 }, scatterAmount: 0.55, color: '#d8cfae', texture: { kind: 'wavy-lines' } },
  { id: 'plastic', label: 'Plastic', absorption: { low: 0.02, mid: 0.03, high: 0.03 }, scatterAmount: 0.1, color: '#d0d3d6', texture: { kind: 'flat' } },
  { id: 'smooth-metal', label: 'Smooth metal', absorption: { low: 0.03, mid: 0.03, high: 0.05 }, scatterAmount: 0.05, color: '#b8bcc2', texture: { kind: 'flat' } },
  { id: 'uneven-metal', label: 'Corrugated metal', absorption: { low: 0.05, mid: 0.07, high: 0.09 }, scatterAmount: 0.65, color: '#8f9499', texture: { kind: 'crosshatch' } },
  { id: 'glass', label: 'Glass', absorption: { low: 0.18, mid: 0.06, high: 0.04 }, scatterAmount: 0.03, color: '#a8d4e0', texture: { kind: 'flat' } },
  { id: 'carpet', label: 'Heavy carpet', absorption: { low: 0.08, mid: 0.57, high: 0.71 }, scatterAmount: 0.5, color: '#7a3f4d', texture: { kind: 'wavy-lines' } },
  { id: 'gypsum-board', label: 'Drywall / gypsum board', absorption: { low: 0.29, mid: 0.1, high: 0.05 }, scatterAmount: 0.2, color: '#e5e1d8', texture: { kind: 'flat' } },
  { id: 'acoustic-foam', label: 'Acoustic foam', absorption: { low: 0.15, mid: 0.75, high: 0.92 }, scatterAmount: 0.6, color: '#3a3a3a', texture: { kind: 'dotted-holes' } },
  { id: 'grass', label: 'Grass', absorption: { low: 0.11, mid: 0.3, high: 0.6 }, scatterAmount: 0.8, color: '#4a7c3f', texture: { kind: 'tufts' } },
];

export const DEFAULT_OBJECT_MATERIAL_ID: RoomMaterialId = 'generic-object';
export const DEFAULT_ABSORBER_MATERIAL_ID: RoomMaterialId = 'generic-absorber';

const ROOM_MATERIALS_BY_ID = new Map<RoomMaterialId, RoomMaterial>(ROOM_MATERIALS.map(material => [material.id, material]));

/** Falls back to a kind-appropriate generic material for an id that isn't (or is no longer) in the catalog —
    e.g. a room file saved by a future version with a material this build doesn't know about. */
export function getRoomMaterial(id: RoomMaterialId): RoomMaterial {
  return ROOM_MATERIALS_BY_ID.get(id) ?? ROOM_MATERIALS_BY_ID.get(DEFAULT_OBJECT_MATERIAL_ID)!;
}

/** The single source of truth for how rough/diffuse a box's surface actually is — consumed by both the ray
    tracer (`traceRays.ts`, physics) and the canvas texture renderer (`roomViewTextures.ts`, visuals), so a
    box's on-screen bumpiness and its acoustic scattering can never drift apart. `textureIntensity` can push
    past 1 (an exaggerated, extra-rough box), but the effective value clamps to `[0, 1]` since it's consumed as
    a specular/diffuse mix fraction. */
export function getEffectiveScatterAmount(box: RoomBox): number {
  return Math.min(1, Math.max(0, getRoomMaterial(box.materialId).scatterAmount * box.textureIntensity));
}
