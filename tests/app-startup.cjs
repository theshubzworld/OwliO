const { app, BrowserWindow, nativeImage } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(__dirname, '.runtime');
const selectedModel = process.argv[2] || 'base';
app.setPath('userData', path.join(output, 'startup-profile'));
require('../dist/main/main.js');
const waitFor = async check => {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw new Error('App startup did not settle');
};
app.whenReady().then(async () => {
  await waitFor(() => BrowserWindow.getAllWindows().some(window => window.getBounds().width > 600 && window.isMinimized()));
  const dashboard = BrowserWindow.getAllWindows().find(window => window.getBounds().width > 600);
  const pill = BrowserWindow.getAllWindows().find(window => window !== dashboard);
  assert.equal(dashboard.isMinimized(), true);
  const handle = dashboard.getNativeWindowHandle().readBigUInt64LE(0).toString();
  const iconCheck = await new Promise((resolve, reject) => execFile('pwsh', ['-NoProfile', '-File', path.join(__dirname, 'window-icon.ps1'), '-WindowHandle', handle], { encoding: 'utf8', windowsHide: true }, (error, output, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(output)));
  assert.match(iconCheck, /PASS/);
  dashboard.webContents.setBackgroundThrottling(false);
  assert.equal(pill.isFocusable(), false);
  assert.equal(nativeImage.createFromPath(path.join(root, 'assets/brand/owlio-icon.png')).isEmpty(), false);
  assert.equal(dashboard.getTitle(), 'Owlio');
  await waitFor(() => dashboard.webContents.executeJavaScript('!!document.querySelector(".nav-item")'));
  await waitFor(() => dashboard.webContents.executeJavaScript('document.querySelector(".brand-title")?.textContent === "Owlio" && document.querySelector(".brand-icon img")?.naturalWidth === 256'));
  const js = code => dashboard.webContents.executeJavaScript(code);
  const status = await js('window.api.getLocalModels()');
  assert.equal(status.speech.online, true);
  assert.equal(status.speech.models.find(model => model.id === 'base').downloaded, true);
  // Exercise the real renderer → preload → main → model server → saved configuration path.
  const switched = await js(`window.api.speechModelAction(${JSON.stringify(selectedModel)}, "activate")`);
  assert.equal(switched.localSttModel, selectedModel);
  const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'owlio_config.json'), 'utf8'));
  assert.equal(saved.settings.localSttModel, selectedModel);
  if (selectedModel === 'bodhan-flex') {
    const output = await js('window.api.updateSettings({dictationLanguage:"hinglish"})');
    assert.equal(output.localSttOutputMode, undefined);
    const reloaded = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'owlio_config.json'), 'utf8'));
    assert.equal(reloaded.settings.localSttOutputMode, undefined);
  }
  // Render a hidden preview with real desktop IPC; Windows freezes minimized surfaces.
  const preview = new BrowserWindow({ show: false, width: 1120, height: 800, webPreferences: { preload: path.join(root, 'dist/preload/preload.js'), contextIsolation: true, offscreen: true, backgroundThrottling: false } });
  await preview.loadFile(path.join(root, 'dist/renderer/index.html'), { query: { view: 'dashboard', tab: 'settings' } });
  await waitFor(() => preview.webContents.executeJavaScript(`document.querySelector(".local-models")?.textContent.includes(${JSON.stringify('Loaded: ' + selectedModel.replace(/^hf:/, ''))})`));
  await preview.webContents.executeJavaScript('document.querySelector(".local-models").scrollIntoView({block:"center"}); void 0;');
  await new Promise(resolve => setTimeout(resolve, 200));
  fs.writeFileSync(path.join(output, 'models-live.png'), (await preview.webContents.capturePage()).toPNG());
  fs.writeFileSync(path.join(output, 'startup-result.json'), JSON.stringify({ success: true, minimized: true, speechModel: switched.localSttModel, runtime: status.speech.runtime }));
  console.log('PASS: dashboard starts minimized, icon asset loads, overlay stays non-focusable, and real model activation persists through desktop IPC.');
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
