import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { copyFile, link, lstat, mkdtemp, rm, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SavedMediaFile, TrimmedMediaFile } from './media-contract.ts';

export interface SaveDialogOptions {
  title: string;
  defaultPath: string;
  filters: Array<{ name: string; extensions: string[] }>;
  properties: ['dontAddToRecent'];
}

type ExportFileSystem = { copyFile: typeof copyFile; link: typeof link; rm: typeof rm };
interface Options {
  showSaveDialog: (options: SaveDialogOptions) => Promise<{ canceled: boolean; filePath?: string }>;
  fileSystem?: Partial<ExportFileSystem>;
}
interface Fragment { path: string; name: string; digest: string }
interface Operation { version: number; committing: boolean; canceled: Promise<void>; cancel: () => void; promise: Promise<SavedMediaFile | null> }

export function validateExportId(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 128) throw new Error('Argumentos del fragmento no permitidos.');
  return value;
}

async function digest(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export class MediaExportController {
  private readonly options: Options;
  private readonly fs: ExportFileSystem;
  private readonly fragments = new Map<string, Fragment>();
  private version = 0;
  private disposed = false;
  private active: Operation | null = null;
  private resetPromise: Promise<void> | null = null;

  constructor(options: Options) {
    this.options = options;
    this.fs = { copyFile, link, rm, ...options.fileSystem };
  }

  // Only main calls this with the controller's validated trim, never renderer paths.
  async trackTrim(create: () => Promise<TrimmedMediaFile>, sourceName: string): Promise<TrimmedMediaFile> {
    this.assertAvailable();
    const version = this.version;
    const clip = await create();
    this.assertVersion(version);
    const path = fileURLToPath(clip.url);
    const fingerprint = await digest(path);
    this.assertVersion(version);
    const stem = basename(sourceName, extname(sourceName)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '').slice(0, 100) || 'audio';
    const number = this.fragments.size + 1;
    this.fragments.set(clip.id, { path, digest: fingerprint, name: `${stem}-fragmento-${number}.wav` });
    return clip;
  }

  save(value: unknown): Promise<SavedMediaFile | null> {
    try {
      this.assertAvailable();
      if (this.active) throw new Error('Hay un guardado en curso; espera a que termine.');
      const id = validateExportId(value);
      const fragment = this.fragments.get(id);
      if (!fragment) throw new Error('El fragmento ya no está disponible en esta selección.');
      let cancel!: () => void;
      const canceled = new Promise<void>(resolve => { cancel = resolve; });
      const operation: Operation = { version: this.version, committing: false, canceled, cancel, promise: null! };
      this.active = operation;
      operation.promise = this.run(operation, fragment).finally(() => { if (this.active === operation) this.active = null; });
      return operation.promise;
    } catch (error) { return Promise.reject(error); }
  }

  reset(): Promise<void> {
    if (this.resetPromise) return this.resetPromise;
    const active = this.active;
    // Once atomic publication starts, finish it before changing the selected source.
    const committing = active?.committing ?? false;
    if (!committing) { this.version++; this.fragments.clear(); active?.cancel(); }
    this.resetPromise = (async () => {
      if (active) await active.promise.catch(() => {});
      if (committing) { this.version++; this.fragments.clear(); }
    })().finally(() => { this.resetPromise = null; });
    return this.resetPromise;
  }

  dispose(): Promise<void> { this.disposed = true; return this.reset(); }

  private assertAvailable(): void {
    if (this.disposed) throw new Error('La sesión de exportación está cerrada.');
    if (this.resetPromise) throw new Error('Hay un cambio de selección o limpieza en curso.');
  }

  private assertVersion(version: number): void {
    if (this.disposed || version !== this.version) throw new Error('El guardado fue cancelado por cierre o cambio de selección.');
  }

  private async run(operation: Operation, fragment: Fragment): Promise<SavedMediaFile | null> {
    let directory: string | null = null;
    let saved: SavedMediaFile | null = null;
    try {
      if (await digest(fragment.path) !== fragment.digest) throw new Error('El fragmento fue modificado y ya no es válido; genera otro.');
      this.assertVersion(operation.version);
      const chosen = await Promise.race([
        this.options.showSaveDialog({ title: 'Guardar fragmento WAV (elige un nombre nuevo)', defaultPath: fragment.name, filters: [{ name: 'Audio WAV', extensions: ['wav'] }], properties: ['dontAddToRecent'] }),
        operation.canceled.then(() => { throw new Error('Guardado cancelado por cambio de selección.'); }),
      ]);
      this.assertVersion(operation.version);
      if (chosen.canceled || !chosen.filePath) return null;
      if (!isAbsolute(chosen.filePath)) throw new Error('El diálogo no devolvió un destino absoluto válido.');
      const destination = extname(chosen.filePath) ? chosen.filePath : `${chosen.filePath}.wav`;
      if (extname(destination).toLowerCase() !== '.wav') throw new Error('Elige un nombre con extensión WAV.');
      const existing = await lstat(destination).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
      if (existing) throw Object.assign(new Error('El destino ya existe. Elige otro nombre; no se reemplaza ningún archivo.'), { code: 'EEXIST' });
      this.assertVersion(operation.version);
      directory = await mkdtemp(join(dirname(destination), '.voice-studio-export-'));
      this.assertVersion(operation.version);
      const staged = join(directory, 'fragment.wav');
      await this.fs.copyFile(fragment.path, staged);
      this.assertVersion(operation.version);
      if (await digest(staged) !== fragment.digest) throw new Error('La copia del fragmento no es válida; no se publicó.');
      await stat(fragment.path);
      this.assertVersion(operation.version);
      // A same-volume hard link publishes complete bytes atomically and NEVER replaces a name.
      // No direct-copy fallback: unsupported filesystems fail closed, without a partial target.
      operation.committing = true;
      await this.fs.link(staged, destination);
      saved = { path: destination };
      return saved;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') throw new Error('El destino ya existe. Elige otro nombre; no se reemplaza ningún archivo.');
      if (code === 'ENOTSUP' || code === 'EOPNOTSUPP' || code === 'EXDEV') throw new Error('No se pudo guardar: este destino no admite la publicación segura. Elige una carpeta en un disco NTFS local.');
      throw new Error(`No se pudo guardar el fragmento WAV: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (directory) {
        try { await this.fs.rm(directory, { recursive: true, force: true }); }
        catch {
          if (saved) saved.warning = 'El WAV se guardó, pero no se pudo retirar su copia temporal de trabajo.';
          else throw new Error('El WAV no se publicó y no se pudo retirar su copia temporal de trabajo.');
        }
      }
    }
  }
}
