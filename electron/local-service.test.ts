import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import { LocalHttpService } from './local-service.ts';

async function readJson(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    body: await response.json(),
  };
}

async function occupyLoopbackPort() {
  const server = createServer((_request, response) => response.end('ocupado'));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  return {
    port: address.port,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

test('inicia en loopback, sirve /health y se detiene según eventos efectivos', async t => {
  const service = new LocalHttpService({ port: 0 });
  t.after(() => service.stop());
  const statuses: string[] = [];
  const unsubscribe = service.onStateChange(snapshot => statuses.push(snapshot.status));
  t.after(unsubscribe);

  const active = await service.start();
  assert.equal(active.status, 'active');
  assert.equal(active.host, '127.0.0.1');
  assert(active.port > 0);
  assert(active.startedAt);
  assert.deepEqual(statuses, ['starting', 'active']);

  const health = await readJson(`http://127.0.0.1:${active.port}/health`);
  assert.equal(health.status, 200);
  assert.match(health.contentType ?? '', /^application\/json/);
  assert.deepEqual(health.body, {
    status: 'ok',
    service: 'voice-studio',
    version: 1,
    host: '127.0.0.1',
    port: active.port,
    pid: process.pid,
    startedAt: active.startedAt,
  });

  const stopped = await service.stop();
  assert.equal(stopped.status, 'stopped');
  assert.deepEqual(statuses, ['starting', 'active', 'stopping', 'stopped']);
  await assert.rejects(fetch(`http://127.0.0.1:${active.port}/health`));
});

test('responde 404 para rutas desconocidas y 405 para métodos no admitidos', async t => {
  const service = new LocalHttpService({ port: 0 });
  t.after(() => service.stop());
  const active = await service.start();

  assert.deepEqual(await readJson(`http://127.0.0.1:${active.port}/desconocida`), {
    status: 404,
    contentType: 'application/json; charset=utf-8',
    body: { error: 'not_found' },
  });
  assert.deepEqual(await readJson(`http://127.0.0.1:${active.port}/health`, { method: 'POST' }), {
    status: 405,
    contentType: 'application/json; charset=utf-8',
    body: { error: 'method_not_allowed' },
  });
});

test('comparte inicios concurrentes y no crea servidores duplicados', async t => {
  const service = new LocalHttpService({ port: 0 });
  t.after(() => service.stop());
  const statuses: string[] = [];
  service.onStateChange(snapshot => statuses.push(snapshot.status));

  const [first, second] = await Promise.all([service.start(), service.start()]);
  const third = await service.start();

  assert.equal(first.status, 'active');
  assert.equal(second.port, first.port);
  assert.equal(third.port, first.port);
  assert.deepEqual(statuses, ['starting', 'active']);
});

test('un conflicto de puerto produce error diagnosticable sin afectar al servidor existente', async t => {
  const occupied = await occupyLoopbackPort();
  t.after(occupied.close);
  const service = new LocalHttpService({ port: occupied.port });
  t.after(() => service.stop());

  const snapshot = await service.start();

  assert.equal(snapshot.status, 'error');
  assert.equal(snapshot.port, occupied.port);
  assert.deepEqual(snapshot.lastError, {
    code: 'PORT_IN_USE',
    summary: `El puerto ${occupied.port} ya está en uso.`,
    detail: `No se pudo iniciar Voice Studio en 127.0.0.1:${occupied.port}.`,
    at: snapshot.lastError?.at,
    host: '127.0.0.1',
    port: occupied.port,
  });
  assert.equal(service.getDiagnostics().length, 1);
  assert.equal(await (await fetch(`http://127.0.0.1:${occupied.port}`)).text(), 'ocupado');
});

test('reinicia cerrando primero y vuelve a dejar /health disponible', async t => {
  const service = new LocalHttpService({ port: 0 });
  t.after(() => service.stop());
  const statuses: string[] = [];
  service.onStateChange(snapshot => statuses.push(snapshot.status));
  await service.start();
  statuses.length = 0;

  const restarted = await service.restart();

  assert.equal(restarted.status, 'active');
  assert.deepEqual(statuses, ['stopping', 'stopped', 'starting', 'active']);
  assert.equal((await readJson(`http://127.0.0.1:${restarted.port}/health`)).status, 200);
});
