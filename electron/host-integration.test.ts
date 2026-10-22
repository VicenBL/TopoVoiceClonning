import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Script } from 'node:vm';
import { test } from 'node:test';

test('el preload de Electron se puede ejecutar como script aislado', () => {
  const preload = readFileSync(resolve('dist-electron/preload.js'), 'utf8');
  assert.doesNotThrow(() => new Script(preload));
});

test('los recursos del renderer de producción se resuelven desde file:', () => {
  const htmlPath = resolve('dist/index.html');
  const htmlUrl = pathToFileURL(htmlPath);
  const html = readFileSync(htmlPath, 'utf8');
  const assets = [...html.matchAll(/(?:src|href)="([^" ]*assets\/[^" ]+)"/g)];

  assert(assets.length > 0, 'Vite debe incluir JS y CSS');
  for (const [, asset] of assets) {
    assert(existsSync(new URL(asset, htmlUrl)), `Recurso no encontrado: ${asset}`);
  }
});
