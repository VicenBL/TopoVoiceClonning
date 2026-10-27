// Smoke only: real Electron boot and restricted preload, without selecting any file.
(async () => {
  const assert = require('node:assert/strict');
  const { spawn } = require('node:child_process');
  const { mkdtemp, mkdir, rm } = require('node:fs/promises');
  const { join, resolve } = require('node:path');
  const { createServer } = require('node:net');
  const { setTimeout: delay } = require('node:timers/promises');
  const root = process.cwd();
  const scratch = await mkdtemp(join(root, 'node_modules/.cache/trim-smoke-'));
  for (const name of ['profile', 'Roaming', 'Local', 'temp']) await mkdir(join(scratch, name));
  const server = createServer();
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const port = server.address().port;
  await new Promise(done => server.close(done));
  const child = spawn(resolve('node_modules/electron/dist/electron.exe'), [root, `--user-data-dir=${join(scratch, 'profile')}`, `--remote-debugging-port=${port}`], {
    cwd: root,
    env: { ...process.env, APPDATA: join(scratch, 'Roaming'), LOCALAPPDATA: join(scratch, 'Local'), TEMP: join(scratch, 'temp'), TMP: join(scratch, 'temp') },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  let socket;
  let id = 0;
  async function until(check, label, timeout = 12000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (await check()) return;
      if (child.exitCode !== null) throw new Error(`Electron exited (${child.exitCode}): ${stderr}`);
      await delay(100);
    }
    throw new Error(`Timed out: ${label}`);
  }
  function command(method, params = {}) {
    const request = ++id;
    return new Promise((done, reject) => {
      const timeout = setTimeout(() => { socket.removeEventListener('message', receive); reject(new Error(`CDP timeout: ${method}`)); }, 8000);
      function receive(event) {
        const message = JSON.parse(event.data);
        if (message.id !== request) return;
        clearTimeout(timeout);
        socket.removeEventListener('message', receive);
        message.error ? reject(new Error(message.error.message)) : done(message.result);
      }
      socket.addEventListener('message', receive);
      socket.send(JSON.stringify({ id: request, method, params }));
    });
  }
  async function evaluate(expression) {
    const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
  try {
    let pages;
    await until(async () => { try { pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); return pages.some(page => page.type === 'page'); } catch { return false; } }, 'renderer');
    socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    await new Promise((done, reject) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    await until(() => evaluate('Boolean(window.voiceStudio?.media?.trimSelected)'), 'trim preload');
    const keys = await evaluate('Object.keys(window.voiceStudio.media).sort()');
    assert.deepEqual(keys, ['prepareSelected', 'saveWav', 'selectFile', 'trimSelected']);
    assert.match(await evaluate(`window.voiceStudio.media.saveWav('id-inexistente').then(()=> 'éxito inesperado', error=>error.message)`), /fragmento.*selección/i);
    await evaluate('window.voiceStudio.service.configure({port:4317,autoStart:false,keepRunningOnClose:false})');
    for (const [width, height] of [[1440, 900], [1024, 768]]) {
      await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await until(() => evaluate(`Boolean([...document.querySelectorAll('.nav-item')].find(item=>item.textContent.includes('Clonar voz')))`), 'React navigation');
      await evaluate(`document.querySelectorAll('.nav-item')[2].click()`);
      await until(() => evaluate(`Boolean([...document.querySelectorAll('.screen-panel.active button')].find(item=>item.textContent.includes('Seleccionar archivo')))`), 'existing file control');
      assert(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), `Overflow at ${width}x${height}`);
    }
    // No media selection: this idle exit does not prove shutdown during FFmpeg.
    const exit = new Promise(done => child.once('exit', (code, signal) => done({ code, signal })));
    await evaluate('setTimeout(()=>window.close(),50);true');
    const outcome = await Promise.race([exit, delay(10000).then(() => { throw new Error('Electron idle exit timed out'); })]);
    assert.equal(outcome.code, 0, JSON.stringify(outcome));
    console.log(JSON.stringify({ result: 'PASS', proof: 'real Electron boot, restricted trim/save preload, invalid fragment rejected without dialog, navigation at 1440x900 and 1024x768, idle host exit', nativeSelectorInvoked: false, trimmingPlaybackVerified: false, ffmpegShutdownVerified: false }, null, 2));
  } catch (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
  } finally {
    socket?.close();
    if (child.exitCode === null) {
      child.kill();
      await Promise.race([new Promise(done => child.once('exit', done)), delay(3000)]);
    }
    await rm(scratch, { recursive: true, force: true });
  }
})();
