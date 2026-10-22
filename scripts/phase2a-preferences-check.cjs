'use strict';
// Real React -> preload -> IPC -> controller regression. Only the first IPC reply is held.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const net = require('node:net');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { stripTypeScriptTypes } = require('node:module');
const repo = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-studio-preferences-'));
const key = 'voice-studio-demo-state-v1';
const diagnosticFailureMode = process.env.R2_DIAGNOSTICS_FAILURE === '1';
const children = [];
const results = [];
let requestId = 0;
let deadline;

function save(file, text) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); }
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  assert(port >= 1024);
  return port;
}
async function waitFor(condition, label, child) {
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`Electron exited before ${label}: ${child.exitCode}; ${child.stderrText}`);
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  throw new Error(`Infrastructure/readiness timeout: ${label}`);
}
function send(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const timer = setTimeout(() => { ws.removeEventListener('message', receive); reject(new Error(`CDP timeout: ${method}`)); }, 6000);
    function receive(event) {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      clearTimeout(timer); ws.removeEventListener('message', receive);
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
    }
    ws.addEventListener('message', receive);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function connect(port, child) {
  let pages;
  await waitFor(async () => {
    try { pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); return pages.some(p => p.type === 'page'); }
    catch { return false; }
  }, 'DevTools target', child);
  const ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  const evaluate = async expression => {
    const response = await send(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) throw new Error(response.result?.exception?.description || response.exceptionDetails.text);
    return response.result.value;
  };
  return { ws, evaluate };
}
const inspect = `(()=>{const inputs=[...document.querySelectorAll('.screen-panel.active label.inline-check input')].slice(0,2);const saved=JSON.parse(localStorage.getItem('${key}'));return {checkboxes:inputs.map(input=>({checked:input.checked,disabled:input.disabled})),persisted:saved.settings.service,sentinel:saved.settings.general.audioOutput,successes:[...document.querySelectorAll('.toast.success')].map(e=>e.textContent)}})()`;
async function click(page, which) {
  assert.equal(await page.evaluate(`(()=>{const input=[...document.querySelectorAll('.screen-panel.active label.inline-check input')][${which}];if(!input||input.disabled||!input.checked)return false;input.click();return true})()`), true, 'Checkbox must be enabled and initially true');
}
async function readHealth(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    return { reachable: true, status: response.status, body: await response.json() };
  } catch (error) {
    return { reachable: false, error: error instanceof Error ? error.message : String(error) };
  }
}
async function main() {
  const stage = path.join(scratch, 'app');
  const host = path.join(scratch, 'host');
  fs.mkdirSync(stage); fs.mkdirSync(host);
  for (const dir of ['src', 'electron']) fs.cpSync(path.join(repo, dir), path.join(stage, dir), { recursive: true });
  fs.copyFileSync(path.join(repo, 'index.html'), path.join(stage, 'index.html'));
  save(path.join(stage, 'package.json'), '{"type":"module"}\n');
  fs.symlinkSync(path.join(repo, 'node_modules'), path.join(stage, 'node_modules'), 'junction');
  for (const name of ['local-service', 'service-contract', 'desktop-controller', 'service-ipc']) {
    const source = fs.readFileSync(path.join(stage, 'electron', name + '.ts'), 'utf8');
    save(path.join(host, name + '.mjs'), stripTypeScriptTypes(source, { mode: 'strip' }).replace(/\.ts(['"])/g, '.mjs$1'));
  }
  save(path.join(scratch, 'demo.mjs'), stripTypeScriptTypes(fs.readFileSync(path.join(stage, 'src/demoData.ts'), 'utf8'), { mode: 'strip' }));
  const demo = await import(pathToFileURL(path.join(scratch, 'demo.mjs')).href);
  const port = await freePort();
  const fixture = { voices: demo.demoVoices, engines: demo.demoEngines, references: demo.demoReferences, jobs: [], profiles: demo.demoProfiles,
    settings: { ...demo.demoSettings, general: { ...demo.demoSettings.general, audioOutput: 'R2-preserved' }, service: { ...demo.demoSettings.service, port, autoStart: true, keepRunningOnClose: true, status: 'stopped' } } };
  const html = fs.readFileSync(path.join(stage, 'index.html'), 'utf8').replace('<head>', '<head><script>localStorage.setItem(' + JSON.stringify(key) + ',' + JSON.stringify(JSON.stringify(fixture)).replace(/</g, '\\u003c') + ');</script>');
  save(path.join(stage, 'index.html'), html);
  const vite = await import(pathToFileURL(require.resolve('vite')).href);
  const react = (await import(pathToFileURL(require.resolve('@vitejs/plugin-react')).href)).default;
  await vite.build({ root: stage, configFile: false, base: './', cacheDir: path.join(stage, '.vite'), plugins: [react()], logLevel: 'warn', build: { outDir: path.join(stage, 'dist'), emptyOutDir: true } });
  await vite.build({ root: stage, configFile: false, cacheDir: path.join(stage, '.vite'), logLevel: 'warn', build: { target: 'node20', outDir: host, emptyOutDir: false, lib: { entry: path.join(stage, 'electron/preload.ts'), formats: ['cjs'], fileName: () => 'production-preload.cjs' }, rolldownOptions: { external: ['electron'] } } });
  save(path.join(host, 'test-preload.cjs'), `require('./production-preload.cjs');const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('__r2test',{read:()=>ipcRenderer.invoke('r2:read'),arm:()=>ipcRenderer.invoke('r2:arm'),release:()=>ipcRenderer.invoke('r2:release'),shutdown:()=>ipcRenderer.invoke('r2:shutdown')});`);
  // Test-only host: production controller, IPC registration and preload are unchanged.
  save(path.join(host, 'main.cjs'), `const {app,BrowserWindow,ipcMain}=require('electron');const path=require('node:path');let controller;let window;let release;let armed=false;let log=[];let diagnosticsCalls=0;let diagnosticsRejected=0;app.setPath('userData',process.env.R2_PROFILE);app.whenReady().then(async()=>{const {DesktopServiceController}=await import('./desktop-controller.mjs');const {registerServiceIpc}=await import('./service-ipc.mjs');const {SERVICE_CHANNELS}=await import('./service-contract.mjs');const diagnosticFailure=process.env.R2_DIAGNOSTICS_FAILURE==='1';controller=new DesktopServiceController({port:Number(process.env.R2_PORT),autoStart:false,keepRunningOnClose:true});window=new BrowserWindow({show:false,webPreferences:{preload:path.join(__dirname,'test-preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:false}});registerServiceIpc({handle(channel,listener){ipcMain.handle(channel,async(event,...args)=>{if(channel===SERVICE_CHANNELS.getDiagnostics){diagnosticsCalls++;if(diagnosticFailure){diagnosticsRejected++;throw new Error('Diagnósticos no disponibles en el host de prueba.')}}const result=await listener(event,...args);if(channel===SERVICE_CHANNELS.configure){log.push({payload:args[0],applied:controller.getPreferences()});if(armed){armed=false;await new Promise(resolve=>release=resolve)}}return result})},removeHandler:c=>ipcMain.removeHandler(c)},controller,snapshot=>window.webContents.send(SERVICE_CHANNELS.stateChanged,snapshot),event=>event.sender?.id===window.webContents.id);ipcMain.handle('r2:read',()=>({preferences:controller.getPreferences(),snapshot:controller.getState(),log,pending:Boolean(release),diagnosticsCalls,diagnosticsRejected}));ipcMain.handle('r2:arm',()=>{log=[];armed=true;return true});ipcMain.handle('r2:release',()=>{const r=release;release=undefined;if(r)r();return Boolean(r)});ipcMain.handle('r2:shutdown',async()=>{if(release)release();await controller.shutdown();setTimeout(()=>app.exit(0),20);return true});window.loadFile(process.env.R2_PAGE)}).catch(e=>{console.error(e);app.exit(2)});app.on('window-all-closed',()=>app.quit());`);
  const debugPort = await freePort();
  const profile = path.join(scratch, 'profile'); fs.mkdirSync(profile);
  const env = { ...process.env, R2_PORT: String(port), R2_PROFILE: profile, R2_PAGE: path.join(stage, 'dist/index.html'), APPDATA: path.join(profile, 'Roaming'), LOCALAPPDATA: path.join(profile, 'Local') };
  fs.mkdirSync(env.APPDATA); fs.mkdirSync(env.LOCALAPPDATA); delete env.ELECTRON_RUN_AS_NODE;
  const child = cp.spawn(require('electron'), [path.join(host, 'main.cjs'), '--remote-debugging-port=' + debugPort, '--user-data-dir=' + profile], { cwd: scratch, env, stdio: ['ignore', 'ignore', 'pipe'] });
  children.push(child); child.stderrText = ''; child.stderr.on('data', b => child.stderrText = (child.stderrText + b).slice(-12000));
  const page = await connect(debugPort, child);
  try {
    if (diagnosticFailureMode) {
      await waitFor(async () => page.evaluate(`(()=>{const b=[...document.querySelectorAll('nav button')].find(e=>e.textContent.includes('Ajustes'));if(!b)return false;b.click();return document.querySelectorAll('.screen-panel.active label.inline-check input').length>=2})()`), 'Settings ready', child);
      await waitFor(() => page.evaluate('window.__r2test.read().then(h=>h.log.length===1&&h.diagnosticsCalls>=1&&h.diagnosticsRejected>=1)'), 'configured diagnostic rejection', child);
      await page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      const hostState = await page.evaluate('window.__r2test.read()');
      const view = await page.evaluate(`(()=>{const panel=document.querySelector('.screen-panel.active');const inputs=[...panel.querySelectorAll('label.inline-check input')].slice(0,2);return {topbar:document.querySelector('.topbar')?.textContent??'',settings:panel?.textContent??'',controls:inputs.map(input=>({checked:input.checked,disabled:input.disabled}))}})()`);
      const health = await readHealth(port);
      const configured = hostState.log[0]?.applied?.port===port && hostState.log[0]?.applied?.autoStart===true && hostState.log[0]?.applied?.keepRunningOnClose===true;
      const backendHealthy = health.reachable && health.status===200 && health.body?.status==='ok' && health.body?.service==='voice-studio' && health.body?.pid===child.pid;
      const diagnosticsRejected = hostState.diagnosticsCalls>=1 && hostState.diagnosticsRejected>=1;
      const controlsEnabled = view.controls.length===2 && view.controls.every(input=>!input.disabled);
      const warningVisible = view.settings.includes('No se pudieron obtener los diagnósticos del servicio:') && view.settings.includes('Diagnósticos no disponibles en el host de prueba.');
      const noMisleadingEmptyState = !view.settings.includes('No hay fallos registrados por el servicio local.');
      const row = { scenario: 'R2-availability-conflation', configured, backendHealthy, diagnosticsRejected, active: view.topbar.includes('Activo'), controlsEnabled, warningVisible, noMisleadingEmptyState, passed: configured && backendHealthy && diagnosticsRejected && view.topbar.includes('Activo') && controlsEnabled && warningVisible && noMisleadingEmptyState, hostState, health, view };
      results.push(row); console.log(JSON.stringify(row));
      console.log(JSON.stringify({ result: row.passed ? 'PASS' : 'FAIL', passed: row.passed ? 1 : 0, failed: row.passed ? 0 : 1 }));
      await page.evaluate('window.__r2test.shutdown()');
      await waitFor(() => Promise.resolve(child.exitCode !== null), 'fixture exit', { get exitCode() { return null; }, stderrText: '' });
      assert.equal(child.exitCode, 0);
      if (!row.passed) throw new Error('R2-availability-conflation: el servicio operativo no conservó su disponibilidad tras el rechazo de diagnósticos.');
      return;
    }
    for (const order of [[0, 1], [1, 0]]) {
      if (order[0] === 1) await send(page.ws, 'Page.reload');
      await waitFor(async () => {
        try { return await page.evaluate(`(()=>{const b=[...document.querySelectorAll('nav button')].find(e=>e.textContent.includes('Ajustes'));if(!b)return false;b.click();const inputs=[...document.querySelectorAll('.screen-panel.active label.inline-check input')];return inputs.length>=2&&inputs.slice(0,2).every(e=>!e.disabled&&e.checked)})()`); }
        catch { return false; }
      }, 'Settings ready', child);
      await waitFor(() => page.evaluate(`window.__r2test.read().then(h=>h.snapshot.status==='active'&&h.preferences.autoStart&&h.preferences.keepRunningOnClose)`), 'controller initialization', child);
      assert.equal(await page.evaluate('window.__r2test.arm()'), true);
      await click(page, order[0]);
      await waitFor(() => page.evaluate('window.__r2test.read().then(h=>h.pending)'), 'first IPC response held', child);
      await click(page, order[1]);
      const held = await page.evaluate('window.__r2test.read()');
      assert.equal(held.log.length, 1, 'Second configure must remain queued');
      assert.equal(await page.evaluate('window.__r2test.release()'), true);
      await waitFor(() => page.evaluate(`window.__r2test.read().then(h=>h.log.length===2&&!h.pending&&document.querySelectorAll('.toast.success').length===2)`), 'two successful IPC replies', child);
      await waitFor(() => page.evaluate(`(()=>{const p=JSON.parse(localStorage.getItem('${key}')).settings.service;const inputs=[...document.querySelectorAll('.screen-panel.active label.inline-check input')];return inputs[0].checked===p.autoStart&&inputs[1].checked===p.keepRunningOnClose})()`), 'UI and persistence settled', child);
      const after = await page.evaluate(inspect);
      const hostState = await page.evaluate('window.__r2test.read()');
      const health = await (await fetch('http://127.0.0.1:' + port + '/health')).json();
      const checks = {
        controller: hostState.preferences.autoStart === false && hostState.preferences.keepRunningOnClose === false,
        interface: after.checkboxes.every(input => !input.checked),
        persistence: after.persisted.autoStart === false && after.persisted.keepRunningOnClose === false && after.persisted.port === port && after.persisted.status === 'stopped',
        notifications: after.successes.length === 2 && after.successes.every(text => text === 'Preferencias del servicio aplicadas.'),
        unrelatedSettings: after.sentinel === 'R2-preserved',
        serializedRequests: hostState.log.length === 2 && held.log.length === 1,
        serviceHealth: health.service === 'voice-studio' && health.pid === child.pid,
      };
      const row = { order: order.map(i => ['autoStart', 'keepRunningOnClose'][i]), checks, passed: Object.values(checks).every(Boolean), controller: hostState.preferences, ui: after.checkboxes, persisted: after.persisted, successes: after.successes, requests: hostState.log };
      results.push(row);
      console.log(JSON.stringify(row));
    }
    await page.evaluate('window.__r2test.shutdown()');
    await waitFor(() => Promise.resolve(child.exitCode !== null), 'fixture exit', { get exitCode() { return null; }, stderrText: '' });
    assert.equal(child.exitCode, 0);
  } finally { page.ws.close(); }
  const failures = results.filter(row => !row.passed);
  console.log(JSON.stringify({ result: failures.length ? 'FAIL' : 'PASS', passed: results.length - failures.length, failed: failures.length }));
  if (failures.length) process.exitCode = 1;
}
async function cleanup() {
  for (const child of children) if (child.exitCode === null) {
    cp.spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 10000 });
    await Promise.race([new Promise(resolve => child.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 3000))]);
  }
  const junction = path.join(scratch, 'app/node_modules');
  if (fs.existsSync(junction)) fs.unlinkSync(junction);
  fs.rmSync(scratch, { recursive: true, force: true });
}
deadline = setTimeout(() => { console.error('Infrastructure deadline; no retry.'); cleanup().finally(() => process.exit(1)); }, 180000);
main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => { clearTimeout(deadline); await cleanup(); });
