import { contextBridge, ipcRenderer } from 'electron';

import { createMediaBridge, createServiceBridge, type RendererIpcAdapter } from './preload-bridge.ts';

const ipc: RendererIpcAdapter = {
  invoke: (channel, payload) => payload === undefined
    ? ipcRenderer.invoke(channel)
    : ipcRenderer.invoke(channel, payload),
  on: (channel, listener) => ipcRenderer.on(channel, listener),
  removeListener: (channel, listener) => ipcRenderer.removeListener(channel, listener),
};

const service = Object.freeze(createServiceBridge(ipc));
const media = Object.freeze(createMediaBridge(ipc));
contextBridge.exposeInMainWorld('voiceStudio', Object.freeze({ service, media }));
