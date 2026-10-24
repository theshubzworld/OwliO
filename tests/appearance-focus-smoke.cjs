// Real Electron input, isolated profile: detect focus scrolling outside the settings pane.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..'), output = path.join(__dirname, '.runtime/appearance-focus');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.disableHardwareAcceleration();
const { Store } = require('../dist/main/store');
const wait = async check => { const end = Date.now() + 8000; while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw Error('Appearance focus check timed out'); };
app.whenReady().then(async () => {
  const store = new Store(app.getPath('userData'));
  store.updateSettings({ setupCompleted: true, barDesign: 'owl', formattingProvider: 'basic' });
  const patches = [];
  ipcMain.handle('get-settings', () => store.getSettings());
  ipcMain.handle('get-local-setup', () => ({state:'idle',stage:'idle',message:'Synthetic setup status',runtimeConfigured:false,managed:false,pythonInstalled:false,librariesInstalled:false,modelInstalled:false,runtimeFolder:'Synthetic runtime',modelFolder:'Synthetic models',log:[]}));
  ipcMain.handle('update-settings', async (_event, patch) => { patches.push(patch); await new Promise(resolve => setTimeout(resolve, 80)); return store.updateSettings(patch); });
  ipcMain.handle('get-writing-memory', () => ({ preferences: [], vocabulary: [] }));
  ipcMain.handle('get-scratchpad', () => '');
  ipcMain.handle('get-local-models', () => ({ speech: { online: false }, formatting: { online: false }, pulls: [] }));
  ipcMain.handle('get-last-failure', () => null);
  for (const channel of ['get-history', 'get-dictionary', 'get-snippets', 'get-meetings']) ipcMain.handle(channel, () => []);
  ipcMain.handle('cancel-shortcut', () => {});
  const window = new BrowserWindow({ show: false, width: 1920, height: 1080,
    webPreferences: { preload: path.join(root, 'dist/preload/preload.js'), offscreen: true, contextIsolation: true, backgroundThrottling: false } });
  const js = code => window.webContents.executeJavaScript(code);
  const geometry = () => js(`(() => {const r=document.querySelector('.dashboard-layout').getBoundingClientRect(),s=document.querySelector('.sidebar').getBoundingClientRect(),m=document.querySelector('.main-content').getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:innerHeight,sidebarTop:s.top,sidebarBottom:s.bottom,mainTop:m.top,mainBottom:m.bottom,documentScroll:document.scrollingElement.scrollTop,bodyScroll:document.body.scrollTop,mainScroll:document.querySelector('.main-content').scrollTop};})()`);
  const stableFrame = async () => {
    const g = await geometry();
    assert.equal(g.top, 0, JSON.stringify(g)); assert.equal(g.bottom, g.height, JSON.stringify(g));
    assert.equal(g.sidebarTop, 0); assert.equal(g.sidebarBottom, g.height);
    assert.equal(g.mainTop, 16); assert.equal(g.mainBottom, g.height - 16);
    assert.equal(g.documentScroll, 0); assert.equal(g.bodyScroll, 0);
  };
  const visiblePoint = async design => js(`(() => {
    const main=document.querySelector('.main-content'),card=document.querySelector('.appearance-settings input[value="${design}"]').closest('label');
    const pane=main.getBoundingClientRect(),r=card.getBoundingClientRect();
    if(r.top < pane.top+30)main.scrollTop-=pane.top+30-r.top;
    if(r.bottom > pane.bottom-30)main.scrollTop+=r.bottom-(pane.bottom-30);
    const p=card.getBoundingClientRect();return {x:Math.round(p.x+p.width/2),y:Math.round(p.y+p.height/2)};
  })()`);
  await window.loadFile(path.join(root, 'dist/renderer/index.html'), { query: { view: 'dashboard', tab: 'settings' } });
  await wait(() => js('document.querySelectorAll("input[name=bar-design]").length===7'));
  for (const [width, height] of [[1920,1080],[1120,800],[960,720]]) {
    window.setSize(width, height);
    await new Promise(resolve => setTimeout(resolve, 100));
    await stableFrame();
    for (const design of ['cloud','firefly','cat','owl']) {
      const point = await visiblePoint(design);
      const before = await geometry();
      window.webContents.sendInputEvent({ type: 'mouseMove', ...point });
      window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
      window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
      await wait(()=>js(`document.querySelector('.appearance-option.selected input').value==='${design}'`));
      if(store.getSettings().barDesign!==design){
        await wait(()=>js('!document.querySelector(".settings-page .header-row button").disabled'));
        await js('document.querySelector(".settings-page .header-row button").click();void 0;');
      }
      await wait(() => store.getSettings().barDesign === design);
      await wait(() => js(`document.querySelector('.appearance-option.selected input').value==='${design}' && !document.querySelector('.appearance-option.saving')`));
      const after = await geometry();
      fs.writeFileSync(path.join(output, 'last-layout.json'), JSON.stringify({ width,height,design,before,after }));
      fs.writeFileSync(path.join(output, `mouse-${width}-${design}.png`), (await window.webContents.capturePage()).toPNG());
      await stableFrame();
      assert.ok(Math.abs(after.mainScroll - before.mainScroll) <= 1, 'Clicking a visible card must preserve settings scroll');
      assert.equal(await js('document.activeElement?.name'), 'bar-design', 'Saving a selection must retain keyboard focus');
    }
    // Arrow keys must keep working across successive saved selections.
    await js('document.querySelector("input[name=bar-design]:checked").focus();void 0;');
    for (const design of ['cat','cloud']) {
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Right' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Right' });
      await wait(()=>js(`document.querySelector('.appearance-option.selected input').value==='${design}'`));
      if(store.getSettings().barDesign!==design){
        await wait(()=>js('!document.querySelector(".settings-page .header-row button").disabled'));
        await js('document.querySelector(".settings-page .header-row button").click();void 0;');
      }
      await wait(() => store.getSettings().barDesign === design);
      await wait(() => js('!document.querySelector(".appearance-option.saving")'));
      await stableFrame();
      assert.equal(await js('document.activeElement?.name'), 'bar-design');
    }
  }
  const beforeRapid = patches.length;
  const click = point => {
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  };
  click(await visiblePoint('robot'));
  await wait(()=>js('document.querySelector(".appearance-option.selected input").value==="robot"'));
  click(await visiblePoint('pebble'));
  await wait(()=>js('document.querySelector(".appearance-option.selected input").value==="pebble"'));
  assert.equal(patches.length,beforeRapid,'Appearance changes are staged');
  await js('document.querySelector(".settings-page .header-row button").click();void 0;');
  await wait(()=>store.getSettings().barDesign==='pebble');
  assert.equal(patches.length,beforeRapid+1,'Only the final staged selection is saved');
  await stableFrame();
  assert.ok(patches.every(patch => Object.keys(patch).length === 1 && 'barDesign' in patch));
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ realMouseClicks:true, keyboardArrows:true, sizes:3, frameAnchored:true, settingsScrollPreserved:true, focusPreserved:true }));
  console.log('PASS: real mouse/keyboard theme switches keep the dashboard anchored and preserve settings scroll/focus at three sizes.');
  window.destroy(); app.quit();
}).catch(error => { console.error(error.stack); app.exit(1); });
