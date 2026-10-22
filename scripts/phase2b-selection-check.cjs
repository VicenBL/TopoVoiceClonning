const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { createServer } = require('node:net');
const { mkdir, rm, writeFile } = require('node:fs/promises');
const { existsSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { join, resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const root = process.cwd();
const electron = resolve('node_modules/electron/dist/electron.exe');
assert(existsSync(electron), `Electron executable not found: ${electron}`);
const profile = join(root, `.phase2b-selection-check-${randomUUID()}`);
const fixture = join(profile, 'native-selection.wav');
const userDataDir = join(profile, 'user-data');
const nativeScript = join(profile, 'select-file.ps1');
let child;
let socket;
let requestId = 0;

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const port = server.address().port;
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  return port;
}

function cdp(method, params = {}) {
  const id = ++requestId;
  return new Promise((resolveResponse, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 8000);
    const receive = event => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      socket.removeEventListener('message', receive);
      clearTimeout(timer);
      if (message.error) reject(new Error(message.error.message));
      else resolveResponse(message.result);
    };
    socket.addEventListener('message', receive);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.result?.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null) throw new Error(`Electron exited early (${child.exitCode})`);
    if (await check()) return;
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function chooseNativeFile(pid) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', nativeScript, String(pid), fixture], {
    encoding: 'utf8', timeout: 10000,
  });
  if (result.status !== 0) throw new Error(`Native dialog automation failed: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

(async () => {
  try {
    await mkdir(userDataDir, { recursive: true });
    await mkdir(join(profile, 'Roaming'), { recursive: true });
    await mkdir(join(profile, 'Local'), { recursive: true });
    await writeFile(fixture, Buffer.alloc(44));
    await writeFile(nativeScript, String.raw`param([int]$TargetPid, [string]$FilePath)
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class VoiceStudioDialogAutomation {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int processId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  public static IntPtr FindDialog(int targetPid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((hWnd, lParam) => {
      int processId;
      GetWindowThreadProcessId(hWnd, out processId);
      var title = new StringBuilder(512);
      if (processId == targetPid && IsWindowVisible(hWnd) && GetWindowText(hWnd, title, title.Capacity) > 0 && title.ToString().Contains("Seleccionar archivo")) {
        found = hWnd; return false;
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@
$dialog = [VoiceStudioDialogAutomation]::FindDialog($TargetPid)
if ($dialog -eq [IntPtr]::Zero) { Write-Error 'Native file dialog not found'; exit 2 }
[VoiceStudioDialogAutomation]::SetForegroundWindow($dialog) | Out-Null
Start-Sleep -Milliseconds 300
[System.Windows.Forms.SendKeys]::SendWait('%n')
[System.Windows.Forms.SendKeys]::SendWait('^a')
[System.Windows.Forms.SendKeys]::SendWait($FilePath)
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
'file selection sent'
`);

    const debugPort = await freePort();
    child = spawn(electron, [`--user-data-dir=${userDataDir}`, root, `--remote-debugging-port=${debugPort}`], {
      cwd: root,
      env: { ...process.env, APPDATA: join(profile, 'Roaming'), LOCALAPPDATA: join(profile, 'Local') },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const pagesUrl = `http://127.0.0.1:${debugPort}/json/list`;
    let pages;
    await waitFor(async () => {
      try { const response = await fetch(pagesUrl); if (!response.ok) return false; pages = await response.json(); return true; }
      catch { return false; }
    }, 'Electron renderer');
    const page = pages.find(item => item.type === 'page');
    assert(page, 'Electron renderer target is missing');
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolveOpen, reject) => {
      socket.addEventListener('open', resolveOpen, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    await waitFor(() => evaluate('Boolean(window.voiceStudio?.media?.selectFile)'));
    await waitFor(() => evaluate(`Boolean([...document.querySelectorAll('.nav-item')].find(button=>button.textContent.includes('Clonar voz')))`), 'React navigation');
    const opened = await evaluate(`(()=>{const nav=[...document.querySelectorAll('.nav-item')].find(button=>button.textContent.includes('Clonar voz'));if(!nav)return false;nav.click();return true})()`);
    assert.equal(opened, true, 'CloneVoice navigation button is missing');
    await waitFor(() => evaluate(`Boolean([...document.querySelectorAll('.screen-panel.active button')].find(button=>button.textContent.includes('Seleccionar archivo')))`), 'selection button');
    const launched = await evaluate(`(()=>{const button=[...document.querySelectorAll('.screen-panel.active button')].find(item=>item.textContent.includes('Seleccionar archivo'));if(!button||button.disabled)return false;button.click();return true})()`);
    assert.equal(launched, true, 'Selection control could not be activated');
    await delay(700);
    const automation = chooseNativeFile(child.pid);
    await waitFor(() => evaluate(`document.querySelector('.screen-panel.active [role="status"]')?.textContent.includes('native-selection.wav')`), 'native selection to render');
    const observed = await evaluate(`document.querySelector('.screen-panel.active [role="status"]')?.textContent ?? ''`);
    assert(observed.includes(fixture), `Selected path not shown in renderer: ${observed}`);
    console.log(JSON.stringify({ result: 'PASS', proof: 'real Electron app and native Windows file dialog', automation, observed }, null, 2));
  } catch (error) {
    console.error(`PHASE2B_SELECTION_FAIL: ${error.message}`);
    process.exitCode = 1;
  } finally {
    socket?.close();
    if (child && child.exitCode === null) child.kill();
    if (child) await Promise.race([new Promise(resolveExit => child.once('exit', resolveExit)), delay(3000)]);
    await rm(profile, { recursive: true, force: true });
  }
})();
