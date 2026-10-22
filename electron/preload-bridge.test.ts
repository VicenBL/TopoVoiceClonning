import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createMediaBridge, createServiceBridge, type RendererIpcAdapter } from './preload-bridge.ts';
import { MEDIA_CHANNELS } from './media-contract.ts';
import { SERVICE_CHANNELS, type ServiceSnapshot } from './service-contract.ts';

class FakeRendererIpc implements RendererIpcAdapter {
  readonly invocations: Array<{ channel: string; payload?: unknown }> = [];
  readonly listeners = new Map<string, (...args: unknown[]) => void>();

  invoke(channel: string, payload?: unknown): Promise<unknown> {
    this.invocations.push({ channel, ...(payload === undefined ? {} : { payload }) });
    return Promise.resolve({ status: 'stopped', host: '127.0.0.1', port: 4317 });
  }

  on(channel: string, listener: (...args: unknown[]) => void): void {
    this.listeners.set(channel, listener);
  }

  removeListener(channel: string, listener: (...args: unknown[]) => void): void {
    if (this.listeners.get(channel) === listener) this.listeners.delete(channel);
  }
}

test('el puente del preload sólo expone las siete operaciones autorizadas', async () => {
  const ipc = new FakeRendererIpc();
  const bridge = createServiceBridge(ipc);

  assert.deepEqual(Object.keys(bridge).sort(), [
    'configure',
    'getDiagnostics',
    'getState',
    'onStateChange',
    'restart',
    'start',
    'stop',
  ]);

  const preferences = { port: 4317, autoStart: true, keepRunningOnClose: false };
  await bridge.getState();
  await bridge.configure(preferences);
  await bridge.start();
  await bridge.stop();
  await bridge.restart();
  await bridge.getDiagnostics();
  assert.deepEqual(ipc.invocations, [
    { channel: SERVICE_CHANNELS.getState },
    { channel: SERVICE_CHANNELS.configure, payload: preferences },
    { channel: SERVICE_CHANNELS.start },
    { channel: SERVICE_CHANNELS.stop },
    { channel: SERVICE_CHANNELS.restart },
    { channel: SERVICE_CHANNELS.getDiagnostics },
  ]);

  const received: ServiceSnapshot[] = [];
  const unsubscribe = bridge.onStateChange(snapshot => received.push(snapshot));
  const snapshot: ServiceSnapshot = { status: 'active', host: '127.0.0.1', port: 4317 };
  ipc.listeners.get(SERVICE_CHANNELS.stateChanged)?.({}, snapshot);
  assert.deepEqual(received, [snapshot]);
  unsubscribe();
  assert.equal(ipc.listeners.size, 0);
});

test('el puente de medios expone sólo selección sin aceptar argumentos del renderer', async () => {
  const ipc = new FakeRendererIpc();
  const bridge = createMediaBridge(ipc);
  assert.deepEqual(Object.keys(bridge), ['selectFile']);
  await bridge.selectFile();
  assert.deepEqual(ipc.invocations, [{ channel: MEDIA_CHANNELS.select }]);
});
