import { useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { Dropzone } from '../components/Dropzone';
import { PlaybackControls } from '../components/PlaybackControls';
import { RoomEditor } from '../components/room/RoomEditor';
import { RoomReverbHero } from '../components/RoomReverbHero';
import { Button } from '../components/ui/Button';
import { fadeUpEntranceStyle } from '../utils/fadeUpEntranceStyle';
import {
  exportFormat,
  exportReverbAudio,
  hasCompletedSimulation,
  importRoomFromFile,
  isExportingAudio,
  isPlaybackPlaying,
  isSimulatingReverb,
  loadDryAudioFile,
  playbackCurrentTimeSeconds,
  playbackDurationSeconds,
  restartPlayback,
  reverbErrorMessage,
  saveRoomToFile,
  setExportFormat,
  togglePlayback,
  uploadedAudioFileName,
} from '../state/roomReverbSignals';

const EXPORT_FORMATS = ['wav', 'mp3'] as const;

function handleAudioFilesSelected(files: File[]): void {
  const file = files[0];
  if (file) void loadDryAudioFile(file);
}

export function RoomReverbPage() {
  const roomFileInputRef = useRef<HTMLInputElement>(null);
  const fileName = uploadedAudioFileName.value;
  const isSimulating = isSimulatingReverb.value;
  const duration = playbackDurationSeconds.value;

  const handleRoomFileInputChange = (event: JSX.TargetedEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (file) void importRoomFromFile(file);
    event.currentTarget.value = '';
  };

  return (
    <main class="mx-auto max-w-5xl px-6 pb-10">
      <RoomReverbHero />

      <div class="flex flex-col gap-6">
        <div style={fadeUpEntranceStyle(0)} class="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-raised p-5">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="text-xs font-medium text-text-secondary">Dry audio</p>
              <p class="mt-0.5 truncate text-sm text-text-primary">{fileName ?? 'No file loaded yet'}</p>
            </div>
            <Dropzone
              onFilesSelected={handleAudioFilesSelected}
              heading={fileName ? 'Replace audio' : 'Drop dry audio here'}
              subtext="Swapping the file keeps your drawn room"
            />
          </div>

          {fileName && (
            <PlaybackControls
              isPlayingSignal={isPlaybackPlaying}
              currentTimeSecondsSignal={playbackCurrentTimeSeconds}
              processedDurationSecondsSignal={playbackDurationSeconds}
              durationSeconds={duration}
              onTogglePlayback={togglePlayback}
              onRestart={restartPlayback}
            />
          )}
          {fileName && (
            <p class="text-xs text-text-tertiary">{isSimulating ? "Simulating the room's acoustics…" : hasCompletedSimulation.value ? 'Simulated' : ''}</p>
          )}
          {reverbErrorMessage.value && <p class="text-xs text-danger">{reverbErrorMessage.value}</p>}
        </div>

        <div style={fadeUpEntranceStyle(1)}>
          <RoomEditor />
        </div>

        <div style={fadeUpEntranceStyle(2)} class="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-raised p-5">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div class="flex items-center gap-3">
              <Button variant="secondary" onClick={saveRoomToFile}>
                Save room
              </Button>
              <Button variant="secondary" onClick={() => roomFileInputRef.current?.click()}>
                Import room
              </Button>
              <input ref={roomFileInputRef} type="file" accept=".json,application/json" class="hidden" onChange={handleRoomFileInputChange} />
            </div>

            <div class="flex items-center gap-3">
              <span class="text-xs font-medium text-text-secondary">Format</span>
              <div class="flex rounded-md border border-border-strong bg-surface-overlay p-0.5">
                {EXPORT_FORMATS.map(format => (
                  <button
                    key={format}
                    type="button"
                    onClick={() => setExportFormat(format)}
                    class={`rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors ${
                      format === exportFormat.value ? 'bg-accent text-surface-base' : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    {format}
                  </button>
                ))}
              </div>
              <Button variant="primary" onClick={() => void exportReverbAudio()} disabled={isExportingAudio.value || !fileName}>
                {isExportingAudio.value ? 'Preparing download…' : 'Download'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
