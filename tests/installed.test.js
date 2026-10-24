const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const root = path.resolve(__dirname, '..');
const runtime = path.join(__dirname, '.runtime');
fs.mkdirSync(runtime, {recursive:true});
const load = (file, extra = {}) => {
  const exports = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'dist/main', file), 'utf8'), {
    exports, require: name => name === 'electron' ? {app:{isPackaged:false}} : name.startsWith('.') ? require(path.join(root, 'dist/main', name)) : require(name),
    process, fetch, Response, AbortSignal, URL, setTimeout, console, ...extra,
  });
  return exports;
};

test('automatic speech startup only manages the selected local loopback endpoint', () => {
  const {managedSpeechUrl} = load('speechServer.js');
  assert.equal(managedSpeechUrl({provider:'local',localSttUrl:'http://localhost:8000/v1'}).href, 'http://localhost:8000/v1/models');
  for (const localSttUrl of ['https://localhost:8000/v1','http://example.com:8000/v1','http://user:secret@localhost:8000/v1','http://localhost:8000/other']) {
    assert.equal(managedSpeechUrl({provider:'local',localSttUrl}), undefined);
  }
  assert.equal(managedSpeechUrl({provider:'groq',localSttUrl:'http://localhost:8000/v1'}), undefined);
});

test('installed app reuses an existing speech server and never stops its process', async () => {
  const calls=[];
  const {SpeechServer} = load('speechServer.js', {
    require: name => name === 'child_process' ? {spawn:(...args)=>calls.push(args)} : name.startsWith('.') ? require(path.join(root, 'dist/main', name)) : require(name),
    fetch: async()=>Response.json({service:'Owlio'}),
  });
  const server=new SpeechServer({packaged:true,profile:runtime,resources:root});
  await server.ensure({provider:'local',localSttUrl:'http://localhost:8000/v1',localSttModel:'bodhan-flex'});
  server.stop();
  assert.equal(calls.length,0);
});

test('concurrent startup launches one hidden speech process with the persistent models and stops only its own process tree', async () => {
  const directory=fs.mkdtempSync(path.join(runtime,'speech-start-'));
  const python=path.join(directory,'python.exe');
  const models=path.join(directory,'models');
  const resources=path.join(directory,'resources');
  fs.writeFileSync(python,''); fs.mkdirSync(models);
  fs.mkdirSync(path.join(resources,'speech'),{recursive:true});
  fs.writeFileSync(path.join(resources,'speech/server.py'),'');
  fs.writeFileSync(path.join(directory,'speech-runtime.json'),JSON.stringify({python,models}));
  const calls=[]; let started=false;
  const {SpeechServer}=load('speechServer.js',{
    require: name => name === 'child_process' ? {spawn:(...args)=>{
      calls.push(args); started=true; const child=new EventEmitter(); child.pid=123456; child.kill=()=>{}; return child;
    }} : name.startsWith('.') ? require(path.join(root, 'dist/main', name)) : require(name),
    fetch:async()=>{if(!started)throw new Error('offline');return Response.json({service:'Owlio'});},
  });
  const server=new SpeechServer({packaged:true,profile:directory,resources});
  const settings={provider:'local',localSttUrl:'http://localhost:8000/v1',localSttModel:'bodhan-flex'};
  await Promise.all([server.ensure(settings),server.ensure(settings)]);
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],python);
  assert.equal(calls[0][2].windowsHide,true);
  assert.equal(calls[0][2].env.OWLIO_MODEL_CACHE,models);
  assert.equal(calls[0][2].env.WHISPER_MODEL,'bodhan-flex');
  server.stop();
  if(process.platform==='win32') {
    assert.equal(calls[1][0],'taskkill.exe');
    assert.deepEqual(Array.from(calls[1][1]),['/PID','123456','/T','/F']);
  }
});

test('a different service at the speech address is not replaced', async () => {
  const {SpeechServer}=load('speechServer.js',{fetch:async()=>Response.json({service:'unrelated'})});
  const server=new SpeechServer({packaged:true,profile:runtime,resources:root});
  await assert.rejects(server.ensure({provider:'local',localSttUrl:'http://localhost:8000/v1',localSttModel:'base'}),/not the Owlio/);
});
