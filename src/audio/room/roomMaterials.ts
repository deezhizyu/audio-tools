import { DEFAULT_ABSORBER_ABSORPTION, DEFAULT_OBJECT_ABSORPTION, SCATTER_AMOUNT } from './roomAcousticsDefaults';
import type { FrequencyBandValues, RoomBox, RoomMaterialId } from './roomTypes';

export interface RoomMaterial {
  id: RoomMaterialId;
  label: string;
  absorption: FrequencyBandValues;
  /** 0 (mirror-like specular) – 1 (fully diffuse). Physically "how rough/bumpy" this surface's reflections
      are — consumed by the ray tracer (`traceRays.ts`, via `getEffectiveScatterAmount` below). */
  scatterAmount: number;
  /** Hex fill color used for this material's boxes in the room editor's canvas views. */
  color: string;
}

/** Absorption coefficients are 3-band (low/mid/high) approximations of published Sabine-style absorption
    tables, matching the simulator's existing simplification (see `FrequencyBandValues`). Both absorption and
    `scatterAmount` are cross-checked against Steam Audio's own shipped material library (its Unity plugin's
    built-in presets) wherever a direct counterpart exists — including `scatterAmount`, which Steam Audio keeps
    at a flat ~0.05 for every one of its built-in materials, using absorption alone to tell materials apart.
    That matters here specifically because this module's `getEffectiveScatterAmount` feeds directly into
    `recordReflectionArrival`'s next-event-estimation shading in `traceRays.ts`, ported line-for-line from
    Steam Audio's own `shade()`: a `scatterAmount` well above the range that formula was tuned/shipped at
    delivers unboundedly more reflected energy through its wide diffuse lobe (see the "car cabin" regression
    test in `traceRays.test.ts`), which is what made every one of this catalog's rougher materials sound like a
    dense, boxy wash rather than a distinctly-textured surface. Values below keep materials audibly distinct
    from each other (grass/foam roughest, glass/polished-metal smoothest) but compressed into the much lower,
    narrower range this formula actually behaves well at. The two `generic-*` entries deliberately reuse
    today's tuned defaults (`DEFAULT_OBJECT_ABSORPTION`/`DEFAULT_ABSORBER_ABSORPTION`/`SCATTER_AMOUNT`) rather
    than a "real" material's numbers, so a freshly-drawn box's physics exactly match pre-materials behavior
    until the user actually picks a material — see `DEFAULT_OBJECT_MATERIAL_ID`/`DEFAULT_ABSORBER_MATERIAL_ID`. */
export const ROOM_MATERIALS: readonly RoomMaterial[] = [
  { id: 'generic-object', label: 'Generic surface', absorption: DEFAULT_OBJECT_ABSORPTION, scatterAmount: SCATTER_AMOUNT, color: '#9aa3af' },
  { id: 'generic-absorber', label: 'Generic absorptive material', absorption: DEFAULT_ABSORBER_ABSORPTION, scatterAmount: SCATTER_AMOUNT, color: '#ef4444' },
  { id: 'concrete', label: 'Concrete', absorption: { low: 0.05, mid: 0.07, high: 0.08 }, scatterAmount: 0.05, color: '#9a9a94' },
  { id: 'painted-brick', label: 'Painted brick', absorption: { low: 0.01, mid: 0.02, high: 0.02 }, scatterAmount: 0.05, color: '#a6432e' },
  { id: 'bare-brick', label: 'Unpainted brick', absorption: { low: 0.03, mid: 0.04, high: 0.07 }, scatterAmount: 0.08, color: '#b1553a' },
  { id: 'linoleum', label: 'Linoleum', absorption: { low: 0.02, mid: 0.03, high: 0.02 }, scatterAmount: 0.03, color: '#c9b896' },
  { id: 'parquet', label: 'Parquet', absorption: { low: 0.04, mid: 0.07, high: 0.06 }, scatterAmount: 0.05, color: '#b8874c' },
  { id: 'wood', label: 'Wood panel', absorption: { low: 0.11, mid: 0.07, high: 0.06 }, scatterAmount: 0.06, color: '#8a5a34' },
  { id: 'wool', label: 'Wool felt', absorption: { low: 0.15, mid: 0.65, high: 0.85 }, scatterAmount: 0.2, color: '#d8cfae' },
  { id: 'plastic', label: 'Plastic', absorption: { low: 0.02, mid: 0.03, high: 0.03 }, scatterAmount: 0.04, color: '#d0d3d6' },
  { id: 'smooth-metal', label: 'Smooth metal', absorption: { low: 0.2, mid: 0.05, high: 0.06 }, scatterAmount: 0.05, color: '#b8bcc2' },
  { id: 'uneven-metal', label: 'Corrugated metal', absorption: { low: 0.05, mid: 0.07, high: 0.09 }, scatterAmount: 0.15, color: '#8f9499' },
  { id: 'glass', label: 'Glass', absorption: { low: 0.18, mid: 0.06, high: 0.04 }, scatterAmount: 0.03, color: '#a8d4e0' },
  { id: 'carpet', label: 'Heavy carpet', absorption: { low: 0.24, mid: 0.69, high: 0.73 }, scatterAmount: 0.12, color: '#7a3f4d' },
  { id: 'gypsum-board', label: 'Drywall / gypsum board', absorption: { low: 0.12, mid: 0.06, high: 0.04 }, scatterAmount: 0.05, color: '#e5e1d8' },
  { id: 'acoustic-foam', label: 'Acoustic foam', absorption: { low: 0.15, mid: 0.75, high: 0.92 }, scatterAmount: 0.25, color: '#3a3a3a' },
  { id: 'grass', label: 'Grass', absorption: { low: 0.11, mid: 0.3, high: 0.6 }, scatterAmount: 0.3, color: '#4a7c3f' },
];

export const DEFAULT_OBJECT_MATERIAL_ID: RoomMaterialId = 'generic-object';
export const DEFAULT_ABSORBER_MATERIAL_ID: RoomMaterialId = 'generic-absorber';

const ROOM_MATERIALS_BY_ID = new Map<RoomMaterialId, RoomMaterial>(ROOM_MATERIALS.map(material => [material.id, material]));

/** Falls back to a kind-appropriate generic material for an id that isn't (or is no longer) in the catalog —
    e.g. a room file saved by a future version with a material this build doesn't know about. */
export function getRoomMaterial(id: RoomMaterialId): RoomMaterial {
  return ROOM_MATERIALS_BY_ID.get(id) ?? ROOM_MATERIALS_BY_ID.get(DEFAULT_OBJECT_MATERIAL_ID)!;
}

/** The single source of truth for how rough/diffuse a box's surface actually is, consumed by the ray tracer
    (`traceRays.ts`). `textureIntensity` can push past 1 (an exaggerated, extra-rough box), but the effective
    value clamps to `[0, 1]` since it's consumed as a specular/diffuse mix fraction. */
export function getEffectiveScatterAmount(box: RoomBox): number {
  return Math.min(1, Math.max(0, getRoomMaterial(box.materialId).scatterAmount * box.textureIntensity));
}
