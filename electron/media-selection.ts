import { basename } from 'node:path';

import { MEDIA_CHANNELS, type SelectedMediaFile } from './media-contract.ts';

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
): () => void {
  let pending: Promise<SelectedMediaFile | null> | null = null;
  ipcMain.handle(MEDIA_CHANNELS.select, async (rawEvent, ...args) => {
    if (!rawEvent || typeof rawEvent !== 'object' || !isTrustedSender(rawEvent as MediaIpcEvent)) {
      throw new Error('Emisor IPC no autorizado.');
    }
    if (args.length !== 0) throw new Error('Argumentos IPC no permitidos.');
    if (pending) return pending;

    pending = dialog.showOpenDialog(getOwner(), dialogOptions).then(result => {
      const path = result.filePaths[0];
      return result.canceled || !path ? null : { name: basename(path), path };
    }).finally(() => { pending = null; });
    return pending;
  });
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    ipcMain.removeHandler(MEDIA_CHANNELS.select);
  };
}
