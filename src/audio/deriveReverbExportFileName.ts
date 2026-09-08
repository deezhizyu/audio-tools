import type { ExportAudioFormat } from './types';

export function deriveReverbExportFileName(originalFileName: string, format: ExportAudioFormat): string {
  const baseName = originalFileName.replace(/\.[^./\\]+$/, '');
  return `${baseName}-with-reverb.${format}`;
}
