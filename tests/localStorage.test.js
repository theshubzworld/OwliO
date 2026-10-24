const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {LocalSetup,dependencyFingerprint}=require('../dist/main/localSetup');
const {storagePaths,validateStorage,copyModelCache,clearDownloadCache}=require('../dist/main/localStorage');
const root=path.resolve(__dirname,'..');
function fixture(){
  const profile=fs.mkdtempSync(path.join(__dirname,'.runtime/storage-'));
  const runtime=path.join(profile,'original-environment');fs.mkdirSync(runtime);
  const python=path.join(runtime,'python.exe'),models=path.join(profile,'original-models');
  fs.writeFileSync(python,'original Python');fs.mkdirSync(models);fs.writeFileSync(path.join(models,'model.bin'),'synthetic model');
  const config=JSON.stringify({python,models});fs.writeFileSync(path.join(profile,'speech-runtime.json'),config);
  const custom=storagePaths(path.join(profile,'new drive','Owlio Data'));
  const manager=new LocalSetup({profile,speech:root,onReady:async()=>{}});
  return {profile,python,models,config,custom,manager};
}
async function finish(manager){const end=Date.now()+5000;while(manager.getStatus().state==='running'&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,5));return manager.getStatus();}
test('custom storage persists independent environment/model/cache paths without replacing a working connection',()=>{
  const {profile,config,custom,manager}=fixture();
  custom.models=path.join(profile,'model disk','Owlio-models');custom.cache=path.join(profile,'cache disk','Owlio-downloads');
  const result=manager.setStorage(custom);assert.deepEqual(result.storage,custom);assert.equal(result.defaultStorage,false);assert.equal(result.runtimeConfigured,true);
  assert.equal(fs.readFileSync(path.join(profile,'speech-runtime.json'),'utf8'),config);
  assert.deepEqual(new LocalSetup({profile,speech:root,onReady:async()=>{}}).getStatus().storage,custom);
  assert.equal(manager.resetStorage().defaultStorage,true);assert.equal(fs.readFileSync(path.join(profile,'speech-runtime.json'),'utf8'),config);
});
test('overlapping folders, drive roots and junction aliases are rejected before they can mix models and cache',()=>{
  const {profile,custom}=fixture();assert.throws(()=>validateStorage({...custom,models:custom.cache}),/separate/);
  assert.throws(()=>validateStorage({...custom,cache:path.join(custom.models,'cache')}),/separate/);
  assert.throws(()=>validateStorage({...custom,runtimes:path.parse(profile).root}),/inside the drive/);
  fs.mkdirSync(custom.models,{recursive:true});const alias=path.join(profile,'model-alias');fs.symlinkSync(custom.models,alias,'junction');
  assert.throws(()=>validateStorage({...custom,cache:alias}),/separate/);
});
test('a verified candidate and model step use the chosen folders, including paths with spaces',async()=>{
  const {profile,config,custom,manager}=fixture();manager.setStorage(custom);
  const runtime=path.join(custom.runtimes,'prepared'),python=path.join(runtime,'python.exe');fs.mkdirSync(runtime);fs.writeFileSync(python,'synthetic Python');
  fs.writeFileSync(path.join(custom.runtimes,'candidate.json'),JSON.stringify({root:runtime,python,preset:'whisper-cpu',libraries:true,librariesKey:dependencyFingerprint(root,'whisper-cpu')}));
  const connected=[],calls=[];
  const restored=new LocalSetup({profile,speech:root,onReady:async(...args)=>connected.push(args)},{run:async(exe,args,input)=>{calls.push({exe,args,input});return 'ok';}});
  restored.start({action:'model',preset:'whisper-cpu',model:'tiny'});assert.equal((await finish(restored)).state,'ready');
  assert.equal(calls.length,1);assert.equal(calls[0].exe,python);assert.equal(calls[0].input.models,custom.models);
  assert.equal(connected[0][0].models,custom.models);assert.equal(connected[0][0].python,python);
  assert.equal(fs.readFileSync(path.join(profile,'speech-runtime.json'),'utf8'),config);
});
test('cache cleanup deletes only installer downloads, keeping installed runtimes, model weights and unknown files',async()=>{
  const {custom,manager,config,profile}=fixture();manager.setStorage(custom);
  const library=path.join(custom.runtimes,'installed.dll'),model=path.join(custom.models,'weights.bin'),unknown=path.join(custom.cache,'personal.txt');
  fs.writeFileSync(library,'installed');fs.writeFileSync(model,'model');fs.writeFileSync(unknown,'keep');
  fs.mkdirSync(path.join(custom.cache,'pip'));fs.writeFileSync(path.join(custom.cache,'pip','wheel'),'cached');fs.writeFileSync(path.join(custom.cache,'python-3.11.17.tar.gz'),'archive');
  assert.equal((await manager.clearCache()).state,'idle');assert.ok(!fs.existsSync(path.join(custom.cache,'pip')));
  for(const file of [library,model,unknown])assert.ok(fs.existsSync(file));assert.equal(fs.readFileSync(path.join(profile,'speech-runtime.json'),'utf8'),config);
});
test('cache cleanup refuses a foreign cache and never follows a junction into installed models',async()=>{
  const {profile,custom,manager}=fixture();fs.mkdirSync(custom.cache,{recursive:true});fs.writeFileSync(path.join(custom.cache,'python-3.11.17.tar.gz'),'foreign');
  await assert.rejects(clearDownloadCache(profile,custom),/not created/);manager.setStorage(storagePaths(path.join(profile,'owned')));
  const locations=manager.getStatus().storage;fs.writeFileSync(path.join(locations.models,'keep.bin'),'model');
  fs.symlinkSync(locations.models,path.join(locations.cache,'pip'),'junction');
  const result=await manager.clearCache();assert.equal(result.state,'failed');assert.ok(fs.existsSync(path.join(locations.models,'keep.bin')));
});
test('cache cleanup also protects a manually connected model folder inside the selected cache',async()=>{
  const {profile,custom,manager,python}=fixture();manager.setStorage(custom);
  const models=path.join(custom.cache,'pip');fs.mkdirSync(models);fs.writeFileSync(path.join(models,'model.bin'),'connected model');
  fs.writeFileSync(path.join(profile,'speech-runtime.json'),JSON.stringify({python,models}));
  const result=await manager.clearCache();assert.equal(result.state,'failed');assert.match(result.error,/connected environment or models/);
  assert.equal(fs.readFileSync(path.join(models,'model.bin'),'utf8'),'connected model');
});
test('model copies retain the source, can resume matching files, and refuse conflicting destination weights',async()=>{
  const {models,custom,manager,profile,config}=fixture();manager.setStorage(custom);
  manager.copyModels();assert.equal((await finish(manager)).state,'idle');assert.equal(fs.readFileSync(path.join(custom.models,'model.bin'),'utf8'),'synthetic model');
  assert.ok(fs.existsSync(path.join(models,'model.bin')));assert.equal(fs.readFileSync(path.join(profile,'speech-runtime.json'),'utf8'),config);
  manager.copyModels();assert.equal((await finish(manager)).state,'idle');
  fs.writeFileSync(path.join(custom.models,'model.bin'),'different model');manager.copyModels();assert.equal((await finish(manager)).state,'failed');
  assert.equal(fs.readFileSync(path.join(models,'model.bin'),'utf8'),'synthetic model');
});
test('an interrupted model copy removes its temporary file and leaves the source available for retry',async()=>{
  const {models,custom,manager}=fixture();manager.setStorage(custom);
  fs.writeFileSync(path.join(models,'large.bin'),Buffer.alloc(2*1024*1024,42));const controller=new AbortController();
  await assert.rejects(copyModelCache(models,custom.models,controller.signal,received=>{if(received>0)controller.abort();}));
  assert.ok(fs.existsSync(path.join(models,'large.bin')));assert.ok(!fs.existsSync(path.join(custom.models,'large.bin')));
  assert.ok(!fs.readdirSync(custom.models).some(name=>name.startsWith('.owlio-part-')));
  await copyModelCache(models,custom.models,new AbortController().signal,()=>{});assert.equal(fs.statSync(path.join(custom.models,'large.bin')).size,2*1024*1024);
});
test('storage selection, model copying and cleanup cannot overlap a running installation',async()=>{
  const {profile,custom,manager}=fixture();manager.setStorage(custom);let done;
  const runtime=path.join(custom.runtimes,'prepared'),python=path.join(runtime,'python.exe');fs.mkdirSync(runtime);fs.writeFileSync(python,'synthetic Python');
  fs.writeFileSync(path.join(custom.runtimes,'candidate.json'),JSON.stringify({root:runtime,python,preset:'whisper-cpu',libraries:true,librariesKey:dependencyFingerprint(root,'whisper-cpu')}));
  const busy=new LocalSetup({profile,speech:root,onReady:async()=>{}},{run:()=>new Promise(resolve=>{done=resolve;})});
  busy.start({action:'model',preset:'whisper-cpu',model:'tiny'});assert.throws(()=>busy.setStorage(custom),/current setup/);assert.throws(()=>busy.copyModels(),/current setup/);
  await assert.rejects(busy.clearCache(),/current setup/);busy.cancel();done('ok');assert.equal((await finish(busy)).state,'cancelled');
});
