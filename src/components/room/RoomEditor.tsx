import type { JSX } from 'preact';
import { ROOM_MATERIALS } from '../../audio/room/roomMaterials';
import type { RoomBox, RoomMaterialId } from '../../audio/room/roomTypes';
import {
  activeRoomEditorTool,
  createBoxFromCanvasDrag,
  listenerPosition,
  moveListenerOnAxes,
  moveSelectedBoxes,
  moveSourceOnAxes,
  removeSelectedBoxes,
  resizeBox,
  roomBoxes,
  selectBoxesInRect,
  selectedBoxIds,
  selectSingleBox,
  setActiveRoomEditorTool,
  snapToAlignmentEnabled,
  sourcePosition,
  stereoSimulationEnabled,
  toggleBoxSelection,
  toggleSnapToAlignment,
  toggleStereoSimulation,
  updateSelectedBoxesAbsorptionBand,
  updateSelectedBoxesMaterial,
  updateSelectedBoxesTextureIntensity,
  updateSelectedBoxField,
} from '../../state/roomReverbSignals';
import { centimetersToMeters, metersToCentimeters } from '../../utils/unitConversion';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { SectionHeading } from '../ui/SectionHeading';
import { RoomOrthographicView, type RoomEditorTool } from './RoomOrthographicView';

const TOP_VIEW_AXES = { horizontal: 'x', vertical: 'z' } as const;
const FRONT_VIEW_AXES = { horizontal: 'x', vertical: 'y' } as const;
const SIDE_VIEW_AXES = { horizontal: 'z', vertical: 'y' } as const;

const TOOL_OPTIONS: { tool: RoomEditorTool; label: string }[] = [
  { tool: 'select', label: 'Select / move' },
  { tool: 'add-object', label: 'Draw object' },
  { tool: 'add-absorber', label: 'Draw absorber' },
];

const POSITION_FIELDS: { field: keyof Pick<RoomBox, 'x' | 'y' | 'z'>; label: string }[] = [
  { field: 'x', label: 'X' },
  { field: 'y', label: 'Y (height)' },
  { field: 'z', label: 'Z' },
];

const SIZE_FIELDS: { field: keyof Pick<RoomBox, 'width' | 'height' | 'depth'>; label: string }[] = [
  { field: 'width', label: 'Width' },
  { field: 'height', label: 'Height' },
  { field: 'depth', label: 'Depth' },
];

const ABSORPTION_BANDS: { band: 'low' | 'mid' | 'high'; label: string }[] = [
  { band: 'low', label: 'Low' },
  { band: 'mid', label: 'Mid' },
  { band: 'high', label: 'High' },
];

/** Purely a picker-grouping split (optgroups), not a hard restriction — any material can still be applied to
    either an object or an absorber box. */
const HARD_SURFACE_MATERIAL_IDS = new Set<RoomMaterialId>([
  'generic-object',
  'concrete',
  'painted-brick',
  'bare-brick',
  'linoleum',
  'parquet',
  'wood',
  'plastic',
  'smooth-metal',
  'uneven-metal',
  'glass',
  'gypsum-board',
  'grass',
]);
const HARD_SURFACE_MATERIALS = ROOM_MATERIALS.filter(material => HARD_SURFACE_MATERIAL_IDS.has(material.id));
const SOFT_SURFACE_MATERIALS = ROOM_MATERIALS.filter(material => !HARD_SURFACE_MATERIAL_IDS.has(material.id));

function NumberField({
  label,
  value,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number | null;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  const handleInput = (event: JSX.TargetedEvent<HTMLInputElement>) => {
    const parsed = Number(event.currentTarget.value);
    if (Number.isFinite(parsed)) onChange(parsed);
  };

  return (
    <label class="flex flex-col gap-1 text-xs">
      <span class="text-text-tertiary">{label}</span>
      <div class="flex items-center gap-1.5 rounded-md border border-border-strong bg-surface-overlay px-2 py-1 focus-within:border-accent">
        <input
          type="number"
          step={step}
          value={value ?? ''}
          placeholder={value === null ? 'Mixed' : undefined}
          onInput={handleInput}
          class="w-full bg-transparent font-mono text-xs text-text-primary outline-none placeholder:text-text-tertiary"
        />
        {unit && <span class="shrink-0 text-[10px] text-text-tertiary">{unit}</span>}
      </div>
    </label>
  );
}

/** Position/size are stored in meters (what the acoustics engine works in) but shown rounded to whole
    centimeters — a human-scale unit that reads as real room measurements instead of unrounded meter floats. */
function DistanceField({ label, meters, onChangeMeters }: { label: string; meters: number; onChangeMeters: (meters: number) => void }) {
  return (
    <NumberField label={label} value={Math.round(metersToCentimeters(meters))} step={1} unit="cm" onChange={centimeters => onChangeMeters(centimetersToMeters(centimeters))} />
  );
}

/** `value: null` renders as "Mixed" — used by the multi-select inspector when selected boxes' texture
    intensity differs. */
function RangeField({ label, value, hint, onChange }: { label: string; value: number | null; hint?: string; onChange: (value: number) => void }) {
  const handleInput = (event: JSX.TargetedEvent<HTMLInputElement>) => {
    onChange(Number(event.currentTarget.value));
  };

  return (
    <label class="flex flex-col gap-1 text-xs">
      <div class="flex items-center justify-between">
        <span class="text-text-tertiary">{label}</span>
        <span class="font-mono text-[10px] text-text-tertiary">{value === null ? 'Mixed' : value.toFixed(1)}</span>
      </div>
      <input type="range" min={0} max={2} step={0.1} value={value ?? 1} onInput={handleInput} class="w-full accent-accent" />
      {hint && <span class="text-[10px] text-text-tertiary">{hint}</span>}
    </label>
  );
}

/** `value: null` (multi-select with mixed materials) shows a neutral placeholder rather than any one selected
    box's material — there's no single "current" material meaningful across a mixed set. */
function MaterialSelect({ value, onChange }: { value: RoomMaterialId | null; onChange: (materialId: RoomMaterialId) => void }) {
  const handleChange = (event: JSX.TargetedEvent<HTMLSelectElement>) => {
    onChange(event.currentTarget.value as RoomMaterialId);
  };

  return (
    <label class="flex flex-col gap-1 text-xs">
      <span class="text-text-tertiary">Material</span>
      <select
        value={value ?? ''}
        onChange={handleChange}
        class="w-full rounded-md border border-border-strong bg-surface-overlay px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
      >
        {value === null && (
          <option value="" disabled>
            Change material…
          </option>
        )}
        <optgroup label="Hard surfaces">
          {HARD_SURFACE_MATERIALS.map(material => (
            <option key={material.id} value={material.id}>
              {material.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Soft surfaces">
          {SOFT_SURFACE_MATERIALS.map(material => (
            <option key={material.id} value={material.id}>
              {material.label}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  );
}

function SingleBoxInspector({ box }: { box: RoomBox }) {
  return (
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <span class="text-xs font-medium uppercase tracking-wide text-text-secondary">{box.kind === 'object' ? 'Object' : 'Absorber'}</span>
        <Button variant="ghost" onClick={removeSelectedBoxes}>
          Delete
        </Button>
      </div>

      <MaterialSelect value={box.materialId} onChange={updateSelectedBoxesMaterial} />

      {box.kind === 'object' && (
        <RangeField
          label="Roughness"
          value={box.textureIntensity}
          hint="0 = smooth (mirror-like), 1 = realistic, 2 = extra rough — how diffusely this surface scatters sound"
          onChange={updateSelectedBoxesTextureIntensity}
        />
      )}

      <div class="grid grid-cols-3 gap-3">
        {POSITION_FIELDS.map(({ field, label }) => (
          <DistanceField key={field} label={label} meters={box[field]} onChangeMeters={meters => updateSelectedBoxField(box.id, field, meters)} />
        ))}
      </div>

      <div class="grid grid-cols-3 gap-3">
        {SIZE_FIELDS.map(({ field, label }) => (
          <DistanceField key={field} label={label} meters={box[field]} onChangeMeters={meters => updateSelectedBoxField(box.id, field, meters)} />
        ))}
      </div>

      {box.kind === 'object' && (
        <div>
          <p class="mb-2 text-xs text-text-tertiary">Absorption (0 = fully reflective, 1 = fully absorbed)</p>
          <div class="grid grid-cols-3 gap-3">
            {ABSORPTION_BANDS.map(({ band, label }) => (
              <NumberField
                key={band}
                label={label}
                step={0.05}
                value={box.absorption[band]}
                onChange={value => updateSelectedBoxesAbsorptionBand(band, Math.min(1, Math.max(0, value)))}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function mixedOrValue(values: number[]): number | null {
  return values.every(value => value === values[0]) ? values[0] : null;
}

function MultiBoxInspector({ boxes }: { boxes: RoomBox[] }) {
  return (
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <span class="text-xs font-medium uppercase tracking-wide text-text-secondary">{boxes.length} objects selected</span>
        <Button variant="ghost" onClick={removeSelectedBoxes}>
          Delete
        </Button>
      </div>

      <MaterialSelect value={null} onChange={updateSelectedBoxesMaterial} />

      <RangeField
        label="Roughness"
        value={mixedOrValue(boxes.map(box => box.textureIntensity))}
        hint="0 = smooth (mirror-like), 1 = realistic, 2 = extra rough — how diffusely these surfaces scatter sound"
        onChange={updateSelectedBoxesTextureIntensity}
      />

      <div>
        <p class="mb-2 text-xs text-text-tertiary">Absorption (0 = fully reflective, 1 = fully absorbed)</p>
        <div class="grid grid-cols-3 gap-3">
          {ABSORPTION_BANDS.map(({ band, label }) => (
            <NumberField
              key={band}
              label={label}
              step={0.05}
              value={mixedOrValue(boxes.map(box => box.absorption[band]))}
              onChange={value => updateSelectedBoxesAbsorptionBand(band, Math.min(1, Math.max(0, value)))}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SelectedBoxInspector() {
  const selected = roomBoxes.value.filter(box => selectedBoxIds.value.has(box.id));
  if (selected.length === 0) {
    return <p class="text-xs text-text-tertiary">Select a box to edit its exact position, size, and absorption.</p>;
  }
  if (selected.length === 1) return <SingleBoxInspector box={selected[0]} />;
  return <MultiBoxInspector boxes={selected} />;
}

export function RoomEditor() {
  const boxes = roomBoxes.value;
  const activeTool = activeRoomEditorTool.value;

  return (
    <Card class="flex flex-col gap-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <SectionHeading
          title="Room"
          description={
            <>
              Draw objects and absorbers, then place the <span class="text-accent">source</span> and{' '}
              <span class="text-text-primary">listener</span> dots.
            </>
          }
        />
        <div class="flex flex-wrap items-center gap-2">
          {TOOL_OPTIONS.map(({ tool, label }) => (
            <Button key={tool} variant={activeTool === tool ? 'primary' : 'secondary'} onClick={() => setActiveRoomEditorTool(tool)}>
              {label}
            </Button>
          ))}
          <div class="mx-1 h-6 w-px bg-border-subtle" />
          <Button variant={snapToAlignmentEnabled.value ? 'primary' : 'secondary'} onClick={toggleSnapToAlignment}>
            Snap {snapToAlignmentEnabled.value ? 'on' : 'off'}
          </Button>
          <Button variant={stereoSimulationEnabled.value ? 'primary' : 'secondary'} onClick={toggleStereoSimulation}>
            Stereo sim {stereoSimulationEnabled.value ? 'on' : 'off'}
          </Button>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <RoomOrthographicView
          label="Top"
          horizontalAxisLabel="X"
          verticalAxisLabel="Z"
          axes={TOP_VIEW_AXES}
          boxes={boxes}
          selectedBoxIds={selectedBoxIds.value}
          source={sourcePosition.value}
          listener={listenerPosition.value}
          activeTool={activeTool}
          snapEnabled={snapToAlignmentEnabled.value}
          onSelectBox={selectSingleBox}
          onToggleBoxSelection={toggleBoxSelection}
          onMarqueeSelect={selectBoxesInRect}
          onMoveSelectedBoxes={(deltaHorizontal, deltaVertical) => moveSelectedBoxes(TOP_VIEW_AXES, deltaHorizontal, deltaVertical)}
          onResizeBox={(boxId, handle, point) => resizeBox(boxId, TOP_VIEW_AXES, handle, point)}
          onCreateBox={(start, end) => createBoxFromCanvasDrag(TOP_VIEW_AXES, start, end)}
          onMoveSource={point => moveSourceOnAxes(TOP_VIEW_AXES, point)}
          onMoveListener={point => moveListenerOnAxes(TOP_VIEW_AXES, point)}
        />
        <RoomOrthographicView
          label="Front"
          horizontalAxisLabel="X"
          verticalAxisLabel="Y"
          axes={FRONT_VIEW_AXES}
          boxes={boxes}
          selectedBoxIds={selectedBoxIds.value}
          source={sourcePosition.value}
          listener={listenerPosition.value}
          activeTool={activeTool}
          snapEnabled={snapToAlignmentEnabled.value}
          onSelectBox={selectSingleBox}
          onToggleBoxSelection={toggleBoxSelection}
          onMarqueeSelect={selectBoxesInRect}
          onMoveSelectedBoxes={(deltaHorizontal, deltaVertical) => moveSelectedBoxes(FRONT_VIEW_AXES, deltaHorizontal, deltaVertical)}
          onResizeBox={(boxId, handle, point) => resizeBox(boxId, FRONT_VIEW_AXES, handle, point)}
          onCreateBox={(start, end) => createBoxFromCanvasDrag(FRONT_VIEW_AXES, start, end)}
          onMoveSource={point => moveSourceOnAxes(FRONT_VIEW_AXES, point)}
          onMoveListener={point => moveListenerOnAxes(FRONT_VIEW_AXES, point)}
        />
        <RoomOrthographicView
          label="Side"
          horizontalAxisLabel="Z"
          verticalAxisLabel="Y"
          axes={SIDE_VIEW_AXES}
          boxes={boxes}
          selectedBoxIds={selectedBoxIds.value}
          source={sourcePosition.value}
          listener={listenerPosition.value}
          activeTool={activeTool}
          snapEnabled={snapToAlignmentEnabled.value}
          onSelectBox={selectSingleBox}
          onToggleBoxSelection={toggleBoxSelection}
          onMarqueeSelect={selectBoxesInRect}
          onMoveSelectedBoxes={(deltaHorizontal, deltaVertical) => moveSelectedBoxes(SIDE_VIEW_AXES, deltaHorizontal, deltaVertical)}
          onResizeBox={(boxId, handle, point) => resizeBox(boxId, SIDE_VIEW_AXES, handle, point)}
          onCreateBox={(start, end) => createBoxFromCanvasDrag(SIDE_VIEW_AXES, start, end)}
          onMoveSource={point => moveSourceOnAxes(SIDE_VIEW_AXES, point)}
          onMoveListener={point => moveListenerOnAxes(SIDE_VIEW_AXES, point)}
        />
      </div>

      <div class="rounded-lg border border-border-subtle bg-surface-overlay p-4">
        <SelectedBoxInspector />
      </div>
    </Card>
  );
}
