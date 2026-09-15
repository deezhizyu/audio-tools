import type { ComponentChildren, JSX } from 'preact';
import { getRoomMaterialsInGroup, type RoomMaterialGroup } from '../../audio/room/roomMaterials';
import type { RoomBox, RoomMaterialId } from '../../audio/room/roomTypes';
import { ROOM_PRESETS, type RoomPresetId } from '../../audio/room/roomPresets';
import {
  activeRoomEditorTool,
  activeRoomPresetId,
  applyRoomPreset,
  createBoxFromCanvasDrag,
  moveListenerOnAxes,
  moveSelectedBoxes,
  moveSourceOnAxes,
  removeSelectedBoxes,
  resizeBox,
  roomBoxes,
  roomListener,
  roomSource,
  selectBoxesInRect,
  selectedBoxIds,
  selectSingleBox,
  setActiveRoomEditorTool,
  setListenerCoordinate,
  setListenerMode,
  setListenerYaw,
  setSourceCoordinate,
  setSourceDirectivityEnabled,
  setSourceDirectivityNarrowness,
  setSourceYaw,
  snapToAlignmentEnabled,
  sourceDirectivityNarrowness,
  toggleBoxSelection,
  toggleSnapToAlignment,
  updateSelectedBoxesAbsorptionBand,
  updateSelectedBoxesMaterial,
  updateSelectedBoxesTextureIntensity,
  updateSelectedBoxField,
} from '../../state/roomReverbSignals';
import { centimetersToMeters, metersToCentimeters } from '../../utils/unitConversion';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { SectionHeading } from '../ui/SectionHeading';
import type { OrthographicAxes } from '../../audio/room/roomEditorGeometry';
import { RoomOrthographicView, type RoomEditorTool } from './RoomOrthographicView';

/** The three orthographic views, described once. Every handler a view needs follows from its axes, so
    listing them as data keeps one view from drifting away from the others — they were three near-identical
    fourteen-prop copies. */
const ORTHOGRAPHIC_VIEWS = [
  { label: 'Top', axes: { horizontal: 'x', vertical: 'z' }, horizontalAxisLabel: 'X', verticalAxisLabel: 'Z' },
  { label: 'Front', axes: { horizontal: 'x', vertical: 'y' }, horizontalAxisLabel: 'X', verticalAxisLabel: 'Y' },
  { label: 'Side', axes: { horizontal: 'z', vertical: 'y' }, horizontalAxisLabel: 'Z', verticalAxisLabel: 'Y' },
] as const satisfies readonly { label: string; axes: OrthographicAxes; horizontalAxisLabel: string; verticalAxisLabel: string }[];

const COORDINATE_AXES: { axis: 'x' | 'y' | 'z'; label: string }[] = [
  { axis: 'x', label: 'X' },
  { axis: 'y', label: 'Y (height)' },
  { axis: 'z', label: 'Z' },
];

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

/** Mirrors the catalog's own grouping (see `RoomMaterialGroup`), so adding a material is a change in one
    file rather than two. Purely a picker split — any material can still be applied to either an object or an
    absorber box. */
const MATERIAL_GROUPS: { group: RoomMaterialGroup; label: string }[] = [
  { group: 'hard', label: 'Hard surfaces' },
  { group: 'soft', label: 'Soft surfaces & furnishings' },
  { group: 'ground', label: 'Ground & outdoors' },
];

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
function RangeField({
  label,
  value,
  hint,
  maximum = 2,
  step = 0.1,
  onChange,
}: {
  label: string;
  value: number | null;
  hint?: string;
  maximum?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  const handleInput = (event: JSX.TargetedEvent<HTMLInputElement>) => {
    onChange(Number(event.currentTarget.value));
  };

  const decimalPlaces = step < 0.1 ? 2 : 1;
  return (
    <label class="flex flex-col gap-1 text-xs">
      <div class="flex items-center justify-between">
        <span class="text-text-tertiary">{label}</span>
        <span class="font-mono text-[10px] text-text-tertiary">{value === null ? 'Mixed' : value.toFixed(decimalPlaces)}</span>
      </div>
      <input type="range" min={0} max={maximum} step={step} value={value ?? 1} onInput={handleInput} class="w-full accent-accent" />
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
        {MATERIAL_GROUPS.map(({ group, label }) => (
          <optgroup key={group} label={label}>
            {getRoomMaterialsInGroup(group).map(material => (
              <option key={material.id} value={material.id}>
                {material.label}
              </option>
            ))}
          </optgroup>
        ))}
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

/** Starting points rather than fixtures: applying one replaces the whole scene, and the very next edit
    detaches from it (`activeRoomPresetId` goes null), because a preset that has been rearranged is no longer
    that preset. */
function PresetPicker() {
  const handleChange = (event: JSX.TargetedEvent<HTMLSelectElement>) => {
    if (event.currentTarget.value) applyRoomPreset(event.currentTarget.value as RoomPresetId);
  };

  const activeId = activeRoomPresetId.value;
  const activePreset = ROOM_PRESETS.find(preset => preset.id === activeId);

  return (
    <div class="flex flex-col gap-1">
      <select
        value={activeId ?? ''}
        onChange={handleChange}
        class="rounded-md border border-border-strong bg-surface-overlay px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
      >
        {activeId === null && (
          <option value="" disabled>
            Start from a preset…
          </option>
        )}
        {ROOM_PRESETS.map(preset => (
          <option key={preset.id} value={preset.id}>
            {preset.label}
          </option>
        ))}
      </select>
      {activePreset && <span class="max-w-64 text-[10px] leading-snug text-text-tertiary">{activePreset.description}</span>}
    </div>
  );
}

/** Two mutually exclusive choices shown as a pair of buttons — used for the source's radiation pattern and
    the listener's hearing, which are both genuinely binary and both worth showing rather than hiding behind a
    dropdown. */
function OptionToggle<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: { value: Value; label: string }[];
  onChange: (value: Value) => void;
}) {
  return (
    <div class="flex flex-col gap-1 text-xs">
      <span class="text-text-tertiary">{label}</span>
      <div class="flex rounded-md border border-border-strong bg-surface-overlay p-0.5">
        {options.map(option => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            class={`flex-1 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
              option.value === value ? 'bg-accent text-surface-base' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function YawField({ label, yawDegrees, onChange }: { label: string; yawDegrees: number; onChange: (yawDegrees: number) => void }) {
  return <NumberField label={label} value={Math.round(yawDegrees)} step={5} unit="°" onChange={onChange} />;
}

function MarkerPanel({ title, accent, children }: { title: string; accent?: boolean; children: ComponentChildren }) {
  return (
    <div class="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-overlay p-4">
      <span class={`text-xs font-medium uppercase tracking-wide ${accent ? 'text-accent' : 'text-text-secondary'}`}>{title}</span>
      {children}
    </div>
  );
}

function SourcePanel() {
  const source = roomSource.value;

  return (
    <MarkerPanel title="Source" accent>
      <div class="grid grid-cols-3 gap-3">
        {COORDINATE_AXES.map(({ axis, label }) => (
          <DistanceField key={axis} label={label} meters={source[axis]} onChangeMeters={meters => setSourceCoordinate(axis, meters)} />
        ))}
      </div>

      <OptionToggle
        label="Radiation"
        value={source.directivity.enabled ? 'directional' : 'all-sided'}
        options={[
          { value: 'all-sided', label: 'All-sided' },
          { value: 'directional', label: 'Directional' },
        ]}
        onChange={value => setSourceDirectivityEnabled(value === 'directional')}
      />

      {source.directivity.enabled && (
        <>
          <YawField label="Facing" yawDegrees={source.yawDegrees} onChange={setSourceYaw} />
          <RangeField
            label="Beam width"
            value={sourceDirectivityNarrowness(source)}
            maximum={1}
            step={0.05}
            hint="0 = radiates everywhere, 1 = a tight beam straight ahead"
            onChange={setSourceDirectivityNarrowness}
          />
        </>
      )}
    </MarkerPanel>
  );
}

function ListenerPanel() {
  const listener = roomListener.value;

  return (
    <MarkerPanel title="Listener">
      <div class="grid grid-cols-3 gap-3">
        {COORDINATE_AXES.map(({ axis, label }) => (
          <DistanceField key={axis} label={label} meters={listener[axis]} onChangeMeters={meters => setListenerCoordinate(axis, meters)} />
        ))}
      </div>

      <OptionToggle
        label="Hearing"
        value={listener.mode}
        options={[
          { value: 'binaural', label: 'Two ears' },
          { value: 'mono', label: 'Mono' },
        ]}
        onChange={setListenerMode}
      />

      {listener.mode === 'binaural' ? (
        <YawField label="Facing" yawDegrees={listener.yawDegrees} onChange={setListenerYaw} />
      ) : (
        <p class="text-[10px] leading-relaxed text-text-tertiary">
          A single omnidirectional capsule: both channels come out identical, and which way it points makes no difference.
        </p>
      )}
    </MarkerPanel>
  );
}

export function RoomEditor() {
  const boxes = roomBoxes.value;
  const activeTool = activeRoomEditorTool.value;
  const source = roomSource.value;
  const listener = roomListener.value;

  return (
    <Card class="flex flex-col gap-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <SectionHeading
          title="Room"
          description={
            <>
              Draw objects and absorbers, then place the <span class="text-accent">source</span> and{' '}
              <span class="text-text-primary">listener</span>. Drag either one's arrow in the Top view to turn it.
            </>
          }
        />
        <div class="flex flex-wrap items-start gap-2">
          <PresetPicker />
          <div class="mx-1 h-6 w-px bg-border-subtle" />
          {TOOL_OPTIONS.map(({ tool, label }) => (
            <Button key={tool} variant={activeTool === tool ? 'primary' : 'secondary'} onClick={() => setActiveRoomEditorTool(tool)}>
              {label}
            </Button>
          ))}
          <div class="mx-1 h-6 w-px bg-border-subtle" />
          <Button variant={snapToAlignmentEnabled.value ? 'primary' : 'secondary'} onClick={toggleSnapToAlignment}>
            Snap {snapToAlignmentEnabled.value ? 'on' : 'off'}
          </Button>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {ORTHOGRAPHIC_VIEWS.map(({ label, axes, horizontalAxisLabel, verticalAxisLabel }) => (
          <RoomOrthographicView
            key={label}
            label={label}
            horizontalAxisLabel={horizontalAxisLabel}
            verticalAxisLabel={verticalAxisLabel}
            axes={axes}
            boxes={boxes}
            selectedBoxIds={selectedBoxIds.value}
            source={source}
            listener={listener}
            activeTool={activeTool}
            snapEnabled={snapToAlignmentEnabled.value}
            onSelectBox={selectSingleBox}
            onToggleBoxSelection={toggleBoxSelection}
            onMarqueeSelect={selectBoxesInRect}
            onMoveSelectedBoxes={(deltaHorizontal, deltaVertical) => moveSelectedBoxes(axes, deltaHorizontal, deltaVertical)}
            onResizeBox={(boxId, handle, point) => resizeBox(boxId, axes, handle, point)}
            onCreateBox={(start, end) => createBoxFromCanvasDrag(axes, start, end)}
            onMoveSource={point => moveSourceOnAxes(axes, point)}
            onMoveListener={point => moveListenerOnAxes(axes, point)}
            onRotateSource={setSourceYaw}
            onRotateListener={setListenerYaw}
          />
        ))}
      </div>

      <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SourcePanel />
        <ListenerPanel />
      </div>

      <div class="rounded-lg border border-border-subtle bg-surface-overlay p-4">
        <SelectedBoxInspector />
      </div>
    </Card>
  );
}
