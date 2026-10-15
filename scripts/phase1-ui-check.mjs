import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const appUrl = 'http://127.0.0.1:4173/';
const debugPort = 9333;
const profileDir = path.join(root, '.phase1-browser-profile');
const screenshotDir = path.join(root, 'artifacts', 'screenshots', 'phase1');
const browserCandidates = [
  process.env.CHROME_PATH,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const browserPath = browserCandidates.find(existsSync);
if (!browserPath) throw new Error('No compatible Chrome/Edge executable found. Set CHROME_PATH.');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(url, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { const response = await fetch(url); if (response.ok) return response; } catch {}
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${url}`);
}
function stopTree(child) {
  if (!child?.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      } else {
        this.events.push(message);
      }
    });
  }
  async open() {
    if (this.ws.readyState === WebSocket.OPEN) return;
    await new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.ws.close(); }
}

const viteEntry = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const vite = spawn(process.execPath, [viteEntry, '--host', '127.0.0.1', '--port', '4173', '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
let cdp;
const results = [];
const check = (name, passed, detail = '') => {
  results.push({ name, passed: Boolean(passed), detail });
  if (!passed) throw new Error(`${name}${detail ? `: ${detail}` : ''}`);
};
const js = value => JSON.stringify(value);
const clickText = text => `(()=>{const element=[...document.querySelectorAll('button')].find(node=>node.textContent.includes(${js(text)}));if(!element)throw new Error('Button not found: '+${js(text)});element.click();return true;})()`;
const fieldControl = (label, selector = 'input,select,textarea') => `(()=>{const field=[...document.querySelectorAll('label.field')].find(node=>node.querySelector(':scope > span')?.textContent.includes(${js(label)}));const control=field?.querySelector(${js(selector)});if(!control)throw new Error('Field not found: '+${js(label)});return control;})()`;
const setControl = (locator, value) => `(()=>{const control=${locator};const prototype=control instanceof HTMLSelectElement?HTMLSelectElement.prototype:control instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value').set.call(control,${js(value)});control.dispatchEvent(new Event(control instanceof HTMLSelectElement?'change':'input',{bubbles:true}));control.dispatchEvent(new Event('change',{bubbles:true}));return control.value;})()`;
const setCheckbox = (locator, checked) => `(()=>{const control=${locator};if(control.checked!==${checked})control.click();return control.checked;})()`;
async function waitForEvaluation(expression, timeoutMs = 6000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await cdp.evaluate(expression)) return true;
    await sleep(150);
  }
  return false;
}

try {
  await rm(profileDir, { recursive: true, force: true });
  await mkdir(screenshotDir, { recursive: true });
  await waitFor(appUrl);
  browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`, appUrl], { stdio: 'ignore' });
  const pages = await (await waitFor(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const page = pages.find(item => item.type === 'page');
  if (!page) throw new Error('No browser page available through CDP.');
  cdp = new Cdp(page.webSocketDebuggerUrl);
  await cdp.open();
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.navigate', { url: appUrl });
  await sleep(900);
  await cdp.evaluate(`localStorage.removeItem('voice-studio-demo-state-v1');location.reload();true`);
  await sleep(900);

  check('Eight navigation destinations', await cdp.evaluate(`document.querySelectorAll('.nav-item').length`) === 8);
  check('Demo scope is explicit', await cdp.evaluate(`document.body.textContent.includes('Modo demostración')&&document.body.textContent.includes('sin backend')&&document.body.innerText.includes('Simulación Fase 1 · no operativo')`));

  await cdp.evaluate(`(()=>{const row=[...document.querySelectorAll('tr')].find(node=>node.textContent.includes('Topota'));row.querySelector('button.switch').click();return true;})()`);
  await cdp.evaluate(clickText('Biblioteca de voces'));
  check('Voice availability stays synchronized', await cdp.evaluate(`[...document.querySelectorAll('.card')].some(node=>node.textContent.includes('Topota')&&node.textContent.includes('Oculta al catálogo futuro'))`));
  await cdp.evaluate(clickText('Producción'));
  await cdp.evaluate(`(()=>{const row=[...document.querySelectorAll('tr')].find(node=>node.textContent.includes('Topota'));const select=row.querySelector('select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'topota-v3');select.dispatchEvent(new Event('change',{bubbles:true}));return select.value;})()`);
  await cdp.evaluate(clickText('Biblioteca de voces'));
  check('Active voice version stays synchronized', await cdp.evaluate(`(()=>{const card=[...document.querySelectorAll('.card')].find(node=>node.textContent.includes('Topota'));return card.querySelector('select').value==='topota-v3';})()`));

  await cdp.evaluate(clickText('Clonar voz'));
  check('Clone screen is present', await cdp.evaluate(`document.body.innerText.includes('Crear clonación simulada')`));
  await cdp.evaluate(setControl(fieldControl('Motor de clonación', 'select'), 'local-a'));
  await sleep(100);
  check('Clone form follows engine capabilities', await cdp.evaluate(`document.body.innerText.includes('máximo 5 referencia(s)')`));
  const candidateText = 'CANDIDATA NUEVA ¿¿¿???---!!!';
  await cdp.evaluate(setControl(fieldControl('Texto original de prueba', 'textarea'), candidateText));
  await cdp.evaluate(clickText('Generar prueba'));
  const candidateFinished = await waitForEvaluation(`(()=>{const jobs=JSON.parse(localStorage.getItem('voice-studio-demo-state-v1')).jobs;const job=jobs.find(j=>j.request.origin==='Clonación demo'&&j.request.originalText===${js(candidateText)});return job?.status==='completed'||job?.status==='error';})()`);
  const candidateJob = await cdp.evaluate(`JSON.parse(localStorage.getItem('voice-studio-demo-state-v1')).jobs.find(j=>j.request.origin==='Clonación demo'&&j.request.originalText===${js(candidateText)})`);
  const candidateFeedback = await cdp.evaluate(`document.querySelector('[data-clone-result]')?.textContent`);
  check('Unsaved clone candidate is tested independently of the active version', candidateFinished && candidateJob?.status === 'completed' && candidateJob?.request?.versionId?.startsWith('candidate-') && candidateJob?.request?.engineId === 'local-a' && candidateJob?.snapshot?.versionLabel === 'Candidata sin guardar' && !candidateFeedback.includes('Resultado simulado listo'), JSON.stringify({ candidateJob, candidateFeedback }));
  await cdp.evaluate(setControl(fieldControl('Motor de clonación', 'select'), 'fish-sim'));
  await cdp.evaluate(clickText('Guardar nueva versión'));
  await sleep(150);
  const cloneState = await cdp.evaluate(`JSON.parse(localStorage.getItem('voice-studio-demo-state-v1')).voices.find(v=>v.id==='voice-topota')`);
  check('New version preserves previous versions', cloneState.versions.length === 4, `versions=${cloneState.versions.length}`);
  check('New version is not activated automatically', cloneState.activeVersionId === 'topota-v3', `active=${cloneState.activeVersionId}`);

  await cdp.evaluate(clickText('Generación TTS'));
  const exactText = 'AAAAA---éééé%%%%\nJAJAJAJAaaaáááá\n¿¿¿???---!!!';
  await cdp.evaluate(setControl(fieldControl('Texto original inmutable', 'textarea'), exactText));
  await cdp.evaluate(clickText('Generar simulación'));
  await sleep(2100);
  const exactJob = await cdp.evaluate(`JSON.parse(localStorage.getItem('voice-studio-demo-state-v1')).jobs.find(j=>j.request.originalText===${js(exactText)})`);
  check('Exact original text is preserved', exactJob?.request?.originalText === exactText);
  check('Simulated generation reaches completion', exactJob?.status === 'completed', `status=${exactJob?.status}`);

  await cdp.evaluate(setCheckbox(`(()=>[...document.querySelectorAll('label.inline-check')].find(node=>node.textContent.includes('Comparación A/B')).querySelector('input'))()`, true));
  await cdp.evaluate(clickText('Generar A/B simulado'));
  await sleep(650);
  const queueState = await cdp.evaluate(`(()=>{const jobs=JSON.parse(localStorage.getItem('voice-studio-demo-state-v1')).jobs;const pair=jobs.filter(j=>j.request.comparisonId).slice(0,2);return {processing:jobs.filter(j=>j.status==='processing').length,queued:jobs.filter(j=>j.status==='queued').length,pair};})()`);
  check('Queue processes at most one job', queueState.processing === 1, JSON.stringify(queueState));
  check('A/B pair shares text and comparison identity', queueState.pair.length === 2 && queueState.pair[0].request.comparisonId === queueState.pair[1].request.comparisonId && queueState.pair[0].request.originalText === queueState.pair[1].request.originalText);
  await sleep(3000);

  await cdp.evaluate(clickText('Producción'));
  await cdp.evaluate(clickText('Provocar error demo'));
  await sleep(1900);
  await cdp.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(node=>node.textContent.includes('Ver error'));if(!button)throw new Error('No error button');button.click();return true;})()`);
  check('Error opens an operation-specific diagnostic', await cdp.evaluate(`document.querySelector('[role="dialog"]')?.textContent.includes('Diagnóstico específico')`));
  check('Modal exposes accessible dialog semantics', await cdp.evaluate(`(()=>{const dialog=document.querySelector('[role="dialog"]');return dialog?.getAttribute('aria-modal')==='true'&&Boolean(dialog?.getAttribute('aria-labelledby'));})()`));
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await sleep(100);
  check('Escape closes the diagnostic', !(await cdp.evaluate(`Boolean(document.querySelector('[role="dialog"]'))`)));
  await cdp.evaluate(setControl(fieldControl('Motor por defecto', 'select'), 'local-a'));
  check('Production engine change warns about incompatibilities', await cdp.evaluate(`document.querySelector('[role="dialog"]')?.textContent.includes('potencialmente incompatibles')`));
  await cdp.evaluate(clickText('Cancelar'));

  await cdp.evaluate(clickText('Director emocional'));
  await cdp.evaluate(setControl(fieldControl('Modelo/proveedor simulado', 'select'), 'comic'));
  await cdp.evaluate(setControl(fieldControl('Libertad expresiva', 'input'), '80'));
  await cdp.evaluate(setControl(fieldControl('Edición manual de pruebas', 'textarea'), 'Plan manual conservado para esta prueba.'));
  await cdp.evaluate(clickText('Generar prueba simulada'));
  await sleep(150);
  const directorJob = await cdp.evaluate(`JSON.parse(localStorage.getItem('voice-studio-demo-state-v1')).jobs.find(j=>j.request.origin==='Director emocional')`);
  check('Director settings are captured by the job', directorJob?.request?.emotionalProfileId === 'comic' && directorJob?.request?.engineParameters?.freedom === 80 && directorJob?.request?.engineParameters?.manualPlan === 'Plan manual conservado para esta prueba.');

  await cdp.evaluate(clickText('Ajustes'));
  await cdp.evaluate(setControl(fieldControl('Carpeta de almacenamiento', 'input'), 'C:/VoiceStudio/DemoPersistente'));
  await cdp.evaluate(setCheckbox(`(()=>[...document.querySelectorAll('label.inline-check')].find(node=>node.textContent.includes('Iniciar servicio automáticamente')).querySelector('input'))()`, false));
  await cdp.evaluate(clickText('Detener'));
  await sleep(850);
  await cdp.evaluate(`location.reload();true`);
  await sleep(850);
  check('General settings persist after reload', await cdp.evaluate(`${fieldControl('Carpeta de almacenamiento', 'input')}.value==='C:/VoiceStudio/DemoPersistente'`));
  check('Disabled auto-start keeps service stopped', await cdp.evaluate(`document.querySelector('.topbar').textContent.includes('Detenido')`));
  await cdp.evaluate(setCheckbox(`(()=>[...document.querySelectorAll('label.inline-check')].find(node=>node.textContent.includes('Iniciar servicio automáticamente')).querySelector('input'))()`, true));
  await sleep(100);
  await cdp.evaluate(`location.reload();true`);
  await sleep(850);
  check('Enabled auto-start activates simulated service on reopen', await cdp.evaluate(`document.querySelector('.topbar').textContent.includes('Activo')`));

  await cdp.evaluate(clickText('Historial y actividad'));
  check('History includes date filter', await cdp.evaluate(`Boolean(document.querySelector('input[type="date"]'))`));
  const demoErrors = await cdp.evaluate(`(()=>{const jobs=JSON.parse(localStorage.getItem('voice-studio-demo-state-v1')).jobs;return ['Error de proveedor simulado.','Tiempo de espera agotado.','Texto inválido según una regla configurable.'].every(summary=>jobs.some(j=>j.error?.summary===summary));})()`);
  check('History contains every required demo error category', demoErrors);

  const acceptanceBlockers = [];
  const expectUI = async (spec, expression) => { if (!(await cdp.evaluate(expression))) acceptanceBlockers.push(spec); };
  await cdp.evaluate(clickText('Producción'));
  await expectUI('S4: production shows active emotional profile and mode', `document.querySelector('.screen-panel.active').innerText.includes('Perfil emocional')&&document.querySelector('.screen-panel.active').innerText.includes('Modo emocional')`);
  await expectUI('S4/S14: production voices expose named record access and switches', `(()=>{const active=document.querySelector('.screen-panel.active');const rows=[...active.querySelectorAll('tbody tr')].filter(row=>row.querySelector('button.switch'));return rows.length===4&&rows.every(row=>row.querySelector('button[data-voice-record]')&&row.querySelector('button.switch').getAttribute('aria-label'));})()`);

  await cdp.evaluate(clickText('Biblioteca de voces'));
  await cdp.evaluate(clickText('Importar voz demo'));
  await expectUI('S5: import exposes image and description fields', `(()=>{const dialog=document.querySelector('[role="dialog"]');const labels=[...dialog.querySelectorAll('label.field > span')].map(node=>node.textContent);return labels.some(label=>label.includes('Imagen'))&&labels.some(label=>label.includes('Descripción'));})()`);
  await cdp.send('Input.dispatchKeyEvent', { type:'keyDown', key:'Escape', code:'Escape' });

  await cdp.evaluate(clickText('Director emocional'));
  await cdp.evaluate(`(()=>{const x=document.querySelector('.screen-panel.active input[type="checkbox"]');if(x.checked)x.click();return true;})()`);
  await sleep(100);
  await expectUI('S8/S13: disabled director disables dependent options', `(()=>{const active=document.querySelector('.screen-panel.active');const controls=[...active.querySelectorAll('[data-director-option]')];return controls.length>0&&controls.every(x=>x.disabled);})()`);

  await cdp.evaluate(clickText('Clonar voz'));
  await expectUI('S6: integrated test has version selector and result area', `(()=>{const card=[...document.querySelectorAll('.screen-panel.active .card')].at(-1);return Boolean(card?.querySelector('select'))&&Boolean(card?.querySelector('[data-clone-result]'));})()`);

  await cdp.evaluate(clickText('Generación TTS'));
  await cdp.evaluate(`(()=>{const x=[...document.querySelectorAll('.screen-panel.active label.inline-check')].find(node=>node.textContent.includes('Comparación A/B'))?.querySelector('input');if(x&&!x.checked)x.click();return true;})()`);
  await sleep(100);
  await expectUI('S7: A/B columns have independent mode and director controls', `(()=>{const columns=[...document.querySelectorAll('.screen-panel.active .ab-col')];return columns.length===2&&columns.every(c=>[...c.querySelectorAll('select')].some(s=>[...s.options].some(o=>o.value==='creative'))&&c.querySelector('input[type="checkbox"]'));})()`);
  await expectUI('S7: result rows expose metadata, save and detail actions', `(()=>{const result=document.querySelector('.screen-panel.active .result');return result&&/Duración|Tiempo/.test(result.innerText)&&[...result.querySelectorAll('button')].some(x=>x.textContent.includes('Guardar'))&&[...result.querySelectorAll('button')].some(x=>x.textContent.includes('Detalles'));})()`);

  await cdp.evaluate(clickText('Historial y actividad'));
  await cdp.evaluate(`(()=>{const row=[...document.querySelectorAll('.screen-panel.active tbody tr')].find(x=>x.textContent.includes('Completada'));const button=[...row.querySelectorAll('button')].find(x=>x.textContent.includes('Detalles'));button.click();return true;})()`);
  await expectUI('S10: completed detail includes result, plan and phase durations', `(()=>{const dialog=document.querySelector('[role="dialog"]');return dialog&&dialog.innerText.includes('Resultado')&&dialog.innerText.includes('Plan emocional')&&dialog.innerText.includes('Duración de fases');})()`);
  await cdp.send('Input.dispatchKeyEvent', { type:'keyDown', key:'Escape', code:'Escape' });

  await cdp.evaluate(clickText('Ajustes'));
  for (const text of ['Iniciar servicio automáticamente','Mantener servicio al cerrar']) {
    await cdp.evaluate(`(()=>{const x=[...document.querySelectorAll('.screen-panel.active label.inline-check')].find(node=>node.textContent.includes(${js(text)})).querySelector('input');if(x.checked)x.click();return true;})()`);
    await sleep(80);
  }
  await cdp.evaluate(`location.reload();true`);
  await sleep(850);
  await expectUI('S11: disabled close retention leaves service stopped', `document.querySelector('.topbar').innerText.includes('Detenido')`);

  await cdp.send('Emulation.setDeviceMetricsOverride', { width:1280,height:800,deviceScaleFactor:1,mobile:false });
  await cdp.evaluate(clickText('Producción'));
  await expectUI('S4: production metrics show complete values without truncation', `(()=>{const metrics=[...document.querySelectorAll('.screen-panel.active .metric strong')];return metrics.length>=10&&metrics.every(value=>value.scrollWidth<=value.clientWidth&&getComputedStyle(value).textOverflow!=='ellipsis'&&getComputedStyle(value).whiteSpace!=='nowrap');})()`);

  await cdp.evaluate(clickText('Biblioteca de voces'));
  await expectUI('S5: library filters form one compact toolbar when space is available', `(()=>{const toolbar=document.querySelector('.screen-panel.active .filter-toolbar.library-filters');if(!toolbar)return false;const controls=[...toolbar.querySelectorAll(':scope > input,:scope > select,:scope > button')];const tops=controls.map(control=>Math.round(control.getBoundingClientRect().top));return controls.length===5&&Math.max(...tops)-Math.min(...tops)<=4&&toolbar.getBoundingClientRect().height<64;})()`);
  await cdp.evaluate(`(()=>{const active=document.querySelector('.screen-panel.active');const input=active.querySelector('.toolbar input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Topota');input.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  await sleep(80);
  await expectUI('S5/S13: library search remains functional', `(()=>{const cards=[...document.querySelectorAll('.screen-panel.active .voice-grid > .card')];return cards.length===1&&cards[0].innerText.includes('Topota');})()`);

  await cdp.evaluate(clickText('Historial y actividad'));
  await expectUI('S10: history filters form one compact toolbar when space is available', `(()=>{const toolbar=document.querySelector('.screen-panel.active .filter-toolbar.history-filters');if(!toolbar)return false;const controls=[...toolbar.querySelectorAll(':scope > label,:scope > select')];const tops=controls.map(control=>Math.round(control.getBoundingClientRect().top));return controls.length===4&&Math.max(...tops)-Math.min(...tops)<=4&&toolbar.getBoundingClientRect().height<68;})()`);
  await cdp.evaluate(`(()=>{const select=document.querySelector('.screen-panel.active .toolbar select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'completed');select.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  await sleep(80);
  await expectUI('S10/S13: history status filter remains functional', `(()=>{const rows=[...document.querySelectorAll('.screen-panel.active tbody tr')];return rows.length>0&&rows.every(row=>row.innerText.includes('Completada'));})()`);
  await cdp.evaluate(`(()=>{const row=document.querySelector('.screen-panel.active tbody tr');const button=[...row.querySelectorAll('button')].find(item=>item.textContent.includes('Detalles'));button.click();return true;})()`);
  await sleep(80);
  await expectUI('S14: modal header stays visible while only its body scrolls', `(()=>{const modal=document.querySelector('.modal');const header=modal?.querySelector('.modal-header');const body=modal?.querySelector('.modal-body');if(!modal||!header||!body)return false;const before=header.getBoundingClientRect().top;body.scrollTop=body.scrollHeight;const after=header.getBoundingClientRect().top;return getComputedStyle(modal).overflow==='hidden'&&['auto','scroll'].includes(getComputedStyle(body).overflowY)&&body.scrollHeight>body.clientHeight&&Math.abs(before-after)<1&&header.querySelector('[aria-label="Cerrar ventana"]')?.getBoundingClientRect().top>=modal.getBoundingClientRect().top;})()`);
  await cdp.send('Input.dispatchKeyEvent', { type:'keyDown', key:'Escape', code:'Escape' });

  await cdp.send('Emulation.setDeviceMetricsOverride', { width:1024,height:768,deviceScaleFactor:1,mobile:false });
  await cdp.evaluate(clickText('Producción'));
  await cdp.evaluate(`window.scrollTo(0,1000);true`);
  await sleep(80);
  await expectUI('S3/S14: reduced topbar and sidebar remain persistent', `(()=>document.querySelector('.topbar').getBoundingClientRect().top>=0&&document.querySelector('.sidebar').getBoundingClientRect().top>=0)()`);
  check('Independent acceptance regressions', acceptanceBlockers.length===0, acceptanceBlockers.join('; '));

  await cdp.evaluate(`localStorage.removeItem('voice-studio-demo-state-v1');location.reload();true`);
  await sleep(850);
  const screens = [
    ['Producción','production'],['Biblioteca de voces','voices'],['Clonar voz','clone'],['Generación TTS','tts'],
    ['Director emocional','emotional'],['Motores','engines'],['Historial y actividad','history'],['Ajustes','settings'],
  ];
  for (const [label, slug] of screens) {
    await cdp.evaluate(clickText(label));
    await sleep(80);
    for (const [width, height, size] of [[1920,1080,'desktop'],[1024,768,'reduced']]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await sleep(50);
      const layout = await cdp.evaluate(`({bodyWidth:document.body.scrollWidth,viewport:innerWidth,active:Boolean(document.querySelector('.screen-panel.active')),title:document.querySelector('.page-title h1')?.textContent})`);
      check(`${label} ${size} layout remains reachable`, layout.active && layout.bodyWidth <= width, JSON.stringify(layout));
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      await writeFile(path.join(screenshotDir, `${slug}-${size}.png`), Buffer.from(shot.data, 'base64'));
    }
  }

  const browserErrors = cdp.events.filter(event => event.method === 'Runtime.exceptionThrown' || (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') || (event.method === 'Log.entryAdded' && event.params.entry.level === 'error'));
  check('Browser console has no uncaught errors', browserErrors.length === 0, JSON.stringify(browserErrors.slice(0, 3)));

  const report = { passed: results.filter(result => result.passed).length, total: results.length, screenshots: screens.length * 2, results };
  await mkdir(path.join(root, 'artifacts'), { recursive: true });
  await writeFile(path.join(root, 'artifacts', 'phase1-ui-check.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Phase 1 UI check PASS: ${report.passed}/${report.total}; ${report.screenshots} screenshots.`);
} finally {
  cdp?.close();
  stopTree(browser);
  stopTree(vite);
  await rm(profileDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
}
