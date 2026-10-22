import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { hideWithoutBlocking, resolveTrayIconPath, tryCreateTray } from './tray-support.ts';
import { resolveCloseAction } from './desktop-controller.ts';

test('resuelve el icono bajo la raíz de la aplicación en desarrollo y empaquetada', () => {
  const developmentRoot = 'C:/workspace/voice-studio';
  const packagedRoot = 'C:/Program Files/Voice Studio/resources/app.asar';

  assert.equal(resolveTrayIconPath(developmentRoot), join(developmentRoot, 'assets', 'tray.ico'));
  assert.equal(resolveTrayIconPath(packagedRoot), join(packagedRoot, 'assets', 'tray.ico'));
  const iconPath = resolveTrayIconPath(process.cwd());
  assert.equal(existsSync(iconPath), true);
  const icon = readFileSync(iconPath);
  assert.deepEqual([...icon.subarray(0, 6)], [0, 0, 1, 0, 1, 0]);
  assert.equal(icon.readUInt32LE(18), 22);
});

test('la falta del icono no impide ocultar la ventana ni altera la ruta de salida', () => {
  let hidden = false;
  const tray = tryCreateTray('missing/tray.ico', () => {
    throw new Error('icon missing');
  });

  hideWithoutBlocking(() => tray, () => { hidden = true; });

  assert.equal(tray, undefined);
  assert.equal(hidden, true);
  assert.equal(resolveCloseAction(true, false), 'hide');
  assert.equal(resolveCloseAction(false, false), 'quit');
  assert.equal(resolveCloseAction(true, true), 'allow');
});
