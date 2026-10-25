const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {LocalSetup,setupRequest,cleanSetupLog,isolatedPythonEnvironment,dependencyFingerprint}=require('../dist/main/localSetup');
const root=path.resolve(__dirname,'..');
test('installer transfer counters are per file, bounded, and never invent progress',()=>{
  const {setupTransfer}=require('../dist/main/localSetup');
  assert.deepEqual(setupTransfer(' ━━━ 6.2/12.4 MB 1.5 MB/s eta 0:00:04'),{received:6200000,total:12400000,progress:.5});
  assert.equal(setupTransfer('Installing collected packages: torch, transformers'),undefined);
  assert.equal(setupTransfer('1/0 MB'),undefined);assert.equal(setupTransfer('5/4 MB'),undefined);
});
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

test('setup records start, step and completion times and resets telemetry for the next run',async()=>{
  const {profile}=fixture(true);let release;
  const manager=new LocalSetup({profile,speech:root,onReady:async()=>{}},{run:async()=>new Promise(resolve=>{release=resolve;})});
  const start=manager.start({action:'model',preset:'whisper-cpu',model:'tiny'});
  assert.ok(start.startedAt);assert.ok(start.stageStartedAt>=start.startedAt);assert.equal(start.finishedAt,undefined);
  release('ok');const done=await finish(manager);assert.equal(done.state,'ready');assert.ok(done.finishedAt>=done.startedAt);
  manager.start({action:'model',preset:'whisper-cpu',model:'tiny'});
  assert.equal(manager.getStatus().finishedAt,undefined);assert.equal(manager.getStatus().activity,undefined);
  release('ok');await finish(manager);
});

test('installer output keeps rapid lines and redacts a secret split across stream chunks',async()=>{
  const {profile}=fixture();
  const manager=new LocalSetup({profile,speech:root,onReady:async()=>{}});
  manager.token='hf_syntheticreadtoken';
  await manager.run(process.execPath,['-e',"process.stdout.write('Collecting package\\nhf_synthetic'); setTimeout(()=>{process.stdout.write('readtoken\\nInstalling collected packages: package\\nDone');},30)"]);
  const status=manager.getStatus();assert.ok(status.lastActivityAt);assert.equal(status.activity,'Done');
  assert.ok(status.log.includes('Collecting package'));assert.ok(status.log.includes('[redacted]'));
  assert.ok(status.log.includes('Installing collected packages: package'));
  assert.ok(!JSON.stringify(status).includes('syntheticreadtoken'));
});

test('Bark and registered custom models require full packages and validate their languages',()=>{
  assert.throws(()=>setupRequest({action:'model',preset:'whisper-cpu',model:'bark-pro'}),/Full speech/);
  assert.throws(()=>setupRequest({action:'model',preset:'full-cuda',model:'bark-pro',language:'hinglish'}),/supported by/);
  assert.equal(setupRequest({action:'model',preset:'full-cuda',model:'bark-pro',language:'en'}).model,'bark-pro');
  assert.equal(setupRequest({action:'model',preset:'full-cpu',model:'hf:owner/parakeet'}).model,'hf:owner/parakeet');
  assert.throws(()=>setupRequest({action:'model',preset:'full-cpu',model:'hf:../../model'}));
  const {recommendedPreset}=require('../dist/shared/localSetup');
  assert.equal(recommendedPreset('bark-pro','whisper-cpu'),'full-cpu');
  assert.equal(recommendedPreset('bark-pro','full-cuda'),'full-cuda');
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

test('outdated libraries on the connected runtime are upgraded in a fresh candidate even for model-only setup',async()=>{
  const {profile,python}=fixture(false,'full-cpu');
  const configPath=path.join(profile,'speech-runtime.json');
  const config=JSON.parse(fs.readFileSync(configPath,'utf8'));config.python=python;config.preset='full-cpu';
  fs.writeFileSync(configPath,JSON.stringify(config));
  const {PYTHON_RELEASE}=require('../dist/main/localSetup');
  const previousHash=PYTHON_RELEASE.sha256;
  const payload=Buffer.from('synthetic archive for isolated setup');
  PYTHON_RELEASE.sha256=require('node:crypto').createHash('sha256').update(payload).digest('hex');
  const pipExecutables=[];let verified;
  try {
    const manager=new LocalSetup({profile,speech:root,onReady:async value=>{verified=value;}},{
      download:async target=>fs.writeFileSync(target,payload),
      run:async(exe,args)=>{
        if(exe==='tar.exe'){const target=path.join(args.at(-1),'python');fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,'python.exe'),'new synthetic runtime');}
        if(args.includes('pip'))pipExecutables.push(exe);
        return 'ok';
      },
    });
    manager.start({action:'model',preset:'full-cpu',model:'bark-pro',language:'en'});
    assert.equal((await finish(manager)).state,'ready');
    assert.ok(pipExecutables.length>0);assert.ok(pipExecutables.every(exe=>exe!==python));
    assert.notEqual(verified.python,python);
    assert.equal(JSON.parse(fs.readFileSync(configPath,'utf8')).python,python,'Only onReady may commit the new configuration');
  } finally {PYTHON_RELEASE.sha256=previousHash;}
});
