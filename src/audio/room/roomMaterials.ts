import { DEFAULT_ABSORBER_ABSORPTION, DEFAULT_OBJECT_ABSORPTION, SCATTER_AMOUNT } from './roomAcousticsDefaults';
import type { FrequencyBandValues, RoomBox, RoomMaterialId } from './roomTypes';

/** Which part of the material picker an entry appears under. Purely a grouping for the editor's UI — any
    material can be applied to any box — but it lives on the material rather than in the component so the
    catalog stays the single place a new material has to be added. */
export type RoomMaterialGroup = 'hard' | 'soft' | 'ground';

export interface RoomMaterial {
  id: RoomMaterialId;
  label: string;
  group: RoomMaterialGroup;
  absorption: FrequencyBandValues;
  /** 0 (mirror-like specular) – 1 (fully diffuse). Physically "how rough/bumpy" this surface's reflections
      are — consumed by the ray tracer (`traceRays.ts`, via `getEffectiveScatterAmount` below) to split each
      bounce between a diffuse and a specular lobe, and by `imageSources.ts` to decide how much of an early
      echo stays a coherent mirror reflection. */
  scatterAmount: number;
  /** Hex fill color used for this material's boxes in the room editor's canvas views. */
  color: string;
}

/**
 * Absorption coefficients are three-band reductions of published Sabine absorption tables. The bands are the
 * simulator's own (see `bandSplitFilters.ts`): low is up to 800Hz, so the average of the 125/250/500Hz octave
 * bands; mid is 800Hz-8kHz, the average of 1k/2k/4k; high is above 8kHz, extrapolated from 4k. Getting that
 * mapping right matters as much as the numbers — a coefficient measured at 4kHz applied to the low band
 * describes a completely different material.
 *
 * `scatterAmount` is a real measured property here, not a tuning knob. It used to sit near 0.05 for every
 * entry, copied from Steam Audio's library, which uses absorption alone to tell its materials apart — but
 * that flat value was also working around an energy bug in the reflection lobe (it inflated rough surfaces'
 * contribution), and with that fixed there is no reason to keep every surface in the room a near-mirror.
 * Published scattering coefficients spread far wider than that: a flat painted wall really is near-specular
 * at 0.02-0.05, while a filled bookshelf or a hedge scatters most of what hits it. That spread is a large part
 * of why a furnished room sounds nothing like an empty one of the same size.
 *
 * The two `generic-*` entries deliberately reuse the tuned defaults
 * (`DEFAULT_OBJECT_ABSORPTION`/`DEFAULT_ABSORBER_ABSORPTION`/`SCATTER_AMOUNT`) rather than a real material's
 * numbers, so a freshly-drawn box behaves like a plausible average building surface until the user picks
 * something specific — see `DEFAULT_OBJECT_MATERIAL_ID`/`DEFAULT_ABSORBER_MATERIAL_ID`.
 *
 * Keyed by `RoomMaterialId`, so adding a name to that union without describing it here fails to compile, and
 * the declaration order below is the order the picker shows.
 */
const ROOM_MATERIAL_DEFINITIONS: Record<RoomMaterialId, Omit<RoomMaterial, 'id'>> = {
  // --- Hard surfaces ---------------------------------------------------------------------------------
  'generic-object': { label: 'Generic surface', group: 'hard', absorption: DEFAULT_OBJECT_ABSORPTION, scatterAmount: SCATTER_AMOUNT, color: '#9aa3af' },
  concrete: { label: 'Concrete, smooth', group: 'hard', absorption: { low: 0.05, mid: 0.07, high: 0.08 }, scatterAmount: 0.08, color: '#9a9a94' },
  /** Unpainted block is porous enough to be a genuinely useful mid absorber, unlike the sealed concrete
      above — the two are frequently confused, and they sound nothing alike. */
  'concrete-block': { label: 'Concrete block, unpainted', group: 'hard', absorption: { low: 0.37, mid: 0.31, high: 0.25 }, scatterAmount: 0.2, color: '#8e8e86' },
  'painted-brick': { label: 'Painted brick', group: 'hard', absorption: { low: 0.01, mid: 0.02, high: 0.02 }, scatterAmount: 0.1, color: '#a6432e' },
  'bare-brick': { label: 'Unpainted brick', group: 'hard', absorption: { low: 0.03, mid: 0.04, high: 0.07 }, scatterAmount: 0.2, color: '#b1553a' },
  linoleum: { label: 'Linoleum', group: 'hard', absorption: { low: 0.02, mid: 0.03, high: 0.02 }, scatterAmount: 0.05, color: '#c9b896' },
  parquet: { label: 'Parquet', group: 'hard', absorption: { low: 0.04, mid: 0.07, high: 0.06 }, scatterAmount: 0.08, color: '#b8874c' },
  wood: { label: 'Wood, solid', group: 'hard', absorption: { low: 0.11, mid: 0.07, high: 0.06 }, scatterAmount: 0.1, color: '#8a5a34' },
  /** Thin panelling over an air gap is a membrane absorber: it works on bass specifically, which is exactly
      what most simulated rooms lack. Without anything of the sort, a room's low tail runs unrealistically
      long and boomy however much soft furnishing is piled into it, because carpet and curtains do almost
      nothing below a few hundred hertz. */
  'wood-paneling': { label: 'Wood panelling, thin (air gap)', group: 'hard', absorption: { low: 0.22, mid: 0.1, high: 0.11 }, scatterAmount: 0.12, color: '#a06b3e' },
  plastic: { label: 'Plastic', group: 'hard', absorption: { low: 0.02, mid: 0.03, high: 0.03 }, scatterAmount: 0.06, color: '#d0d3d6' },
  'smooth-metal': { label: 'Metal, smooth', group: 'hard', absorption: { low: 0.2, mid: 0.05, high: 0.06 }, scatterAmount: 0.04, color: '#b8bcc2' },
  'uneven-metal': { label: 'Metal, corrugated', group: 'hard', absorption: { low: 0.05, mid: 0.07, high: 0.09 }, scatterAmount: 0.3, color: '#8f9499' },
  /** A window pane flexes, so it absorbs bass far more than the plate glass below — the low band is the whole
      difference between the two, and it is the reason a glazed room sounds tighter than it looks. */
  glass: { label: 'Glass, window pane', group: 'hard', absorption: { low: 0.26, mid: 0.08, high: 0.04 }, scatterAmount: 0.04, color: '#a8d4e0' },
  'plate-glass': { label: 'Glass, heavy plate', group: 'hard', absorption: { low: 0.09, mid: 0.03, high: 0.02 }, scatterAmount: 0.03, color: '#7fb6c7' },
  'gypsum-board': { label: 'Drywall / gypsum board', group: 'hard', absorption: { low: 0.12, mid: 0.06, high: 0.04 }, scatterAmount: 0.08, color: '#e5e1d8' },
  /** A real building front is never one flat plane the way a painted interior wall is — window reveals,
      balconies, sills, cornices and pipework are all irregularities at the scale of audio wavelengths, and
      they scatter far more of an incident reflection than the bare masonry number alone suggests. Modeling a
      street's façades as `bare-brick` (scatter 0.2, nearly a mirror) is what turned two long, closely-spaced
      building fronts into a flutter-echo waveguide — a corridor, not a street — because a near-specular
      reflection bounces back and forth between them dozens of times before enough of it escapes. */
  'building-facade': {
    label: 'Building façade (masonry, windows, balconies)',
    group: 'hard',
    absorption: { low: 0.04, mid: 0.06, high: 0.08 },
    scatterAmount: 0.45,
    color: '#9c7a5c',
  },

  // --- Soft surfaces and furnishings -----------------------------------------------------------------
  'generic-absorber': { label: 'Generic absorptive material', group: 'soft', absorption: DEFAULT_ABSORBER_ABSORPTION, scatterAmount: SCATTER_AMOUNT, color: '#ef4444' },
  wool: { label: 'Wool felt', group: 'soft', absorption: { low: 0.15, mid: 0.65, high: 0.85 }, scatterAmount: 0.25, color: '#d8cfae' },
  carpet: { label: 'Carpet, heavy on underlay', group: 'soft', absorption: { low: 0.3, mid: 0.71, high: 0.75 }, scatterAmount: 0.25, color: '#7a3f4d' },
  /** Carpet laid straight onto a hard floor absorbs far less, especially low down — and it is what most rooms
      actually have, so it is worth being able to pick rather than only the studio-grade version above. */
  'carpet-on-concrete': { label: 'Carpet on a hard floor', group: 'soft', absorption: { low: 0.07, mid: 0.54, high: 0.65 }, scatterAmount: 0.2, color: '#96586a' },
  'acoustic-foam': { label: 'Acoustic foam, 5cm panel', group: 'soft', absorption: { low: 0.41, mid: 0.96, high: 0.97 }, scatterAmount: 0.3, color: '#3a3a3a' },
  'ceiling-tile': { label: 'Ceiling tile, mineral fibre', group: 'soft', absorption: { low: 0.47, mid: 0.83, high: 0.78 }, scatterAmount: 0.25, color: '#cfd4cd' },
  curtain: { label: 'Curtain, heavy and draped', group: 'soft', absorption: { low: 0.35, mid: 0.69, high: 0.65 }, scatterAmount: 0.3, color: '#6b4c7a' },
  'upholstered-seat': { label: 'Upholstered seating, empty', group: 'soft', absorption: { low: 0.37, mid: 0.62, high: 0.6 }, scatterAmount: 0.35, color: '#5f7a8a' },
  /** People are among the most absorptive things a room contains, which is why a full room sounds so much
      deader than the same room empty. */
  'occupied-seating': { label: 'Seating with people in it', group: 'soft', absorption: { low: 0.59, mid: 0.91, high: 0.87 }, scatterAmount: 0.45, color: '#c98a6b' },
  mattress: { label: 'Mattress / bed', group: 'soft', absorption: { low: 0.3, mid: 0.7, high: 0.75 }, scatterAmount: 0.35, color: '#ddd2c0' },
  /** Only moderately absorptive, but among the most strongly scattering surfaces in an ordinary room: a wall
      of book spines at all depths breaks up reflections that a flat wall would send straight back. */
  bookshelf: { label: 'Bookshelf, filled', group: 'soft', absorption: { low: 0.25, mid: 0.35, high: 0.4 }, scatterAmount: 0.7, color: '#7d5a3c' },

  // --- Ground and outdoor surfaces -------------------------------------------------------------------
  /** Grass is close to a total absorber above a few hundred hertz — 0.6 at 500Hz rising past 0.95 by 4kHz.
      Values far below that (this entry used to read 0.11/0.30/0.60) describe something closer to a hard
      field, and are why an outdoor scene came back sounding enclosed instead of open.
      Its `scatterAmount` needs to be high, not moderate: individual blades are a fraction of even the
      shortest audible wavelength, so grass has no coherent flat plane to mirror-reflect off at all — it is
      one of the closest things to a purely Lambertian (fully diffuse) surface in this catalog. Treating it
      as half-specular (this used to read 0.45) gave a field's single ground bounce an unrealistically clean,
      focused echo — a "slap" no real lawn produces — instead of the soft, spread-out scatter a real one
      does. */
  grass: { label: 'Grass', group: 'ground', absorption: { low: 0.3, mid: 0.85, high: 0.95 }, scatterAmount: 0.85, color: '#4a7c3f' },
  soil: { label: 'Bare soil / packed earth', group: 'ground', absorption: { low: 0.15, mid: 0.4, high: 0.55 }, scatterAmount: 0.55, color: '#6b5138' },
  gravel: { label: 'Gravel', group: 'ground', absorption: { low: 0.6, mid: 0.7, high: 0.8 }, scatterAmount: 0.65, color: '#8a857c' },
  asphalt: { label: 'Asphalt / paving', group: 'ground', absorption: { low: 0.03, mid: 0.04, high: 0.05 }, scatterAmount: 0.1, color: '#4a4a4e' },
  water: { label: 'Water surface', group: 'ground', absorption: { low: 0.01, mid: 0.01, high: 0.02 }, scatterAmount: 0.02, color: '#3f6f9c' },
  snow: { label: 'Fresh snow', group: 'ground', absorption: { low: 0.7, mid: 0.95, high: 0.95 }, scatterAmount: 0.7, color: '#eaf1f6' },
  foliage: { label: 'Dense foliage / hedge', group: 'ground', absorption: { low: 0.2, mid: 0.5, high: 0.7 }, scatterAmount: 0.75, color: '#2f6b35' },
};

export const ROOM_MATERIALS: readonly RoomMaterial[] = (Object.keys(ROOM_MATERIAL_DEFINITIONS) as RoomMaterialId[]).map(id => ({
  id,
  ...ROOM_MATERIAL_DEFINITIONS[id],
}));

export const DEFAULT_OBJECT_MATERIAL_ID: RoomMaterialId = 'generic-object';
export const DEFAULT_ABSORBER_MATERIAL_ID: RoomMaterialId = 'generic-absorber';

/** Looked up rather than rebuilt per call: `getEffectiveScatterAmount` below runs inside the ray tracer's
    innermost loop, millions of times per simulation, so this must not allocate. */
const ROOM_MATERIALS_BY_ID = new Map<RoomMaterialId, RoomMaterial>(ROOM_MATERIALS.map(material => [material.id, material]));

/** Falls back to a generic material for an id that isn't (or is no longer) in the catalog — e.g. a room file
    saved by a future version with a material this build doesn't know about. */
export function getRoomMaterial(id: RoomMaterialId): RoomMaterial {
  return ROOM_MATERIALS_BY_ID.get(id) ?? ROOM_MATERIALS_BY_ID.get(DEFAULT_OBJECT_MATERIAL_ID)!;
}

export function getRoomMaterialsInGroup(group: RoomMaterialGroup): RoomMaterial[] {
  return ROOM_MATERIALS.filter(material => material.group === group);
}

/** The single source of truth for how rough/diffuse a box's surface actually is, consumed by the ray tracer
    (`traceRays.ts`) and the image-source pass (`imageSources.ts`). `textureIntensity` can push past 1 (an
    exaggerated, extra-rough box), but the effective value clamps to `[0, 1]` since it's consumed as a
    specular/diffuse mix fraction. */
export function getEffectiveScatterAmount(box: RoomBox): number {
  return Math.min(1, Math.max(0, getRoomMaterial(box.materialId).scatterAmount * box.textureIntensity));
}
