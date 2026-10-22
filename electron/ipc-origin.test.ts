import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { DesktopServiceController } from './desktop-controller.ts';
import { registerServiceIpc, type IpcMainAdapter } from './service-ipc.ts';
import { SERVICE_CHANNELS } from './service-contract.ts';

test('rechaza llamadas IPC de un frame ajeno antes de acceder al servicio', async t => {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));

  const controller = new DesktopServiceController({ port, autoStart: false, keepRunningOnClose: true });
  t.after(() => controller.shutdown());
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipc: IpcMainAdapter = {
    handle: (channel, listener) => { handlers.set(channel, listener); },
    removeHandler: channel => { handlers.delete(channel); },
  };
  const trusted = (event: unknown) => (event as { senderFrame?: { url?: string } }).senderFrame?.url === 'file:///app/index.html';
  const unregister = registerServiceIpc(ipc, controller, () => {}, trusted);
  t.after(unregister);

  await assert.rejects(
    async () => handlers.get(SERVICE_CHANNELS.getState)!({ senderFrame: { url: 'https://untrusted.example/' } }),
    { name: 'Error', message: 'Emisor IPC no autorizado.' },
  );
  assert.equal(controller.getState().status, 'stopped');
});
