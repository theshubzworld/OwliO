// Real fresh-runtime install. No installed profile, shared packages, personal audio or API keys.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {LocalSetup}=require('../dist/main/localSetup');
const {SpeechServer}=require('../dist/main/speechServer');
const root=path.resolve(__dirname,'..'),profile=path.join(__dirname,'.runtime/fresh-local-setup/profile');
fs.mkdirSync(profile,{recursive:true});
const phrase=path.join(__dirname,'.runtime/fresh-local-setup/phrase.wav');
execFileSync('powershell.exe',['-NoProfile','-Command','Add-Type -AssemblyName System.Speech; $setupVoice=New-Object System.Speech.Synthesis.SpeechSynthesizer; try { $setupVoice.SetOutputToWaveFile($env:OWLIO_SETUP_TEST_WAV); $setupVoice.Speak("Hello, this is an Owlio setup test.") } finally { $setupVoice.Dispose() }'],
  {windowsHide:true,timeout:30000,env:{...process.env,OWLIO_SETUP_TEST_WAV:phrase}});
const server=new SpeechServer({packaged:true,profile,resources:root,speechDirectory:root});
let connected;
const manager=new LocalSetup({profile,speech:root,onReady:async(config,model)=>{
  fs.writeFileSync(path.join(profile,'speech-runtime.json'),JSON.stringify(config));
  connected=config;
  await server.ensure({provider:'local',localSttUrl:'http://127.0.0.1:17862/v1',localSttModel:model});
}});
let previous='';
manager.on('status',status=>{if(status.stage!==previous){previous=status.stage;console.log(status.stage+': '+status.message);}if(status.state==='failed')console.error(status.error);});
(async()=>{
  manager.start({action:'all',preset:'whisper-cpu',model:'tiny'});
  const end=Date.now()+30*60*1000;
  while(manager.getStatus().state==='running'&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,250));
  const status=manager.getStatus();assert.equal(status.state,'ready',status.error);
  assert.ok(connected.managed);assert.ok(connected.python.startsWith(profile));
  const catalogue=await(await fetch('http://127.0.0.1:17862/v1/models')).json();
  assert.ok(catalogue.models.find(model=>model.id==='tiny').downloaded);
  // Generated test phrase, never microphone or user recordings.
  const wav=fs.readFileSync(phrase);
  const body=new FormData();body.append('file',new Blob([wav],{type:'audio/wav'}),'setup-test.wav');body.append('model','tiny');body.append('language','en');
  const response=await fetch('http://127.0.0.1:17862/v1/audio/transcriptions',{method:'POST',body,signal:AbortSignal.timeout(120000)});
  assert.equal(response.ok,true);const transcript=(await response.json()).text;assert.match(transcript,/hello|owl|setup|test/i);
  fs.writeFileSync(path.join(__dirname,'.runtime/fresh-local-setup/result.json'),JSON.stringify({success:true,python:connected.python,independentRuntime:true,model:'tiny',transcript,serverOnline:true,torchNotRequired:true},null,2));
  console.log('PASS: fresh portable Python, independent speech libraries, model download, server startup and generated-speech recognition.');
})().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(()=>{manager.cancel();server.stop();});
