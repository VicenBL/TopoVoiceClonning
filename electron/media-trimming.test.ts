import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { MediaPreparationController } from './media-preparation.ts';
import { MediaTrimmingController, TRIM_DURATION_TOLERANCE_SEC } from './media-trimming.ts';

async function fixture(t: { after: (fn: () => Promise<unknown>) => void }, video = false) {
  const root = await mkdtemp(join(process.cwd(), 'node_modules/.cache/trim-test-'));
  const source = join(root, video ? 'vídeo real é % #.mp4' : 'audio real é % #.wav');
  const args = video
    ? ['-f', 'lavfi', '-i', 'color=c=black:s=32x32:r=10:d=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest']
    : ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:a', 'pcm_s16le'];
  const made = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args, source], { encoding: 'utf8', timeout: 10000 });
  assert.equal(made.status, 0, made.stderr);
  const preparation = new MediaPreparationController({ tempRoot: root });
  await preparation.select(source);
  const prepared = await preparation.prepare();
  const trimming = new MediaTrimmingController({ tempRoot: root, prepareSelected: () => preparation.prepare() });
  t.after(async () => { await trimming.dispose(); await preparation.dispose(); await rm(root, { recursive: true, force: true }); });
  return { root, source, prepared, preparation, trimming };
}

for (const video of [false, true]) test(`recorta ${video ? 'MP4' : 'WAV'} real dos veces con formato y duración correctos, sin cambiar original`, async t => {
  const f = await fixture(t, video);
  const original = await readFile(f.source);
  const clips = [];
  for (const [startSec, endSec] of [[0.25, 1.5], [2, 3.1]]) {
    const clip = await f.trimming.trim({ sourceUrl: f.prepared.url, startSec, endSec });
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', fileURLToPath(clip.url)], { encoding: 'utf8', timeout: 10000 });
    assert.equal(probe.status, 0, probe.stderr);
    const metadata = JSON.parse(probe.stdout);
    assert.equal(metadata.streams[0].codec_name, 'pcm_s16le');
    assert.equal(metadata.streams[0].channels, 1);
    assert.equal(metadata.streams[0].sample_rate, '48000');
    assert.ok(Math.abs(Number(metadata.format.duration) - (endSec - startSec)) <= TRIM_DURATION_TOLERANCE_SEC);
    assert.ok(Math.abs(clip.durationSec - (endSec - startSec)) <= TRIM_DURATION_TOLERANCE_SEC);
    assert.equal(clip.sourceUrl, f.prepared.url);
    assert.equal(clip.startSec, startSec);
    assert.equal(clip.endSec, endSec);
    clips.push(clip);
  }
  assert.notEqual(clips[0].id, clips[1].id);
  assert.notEqual(clips[0].url, clips[1].url);
  assert.ok((await stat(fileURLToPath(clips[0].url))).size > 44);
  assert.deepEqual(await readFile(f.source), original);
  await f.trimming.reset();
  for (const clip of clips) await assert.rejects(stat(fileURLToPath(clip.url)), { code: 'ENOENT' });
});

test('intervalos no finitos/negativos/fuera de duración/vacíos/invertidos no lanzan FFmpeg ni crean resultados', async t => {
  const f = await fixture(t);
  let launches = 0;
  const controller = new MediaTrimmingController({ tempRoot: f.root, prepareSelected: () => f.preparation.prepare(), spawnProcess: ((...args: Parameters<typeof spawn>) => { launches++; return spawn(...args); }) as typeof spawn });
  t.after(() => controller.dispose());
  const before = await readdir(f.root);
  for (const [startSec, endSec] of [[NaN, 1], [0, Infinity], [-1, 1], [1, 1], [2, 1], [0, 5], [Infinity, 2], [0, -1]]) {
    await assert.rejects(controller.trim({ sourceUrl: f.prepared.url, startSec, endSec }), /intervalo|duración/i);
    assert.deepEqual(await readdir(f.root), before);
  }
  await assert.rejects(controller.trim({ sourceUrl: 'file:///other.wav', startSec: 0, endSec: 1 }), /seleccionado|fuente/i);
  assert.equal(launches, 0);
  assert.deepEqual(await readdir(f.root), before);
});

test('sin duración conocida no recorta; los límites 0 y duración exacta son válidos', async t => {
  const f = await fixture(t);
  const unknown = new MediaTrimmingController({ tempRoot: f.root, prepareSelected: async () => ({ ...f.prepared, durationSec: null }) });
  t.after(() => unknown.dispose());
  await assert.rejects(unknown.trim({ sourceUrl: f.prepared.url, startSec: 0, endSec: 1 }), /duración/i);
  const entire = await f.trimming.trim({ sourceUrl: f.prepared.url, startSec: 0, endSec: f.prepared.durationSec! });
  assert.ok(Math.abs(entire.durationSec - f.prepared.durationSec!) <= TRIM_DURATION_TOLERANCE_SEC);
});

test('cancelación después de escribir parcial espera al hijo, rechaza concurrencia y no publica ni conserva parciales', async t => {
  const f = await fixture(t);
  let child: ReturnType<typeof spawn> | undefined;
  let closed = false;
  const controller = new MediaTrimmingController({
    tempRoot: f.root, prepareSelected: () => f.preparation.prepare(),
    spawnProcess: ((command: string, args: string[], options: object) => {
      const index = args.indexOf('-i');
      const process = spawn(command, command === 'ffmpeg' ? [...args.slice(0, index), '-re', ...args.slice(index)] : args, options);
      if (command === 'ffmpeg') { child = process; process.once('close', () => { closed = true; }); }
      return process;
    }) as typeof spawn,
  });
  t.after(() => controller.dispose());
  let published = false;
  const pending = controller.trim({ sourceUrl: f.prepared.url, startSec: 0, endSec: 4 }).then(value => { published = true; return value; }, error => error);
  await assert.rejects(controller.trim({ sourceUrl: f.prepared.url, startSec: 0, endSec: 1 }), /recorte.*curso/i);
  let partial = 0;
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline && partial <= 44) {
    for (const name of await readdir(f.root)) if (name.startsWith('voice-studio-trim-')) partial = await stat(join(f.root, name, 'fragment.wav')).then(s => s.size, () => 0);
    if (partial <= 44) await delay(30);
  }
  assert.ok(partial > 44 && child && !closed, `FFmpeg must be alive with written partial, size=${partial}`);
  await Promise.all([controller.reset(), controller.reset()]);
  assert.match((await pending).message, /cancelado|sustituido/i);
  assert.equal(closed, true);
  assert.equal(published, false);
  assert.equal((await readdir(f.root)).some(name => name.startsWith('voice-studio-trim-')), false);
  await controller.dispose();
  await assert.rejects(controller.trim({ sourceUrl: f.prepared.url, startSec: 0, endSec: 1 }), /cerrad/i);
});

test('cambio de fuente durante espera de preparación invalida el recorte antes del spawn', async t => {
  const f = await fixture(t);
  let resolve!: (value: typeof f.prepared) => void;
  let launches = 0;
  const controller = new MediaTrimmingController({ tempRoot: f.root, prepareSelected: () => new Promise(r => { resolve = r; }), spawnProcess: (() => { launches++; throw Error('unexpected spawn'); }) as typeof spawn });
  t.after(() => controller.dispose());
  const result = controller.trim({ sourceUrl: f.prepared.url, startSec: 0, endSec: 1 }).catch(error => error);
  const clearing = controller.reset();
  resolve(f.prepared);
  await clearing;
  assert.match((await result).message, /cancelado|sustituido/i);
  assert.equal(launches, 0);
});

test('fallo real de FFmpeg no publica resultado ni deja directorio parcial', async t => {
  const f = await fixture(t);
  const controller = new MediaTrimmingController({ tempRoot: f.root, prepareSelected: () => f.preparation.prepare(), ffmpegPath: 'no-existe-ffmpeg-trim' });
  t.after(() => controller.dispose());
  await assert.rejects(controller.trim({ sourceUrl: f.prepared.url, startSec: 0, endSec: 1 }), /disponible|ENOENT/i);
  assert.equal((await readdir(f.root)).some(name => name.startsWith('voice-studio-trim-')), false);
});

test('dispose cancela un recorte que espera preparación sin esperar su resultado', async () => {
  let release!: (value: { url: string; durationSec: number }) => void;
  const source = new Promise<{ url: string; durationSec: number }>(resolve => { release = resolve; });
  let spawns = 0;
  const controller = new MediaTrimmingController({
    tempRoot: process.cwd(),
    prepareSelected: () => source,
    spawnProcess: (() => { spawns++; throw new Error('No debe lanzar después de cancelar'); }) as typeof spawn,
  });
  const result = controller.trim({ sourceUrl: 'file:///previous/prepared.wav', startSec: 0, endSec: 1 }).catch(error => error);
  let disposed = false;
  const closing = controller.dispose().then(() => { disposed = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  const canceledWithoutPreparation = disposed;
  release({ url: 'file:///previous/prepared.wav', durationSec: 4 });
  await closing;
  const error = await result;
  assert.equal(canceledWithoutPreparation, true);
  assert.match(error.message, /cancelado|sustituido/i);
  assert.equal(spawns, 0);
});
