import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { MediaPreparationController } from './media-preparation.ts';

const ffmpeg = 'ffmpeg';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'voice-studio-media-test-'));
  const source = join(root, 'Voz con espacios é % #.wav');
  const made = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.35', '-c:a', 'pcm_s16le', source], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  return { root, source };
}

test('prepara WAV real sin alterar el original y publica duración sólo tras conversión válida', async t => {
  const { root, source } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const original = await readFile(source);
  const controller = new MediaPreparationController({ tempRoot: root });
  t.after(() => controller.dispose());
  await controller.select(source);
  const ready = await controller.prepare();
  assert.match(ready.url, /^file:/);
  assert.ok(Math.abs((ready.durationSec ?? 0) - 0.35) < 0.1);
  assert.deepEqual(await readFile(source), original);
  assert.equal((await readdir(root)).filter(name => name.endsWith('.wav')).length, 1);
});

test('rechaza archivo corrupto y vídeo sin audio sin dejar WAV parcial', async t => {
  const { root, source } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const corrupt = join(root, 'corrupto.wav');
  await writeFile(corrupt, 'no es audio');
  const silentVideo = join(root, 'sin-audio.mp4');
  const made = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=32x32:d=0.2', '-an', '-y', silentVideo], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  const controller = new MediaPreparationController({ tempRoot: root });
  t.after(() => controller.dispose());
  await controller.select(corrupt);
  await assert.rejects(controller.prepare(), /audio|preparar/i);
  await controller.select(silentVideo);
  await assert.rejects(controller.prepare(), /audio/i);
  assert.equal((await readdir(root)).some(name => /^voice-studio-.*\.wav$/.test(name)), false);
});

test('sustituir durante conversión y cerrar esperan el cierre del proceso FFmpeg', async t => {
  const { root, source } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const longSource = join(root, 'conversión lenta.wav');
  const made = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:a', 'pcm_s16le', longSource], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  const children: ReturnType<typeof spawn>[] = [];
  const closedChildren = new Set<ReturnType<typeof spawn>>();
  const launched: Array<() => void> = [];
  const controller = new MediaPreparationController({
    tempRoot: root,
    spawnProcess: ((command: string, args: string[], options: object) => {
      const slowed = command === ffmpeg ? [...args.slice(0, args.indexOf('-i')), '-re', ...args.slice(args.indexOf('-i'))] : args;
      const child = spawn(command, slowed, options as Parameters<typeof spawn>[2]);
      children.push(child);
      child.once('close', () => closedChildren.add(child));
      if (command === ffmpeg) for (const resolve of launched.splice(0)) resolve();
      return child;
    }) as typeof spawn,
  });
  t.after(() => controller.dispose());
  await controller.select(longSource);
  const conversionStarted = new Promise<void>(resolve => launched.push(resolve));
  const oldPreparation = controller.prepare();
  await conversionStarted;
  const replacedProcess = children.at(-1)!;
  await controller.select(source);
  assert.equal(closedChildren.has(replacedProcess), true, `replacement must wait for FFmpeg close (pid=${replacedProcess.pid}, exit=${replacedProcess.exitCode}, signal=${replacedProcess.signalCode}, children=${children.length})`);
  await assert.rejects(oldPreparation, /cancelada o sustituida/);
  await controller.select(longSource);
  const closingStarted = new Promise<void>(resolve => launched.push(resolve));
  const closingPreparation = controller.prepare();
  await closingStarted;
  const quittingProcess = children.at(-1)!;
  await controller.dispose();
  await assert.rejects(closingPreparation, /cancelada o sustituida/);
  assert.equal(closedChildren.has(quittingProcess), true, 'dispose must await FFmpeg close');
  assert.equal((await readdir(root)).some(name => name.startsWith('voice-studio-media-')), false);
});

test('errores de herramientas ausentes y JSON de ffprobe inválido son visibles sin temporales', async t => {
  const { root, source } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const missing = new MediaPreparationController({ tempRoot: root, ffprobePath: 'no-existe-ffprobe-voice-studio' });
  t.after(() => missing.dispose());
  await missing.select(source);
  await assert.rejects(missing.prepare(), /no está disponible/);
  const malformed = new MediaPreparationController({
    tempRoot: root,
    spawnProcess: ((command: string, args: string[], options: object) => command === 'ffprobe'
      ? spawn(process.execPath, ['-e', 'process.stdout.write("{bad");'], options as Parameters<typeof spawn>[2])
      : spawn(command, args, options as Parameters<typeof spawn>[2])) as typeof spawn,
  });
  t.after(() => malformed.dispose());
  await malformed.select(source);
  await assert.rejects(malformed.prepare(), /metadatos de audio no válidos/);
  assert.equal((await readdir(root)).some(name => name.startsWith('voice-studio-media-')), false);
});

test('cancelar selección conserva preparación anterior y dispose es idempotente', async t => {
  const { root, source } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const controller = new MediaPreparationController({ tempRoot: root });
  t.after(() => controller.dispose());
  await controller.select(source);
  const ready = await controller.prepare();
  assert.equal(await controller.select(null), false);
  assert.deepEqual(await controller.prepare(), ready);
  await controller.dispose();
  await controller.dispose();
  assert.equal(await readdir(root).then(names => names.some(name => name.startsWith('voice-studio-'))), false);
});
