import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = process.cwd();
const electron = resolve('node_modules/electron/dist/electron.exe');
assert(existsSync(electron), `Electron executable not found: ${electron}`);

async function reservePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const { port } = server.address();
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  return port;
}

async function isPortFree(port) {
  const server = createServer();
  return await new Promise(resolveCheck => {
    server.once('error', () => resolveCheck(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolveCheck(true)));
  });
}

async function occupyLoopbackPort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return { server, port: server.address().port };
}

async function releaseServer(server) {
  if (server.listening) await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
}

const debugPort = await reservePort();
const profile = join(root, `.phase2a-desktop-check-${randomUUID()}`);
const userDataDir = join(profile, 'electron-user-data');
const env = {
  ...process.env,
  APPDATA: join(profile, 'Roaming'),
  LOCALAPPDATA: join(profile, 'Local'),
};
await mkdir(env.APPDATA, { recursive: true });
await mkdir(env.LOCALAPPDATA, { recursive: true });
await mkdir(userDataDir, { recursive: true });

const nativeWindowScript = join(profile, 'window.ps1');
await writeFile(nativeWindowScript, String.raw`param([int]$TargetPid, [string]$Action)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class VoiceStudioWindowCheck {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int processId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
  public static IntPtr FindMainWindow(int targetPid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((hWnd, lParam) => {
      int processId;
      GetWindowThreadProcessId(hWnd, out processId);
      if (processId == targetPid) {
        var title = new StringBuilder(512);
        if (GetWindowText(hWnd, title, title.Capacity) > 0) { found = hWnd; return false; }
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static bool IsMainWindowVisible(int targetPid) {
    var hWnd = FindMainWindow(targetPid);
    return hWnd != IntPtr.Zero && IsWindowVisible(hWnd);
  }
  public static bool CloseMainWindow(int targetPid) {
    var hWnd = FindMainWindow(targetPid);
    return hWnd != IntPtr.Zero && PostMessage(hWnd, 0x0010, IntPtr.Zero, IntPtr.Zero);
  }
}
'@
if ($Action -eq 'close') {
  if (-not [VoiceStudioWindowCheck]::CloseMainWindow($TargetPid)) { exit 2 }
  'closed'
} elseif ($Action -eq 'visible') {
  [VoiceStudioWindowCheck]::IsMainWindowVisible($TargetPid).ToString().ToLowerInvariant()
} elseif ($Action -eq 'tree') {
  $all = @(Get-CimInstance Win32_Process)
  $ids = New-Object 'System.Collections.Generic.List[int]'
  $ids.Add($TargetPid)
  $changed = $true
  while ($changed) {
    $changed = $false
    foreach ($process in $all) {
      if ($ids.Contains([int]$process.ParentProcessId) -and -not $ids.Contains([int]$process.ProcessId)) {
        $ids.Add([int]$process.ProcessId)
        $changed = $true
      }
    }
  }
  ConvertTo-Json -InputObject @($ids.ToArray()) -Compress
} elseif ($Action -eq 'alive') {
  if (Get-CimInstance Win32_Process -Filter "ProcessId = $TargetPid" -ErrorAction SilentlyContinue) { 'true' } else { 'false' }
} else { exit 3 }
`);

function nativeWindow(action, pid) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', nativeWindowScript, String(pid), action], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Native window ${action} failed (${result.status}): ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function launch(args) {
  return spawn(electron, [`--user-data-dir=${userDataDir}`, ...args], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });
}

function processTree(pid) {
  const value = JSON.parse(nativeWindow('tree', pid));
  return Array.isArray(value) ? value : [value];
}

function processExists(pid) {
  return nativeWindow('alive', pid) === 'true';
}

async function waitFor(condition, label, child, timeoutMs = 8000, { exitPolicy = 'running' } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null && child.exitCode !== 0) throw new Error(`${label}: Electron exited with ${child.exitCode}`);
    if (await condition()) return;
    if (child.exitCode !== null && exitPolicy === 'running') throw new Error(`${label}: Electron exited with ${child.exitCode}`);
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function runWaitForSelfTest() {
  const checks = [];
  const recordSelfTest = (name, passed) => {
    assert(passed, name);
    checks.push(name);
  };

  let normalChecks = 0;
  await waitFor(() => ++normalChecks === 2, 'normal wait', { exitCode: null }, 250);
  recordSelfTest('normal wait remains available while Electron is running', normalChecks === 2);

  let cleanupChecks = 0;
  await waitFor(() => ++cleanupChecks === 2, 'post-exit delayed cleanup', { exitCode: 0 }, 250, { exitPolicy: 'after-exit' });
  recordSelfTest('post-exit delayed cleanup accepts a clean Electron exit', cleanupChecks === 2);

  await assert.rejects(
    () => waitFor(() => false, 'blocked post-exit cleanup', { exitCode: 0 }, 250, { exitPolicy: 'after-exit' }),
    /Timed out waiting for blocked post-exit cleanup/,
  );
  checks.push('blocked post-exit cleanup still times out');

  await assert.rejects(
    () => waitFor(() => false, 'nonzero Electron exit', { exitCode: 7 }, 250, { exitPolicy: 'after-exit' }),
    /Electron exited with 7/,
  );
  checks.push('nonzero Electron exit remains an error');

  console.log(JSON.stringify({ result: 'PASS', checks }, null, 2));
}

if (process.argv.includes('--wait-for-self-test')) {
  try {
    await runWaitForSelfTest();
  } catch (error) {
    console.error(`WAIT_FOR_SELF_TEST_FAIL: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
} else {

let requestId = 0;
function send(ws, method, params = {}) {
  const id = ++requestId;
  return new Promise((resolveResponse, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 5000);
    const onMessage = event => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      ws.removeEventListener('message', onMessage);
      clearTimeout(timer);
      if (message.error) reject(new Error(message.error.message));
      else resolveResponse(message.result);
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function connectPage(debugPort, child) {
  const pagesUrl = `http://127.0.0.1:${debugPort}/json/list`;
  await waitFor(async () => { try { return (await fetch(pagesUrl)).ok; } catch { return false; } }, 'Electron DevTools', child);
  const pages = await (await fetch(pagesUrl)).json();
  const target = pages.find(item => item.type === 'page');
  assert(target, 'Electron renderer target is missing');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  const evaluate = async expression => {
    const result = await send(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.result?.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  await waitFor(async () => { try { return await evaluate('Boolean(window.voiceStudio?.service)'); } catch { return false; } }, 'isolated service preload', child);
  return { ws, evaluate };
}

async function setServicePort(page, port) {
  const value = String(port);
  const edited = await page.evaluate(`(()=>{const panel=document.querySelector('.screen-panel.active');const input=panel?.querySelector('input[aria-label="Puerto del servicio"]');if(!input)return false;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));return input.value===${JSON.stringify(value)}})()`);
  if (!edited) return false;
  return page.evaluate(`(()=>{const panel=document.querySelector('.screen-panel.active');const button=[...panel.querySelectorAll('button')].find(item=>item.textContent.trim()==='Aplicar puerto');if(!button||button.disabled)return false;button.click();return true})()`);
}

async function setServiceCheckbox(page, labelText, checked) {
  return page.evaluate(`(()=>{const panel=document.querySelector('.screen-panel.active');const label=[...panel.querySelectorAll('label.inline-check')].find(item=>item.textContent.includes(${JSON.stringify(labelText)}));const input=label?.querySelector('input');if(!input)return false;if(input.checked!==${checked})input.click();return true})()`);
}

let primary;
let secondary;
let relaunch;
let finalLaunch;
let occupiedServer;
let page;
const results = [];
const record = (name, passed, detail = '') => {
  assert(passed, `${name}${detail ? `: ${detail}` : ''}`);
  results.push({ name, passed: true, ...(detail ? { detail } : {}) });
};

try {
  assert(await isPortFree(4317), 'Cannot run Electron smoke check: 127.0.0.1:4317 is occupied');
  primary = launch([root, `--remote-debugging-port=${debugPort}`]);
  page = await connectPage(debugPort, primary);

  try {
    await waitFor(() => page.evaluate('window.voiceStudio.service.getState().then(snapshot => snapshot.status === \'active\' || snapshot.status === \'error\')'), 'renderer auto-start terminal state', primary);
  } catch (error) {
    const observation = await page.evaluate(`(async()=>({snapshot:await window.voiceStudio.service.getState(),diagnostics:await window.voiceStudio.service.getDiagnostics(),preferences:JSON.parse(localStorage.getItem('voice-studio-demo-state-v1'))?.settings?.service??null,topbar:document.querySelector('.topbar')?.textContent??null,body:document.body.innerText.slice(0,500)}))()`);
    throw new Error(`${error.message}: startup=${JSON.stringify(observation)}`);
  }
  const initial = await page.evaluate('window.voiceStudio.service.getState()');
  const initialDiagnostics = await page.evaluate('window.voiceStudio.service.getDiagnostics()');
  record('React applies the persisted auto-start preference to the real host', initial.status === 'active' && initial.host === '127.0.0.1', JSON.stringify({ snapshot: initial, diagnostics: initialDiagnostics }));

  const preservationMarker = 'T4-demo-state-preservation-marker';
  const fixtureReady = await page.evaluate(`(()=>{const key='voice-studio-demo-state-v1';const saved=JSON.parse(localStorage.getItem(key));saved.settings.general.audioOutput=${JSON.stringify(preservationMarker)};saved.settings.service.port=80;saved.settings.service.autoStart=false;saved.settings.service.keepRunningOnClose=true;localStorage.setItem(key,JSON.stringify(saved));window.__phase2aPreferenceReload='pending';return true})()`);
  record('Prepare isolated invalid-service-preference preservation case', fixtureReady);
  await send(page.ws, 'Page.reload', { ignoreCache: true });
  page.ws.close();
  page = await connectPage(debugPort, primary);
  await waitFor(async () => { try { return await page.evaluate('window.__phase2aPreferenceReload === undefined'); } catch { return false; } }, 'renderer reload after invalid persisted service preferences', primary);
  await waitFor(() => page.evaluate(`document.querySelector('.topbar')?.textContent.includes('Activo')`), 'React restores the active host snapshot after renderer reload', primary);
  await waitFor(() => page.evaluate(`JSON.parse(localStorage.getItem('voice-studio-demo-state-v1'))?.settings?.service?.port !== 80`), 'React persists validated service preferences after reload', primary);
  const preservedState = await page.evaluate(`JSON.parse(localStorage.getItem('voice-studio-demo-state-v1'))`);
  const servicePrefsPreserved = preservedState.settings.general.audioOutput === preservationMarker && preservedState.settings.service.port === 4317 && preservedState.settings.service.autoStart === false && preservedState.settings.service.keepRunningOnClose === true && preservedState.settings.service.status === 'stopped';
  record('Invalid service preferences preserve demo data and valid service settings', servicePrefsPreserved, JSON.stringify({ general: preservedState.settings.general, service: preservedState.settings.service }));

  const preservationSettingsOpened = await page.evaluate(`(()=>{const button=[...document.querySelectorAll('.nav-item')].find(item=>item.textContent.includes('Ajustes'));if(!button)return false;button.click();return true})()`);
  record('Settings opens after invalid preference recovery', preservationSettingsOpened);
  await waitFor(() => page.evaluate(`document.querySelector('.screen-panel.active')?.textContent.includes('Servicio local')`), 'Settings after invalid preference recovery', primary);
  const autoStartRestored = await setServiceCheckbox(page, 'Iniciar servicio automáticamente al abrir la aplicación', true);
  record('Settings restores auto-start for the remainder of the desktop smoke', autoStartRestored);
  await waitFor(() => page.evaluate(`JSON.parse(localStorage.getItem('voice-studio-demo-state-v1'))?.settings?.service?.autoStart === true`), 'auto-start restored after data-preservation case', primary);

  const started = await page.evaluate('window.voiceStudio.service.start()');
  record('Start service through the actual preload/IPC bridge', started.status === 'active' && started.host === '127.0.0.1', JSON.stringify(started));
  const health = await (await fetch('http://127.0.0.1:4317/health')).json();
  record('GET /health responds from the Electron process', health.status === 'ok' && health.pid === primary.pid, JSON.stringify(health));
  const primaryProcessTree = processTree(primary.pid);
  record('Electron process tree is inventoried before shutdown', primaryProcessTree.includes(primary.pid), JSON.stringify(primaryProcessTree));

  const repeatedStart = await page.evaluate('window.voiceStudio.service.start()');
  record('Repeated start does not create another server', repeatedStart.status === 'active' && repeatedStart.port === health.port && health.pid === primary.pid);
  const stopped = await page.evaluate('window.voiceStudio.service.stop()');
  record('Stop service through the actual preload/IPC bridge', stopped.status === 'stopped', JSON.stringify(stopped));
  await waitFor(() => page.evaluate(`document.querySelector('.topbar').textContent.includes('Detenido')`), 'React to render the stopped host snapshot', primary);
  const visibleAfterHostStop = await page.evaluate(`document.querySelector('.topbar').textContent.includes('Detenido')`);
  record('React displays the host stop snapshot instead of stale demo status', visibleAfterHostStop);
  let endpointClosed = false;
  try { await fetch('http://127.0.0.1:4317/health'); } catch { endpointClosed = true; }
  record('Health endpoint closes after stop', endpointClosed);

  const uiStartClicked = await page.evaluate(`(()=>{const button=document.querySelector('.topbar .btn.small');if(!button||button.disabled||!button.textContent.includes('Iniciar'))return false;button.click();return true})()`);
  record('Topbar Iniciar control is available when the host is stopped', uiStartClicked);
  await waitFor(() => page.evaluate('window.voiceStudio.service.getState().then(snapshot => snapshot.status === \'active\')'), 'UI start command', primary);
  const uiStarted = await page.evaluate(`(async()=>({state:await window.voiceStudio.service.getState(),visible:document.querySelector('.topbar').textContent.includes('Activo')}))()`);
  record('React Iniciar button starts and renders the real host', uiStarted.state.status === 'active' && uiStarted.visible, JSON.stringify(uiStarted.state));
  const uiHealth = await (await fetch('http://127.0.0.1:4317/health')).json();
  record('UI start exposes /health on loopback', uiHealth.status === 'ok' && uiHealth.pid === primary.pid && uiHealth.host === '127.0.0.1');
  const uiStopClicked = await page.evaluate(`(()=>{const button=document.querySelector('.topbar .btn.small');if(!button||button.disabled||!button.textContent.includes('Detener'))return false;button.click();return true})()`);
  record('Topbar Detener control is available when the host is active', uiStopClicked);
  await waitFor(() => page.evaluate('window.voiceStudio.service.getState().then(snapshot => snapshot.status === \'stopped\')'), 'UI stop command', primary);
  const uiStopped = await page.evaluate(`(async()=>({state:await window.voiceStudio.service.getState(),visible:document.querySelector('.topbar').textContent.includes('Detenido')}))()`);
  record('React Detener button stops and renders the real host', uiStopped.state.status === 'stopped' && uiStopped.visible, JSON.stringify(uiStopped.state));
  let uiEndpointClosed = false;
  try { await fetch('http://127.0.0.1:4317/health'); } catch { uiEndpointClosed = true; }
  record('UI stop closes /health', uiEndpointClosed);

  const restarted = await page.evaluate('window.voiceStudio.service.restart()');
  record('Restart service through the actual preload/IPC bridge', restarted.status === 'active', JSON.stringify(restarted));
  const restartedHealth = await (await fetch('http://127.0.0.1:4317/health')).json();
  record('Restart exposes exactly one loopback service in the Electron process', restartedHealth.pid === primary.pid && restartedHealth.host === '127.0.0.1', JSON.stringify(restartedHealth));

  const settingsOpened = await page.evaluate(`(()=>{const button=[...document.querySelectorAll('.nav-item')].find(item=>item.textContent.includes('Ajustes'));if(!button)return false;button.click();return true})()`);
  record('Settings navigation opens the service controls', settingsOpened);
  await waitFor(() => page.evaluate(`document.querySelector('.screen-panel.active')?.textContent.includes('Servicio local')`), 'Settings service controls', primary);
  const beforeUiRestart = await page.evaluate('window.voiceStudio.service.getState()');
  await delay(40);
  const uiRestartClicked = await page.evaluate(`(()=>{const button=[...document.querySelectorAll('.screen-panel.active button')].find(item=>item.textContent.trim()==='Reiniciar');if(!button||button.disabled)return false;button.click();return true})()`);
  record('Settings Reiniciar control is available', uiRestartClicked);
  await waitFor(() => page.evaluate(`window.voiceStudio.service.getState().then(snapshot=>snapshot.status==='active'&&snapshot.startedAt!==${JSON.stringify(beforeUiRestart.startedAt)})`), 'UI restart command', primary);
  const uiRestarted = await page.evaluate(`(async()=>({state:await window.voiceStudio.service.getState(),visible:document.querySelector('.topbar').textContent.includes('Activo')}))()`);
  record('Settings Reiniciar restarts and renders the actual host', uiRestarted.state.status === 'active' && uiRestarted.visible && uiRestarted.state.startedAt !== beforeUiRestart.startedAt, JSON.stringify(uiRestarted.state));

  occupiedServer = await occupyLoopbackPort();
  const conflictPortApplied = await setServicePort(page, occupiedServer.port);
  record('Settings applies a user-selected service port through IPC', conflictPortApplied, `port=${occupiedServer.port}`);
  await waitFor(() => page.evaluate('window.voiceStudio.service.getState().then(snapshot => snapshot.status === \'error\')'), 'service port conflict', primary);
  const conflict = await page.evaluate('window.voiceStudio.service.getState()');
  record('Port conflict is reflected as an effective service error', conflict.status === 'error' && conflict.port === occupiedServer.port && Boolean(conflict.lastError), JSON.stringify(conflict));
  const openFailure = await page.evaluate(`(()=>{const panel=document.querySelector('.screen-panel.active');const button=[...panel.querySelectorAll('button')].find(item=>item.textContent.includes('Ver último fallo'));if(!button)return false;button.click();return true})()`);
  record('Settings exposes the specific service failure', openFailure);
  await waitFor(() => page.evaluate(`document.querySelector('[role="dialog"]')?.textContent.includes('Diagnóstico del servicio')`), 'service diagnostic modal', primary);
  const diagnosticText = await page.evaluate(`document.querySelector('[role="dialog"]')?.textContent ?? ''`);
  record('Service modal identifies the selected conflict', diagnosticText.includes(conflict.lastError.code) && diagnosticText.includes(conflict.lastError.summary) && diagnosticText.includes(`${conflict.lastError.host}:${conflict.lastError.port}`) && diagnosticText.includes(conflict.lastError.detail));
  await page.evaluate(`document.querySelector('[role="dialog"] button[aria-label="Cerrar ventana"]')?.click()`);
  await waitFor(() => page.evaluate(`!document.querySelector('[role="dialog"]')`), 'service diagnostic modal to close', primary);
  await releaseServer(occupiedServer.server);
  occupiedServer = undefined;
  const restoredPort = await setServicePort(page, 4317);
  record('Settings restores the default port after the conflict', restoredPort);
  await waitFor(() => page.evaluate('window.voiceStudio.service.getState().then(snapshot => snapshot.status === \'active\' && snapshot.port === 4317)'), 'service recovery after port conflict', primary);
  record('Service recovers after releasing the conflicted port', (await page.evaluate('window.voiceStudio.service.getState()')).status === 'active');

  const closed = nativeWindow('close', primary.pid);
  record('Native WM_CLOSE targeted the actual Electron window', closed === 'closed');
  await waitFor(async () => nativeWindow('visible', primary.pid) === 'false', 'window to hide through its native close event', primary);
  record('Native window close hides it and keeps Electron alive', primary.exitCode === null, `exitCode=${primary.exitCode}`);
  const retainedHealth = await (await fetch('http://127.0.0.1:4317/health')).json();
  record('Service remains alive while the window is hidden', retainedHealth.status === 'ok' && retainedHealth.pid === primary.pid);

  secondary = launch([root]);
  await waitFor(() => secondary.exitCode !== null, 'second instance to relinquish the lock', secondary, 8000);
  record('Second launch exits instead of creating another application instance', secondary.exitCode === 0, `exitCode=${secondary.exitCode}`);
  record('Original Electron process remains the sole active service owner', primary.exitCode === null && (await (await fetch('http://127.0.0.1:4317/health')).json()).pid === primary.pid);
  await waitFor(async () => nativeWindow('visible', primary.pid) === 'true', 'native window to restore from the single-instance signal', primary);
  record('Second-instance signal restores the hidden native window', nativeWindow('visible', primary.pid) === 'true');
  page.ws.close();
  page = await connectPage(debugPort, primary);
  const stateAfterRestore = await page.evaluate('window.voiceStudio.service.getState()');
  record('Restored window still reaches the original service', stateAfterRestore.status === 'active' && stateAfterRestore.port === 4317);

  const autoStartDisableClicked = await setServiceCheckbox(page, 'Iniciar servicio automáticamente al abrir la aplicación', false);
  record('Auto-start checkbox can be changed from Settings', autoStartDisableClicked);
  await waitFor(() => page.evaluate(`JSON.parse(localStorage.getItem('voice-studio-demo-state-v1'))?.settings?.service?.autoStart===false`), 'auto-start preference to persist', primary);
  record('Auto-start checkbox renders its persisted off state', await page.evaluate(`(()=>{const label=[...document.querySelectorAll('.screen-panel.active label.inline-check')].find(item=>item.textContent.includes('Iniciar servicio automáticamente'));return label?.querySelector('input')?.checked===false})()`));
  const keepRunningDisableClicked = await setServiceCheckbox(page, 'Mantener servicio al cerrar la interfaz', false);
  record('Keep-running checkbox can be changed from Settings', keepRunningDisableClicked);
  await waitFor(() => page.evaluate(`JSON.parse(localStorage.getItem('voice-studio-demo-state-v1'))?.settings?.service?.keepRunningOnClose===false`), 'keep-running preference to persist', primary);
  record('Keep-running checkbox renders its persisted off state', await page.evaluate(`(()=>{const label=[...document.querySelectorAll('.screen-panel.active label.inline-check')].find(item=>item.textContent.includes('Mantener servicio al cerrar'));return label?.querySelector('input')?.checked===false})()`));
  await waitFor(() => page.evaluate(`(()=>{const service=JSON.parse(localStorage.getItem('voice-studio-demo-state-v1'))?.settings?.service;return service?.autoStart===false&&service?.keepRunningOnClose===false})()`), 'service preferences to persist before exit', primary);
  const savedBeforeExit = await page.evaluate(`JSON.parse(localStorage.getItem('voice-studio-demo-state-v1')).settings.service`);
  record('Renderer persists preferences without persisting runtime status', savedBeforeExit.autoStart === false && savedBeforeExit.keepRunningOnClose === false && savedBeforeExit.port === 4317 && savedBeforeExit.status === 'stopped', JSON.stringify(savedBeforeExit));
  nativeWindow('close', primary.pid);
  await waitFor(() => primary.exitCode !== null, 'graceful application exit', primary, 8000);
  record('Closing with keep-running disabled exits Electron', primary.exitCode === 0, `exitCode=${primary.exitCode}`);
  let noOrphan = false;
  try { await fetch('http://127.0.0.1:4317/health'); } catch { noOrphan = true; }
  record('No HTTP service remains after Electron exits', noOrphan);
  await waitFor(async () => {
    for (const pid of primaryProcessTree) if (processExists(pid)) return false;
    return true;
  }, 'all Electron and renderer descendants to exit', primary, 8000, { exitPolicy: 'after-exit' });
  record('Electron and renderer process tree leaves no orphan processes', true, JSON.stringify(primaryProcessTree));
  page.ws.close();
  await waitFor(() => isPortFree(debugPort), 'DevTools port to close after exit', primary, 8000, { exitPolicy: 'after-exit' });

  relaunch = launch([root, `--remote-debugging-port=${debugPort}`]);
  page = await connectPage(debugPort, relaunch);
  await waitFor(() => page.evaluate(`document.querySelector('.topbar')?.textContent.includes('Detenido')`), 'auto-start-disabled state after process restart', relaunch);
  await delay(300);
  const persistedOff = await page.evaluate(`(async()=>({preferences:JSON.parse(localStorage.getItem('voice-studio-demo-state-v1')).settings.service,state:await window.voiceStudio.service.getState()}))()`);
  record('Auto-start false and port preferences survive an Electron process restart', persistedOff.preferences.autoStart === false && persistedOff.preferences.port === 4317 && persistedOff.state.status === 'stopped', JSON.stringify(persistedOff));
  record('Disabled auto-start leaves no HTTP listener after restart', await isPortFree(4317));
  const relaunchTree = processTree(relaunch.pid);

  const settingsOpenedAgain = await page.evaluate(`(()=>{const button=[...document.querySelectorAll('.nav-item')].find(item=>item.textContent.includes('Ajustes'));if(!button)return false;button.click();return true})()`);
  record('Settings opens after a fresh process launch', settingsOpenedAgain);
  await waitFor(() => page.evaluate(`document.querySelector('.screen-panel.active')?.textContent.includes('Servicio local')`), 'Settings in second process', relaunch);
  const autoStartEnabled = await setServiceCheckbox(page, 'Iniciar servicio automáticamente al abrir la aplicación', true);
  record('Auto-start checkbox can be enabled from Settings', autoStartEnabled === true);
  await waitFor(() => page.evaluate('window.voiceStudio.service.getState().then(snapshot => snapshot.status === \'active\')'), 'enabled auto-start preference to start service', relaunch);
  const autoStartedAgain = await page.evaluate('window.voiceStudio.service.getState()');
  record('Enabling auto-start starts the real service', autoStartedAgain.status === 'active' && autoStartedAgain.port === 4317);

  const persistedPort = await reservePort();
  const portPreferenceApplied = await setServicePort(page, persistedPort);
  record('Settings applies a persistent service port through the host', portPreferenceApplied, `port=${persistedPort}`);
  await waitFor(() => page.evaluate(`window.voiceStudio.service.getState().then(snapshot=>snapshot.status==='active'&&snapshot.port===${persistedPort})`), 'configured port to become active', relaunch);
  const portHealth = await (await fetch(`http://127.0.0.1:${persistedPort}/health`)).json();
  record('Configured port serves /health from Electron', portHealth.status === 'ok' && portHealth.port === persistedPort && portHealth.pid === relaunch.pid, JSON.stringify(portHealth));
  const savedPortPreferences = await page.evaluate(`JSON.parse(localStorage.getItem('voice-studio-demo-state-v1')).settings.service`);
  record('Configured port and auto-start are persisted', savedPortPreferences.port === persistedPort && savedPortPreferences.autoStart === true && savedPortPreferences.keepRunningOnClose === false);
  const relaunchClosed = nativeWindow('close', relaunch.pid);
  record('Second-process WM_CLOSE is delivered', relaunchClosed === 'closed');
  await waitFor(() => relaunch.exitCode !== null, 'second graceful application exit', relaunch, 8000);
  record('Second process exits with keep-running disabled', relaunch.exitCode === 0, `exitCode=${relaunch.exitCode}`);
  let configuredEndpointClosed = false;
  try { await fetch(`http://127.0.0.1:${persistedPort}/health`); } catch { configuredEndpointClosed = true; }
  record('Configured listener closes on application exit', configuredEndpointClosed);
  await waitFor(async () => {
    for (const pid of relaunchTree) if (processExists(pid)) return false;
    return true;
  }, 'second Electron process tree to exit', relaunch, 8000, { exitPolicy: 'after-exit' });
  page.ws.close();
  await waitFor(() => isPortFree(debugPort), 'DevTools port to close after second exit', relaunch, 8000, { exitPolicy: 'after-exit' });

  finalLaunch = launch([root, `--remote-debugging-port=${debugPort}`]);
  page = await connectPage(debugPort, finalLaunch);
  await waitFor(() => page.evaluate(`window.voiceStudio.service.getState().then(snapshot=>snapshot.status==='active'&&snapshot.port===${persistedPort})`), 'persisted auto-start and port after another process restart', finalLaunch);
  const finalState = await page.evaluate(`(async()=>({snapshot:await window.voiceStudio.service.getState(),preferences:JSON.parse(localStorage.getItem('voice-studio-demo-state-v1')).settings.service}))()`);
  record('Persisted auto-start and configured port restore in a fresh Electron process', finalState.snapshot.status === 'active' && finalState.snapshot.port === persistedPort && finalState.preferences.autoStart === true, JSON.stringify(finalState));
  const finalHealth = await (await fetch(`http://127.0.0.1:${persistedPort}/health`)).json();
  record('Restored service health belongs to the final Electron process', finalHealth.status === 'ok' && finalHealth.port === persistedPort && finalHealth.pid === finalLaunch.pid, JSON.stringify(finalHealth));
  const finalTree = processTree(finalLaunch.pid);
  nativeWindow('close', finalLaunch.pid);
  await waitFor(() => finalLaunch.exitCode !== null, 'final graceful application exit', finalLaunch, 8000);
  record('Final Electron process exits cleanly', finalLaunch.exitCode === 0, `exitCode=${finalLaunch.exitCode}`);
  let finalEndpointClosed = false;
  try { await fetch(`http://127.0.0.1:${persistedPort}/health`); } catch { finalEndpointClosed = true; }
  record('Persisted service port closes after final exit', finalEndpointClosed);
  await waitFor(async () => {
    for (const pid of finalTree) if (processExists(pid)) return false;
    return true;
  }, 'final Electron process tree to exit', finalLaunch, 8000, { exitPolicy: 'after-exit' });
  record('Final process tree leaves no orphan processes', true, JSON.stringify(finalTree));

  console.log(JSON.stringify({ result: 'PASS', checks: results }, null, 2));
} finally {
  page?.ws.close();
  if (secondary && secondary.exitCode === null) secondary.kill();
  for (const child of [primary, relaunch, finalLaunch]) if (child && child.exitCode === null) {
    child.kill();
    await Promise.race([new Promise(resolveExit => child.once('exit', resolveExit)), delay(3000)]);
  }
  if (occupiedServer) await releaseServer(occupiedServer.server);
  await rm(profile, { recursive: true, force: true });
}
}
