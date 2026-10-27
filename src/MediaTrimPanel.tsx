import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { TrimmedMediaFile } from '../electron/media-contract';

type Props = {
  sourceUrl: string;
  durationSec: number | null;
  sourceName: string;
  sourceAudio: RefObject<HTMLAudioElement | null>;
  disabled: boolean;
};

function FragmentPlayer({ clip, disabled }: { clip: TrimmedMediaFile; disabled: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const element = audio.current;
    if (disabled && element) { element.pause(); element.removeAttribute('src'); element.load(); }
  }, [disabled]);
  useEffect(() => {
    const element = audio.current;
    return () => { if (element) { element.pause(); element.removeAttribute('src'); element.load(); } };
  }, []);
  return <>
    <audio ref={audio} aria-label={`Reproducir fragmento ${clip.id}`} controls preload="metadata" src={disabled ? undefined : clip.url} onError={() => { if (!disabled) setError(true); }} />
    {error && <p role="alert">No se pudo reproducir el fragmento.</p>}
  </>;
}

function SaveFragment({ id, number, disabled }: { id: string; number: number; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const save = async () => {
    if (disabled || pending.current) return;
    pending.current = true; setBusy(true); setMessage(null); setError(null);
    try {
      const bridge = window.voiceStudio?.media;
      if (!bridge) throw new Error('El host de escritorio no está disponible.');
      const result = await bridge.saveWav(id);
      if (result && mounted.current && !disabledRef.current) {
        setMessage(`WAV guardado: ${result.path}${result.warning ? ` · ${result.warning}` : ''}`);
      }
    } catch (failure) {
      if (mounted.current && !disabledRef.current) setError(failure instanceof Error ? failure.message : 'No se pudo guardar el WAV.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return <div>
    <button className="btn" aria-label={`Guardar WAV del fragmento ${number}`} disabled={disabled || busy} onClick={() => void save()}>{busy ? 'Guardando WAV…' : 'Guardar WAV'}</button>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="compat warn">{error}</p>}
  </div>;
}

export function MediaTrimPanel({ sourceUrl, durationSec, sourceName, sourceAudio, disabled }: Props) {
  const [start, setStart] = useState('0');
  const [end, setEnd] = useState(durationSec?.toString() ?? '');
  const [clips, setClips] = useState<TrimmedMediaFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const startSec = start.trim() ? Number(start) : NaN;
  const endSec = end.trim() ? Number(end) : NaN;
  const knownDuration = durationSec !== null && Number.isFinite(durationSec) && durationSec > 0;
  const valid = knownDuration && Number.isFinite(startSec) && Number.isFinite(endSec)
    && startSec >= 0 && startSec < endSec && endSec <= durationSec;
  const inputDisabled = disabled || busy;
  const mark = (setTime: (time: string) => void) => {
    const time = sourceAudio.current?.currentTime;
    if (time !== undefined && Number.isFinite(time)) setTime(time.toString());
  };
  const trim = async () => {
    if (!valid || disabled || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const bridge = window.voiceStudio?.media;
      if (!bridge) throw new Error('El host de escritorio no está disponible.');
      const clip = await bridge.trimSelected({ sourceUrl, startSec, endSec });
      if (mounted.current && clip.sourceUrl === sourceUrl) setClips(current => [...current, clip]);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : 'No se pudo recortar el audio.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return <section className="stack" aria-label="Recortes de audio">
    <h3>Recortar audio · {sourceName}</h3>
    <div className="grid two compact">
      <label>Inicio (segundos)
        <input aria-label="Inicio del recorte (segundos)" type="number" step="any" min="0" max={durationSec ?? undefined} value={start} disabled={inputDisabled} onChange={event => setStart(event.target.value)} />
      </label>
      <label>Fin (segundos)
        <input aria-label="Fin del recorte (segundos)" type="number" step="any" min="0" max={durationSec ?? undefined} value={end} disabled={inputDisabled} onChange={event => setEnd(event.target.value)} />
      </label>
    </div>
    <div className="toolbar">
      <button className="btn ghost" disabled={inputDisabled} onClick={() => mark(setStart)}>Usar posición como inicio</button>
      <button className="btn ghost" disabled={inputDisabled} onClick={() => mark(setEnd)}>Usar posición como fin</button>
      <button className="btn primary" disabled={inputDisabled || !valid} onClick={() => void trim()}>{busy ? 'Recortando audio…' : 'Generar fragmento WAV'}</button>
    </div>
    <p role="status" className="muted">Inicio {Number.isFinite(startSec) ? startSec.toFixed(3) : '—'} s · fin {Number.isFinite(endSec) ? endSec.toFixed(3) : '—'} s · duración del fragmento {valid ? (endSec - startSec).toFixed(3) : '—'} s</p>
    {!knownDuration ? <p className="compat warn">Se necesita una duración conocida para recortar.</p> : !valid && <p className="compat warn">Elige un intervalo finito: 0 ≤ inicio &lt; fin ≤ {durationSec.toFixed(3)} s.</p>}
    {busy && <p role="status">Recortando audio… No se publicará hasta comprobar el WAV.</p>}
    {error && <p role="alert" className="compat warn">{error}</p>}
    {clips.map((clip, index) => <div className="ref-card" key={clip.id}>
      <strong>Fragmento {index + 1} · {sourceName}</strong>
      <p className="muted">{clip.startSec.toFixed(3)}–{clip.endSec.toFixed(3)} s · duración real {clip.durationSec.toFixed(3)} s · PCM 16 bits, mono, 48 kHz</p>
      <FragmentPlayer clip={clip} disabled={disabled} />
      <SaveFragment id={clip.id} number={index + 1} disabled={disabled} />
    </div>)}
    <p className="muted">Fragmentos temporales de esta sesión. Tolerancia de duración: 50 ms. Se eliminan al cambiar de archivo o salir; los WAV guardados permanecen en tu PC. Guardar WAV copia el fragmento sin recodificar y nunca reemplaza un archivo existente.</p>
  </section>;
}
