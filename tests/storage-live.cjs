// Real migration to three custom folders. Synthetic audio and isolated test profiles only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {LocalSetup}=require('../dist/main/localSetup'),{storagePaths}=require('../dist/main/localStorage'),{SpeechServer}=require('../dist/main/speechServer');
const root=path.resolve(__dirname,'..'),output=path.join(__dirname,'.runtime/custom-storage'),profile=path.join(output,'profile');
fs.mkdirSync(profile,{recursive:true});
const earlier=path.join(__dirname,'.runtime/fresh-local-setup/profile');
const original=JSON.parse(fs.readFileSync(path.join(earlier,'speech-runtime.json'),'utf8'));
const configPath=path.join(profile,'speech-runtime.json');fs.writeFileSync(configPath,JSON.stringify(original));
const server=new SpeechServer({packaged:true,profile,resources:root,speechDirectory:root});
let configured;
const manager=new LocalSetup({profile,speech:root,currentModel:()=> 'tiny',onReady:async(config,model)=>{
  configured=config;fs.writeFileSync(configPath,JSON.stringify(config));
  await server.ensure({provider:'local',localSttUrl:'http://127.0.0.1:17863/v1',localSttModel:model});
}});
const wait=async()=>{const end=Date.now()+30*60*1000;while(manager.getStatus().state==='running'&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,200));
  const result=manager.getStatus();assert.ok(['ready','idle'].includes(result.state),result.error);return result;};
let stage='';manager.on('status',status=>{if(status.stage!==stage){stage=status.stage;console.log(stage+': '+status.message);}if(status.state==='failed')console.error(status.error);});
(async()=>{
  const locations=storagePaths(path.join(output,'chosen drive','OwlioData'));
  locations.runtimes=path.join(output,'environment disk','Owlio-environments');locations.models=path.join(output,'model disk','Owlio-models');locations.cache=path.join(output,'cache disk','Owlio-downloads');
  manager.setStorage(locations);assert.deepEqual(JSON.parse(fs.readFileSync(configPath)),original);
  manager.copyModels();await wait();assert.deepEqual(JSON.parse(fs.readFileSync(configPath)),original);
  // Reuse only the verified Python archive; libraries are installed into a new independent runtime.
  fs.copyFileSync(path.join(earlier,'local-speech/downloads/python-3.11.17.tar.gz'),path.join(locations.cache,'python-3.11.17.tar.gz'));
  manager.start({action:'all',preset:'whisper-cpu',model:'tiny'});await wait();assert.ok(configured.python.startsWith(locations.runtimes+path.sep));assert.equal(configured.models,locations.models);
  const restored=new LocalSetup({profile,speech:root,onReady:async()=>{}});assert.deepEqual(restored.getStatus().storage,locations);assert.equal(restored.getStatus().librariesInstalled,true);
  const transcript=async()=>{const wav=fs.readFileSync(path.join(__dirname,'.runtime/fresh-local-setup/phrase.wav'));const data=new FormData();data.append('file',new Blob([wav],{type:'audio/wav'}),'test.wav');data.append('model','tiny');data.append('language','en');
    const response=await fetch('http://127.0.0.1:17863/v1/audio/transcriptions',{method:'POST',body:data,signal:AbortSignal.timeout(120000)});assert.equal(response.ok,true);const text=(await response.json()).text;assert.match(text,/hello|setup|test/i);return text;};
  const text=await transcript();assert.equal((await manager.clearCache()).state,'ready');assert.ok(fs.existsSync(configured.python));assert.ok(fs.existsSync(original.python));assert.ok(fs.existsSync(original.models));
  assert.ok(!fs.existsSync(path.join(locations.cache,'pip')));assert.ok(!fs.existsSync(path.join(locations.cache,'python-3.11.17.tar.gz')));
  await server.reload();await server.ensure({provider:'local',localSttUrl:'http://127.0.0.1:17863/v1',localSttModel:'tiny'});await transcript();
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({success:true,customPython:configured.python,customModels:locations.models,separateCache:locations.cache,modelCopy:true,sourcePreserved:true,cacheCleanup:true,serverRestart:true,transcript:text},null,2));
  console.log('PASS: model copy, independent Python/libraries in custom folders, persistent locations, transcription, cache cleanup and server restart.');
})().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(()=>{manager.cancel(true);server.stop();});
