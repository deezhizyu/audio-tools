import type { JSX } from 'preact';
import type { RoomBox } from '../../audio/room/roomTypes';
import {
  activeRoomEditorTool,
  createBoxFromCanvasDrag,
  listenerPosition,
  moveBox,
  moveListenerOnAxes,
  moveSourceOnAxes,
  removeSelectedBox,
  resizeBox,
  roomBoxes,
  selectBox,
  selectedBoxId,
  setActiveRoomEditorTool,
  sourcePosition,
  updateSelectedBoxAbsorption,
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
  { tool: 'add-wall', label: 'Draw wall' },
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

function NumberField({
  label,
  value,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
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
        <input type="number" step={step} value={value} onInput={handleInput} class="w-full bg-transparent font-mono text-xs text-text-primary outline-none" />
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

function SelectedBoxInspector() {
  const box = roomBoxes.value.find(candidate => candidate.id === selectedBoxId.value);
  if (!box) {
    return <p class="text-xs text-text-tertiary">Select a box to edit its exact position, size, and absorption.</p>;
  }

  return (
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <span class="text-xs font-medium uppercase tracking-wide text-text-secondary">{box.kind === 'wall' ? 'Wall' : 'Absorber'}</span>
        <Button variant="ghost" onClick={removeSelectedBox}>
          Delete
        </Button>
      </div>

      <div class="grid grid-cols-3 gap-3">
        {POSITION_FIELDS.map(({ field, label }) => (
          <DistanceField key={field} label={label} meters={box[field]} onChangeMeters={meters => updateSelectedBoxField(field, meters)} />
        ))}
      </div>

      <div class="grid grid-cols-3 gap-3">
        {SIZE_FIELDS.map(({ field, label }) => (
          <DistanceField key={field} label={label} meters={box[field]} onChangeMeters={meters => updateSelectedBoxField(field, meters)} />
        ))}
      </div>

      {box.kind === 'wall' && (
        <div>
          <p class="mb-2 text-xs text-text-tertiary">Absorption (0 = fully reflective, 1 = fully absorbed)</p>
          <div class="grid grid-cols-3 gap-3">
            {ABSORPTION_BANDS.map(({ band, label }) => (
              <NumberField
                key={band}
                label={label}
                step={0.05}
                value={box.absorption[band]}
                onChange={value => updateSelectedBoxAbsorption({ ...box.absorption, [band]: Math.min(1, Math.max(0, value)) })}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
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
              Draw walls and absorbers, then place the <span class="text-accent">source</span> and{' '}
              <span class="text-text-primary">listener</span> dots.
            </>
          }
        />
        <div class="flex flex-wrap gap-2">
          {TOOL_OPTIONS.map(({ tool, label }) => (
            <Button key={tool} variant={activeTool === tool ? 'primary' : 'secondary'} onClick={() => setActiveRoomEditorTool(tool)}>
              {label}
            </Button>
          ))}
        </div>
      </div>

      <div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <RoomOrthographicView
          label="Top"
          horizontalAxisLabel="X"
          verticalAxisLabel="Z"
          axes={TOP_VIEW_AXES}
          boxes={boxes}
          selectedBoxId={selectedBoxId.value}
          source={sourcePosition.value}
          listener={listenerPosition.value}
          activeTool={activeTool}
          onSelectBox={selectBox}
          onMoveBox={(boxId, deltaHorizontal, deltaVertical) => moveBox(boxId, TOP_VIEW_AXES, deltaHorizontal, deltaVertical)}
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
          selectedBoxId={selectedBoxId.value}
          source={sourcePosition.value}
          listener={listenerPosition.value}
          activeTool={activeTool}
          onSelectBox={selectBox}
          onMoveBox={(boxId, deltaHorizontal, deltaVertical) => moveBox(boxId, FRONT_VIEW_AXES, deltaHorizontal, deltaVertical)}
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
          selectedBoxId={selectedBoxId.value}
          source={sourcePosition.value}
          listener={listenerPosition.value}
          activeTool={activeTool}
          onSelectBox={selectBox}
          onMoveBox={(boxId, deltaHorizontal, deltaVertical) => moveBox(boxId, SIDE_VIEW_AXES, deltaHorizontal, deltaVertical)}
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
