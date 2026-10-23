import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Tray } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { DesktopServiceController, resolveCloseAction } from './desktop-controller.ts';
import { SERVICE_CHANNELS } from './service-contract.ts';
import { registerMediaSelectionIpc } from './media-selection.ts';
import { MediaPreparationController } from './media-preparation.ts';
import { MediaTrimmingController } from './media-trimming.ts';
import { registerServiceIpc } from './service-ipc.ts';
import { isTrustedRendererUrl } from './renderer-security.ts';
import { hideWithoutBlocking, resolveTrayIconPath, tryCreateTray } from './tray-support.ts';

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const productionPage = join(currentDirectory, '..', 'dist', 'index.html');
const trustedRendererUrl = process.env.VITE_DEV_SERVER_URL ?? pathToFileURL(productionPage).href;
const controller = new DesktopServiceController({
  port: 4317,
  autoStart: false,
  keepRunningOnClose: true,
});

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let quitPromise: Promise<void> | null = null;
let unregisterIpc: (() => void) | null = null;
let unregisterMediaIpc: (() => void) | null = null;
let mediaPreparation: MediaPreparationController | null = null;
let mediaTrimming: MediaTrimmingController | null = null;
let closePromise: Promise<void> | null = null;
let signalInitialPreferences: (() => void) | undefined;
const initialPreferencesReady = new Promise<void>(resolve => { signalInitialPreferences = resolve; });
const INITIAL_PREFERENCES_WAIT_MS = 3000;

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }
  mainWindow.show();
  mainWindow.focus();
}

function createTray(): void {
  if (tray) return;
  tray = tryCreateTray(
    resolveTrayIconPath(app.getAppPath()),
    iconPath => {
      const image = nativeImage.createFromPath(iconPath);
      return image.isEmpty() ? undefined : new Tray(image);
    },
    instance => {
      instance.setToolTip('Voice Studio');
      instance.setContextMenu(Menu.buildFromTemplate([
        { label: 'Mostrar Voice Studio', click: showMainWindow },
        { type: 'separator' },
        { label: 'Salir', click: () => void requestQuit() },
      ]));
      instance.on('double-click', showMainWindow);
    },
    instance => instance.destroy(),
  ) ?? null;
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    webPreferences: {
      preload: join(currentDirectory, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url, trustedRendererUrl)) event.preventDefault();
  });
  window.once('ready-to-show', () => window.show());
  window.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    if (!closePromise) {
      closePromise = closeWithEffectivePreferences(window).finally(() => { closePromise = null; });
    }
  });
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });

  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) void window.loadURL(developmentUrl);
  else void window.loadFile(join(currentDirectory, '..', 'dist', 'index.html'));

  mainWindow = window;
  return window;
}

async function closeWithEffectivePreferences(window: BrowserWindow): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const configured = await Promise.race([
    initialPreferencesReady.then(() => true),
    new Promise<boolean>(resolve => {
      timeout = setTimeout(() => resolve(false), INITIAL_PREFERENCES_WAIT_MS);
    }),
  ]);
  if (timeout) clearTimeout(timeout);
  if (!configured) {
    await requestQuit();
    return;
  }
  const action = resolveCloseAction(controller.getPreferences().keepRunningOnClose, quitting);
  if (action === 'hide') hideWithoutBlocking(createTray, () => window.hide());
  else if (action === 'quit') await requestQuit();
}

async function requestQuit(): Promise<void> {
  if (quitPromise) return quitPromise;
  quitting = true;
  const closeMedia = async () => { await mediaTrimming?.dispose(); await mediaPreparation?.dispose(); };
  quitPromise = Promise.all([controller.shutdown(), closeMedia()]).then(() => {
    unregisterIpc?.();
    unregisterIpc = null;
    unregisterMediaIpc?.();
    unregisterMediaIpc = null;
    tray?.destroy();
    tray = null;
    app.quit();
  });
  return quitPromise;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', showMainWindow);
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault();
    void requestQuit();
  });
  app.on('activate', showMainWindow);

  void app.whenReady().then(() => {
    mediaPreparation = new MediaPreparationController({ tempRoot: app.getPath('temp') });
    mediaTrimming = new MediaTrimmingController({ tempRoot: app.getPath('temp'), prepareSelected: () => mediaPreparation!.prepare() });
    const isTrustedSender = (event: { sender?: { id?: number }; senderFrame?: { url?: string } }) => Boolean(
      mainWindow
      && event.sender?.id === mainWindow.webContents.id
      && isTrustedRendererUrl(event.senderFrame?.url, trustedRendererUrl),
    );
    unregisterIpc = registerServiceIpc(
      {
        handle(channel, listener) {
          ipcMain.handle(channel, async (event, ...args) => {
            const result = await listener(event, ...args);
            if (channel === SERVICE_CHANNELS.configure) signalInitialPreferences?.();
            return result;
          });
        },
        removeHandler: channel => ipcMain.removeHandler(channel),
      },
      controller,
      snapshot => mainWindow?.webContents.send(SERVICE_CHANNELS.stateChanged, snapshot),
      isTrustedSender,
    );
    unregisterMediaIpc = registerMediaSelectionIpc(
      ipcMain,
      { showOpenDialog: (owner, options) => dialog.showOpenDialog(owner as BrowserWindow, options) },
      () => {
        if (!mainWindow || mainWindow.isDestroyed()) throw new Error('La ventana principal no está disponible.');
        return mainWindow;
      },
      isTrustedSender,
      mediaPreparation,
      mediaTrimming,
    );
    createMainWindow();
  });
}
