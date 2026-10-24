const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const root = path.resolve(__dirname, '..');
const flush = () => new Promise(resolve => setImmediate(resolve));
const context = { targetId: 'target-1', processName: 'editor', windowTitle: 'test', browserUrl: '', surroundingText: '' };

function load(file, replacements, extra = {}) {
  const exports = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'dist/main', file), 'utf8'), {
    require: name => replacements[name] || (name.startsWith('.') ? require(path.join(root, 'dist/main', name)) : require(name)), exports,
    __dirname: path.join(root, 'dist/main'), process, console: { log() {}, warn() {}, error() {} },
    Buffer, ArrayBuffer, Uint8Array, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, ...extra,
  });
  return exports;
}

test('transcription accepts plain text, JSON strings and JSON objects without losing speech', () => {
  const { parseTranscriptionResponse: parse } = load('aiService.js', { './store': { store: {} } });
  for (const response of [' Hello world ', '"Hello world"', '{"text":" Hello world "}']) assert.equal(parse(response), 'Hello world');
  for (const response of ['', '""', '{"text":""}']) assert.equal(parse(response), '');
  assert.throws(() => parse('{"error":"model failed"}'), /unsupported/);
});

test('selected local model is sent to speech recognition and odd WAV sizes have valid timeouts', async () => {
  let requestedModel;
  const settings = { provider: 'local', localSttModel: 'tiny', localSttUrl: 'http://localhost:8000/v1', localLlmUrl: 'http://localhost:11434', localLlmModel: 'llama3.2', dictationLanguage: 'en', writingStyle: 'auto', instructModeEnabled: false };
  const api = load('aiService.js', { './store': { store: { getSettings: () => settings, getDictionary: () => [] } } }, {
    Blob, FormData, AbortSignal,
    fetch: async (url, options) => {
      if (url.endsWith('/api/generate')) throw new Error('Ollama offline');
      requestedModel = options.body.get('model');
      return new Response('Hello world');
    },
  });
  const result = await api.processAudioDictation(Buffer.alloc(352951), context);
  assert.equal(requestedModel, 'tiny');
  assert.equal(result.rawText, 'Hello world'); assert.ok(result.formattedText.includes('Hello'));
});

test('an unavailable rewrite model preserves spoken words and explains the fallback', async () => {
  const settings = { provider: 'local', localSttModel: 'base', localSttUrl: 'http://localhost:8000/v1', localLlmUrl: 'http://localhost:11434', localLlmModel: 'llama3.2', dictationLanguage: 'en', writingStyle: 'auto', instructModeEnabled: true };
  const api = load('aiService.js', { './store': { store: { getSettings: () => settings, getDictionary: () => [] } } }, {
    Blob, FormData, AbortSignal, fetch: async url => {
      if (url.endsWith('/api/generate')) throw new Error('Ollama offline');
      return new Response('make it formal');
    },
  });
  const result = await api.processAudioDictation(Buffer.alloc(32044), { ...context, surroundingText: 'Hey there', selectedText: 'Hey there' });
  assert.equal(result.formattedText, 'make it formal'); assert.equal(result.isInstruct, false);
  assert.equal(result.skipInsertion,true);
  assert.match(result.warning, /unavailable/);
});
test('Hinglish reaches custom speech models without being silently changed to English', async () => {
  const settings = { provider: 'local', localSttModel: 'hf:Trelis/whisper-hinglish-preview', localSttUrl: 'http://localhost:8000/v1', localLlmUrl: 'http://localhost:11434', localLlmModel: 'llama3.2', dictationLanguage: 'hinglish', writingStyle: 'auto', instructModeEnabled: false };
  let language;
  const api = load('aiService.js', { './store': { store: { getSettings: () => settings, getDictionary: () => [] } } }, {
    Blob, FormData, AbortSignal, fetch: async (url, options) => {
      if (url.endsWith('/api/generate')) throw new Error('Ollama offline');
      language = options.body.get('language');
      return new Response('कल meeting है');
    },
  });
  const result = await api.processAudioDictation(Buffer.alloc(32044), context);
  assert.equal(language, 'hinglish');
  assert.ok(result.formattedText.includes('कल meeting है'));
});
test('Flex always requests native transcription, ignoring legacy script settings', async () => {
  const settings = { provider: 'local', localSttModel: 'bodhan-flex', localSttOutputMode: 'romanized', localSttUrl: 'http://localhost:8000/v1', localLlmUrl: 'http://localhost:11434', localLlmModel: 'llama3.2', dictationLanguage: 'hinglish', writingStyle: 'auto', instructModeEnabled: false };
  let form;
  const api = load('aiService.js', { './store': { store: { getSettings: () => settings, getDictionary: () => [] } } }, {
    Blob, FormData, AbortSignal, fetch: async (url, options) => {
      if (url.endsWith('/api/generate')) throw new Error('Ollama offline');
      form = options.body;
      return new Response('kal meeting hai');
    },
  });
  const result = await api.processAudioDictation(Buffer.alloc(32044), context);
  assert.equal(form.get('language'), 'hinglish');
  assert.equal(form.get('output_mode'), 'native');
  assert.equal(form.get('model'), 'bodhan-flex');
  assert.match(result.formattedText, /kal meeting hai/i);
  settings.localSttOutputMode = 'mixed';
  await api.processAudioDictation(Buffer.alloc(32044), context);
  assert.equal(form.get('output_mode'), 'native');
});
test('cleanup preserves already Latin speech without requesting local transliteration', async () => {
  const settings = { provider: 'local', localSttModel: 'bodhan-flex', localSttOutputMode: 'romanized', localSttUrl: 'http://localhost:8000/v1', localLlmUrl: 'http://localhost:11434', localLlmModel: 'llama3.2', dictationLanguage: 'hinglish', writingStyle: 'auto', instructModeEnabled: false };
  const api = load('aiService.js', { './store': { store: { getSettings: () => settings, getDictionary: () => [] } } }, {
    Blob, FormData, AbortSignal, fetch: async (url, options) => {
      if (url.endsWith('/api/generate')) {
        assert.match(JSON.parse(options.body).prompt, /Keep Romanized/);
        return Response.json({ response: 'कल meeting है' });
      }
      return new Response('kal meeting hai');
    },
  });
  const result = await api.processAudioDictation(Buffer.alloc(32044), context);
  assert.equal(result.formattedText, 'Kal meeting hai.');
});

async function harness(extraSettings = {}, catalogue = {speech:{jobs:[{id:"model-job",status:"ready"}]}}) {
  const events = [], handlers = new Map(), history = [], pasteCalls = [], settingsCalls = [];
  let resolveContext;
  let pasteResult = true;
  let accessBlocked=false, suspendAccount;
  let processAudio = async () => ({ rawText: 'Hello', formattedText: 'Hello', isInstruct: false });
  const learnedCorrections=[];
  const helper = new EventEmitter();
  helper.start = () => {};
  helper.stop = () => {};
  helper.cancelLearning = () => {};
  helper.cancelPaste = () => {};
  helper.updateHotkey = (...args) => settingsCalls.push(args);
  helper.getContext = () => new Promise(resolve => { resolveContext = resolve; });
  helper.paste = async (...args) => { pasteCalls.push(args); return pasteResult; };
  class Window {
    webContents = { send: (channel, message) => { if (channel === 'pill-state-changed') events.push(message); }, on() {}, invalidate() {}, isCrashed() { return false; } };
    isDestroyed() { return false; }
    loadURL() { return Promise.resolve(); }
    loadFile() { return Promise.resolve(); }
    setVisibleOnAllWorkspaces() {}
    setIgnoreMouseEvents() {}
    isVisible() { return true; }
    show() {}
    focus() {}
    isMinimized() { return false; }
    showInactive() {}
    setAlwaysOnTop() {}
    moveTop() {}
    getBounds() { return { x: 0, y: 0, width: 64, height: 40 }; }
    on() {}
    once() {}
  }
  const electron = {
    app: { whenReady: () => Promise.resolve(), on() {}, setAppUserModelId() {}, setPath() {}, isPackaged: false, getPath:()=>path.join(root,'tests/.runtime/controller-profile') }, BrowserWindow: Window,
    ipcMain: { on: (name, fn) => handlers.set(name, fn), handle: (name, fn) => handlers.set(name, fn) },
    screen: { on() {}, getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }), getCursorScreenPoint: () => ({ x: -100, y: -100 }) },
    Tray: class { setToolTip() {} setContextMenu() {} on() {} },
    Menu: { buildFromTemplate: items => items }, nativeImage: { createFromPath: () => ({ resize: () => ({}) }) }, clipboard: { writeText() {} },
  };
  load('main.js', {
    electron, './helperBridge': { helperBridge: helper },
    './cloudRuntime': {startCloudServices:callback=>{suspendAccount=callback;},stopCloudServices(){},captureMetric(){},requireAccountAccess(){if(accessBlocked)throw Error('Account suspended');}},
    './localModels': {
      speechModelAction: async (model, action) => ({ id: 'model-job', model, action }),
      getLocalModels: async () => catalogue,
    },
    './aiService': { processAudioDictation: (...args) => processAudio(...args) },
    './learningService': {LearningService:class{async correct(...args){learnedCorrections.push(args);return {added:0,pending:1};}}},
    './store': { store: { getSettings: () => ({ hotkey: 'RALT', mode: 'toggle', localSttModel: 'base',...extraSettings }), previewSettings:patch=>({localSttModel:'base',...extraSettings,...patch}), updateSettings: patch => ({ hotkey: 'RALT', mode: 'toggle', ...extraSettings,...patch }), getSnippets: () => [], addHistory: item => { const index = history.findIndex(entry => entry.id === item.id); if (index >= 0) history[index] = item; else history.unshift(item); } } },
  });
  await flush();
  return {
    helper, events, handlers, history, pasteCalls, settingsCalls,learnedCorrections,
    resolve: () => resolveContext(context),
    setPasteResult: result => { pasteResult = result; },
    setAccessBlocked:blocked=>{accessBlocked=blocked;if(blocked)suspendAccount();},
    setProcessor: processor => { processAudio = processor; },
    start: () => { helper.emit('hotkey_down', { targetHwnd: '123' }); return events.at(-1).sessionId; },
    stop: () => helper.emit('hotkey_up'),
    audio: sessionId => handlers.get('audio-recorded')({}, { sessionId, buffer: Buffer.alloc(32044) }),
  };
}

test('suspended signed-in accounts cannot start dictation or meetings; guest access resumes', async () => {
  const h=await harness();h.setAccessBlocked(true);h.start();
  assert.equal(h.events.at(-1).state,'error');assert.match(h.events.at(-1).errorMessage,/suspended/);
  await assert.rejects(h.handlers.get('begin-meeting-capture')(),/suspended/);
  await assert.rejects(h.handlers.get('recover-dictation')({},'id'),/suspended/);
  h.setAccessBlocked(false);h.start();assert.equal(h.events.at(-1).state,'listening');h.handlers.get('cancel-dictation')();
});

test('remote suspension cancels processing before native insertion', async () => {
  const h=await harness();let finish,started=false;
  h.setProcessor(async()=>{started=true;return new Promise(resolve=>{finish=resolve;});});
  const id=h.start();h.resolve();h.stop();const processing=h.audio(id);await flush();assert.equal(started,true);
  h.setAccessBlocked(true);finish({rawText:'Hello',formattedText:'Hello',isInstruct:false});await processing;
  assert.equal(h.pasteCalls.length,0);
});

test('fast key release while context is pending never restarts listening', async () => {
  const h = await harness();
  h.start(); h.stop(); h.resolve(); await flush();
  assert.deepEqual(h.events.map(event => event.state), ['listening', 'processing']);
  h.handlers.get('cancel-dictation')();
});

test('failed paste shows an error and is not saved as a successful dictation', async () => {
  const h = await harness();
  const id = h.start(); h.resolve(); h.stop(); h.setPasteResult(false); await h.audio(id);
  assert.equal(h.events.at(-1).state, 'error');
  assert.match(h.events.at(-1).errorMessage, /clipboard/);
  assert.equal(h.history.length, 1);
  assert.equal(h.history[0].deliveryStatus, 'failed');
  assert.equal(h.history[0].formattedText, 'Hello');
  assert.match(h.history[0].errorMessage, /clipboard/);
  assert.match(h.handlers.get('get-last-failure')().errorMessage, /clipboard/);
});

test('successful paste uses the captured target and stores history', async () => {
  const h = await harness();
  const id = h.start(); h.resolve(); h.stop(); await h.audio(id);
  assert.equal(h.events.at(-1).state, 'pasted');
  assert.deepEqual(h.pasteCalls[0], ['Hello', 'target-1',false]);
  assert.equal(h.history[0].processName, 'editor');
});

test('processing checkpoints retain recognized words when a later stage fails',async()=>{
  const h=await harness();
  h.setProcessor(async(_wav,_context,options)=>{options.onTranscribed('Words already recognized');throw Error('Later stage failed');});
  const id=h.start();h.resolve();h.stop();await h.audio(id);
  assert.equal(h.history.length,1);assert.equal(h.history[0].formattedText,'Words already recognized');
  assert.equal(h.history[0].deliveryStatus,'failed');assert.match(h.history[0].errorMessage,/Later stage/);assert.equal(h.pasteCalls.length,0);
});

test('rewrite insertion includes its exact source selection precondition',async()=>{
  const h=await harness();h.setProcessor(async()=>({rawText:'make it formal',formattedText:'Dear team',isInstruct:true,replaceText:'hey team'}));
  const id=h.start();h.resolve();h.stop();await h.audio(id);
  assert.deepEqual(h.pasteCalls[0],['Dear team','target-1',false,'hey team']);
});

test('a failed rewrite never pastes its spoken instruction over the selected source',async()=>{
  const h=await harness();h.setProcessor(async()=>({rawText:'make it formal',formattedText:'make it formal',isInstruct:false,skipInsertion:true,warning:'Rewrite unavailable; selection unchanged.'}));
  const id=h.start();h.resolve();h.stop();await h.audio(id);
  assert.equal(h.pasteCalls.length,0);assert.equal(h.history[0].deliveryStatus,'failed');
  assert.match(h.events.at(-1).errorMessage,/selection unchanged/);
});

test('native learning events are bound to a successful paste and cannot leak into a later session',async()=>{
  const h=await harness({autoLearnCorrections:true});
  const id=h.start();h.resolve();h.stop();await h.audio(id);
  assert.equal(h.pasteCalls[0][2],true);
  h.helper.emit('learning-correction',{targetId:'wrong',originalText:'Hello',editedText:'Helo'});await flush();
  assert.equal(h.learnedCorrections.length,0);
  h.helper.emit('learning-correction',{targetId:'target-1',originalText:'Hello',editedText:'Helo'});await flush();
  assert.deepEqual(h.learnedCorrections[0],[h.history[0].id,'Helo']);
  h.helper.emit('learning-correction',{targetId:'target-1',originalText:'Hello',editedText:'Other'});await flush();
  assert.equal(h.learnedCorrections.length,1);
  const second=h.start();h.resolve();h.stop();await h.audio(second);
  h.start(); // A new recording invalidates the old paste association.
  h.helper.emit('learning-correction',{targetId:'target-1',originalText:'Hello',editedText:'Other'});await flush();
  assert.equal(h.learnedCorrections.length,1);
  h.handlers.get('cancel-dictation')();
});

test('cancelled transcription cannot paste and processing rejects new recordings', async () => {
  const h = await harness();
  let finish;
  h.setProcessor(() => new Promise(resolve => { finish = resolve; }));
  const id = h.start(); h.resolve(); h.stop();
  const work = h.audio(id); await flush();
  h.helper.emit('hotkey_down');
  assert.equal(h.events.filter(event => event.state === 'listening').length, 1);
  h.handlers.get('cancel-dictation')();
  finish({ rawText: 'Hello', formattedText: 'Hello', isInstruct: false }); await work;
  assert.equal(h.pasteCalls.length, 0);
});

test('stale audio is ignored and microphone failures permit retry', async () => {
  const h = await harness();
  const id = h.start(); h.resolve(); h.stop();
  await h.audio(id + 1); assert.equal(h.pasteCalls.length, 0);
  h.handlers.get('recording-failed')({}, { sessionId: id, errorMessage: 'Microphone denied' });
  assert.equal(h.events.at(-1).state, 'error');
  const retry = h.start(); assert.ok(retry > id);
  h.resolve(); h.handlers.get('cancel-dictation')();
});

test('saved hotkey and toggle mode are applied on startup', async () => {
  const h = await harness();
  assert.deepEqual(h.settingsCalls[0], ['RALT', 'toggle']);
});

test('settings notifications keep a listening snapshot without replaying a recording start', async () => {
  const h = await harness();
  const session = h.start(); h.resolve();
  const before = h.handlers.get('get-pill-state')();
  assert.equal(before.state, 'listening'); assert.equal(before.sessionId, session);
  await h.handlers.get('update-settings')({}, { writingStyle: 'casual' });
  assert.equal(h.events.at(-1).state, undefined);
  assert.equal(h.handlers.get('get-pill-state')().state, 'listening');
  assert.ok(h.handlers.get('get-pill-state')().revision > before.revision);
  h.handlers.get('cancel-dictation')();
});

test('bar appearance can change during dictation without resetting the shortcut or active recording', async () => {
  const h = await harness({ barDesign: 'owl' });
  const id = h.start(); h.resolve();
  const shortcutUpdates = h.settingsCalls.length;
  const listeningEvents = h.events.filter(event => event.state === 'listening').length;
  await h.handlers.get('update-settings')({}, { barDesign: 'cloud' });
  assert.equal(h.events.at(-1).barDesign, 'cloud');
  assert.equal(h.events.at(-1).state, undefined);
  assert.equal(h.handlers.get('get-pill-state')().sessionId, id);
  assert.equal(h.handlers.get('get-pill-state')().barDesign, 'cloud');
  assert.equal(h.settingsCalls.length, shortcutUpdates);
  assert.equal(h.events.filter(event => event.state === 'listening').length, listeningEvents);
  h.stop(); await h.audio(id);
  assert.equal(h.handlers.get('get-pill-state')().barDesign, 'cloud');
  assert.equal(h.pasteCalls.length, 1);
  assert.equal(h.history[0].formattedText, 'Hello');
});

test('speech model activation is saved only after a confirmed load and cannot interrupt dictation', async () => {
  const h = await harness();
  h.start(); h.resolve();
  await assert.rejects(h.handlers.get('speech-model-action')({}, 'tiny', 'activate'), /Finish dictation/);
  h.handlers.get('cancel-dictation')();
  const settings = await h.handlers.get('speech-model-action')({}, 'tiny', 'activate');
  assert.equal(settings.localSttModel, 'tiny'); assert.equal(settings.hotkey, 'RALT');
});

test('changing the shortcut during a recording cannot strand the held session', async () => {
  const h = await harness();
  h.start(); h.resolve();
  await assert.rejects(h.handlers.get('update-settings')({}, { hotkey: 'Ctrl+Win' }), /Finish dictation/);
  h.handlers.get('cancel-dictation')();
});

test('custom shortcut and mode survive a settings store restart', () => {
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'owlio-shortcut-'));
  try {
    const { Store } = load('store.js', { electron: { app: { getPath: () => directory }, safeStorage: {} } }, { structuredClone });
    const first = new Store(directory);
    first.updateSettings({ hotkey: 'Ctrl+Win', mode: 'toggle' });
    const reloaded = new Store(directory).getSettings();
    assert.equal(reloaded.hotkey, 'Ctrl+Win'); assert.equal(reloaded.mode, 'toggle');
  } finally {
    const config = path.join(directory, 'owlio_config.json');
    if (fs.existsSync(config)) fs.unlinkSync(config);
    fs.rmdirSync(directory);
  }
});

test('Owlio keeps the current scratchpad welcome and preserves saved drafts and dictionary entries', () => {
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'owlio-copy-'));
  const config = path.join(directory, 'owlio_config.json');
  try {
    const { Store } = load('store.js', { electron: { app: { getPath: () => directory }, safeStorage: {} } }, { structuredClone });
    const savedDraft = 'Notes for the next release';
    const savedDictionary = [{ id: 'custom', from: 'owl io', to: 'Owlio' }];
    fs.writeFileSync(config, JSON.stringify({ settings: {}, scratchpadText: savedDraft, dictionary: savedDictionary }));
    const store = new Store(directory);
    assert.equal(store.getScratchpad(), savedDraft);
    assert.deepEqual(store.getDictionary(), savedDictionary);
  } finally {
    if (fs.existsSync(config)) fs.unlinkSync(config);
    fs.rmdirSync(directory);
  }
});

test('bar designs persist independently; old profiles default to owl and invalid choices preserve settings', () => {
  const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'owlio-appearance-'));
  const config = path.join(directory, 'owlio_config.json');
  try {
    const { Store } = load('store.js', { electron: { app: { getPath: () => directory }, safeStorage: {} } }, { structuredClone });
    fs.writeFileSync(config, JSON.stringify({ settings: { hotkey: 'Ctrl+Win', mode: 'toggle' }, scratchpadText: 'My draft' }));
    const store = new Store(directory);
    assert.equal(store.getSettings().barDesign, 'owl');
    const original = store.getSettings();
    for (const design of ['cat', 'cloud', 'robot', 'waveform', 'pebble', 'firefly', 'owl']) {
      store.updateSettings({ barDesign: design });
      const saved = new Store(directory).getSettings();
      assert.equal(saved.barDesign, design);
      for (const key of Object.keys(original)) if (key !== 'barDesign') assert.equal(saved[key], original[key]);
      assert.equal(new Store(directory).getScratchpad(), 'My draft');
    }
    assert.throws(() => store.updateSettings({ barDesign: 'unknown' }), /Expected one of/);
    assert.equal(new Store(directory).getSettings().barDesign, 'owl');
  } finally {
    if (fs.existsSync(config)) fs.unlinkSync(config);
    fs.rmdirSync(directory);
  }
});

test('helper correlates concurrent requests, propagates failures, and reapplies settings on ready', async () => {
  const child = new EventEmitter();
  const commands = [];
  child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
  child.stdin.writable = true; child.stdin.write = line => commands.push(JSON.parse(line)); child.kill = () => {};
  const { HelperBridge } = load('helperBridge.js', {
    child_process: { spawn: () => child }, fs: { existsSync: () => true },
  });
  const bridge = new HelperBridge(); bridge.on('helper-error', () => {});
  bridge.updateHotkey('F9', 'toggle'); bridge.start();
  const message = msg => child.stdout.emit('data', JSON.stringify(msg) + '\n');
  message({ type: 'ready' });
  assert.equal(commands[0].key, 'F9'); assert.equal(commands[0].mode, 'toggle');
  const first = bridge.getContext('11'), second = bridge.getContext('22');
  const [a, b] = commands.slice(-2);
  message({ type: 'context_result', requestId: b.requestId, processName: 'second' });
  message({ type: 'context_result', requestId: a.requestId, processName: 'first' });
  assert.equal((await first).processName, 'first'); assert.equal((await second).processName, 'second');
  const paste = bridge.paste('hello', a.requestId);
  message({ type: 'paste_completed', requestId: commands.at(-1).requestId, success: false, error: 'Cannot focus target' });
  await assert.rejects(paste, /Cannot focus target/);
  const pending = bridge.getContext(); bridge.stop(); await assert.rejects(pending, /stopped/);
});


test('global Save rejects undownloaded speech models and preserves recording guards',async()=>{
  const catalogue={speech:{online:true,models:[{id:'tiny',downloaded:false}]},formatting:{online:false}};
  const h=await harness({provider:'local'},catalogue);
  await assert.rejects(h.handlers.get('update-settings')({}, {localSttModel:'tiny'}),/Download the selected speech model/);
  catalogue.speech.models[0].downloaded=true;
  const saved=await h.handlers.get('update-settings')({}, {localSttModel:'tiny'});assert.equal(saved.localSttModel,'tiny');
  h.start();h.resolve();await assert.rejects(h.handlers.get('update-settings')({}, {localSttModel:'tiny'}),/Finish dictation/);
  h.handlers.get('cancel-dictation')();
});

test('global Save requires a reachable installed local Writing AI before enabling it',async()=>{
  const catalogue={speech:{online:false},formatting:{online:false}};
  const h=await harness({provider:'local',writingProvider:'off',formattingProvider:'basic',localLlmModel:'writer'},catalogue);
  await assert.rejects(h.handlers.get('update-settings')({}, {writingProvider:'local',instructModeEnabled:true}),/Start Ollama/);
  catalogue.formatting={online:true,models:[{name:'other'}]};
  await assert.rejects(h.handlers.get('update-settings')({}, {writingProvider:'local',instructModeEnabled:true}),/Start Ollama/);
  catalogue.formatting.models.push({name:'writer:latest'});
  const saved=await h.handlers.get('update-settings')({}, {writingProvider:'local',instructModeEnabled:true});assert.equal(saved.writingProvider,'local');
});


test('Whisper mixed Hindi-English speech is never forced through English decoding for transliteration',async()=>{
  const settings={provider:'local',formattingProvider:'basic',writingProvider:'off',localSttModel:'base',localSttUrl:'http://localhost:8000/v1',dictationLanguage:'hinglish',instructModeEnabled:false,writingStyle:'auto'};
  let form;
  const api=load('aiService.js',{'./store':{store:{getSettings:()=>settings,getDictionary:()=>[]}}},{Blob,FormData,AbortSignal,fetch:async(_url,options)=>{form=options.body;return new Response('कल meeting है');}});
  const result=await api.processAudioDictation(Buffer.alloc(32044),context);
  assert.equal(form.get('language'),'hi');assert.equal(form.get('output_mode'),null);assert.equal(result.rawText,'कल meeting है');assert.ok(!form.get('prompt').includes('Haan yaar'));
});


test('changing a custom model language checks its declared coverage before saving',async()=>{
  const catalogue={speech:{online:true,models:[{id:'hf:owner/tamil',downloaded:true,languages:['ta']}]},formatting:{online:false}};
  const h=await harness({provider:'local',localSttModel:'hf:owner/tamil',dictationLanguage:'ta'},catalogue);
  await assert.rejects(h.handlers.get('update-settings')({}, {dictationLanguage:'fr'}),/does not declare/);
  const saved=await h.handlers.get('update-settings')({}, {dictationLanguage:'auto'});assert.equal(saved.dictationLanguage,'auto');
});
