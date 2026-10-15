import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  LOOPBACK_HOST,
  SERVICE_CHANNELS,
  validateServicePreferences,
} from './service-contract.ts';

test('el contrato fija loopback y canales IPC explícitos', () => {
  assert.equal(LOOPBACK_HOST, '127.0.0.1');
  assert.deepEqual(SERVICE_CHANNELS, {
    getState: 'service:get-state',
    configure: 'service:configure',
    start: 'service:start',
    stop: 'service:stop',
    restart: 'service:restart',
    getDiagnostics: 'service:get-diagnostics',
    stateChanged: 'service:state-changed',
  });
});

test('acepta únicamente preferencias completas y puertos de usuario válidos', () => {
  assert.deepEqual(
    validateServicePreferences({ port: 1024, autoStart: true, keepRunningOnClose: false }),
    { port: 1024, autoStart: true, keepRunningOnClose: false },
  );
  assert.deepEqual(
    validateServicePreferences({ port: 65535, autoStart: false, keepRunningOnClose: true }),
    { port: 65535, autoStart: false, keepRunningOnClose: true },
  );
});

test('rechaza puertos fuera de rango, fraccionarios o preferencias incompletas', () => {
  const invalid = [
    { port: 1023, autoStart: true, keepRunningOnClose: true },
    { port: 65536, autoStart: true, keepRunningOnClose: true },
    { port: 4317.5, autoStart: true, keepRunningOnClose: true },
    { port: 4317, autoStart: 'sí', keepRunningOnClose: true },
    { port: 4317, autoStart: true },
    null,
  ];

  for (const value of invalid) {
    assert.throws(
      () => validateServicePreferences(value),
      { name: 'TypeError', message: 'Preferencias del servicio no válidas.' },
    );
  }
});
