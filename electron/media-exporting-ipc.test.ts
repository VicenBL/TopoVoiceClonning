import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MEDIA_CHANNELS } from './media-contract.ts';
import { registerMediaSelectionIpc } from './media-selection.ts';
import { createMediaBridge } from './preload-bridge.ts';
import type { MediaExportController } from './media-exporting.ts';
import type { MediaPreparationController } from './media-preparation.ts';
import type { MediaTrimmingController } from './media-trimming.ts';

test('IPC Guardar WAV solo acepta ID desde emisor confiable, nunca rutas ni argumentos extra', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const removed: string[] = [];
  const calls: unknown[] = [];
  const exporter = { save: async (id: unknown) => { calls.push(id); return { path: 'elegido.wav' }; } } as unknown as MediaExportController;
  const unregister = registerMediaSelectionIpc({ handle: (name, fn) => { handlers.set(name, fn); }, removeHandler: name => { removed.push(name); } }, { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }, () => ({}), event => event.sender?.id === 42, undefined, undefined, exporter);
  const save = handlers.get(MEDIA_CHANNELS.saveWav)!;
  assert.equal(typeof save, 'function');
  for (const args of [[{ sender: { id: 7 } }, 'clip-id'], [{ sender: { id: 42 } }], [{ sender: { id: 42 } }, 'clip-id', 'destino.wav'], [{ sender: { id: 42 } }, { id: 'clip-id', path: 'origen.wav' }], [{ sender: { id: 42 } }, '']]) {
    await assert.rejects(async () => save(...args), /autorizado|Argumentos|fragmento/i);
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(await save({ sender: { id: 42 } }, 'clip-id'), { path: 'elegido.wav' });
  assert.deepEqual(calls, ['clip-id']);
  unregister(); assert.ok(removed.includes(MEDIA_CHANNELS.saveWav));
  const invokes: unknown[] = [];
  const bridge = createMediaBridge({ invoke: async (...args) => { invokes.push(args); return null; }, on: () => {}, removeListener: () => {} });
  assert.equal(await bridge.saveWav('clip-id'), null);
  assert.deepEqual(invokes, [[MEDIA_CHANNELS.saveWav, 'clip-id']]);
});

test('exportación conserva selección/preparación/recorte previos y cancela antes de retirar la fuente', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const order: string[] = [];
  let canceled = false;
  const prepared = { url: 'file:///prepared.wav', durationSec: 4 };
  const request = { sourceUrl: prepared.url, startSec: 0, endSec: 1 };
  const clip = { ...request, id: 'id', url: 'file:///clip.wav', durationSec: 1 };
  const prep = { select: async () => { order.push('prepare-select'); }, prepare: async () => prepared } as unknown as MediaPreparationController;
  const trim = { reset: async () => { order.push('trim-reset'); }, trim: async () => clip } as unknown as MediaTrimmingController;
  const exporter = { reset: async () => { order.push('export-reset'); }, trackTrim: async (create: () => Promise<unknown>, name: string) => { order.push(name); return create(); } } as unknown as MediaExportController;
  registerMediaSelectionIpc({ handle: (name, fn) => { handlers.set(name, fn); }, removeHandler: () => {} }, { showOpenDialog: async () => ({ canceled, filePaths: ['original.mp4'] }) }, () => ({}), () => true, prep, trim, exporter);
  assert.deepEqual(await handlers.get(MEDIA_CHANNELS.select)!({}), { name: 'original.mp4', path: 'original.mp4' });
  assert.deepEqual(order, ['export-reset', 'trim-reset', 'prepare-select']);
  assert.deepEqual(await handlers.get(MEDIA_CHANNELS.prepareSelected)!({}), prepared);
  assert.deepEqual(await handlers.get(MEDIA_CHANNELS.trimSelected)!({}, request), clip);
  assert.equal(order.at(-1), 'original.mp4');
  const before = [...order]; canceled = true;
  assert.equal(await handlers.get(MEDIA_CHANNELS.select)!({}), null);
  assert.deepEqual(order, before);
  for (const channel of [MEDIA_CHANNELS.select, MEDIA_CHANNELS.prepareSelected]) await assert.rejects(async () => handlers.get(channel)!({}, { id: 'clip-id' }), /Argumentos/);
});
