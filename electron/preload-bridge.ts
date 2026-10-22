import { MEDIA_CHANNELS, type MediaBridge } from './media-contract.ts';
import {
  SERVICE_CHANNELS,
  type ServiceBridge,
  type ServiceDiagnostic,
  type ServicePreferences,
  type ServiceSnapshot,
} from './service-contract.ts';

export interface RendererIpcAdapter {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
  on(channel: string, listener: (...args: unknown[]) => void): void;
  removeListener(channel: string, listener: (...args: unknown[]) => void): void;
}

export function createMediaBridge(ipc: RendererIpcAdapter): MediaBridge {
  return {
    selectFile: () => ipc.invoke(MEDIA_CHANNELS.select) as Promise<Awaited<ReturnType<MediaBridge['selectFile']>>>,
  };
}

export function createServiceBridge(ipc: RendererIpcAdapter): ServiceBridge {
  return {
    getState: () => ipc.invoke(SERVICE_CHANNELS.getState) as Promise<ServiceSnapshot>,
    configure: (preferences: ServicePreferences) => ipc.invoke(SERVICE_CHANNELS.configure, preferences) as Promise<ServiceSnapshot>,
    start: () => ipc.invoke(SERVICE_CHANNELS.start) as Promise<ServiceSnapshot>,
    stop: () => ipc.invoke(SERVICE_CHANNELS.stop) as Promise<ServiceSnapshot>,
    restart: () => ipc.invoke(SERVICE_CHANNELS.restart) as Promise<ServiceSnapshot>,
    getDiagnostics: () => ipc.invoke(SERVICE_CHANNELS.getDiagnostics) as Promise<ServiceDiagnostic[]>,
    onStateChange: listener => {
      const handler = (_event: unknown, snapshot: unknown) => listener(snapshot as ServiceSnapshot);
      ipc.on(SERVICE_CHANNELS.stateChanged, handler);
      return () => ipc.removeListener(SERVICE_CHANNELS.stateChanged, handler);
    },
  };
}
