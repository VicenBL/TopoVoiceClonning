import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MediaPreparationController } from './media-preparation.ts';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function mediaFixture() {
  const root = await mkdtemp(join(tmpdir(), 'voice-studio-media-race-'));
  const source = join(root, 'race fixture.wav');
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.4', '-c:a', 'pcm_s16le', source], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return { root, source };
}

function fileSystem(overrides) {
  return { mkdir, mkdtemp, rm, stat, ...overrides };
}

async function waitEntered(promise) {
  await Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('Expected filesystem gate was not reached')), 1000))]);
}

test('dispose durante mkdir posterior a ffprobe no debe lanzar ffmpeg después', async t => {
  const { root, source } = await mediaFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const entered = deferred();
  const resume = deferred();
  const commands = [];
  const controller = new MediaPreparationController({
    tempRoot: root,
    spawnProcess(command, args, options) {
      commands.push(command);
      return (awaitImportSpawn)(command, args, options);
    },
    fileSystem: fileSystem({ mkdir: async (...args) => { entered.resolve(); await resume.promise; return mkdir(...args); } }),
  });
  t.after(() => controller.dispose());
  await controller.select(source);
  const preparing = controller.prepare();
  await waitEntered(entered.promise);
  const disposing = controller.dispose();
  resume.resolve();
  await assert.rejects(preparing, /cancelada|cerrada|sustituida/i);
  await disposing;
  await assert.rejects(controller.select(source), /cerrada/);
  await assert.rejects(controller.prepare(), /cerrada/);
  assert.equal(commands.filter(command => command === 'ffmpeg').length, 0, `spawn calls: ${commands}`);
});

test('dispose después de stat no puede publicar una URL obsoleta y espera cleanup', async t => {
  const { root, source } = await mediaFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const entered = deferred();
  const resume = deferred();
  const commands = [];
  const controller = new MediaPreparationController({
    tempRoot: root,
    spawnProcess(command, args, options) { commands.push(command); return (awaitImportSpawn)(command, args, options); },
    fileSystem: fileSystem({ stat: async path => { entered.resolve(); await resume.promise; return stat(path); } }),
  });
  t.after(() => controller.dispose());
  await controller.select(source);
  const preparing = controller.prepare();
  await waitEntered(entered.promise);
  const disposing = controller.dispose();
  resume.resolve();
  await assert.rejects(preparing, /cancelada|cerrada|sustituida/i);
  await disposing;
  assert.equal((await (await import('node:fs/promises')).readdir(root)).some(name => name.startsWith('voice-studio-media-')), false);
  assert.equal(commands.filter(command => command === 'ffmpeg').length, 1);
});

test('preparaciones repetidas coalescen y todos los dispose esperan la misma limpieza', async t => {
  const { root, source } = await mediaFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const entered = deferred();
  const resume = deferred();
  const commands = [];
  const controller = new MediaPreparationController({
    tempRoot: root,
    spawnProcess(command, args, options) { commands.push(command); return (awaitImportSpawn)(command, args, options); },
    fileSystem: fileSystem({ mkdir: async (...args) => { entered.resolve(); await resume.promise; return mkdir(...args); } }),
  });
  t.after(() => controller.dispose());
  await controller.select(source);
  const first = controller.prepare();
  await waitEntered(entered.promise);
  const second = controller.prepare();
  const disposeOne = controller.dispose();
  const disposeTwo = controller.dispose();
  let secondDisposeDone = false;
  void disposeTwo.then(() => { secondDisposeDone = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(secondDisposeDone, false, 'all dispose calls must await the active operation');
  resume.resolve();
  await Promise.all([assert.rejects(first, /cancelada|cerrada|sustituida/i), assert.rejects(second, /cancelada|cerrada|sustituida/i), disposeOne, disposeTwo]);
  assert.equal(commands.filter(command => command === 'ffmpeg').length, 0, `spawn calls: ${commands}`);
  assert.equal((await (await import('node:fs/promises')).readdir(root)).some(name => name.startsWith('voice-studio-media-')), false);
});

const { spawn: awaitImportSpawn } = await import('node:child_process');
