const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {EventEmitter} = require('node:events');
const runtime = path.join(__dirname, '.runtime/reliability');
fs.mkdirSync(runtime, {recursive:true});
const context = {processName:'notepad',windowTitle:'private title',browserUrl:'',surroundingText:'private paragraph'};
const settings = {provider:'local',writingProvider:'local',formattingProvider:'basic',romanizationProvider:'off',localSttModel:'base',localSttUrl:'http://localhost:8000/v1',localLlmUrl:'http://localhost:11434',localLlmModel:'test',dictationLanguage:'en',writingStyle:'auto',instructModeEnabled:false};
function load(file, mocks={}, extra={}) {
  const exports={};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/main',file),'utf8'),{
    exports,require:name=>mocks[name] || (name.startsWith('.')?require(path.join(__dirname,'../dist/main',name)):require(name)),
    __dirname:path.join(__dirname,'../dist/main'),process,console,Buffer,ArrayBuffer,Uint8Array,Blob,FormData,Response,AbortSignal,AbortController,URL,structuredClone,setTimeout,clearTimeout,...extra,
  });return exports;
}
function pipeline(patch={}, transcript='hello', dictionary=[], network=()=>{throw Error('No model call expected');}, snippets=[]) {
  const fetch=async(url,options)=>url.endsWith('/audio/transcriptions')?new Response(transcript):network(url,options);
  return load('aiService.js',{'./store':{store:{getSettings:()=>({...settings,...patch}),getDictionary:()=>dictionary,getSnippets:()=>snippets}},'./geminiFormatting':load('geminiFormatting.js',{}, {fetch})},{fetch});
}
function temporary() {return fs.mkdtempSync(path.join(runtime,'profile-'));}
function cleanup(directory) {
  const relative=path.relative(runtime,path.resolve(directory));
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  fs.rmSync(directory,{recursive:true,force:true});
}
function wav(seconds=60) {
  const buffer=Buffer.alloc(44+seconds*32000);
  buffer.write('RIFF');buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVE',8);buffer.write('fmt ',12);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(16000,24);buffer.writeUInt32LE(32000,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(buffer.length-44,40);
  return buffer;
}

test('basic and fallback formatting preserve technical commands and terminal casing',async()=>{
  for(const [patch,target] of [[{writingStyle:'code'},context],[{}, {...context,processName:'powershell'}],[{writingStyle:'code',formattingProvider:'auto'},context]]) {
    const result=await pipeline(patch,'npm install').processAudioDictation(wav(1),target);
    assert.equal(result.formattedText,'npm install');
  }
});

test('dictionary replacements support Hindi, punctuation-ending identifiers and literal dollar text',async()=>{
  const result=await pipeline({},'राम uses C++ and hello',[{from:'राम',to:'Shyam'},{from:'C++',to:'Rust'},{from:'hello',to:'$& user'}]).processAudioDictation(wav(1),context);
  assert.equal(result.formattedText,'Shyam uses Rust and $& user.');
  const inside=await pipeline({},'रामायण helloWorld',[{from:'राम',to:'Shyam'},{from:'hello',to:'changed'}]).processAudioDictation(wav(1),context);
  assert.equal(inside.formattedText,'रामायण helloWorld.');
});

test('spoken snippets expand before any cleanup and retain the replacement verbatim',async()=>{
  const result=await pipeline({formattingProvider:'gemini'},'Hello.',[],undefined,[{trigger:'hello',replacement:'lowerCase\n$literal'}]).processAudioDictation(wav(1),context);
  assert.equal(result.formattedText,'lowerCase\n$literal');
});

test('snippets tolerate speech fillers and commas, expand within sentences and prefer longest triggers',()=>{
  const {matchingSnippet}=load('aiService.js',{'./store':{store:{}}});
  const snippets=[{trigger:'my email',replacement:'me@example.com'},{trigger:'my email address',replacement:'address@example.com'},{trigger:';call',replacement:'$& literal'},{trigger:'my contact',replacement:'my email'}];
  assert.equal(matchingSnippet('um, MY EMAIL,',snippets),'me@example.com');
  assert.equal(matchingSnippet('send it to my email please',snippets),'send it to me@example.com please');
  assert.equal(matchingSnippet('my email address and my email',snippets),'address@example.com and me@example.com');
  assert.equal(matchingSnippet('insert ;call now',snippets),'insert $& literal now');
  assert.equal(matchingSnippet('send to my contact',snippets),'send to my email');
  for(const input of ['my emails','my emailAddress','notmy email','my email\u200dother'])assert.equal(matchingSnippet(input,snippets),undefined);
});

test('dictionary matches canonical accents and Indic joiners without replacing partial graphemes',()=>{
  const {applyDictionary}=load('aiService.js',{'./store':{store:{}}});
  assert.equal(applyDictionary('Cafe\u0301 and Café',[{from:'Café',to:'Coffee'}]),'Coffee and Coffee');
  for(const word of ['क्षेत्र','क्\u200dषेत्र','क्\u200cषेत्र'])assert.equal(applyDictionary(word,[{from:'क्षेत्र',to:'area'}]),'area');
  assert.equal(applyDictionary('क्\u200dषेत्र क्षेत्रीय',[{from:'क्',to:'bad'},{from:'क्षेत्र',to:'area'}]),'area क्षेत्रीय');
  assert.equal(applyDictionary('राम रामायण',[{from:'राम',to:'$&'}]),'$& रामायण');
});

test('Hindi and Hinglish edit commands require selection and preserve selection on model failure',async()=>{
  const {detectInstructIntent}=load('aiService.js',{'./store':{store:{}}});
  const commands=['isko short karo','Ease ko short karo.','Ees ko chhota kar do.','points me banao','pons men banaao.','spelling theek karo','isko rephrase kar do','इसको छोटा करो','इसको चोटा कर दू?','इसे पॉइंट्स में बना दो','स्पेलिंग ठीक करो'];
  for(const command of commands) {
    assert.equal(detectInstructIntent(command),true,command);
    const api=pipeline({instructModeEnabled:true},command,[],async()=>Response.json({response:'Edited source'}));
    const result=await api.processAudioDictation(wav(1),{...context,selectedText:'Original source'});
    assert.equal(result.isInstruct,true,command);assert.equal(result.formattedText,'Edited source');assert.equal(result.replaceText,'Original source');
    const ordinary=await pipeline({instructModeEnabled:true},command).processAudioDictation(wav(1),context);
    assert.equal(ordinary.isInstruct,false);
  }
  for(const ordinary of ['isko kal bhejna','ease ko kal bhejna','pons men lesion hai','karo','banao','rewriteable text','इसको कल भेजना','मेरे सिर में चोट है','इसको छोटा कर दूँ?'])assert.equal(detectInstructIntent(ordinary),false,ordinary);
  const failed=await pipeline({instructModeEnabled:true},'isko short karo').processAudioDictation(wav(1),{...context,selectedText:'Original source'});
  assert.equal(failed.skipInsertion,true);
});

test('Ollama never cleans short dictation and rewrite commentary cannot replace a selection',async()=>{
  const dictation=await pipeline({writingProvider:'local',formattingProvider:'ai'},'hello world').processAudioDictation(wav(1),context);
  assert.equal(dictation.formattedText,'Hello world.');
  const rewrite=await pipeline({writingProvider:'local',instructModeEnabled:true},'isko short karo',[],async()=>Response.json({response:'Here is the corrected text:\nHello.'})).processAudioDictation(wav(1),{...context,selectedText:'Original source'});
  assert.equal(rewrite.skipInsertion,true);
});

test('cloud network, HTTP and JSON errors preserve transcription, warn and have bounded signals',async()=>{
  for(const provider of ['local','groq']) for(const failure of ['network','http','json']) {
    let recognized;
    const api=pipeline({provider,groqApiKey:'synthetic',geminiApiKey:'synthetic',writingProvider:'gemini',formattingProvider:'ai'},'keep these words',[],async(_url,options)=>{
      assert.ok(options.signal instanceof AbortSignal);
      if(failure==='network')throw Error('offline');
      return failure==='http'?new Response('no',{status:503}):new Response('invalid json');
    });
    const result=await api.processAudioDictation(wav(1),context,{onTranscribed:text=>{recognized=text;}});
    assert.equal(recognized,'keep these words');assert.equal(result.formattedText,'Keep these words.');assert.match(result.warning,/preserved/);
  }
});

test('caller cancellation aborts cloud cleanup instead of producing an insertion fallback',async()=>{
  const controller=new AbortController();let reached;
  const waiting=new Promise(resolve=>{reached=resolve;});
  const api=pipeline({provider:'groq',groqApiKey:'synthetic',geminiApiKey:'synthetic',writingProvider:'gemini',formattingProvider:'ai'},'hello',[],(_url,options)=>new Promise((resolve,reject)=>{
    options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});reached();
  }));
  const work=api.processAudioDictation(wav(1),context,{signal:controller.signal});
  await waiting;controller.abort();await assert.rejects(work,{name:'AbortError'});
});

test('rewrite uses only the explicit selection and carries its replacement precondition',async()=>{
  let prompt;
  const api=pipeline({instructModeEnabled:true},'make it formal',[],async(_url,options)=>{prompt=JSON.parse(options.body).prompt;return Response.json({response:'Dear team'});});
  const result=await api.processAudioDictation(wav(1),{...context,selectedText:'hey team'});
  assert.equal(result.replaceText,'hey team');assert.equal(result.isInstruct,true);
  assert.ok(prompt.includes('hey team'));assert.ok(!prompt.includes('private paragraph'));
  const ordinary=await pipeline({instructModeEnabled:true},'make this cake tomorrow').processAudioDictation(wav(1),context);
  assert.equal(ordinary.isInstruct,false);assert.equal(ordinary.formattedText,'Make this cake tomorrow.');
});

test('meeting transcription bypasses dictation cleanup, dictionary and rewrite detection',async()=>{
  let calls=0;
  const api=pipeline({instructModeEnabled:true,formattingProvider:'auto'},'make it formal',[],async(_url,options)=>{
    calls++;assert.ok(options.signal);assert.match(JSON.parse(options.body).prompt,/meeting-notes assistant/);
    return Response.json({response:'{"summary":"Meeting summary","actions":[]}'});
  });
  const result=await api.processMeetingAudio(wav(1),context);
  assert.equal(calls,1);assert.equal(result.transcript,'make it formal');
});

test('long meetings use bounded uploads and resume completed segments after failure/restart',async()=>{
  const directory=temporary();
  try {
    const {MeetingCaptureStore}=require('../dist/main/meetingCapture');
    const store=new MeetingCaptureStore(directory),id=await store.create(true),chunk=wav();
    for(let index=0;index<14;index++)await store.append(id,index,chunk);
    let calls=0;
    await assert.rejects(store.transcript(id,async buffer=>{assert.ok(buffer.length<25*1024**2);calls++;if(calls===3)throw Error('offline');return 'part '+calls;}),/offline/);
    const restarted=new MeetingCaptureStore(directory);
    assert.equal((await restarted.list())[0].seconds,840);
    let resumed=0;const result=await restarted.transcript(id,async()=>{resumed++;return 'continued';});
    assert.equal(resumed,12);assert.equal(result.seconds,840);assert.match(result.text,/part 1\npart 2\ncontinued/);
    await restarted.remove(id);assert.deepEqual(await restarted.list(),[]);
  }finally{cleanup(directory);}
});

test('meeting chunks reject reordering and non-retained failed audio is removed',async()=>{
  const directory=temporary();
  try{
    const {MeetingCaptureStore}=require('../dist/main/meetingCapture');const store=new MeetingCaptureStore(directory),id=await store.create(false);
    await assert.rejects(store.append(id,1,wav(1)),/order/);await store.append(id,0,wav(1));
    await store.failed(id);assert.deepEqual(await store.list(),[]);assert.equal(fs.existsSync(path.join(directory,id)),false);
  }finally{cleanup(directory);}
});

test('history checkpoints update one entry and preserve retained audio for retry',()=>{
  const directory=temporary();
  try{
    const {Store}=load('store.js',{electron:{app:{getPath:()=>directory},safeStorage:{}}});const store=new Store(directory);
    const item={id:'job',timestamp:Date.now(),processName:'notepad',windowTitle:'',rawText:'',formattedText:'',durationMs:1000,deliveryStatus:'failed'};
    store.addHistory(item,wav(1));const original=store.getHistory()[0].audioFile;
    store.addHistory({...item,rawText:'recovered',formattedText:'Recovered.'});
    assert.equal(store.getHistory().length,1);assert.equal(store.getHistory()[0].audioFile,original);assert.equal(store.getHistoryAudio('job').length,wav(1).length);
    store.addHistory({...item,rawText:'checkpoint',formattedText:'checkpoint',deliveryStatus:'processing'});
    assert.equal(store.getHistory()[0].deliveryStatus,'processing');
    const restarted=new Store(directory);
    assert.equal(restarted.getHistory()[0].deliveryStatus,'failed');assert.match(restarted.getHistory()[0].errorMessage,/interrupted/);
  }finally{cleanup(directory);}
});

test('helper watchdog replaces a stalled process and ignores its stale close event',async()=>{
  const children=[],timers=new Map();let next=0;
  const spawn=()=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stdout.setEncoding=()=>{};child.stderr=new EventEmitter();child.stdin=new EventEmitter();child.stdin.writable=true;child.commands=[];child.stdin.write=line=>child.commands.push(JSON.parse(line));child.kill=()=>{child.killed=true;};children.push(child);return child;};
  const {HelperBridge}=load('helperBridge.js',{child_process:{spawn},fs:{existsSync:()=>true}},{setTimeout:callback=>{timers.set(++next,callback);return next;},clearTimeout:id=>timers.delete(id)});
  const bridge=new HelperBridge();bridge.on('helper-error',()=>{});bridge.start();
  const work=bridge.getContext();timers.get(1)();await assert.rejects(work,/restarted/);assert.equal(children[0].killed,true);
  [...timers.values()][0]();assert.equal(children.length,2);
  const current=bridge.getContext();children[0].emit('close',1);
  const request=children[1].commands.at(-1);children[1].stdout.emit('data',JSON.stringify({type:'context_result',requestId:request.requestId,processName:'recovered'})+'\n');
  assert.equal((await current).processName,'recovered');bridge.stop();
});
