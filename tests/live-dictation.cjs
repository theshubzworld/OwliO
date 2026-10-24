// Usage: node tests/live-dictation.cjs path/to/speech.wav (requires the local server).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const exportsObject = {};
const settings = {
  provider: 'local', dictationLanguage: 'en', instructModeEnabled: false, writingStyle: 'auto',
  localSttUrl: 'http://localhost:8000/v1', localLlmUrl: 'http://localhost:11434', localLlmModel: 'llama3.2',
  localSttModel: process.argv[3] || 'base',
};
if (process.argv[4]) settings.dictationLanguage = process.argv[4];
vm.runInNewContext(fs.readFileSync(path.join(root, 'dist/main/aiService.js'), 'utf8'), {
  exports: exportsObject,
  require: name => name === './store' ? { store: { getSettings: () => settings, getDictionary: () => [] } } : require(name),
  Buffer, fetch, FormData, Blob, AbortSignal, console,
});
(async () => {
  const result = await exportsObject.processAudioDictation(fs.readFileSync(process.argv[2]), {
    processName: 'notepad', windowTitle: 'Disposable test field', browserUrl: '', surroundingText: '',
  });
  assert.ok(result.rawText.trim(), 'Recognized speech must survive the response parser');
  assert.ok(result.formattedText.trim(), 'The formatter must preserve speech even when Ollama is unavailable');
  console.log('Recognized:', result.rawText);
  const paste = spawnSync('pwsh', ['-NoProfile', '-STA', '-File', path.join(__dirname, 'native-paste.ps1'),
    '-HelperPath', path.join(root, 'windows-helper/bin/Release/net8.0-windows/publish/windows-helper.exe'),
    '-TextToPaste', result.formattedText], { encoding: 'utf8', timeout: 20000 });
  process.stdout.write(paste.stdout || '');
  process.stderr.write(paste.stderr || '');
  if (paste.error) throw paste.error;
  assert.equal(paste.status, 0, 'Native insertion must succeed');
  console.log('PASS: generated speech → live local Whisper → app parser/formatter → captured Windows text field.');
})().catch(error => { console.error(error); process.exitCode = 1; });
