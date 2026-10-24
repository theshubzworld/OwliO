// Opt-in live test driver: real app, installed weights, real Gemini, native paste.
// Uses declared test WAVs in the real AudioRecorder via a Web Audio media stream.
// Drive prepare/record/romanize/finish through .runtime/pipeline-live/command.json.
const {app,BrowserWindow,clipboard,ClipboardItem}=require('electron');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),output=path.join(__dirname,'.runtime/pipeline-live');
const source=path.join(__dirname,'.runtime/gemini-integration/profile');
const installed=path.join(app.getPath('appData'),'Owlio','owlio_config.json');
fs.mkdirSync(output,{recursive:true});
const profile=fs.mkdtempSync(path.join(output,'profile-'));
const hash=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const protectedFiles=[path.join(source,'owlio_config.json'),installed].filter(file=>fs.existsSync(file));
const hashes=new Map(protectedFiles.map(file=>[file,hash(file)]));
const credentials=JSON.parse(fs.readFileSync(path.join(source,'owlio_config.json'),'utf8')).settings;
if(!credentials.geminiApiKey)throw Error('Saved test-profile Gemini key is required.');
const localState=JSON.parse(fs.readFileSync(path.join(source,'Local State'),'utf8'));
fs.writeFileSync(path.join(profile,'Local State'),JSON.stringify({os_crypt:localState.os_crypt}),{mode:0o600});
const model='hf:mayank-dubey-ai/whisper-large-v3-turbo-hinglish';
const device=process.env.OWLIO_TEST_DEVICE==='cuda'?'cuda':'cpu';
fs.writeFileSync(path.join(profile,'owlio_config.json'),JSON.stringify({settings:{provider:'local',localSttUrl:'http://127.0.0.1:17863/v1',localSttModel:model,dictationLanguage:'hinglish',writingProvider:'gemini',geminiApiKey:credentials.geminiApiKey,romanizationProvider:'gemini',formattingProvider:'ai',instructModeEnabled:true,autoLearnCorrections:false,setupCompleted:true,retainAudio:true,hotkey:'F24'},dictionary:[],snippets:[],history:[]}));
const runtimeBase=path.resolve(root,'../OwlioData');
const runtime=fs.readdirSync(path.join(runtimeBase,'runtimes')).map(name=>path.join(runtimeBase,'runtimes',name,'python/python.exe')).find(file=>fs.existsSync(file));
if(!runtime)throw Error('Installed speech runtime was not found.');
fs.writeFileSync(path.join(profile,'speech-runtime.json'),JSON.stringify({python:runtime,models:path.join(runtimeBase,'models'),managed:true,device}));
app.setPath('userData',profile);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
const report={started:new Date().toISOString(),model,device,audioSource:'Per-case test fixture',keyboardHookBypassed:true,realRecorder:true,realNativeHelper:true,realGemini:true,profile,cases:[],supplemental:[]};
let state={phase:'booting'},dashboard,pill,editor,activeCase,requests=[],capturedContext,pasteResult;
const save=()=>{fs.writeFileSync(path.join(output,'state.json'),JSON.stringify(state,null,2));fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(report,null,2));};
save();
const nativeFetch=global.fetch;
global.fetch=async(url,options)=>{
  const address=String(url);
  const item={kind:address.includes('/audio/transcriptions')?'speech':address.includes('generateContent')?(JSON.parse(options.body).systemInstruction.parts[0].text.startsWith('Convert')?'romanization':JSON.parse(options.body).systemInstruction.parts[0].text.includes('In-Editor')?'rewrite':'cleanup'):'other',started:Date.now()};
  if(item.kind!=='other')requests.push(item);
  try {const response=await nativeFetch(url,options);item.ms=Date.now()-item.started;item.status=response.status;return response;}
  catch(error){item.ms=Date.now()-item.started;item.failed=true;throw error;}
};
const {helperBridge}=require('../dist/main/helperBridge');
const originalContext=helperBridge.getContext.bind(helperBridge),originalPaste=helperBridge.paste.bind(helperBridge);
helperBridge.getContext=async(...args)=>{const context=await originalContext(...args);capturedContext={processName:context.processName,selectedText:context.selectedText,targetId:context.targetId};return context;};
helperBridge.paste=async(...args)=>{const success=await originalPaste(...args);pasteResult={success,replaceText:args[3]};return success;};
require('../dist/main/main');
const {store}=require('../dist/main/store');
const wait=async(check,timeout=150000)=>{const end=Date.now()+timeout;while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,150));}throw Error('Live test stage timed out.');};
const currentState=()=>pill.webContents.executeJavaScript('window.api.getPillState()');
const editorText=()=>editor.webContents.executeJavaScript('document.querySelector("textarea").value');
const file=path.join(output,'command.json');
let busy=false,lastId='';
let originalClipboard=[];
async function command(c){
  state={phase:c.action,id:c.id};save();
  if(c.action==='prepare'){
    for(const pattern of c.outputPatterns||[])new RegExp(pattern,'iu');
    await dashboard.webContents.executeJavaScript(`window.api.updateSettings(${JSON.stringify({localSttModel:c.model||model,dictationLanguage:c.language||'hinglish',formattingProvider:c.cleanup===false?'basic':'ai'})})`);
    activeCase=c;requests=[];capturedContext=undefined;pasteResult=undefined;
    const audio=fs.readFileSync(path.join(output,'audio',c.audio+'.wav'));
    await pill.webContents.executeJavaScript(`window.fixtureAudio=${JSON.stringify(audio.toString('base64'))};navigator.mediaDevices.getUserMedia=async()=>{const context=new AudioContext({sampleRate:16000});const buffer=await context.decodeAudioData(Uint8Array.from(atob(window.fixtureAudio),char=>char.charCodeAt(0)).buffer);const destination=context.createMediaStreamDestination();const source=context.createBufferSource();source.buffer=buffer;source.connect(destination);await context.resume();source.start(context.currentTime+.3);window.fixtureCapture={context,source,stream:destination.stream,duration:buffer.duration};return destination.stream;};void 0;`);
    const html='<!doctype html><html><meta charset="utf-8"><title>Owlio Pipeline Test Editor</title><style>body{font:18px Segoe UI;margin:35px;background:#fff8ef}textarea{font:20px Segoe UI;width:90%;height:230px;padding:15px}p{color:#665}</style><h1>Owlio pipeline test</h1><p id="case"></p><label for="target">Disposable text field</label><br><textarea id="target" aria-label="Disposable pipeline test field"></textarea><script>document.querySelector("textarea").value='+JSON.stringify(c.source||'')+';document.querySelector("#case").textContent='+JSON.stringify(c.id+' — '+c.audio)+';</script></html>';
    fs.writeFileSync(path.join(output,'editor.html'),html);await editor.loadFile(path.join(output,'editor.html'));
    state={phase:'prepared',id:c.id,source:c.source||'',audio:c.audio,language:c.language||'hinglish'};save();
  } else if(c.action==='record'){
    if(!activeCase)throw Error('Prepare an audio case first.');
    requests=[];
    const historyBefore=store.getHistory()[0]?.id,started=Date.now();
    const hwnd=editor.getNativeWindowHandle().readBigUInt64LE(0).toString();
    if(activeCase.expectRewrite){
      const context=await originalContext(hwnd);
      if(context.selectedText!==activeCase.source)throw Error('Select the exact fixture text before starting this rewrite test.');
    }
    helperBridge.emit('hotkey_down',{targetHwnd:hwnd});
    await wait(()=>pill.webContents.executeJavaScript('!!window.fixtureCapture'),12000);
    const duration=await pill.webContents.executeJavaScript('window.fixtureCapture.duration');
    await new Promise(resolve=>setTimeout(resolve,duration*1000+850));
    helperBridge.emit('hotkey_up');
    await wait(async()=>{const value=await currentState();return ['pasted','error'].includes(value.state);});
    const value=await currentState();
    const history=store.getHistory().find(item=>item.id!==historyBefore);
    const row={id:activeCase.id,audio:activeCase.audio,audioSource:activeCase.audio==='public-hinglish'?'Existing public CoSHE-500 clip':'Microsoft Ravi synthetic speech',language:activeCase.language||'hinglish',model:activeCase.model||model,totalMs:Date.now()-started,source:activeCase.source||'',context:capturedContext,paste:pasteResult,rawText:history?.rawText,formattedText:history?.formattedText,isInstruct:history?.isInstruct,warning:history?.warning,deliveryStatus:history?.deliveryStatus,error:history?.errorMessage||value.errorMessage,fieldText:await editorText(),requests:requests.filter(item=>item.kind!=='other')};
    row.checks={inserted:row.deliveryStatus==='inserted',noWarning:!row.warning,fieldMatchesResult:row.fieldText===row.formattedText,intent:activeCase.expectRewrite===undefined||row.isInstruct===activeCase.expectRewrite,requiredCalls:(activeCase.requiredCalls||[]).every(kind=>row.requests.some(request=>request.kind===kind)),forbiddenCalls:!(activeCase.forbiddenCalls||[]).some(kind=>row.requests.some(request=>request.kind===kind)),expectedOutput:(activeCase.outputPatterns||[]).every(pattern=>new RegExp(pattern,'iu').test(row.formattedText)),romanOutput:!activeCase.expectRoman||!/[\u0900-\u0963\u0971-\u097f]/.test(row.formattedText)};
    row.passed=Object.values(row.checks).every(Boolean);
    report.cases.push(row);
    fs.writeFileSync(path.join(output,row.id.replace(/[^a-zA-Z0-9_-]/g,'_')+'.png'),(await editor.webContents.capturePage()).toPNG());
    await pill.webContents.executeJavaScript('window.fixtureCapture?.stream.getTracks().forEach(track=>track.stop());window.fixtureCapture?.context.close();delete window.fixtureCapture;void 0;');
    state={phase:'completed',id:row.id,result:row};save();console.log(JSON.stringify(row));
  } else if(c.action==='romanize'){
    const {romanizeWithGemini}=require('../dist/main/geminiRomanization');
    const tick=Date.now();
    try {const text=await romanizeWithGemini(c.text,store.getSettings().geminiApiKey);report.supplemental.push({id:c.id,input:c.text,output:text,ms:Date.now()-tick,passed:true});}
    catch(error){report.supplemental.push({id:c.id,input:c.text,error:error.message,ms:Date.now()-tick,passed:false});}
    state={phase:'supplemental-completed',id:c.id,result:report.supplemental.at(-1)};save();
  } else if(c.action==='finish'){
    report.profileFilesUnchanged=protectedFiles.every(file=>hash(file)===hashes.get(file));
    report.finished=new Date().toISOString();report.passed=report.cases.every(row=>row.passed)&&report.supplemental.every(row=>row.passed)&&report.profileFilesUnchanged;
    fs.writeFileSync(path.join(output,'editor-final.png'),(await editor.webContents.capturePage()).toPNG());
    if(originalClipboard.length)await clipboard.write(originalClipboard);else clipboard.clear();
    state={phase:'finished',passed:report.passed};save();app.quit();
  } else throw Error('Unsupported test action.');
}
app.whenReady().then(async()=>{
  originalClipboard=await Promise.all((await clipboard.read()).map(async item=>new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type=>[type,await item.getType(type)]))))));
  await wait(()=>BrowserWindow.getAllWindows().some(window=>window.getBounds().width>600));
  dashboard=BrowserWindow.getAllWindows().find(window=>window.getBounds().width>600);pill=BrowserWindow.getAllWindows().find(window=>window!==dashboard);
  await wait(()=>dashboard.webContents.executeJavaScript('!!window.api?.getSettings && !!document.querySelector(".nav-item")'));
  await wait(async()=>{try{const data=await (await nativeFetch('http://127.0.0.1:17863/v1/models')).json();return data.service==='Owlio';}catch{return false;}});
  dashboard.setTitle('Owlio Pipeline Test — Settings');
  dashboard.webContents.on('page-title-updated',event=>event.preventDefault());
  editor=new BrowserWindow({width:860,height:520,title:'Owlio Pipeline Test Editor',webPreferences:{backgroundThrottling:false}});
  editor.webContents.on('page-title-updated',event=>event.preventDefault());
  state={phase:'ready',model,profile};save();console.log('READY: real app and isolated speech server.');
  setInterval(async()=>{if(busy||!fs.existsSync(file))return;let next;try{next=JSON.parse(fs.readFileSync(file,'utf8'));}catch{return;}if(next.id===lastId)return;lastId=next.id;busy=true;try{await command(next);}catch(error){state={phase:'error',id:next.id,error:error.message};save();console.error(error.message);}finally{busy=false;}},200);
}).catch(error=>{state={phase:'fatal',error:error.message};save();app.exit(1);});
