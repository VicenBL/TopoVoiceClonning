import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isTrustedRendererUrl } from './renderer-security.ts';

test('la navegación acepta únicamente el origen de desarrollo autorizado', () => {
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:5173/', 'http://127.0.0.1:5173/'), true);
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:5173.evil.test/', 'http://127.0.0.1:5173/'), false);
  assert.equal(isTrustedRendererUrl('https://untrusted.example/', 'http://127.0.0.1:5173/'), false);
});

test('la navegación de producción queda restringida al documento empaquetado', () => {
  assert.equal(isTrustedRendererUrl('file:///app/dist/index.html', 'file:///app/dist/index.html'), true);
  assert.equal(isTrustedRendererUrl('file:///app/private.html', 'file:///app/dist/index.html'), false);
  assert.equal(isTrustedRendererUrl(undefined, 'file:///app/dist/index.html'), false);
});
