// Checks local microphone routing only. Captured samples are discarded, never saved/uploaded.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const output = path.join(__dirname, '.runtime');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'microphone-profile'));
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(true));
  const page = path.join(output, 'microphone-diagnostic.html');
  fs.writeFileSync(page, '<!doctype html><title>Owlio microphone routing check</title>');
  await window.loadFile(page);
  // Use the same compiled recorder as the regression suite, inside Chromium's real audio environment.
  const source = fs.readFileSync(path.join(__dirname, '.compiled/audioRecorder.js'), 'utf8');
  const workletUrl = pathToFileURL(path.join(root,'dist/renderer/recorderWorklet.js')).href;
  const result = await window.webContents.executeJavaScript(`(async () => {
    const exports = {};
    ${source}
    const labels = [];
    for (const device of ['communications', 'owlio-disconnected-test-device']) {
      const recorder = new exports.AudioRecorder(${JSON.stringify(workletUrl)});
      recorder.onMicrophoneChange = label => labels.push({ requested: device, actual: label });
      try { await recorder.start(device); }
      finally { await recorder.dispose(); }
    }
    return labels;
  })()`);
  assert.equal(result.length, 2);
  assert.ok(result.every(item => item.actual));
  console.log('PASS: real microphone routing:', JSON.stringify(result));
  window.destroy(); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
