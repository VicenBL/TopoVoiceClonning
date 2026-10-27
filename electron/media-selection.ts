import { basename } from 'node:path';

import { MEDIA_CHANNELS, type SelectedMediaFile } from './media-contract.ts';
import type { MediaPreparationController } from './media-preparation.ts';
import { validateTrimRequest, type MediaTrimmingController } from './media-trimming.ts';
import { validateExportId, type MediaExportController } from './media-exporting.ts';

export interface MediaIpcMainAdapter {
  handle(channel: string, listener: (...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
}

export interface MediaDialogAdapter {
  showOpenDialog(owner: unknown, options: {
    title: string;
    properties: ['openFile'];
    filters: Array<{ name: string; extensions: string[] }>;
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
}

interface MediaIpcEvent {
  sender?: { id?: number };
  senderFrame?: { url?: string };
}

const dialogOptions = {
  title: 'Seleccionar archivo de audio o vídeo',
  properties: ['openFile'] as ['openFile'],
  filters: [{
    name: 'Audio y vídeo',
    extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'wma', 'mp4', 'mov', 'mkv', 'webm', 'avi'],
  }],
};

export function registerMediaSelectionIpc(
  ipcMain: MediaIpcMainAdapter,
  dialog: MediaDialogAdapter,
  getOwner: () => unknown,
  isTrustedSender: (event: MediaIpcEvent) => boolean,
  preparation?: MediaPreparationController,
  trimming?: MediaTrimmingController,
  exporting?: MediaExportController,
): () => void {
  let selectedName = '';
  let pending: Promise<SelectedMediaFile | null> | null = null;
  ipcMain.handle(MEDIA_CHANNELS.select, async (rawEvent, ...args) => {
    if (!rawEvent || typeof rawEvent !== 'object' || !isTrustedSender(rawEvent as MediaIpcEvent)) {
      throw new Error('Emisor IPC no autorizado.');
    }
    if (args.length !== 0) throw new Error('Argumentos IPC no permitidos.');
    if (pending) return pending;

    pending = dialog.showOpenDialog(getOwner(), dialogOptions).then(async result => {
      const path = result.filePaths[0];
      if (result.canceled || !path) return null;
      await exporting?.reset();
      await trimming?.reset();
      await preparation?.select(path);
      selectedName = basename(path);
      return { name: basename(path), path };
    }).finally(() => { pending = null; });
    return pending;
  });
  if (preparation) {
    ipcMain.handle(MEDIA_CHANNELS.prepareSelected, async (rawEvent, ...args) => {
      if (!rawEvent || typeof rawEvent !== 'object' || !isTrustedSender(rawEvent as MediaIpcEvent)) {
        throw new Error('Emisor IPC no autorizado.');
      }
      if (args.length !== 0) throw new Error('Argumentos IPC no permitidos.');
      return preparation.prepare();
    });
  }
  if (trimming) {
    ipcMain.handle(MEDIA_CHANNELS.trimSelected, async (rawEvent, ...args) => {
      if (!rawEvent || typeof rawEvent !== 'object' || !isTrustedSender(rawEvent as MediaIpcEvent)) {
        throw new Error('Emisor IPC no autorizado.');
      }
      if (args.length !== 1) throw new Error('Argumentos IPC no permitidos.');
      const request = validateTrimRequest(args[0]);
      return exporting ? exporting.trackTrim(() => trimming.trim(request), selectedName) : trimming.trim(request);
    });
  }
  if (exporting) {
    ipcMain.handle(MEDIA_CHANNELS.saveWav, async (rawEvent, ...args) => {
      if (!rawEvent || typeof rawEvent !== 'object' || !isTrustedSender(rawEvent as MediaIpcEvent)) throw new Error('Emisor IPC no autorizado.');
      if (args.length !== 1) throw new Error('Argumentos IPC no permitidos.');
      return exporting.save(validateExportId(args[0]));
    });
  }
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    ipcMain.removeHandler(MEDIA_CHANNELS.select);
    if (preparation) ipcMain.removeHandler(MEDIA_CHANNELS.prepareSelected);
    if (trimming) ipcMain.removeHandler(MEDIA_CHANNELS.trimSelected);
    if (exporting) ipcMain.removeHandler(MEDIA_CHANNELS.saveWav);
  };
}
