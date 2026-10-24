const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {correctionCandidates,matchingPreferences,preferredVocabulary,adaptPunctuation}=require('../dist/main/writingMemory');
const context={processName:'notepad',windowTitle:'private',browserUrl:'',surroundingText:''};
const settings={contextAwarePunctuation:true,punctuationMode:'auto',writingStyle:'auto'};
function profile(){
  const directory=fs.mkdtempSync(path.join(__dirname,'.runtime/memory-store-'));
  const exports={};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/main/store.js'),'utf8'),{exports,require:name=>name==='electron'?{app:{getPath:()=>directory},safeStorage:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()}}:name.startsWith('.')?require(path.join(__dirname,'../dist/main',name)):require(name),structuredClone,Buffer});
  const store=new exports.Store(directory);
  store.addHistory({id:'dictation',timestamp:1,processName:'notepad',windowTitle:'test',rawText:'Please ask Jhon about Owlio',formattedText:'Please ask Jhon about Owlio.',durationMs:1000,deliveryStatus:'inserted'});
  return {store,reload:()=>new exports.Store(directory)};
}
function service(store,classify){
  const exports={};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/main/learningService.js'),'utf8'),{exports,require:name=>name==='./geminiFormatting'?{classifyVocabulary:classify}:require(path.join(__dirname,'../dist/main',name))});
  return new exports.LearningService(store);
}
test('edit extraction learns substitutions, rejects punctuation/facts/appending and bounds rewrites',()=>{
  assert.deepEqual(correctionCandidates('Please ask Jhon about Owlio.','Please ask John about Owlio.'),[{word:'John',observedSource:'Jhon'}]);
  assert.deepEqual(correctionCandidates('Please call Rhaul.','Please call Rahul.'),[{word:'Rahul',observedSource:'Rhaul'}]);
  for(const [before,after] of [['Hello world.','Hello, world!'],['Meeting Friday at ten.','Meeting Monday at eleven.'],['Please ask John.','Please ask John and Sarah.'],['Please send the report to the team tomorrow.','I disagree with everything you said.'],['Hello 123','Hello 456']])assert.deepEqual(correctionCandidates(before,after),[]);
});
test('writing preferences match exact app and language scopes; pending vocabulary never influences output',()=>{
  const rule=(id,app,language,enabled=true)=>({id,text:id,app,language,enabled});
  assert.deepEqual(matchingPreferences([rule('global','all','all'),rule('app','Notepad.exe','hinglish'),rule('wrong','slack','all'),rule('disabled','all','all',false),rule('hindi','all','hi')],context,'hinglish'),['global','app']);
  assert.deepEqual(preferredVocabulary([{word:'John',observedSource:'Jhon',status:'pending',count:1,lastUsed:1}]),[]);
});
test('punctuation adapts short chats and cursor continuations without changing questions, code or lists',()=>{
  assert.equal(adaptPunctuation('Hello.',{...context,processName:'slack'},settings),'Hello');
  assert.equal(adaptPunctuation('Hello.',{...context,processName:'outlook'},settings),'Hello.');
  assert.equal(adaptPunctuation('Coming?',{...context,processName:'slack'},settings),'Coming?');
  assert.equal(adaptPunctuation('Working.',{...context,beforeText:'I was',afterText:'today',selectedText:''},settings),' working ');
  assert.equal(adaptPunctuation('NASA.',{...context,beforeText:'Call ',afterText:'',selectedText:''},settings),'NASA.');
  assert.equal(adaptPunctuation('Rahul.',{...context,beforeText:'Call ',afterText:'',selectedText:''},settings,[{word:'Rahul'}]),'Rahul.');
  for(const value of ['One:\n• Task.','1. Task.\n2. Task.'])assert.equal(adaptPunctuation(value,{...context,processName:'slack'},settings),value);
  assert.equal(adaptPunctuation('Hello.',{...context,processName:'code'},settings),'Hello.');
  assert.equal(adaptPunctuation('Hello.',{...context,processName:'slack'},{...settings,contextAwarePunctuation:false}),'Hello.');
});
test('approved correction memory and scoped writing rules survive restart and can be forgotten',async()=>{
  const {store,reload}=profile();
  store.updateSettings({formattingProvider:'gemini',geminiApiKey:'synthetic',autoLearnCorrections:true});
  store.setWritingPreferences([{id:'rule',text:'Avoid em dashes',app:'all',language:'all',enabled:true}]);
  const learn=service(store,async pairs=>{assert.equal(pairs[0].observedSource,'Jhon');return ['John'];});
  assert.deepEqual({...await learn.correct('dictation','Please ask John about Owlio.')},{added:1,pending:0});
  const reopened=reload();
  assert.equal(reopened.getLearnedVocabulary()[0].status,'learned');
  assert.equal(reopened.getHistory()[0].editedText,'Please ask John about Owlio.');
  assert.equal(reopened.getHistory()[0].formattedText,'Please ask Jhon about Owlio.');
  assert.equal(reopened.getWritingPreferences()[0].text,'Avoid em dashes');
  reopened.reviewLearnedWord(reopened.getLearnedVocabulary()[0].id,'forget');
  assert.equal(reload().getLearnedVocabulary().length,0);
});
test('offline or unavailable classification keeps suggestions pending; disabled learning adds nothing',async()=>{
  for(const disabled of [false,true]){
    const {store}=profile();store.updateSettings({autoLearnCorrections:!disabled});
    const result=await service(store,()=>{throw Error('Should not call a classifier offline');}).correct('dictation','Please ask John about Owlio.');
    assert.equal(result.added,0);
    assert.equal(store.getLearnedVocabulary().length,disabled?0:1);
    if(!disabled){const word=store.getLearnedVocabulary()[0];assert.equal(word.status,'pending');store.reviewLearnedWord(word.id,'accept');assert.equal(store.getLearnedVocabulary()[0].status,'learned');}
  }
});
test('turning learning off during classification prevents saving vocabulary; failed deliveries cannot teach',async()=>{
  const {store}=profile();store.updateSettings({formattingProvider:'gemini',geminiApiKey:'synthetic',autoLearnCorrections:true});
  let complete;
  const learn=service(store,()=>new Promise(resolve=>{complete=resolve;}));
  const operation=learn.correct('dictation','Please ask John about Owlio.');
  store.updateSettings({autoLearnCorrections:false});complete(['John']);await operation;
  assert.equal(store.getLearnedVocabulary().length,0);
  store.addHistory({id:'failed',timestamp:1,processName:'notepad',windowTitle:'test',rawText:'Jhon',formattedText:'Jhon',durationMs:1000,deliveryStatus:'failed'});
  await assert.rejects(learn.correct('failed','John'),/inserted/);
});
test('Gemini gets relevant writing memory but never the surrounding field; classifier rejects unrequested words',async()=>{
  const source=fs.readFileSync(path.join(__dirname,'../dist/main/geminiFormatting.js'),'utf8');
  const exports={};let request;
  const requireFormatting = name => require(path.join(__dirname,'../dist/main',name));
  vm.runInNewContext(source,{exports,require:requireFormatting,AbortSignal,fetch:async(_url,options)=>{request=JSON.parse(options.body);return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'Hello, Rahul.'}]}}]});}});
  await exports.formatWithGemini('hello Rahul',{key:'synthetic',style:'auto',romanized:true,preferences:['Avoid em dashes'],vocabulary:[{word:'Rahul',observedSource:'Rhaul'}],category:'chat'});
  assert.match(request.systemInstruction.parts[0].text,/Avoid em dashes/);
  assert.match(request.systemInstruction.parts[0].text,/Rahul/);
  assert.equal(request.contents[0].parts[0].text,'hello Rahul');
  const other={};vm.runInNewContext(source,{exports:other,require:requireFormatting,AbortSignal,fetch:async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'{"accepted":["Unrequested"]}'}]}}]})});
  await assert.rejects(other.classifyVocabulary([{word:'John',observedSource:'Jhon'}],'synthetic'),/unsupported candidates/);
});
