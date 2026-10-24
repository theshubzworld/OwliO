// Boot the shipped ASAR and helper under an isolated packaged-profile harness.
const { app, BrowserWindow, nativeImage, dialog } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
app.disableHardwareAcceleration();
const { execFile } = require('node:child_process');
process.on('uncaughtException', error => { console.error(error.stack); app.exit(1); });
process.on('unhandledRejection', error => { console.error(error); app.exit(1); });
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..'), pkg = require('../package.json');
const unpacked = path.join(root, 'release-artifacts', pkg.version, 'win-unpacked');
const resources = path.join(unpacked, 'resources'), archive = path.join(resources, 'app.asar');
const fresh = process.argv.includes('--fresh');
const offscreenCheck=process.argv.includes('--offscreen');
const output = path.join(__dirname, '.runtime/release', pkg.version, fresh ? 'fresh' : 'upgrade');
const roaming = path.join(output, 'roaming'), profile = path.join(roaming, 'Owlio');
fs.mkdirSync(profile, { recursive: true });
// Seed synthetic data before any shipped code can choose or migrate a profile.
fs.writeFileSync(path.join(profile, 'owlio_config.json'), JSON.stringify({
  settings: { provider: 'mock', formattingProvider: 'basic', hotkey: 'F10', mode: 'toggle', barDesign: 'owl', ...(fresh ? {setupCompleted:false} : {}) },
  history: [], dictionary: [], snippets: [], scratchpadText: 'Release verification draft',
}));
app.setPath('appData', roaming);
app.setPath('userData', profile);
Object.defineProperty(app, 'isPackaged', { value: true });
Object.defineProperty(process, 'resourcesPath', { value: resources });
const archiveFiles = asar.listPackage(archive).map(file => file.replace(/\\/g, '/'));
assert.ok(archiveFiles.some(file => file.endsWith('/dist/shared/barDesigns.js')));
assert.ok(archiveFiles.some(file => file.endsWith('/dist/main/localSetup.js')));
assert.ok(archiveFiles.some(file => file.endsWith('/dist/main/localStorage.js')));
assert.ok(archiveFiles.some(file => file.endsWith('/dist/main/geminiRomanization.js')));
assert.ok(archiveFiles.some(file => file.endsWith('/dist/main/meetingCapture.js')));
assert.ok(archiveFiles.some(file => file.endsWith('/dist/main/requestSignal.js')));
assert.ok(archiveFiles.some(file => file.endsWith('/dist/shared/localSetup.js')));
assert.ok(!archiveFiles.some(file => /(?:owlio_config\.json|\.env|\/models\/|\/recordings\/|\/tests\/)/i.test(file)));
const shipped = JSON.parse(asar.extractFile(archive, 'package.json').toString());
assert.equal(shipped.version, pkg.version);
assert.ok(fs.existsSync(path.join(resources, 'windows-helper/windows-helper.exe')));
assert.ok(fs.existsSync(path.join(resources, 'speech/server.py')));
for (const file of ['setup_runtime.py','requirements-core.txt','requirements-full.txt']) assert.ok(fs.existsSync(path.join(resources,'speech',file)));
assert.ok(fs.existsSync(path.join(resources, 'speech/vendor/bodhan_flex/MODEL_LICENSE.md')));
assert.ok(!fs.existsSync(path.join(resources, 'speech/models')));
const { BAR_DESIGNS } = require(path.join(archive, 'dist/shared/barDesigns.js'));
assert.equal(BAR_DESIGNS.length, 7);
const { helperBridge } = require(path.join(archive, 'dist/main/helperBridge.js'));
const watchdog = setTimeout(() => { console.error('Packaged smoke test exceeded its deadline.'); helperBridge.stop(); app.exit(1); }, 60000);
watchdog.unref();
let ready = false;
helperBridge.on('ready', () => { ready = true; });
helperBridge.on('helper-error', error => console.error('Shipped helper:', error.message));
let selectedFolder=0;
if(fresh)dialog.showOpenDialog=async()=>{selectedFolder++;return {canceled:false,filePaths:[path.join(output,'chosen storage')]};};
require(path.join(archive, 'dist/main/main.js'));
const wait = async check => { const end = Date.now() + 15000; while (Date.now() < end) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 30)); } throw Error('Shipped app check timed out'); };
app.whenReady().then(async () => {
  assert.equal(app.getPath('userData'), profile);
  await wait(() => BrowserWindow.getAllWindows().some(window => window.getBounds().width > 600));
  const dashboard = BrowserWindow.getAllWindows().find(window => window.getBounds().width > 600);
  const pill = BrowserWindow.getAllWindows().find(window => window !== dashboard);
  if (fresh) {
    await wait(() => dashboard.webContents.executeJavaScript('!!document.querySelector(".first-run-setup")'));
    assert.equal(dashboard.isMinimized(),false); if(!offscreenCheck)await wait(() => dashboard.isVisible()); dashboard.hide();
  } else await wait(() => dashboard.isMinimized());
  assert.equal(pill.isFocusable(), false);
  assert.equal(dashboard.getTitle(), 'Owlio');
  assert.equal(nativeImage.createFromPath(path.join(archive, 'assets/brand/owlio.ico')).isEmpty(), false);
  const handle = dashboard.getNativeWindowHandle().readBigUInt64LE(0).toString();
  await new Promise((resolve,reject) => execFile('powershell.exe', ['-NoProfile','-File',path.join(__dirname,'window-icon.ps1'),'-WindowHandle',handle],
    { windowsHide: true, encoding: 'utf8', timeout: 10000 }, (error, stdout, stderr) => error ? reject(Error(stderr || error.message)) : resolve(stdout)));
  await wait(() => ready);
  assert.equal(helperBridge.resolveHelperPath(), path.join(resources, 'windows-helper/windows-helper.exe'));
  const preview = new BrowserWindow({ show: false, width: 1120, height: 900, webPreferences: {
    preload: path.join(archive, 'dist/preload/preload.js'), contextIsolation: true, offscreen: true, backgroundThrottling: false } });
  await preview.loadFile(path.join(archive, 'dist/renderer/index.html'), { query: { view: 'dashboard', tab: 'settings' } });
  const js = code => preview.webContents.executeJavaScript(code);
  const pjs = code => pill.webContents.executeJavaScript(code);
  if (fresh) {
    await wait(() => js('!!document.querySelector(".setup-choice-grid")'));
    await js('document.querySelectorAll(".setup-choice")[0].click();void 0;');
    await wait(() => js('!!document.querySelector("#setup-package")'));
    assert.equal(await js('document.querySelector("#setup-package").options.length'),4);
    const initial = await js('window.api.getLocalSetup()');
    assert.equal(initial.runtimeConfigured,false); assert.equal(initial.pythonInstalled,false);
    await js('document.querySelector("#choose-storage-root").click();void 0;');
    await wait(()=>js('document.querySelector(".setup-storage").textContent.includes("chosen storage")'));
    assert.equal(selectedFolder,1);
    const locations=await js('window.api.getLocalSetup()');assert.equal(locations.storage.root,path.join(output,'chosen storage','OwlioData'));assert.equal(locations.runtimeConfigured,false);
    assert.ok(fs.existsSync(path.join(profile,'local-storage.json')));
    assert.equal(fs.existsSync(path.join(profile,'speech-runtime.json')),false);
    const archivePath=path.join(locations.storage.cache,'python-3.11.17.tar.gz');
    const weight=path.join(locations.storage.models,'keep.bin');fs.writeFileSync(archivePath,'synthetic archive');fs.writeFileSync(weight,'synthetic weights');
    const cleaned=await js('window.api.clearLocalDownloadCache()');assert.equal(cleaned.state,'idle');assert.equal(fs.existsSync(archivePath),false);assert.ok(fs.existsSync(weight));
    // Check the shipped cleanup guard against a manually connected folder inside the cache.
    const protectedRuntime=path.join(output,'protected-runtime');fs.mkdirSync(protectedRuntime,{recursive:true});
    const protectedPython=path.join(protectedRuntime,'python.exe');fs.writeFileSync(protectedPython,'synthetic executable');
    const protectedModels=path.join(locations.storage.cache,'pip');fs.mkdirSync(protectedModels,{recursive:true});fs.writeFileSync(path.join(protectedModels,'model.bin'),'connected weights');
    fs.writeFileSync(path.join(profile,'speech-runtime.json'),JSON.stringify({python:protectedPython,models:protectedModels}));
    const refused=await js('window.api.clearLocalDownloadCache()');assert.equal(refused.state,'failed');assert.match(refused.error,/connected environment or models/);
    assert.ok(fs.existsSync(path.join(protectedModels,'model.bin')));fs.unlinkSync(path.join(profile,'speech-runtime.json'));
    await js('document.querySelector(".setup-later").click();void 0;');
    await wait(() => js('!!document.querySelector(".models-page")'));
    await js(`const provider=document.querySelector('[aria-label="Dictation provider"]');provider.value='local';provider.dispatchEvent(new Event('change',{bubbles:true}));void 0;`);
    await wait(() => js('!!document.querySelector(".settings-page .local-setup")'));
    assert.equal(fs.existsSync(path.join(profile,'local-speech')),false,'Skip must not download or create a runtime');
    assert.equal(fs.readdirSync(locations.storage.runtimes).length,0,'Choosing a folder and skipping must not install Python');
    await js('[...document.querySelectorAll(".local-setup button")].find(b=>b.textContent.includes("Open guided setup")).click();void 0;');
    await wait(() => js('!!document.querySelector(".first-run-setup")'));
    await js('document.querySelector(".setup-later").click();void 0;');
    await wait(() => js('!!document.querySelector(".models-page")'));
    await js('[...document.querySelectorAll(".nav-item")].find(button=>button.textContent==="General settings").click();void 0;');
  }
  await wait(() => js('document.querySelectorAll("input[name=bar-design]").length === 7'));
  for (const design of BAR_DESIGNS) {
    await js(`document.querySelector('input[name=bar-design][value="${design.id}"]').click();void 0;`);
    await js('document.querySelector(".settings-page .header-row button").click();void 0;');
    await wait(() => pjs(`document.querySelector('.pill-container')?.dataset.barDesign === '${design.id}'`));
    await wait(() => js(`document.querySelector('.appearance-option.selected input').value === '${design.id}' && !document.querySelector('.appearance-option.saving')`));
  }
  const settings = await js('window.api.getSettings()');
  assert.equal(settings.provider, 'mock'); assert.equal(settings.hotkey, 'F10');
  assert.equal(settings.setupCompleted,true);
  assert.equal(await js('window.api.getScratchpad()'), 'Release verification draft');
  const save = JSON.parse(fs.readFileSync(path.join(profile, 'owlio_config.json'), 'utf8'));
  assert.equal(save.settings.barDesign, 'firefly');
  const frame = await js('document.querySelector(".dashboard-layout").getBoundingClientRect().top');
  assert.equal(frame, 0);
  await js('[...document.querySelectorAll(".nav-item")].find(button=>button.textContent==="Text & style").click();void 0;');
  await wait(() => js('!!document.querySelector("#romanization-provider")'));
  assert.equal(await js('document.querySelector("#romanization-provider").value'),'off');
  assert.deepEqual(await js('[...document.querySelector("#romanization-provider").options].map(item=>item.textContent)'),['Original script','English letters']);
  assert.deepEqual(await js('[...document.querySelector("#formatting-provider").options].map(item=>item.textContent)'),['Basic','AI cleanup']);
  assert.equal(await js('!!document.querySelector(".dictation-flow")'),true);
  await js('document.querySelector(".settings-subnav button:nth-child(2)").click();void 0;');
  await wait(()=>js('!!document.querySelector("#punctuation-mode")'));
  assert.deepEqual(await js('[...document.querySelector("#punctuation-mode").options].map(item=>item.textContent)'),['Automatic','Standard','Minimal']);
  assert.equal(await js('document.querySelector("#punctuation-mode").getAttribute("aria-describedby")'),'punctuation-mode-help');
  await js('[...document.querySelectorAll(".nav-item")].find(button=>button.textContent==="Dictation").click();void 0;');
  await wait(()=>js('!!document.querySelector(".dictation-summary .current-setup")'));
  assert.equal(await js('document.querySelector(".dictation-page h1").textContent'),'Welcome back, Shubz');
  assert.equal(await js('document.querySelectorAll(".setup-change").length'),3);
  assert.equal(await js('document.querySelector(".dictation-summary").getBoundingClientRect().left >= document.querySelector(".dictation-feed").getBoundingClientRect().right'),true);
  if (fs.existsSync(path.join(archive,'dist/shared/speechLanguages.js'))) {
    const languages=require(path.join(archive,'dist/shared/speechLanguages.js'));
    assert.equal(languages.WHISPER_LANGUAGES.length,100);
    assert.equal(languages.SPEECH_LANGUAGE_CODES.length,114);
    assert.equal(languages.FLEX_LANGUAGE_CODES.length,27);
    assert.equal(languages.supportsSpeechLanguage('local','hf:Trelis/whisper-hinglish-preview','ta'),false);
    assert.equal(languages.selectSpeechModel('fr','bodhan-flex',[{id:'small',downloaded:true}]).model,'small');
    assert.equal(languages.selectSpeechModel('ja','turbo',[{id:'small',downloaded:true},{id:'turbo',downloaded:false}]).model,'small');
    assert.equal(languages.usesLatinScript('வணக்கம்'),false);
    const startup=await js('window.api.getStartupStatus()');
    assert.equal(startup.supported,false,'The isolated Electron harness must not register itself for Windows startup');
    assert.equal((await js('window.api.getSettings()')).startWithWindows,false);
    const registration=await js('window.api.updateSettings({startWithWindows:true}).then(()=>"unexpected success",error=>error.message)');
    assert.ok(registration.includes('Install Owlio on Windows'));
    assert.equal((await js('window.api.getSettings()')).startWithWindows,false);
    const multilingual=await js('window.api.updateSettings({dictationLanguage:"ta"})');
    assert.equal(multilingual.dictationLanguage,'ta');
    assert.equal(JSON.parse(fs.readFileSync(path.join(profile,'owlio_config.json'),'utf8')).settings.dictationLanguage,'ta');
  }
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ version: pkg.version, shippedAsar: true,
    shippedHelperReady: true, windowsIcons: true, designs: 7, persisted: true, freshSetup:fresh, customStorage:fresh, nativeFreshVisibility:fresh&&!offscreenCheck, isolatedProfile: true, noPrivateDataBundled: true }));
  console.log(`PASS: shipped ${pkg.version} ${fresh?'fresh setup/skip/reopen':'upgrade'} ASAR/helper, icons, seven designs and saved settings in an isolated profile.`);
  preview.destroy(); app.quit();
}).catch(error => { console.error(error.stack); helperBridge.stop(); app.exit(1); });
