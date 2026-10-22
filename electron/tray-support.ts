import { join } from 'node:path';

export function resolveTrayIconPath(appPath: string): string {
  return join(appPath, 'assets', 'tray.ico');
}

export function tryCreateTray<T>(
  iconPath: string,
  create: (path: string) => T | undefined,
  configure: (tray: T) => void,
  dispose?: (tray: T) => void,
): T | undefined {
  let tray: T | undefined;
  try {
    tray = create(iconPath);
    if (tray === undefined) return undefined;
    configure(tray);
    return tray;
  } catch {
    if (tray !== undefined) {
      try { dispose?.(tray); } catch { /* Tray cleanup is best effort. */ }
    }
    return undefined;
  }
}

export function hideWithoutBlocking(createTray: () => unknown, hideWindow: () => void): void {
  try { createTray(); } catch { /* The window must still hide if tray creation fails. */ }
  hideWindow();
}
