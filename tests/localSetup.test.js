const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {LocalSetup,setupRequest,cleanSetupLog,isolatedPythonEnvironment,dependencyFingerprint}=require('../dist/main/localSetup');
const root=path.resolve(__dirname,'..');
function fixture(libraries=false,preset='whisper-cpu') {
  const profile=fs.mkdtempSync(path.join(__dirname,'.runtime/setup-unit-')),owned=path.join(profile,'local-speech');
  const candidateRoot=path.join(owned,'runtimes','candidate'),python=path.join(candidateRoot,'python.exe');
  fs.mkdirSync(candidateRoot,{recursive:true});fs.writeFileSync(python,'synthetic executable');
  fs.writeFileSync(path.join(owned,'candidate.json'),JSON.stringify({root:candidateRoot,python,preset,libraries,librariesKey:dependencyFingerprint(root,preset)}));
  const external=path.join(profile,'previous-python.exe'),models=path.join(profile,'previous-models');
  fs.writeFileSync(external,'previous');fs.mkdirSync(models);
  const previous=JSON.stringify({python:external,models});fs.writeFileSync(path.join(profile,'speech-runtime.json'),previous);
  return {profile,python,previous};
}
async function finish(manager) { const end=Date.now()+3000;while(manager.getStatus().state==='running'&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,5));return manager.getStatus(); }
test('setup validates fixed packages/actions/models and redacts tokens from output',()=>{
  for(const value of [{action:'shell',preset:'whisper-cpu',model:'tiny'},{action:'all',preset:'https://example.com',model:'tiny'},{action:'all',preset:'whisper-cpu',model:'bodhan-flex'},{action:'all',preset:'full-cpu',model:'tiny',token:'https://example.com'}])assert.throws(()=>setupRequest(value));
  assert.equal(setupRequest({action:'all',preset:'full-cpu',model:'bodhan-flex',token:'hf_syntheticreadtoken'}).token,'hf_syntheticreadtoken');
  assert.equal(cleanSetupLog('download hf_syntheticreadtoken','hf_syntheticreadtoken'),'download [redacted]');
});

test('setup carries an explicitly selected compatible language and rejects mismatches before downloading',async()=>{
  const {profile}=fixture(true,'full-cpu');const connected=[];
  const manager=new LocalSetup({profile,speech:root,currentLanguage:()=> 'fr',onReady:async(...args)=>connected.push(args)},{run:async()=> 'ok'});
  assert.throws(()=>manager.start({action:'model',preset:'full-cpu',model:'bodhan-flex'}),/another model/);
  assert.throws(()=>setupRequest({action:'model',preset:'whisper-cpu',model:'small',language:'bho'}),/supported by/);
  manager.start({action:'model',preset:'full-cpu',model:'bodhan-flex',language:'bho'});
  assert.equal((await finish(manager)).state,'ready');
  assert.equal(connected[0][1],'bodhan-flex');assert.equal(connected[0][2],'bho');
});
test('speech library installation is isolated, components can be installed separately, and only verified model completion connects a runtime',async()=>{
  const {profile,python,previous}=fixture();const calls=[],connected=[];
  const manager=new LocalSetup({profile,speech:root,onReady:async(...args)=>connected.push(args)}, {run:async(exe,args,input)=>{calls.push({exe,args,input});return '{"core":true}';}});
  manager.start({action:'libraries',preset:'whisper-cpu',model:'tiny'});
  assert.equal((await finish(manager)).state,'ready');assert.equal(connected.length,0);
  assert.equal(fs.readFileSync(path.join(profile,'speech-runtime.json'),'utf8'),previous);
  assert.equal(calls[0].exe,python);assert.ok(calls[0].args.includes('--isolated'));assert.ok(calls[0].args.includes('--only-binary=:all:'));
  assert.ok(calls[0].args.includes('https://pypi.org/simple'));assert.ok(calls[0].args.some(a=>a.endsWith('requirements-core.txt')));
  assert.ok(!calls.some(call=>call.args.some(arg=>/torch==/.test(arg))));
  manager.start({action:'model',preset:'whisper-cpu',model:'tiny'});assert.equal((await finish(manager)).state,'ready');
  assert.equal(connected.length,1);assert.equal(connected[0][0].python,python);assert.equal(connected[0][0].managed,true);assert.equal(connected[0][1],'tiny');
});
test('full CPU and CUDA packages use their official pinned PyTorch wheel indexes',async()=>{
  for(const preset of ['full-cpu','full-cuda']) {
    const {profile}=fixture(false,preset),calls=[];
    const manager=new LocalSetup({profile,speech:root,onReady:async()=>{}},{run:async(exe,args)=>{calls.push(args);return 'ok';}});
    manager.start({action:'libraries',preset,model:'tiny'});assert.equal((await finish(manager)).state,'ready');
    assert.ok(calls[0].includes('torch==2.8.0'));assert.ok(calls[0].includes('torchaudio==2.8.0'));
    assert.ok(calls[0].includes(`https://download.pytorch.org/whl/${preset==='full-cpu'?'cpu':'cu128'}`));
    assert.ok(calls[1].some(a=>a.endsWith('requirements-full.txt')));
  }
});
test('failed or cancelled model verification never changes the connected runtime; a retry succeeds',async()=>{
  const {profile,previous}=fixture(true),connected=[];let reject=true,resolve;
  const manager=new LocalSetup({profile,speech:root,onReady:async(...args)=>connected.push(args)},{run:async()=>{if(reject)throw Error('Download failed hf_syntheticreadtoken');return new Promise(done=>{resolve=done;});}});
  manager.start({action:'model',preset:'whisper-cpu',model:'tiny',token:'hf_syntheticreadtoken'});
  const failed=await finish(manager);assert.equal(failed.state,'failed');assert.ok(!JSON.stringify(failed).includes('hf_syntheticreadtoken'));
  reject=false;manager.start({action:'model',preset:'whisper-cpu',model:'tiny'});
  assert.throws(()=>manager.start({action:'all',preset:'whisper-cpu',model:'tiny'}),/current setup/);
  manager.cancel();resolve('ok');assert.equal((await finish(manager)).state,'cancelled');
  assert.equal(connected.length,0);assert.equal(fs.readFileSync(path.join(profile,'speech-runtime.json'),'utf8'),previous);
  manager.start({action:'model',preset:'whisper-cpu',model:'tiny'});resolve('ok');assert.equal((await finish(manager)).state,'ready');assert.equal(connected.length,1);
});
test('recheck uses the configured model and package rather than the UI download choice',async()=>{
  const {profile}=fixture(true);let input;
  const manager=new LocalSetup({profile,speech:root,currentModel:()=> 'turbo',onReady:async()=>{throw Error('Recheck must not reconnect');}},{run:async(_exe,_args,value)=>{input=value;return 'ok';}});
  manager.start({action:'check',preset:'whisper-cpu',model:'tiny'});assert.equal((await finish(manager)).state,'ready');assert.equal(input.model,'turbo');
});

test('connected setup reports its saved package and current model independently of installation choices',()=>{
  const {profile}=fixture(true,'whisper-cpu');
  const configPath=path.join(profile,'speech-runtime.json'),config=JSON.parse(fs.readFileSync(configPath,'utf8'));
  config.preset='full-cuda';config.managed=true;fs.writeFileSync(configPath,JSON.stringify(config));
  let selected='bodhan-flex';
  const manager=new LocalSetup({profile,speech:root,currentModel:()=>selected,onReady:async()=>{}});
  assert.equal(manager.getStatus().connectedPreset,'full-cuda');
  assert.equal(manager.getStatus().connectedModel,'bodhan-flex');
  selected='hf:Trelis/whisper-hinglish-preview';
  assert.equal(manager.getStatus().connectedModel,selected);
  delete config.preset;fs.writeFileSync(configPath,JSON.stringify(config));
  assert.equal(manager.getStatus().connectedPreset,undefined,'Do not infer the connected package from a candidate environment');
});
test('owned Python subprocesses do not inherit other apps Python paths or Hugging Face credentials',()=>{
  const prior=process.env.PYTHONPATH;process.env.PYTHONPATH='shared-app-library-path';
  try{const env=isolatedPythonEnvironment();assert.equal(env.PYTHONPATH,undefined);assert.equal(env.HF_TOKEN,undefined);assert.equal(env.PYTHONNOUSERSITE,'1');}finally{if(prior===undefined)delete process.env.PYTHONPATH;else process.env.PYTHONPATH=prior;}
});
test('a corrupt Python archive is rejected before extraction and keeps the prior runtime connected',async()=>{
  const {profile,previous}=fixture();let ran=false;
  const manager=new LocalSetup({profile,speech:root,onReady:async()=>{throw Error('Corrupt downloads cannot connect');}},
    {download:async target=>fs.writeFileSync(target,'corrupt download'),run:async()=>{ran=true;return 'ok';}});
  manager.start({action:'python',preset:'whisper-cpu',model:'tiny'});
  const result=await finish(manager);assert.equal(result.state,'failed');assert.match(result.error,/checksum/);assert.equal(ran,false);
  assert.equal(fs.readFileSync(path.join(profile,'speech-runtime.json'),'utf8'),previous);
});
