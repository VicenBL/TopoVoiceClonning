import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MEDIA_CHANNELS } from './media-contract.ts';
import { registerMediaSelectionIpc } from './media-selection.ts';
import { createMediaBridge } from './preload-bridge.ts';
import type { MediaPreparationController } from './media-preparation.ts';
import type { MediaTrimmingController } from './media-trimming.ts';

test('IPC recorte: solo origen confiable, payload cerrado y ningún argumento/ruta adicional', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const removed: string[] = [];
  let calls = 0;
  const order: string[] = [];
  const prepared = { url: 'file:///owned/prepared.wav', durationSec: 5 };
  const prep = { select: async () => { order.push('select'); }, prepare: async () => prepared } as unknown as MediaPreparationController;
  const trim = { trim: async (request: unknown) => { calls++; return request; }, reset: async () => { order.push('reset'); } } as unknown as MediaTrimmingController;
  const unregister = registerMediaSelectionIpc({ handle: (name, handler) => { handlers.set(name, handler); }, removeHandler: name => { removed.push(name); } }, { showOpenDialog: async () => ({ canceled: false, filePaths: ['C:\\audio.wav'] }) }, () => ({}), event => event.sender?.id === 42, prep, trim);
  const handler = handlers.get(MEDIA_CHANNELS.trimSelected)!;
  assert.equal(typeof handler, 'function');
  const request = { sourceUrl: prepared.url, startSec: 1, endSec: 2 };
  for (const args of [ [{ sender: { id: 9 } }, request], [{ sender: { id: 42 } }, request, 'extra'], [{ sender: { id: 42 } }, { ...request, path: 'C:\\forbidden.wav' }], [{ sender: { id: 42 } }, { ...request, startSec: '1' }], [{ sender: { id: 42 } }, null] ]) {
    await assert.rejects(async () => handler(...args), /autorizado|Argumentos|intervalo/i);
  }
  assert.equal(calls, 0);
  assert.deepEqual(await handler({ sender: { id: 42 } }, request), request);
  assert.equal(calls, 1);
  await handlers.get(MEDIA_CHANNELS.select)!({ sender: { id: 42 } });
  assert.deepEqual(order, ['reset', 'select']);
  // Existing preparation remains argument-free and returns the same authorized source.
  assert.deepEqual(await handlers.get(MEDIA_CHANNELS.prepareSelected)!({ sender: { id: 42 } }), prepared);
  await assert.rejects(async () => handlers.get(MEDIA_CHANNELS.prepareSelected)!({ sender: { id: 42 } }, request), /Argumentos/);
  unregister();
  assert.ok(removed.includes(MEDIA_CHANNELS.trimSelected));
});

test('cancelar selector conserva fragmentos y preload transmite solo los tiempos/identidad del preparado', async () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  let resets = 0;
  registerMediaSelectionIpc({ handle: (name, handler) => { handlers.set(name, handler); }, removeHandler: () => {} }, { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }, () => ({}), () => true, undefined, { reset: async () => { resets++; } } as unknown as MediaTrimmingController);
  assert.equal(await handlers.get(MEDIA_CHANNELS.select)!({}), null);
  assert.equal(resets, 0);
  const calls: unknown[] = [];
  const bridge = createMediaBridge({ invoke: async (...args) => { calls.push(args); }, on: () => {}, removeListener: () => {} });
  const request = { sourceUrl: 'file:///owned/prepared.wav', startSec: 0, endSec: 1 };
  await bridge.trimSelected(request);
  assert.deepEqual(calls, [[MEDIA_CHANNELS.trimSelected, request]]);
});
