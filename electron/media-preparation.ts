import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface PreparedMedia {
  url: string;
  durationSec: number | null;
}

export interface MediaPreparationFileSystem {
  mkdir: typeof mkdir;
  mkdtemp: typeof mkdtemp;
  rm: typeof rm;
  stat: typeof stat;
}

export interface MediaPreparationOptions {
  tempRoot?: string;
  ffprobePath?: string;
  ffmpegPath?: string;
  spawnProcess?: typeof spawn;
  fileSystem?: Partial<MediaPreparationFileSystem>;
  timeoutMs?: number;
}

interface ProbeResult {
  streams?: Array<{ codec_type?: unknown; duration?: unknown }>;
  format?: { duration?: unknown };
}

interface ActivePreparation {
  generation: number;
  process: ChildProcessWithoutNullStreams | null;
  directory: string | null;
  promise: Promise<PreparedMedia>;
}

const MAX_STDOUT = 1024 * 1024;
const MAX_STDERR = 64 * 1024;
const CHILD_TIMEOUT_MS = 60_000;

function parseDuration(value: unknown): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const duration = Number(value);
  return Number.isFinite(duration) && duration >= 0 ? duration : null;
}

export class MediaPreparationController {
  private readonly tempRoot: string;
  private readonly ffprobePath: string;
  private readonly ffmpegPath: string;
  private readonly spawnProcess: typeof spawn;
  private readonly fileSystem: MediaPreparationFileSystem;
  private readonly timeoutMs: number;
  private selectedPath: string | null = null;
  private active: ActivePreparation | null = null;
  private ready: PreparedMedia | null = null;
  private readyDirectory: string | null = null;
  private generation = 0;
  private disposed = false;
  private disposePromise: Promise<void> | null = null;

  constructor(options: MediaPreparationOptions = {}) {
    this.tempRoot = options.tempRoot ?? tmpdir();
    this.ffprobePath = options.ffprobePath ?? 'ffprobe';
    this.ffmpegPath = options.ffmpegPath ?? 'ffmpeg';
    this.spawnProcess = options.spawnProcess ?? spawn;
    this.fileSystem = {
      mkdir: options.fileSystem?.mkdir ?? mkdir,
      mkdtemp: options.fileSystem?.mkdtemp ?? mkdtemp,
      rm: options.fileSystem?.rm ?? rm,
      stat: options.fileSystem?.stat ?? stat,
    };
    this.timeoutMs = options.timeoutMs ?? CHILD_TIMEOUT_MS;
  }

  async select(path: string | null): Promise<boolean> {
    if (this.disposed) throw new Error('La preparación de medios ya está cerrada.');
    if (path === null) return false;
    await this.invalidate(false);
    if (this.disposed) throw new Error('La preparación de medios ya está cerrada.');
    this.selectedPath = path;
    return true;
  }

  async prepare(): Promise<PreparedMedia> {
    if (this.disposed) throw new Error('La preparación de medios ya está cerrada.');
    if (!this.selectedPath) throw new Error('Selecciona primero un archivo de audio o vídeo.');
    if (this.ready) return this.ready;
    if (this.active) return this.active.promise;
    if (this.readyDirectory) {
      const previousDirectory = this.readyDirectory;
      this.readyDirectory = null;
      await this.fileSystem.rm(previousDirectory, { recursive: true, force: true });
      if (this.disposed || !this.selectedPath) throw new Error('La preparación de medios ya está cerrada.');
    }

    const generation = ++this.generation;
    const record: ActivePreparation = {
      generation,
      process: null,
      directory: null,
      promise: Promise.resolve({ url: '', durationSec: null }),
    };
    this.active = record;
    record.promise = this.runPreparation(record, this.selectedPath);
    return record.promise;
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    if (this.disposed) return Promise.resolve();
    this.disposed = true;
    this.disposePromise = this.invalidate().then(() => { this.selectedPath = null; });
    return this.disposePromise;
  }

  private async invalidate(removeReady = true): Promise<void> {
    this.generation += 1;
    const active = this.active;
    if (active?.process && active.process.exitCode === null && active.process.signalCode === null) {
      active.process.kill();
    }
    if (active) {
      try { await active.promise; } catch { /* Cancellation and process errors are handled by the caller. */ }
    }
    if (this.active === active) this.active = null;
    if (this.active === null) this.ready = null;
    if (removeReady) {
      const directory = this.readyDirectory;
      this.readyDirectory = null;
      if (directory) await this.fileSystem.rm(directory, { recursive: true, force: true });
    }
  }

  private isCurrent(record: ActivePreparation, source: string): boolean {
    return !this.disposed
      && this.active === record
      && record.generation === this.generation
      && this.selectedPath === source;
  }

  private async runPreparation(record: ActivePreparation, source: string): Promise<PreparedMedia> {
    let directory: string | null = null;
    try {
      const probeOutput = await this.runChild(record, source, this.ffprobePath, [
        '-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_streams', '-show_format', '-of', 'json', source,
      ], MAX_STDOUT);
      if (!this.isCurrent(record, source)) throw new Error('La preparación fue sustituida.');
      let probe: ProbeResult;
      try { probe = JSON.parse(probeOutput) as ProbeResult; }
      catch { throw new Error('ffprobe devolvió metadatos de audio no válidos.'); }
      const audioStreams = Array.isArray(probe.streams) ? probe.streams.filter(stream => stream?.codec_type === 'audio') : [];
      if (!audioStreams.length) throw new Error('El archivo seleccionado no contiene una pista de audio.');
      const durationSec = parseDuration(probe.format?.duration) ?? parseDuration(audioStreams[0]?.duration);

      await this.fileSystem.mkdir(this.tempRoot, { recursive: true });
      if (!this.isCurrent(record, source)) throw new Error('La preparación fue sustituida.');
      directory = await this.fileSystem.mkdtemp(join(this.tempRoot, 'voice-studio-media-'));
      if (!this.isCurrent(record, source)) throw new Error('La preparación fue sustituida.');
      record.directory = directory;
      const output = join(directory, 'prepared.wav');
      await this.runChild(record, source, this.ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe', '-i', source,
        '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le', '-f', 'wav', '-y', output,
      ], MAX_STDOUT);
      if (!this.isCurrent(record, source)) throw new Error('La preparación fue sustituida.');
      const outputStats = await this.fileSystem.stat(output);
      if (!this.isCurrent(record, source)) throw new Error('La preparación fue sustituida.');
      if (!outputStats.isFile() || outputStats.size <= 44) throw new Error('FFmpeg no produjo un archivo de audio válido.');
      const result = { url: pathToFileURL(output).href, durationSec };
      if (!this.isCurrent(record, source)) throw new Error('La preparación fue sustituida.');
      this.ready = result;
      this.readyDirectory = directory;
      directory = null;
      return result;
    } catch (error) {
      if (!this.isCurrent(record, source)) throw new Error('La preparación del archivo fue cancelada o sustituida.');
      const message = error instanceof Error ? error.message : 'Error desconocido';
      throw new Error(`No se pudo preparar el audio: ${message}`);
    } finally {
      if (directory) await this.fileSystem.rm(directory, { recursive: true, force: true });
      if (this.active === record) this.active = null;
    }
  }

  private runChild(record: ActivePreparation, source: string, command: string, args: string[], maxOutput: number): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.isCurrent(record, source)) {
        reject(new Error('La preparación fue cancelada o sustituida.'));
        return;
      }
      let child: ChildProcessWithoutNullStreams;
      try {
        child = this.spawnProcess(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }) as unknown as ChildProcessWithoutNullStreams;
      } catch (error) {
        reject(new Error(`${command} no está disponible: ${error instanceof Error ? error.message : String(error)}`));
        return;
      }
      record.process = child;
      const stdout: Buffer[] = [];
      let stdoutSize = 0;
      let stderr = '';
      let failure: Error | null = null;
      const timer = setTimeout(() => {
        failure = new Error(`${command} excedió el tiempo máximo de ${this.timeoutMs / 1000} segundos.`);
        child.kill();
      }, this.timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => {
        stdoutSize += chunk.length;
        if (stdoutSize > maxOutput) {
          failure = new Error(`${command} produjo una respuesta demasiado grande.`);
          child.kill();
        } else stdout.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderr.length < MAX_STDERR) stderr += chunk.toString('utf8').slice(0, MAX_STDERR - stderr.length);
      });
      child.once('error', error => { failure = new Error(`${command} no está disponible: ${error.message}`); });
      child.once('close', (code, signal) => {
        clearTimeout(timer);
        if (record.process === child) record.process = null;
        if (failure) reject(failure);
        else if (code !== 0) reject(new Error(`${command} terminó con código ${code ?? signal}: ${stderr.trim() || 'sin detalle'}`));
        else resolve(Buffer.concat(stdout).toString('utf8'));
      });
    });
  }
}
