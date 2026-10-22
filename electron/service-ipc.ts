import { DesktopServiceController } from './desktop-controller.ts';
import { SERVICE_CHANNELS, type ServiceSnapshot } from './service-contract.ts';

export interface IpcMainAdapter {
  handle(channel: string, listener: (...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
}

export interface IpcSenderEvent {
  sender?: { id?: number };
  senderFrame?: { url?: string };
}

type IsTrustedSender = (event: IpcSenderEvent) => boolean;

function requireTrustedSender(event: unknown, isTrustedSender: IsTrustedSender): void {
  if (!event || typeof event !== 'object' || !isTrustedSender(event as IpcSenderEvent)) {
    throw new Error('Emisor IPC no autorizado.');
  }
}

const INVOKE_CHANNELS = [
  SERVICE_CHANNELS.getState,
  SERVICE_CHANNELS.configure,
  SERVICE_CHANNELS.start,
  SERVICE_CHANNELS.stop,
  SERVICE_CHANNELS.restart,
  SERVICE_CHANNELS.getDiagnostics,
] as const;

export function registerServiceIpc(
  ipcMain: IpcMainAdapter,
  controller: DesktopServiceController,
  publish: (snapshot: ServiceSnapshot) => void,
  isTrustedSender: IsTrustedSender,
): () => void {
  ipcMain.handle(SERVICE_CHANNELS.getState, event => {
    requireTrustedSender(event, isTrustedSender);
    return controller.getState();
  });
  ipcMain.handle(SERVICE_CHANNELS.configure, (event, value) => {
    requireTrustedSender(event, isTrustedSender);
    return controller.configure(value);
  });
  ipcMain.handle(SERVICE_CHANNELS.start, event => {
    requireTrustedSender(event, isTrustedSender);
    return controller.start();
  });
  ipcMain.handle(SERVICE_CHANNELS.stop, event => {
    requireTrustedSender(event, isTrustedSender);
    return controller.stop();
  });
  ipcMain.handle(SERVICE_CHANNELS.restart, event => {
    requireTrustedSender(event, isTrustedSender);
    return controller.restart();
  });
  ipcMain.handle(SERVICE_CHANNELS.getDiagnostics, event => {
    requireTrustedSender(event, isTrustedSender);
    return controller.getDiagnostics();
  });
  const unsubscribe = controller.onStateChange(publish);

  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    unsubscribe();
    for (const channel of INVOKE_CHANNELS) ipcMain.removeHandler(channel);
  };
}
