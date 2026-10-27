import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFile, link, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { MediaPreparationController } from './media-preparation.ts';
import { MediaTrimmingController } from './media-trimming.ts';
import { MediaExportController, type SaveDialogOptions } from './media-exporting.ts';

async function fixture(t: { after: (fn: () => Promise<unknown>) => void }, video = true) {
  const root = await mkdtemp(join(process.cwd(), 'node_modules/.cache/export-test-'));
  const source = join(root, video ? 'Vídeo original é #.mp4' : 'Audio original é #.wav');
  const args = video ? ['-f', 'lavfi', '-i', 'color=c=black:s=32x32:r=10:d=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest'] : ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:a', 'pcm_s16le'];
  const made = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args, source], { encoding: 'utf8', timeout: 10000 });
  assert.equal(made.status, 0, made.stderr);
  let launches = 0;
  const spawnProcess = ((...args: Parameters<typeof spawn>) => { launches++; return spawn(...args); }) as typeof spawn;
  const prep = new MediaPreparationController({ tempRoot: root, spawnProcess });
  await prep.select(source);
  const prepared = await prep.prepare();
  const trim = new MediaTrimmingController({ tempRoot: root, prepareSelected: () => prep.prepare(), spawnProcess });
  let result: { canceled: boolean; filePath?: string } = { canceled: false, filePath: join(root, 'exportado.wav') };
  const dialogs: SaveDialogOptions[] = [];
  const exporter = new MediaExportController({ showSaveDialog: async options => { dialogs.push(options); return result; } });
  t.after(async () => { await exporter.dispose(); await trim.dispose(); await prep.dispose(); await rm(root, { recursive: true, force: true }); });
  const clips = [];
  for (const [startSec, endSec] of [[0.5, 1.5], [2, 3]]) clips.push(await exporter.trackTrim(() => trim.trim({ sourceUrl: prepared.url, startSec, endSec }), video ? 'Vídeo original é #.mp4' : 'Audio original é #.wav'));
  return { root, source, clips, exporter, dialogs, launches: () => launches, choose: (value: typeof result) => { result = value; } };
}

test('exporta dos clips MP4 reales con bytes/formato/duración idénticos, nombres propios y sin recodificar', async t => {
  const f = await fixture(t);
  const original = await readFile(f.source);
  const launches = f.launches();
  for (const [index, clip] of f.clips.entries()) {
    const destination = join(f.root, `copia ${index + 1} é.wav`);
    f.choose({ canceled: false, filePath: destination });
    assert.deepEqual(await f.exporter.save(clip.id), { path: destination });
    assert.deepEqual(await readFile(destination), await readFile(fileURLToPath(clip.url)));
    assert.equal(f.dialogs[index].defaultPath, `Vídeo original é #-fragmento-${index + 1}.wav`);
    assert.deepEqual(f.dialogs[index].filters, [{ name: 'Audio WAV', extensions: ['wav'] }]);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', destination], { encoding: 'utf8', timeout: 10000 });
    assert.equal(probe.status, 0, probe.stderr);
    const metadata = JSON.parse(probe.stdout);
    assert.equal(metadata.streams[0].codec_name, 'pcm_s16le');
    assert.equal(metadata.streams[0].channels, 1);
    assert.equal(metadata.streams[0].sample_rate, '48000');
    assert.equal(Number(metadata.format.duration), clip.durationSec);
    // Independent decoder reads the exported file; audible external playback remains manual.
    const decode = spawnSync('ffmpeg', ['-v', 'error', '-i', destination, '-f', 'null', '-'], { encoding: 'utf8', timeout: 10000 });
    assert.equal(decode.status, 0, decode.stderr);
    assert.equal(decode.stdout, ''); assert.equal(decode.stderr, '');
  }
  assert.equal(f.launches(), launches);
  assert.deepEqual(await readFile(f.source), original);
  assert.equal((await readdir(f.root)).some(name => name.startsWith('.voice-studio-export-')), false);
  await f.exporter.reset();
  assert.ok((await stat(join(f.root, 'copia 1 é.wav'))).size > 44);
});

test('cancelar Guardar como no cambia archivos ni devuelve éxito y conserva el clip', async t => {
  const f = await fixture(t);
  const before = await readdir(f.root);
  f.choose({ canceled: true, filePath: join(f.root, 'no-crear.wav') });
  assert.equal(await f.exporter.save(f.clips[0].id), null);
  assert.deepEqual(await readdir(f.root), before);
  f.choose({ canceled: false, filePath: join(f.root, 'después.wav') });
  assert.deepEqual(await f.exporter.save(f.clips[0].id), { path: join(f.root, 'después.wav') });
});

test('rechaza destino existente y original WAV sin alterar sus bytes', async t => {
  const f = await fixture(t, false);
  for (const destination of [join(f.root, 'ocupado.wav'), f.source]) {
    if (destination !== f.source) await writeFile(destination, 'datos anteriores');
    const before = await readFile(destination), files = await readdir(f.root);
    f.choose({ canceled: false, filePath: destination });
    await assert.rejects(f.exporter.save(f.clips[0].id), /existe|otro nombre/i);
    assert.deepEqual(await readFile(destination), before);
    assert.deepEqual(await readdir(f.root), files);
  }
});

test('carrera de creación del destino no lo sobrescribe ni publica copia parcial', async t => {
  const f = await fixture(t);
  const destination = join(f.root, 'carrera.wav');
  const exporter = new MediaExportController({ showSaveDialog: async () => ({ canceled: false, filePath: destination }), fileSystem: { link: async (source, target) => { await writeFile(target, 'otro proceso'); await link(source, target); } } });
  t.after(() => exporter.dispose());
  await exporter.trackTrim(async () => f.clips[0], 'original.mp4');
  await assert.rejects(exporter.save(f.clips[0].id), /existe|otro nombre/i);
  assert.equal(await readFile(destination, 'utf8'), 'otro proceso');
  assert.equal((await readdir(f.root)).some(name => name.startsWith('.voice-studio-export-')), false);
});

test('errores de escritura parcial y publicación fallida no dejan destino ni parciales y permiten reintentar', async t => {
  const f = await fixture(t);
  const original = await readFile(f.source);
  for (const failure of ['copy', 'link']) {
    const destination = join(f.root, `${failure}.wav`);
    let fail = true;
    const exporter = new MediaExportController({ showSaveDialog: async () => ({ canceled: false, filePath: destination }), fileSystem: {
      copyFile: async (source, target) => { if (failure === 'copy' && fail) { await writeFile(target, 'parcial'); throw Object.assign(Error('sin permiso'), { code: 'EACCES' }); } await copyFile(source, target); },
      link: async (source, target) => { if (failure === 'link' && fail) throw Object.assign(Error('sin enlace'), { code: 'ENOTSUP' }); await link(source, target); },
    } });
    t.after(() => exporter.dispose());
    await exporter.trackTrim(async () => f.clips[0], 'original.mp4');
    await assert.rejects(exporter.save(f.clips[0].id), /guardar|permiso|segura/i);
    await assert.rejects(stat(destination), { code: 'ENOENT' });
    assert.equal((await readdir(f.root)).some(name => name.startsWith('.voice-studio-export-')), false);
    assert.deepEqual(await readFile(f.source), original);
    fail = false;
    assert.deepEqual(await exporter.save(f.clips[0].id), { path: destination });
  }
});

test('fragmentos desconocidos, modificados, eliminados y selección anterior no se exportan', async t => {
  const f = await fixture(t);
  await assert.rejects(f.exporter.save({ id: f.clips[0].id, path: f.source }), /Argumentos|fragmento/i);
  await assert.rejects(f.exporter.save('desconocido'), /fragmento/i);
  assert.equal(f.dialogs.length, 0);
  await writeFile(fileURLToPath(f.clips[0].url), 'corrupto');
  await assert.rejects(f.exporter.save(f.clips[0].id), /válido|modificado/i);
  await rm(fileURLToPath(f.clips[1].url));
  await assert.rejects(f.exporter.save(f.clips[1].id), /fragmento|guardar/i);
  assert.equal(f.dialogs.length, 0);
  await f.exporter.reset();
  await assert.rejects(f.exporter.save(f.clips[0].id), /fragmento/i);
  await assert.rejects(stat(join(f.root, 'exportado.wav')), { code: 'ENOENT' });
});

test('cambio de selección cancela diálogo pendiente; respuesta tardía y registro tardío no publican', async t => {
  const f = await fixture(t);
  let release!: (value: { canceled: boolean; filePath: string }) => void;
  const exporter = new MediaExportController({ showSaveDialog: () => new Promise(resolve => { release = resolve; }) });
  t.after(() => exporter.dispose());
  await exporter.trackTrim(async () => f.clips[0], 'original.mp4');
  const pending = exporter.save(f.clips[0].id).catch(error => error);
  while (!release) await new Promise<void>(resolve => setImmediate(resolve));
  await assert.rejects(exporter.save(f.clips[1].id), /curso/i);
  await exporter.reset();
  assert.match((await pending).message, /cancelad|selección/i);
  release({ canceled: false, filePath: join(f.root, 'tardío.wav') });
  await new Promise<void>(resolve => setImmediate(resolve));
  await assert.rejects(stat(join(f.root, 'tardío.wav')), { code: 'ENOENT' });
  let resolveClip!: (value: typeof f.clips[0]) => void;
  const late = exporter.trackTrim(() => new Promise(resolve => { resolveClip = resolve; }), 'anterior.mp4').catch(error => error);
  await exporter.reset();
  resolveClip(f.clips[0]);
  assert.match((await late).message, /selección|cancelad/i);
  await assert.rejects(exporter.save(f.clips[0].id), /fragmento/i);
});

test('dispose durante copia espera la operación, retira parciales y no publica', async t => {
  const f = await fixture(t);
  let release!: () => void;
  let entered!: () => void;
  const copied = new Promise<void>(resolve => { entered = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  const destination = join(f.root, 'cierre.wav');
  const exporter = new MediaExportController({ showSaveDialog: async () => ({ canceled: false, filePath: destination }), fileSystem: { copyFile: async (source, target) => { await copyFile(source, target); entered(); await hold; } } });
  t.after(() => exporter.dispose());
  await exporter.trackTrim(async () => f.clips[0], 'original.mp4');
  const pending = exporter.save(f.clips[0].id).catch(error => error);
  await copied;
  let disposed = false;
  const closing = exporter.dispose().then(() => { disposed = true; });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(disposed, false);
  release(); await closing;
  assert.match((await pending).message, /cancelad|selección/i);
  await assert.rejects(stat(destination), { code: 'ENOENT' });
  assert.equal((await readdir(f.root)).some(name => name.startsWith('.voice-studio-export-')), false);
  await assert.rejects(exporter.save(f.clips[0].id), /cerrad/i);
});
