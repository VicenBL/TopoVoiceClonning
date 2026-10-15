export const LOOPBACK_HOST = '127.0.0.1' as const;

export const SERVICE_CHANNELS = {
  getState: 'service:get-state',
  configure: 'service:configure',
  start: 'service:start',
  stop: 'service:stop',
  restart: 'service:restart',
  getDiagnostics: 'service:get-diagnostics',
  stateChanged: 'service:state-changed',
} as const;

export type ServiceStatus = 'stopped' | 'starting' | 'active' | 'stopping' | 'error';

export interface ServicePreferences {
  port: number;
  autoStart: boolean;
  keepRunningOnClose: boolean;
}

export interface ServiceFailure {
  code: string;
  summary: string;
  detail: string;
  at: string;
  host: typeof LOOPBACK_HOST;
  port: number;
}

export interface ServiceSnapshot {
  status: ServiceStatus;
  host: typeof LOOPBACK_HOST;
  port: number;
  startedAt?: string;
  lastError?: ServiceFailure;
}

export interface ServiceDiagnostic extends ServiceFailure {
  id: string;
}

export interface ServiceBridge {
  getState(): Promise<ServiceSnapshot>;
  configure(preferences: ServicePreferences): Promise<ServiceSnapshot>;
  start(): Promise<ServiceSnapshot>;
  stop(): Promise<ServiceSnapshot>;
  restart(): Promise<ServiceSnapshot>;
  getDiagnostics(): Promise<ServiceDiagnostic[]>;
  onStateChange(listener: (snapshot: ServiceSnapshot) => void): () => void;
}

export function validateServicePreferences(value: unknown): ServicePreferences {
  if (!value || typeof value !== 'object') {
    throw new TypeError('Preferencias del servicio no válidas.');
  }

  const candidate = value as Partial<ServicePreferences>;
  if (
    !Number.isInteger(candidate.port)
    || candidate.port! < 1024
    || candidate.port! > 65535
    || typeof candidate.autoStart !== 'boolean'
    || typeof candidate.keepRunningOnClose !== 'boolean'
  ) {
    throw new TypeError('Preferencias del servicio no válidas.');
  }

  return {
    port: candidate.port!,
    autoStart: candidate.autoStart,
    keepRunningOnClose: candidate.keepRunningOnClose,
  };
}
