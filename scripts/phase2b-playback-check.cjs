(async () => {
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { createServer } = require('node:net');
const { mkdtemp, mkdir, readFile, readdir, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { randomUUID } = require('node:crypto');

const root = process.cwd();
const electron = resolve('node_modules/electron/dist/electron.exe');
assert(require('node:fs').existsSync(electron), `Electron executable not found: ${electron}`);
const scratch = await mkdtemp(join(tmpdir(), 'Voice Studio fase 2B é % #-'));
const profile = join(scratch, 'perfil aislado');
const temp = join(scratch, 'temporales');
const fixtures = join(scratch, 'medios de prueba é % #');
const userData = join(profile, 'user-data');
const nativeScript = join(scratch, 'select-native.ps1');
const treeScript = join(scratch, 'process-tree.ps1');
await Promise.all([mkdir(userData, { recursive: true }), mkdir(temp), mkdir(fixtures), mkdir(join(profile, 'Roaming'), { recursive: true }), mkdir(join(profile, 'Local'), { recursive: true })]);
const wav = join(fixtures, 'voz con espacios é % #.wav');
const mp4 = join(fixtures, 'vídeo con espacios é % #.mp4');
const silent = join(fixtures, 'sin audio.mp4');
const corrupt = join(fixtures, 'corrupto.wav');
const longAudio = join(fixtures, 'preparacion larga.wav');
function makeFixture(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
}
makeFixture(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'pcm_s16le', wav]);
makeFixture(['-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=15:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=620:duration=2', '-c:v', 'mpeg4', '-c:a', 'aac', '-shortest', mp4]);
makeFixture(['-f', 'lavfi', '-i', 'color=c=black:s=32x32:d=0.3', '-an', '-y', silent]);
makeFixture(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=180', '-c:a', 'pcm_s16le', longAudio]);
await writeFile(corrupt, 'contenido que no es audio');
const sourceHashes = new Map([[wav, await readFile(wav)], [mp4, await readFile(mp4)]]);
await writeFile(nativeScript, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(String.raw`param([int]$TargetPid, [string]$FilePath)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class VoiceStudioNativePicker {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out int processId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder name, int maxCount);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool SetWindowText(IntPtr hWnd, string text);
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr hWnd, int id);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc callback, IntPtr lParam);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);
  public static IntPtr FindFileNameEdit(IntPtr dialog) {
    IntPtr combo = GetDlgItem(dialog, 1148);
    if (combo == IntPtr.Zero) return IntPtr.Zero;
    IntPtr found = IntPtr.Zero;
    EnumChildWindows(combo, (child, lParam) => {
      var cls = new StringBuilder(128);
      GetClassName(child, cls, cls.Capacity);
      if (cls.ToString() == "Edit" && GetDlgCtrlID(child) == 1148) { found = child; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
  public static string DescribeChildren(IntPtr dialog) {
    var items = new StringBuilder();
    EnumChildWindows(dialog, (child, lParam) => {
      var cls = new StringBuilder(128); var text = new StringBuilder(256);
      GetClassName(child, cls, cls.Capacity); GetWindowText(child, text, text.Capacity);
      items.Append(GetDlgCtrlID(child)).Append(':').Append(cls).Append(':').Append(text).Append(" | ");
      return true;
    }, IntPtr.Zero);
    return items.ToString();
  }
  public static string ReadText(IntPtr hWnd) { var text = new StringBuilder(4096); GetWindowText(hWnd, text, text.Capacity); return text.ToString(); }
  public static IntPtr FindDialog(int pid) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((hWnd, lParam) => {
      int ownerPid; GetWindowThreadProcessId(hWnd, out ownerPid);
      var title = new StringBuilder(512);
      if (ownerPid == pid && IsWindowVisible(hWnd) && GetWindowText(hWnd, title, title.Capacity) > 0 && title.ToString().Contains("Seleccionar archivo")) { found = hWnd; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@
$dialog = [IntPtr]::Zero
$deadline = [DateTime]::UtcNow.AddSeconds(15)
while ($dialog -eq [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline) { $dialog = [VoiceStudioNativePicker]::FindDialog($TargetPid); Start-Sleep -Milliseconds 100 }
if ($dialog -eq [IntPtr]::Zero) { throw 'Native file dialog not found' }
$fileName = [VoiceStudioNativePicker]::FindFileNameEdit($dialog)
if ($fileName -eq [IntPtr]::Zero) { throw "Win32 Edit 1148 under filename ComboBox 1148 not found. Controls: $([VoiceStudioNativePicker]::DescribeChildren($dialog))" }
if (-not [VoiceStudioNativePicker]::SetWindowText($fileName, $FilePath)) { throw "WM_SETTEXT failed for filename Edit 1148. current=[$([VoiceStudioNativePicker]::ReadText($fileName))], requested=[$FilePath]" }
$currentValue = [VoiceStudioNativePicker]::ReadText($fileName)
if ($currentValue -cne $FilePath) { throw "Win32 filename value mismatch: expected=[$FilePath], actual=[$currentValue]" }
[VoiceStudioNativePicker]::SendMessage($dialog, 0x0111, [IntPtr]1, [IntPtr]::Zero) | Out-Null
$deadline = [DateTime]::UtcNow.AddSeconds(5)
while ([VoiceStudioNativePicker]::FindDialog($TargetPid) -ne [IntPtr]::Zero -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
if ([VoiceStudioNativePicker]::FindDialog($TargetPid) -ne [IntPtr]::Zero) { throw "Native dialog remained open after IDOK; filename=[$currentValue]" }
"selected=$currentValue; dialogClosed=true"
`)]));
await writeFile(treeScript, String.raw`param([int]$TargetPid)
$all = @(Get-CimInstance Win32_Process)
$ids = New-Object 'System.Collections.Generic.List[int]'
$ids.Add($TargetPid)
$changed = $true
while ($changed) {
  $changed = $false
  foreach ($process in $all) {
    if ($ids.Contains([int]$process.ParentProcessId) -and -not $ids.Contains([int]$process.ProcessId)) { $ids.Add([int]$process.ProcessId); $changed = $true }
  }
}
$rows = @($all | Where-Object { $ids.Contains([int]$_.ProcessId) } | Select-Object @{n='pid';e={[int]$_.ProcessId}}, Name)
ConvertTo-Json -InputObject $rows -Compress
`);

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  const port = server.address().port;
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  return port;
}
const debugPort = await freePort();
let child;
let socket;
let requestId = 0;
function cdp(method, params = {}) {
  const id = ++requestId;
  return new Promise((resolveResponse, reject) => {
    const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 8000);
    const receive = event => {
      const message = JSON.parse(event.data);
      if (message.id !== id) return;
      socket.removeEventListener('message', receive);
      clearTimeout(timer);
      if (message.error) reject(new Error(message.error.message)); else resolveResponse(message.result);
    };
    socket.addEventListener('message', receive);
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
async function waitFor(check, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    if (child?.exitCode !== null) throw new Error(`Electron exited early (${child.exitCode}): ${child.stderrText ?? ''}`);
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
function selectNative(path) {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', nativeScript, String(child.pid), path], { encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /dialogClosed=true/, `Native dialog proof did not confirm closure: ${result.stdout}`);
}
function processTree() {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', treeScript, String(child.pid)], { encoding: 'utf8', timeout: 8000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout.trim());
  return Array.isArray(parsed) ? parsed : [parsed];
}
function record(name, passed, detail) { assert(passed, `${name}${detail ? `: ${detail}` : ''}`); checks.push({ name, passed: true, ...(detail ? { detail } : {}) }); }
const checks = [];
let gracefulQuit = false;
try {
  child = spawn(electron, [`--user-data-dir=${userData}`, root, `--remote-debugging-port=${debugPort}`], {
    cwd: root,
    env: { ...process.env, APPDATA: join(profile, 'Roaming'), LOCALAPPDATA: join(profile, 'Local'), TEMP: temp, TMP: temp },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderrText = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { child.stderrText += chunk; });
  const pagesUrl = `http://127.0.0.1:${debugPort}/json/list`;
  let pages;
  await waitFor(async () => { try { const response = await fetch(pagesUrl); if (!response.ok) return false; pages = await response.json(); return true; } catch { return false; } }, 'Electron devtools');
  const page = pages.find(target => target.type === 'page');
  assert(page);
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => { socket.addEventListener('open', resolveOpen, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  await waitFor(() => evaluate('Boolean(window.voiceStudio?.media?.prepareSelected)'), 'restricted media preload');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1024, height: 768, deviceScaleFactor: 1, mobile: false });
  await waitFor(() => evaluate(`Boolean([...document.querySelectorAll('.nav-item')].find(node=>node.textContent.includes('Clonar voz'))) `), 'React navigation');
  await evaluate(`(()=>{const item=[...document.querySelectorAll('.nav-item')].find(node=>node.textContent.includes('Clonar voz'));item?.click();return Boolean(item)})()`);
  await waitFor(() => evaluate(`Boolean(document.querySelector('.screen-panel.active button')?.textContent.includes('Seleccionar archivo'))`), 'CloneVoice selector at reduced viewport');
  record('CloneVoice selection control remains reachable at 1024x768', await evaluate(`document.querySelector('.screen-panel.active')?.getBoundingClientRect().height>0`));

  const chosen = [];
  async function choose(path, label) {
    await evaluate(`(()=>{const button=[...document.querySelectorAll('.screen-panel.active button')].find(item=>item.textContent.includes('Seleccionar archivo'));button.click();return true})()`);
    selectNative(path);
    await waitFor(() => evaluate(`document.querySelector('.screen-panel.active [role="status"]')?.textContent.includes(${JSON.stringify(label)})`), `${label} selection`);
    await waitFor(() => evaluate(`document.querySelector('.screen-panel.active audio') || document.querySelector('.screen-panel.active [role="alert"]')`), `${label} preparation`);
    chosen.push(label);
  }
  await choose(wav, 'voz con espacios é % #.wav');
  const first = await evaluate(`(()=>({src:document.querySelector('.screen-panel.active audio')?.src,duration:document.querySelector('.screen-panel.active audio')?.duration,prepared:document.querySelector('.screen-panel.active audio')!==null}))()`);
  record('Real WAV prepares and exposes metadata in the native HTML5 player', first.prepared && first.src.startsWith('file:'));
  record('FFprobe duration is displayed', (await evaluate(`document.querySelector('.screen-panel.active .ref-card')?.textContent.includes('0:02')`)));
  const firstOriginal = await readFile(wav);
  record('Input WAV remains byte-identical after preparation', firstOriginal.equals(sourceHashes.get(wav)));
  const playback = await evaluate(`(async()=>{const a=document.querySelector('.screen-panel.active audio');await a.play();return true})()`);
  record('Native audio play starts', playback);
  await waitFor(() => evaluate(`document.querySelector('.screen-panel.active audio')?.currentTime>0.15`), 'WAV playback time to advance');
  await evaluate(`document.querySelector('.screen-panel.active audio').pause()`);
  await waitFor(() => evaluate(`document.querySelector('.screen-panel.active audio')?.paused`), 'WAV pause state');
  const timeBeforePause = await evaluate(`document.querySelector('.screen-panel.active audio').currentTime`);
  await delay(250);
  record('Native audio pause holds the playback position over time', await evaluate(`(()=>{const a=document.querySelector('.screen-panel.active audio');return a.paused&&Math.abs(a.currentTime-${timeBeforePause})<0.03})()`));
  await evaluate(`(()=>{const a=document.querySelector('.screen-panel.active audio');a.currentTime=1;return true})()`);
  await waitFor(() => evaluate(`Math.abs((document.querySelector('.screen-panel.active audio')?.currentTime??0)-1)<0.1`), 'WAV seek');
  record('Native player supports seeking', true);

  await choose(mp4, 'vídeo con espacios é % #.mp4');
  await waitFor(() => evaluate(`document.querySelector('.screen-panel.active audio')?.readyState>=1`), 'video audio metadata');
  await evaluate(`document.querySelector('.screen-panel.active audio').play()`);
  await waitFor(() => evaluate(`document.querySelector('.screen-panel.active audio')?.currentTime>0.1`), 'video audio playback');
  await evaluate(`document.querySelector('.screen-panel.active audio').pause()`);
  await waitFor(() => evaluate(`document.querySelector('.screen-panel.active audio')?.paused`), 'MP4 pause state');
  const videoPausedAt = await evaluate(`document.querySelector('.screen-panel.active audio').currentTime`);
  await delay(250);
  record('MP4 audio pause holds its position over time', await evaluate(`(()=>{const a=document.querySelector('.screen-panel.active audio');return a.paused&&Math.abs(a.currentTime-${videoPausedAt})<0.03})()`));
  await evaluate(`document.querySelector('.screen-panel.active audio').currentTime=0.8`);
  await waitFor(() => evaluate(`Math.abs((document.querySelector('.screen-panel.active audio')?.currentTime??0)-0.8)<0.1`), 'video seek');
  record('Real MP4 audio prepares, plays, pauses, reports duration, and seeks', await evaluate(`(()=>{const a=document.querySelector('.screen-panel.active audio');return Boolean(a&&a.paused&&a.duration>1&&a.currentTime>0.7)})()`));
  record('Input video remains byte-identical after preparation', (await readFile(mp4)).equals(sourceHashes.get(mp4)));

  await choose(silent, 'sin audio.mp4');
  await waitFor(() => evaluate(`document.querySelector('.screen-panel.active [role="alert"]')`), 'no-audio error');
  record('Video without an audio stream shows an error and no player', await evaluate(`Boolean(document.querySelector('.screen-panel.active [role="alert"]'))&&!document.querySelector('.screen-panel.active audio')`));
  await choose(corrupt, 'corrupto.wav');
  await waitFor(() => evaluate(`document.querySelector('.screen-panel.active [role="alert"]')`), 'corrupt file error');
  record('Corrupt audio shows an error and no player', await evaluate(`Boolean(document.querySelector('.screen-panel.active [role="alert"]'))&&!document.querySelector('.screen-panel.active audio')`));

  const closeScript = join(scratch, 'close-window.ps1');
  await writeFile(closeScript, String.raw`param([int]$TargetPid)
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;using System.Text;
public static class VoiceStudioCloseCheck { public delegate bool EnumWindowsProc(IntPtr h,IntPtr l); [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb,IntPtr l); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out int p); [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,StringBuilder s,int n); [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l); public static IntPtr Find(int pid){IntPtr f=IntPtr.Zero;EnumWindows((h,l)=>{int p;GetWindowThreadProcessId(h,out p);var s=new StringBuilder(256);if(p==pid&&GetWindowText(h,s,s.Capacity)>0){f=h;return false;}return true;},IntPtr.Zero);return f;} }
'@
$window=[VoiceStudioCloseCheck]::Find($TargetPid); if($window -eq [IntPtr]::Zero){exit 2}; [VoiceStudioCloseCheck]::PostMessage($window,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)|Out-Null
`);
  await evaluate(`window.voiceStudio.service.configure({port:4317,autoStart:false,keepRunningOnClose:false})`);
  await evaluate(`(()=>{const button=[...document.querySelectorAll('.screen-panel.active button')].find(item=>item.textContent.includes('Seleccionar archivo'));button.click();return Boolean(button)})()`);
  selectNative(longAudio);
  await waitFor(() => evaluate(`document.querySelector('.screen-panel.active [role="status"]')?.textContent.includes('preparacion larga.wav')`), 'long audio selection');
  const preparationDeadline = Date.now() + 20000;
  let activeFfmpeg = null;
  while (Date.now() < preparationDeadline && !activeFfmpeg) {
    const descendants = processTree();
    activeFfmpeg = descendants.find(process => /ffmpeg(?:\.exe)?$/i.test(process.Name));
    if (!activeFfmpeg) await delay(75);
  }
  assert(activeFfmpeg, 'Could not observe FFmpeg running under Electron during real media preparation');
  record('FFmpeg child is observed during actual Electron preparation', Boolean(activeFfmpeg.Name), `name=${activeFfmpeg.Name}, pid=${activeFfmpeg.pid}`);
  record('Renderer still shows the real preparation state when FFmpeg is alive', await evaluate(`[...document.querySelectorAll('.screen-panel.active [role="status"]')].some(node=>node.textContent.includes('Preparando audio'))`));
  const closed = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', closeScript, String(child.pid)], { encoding: 'utf8', timeout: 10000 });
  assert.equal(closed.status, 0, closed.stderr || closed.stdout);
  await waitFor(() => child.exitCode !== null, 'graceful Electron exit', 10000);
  gracefulQuit = child.exitCode === 0;
  record('Application exits gracefully through native window close', gracefulQuit, `exit=${child.exitCode}`);
  await delay(100);
  const remaining = await readdir(temp);
  record('Application shutdown removes its owned media temporary directory', !remaining.some(name => name.startsWith('voice-studio-media-')), JSON.stringify(remaining));
  const orphaned = processTree().filter(process => process.pid !== child.pid);
  record('Graceful exit waits for FFmpeg and leaves no Electron descendants', orphaned.length === 0, JSON.stringify(orphaned));
  console.log(JSON.stringify({ result: 'PASS', proof: 'real FFmpeg/ffprobe, native Electron, native Windows dialog and HTMLMediaElement', chosen, checks }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ result: 'PARTIAL', checks }, null, 2));
  console.error(`PHASE2B_PLAYBACK_FAIL: ${error.stack || error.message}`);
  process.exitCode = 1;
} finally {
  socket?.close();
  if (child && child.exitCode === null) {
    child.kill();
    await Promise.race([new Promise(resolveExit => child.once('exit', resolveExit)), delay(3000)]);
  }
  await rm(scratch, { recursive: true, force: true });
}
})();
