// Isolated Electron checks: synthetic audio only; never reads the installed profile.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(__dirname, '.runtime/bar-designs');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
const { Store } = require('../dist/main/store');
const { BAR_DESIGNS } = require('../dist/shared/barDesigns');
const wait = async check => {
  const end = Date.now() + 8000;
  while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
  throw Error('Bar design UI condition timed out');
};
app.whenReady().then(async () => {
  const store = new Store(app.getPath('userData'));
  store.updateSettings({ setupCompleted: true, provider: 'local', formattingProvider: 'basic', barDesign: 'owl', hotkey: 'Ctrl+Win', mode: 'toggle' });
  const original = store.getSettings();
  const patches = [], audio = [], failures = [], actions = [];
  let rejectNextAppearance = false;
  let latest = { state: 'idle', revision: 0 };
  const create = (width, height) => new BrowserWindow({ show: false, width, height, frame: false, transparent: true,
    webPreferences: { preload: path.join(root, 'dist/preload/preload.js'), offscreen: true, contextIsolation: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } });
  const pill = create(64, 40), dashboard = create(1120, 920);
  const pjs = code => pill.webContents.executeJavaScript(code);
  const djs = code => dashboard.webContents.executeJavaScript(code);
  const send = message => {
    latest = { ...latest, ...message, revision: latest.revision + 1 };
    pill.webContents.send('pill-state-changed', { ...message, revision: latest.revision });
  };
  ipcMain.handle('get-settings', () => store.getSettings());
  ipcMain.handle('get-local-setup', () => ({state:'idle',stage:'idle',message:'Synthetic setup status',runtimeConfigured:false,managed:false,pythonInstalled:false,librariesInstalled:false,modelInstalled:false,runtimeFolder:'Synthetic runtime',modelFolder:'Synthetic models',log:[]}));
  ipcMain.handle('get-pill-state', () => latest);
  ipcMain.handle('update-settings', (_event, patch) => {
    patches.push(patch);
    if (rejectNextAppearance) { rejectNextAppearance = false; throw Error('Synthetic save failure'); }
    const updated = store.updateSettings(patch);
    send({ barDesign: updated.barDesign });
    return updated;
  });
  ipcMain.handle('get-writing-memory', () => ({ preferences: [], vocabulary: [] }));
  ipcMain.handle('get-scratchpad', () => store.getScratchpad());
  ipcMain.handle('get-local-models', () => ({ speech: { online: false }, formatting: { online: false }, pulls: [] }));
  ipcMain.handle('get-last-failure', () => null);
  for (const channel of ['get-history', 'get-dictionary', 'get-snippets', 'get-meetings']) ipcMain.handle(channel, () => []);
  ipcMain.handle('cancel-shortcut', () => {});
  ipcMain.on('pill-hit-area', () => {});
  ipcMain.on('pill-layout', (_event, { expanded, active }) => pill.setSize(expanded ? 260 : active ? 140 : 64, expanded ? 96 : 40));
  ipcMain.on('toggle-dictation', () => actions.push('toggle'));
  ipcMain.on('open-dashboard', (_event, tab) => actions.push(tab));
  ipcMain.on('audio-recorded', (_event, payload) => audio.push(payload));
  ipcMain.on('recording-failed', (_event, payload) => { failures.push(payload); send({ state: 'error', ...payload }); });
  await Promise.all([
    pill.loadFile(path.join(root, 'dist/renderer/index.html'), { query: { view: 'pill' } }),
    dashboard.loadFile(path.join(root, 'dist/renderer/index.html'), { query: { view: 'dashboard', tab: 'settings' } }),
  ]);
  await wait(() => pjs('!!document.querySelector(".pill-rest")'));
  await wait(() => djs('document.querySelectorAll("input[name=bar-design]").length === 7'));
  await pjs(`window.micRequests = 0;
    navigator.mediaDevices.getUserMedia = () => { window.micRequests++; return new Promise(resolve => window.resolveMic = resolve); };
    window.resolveSyntheticMic = () => {
      window.syntheticContext ||= new AudioContext(); window.syntheticContext.resume();
      const destination = window.syntheticContext.createMediaStreamDestination();
      const oscillator = window.syntheticContext.createOscillator(); oscillator.connect(destination); oscillator.start();
      window.syntheticOscillators = [...(window.syntheticOscillators || []), oscillator];
      window.lastStream = destination.stream; window.resolveMic(destination.stream); window.resolveMic = null;
    }; void 0;`);
  const choose = async design => {
    await djs(`document.querySelector('.appearance-settings input[value="${design}"]').click();void 0;`);
    await djs('document.querySelector(".settings-page .header-row button").click();void 0;');
    await wait(() => store.getSettings().barDesign === design);
    await wait(() => pjs(`document.querySelector('.pill-container').dataset.barDesign === '${design}'`));
    await wait(() => djs(`document.querySelector('.appearance-option.selected input')?.value === '${design}' && !document.querySelector('.appearance-settings input').disabled`));
    assert.equal(new Store(app.getPath('userData')).getSettings().barDesign, design);
  };
  const captureAvatar = async (design, state) => {
    const shape = await pjs(`(() => {const r=document.querySelector('.pill-rest svg, .pill-mic svg').getBBox();return {x:r.x,y:r.y,width:r.width,height:r.height};})()`);
    if (design !== 'owl') assert.ok(shape.x >= -.5 && shape.y >= -.5 && shape.x + shape.width <= 40.5 && shape.y + shape.height <= 40.5, `${design}/${state} artwork must fit its SVG viewBox: ${JSON.stringify(shape)}`);
    const rect = await pjs(`(() => {const r=document.querySelector('.pill-rest svg, .pill-mic svg').getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:32,height:32};})()`);
    fs.writeFileSync(path.join(output, `${design}-${state}.png`), (await pill.webContents.capturePage(rect)).toPNG());
  };
  const captureState = async (design, state) => {
    await wait(() => pjs(`!!document.querySelector('.pill-mic.${state}')`));
    const geometry = await pjs(`(() => {const a=document.querySelector('.pill-mic svg').getBoundingClientRect();const c=document.querySelector('.pill-controls').getBoundingClientRect();return {bottom:c.bottom,viewport:innerHeight,width:a.width,height:a.height};})()`);
    assert.equal(geometry.bottom, geometry.viewport);
    assert.equal(geometry.width, 32); assert.equal(geometry.height, 32);
    await captureAvatar(design, state);
  };
  for (let index = 0; index < BAR_DESIGNS.length; index++) {
    const design = BAR_DESIGNS[index].id;
    await choose(design);
    pill.webContents.send('pill-hover', false); send({ state: 'idle', snapshot: true });
    await wait(() => pjs('!!document.querySelector(".pill-rest")'));
    await wait(() => pill.getBounds().width === 64);
    await captureAvatar(design, 'idle');
    pill.webContents.send('pill-hover', true);
    await wait(() => pjs('!!document.querySelector(".pill-settings")'));
    await new Promise(resolve => setTimeout(resolve, 250));
    const hover = await pjs(`(() => {
      const c=document.querySelector('.pill-controls').getBoundingClientRect(),a=document.querySelector('.pill-mic svg').getBoundingClientRect(),t=document.querySelector('.pill-tooltip').getBoundingClientRect();
      return {center:c.x+c.width/2,avatar:a.x+a.width/2,tooltip:t.x+t.width/2,bottom:c.bottom,viewport:innerHeight};})()`);
    assert.ok(Math.abs(hover.center - hover.avatar) < 1);
    assert.ok(Math.abs(hover.center - hover.tooltip) < 1);
    assert.equal(hover.bottom, hover.viewport);
    await captureAvatar(design, 'hover');
    await pjs('document.querySelector(".pill-mic").click();document.querySelector(".pill-settings").click();document.querySelector(".pill-meeting").click();void 0;');
    pill.webContents.send('pill-hover', false);
    const sessionId = index + 1;
    send({ state: 'listening', sessionId, microphoneDeviceId: 'synthetic' });
    await wait(() => pjs('!!window.resolveMic'));
    await captureState(design, 'starting');
    await pjs('window.resolveSyntheticMic();void 0;');
    await captureState(design, 'listening');
    const requests = await pjs('window.micRequests');
    await choose(BAR_DESIGNS[(index + 1) % BAR_DESIGNS.length].id);
    await choose(design);
    assert.equal(await pjs('window.micRequests'), requests, 'Changing appearance must not reopen the microphone');
    assert.equal(await pjs('!!document.querySelector(".pill-mic.listening")'), true);
    await wait(() => pjs('parseFloat(document.querySelector(".wave-bar").style.height) > 4.1'));
    await new Promise(resolve => setTimeout(resolve, 400));
    await captureAvatar(design, 'listening');
    send({ state: 'processing', sessionId });
    await captureState(design, 'processing');
    await wait(() => { if (failures.length) throw Error(failures.at(-1).errorMessage); return audio.some(item => item.sessionId === sessionId); });
    assert.equal(audio.filter(item => item.sessionId === sessionId).length, 1);
    assert.ok(audio.find(item => item.sessionId === sessionId).buffer.byteLength > 44);
    assert.equal(await pjs('window.lastStream.getTracks().every(track => track.readyState === "ended")'), true);
    send({ state: 'pasted', sessionId, transcription: 'Synthetic dictation', snapshot: true });
    await captureState(design, 'pasted');
    send({ state: 'error', errorMessage: 'Synthetic insertion failure', snapshot: true });
    await captureState(design, 'error');
    await pjs('document.querySelector(".pill-mic").click();void 0;');
  }
  assert.equal(audio.length, 7); assert.equal(failures.length, 0);
  assert.equal(actions.filter(action => action === 'toggle').length, 7);
  assert.equal(actions.filter(action => action === 'settings').length, 7);
  assert.equal(actions.filter(action => action === 'notetaker').length, 7);
  assert.equal(actions.filter(action => action === 'dictation').length, 7);
  assert.ok(patches.every(patch => Object.keys(patch).length===0 || Object.keys(patch).length===1&&'barDesign' in patch));
  const saved = store.getSettings();
  for (const key of Object.keys(original)) if (key !== 'barDesign') assert.equal(saved[key], original[key]);
  // Recovery reload retains the chosen design and doesn't request a microphone while idle.
  send({ state: 'idle', snapshot: true });
  await choose('cat');
  await pill.reload();
  await wait(() => pjs('document.querySelector(".pill-container")?.dataset.barDesign === "cat" && !!document.querySelector(".pill-rest")'));
  pill.webContents.debugger.attach('1.3');
  await pill.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await pjs('matchMedia("(prefers-reduced-motion: reduce)").matches'), true);
  for (const item of BAR_DESIGNS) {
    await choose(item.id);
    assert.equal(await pjs('document.querySelector(".pill-container").getAnimations({subtree:true}).filter(animation=>animation.playState==="running").length'), 0);
  }
  pill.webContents.debugger.detach();
  const retained = store.getSettings().barDesign;
  rejectNextAppearance = true;
  await djs('document.querySelector(".appearance-settings input[value=cloud]").click();void 0;');
  await djs('document.querySelector(".settings-page .header-row button").click();void 0;');
  await wait(() => djs('document.querySelector(".main-content > [role=alert]")?.textContent.includes("Synthetic save failure")'));
  assert.equal(store.getSettings().barDesign, retained);
  assert.equal(await pjs('document.querySelector(".pill-container").dataset.barDesign'), retained);
  assert.equal(await djs('document.querySelector(".appearance-option.selected input").value'), 'cloud');
  await choose('owl');
  await djs('document.querySelector(".appearance-settings").scrollIntoView({block:"start"});void 0;');
  await new Promise(resolve => setTimeout(resolve, 150));
  fs.writeFileSync(path.join(output, 'settings.png'), (await dashboard.webContents.capturePage()).toPNG());
  const gallery = create(1120, 820);
  const stages = ['idle','hover','starting','listening','processing','pasted','error'];
  const img = (design, state) => 'data:image/png;base64,' + fs.readFileSync(path.join(output, `${design}-${state}.png`)).toString('base64');
  await gallery.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<style>body{margin:0;padding:28px;font:14px Segoe UI;background:#F7F3ED;color:#58313F}h1{font:30px Georgia;margin:0 0 8px}p{color:#7B6C70;margin:0 0 24px}table{width:100%;border-collapse:collapse}th,td{padding:9px;border-bottom:1px solid #E5DCD1;text-align:center}th:first-child{text-align:left;width:145px}td img{width:56px;height:56px}td{background:#ECE6DD}td:nth-child(5){background:#E4ECE5}</style><h1>Owlio · Seven little ways to dictate</h1><p>Actual 32px bar captures, enlarged for review. Every design uses the same controls.</p><table><thead><tr><th>Bar design</th>${stages.map(state=>`<th>${state}</th>`).join('')}</tr></thead><tbody>${BAR_DESIGNS.map(item=>`<tr><th>${item.name}</th>${stages.map(state=>`<td><img src="${img(item.id,state)}"></td>`).join('')}</tr>`).join('')}</tbody></table>`));
  await gallery.webContents.executeJavaScript('Promise.all([...document.images].map(image=>image.decode()))');
  fs.writeFileSync(path.join(output, 'gallery.png'), (await gallery.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ designs: 7, captures: 49, audioSessions: 7, activeSwitchPreservedAudio: true, unchangedOtherSettings: true, persisted: true, recovery: true, reducedMotion: true, saveFailureRetainsDesign: true }));
  console.log('PASS: all 7 designs, 49 state/hover captures, audio capture/release, live switching, saving/recovery, controls, geometry and reduced motion.');
  for (const window of [pill,dashboard,gallery]) window.destroy();
  app.quit();
}).catch(error => { console.error(error.stack); app.exit(1); });
