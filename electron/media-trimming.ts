import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { PreparedMedia } from './media-preparation.ts';
import type { MediaTrimRequest, TrimmedMediaFile } from './media-contract.ts';

export const TRIM_DURATION_TOLERANCE_SEC = 0.05;

export function validateTrimRequest(value: unknown): MediaTrimRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'endSec,sourceUrl,startSec') {
    throw new Error('Argumentos del intervalo no permitidos.');
  }
  const request = value as MediaTrimRequest;
  if (typeof request.sourceUrl !== 'string' || !request.sourceUrl
    || typeof request.startSec !== 'number' || !Number.isFinite(request.startSec)
    || typeof request.endSec !== 'number' || !Number.isFinite(request.endSec)
    || request.startSec < 0 || request.endSec <= request.startSec) {
    throw new Error('El intervalo debe tener tiempos finitos, no negativos e inicio menor que fin.');
  }
  return { sourceUrl: request.sourceUrl, startSec: request.startSec, endSec: request.endSec };
}

interface TrimOperation {
  version: number;
  child: ChildProcess | null;
  canceled: Promise<void>;
  cancelWait: () => void;
  promise: Promise<TrimmedMediaFile>;
}

interface Options {
  tempRoot: string;
  prepareSelected: () => Promise<PreparedMedia>;
  spawnProcess?: typeof spawn;
  ffmpegPath?: string;
  ffprobePath?: string;
}

export class MediaTrimmingController {
  private active: TrimOperation | null = null;
  private version = 0;
  private disposed = false;
  private resetPromise: Promise<void> | null = null;
  private readonly directories = new Set<string>();
  private readonly spawnProcess: typeof spawn;
  private readonly options: Options;

  constructor(options: Options) {
    this.options = options;
    this.spawnProcess = options.spawnProcess ?? spawn;
  }

  trim(value: unknown): Promise<TrimmedMediaFile> {
    try {
      if (this.disposed) throw new Error('La sesión de recortes está cerrada.');
      if (this.active || this.resetPromise) throw new Error('Hay un recorte o limpieza en curso.');
      const request = validateTrimRequest(value);
      let cancelWait!: () => void;
      const canceled = new Promise<void>(resolve => { cancelWait = resolve; });
      const operation: TrimOperation = { version: this.version, child: null, canceled, cancelWait, promise: null! };
      this.active = operation;
      operation.promise = this.run(operation, request);
      return operation.promise;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  reset(): Promise<void> {
    if (this.resetPromise) return this.resetPromise;
    this.version++;
    const active = this.active;
    active?.cancelWait();
    if (active?.child && active.child.exitCode === null && active.child.signalCode === null) active.child.kill();
    this.resetPromise = (async () => {
      if (active) await active.promise.catch(() => {});
      for (const directory of this.directories) {
        await rm(directory, { recursive: true, force: true });
        this.directories.delete(directory);
      }
    })().finally(() => { this.resetPromise = null; });
    return this.resetPromise;
  }

  dispose(): Promise<void> {
    this.disposed = true;
    return this.reset();
  }

  private assertCurrent(operation: TrimOperation): void {
    if (this.disposed || operation.version !== this.version || this.active !== operation) {
      throw new Error('El recorte fue cancelado o sustituido.');
    }
  }

  private async run(operation: TrimOperation, request: MediaTrimRequest): Promise<TrimmedMediaFile> {
    let directory: string | null = null;
    let published = false;
    try {
      // Closing a trim must not wait for the preparation that main still needs to cancel.
      const source = await Promise.race([
        this.options.prepareSelected(),
        operation.canceled.then(() => { throw new Error('El recorte fue cancelado o sustituido.'); }),
      ]);
      this.assertCurrent(operation);
      if (source.url !== request.sourceUrl) throw new Error('El archivo seleccionado cambió; vuelve a elegir el intervalo.');
      if (source.durationSec === null || !Number.isFinite(source.durationSec) || source.durationSec <= 0) {
        throw new Error('Se necesita una duración conocida para validar el intervalo.');
      }
      if (request.endSec > source.durationSec) throw new Error('El intervalo supera la duración del archivo.');
      await mkdir(this.options.tempRoot, { recursive: true });
      this.assertCurrent(operation);
      directory = await mkdtemp(join(this.options.tempRoot, 'voice-studio-trim-'));
      this.directories.add(directory);
      this.assertCurrent(operation);
      const output = join(directory, 'fragment.wav');
      // Only main's prepared source is used, never a renderer-supplied input/output path.
      await this.runChild(operation, this.options.ffmpegPath ?? 'ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe',
        '-i', fileURLToPath(source.url), '-ss', String(request.startSec), '-t', String(request.endSec - request.startSec),
        '-map', '0:a:0', '-vn', '-c:a', 'pcm_s16le', '-ac', '1', '-ar', '48000', '-f', 'wav', '-y', output,
      ]);
      this.assertCurrent(operation);
      const outputStat = await stat(output);
      this.assertCurrent(operation);
      if (!outputStat.isFile() || outputStat.size <= 44) throw new Error('FFmpeg no produjo un fragmento válido.');
      const raw = await this.runChild(operation, this.options.ffprobePath ?? 'ffprobe', [
        '-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_streams', '-show_format', '-of', 'json', output,
      ]);
      this.assertCurrent(operation);
      const metadata = JSON.parse(raw);
      const audio = metadata.streams?.find((stream: { codec_type?: string }) => stream.codec_type === 'audio');
      const durationSec = Number(metadata.format?.duration);
      if (!Number.isFinite(durationSec) || durationSec <= 0
        || Math.abs(durationSec - (request.endSec - request.startSec)) > TRIM_DURATION_TOLERANCE_SEC
        || audio?.codec_name !== 'pcm_s16le' || audio?.channels !== 1 || audio?.sample_rate !== '48000') {
        throw new Error('El fragmento no cumple el formato o la duración solicitados (tolerancia 50 ms).');
      }
      const result = { id: randomUUID(), url: pathToFileURL(output).href, sourceUrl: source.url, startSec: request.startSec, endSec: request.endSec, durationSec };
      this.assertCurrent(operation);
      published = true;
      return result;
    } catch (error) {
      this.assertCurrent(operation);
      throw new Error(`No se pudo recortar el audio: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      try {
        if (directory && !published) {
          await rm(directory, { recursive: true, force: true });
          this.directories.delete(directory);
        }
      } finally {
        if (this.active === operation) this.active = null;
      }
    }
  }

  private runChild(operation: TrimOperation, command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      try { this.assertCurrent(operation); } catch (error) { reject(error); return; }
      let child: ChildProcess;
      try {
        child = this.spawnProcess(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (error) { reject(error); return; }
      operation.child = child;
      let stdout = '';
      let stderr = '';
      let failure: Error | null = null;
      const timeout = setTimeout(() => { failure = new Error('FFmpeg/ffprobe excedió el tiempo máximo de 60 segundos.'); child.kill(); }, 60000);
      child.stdout!.on('data', (chunk: Buffer) => {
        if (stdout.length + chunk.length > 1024 * 1024) { failure = new Error('Respuesta de herramienta demasiado grande.'); child.kill(); }
        else stdout += chunk.toString('utf8');
      });
      child.stderr!.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(0, 65536); });
      child.once('error', error => { failure = new Error(`La herramienta no está disponible: ${error.message}`); });
      child.once('close', code => {
        clearTimeout(timeout);
        if (operation.child === child) operation.child = null;
        if (failure) reject(failure);
        else if (code !== 0) reject(new Error(`${command} terminó con código ${code}: ${stderr.trim()}`));
        else resolve(stdout);
      });
    });
  }
}
