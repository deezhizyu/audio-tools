import { signal } from '@preact/signals';
import { buildAudioBufferFromChannels } from '../audio/buildAudioBufferFromChannels';
import { convolveWithImpulseResponse } from '../audio/convolveWithImpulseResponse';
import { decodeAudioFile } from '../audio/decodeAudioFile';
import { deriveReverbExportFileName } from '../audio/deriveReverbExportFileName';
import { encodeMp3 } from '../audio/encodeMp3';
import { encodeWav } from '../audio/encodeWav';
import {
  createBoxFromDrag,
  moveBoxOnAxes,
  resizeBoxOnAxes,
  type OrthographicAxes,
  type Point2D,
  type ResizeHandle,
} from '../audio/room/roomEditorGeometry';
import { parseRoomScene, serializeRoomScene } from '../audio/room/roomFileFormat';
import { DEFAULT_ABSORBER_MATERIAL_ID, DEFAULT_OBJECT_MATERIAL_ID, getRoomMaterial } from '../audio/room/roomMaterials';
import type { RoomBox, RoomBoxKind, RoomMaterialId, RoomPoint3D, RoomScene } from '../audio/room/roomTypes';
import { SimpleAudioPlaybackController } from '../audio/SimpleAudioPlaybackController';
import type { ExportAudioFormat } from '../audio/types';
import { RoomAcousticsWorkerClient } from '../audio/worker/RoomAcousticsWorkerClient';
import type { SimulationQuality } from '../audio/worker/roomAcousticsWorkerMessages';
import type { RoomEditorTool } from '../components/room/RoomOrthographicView';
import { downloadBlob } from '../utils/downloadBlob';

/** Long enough that a continuous box drag only triggers one full-quality re-simulation per pause, short enough
    that the accurate result still feels responsive once the edit that caused it stops. Every edit also
    triggers an immediate `INTERACTIVE_RAY_TRACING_PARAMS` preview pass (see `triggerInteractivePreview`),
    which is what actually keeps audio live while dragging — this debounce is only about when the accurate,
    full-quality pass replaces that preview. */
const RESIMULATE_DEBOUNCE_MILLISECONDS = 250;

// --- Room geometry signals — independent of the loaded audio file, so nothing that touches audio ever needs
//     to (and never does) reset these. -------------------------------------------------------------------

export const roomBoxes = signal<RoomBox[]>([]);
export const sourcePosition = signal<RoomPoint3D>({ x: -2, y: 1.5, z: 0 });
export const listenerPosition = signal<RoomPoint3D>({ x: 2, y: 1.5, z: 0 });
export const selectedBoxIds = signal<ReadonlySet<string>>(new Set());
export const activeRoomEditorTool = signal<RoomEditorTool>('select');
/** Whether dragging a box/source/listener snaps to nearby object edges, their centers, and the origin axes
    (see `computeBoxMoveSnapOffset`/`snapPointToCandidates` in `roomEditorGeometry.ts`). Purely an editor
    convenience — it never affects the drawn room's saved geometry beyond where a drag happens to land. */
export const snapToAlignmentEnabled = signal(true);
/** Whether reflections are panned left/right by direction (Steam Audio's constant-power stereo pan law — see
    `stereoPanning.ts`) instead of landing centered on both channels. On by default: it's what makes a room
    with a source and listener on opposite sides actually sound like it has a left and a right. Editor-only,
    like `snapToAlignmentEnabled` — it's not part of a saved room's geometry, so it isn't serialized by
    `saveRoomToFile`/`importRoomFromFile`. */
export const stereoSimulationEnabled = signal(true);

// --- Audio signals — independent of the drawn room, so loading/replacing a file never touches the signals
//     above. -----------------------------------------------------------------------------------------------

export const uploadedAudioFileName = signal<string | null>(null);
export const isSimulatingReverb = signal(false);
/** Whether at least one simulation has finished for the currently loaded audio file — lets the status line
    always render one of "Simulating…" / "Simulated" instead of appearing and disappearing, which was causing
    the page to visibly jump on every room edit. */
export const hasCompletedSimulation = signal(false);
export const reverbErrorMessage = signal<string | null>(null);
export const isPlaybackPlaying = signal(false);
export const playbackCurrentTimeSeconds = signal(0);
export const playbackDurationSeconds = signal(0);
export const exportFormat = signal<ExportAudioFormat>('wav');
export const isExportingAudio = signal(false);

let dryChannelData: Float32Array<ArrayBuffer>[] = [];
let drySampleRate = 0;
/** The latest simulated room's impulse response — always at `drySampleRate` (the room-acoustics worker
    synthesizes it at whatever rate it's asked for). Live preview plays it through a `ConvolverNode` as soon
    as it's ready (see `startLivePlaybackFromLatestSimulation`); exporting instead feeds it to
    `convolveWithImpulseResponse.ts` to render the complete dry file offline, once, at export time. */
let latestImpulseResponseChannelData: Float32Array<ArrayBuffer>[] = [];
let activePlaybackController: SimpleAudioPlaybackController | null = null;
let activeWorkerClient: RoomAcousticsWorkerClient | null = null;
let resimulateTimeoutId: ReturnType<typeof setTimeout> | null = null;
/** Bumped on every simulation start (either quality); a still-running simulation whose token has been
    superseded by a newer one — interactive or full, doesn't matter which — discards its result instead of
    overwriting the newer one that may finish first. */
let resimulateRequestToken = 0;
/** Coalesces `triggerInteractivePreview` calls: at most one interactive-quality simulation runs at a time, no
    matter how many edits arrive while it's in flight (a continuous drag fires this on every pointer-move). */
let interactiveSimulationInFlight = false;
/** Set when an edit arrives while an interactive pass is already running, so that pass's completion kicks off
    exactly one more covering the latest scene, instead of either dropping the edit or queuing one call per
    pointer-move. */
let interactiveSimulationSceneChangedSinceStart = false;

function currentScene(): RoomScene {
  return { boxes: roomBoxes.value, source: sourcePosition.value, listener: listenerPosition.value };
}

/** Runs a fast, rough `INTERACTIVE_RAY_TRACING_PARAMS` pass immediately on every edit — this, not the
    debounced full-quality pass below, is what makes dragging a box or the listener update the sound live
    instead of only after the drag stops. Self-throttling: a drag firing this many times per second still only
    ever has one interactive simulation in flight, always covering whatever the scene looked like most
    recently rather than working through a backlog of stale ones. */
function triggerInteractivePreview(): void {
  if (interactiveSimulationInFlight) {
    interactiveSimulationSceneChangedSinceStart = true;
    return;
  }

  interactiveSimulationInFlight = true;
  interactiveSimulationSceneChangedSinceStart = false;
  void runSimulation('interactive').finally(() => {
    interactiveSimulationInFlight = false;
    if (interactiveSimulationSceneChangedSinceStart) triggerInteractivePreview();
  });
}

function scheduleResimulate(): void {
  triggerInteractivePreview();

  if (resimulateTimeoutId !== null) clearTimeout(resimulateTimeoutId);
  resimulateTimeoutId = setTimeout(() => {
    resimulateTimeoutId = null;
    void runSimulation('full');
  }, RESIMULATE_DEBOUNCE_MILLISECONDS);
}

/** If an edit's debounced full-quality resimulation hasn't fired yet, runs it immediately and waits for it —
    so an export started right after an edit renders that edit's room at full quality, not whatever interactive
    preview happened to be latest when Download was clicked. Doesn't wait for an already-in-flight simulation
    (ray tracing is fast enough, and bounded by `MAXIMUM_BOUNCES`/`NUMBER_OF_RAYS`, that this window is
    negligible), only a pending one. */
async function flushPendingResimulate(): Promise<void> {
  if (resimulateTimeoutId === null) return;
  clearTimeout(resimulateTimeoutId);
  resimulateTimeoutId = null;
  await runSimulation('full');
}

/** Reuses the same controller (and its `AudioContext`) across every resimulation instead of tearing one down
    and spinning up a new one — recreating a real-time `AudioContext` on every room edit was the main source of
    the "very laggy editing" feel, since setting up an actual audio output stream is comparatively expensive
    and was happening on every debounced edit rather than only when it was actually needed.
    Plays the dry audio through a live `ConvolverNode` fed the just-simulated impulse response, rather than
    waiting for `convolveWithImpulseResponse.ts` to render the whole file offline first — listening can start
    (or keep going, through a room edit) the instant ray tracing finishes, however long the dry file is. The
    full offline render is reserved for `exportReverbAudio`, where exact rendered samples are actually needed. */
function startLivePlaybackFromLatestSimulation(): void {
  const wasPlaying = isPlaybackPlaying.value;
  const resumeFromSeconds = playbackCurrentTimeSeconds.value;
  const dryAudioBuffer = buildAudioBufferFromChannels(dryChannelData, drySampleRate);
  const impulseResponseAudioBuffer = buildAudioBufferFromChannels(latestImpulseResponseChannelData, drySampleRate);

  if (activePlaybackController) {
    activePlaybackController.setBuffers(dryAudioBuffer, impulseResponseAudioBuffer);
  } else {
    const controller = new SimpleAudioPlaybackController(dryAudioBuffer, impulseResponseAudioBuffer);
    controller.onTimeUpdate = seconds => {
      playbackCurrentTimeSeconds.value = seconds;
    };
    controller.onPlaybackStateChange = playing => {
      isPlaybackPlaying.value = playing;
    };
    activePlaybackController = controller;
  }
  playbackDurationSeconds.value = activePlaybackController.durationSeconds;

  // Mirrors PreviewPlaybackController's behavior on a config change: if the user was already listening, an
  // edit updates what they hear in place rather than silently stopping playback.
  if (wasPlaying) activePlaybackController.play(Math.min(resumeFromSeconds, activePlaybackController.durationSeconds));
}

/** `quality: 'interactive'` runs a fast, rough preview pass and only ever updates what's audible — it never
    touches `isSimulatingReverb`/`hasCompletedSimulation`/`reverbErrorMessage`, so the "Simulating…"/"Simulated"
    status line reflects the accurate full-quality pass, not the many quick previews a drag fires per second.
    A failed interactive pass fails silently for the same reason: the debounced full pass that follows it will
    surface a real error if the room genuinely can't be simulated. */
async function runSimulation(quality: SimulationQuality): Promise<void> {
  if (dryChannelData.length === 0 || drySampleRate === 0) return;

  const requestToken = ++resimulateRequestToken;
  if (quality === 'full') {
    isSimulatingReverb.value = true;
    reverbErrorMessage.value = null;
  }

  try {
    if (!activeWorkerClient) activeWorkerClient = new RoomAcousticsWorkerClient();
    const { impulseResponseChannelData } = await activeWorkerClient.simulate(currentScene(), drySampleRate, stereoSimulationEnabled.value, quality);
    if (requestToken !== resimulateRequestToken) return;

    latestImpulseResponseChannelData = impulseResponseChannelData;
    startLivePlaybackFromLatestSimulation();
    if (quality === 'full') hasCompletedSimulation.value = true;
  } catch (caughtError) {
    if (quality === 'full' && requestToken === resimulateRequestToken) {
      reverbErrorMessage.value = caughtError instanceof Error ? caughtError.message : 'Could not simulate this room.';
    }
  } finally {
    if (quality === 'full' && requestToken === resimulateRequestToken) isSimulatingReverb.value = false;
  }
}

/** Used for both the first upload and "replace audio" — it only ever touches the audio signals above, never
    the room geometry signals, which is what makes replacing the audio leave the drawn room untouched. */
export async function loadDryAudioFile(file: File): Promise<void> {
  reverbErrorMessage.value = null;
  isSimulatingReverb.value = true;
  hasCompletedSimulation.value = false;
  // Paused (not disposed) — the controller and its AudioContext are reused for whatever the new file's
  // simulation produces, via `startLivePlaybackFromLatestSimulation`'s `setBuffers`.
  activePlaybackController?.pause();
  isPlaybackPlaying.value = false;
  playbackCurrentTimeSeconds.value = 0;
  playbackDurationSeconds.value = 0;

  try {
    const decoded = await decodeAudioFile(file);
    dryChannelData = decoded.channelData;
    drySampleRate = decoded.sampleRate;
    uploadedAudioFileName.value = file.name;
    await runSimulation('full');
  } catch (caughtError) {
    reverbErrorMessage.value = caughtError instanceof Error ? caughtError.message : 'Could not read this audio file.';
    uploadedAudioFileName.value = null;
    dryChannelData = [];
    drySampleRate = 0;
  } finally {
    isSimulatingReverb.value = false;
  }
}

function updateBoxes(updater: (boxes: RoomBox[]) => RoomBox[]): void {
  roomBoxes.value = updater(roomBoxes.value);
  scheduleResimulate();
}

/** Backs every batch mutation below (material, absorption band, texture intensity) — applies `updater` to
    every currently-selected box and leaves the rest untouched. Works identically whether one box or many are
    selected, so there's no separate single-vs-batch code path for these operations. */
function updateSelectedBoxes(updater: (box: RoomBox) => RoomBox): void {
  if (selectedBoxIds.value.size === 0) return;
  updateBoxes(boxes => boxes.map(box => (selectedBoxIds.value.has(box.id) ? updater(box) : box)));
}

export function createBoxFromCanvasDrag(axes: OrthographicAxes, startPoint: Point2D, endPoint: Point2D): void {
  const kind: RoomBoxKind = activeRoomEditorTool.value === 'add-absorber' ? 'absorber' : 'object';
  const materialId = kind === 'object' ? DEFAULT_OBJECT_MATERIAL_ID : DEFAULT_ABSORBER_MATERIAL_ID;
  const absorption = getRoomMaterial(materialId).absorption;
  const newBox = createBoxFromDrag(crypto.randomUUID(), kind, materialId, absorption, startPoint, endPoint, axes);

  updateBoxes(boxes => [...boxes, newBox]);
  selectedBoxIds.value = new Set([newBox.id]);
  activeRoomEditorTool.value = 'select';
}

export function moveSelectedBoxes(axes: OrthographicAxes, deltaHorizontal: number, deltaVertical: number): void {
  updateSelectedBoxes(box => moveBoxOnAxes(box, axes, deltaHorizontal, deltaVertical));
}

export function resizeBox(boxId: string, axes: OrthographicAxes, handle: ResizeHandle, point: Point2D): void {
  updateBoxes(boxes => boxes.map(box => (box.id === boxId ? resizeBoxOnAxes(box, axes, handle, point) : box)));
}

export function removeSelectedBoxes(): void {
  const ids = selectedBoxIds.value;
  if (ids.size === 0) return;
  updateBoxes(boxes => boxes.filter(box => !ids.has(box.id)));
  selectedBoxIds.value = new Set();
}

/** Replaces the whole selection with a single box (or clears it) — a plain click, or a plain click resolved
    via the click-through cycling algorithm in `RoomOrthographicView.tsx`. */
export function selectSingleBox(boxId: string | null): void {
  selectedBoxIds.value = boxId ? new Set([boxId]) : new Set();
}

/** Adds or removes one box from the selection without touching the rest — a Shift+click. */
export function toggleBoxSelection(boxId: string): void {
  const current = selectedBoxIds.value;
  const next = new Set(current);
  if (next.has(boxId)) next.delete(boxId);
  else next.add(boxId);
  selectedBoxIds.value = next;
}

/** Replaces the whole selection with the given ids — a marquee/rubber-band drag release. Always a
    replacement, not additive; there's no modifier for an additive marquee yet. */
export function selectBoxesInRect(boxIds: string[]): void {
  selectedBoxIds.value = new Set(boxIds);
}

export function setActiveRoomEditorTool(tool: RoomEditorTool): void {
  activeRoomEditorTool.value = tool;
}

export function toggleSnapToAlignment(): void {
  snapToAlignmentEnabled.value = !snapToAlignmentEnabled.value;
}

export function toggleStereoSimulation(): void {
  stereoSimulationEnabled.value = !stereoSimulationEnabled.value;
  scheduleResimulate();
}

export function updateSelectedBoxesAbsorptionBand(band: 'low' | 'mid' | 'high', value: number): void {
  updateSelectedBoxes(box => ({ ...box, absorption: { ...box.absorption, [band]: value } }));
}

const MINIMUM_TEXTURE_INTENSITY = 0;
const MAXIMUM_TEXTURE_INTENSITY = 2;

/** Sets `materialId` and prefills `absorption` from that material's baseline values on every selected box —
    the material picker's "editable starting point" behavior. Deliberately leaves `textureIntensity` alone, so
    a user's dialed-in roughness for a box survives switching its material. */
export function updateSelectedBoxesMaterial(materialId: RoomMaterialId): void {
  const material = getRoomMaterial(materialId);
  updateSelectedBoxes(box => ({ ...box, materialId, absorption: material.absorption }));
}

export function updateSelectedBoxesTextureIntensity(value: number): void {
  const clamped = Math.min(MAXIMUM_TEXTURE_INTENSITY, Math.max(MINIMUM_TEXTURE_INTENSITY, value));
  updateSelectedBoxes(box => ({ ...box, textureIntensity: clamped }));
}

export function updateSelectedBoxField(boxId: string, field: 'x' | 'y' | 'z' | 'width' | 'height' | 'depth', value: number): void {
  updateBoxes(boxes => boxes.map(box => (box.id === boxId ? { ...box, [field]: value } : box)));
}

export function moveSourceOnAxes(axes: OrthographicAxes, point: Point2D): void {
  sourcePosition.value = { ...sourcePosition.value, [axes.horizontal]: point.horizontal, [axes.vertical]: point.vertical };
  scheduleResimulate();
}

export function moveListenerOnAxes(axes: OrthographicAxes, point: Point2D): void {
  listenerPosition.value = { ...listenerPosition.value, [axes.horizontal]: point.horizontal, [axes.vertical]: point.vertical };
  scheduleResimulate();
}

export function togglePlayback(): void {
  if (!activePlaybackController) return;
  if (isPlaybackPlaying.value) {
    activePlaybackController.pause();
  } else {
    activePlaybackController.play();
  }
}

export function restartPlayback(): void {
  activePlaybackController?.restart();
}

export function setExportFormat(format: ExportAudioFormat): void {
  exportFormat.value = format;
}

/** Renders the complete dry file against the current room's impulse response via `convolveWithImpulseResponse.ts`'s
    `OfflineAudioContext` — full length, full precision — rather than reusing whatever live preview happens to
    have played through its `ConvolverNode` so far. Live preview only ever plays; it never produces an actual
    rendered sample buffer, so this is the one place that does. */
export async function exportReverbAudio(): Promise<void> {
  const fileName = uploadedAudioFileName.value;
  if (!fileName || dryChannelData.length === 0) return;

  isExportingAudio.value = true;
  reverbErrorMessage.value = null;
  try {
    await flushPendingResimulate();
    if (latestImpulseResponseChannelData.length === 0) return;

    const { channelData, sampleRate } = await convolveWithImpulseResponse(dryChannelData, drySampleRate, latestImpulseResponseChannelData);
    const blob = exportFormat.value === 'mp3' ? await encodeMp3(channelData, sampleRate) : encodeWav(channelData, sampleRate);
    downloadBlob(blob, deriveReverbExportFileName(fileName, exportFormat.value));
  } catch (caughtError) {
    reverbErrorMessage.value = caughtError instanceof Error ? caughtError.message : 'Could not export this audio file.';
  } finally {
    isExportingAudio.value = false;
  }
}

/** Replaces only the room geometry signals — symmetric with `loadDryAudioFile`, so importing a saved room
    never clears whatever audio file is currently loaded. */
export async function importRoomFromFile(file: File): Promise<void> {
  try {
    const scene = parseRoomScene(await file.text());
    roomBoxes.value = scene.boxes;
    sourcePosition.value = scene.source;
    listenerPosition.value = scene.listener;
    selectedBoxIds.value = new Set();
    reverbErrorMessage.value = null;
    scheduleResimulate();
  } catch (caughtError) {
    reverbErrorMessage.value = caughtError instanceof Error ? caughtError.message : 'Could not read this room file.';
  }
}

export function saveRoomToFile(): void {
  downloadBlob(new Blob([serializeRoomScene(currentScene())], { type: 'application/json' }), 'room.json');
}
