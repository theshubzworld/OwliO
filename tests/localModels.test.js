const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const settings = { localSttUrl: 'http://localhost:8000/v1', localLlmUrl: 'http://localhost:11434' };
function load(fetch) {
  const exports = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/main/localModels.js'), 'utf8'), {
    exports, require: name => name === './store' ? ({ store: { getSettings: () => settings } }) : require(path.join(__dirname, '../dist/main', name)), fetch, AbortSignal, AbortController,
    TextDecoder, setTimeout, clearTimeout, console,
  });
  return exports;
}
test('model status distinguishes speech server availability from offline Ollama', async () => {
  const api = load(async url => {
    if (url.endsWith('/api/tags')) throw new Error('offline');
    return Response.json({ service: 'Owlio', models: [{ id: 'base', downloaded: true }], jobs: [] });
  });
  const status = await api.getLocalModels();
  assert.equal(status.speech.online, true); assert.equal(status.formatting.online, false);
  assert.match(status.formatting.error, /Built-in/);
  await assert.rejects(api.speechModelAction('missing', 'download'), /supported/);
});
test('custom model import canonicalizes only Hugging Face model repositories', async () => {
  const calls = [];
  const api = load(async (url, options) => { calls.push([url, JSON.parse(options.body)]); return Response.json({ id: 'download', status: 'queued' }); });
  await api.importSpeechModel('https://huggingface.co/Trelis/whisper-hinglish-preview/tree/main');
  assert.equal(calls[0][0], 'http://localhost:8000/v1/models/import');
  assert.equal(calls[0][1].url, 'Trelis/whisper-hinglish-preview');
  for (const url of ['https://evil.example/Trelis/model', 'https://huggingface.co/datasets/foo', 'https://huggingface.co/owner/model?token=secret', 'https://user@huggingface.co/owner/model', '../model']) {
    await assert.rejects(api.importSpeechModel(url));
  }
  assert.equal(calls.length, 1, 'Invalid URLs never reach the server');
  await api.speechModelAction('hf:Trelis/whisper-hinglish-preview', 'activate');
  assert.equal(calls[1][1].model, 'hf:Trelis/whisper-hinglish-preview');
});
test('Ollama downloads handle split progress lines and wait for explicit success', async () => {
  let finish;
  const stream = new ReadableStream({ start(controller) { finish = controller; } });
  const api = load(async url => url.endsWith('/api/pull') ? new Response(stream) : Response.json(url.endsWith('/api/tags') ? { models: [] } : { service: 'Owlio', models: [], jobs: [] }));
  const job = api.pullFormattingModel('llama3.2');
  const enc = new TextEncoder();
  finish.enqueue(enc.encode('{"status":"downloading","completed":5,'));
  finish.enqueue(enc.encode('"total":10}\n'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(job.state, 'running'); assert.equal(job.completed, 5);
  assert.throws(() => api.pullFormattingModel('another'), /current/);
  finish.enqueue(enc.encode('{"status":"success"}')); finish.close();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(job.state, 'ready');
});
test('Ollama disconnect never falsely reports a completed download', async () => {
  const api = load(async () => new Response('{"status":"downloading"}\n'));
  const job = api.pullFormattingModel('llama3.2');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(job.state, 'failed'); assert.match(job.error, /confirming/);
});
