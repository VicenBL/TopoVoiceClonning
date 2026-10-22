import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { DesktopServiceController } from './desktop-controller.ts';
import { registerServiceIpc, type IpcMainAdapter } from './service-ipc.ts';
import { SERVICE_CHANNELS, type ServiceSnapshot } from './service-contract.ts';

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  const { port } = address;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

class FakeIpcMain implements IpcMainAdapter {
  readonly handlers = new Map<string, (...args: unknown[]) => unknown>();

  handle(channel: string, listener: (...args: unknown[]) => unknown): void {
    this.handlers.set(channel, listener);
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }

  invoke(channel: string, payload?: unknown) {
    const handler = this.handlers.get(channel);
    assert(handler, `Falta el handler ${channel}`);
    return handler({}, payload);
  }
}

test('registra sólo operaciones IPC concretas y propaga estados reales', async t => {
  const port = await freePort();
  const controller = new DesktopServiceController({ port, autoStart: false, keepRunningOnClose: true });
  t.after(() => controller.shutdown());
  const ipc = new FakeIpcMain();
  const published: ServiceSnapshot[] = [];
  const unregister = registerServiceIpc(ipc, controller, snapshot => published.push(snapshot), () => true);
  t.after(unregister);

  assert.deepEqual([...ipc.handlers.keys()].sort(), [
    SERVICE_CHANNELS.configure,
    SERVICE_CHANNELS.getDiagnostics,
    SERVICE_CHANNELS.getState,
    SERVICE_CHANNELS.restart,
    SERVICE_CHANNELS.start,
    SERVICE_CHANNELS.stop,
  ].sort());

  assert.equal((await ipc.invoke(SERVICE_CHANNELS.getState) as ServiceSnapshot).status, 'stopped');
  const active = await ipc.invoke(SERVICE_CHANNELS.configure, {
    port,
    autoStart: true,
    keepRunningOnClose: true,
  }) as ServiceSnapshot;
  assert.equal(active.status, 'active');
  assert.deepEqual(published.map(snapshot => snapshot.status), ['starting', 'active']);
  assert.deepEqual(await ipc.invoke(SERVICE_CHANNELS.getDiagnostics), []);

  unregister();
  assert.equal(ipc.handlers.size, 0);
});
