'use strict';
// Runs the production Electron main. Instrumentation only holds configure delivery and observes native window methods.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const net = require('node:net');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { stripTypeScriptTypes } = require('node:module');
const repo = path.resolve(__dirname, '..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-studio-startup-close-'));
const children = [];
const results = [];
let deadline;
function save(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, value); }
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
async function poll(condition, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await condition()) return true;
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  return false;
}
async function main() {
  const stage = path.join(scratch, 'app');
  fs.mkdirSync(stage);
  for (const dir of ['src', 'electron', 'assets']) fs.cpSync(path.join(repo, dir), path.join(stage, dir), { recursive: true });
  fs.copyFileSync(path.join(repo, 'index.html'), path.join(stage, 'index.html'));
  save(path.join(stage, 'package.json'), JSON.stringify({ name: 'voice-studio-startup-regression', version: '0.0.0', type: 'module', main: 'dist-electron/main.js' }));
  fs.symlinkSync(path.join(repo, 'node_modules'), path.join(stage, 'node_modules'), 'junction');
  const compiled = path.join(stage, 'dist-electron');
  for (const name of fs.readdirSync(path.join(stage, 'electron')).filter(name => name.endsWith('.ts') && !name.endsWith('.test.ts'))) {
    const source = fs.readFileSync(path.join(stage, 'electron', name), 'utf8');
    save(path.join(compiled, name.replace(/\.ts$/, '.js')), stripTypeScriptTypes(source, { mode: 'strip' }).replace(/\.ts(['"])/g, '.js$1'));
  }
  save(path.join(scratch, 'demo.mjs'), stripTypeScriptTypes(fs.readFileSync(path.join(stage, 'src/demoData.ts'), 'utf8'), { mode: 'strip' }));
  const demo = await import(pathToFileURL(path.join(scratch, 'demo.mjs')).href);
  const vite = await import(pathToFileURL(require.resolve('vite')).href);
  const react = (await import(pathToFileURL(require.resolve('@vitejs/plugin-react')).href)).default;
  await vite.build({ root: stage, configFile: false, base: './', cacheDir: path.join(stage, '.vite'), plugins: [react()], logLevel: 'warn', build: { outDir: path.join(stage, 'dist'), emptyOutDir: true } });
  await vite.build({ root: stage, configFile: false, cacheDir: path.join(stage, '.vite'), logLevel: 'warn', build: { target: 'node20', outDir: compiled, emptyOutDir: false, lib: { entry: path.join(stage, 'electron/preload.ts'), formats: ['cjs'], fileName: () => 'preload.js' }, rolldownOptions: { external: ['electron'] } } });
  const htmlPath = path.join(stage, 'dist/index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  save(path.join(stage, 'observe.cjs'), `
const {app,ipcMain}=require('electron');
const fs=require('node:fs');
const {createServer}=require('node:http');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
let window;let hideCalls=0;let closeCount=0;let configured=0;let held=false;let release;let payload;
const state=()=>({pid:process.pid,hideCalls,closeCount,configured,held,payload,visible:Boolean(window&&!window.isDestroyed()&&window.isVisible())});
app.setPath('userData',process.env.R3_PROFILE);
app.on('browser-window-created',(_event,created)=>{window=created;const hide=created.hide.bind(created);created.hide=(...args)=>{hideCalls++;return hide(...args)};created.on('close',()=>closeCount++)});
const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,listener)=>handle(channel,async(event,...args)=>{
 if(channel==='service:configure'){
  payload=args[0];
  if(process.env.R3_HOLD==='1'&&!configured){held=true;await new Promise(resolve=>release=resolve);held=false}
 }
 const result=await listener(event,...args);
 if(channel==='service:configure')configured++;
 return result;
});
const server=createServer((req,res)=>{
 res.setHeader('content-type','application/json');
 if(req.url==='/state'){res.end(JSON.stringify(state()));return}
 if(req.url==='/close'){res.end('{"accepted":true}');setImmediate(()=>window.close());return}
 if(req.url==='/release'){res.end('{"accepted":true}');setImmediate(()=>{const done=release;release=undefined;if(done)done()});return}
 if(req.url==='/quit'){res.end('{"accepted":true}');setImmediate(()=>app.quit());return}
 res.statusCode=404;res.end('{}');
});
app.on('will-quit',()=>{fs.writeFileSync(process.env.R3_FINAL,JSON.stringify(state()));server.close()});
server.once('error',error=>{console.error(error);app.exit(2)});
server.listen(Number(process.env.R3_CONTROL),'127.0.0.1',()=>{import(pathToFileURL(path.join(__dirname,'dist-electron/main.js')).href).catch(error=>{console.error(error);app.exit(2)})});
`);
  const cases = [
    { name: 'close-before-persisted-false', keep: false, hold: true, release: true, expectExit: true },
    { name: 'configured-false-exits', keep: false, hold: false, expectExit: true },
    { name: 'configured-true-hides', keep: true, hold: false, expectExit: false },
    { name: 'missing-preferences-exits-within-bound', keep: false, hold: true, release: false, expectExit: true },
  ];
  for (const scenario of cases) {
    const fixture = { voices: demo.demoVoices, engines: demo.demoEngines, references: demo.demoReferences, jobs: [], profiles: demo.demoProfiles,
      settings: { ...demo.demoSettings, service: { ...demo.demoSettings.service, autoStart: false, keepRunningOnClose: scenario.keep, status: 'stopped' } } };
    save(htmlPath, html.replace('<head>', '<head><script>localStorage.setItem("voice-studio-demo-state-v1",' + JSON.stringify(JSON.stringify(fixture)).replace(/</g, '\\u003c') + ');</script>'));
    const profile = path.join(scratch, scenario.name); fs.mkdirSync(profile);
    const finalPath = path.join(profile, 'final.json');
    const control = await freePort();
    const env = { ...process.env, R3_PROFILE: profile, R3_FINAL: finalPath, R3_CONTROL: String(control), R3_HOLD: scenario.hold ? '1' : '0', APPDATA: path.join(profile, 'Roaming'), LOCALAPPDATA: path.join(profile, 'Local') };
    fs.mkdirSync(env.APPDATA); fs.mkdirSync(env.LOCALAPPDATA); delete env.ELECTRON_RUN_AS_NODE;
    const child = cp.spawn(require('electron'), [path.join(stage, 'observe.cjs'), '--user-data-dir=' + profile], { cwd: stage, env, stdio: ['ignore', 'ignore', 'pipe'] });
    children.push(child); child.stderrText = ''; child.stderr.on('data', bytes => child.stderrText = (child.stderrText + bytes).slice(-10000));
    const request = async route => {
      const response = await fetch('http://127.0.0.1:' + control + route, { signal: AbortSignal.timeout(1000) });
      if (!response.ok) throw new Error('Fixture control HTTP ' + response.status);
      return response.json();
    };
    let last;
    const ready = await poll(async () => {
      if (child.exitCode !== null) throw new Error('Electron infrastructure exit: ' + child.exitCode + '; ' + child.stderrText);
      try { last = await request('/state'); return last.visible && (scenario.hold ? last.held : last.configured > 0); }
      catch (error) { if (error.message.startsWith('Fixture control')) throw error; return false; }
    }, 12000);
    if (!ready) throw new Error('Fixture initialization timeout: ' + scenario.name + '; ' + child.stderrText);
    const before = last;
    if (scenario.hold) { assert.equal(before.configured, 0); assert.equal(before.payload.keepRunningOnClose, scenario.keep); }
    await request('/close');
    const closeObserved = await poll(async () => {
      if (child.exitCode !== null) return true;
      try { last = await request('/state'); return last.closeCount > 0; } catch { return child.exitCode !== null; }
    });
    assert(closeObserved, 'Native close event was not observed');
    const afterClose = last;
    if (scenario.hold && scenario.release && child.exitCode === null) await request('/release');
    const settled = await poll(async () => {
      if (child.exitCode !== null) return true;
      try {
        last = await request('/state');
        if (!scenario.expectExit) return !last.visible && last.hideCalls > 0;
        // A hidden, retained application with the configuration delivered is the product failure, not an infrastructure retry.
        return last.hideCalls > 0 && (!scenario.release || last.configured > 0);
      } catch { return child.exitCode !== null; }
    }, 7000);
    const exited = child.exitCode !== null;
    const final = exited && fs.existsSync(finalPath) ? JSON.parse(fs.readFileSync(finalPath, 'utf8')) : last;
    const checks = scenario.expectExit
      ? { noEarlyHide: afterClose.hideCalls === 0, noHide: final.hideCalls === 0, exitedWithinBound: settled && exited, cleanExit: child.exitCode === 0 }
      : { hides: settled && final.hideCalls > 0 && !final.visible, remainsRunning: !exited };
    const row = { name: scenario.name, passed: Object.values(checks).every(Boolean), checks, before, afterClose, final, exitCode: child.exitCode };
    results.push(row); console.log(JSON.stringify(row));
    if (child.exitCode === null) {
      await request('/quit');
      assert(await poll(() => Promise.resolve(child.exitCode !== null)), 'Fixture cleanup timeout');
      assert.equal(child.exitCode, 0);
    }
  }
  const failed = results.filter(row => !row.passed).length;
  console.log(JSON.stringify({ result: failed ? 'FAIL' : 'PASS', passed: results.length - failed, failed }));
  if (failed) process.exitCode = 1;
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
deadline = setTimeout(() => { console.error('Infrastructure deadline; no automatic retry.'); cleanup().finally(() => process.exit(1)); }, 180000);
main().catch(error => { console.error(error.stack); process.exitCode = 1; }).finally(async () => { clearTimeout(deadline); await cleanup(); });
