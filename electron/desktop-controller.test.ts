import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { DesktopServiceController, resolveCloseAction } from './desktop-controller.ts';

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

test('configura el autoarranque y reinicia de forma efectiva al cambiar el puerto', async t => {
  const firstPort = await freePort();
  const secondPort = await freePort();
  const controller = new DesktopServiceController({
    port: firstPort,
    autoStart: false,
    keepRunningOnClose: true,
  });
  t.after(() => controller.shutdown());

  assert.equal(controller.getState().status, 'stopped');
  const started = await controller.configure({
    port: firstPort,
    autoStart: true,
    keepRunningOnClose: true,
  });
  assert.equal(started.status, 'active');
  assert.equal((await fetch(`http://127.0.0.1:${firstPort}/health`)).status, 200);

  const restarted = await controller.configure({
    port: secondPort,
    autoStart: true,
    keepRunningOnClose: false,
  });
  assert.equal(restarted.status, 'active');
  assert.equal(restarted.port, secondPort);
  await assert.rejects(fetch(`http://127.0.0.1:${firstPort}/health`));
  assert.equal((await fetch(`http://127.0.0.1:${secondPort}/health`)).status, 200);
  assert.deepEqual(controller.getPreferences(), {
    port: secondPort,
    autoStart: true,
    keepRunningOnClose: false,
  });
});

test('rechaza una configuración inválida sin cambiar preferencias ni estado', async () => {
  const port = await freePort();
  const controller = new DesktopServiceController({ port, autoStart: false, keepRunningOnClose: true });
  const beforeState = controller.getState();
  const beforePreferences = controller.getPreferences();

  await assert.rejects(
    controller.configure({ port: 80, autoStart: true, keepRunningOnClose: false }),
    { name: 'TypeError', message: 'Preferencias del servicio no válidas.' },
  );

  assert.deepEqual(controller.getState(), beforeState);
  assert.deepEqual(controller.getPreferences(), beforePreferences);
});

test('la política de cierre distingue ocultar, salir y permitir el cierre final', () => {
  assert.equal(resolveCloseAction(true, false), 'hide');
  assert.equal(resolveCloseAction(false, false), 'quit');
  assert.equal(resolveCloseAction(true, true), 'allow');
  assert.equal(resolveCloseAction(false, true), 'allow');
});
