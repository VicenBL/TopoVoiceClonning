import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MEDIA_CHANNELS } from './media-contract.ts';
import { reduceMediaSelection } from '../src/media-selection.ts';
import { assertMediaSelectionTransitions } from '../src/media-selection.test.ts';
import { registerMediaSelectionIpc, type MediaDialogAdapter, type MediaIpcMainAdapter } from './media-selection.ts';

class FakeIpc implements MediaIpcMainAdapter {
  handlers = new Map<string, (...args: unknown[]) => unknown>();
  removed: string[] = [];
  handle(channel: string, listener: (...args: unknown[]) => unknown): void { this.handlers.set(channel, listener); }
  removeHandler(channel: string): void { this.removed.push(channel); this.handlers.delete(channel); }
}

function fixture(dialog: MediaDialogAdapter) {
  const ipc = new FakeIpc();
  const owner = {};
  let calls = 0;
  const unregister = registerMediaSelectionIpc(ipc, dialog, () => owner, event => {
    calls += 1;
    return event.sender?.id === 42 && event.senderFrame?.url === 'file:///app/index.html';
  });
  const invoke = ipc.handlers.get(MEDIA_CHANNELS.select)!;
  return { ipc, owner, invoke, unregister, calls: () => calls };
}

test('el selector devuelve una sola ruta y nombre mediante el diálogo con propietario', async () => {
  let receivedOwner: unknown;
  let receivedOptions: unknown;
  const app = fixture({ showOpenDialog: async (owner, options) => {
    receivedOwner = owner;
    receivedOptions = options;
    return { canceled: false, filePaths: ['C:\\media\\voice.mp4'] };
  } });
  assert.deepEqual(await app.invoke({ sender: { id: 42 }, senderFrame: { url: 'file:///app/index.html' } }), {
    name: 'voice.mp4', path: 'C:\\media\\voice.mp4',
  });
  assert.equal(receivedOwner, app.owner);
  assert.deepEqual(receivedOptions, {
    title: 'Seleccionar archivo de audio o vídeo',
    properties: ['openFile'],
    filters: [{ name: 'Audio y vídeo', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac', 'wma', 'mp4', 'mov', 'mkv', 'webm', 'avi'] }],
  });
});

test('rechaza emisores no confiables y argumentos antes de abrir el diálogo', async () => {
  let dialogs = 0;
  const app = fixture({ showOpenDialog: async () => { dialogs += 1; return { canceled: true, filePaths: [] }; } });
  await assert.rejects(() => app.invoke({ sender: { id: 7 }, senderFrame: { url: 'file:///app/index.html' } }), /Emisor IPC no autorizado\./);
  await assert.rejects(() => app.invoke({ sender: { id: 42 }, senderFrame: { url: 'file:///app/index.html' } }, 'C:\\malicious.mp3'), /Argumentos IPC no permitidos\./);
  assert.equal(dialogs, 0);
  assert.equal(app.calls(), 2);
});

test('cancelación devuelve null y fallo de diálogo se propaga', async () => {
  const canceled = fixture({ showOpenDialog: async () => ({ canceled: true, filePaths: [] }) });
  assert.equal(await canceled.invoke({ sender: { id: 42 }, senderFrame: { url: 'file:///app/index.html' } }), null);
  const failed = fixture({ showOpenDialog: async () => { throw new Error('dialog failed'); } });
  await assert.rejects(() => failed.invoke({ sender: { id: 42 }, senderFrame: { url: 'file:///app/index.html' } }), /dialog failed/);
});

test('selección, cancelación y fallo mantienen las transiciones esperadas en la interfaz', () => {
  assertMediaSelectionTransitions(reduceMediaSelection);
});

test('invocaciones concurrentes comparten un único diálogo', async () => {
  let resolveDialog!: (result: { canceled: boolean; filePaths: string[] }) => void;
  let dialogs = 0;
  const app = fixture({ showOpenDialog: () => { dialogs += 1; return new Promise(resolve => { resolveDialog = resolve; }); } });
  const event = { sender: { id: 42 }, senderFrame: { url: 'file:///app/index.html' } };
  const first = app.invoke(event);
  const second = app.invoke(event);
  assert.equal(dialogs, 1);
  resolveDialog({ canceled: true, filePaths: [] });
  assert.equal(await first, null);
  assert.equal(await second, null);
  app.unregister();
  assert.deepEqual(app.ipc.removed, [MEDIA_CHANNELS.select]);
});
