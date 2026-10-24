const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {recommendedPreset}=require('../dist/shared/localSetup');
const root=path.resolve(__dirname,'..');
function load(name,replacements={},extra={}) {
  const exports={};
  vm.runInNewContext(fs.readFileSync(path.join(root,'dist/main',name),'utf8'),{exports,require:name=>replacements[name]||(name.startsWith('.')?require(path.join(root,'dist/main',name)):require(name)),structuredClone,Buffer,Blob,FormData,AbortSignal,console,...extra});
  return exports;
}
function profile() {
  const directory=fs.mkdtempSync(path.join(__dirname,'.runtime/simple-store-'));
  const {Store}=load('store.js',{electron:{app:{getPath:()=>directory},safeStorage:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()}}});
  return {Store,directory,store:new Store(directory)};
}
test('new profiles need no Writing AI, Ollama or local output-script configuration',()=>{
  const {store,Store,directory}=profile();const settings=store.getSettings();
  assert.equal(settings.formattingProvider,'basic');assert.equal(settings.writingProvider,'off');assert.equal(settings.instructModeEnabled,false);
  assert.equal(settings.localSttOutputMode,undefined);
  assert.equal(settings.startWithWindows,false);
  assert.equal(settings.autoLearnCorrections,false);
  store.updateSettings({startWithWindows:true});assert.equal(new Store(directory).getSettings().startWithWindows,true);
  assert.throws(()=>store.updateSettings({formattingProvider:'ai'}),/Connect a Writing AI/);
  assert.throws(()=>store.updateSettings({instructModeEnabled:true}),/Connect a Writing AI/);
});

test('retired providers migrate without losing history, dictionary, snippets or Roman Hinglish settings',()=>{
  for(const provider of ['openai','mock']) {
    const {Store,directory}=profile();
    const history=[{id:'saved',timestamp:1,processName:'notepad',windowTitle:'',rawText:'original',formattedText:'Original.',durationMs:1000}];
    fs.writeFileSync(path.join(directory,'owlio_config.json'),JSON.stringify({settings:{provider,writingProvider:'openai',openaiApiKey:'retired-key',geminiApiKey:'gemini-key',formattingProvider:'ai',romanizationProvider:'gemini',localSttModel:'base',dictationLanguage:'hinglish'},history,dictionary:[{id:'word',from:'audio',to:'Owlio'}],snippets:[{id:'macro',trigger:'my email',replacement:'me@example.com',description:''}]}));
    const store=new Store(directory),settings=store.getSettings();
    assert.equal(settings.provider,'local');assert.equal(settings.setupCompleted,false);
    assert.equal(settings.writingProvider,'gemini');assert.equal(settings.formattingProvider,'ai');
    assert.equal(settings.romanizationProvider,'gemini');assert.equal(settings.openaiApiKey,undefined);
    assert.equal(store.getHistory()[0].rawText,'original');assert.equal(store.getDictionary()[0].to,'Owlio');assert.equal(store.getSnippets()[0].replacement,'me@example.com');
    const disk=fs.readFileSync(path.join(directory,'owlio_config.json'),'utf8');assert.ok(!disk.includes('retired-key'));assert.ok(!disk.includes('gemini-key'));
    assert.throws(()=>store.updateSettings({provider}),/Expected one/);
    assert.throws(()=>store.updateSettings({writingProvider:'local',formattingProvider:'ai'}),/Gemini/);
    assert.equal(new Store(directory).getSettings().setupCompleted,false);
  }
});
test('legacy profiles preserve keys, model and language while dropping local transliteration',()=>{
  for(const provider of ['local','groq']){
    const {Store,directory}=profile();
    fs.writeFileSync(path.join(directory,'owlio_config.json'),JSON.stringify({settings:{provider,groqApiKey:'old-key',formattingProvider:'auto',localSttModel:'bodhan-flex',localSttOutputMode:'romanized',dictationLanguage:'hi',hotkey:'F10'},history:[],dictionary:[],snippets:[]}));
    const restored=new Store(directory);const settings=restored.getSettings();
    assert.equal(settings.localSttOutputMode,undefined);assert.equal(settings.localSttModel,'bodhan-flex');assert.equal(settings.dictationLanguage,'hi');assert.equal(settings.groqApiKey,'old-key');assert.equal(settings.hotkey,'F10');
    assert.equal(settings.writingProvider,provider==='local'?'local':'off');assert.equal(settings.formattingProvider,'basic');
    restored.updateSettings({mode:'toggle'});
    assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'owlio_config.json'))).settings.localSttOutputMode,undefined);
  }
});
test('changing speech does not change the shared Writing AI',()=>{
  const {Store,store,directory}=profile();
  store.updateSettings({writingProvider:'gemini',geminiApiKey:'writer-key',formattingProvider:'ai',instructModeEnabled:true});
  store.updateSettings({provider:'groq',groqApiKey:'speech-key'});
  const restored=new Store(directory).getSettings();
  assert.equal(restored.writingProvider,'gemini');assert.equal(restored.formattingProvider,'ai');assert.equal(restored.provider,'groq');
});
test('automatic packages preserve compatible runtimes and add full libraries only when needed',()=>{
  assert.equal(recommendedPreset('base'),'whisper-cpu');assert.equal(recommendedPreset('bodhan-flex'),'full-cpu');
  assert.equal(recommendedPreset('bodhan-flex','whisper-cpu'),'full-cpu');assert.equal(recommendedPreset('base','full-cuda'),'full-cuda');assert.equal(recommendedPreset('bodhan-flex','full-cuda'),'full-cuda');
});
test('cleanup, rewrites and summaries use one Writing AI independently of speech',async()=>{
  for(const speech of ['local','groq']){
    const settings={provider:speech,writingProvider:'gemini',formattingProvider:'ai',geminiApiKey:'key',groqApiKey:'speech-key',localSttModel:'base',localSttUrl:'http://localhost:8000/v1',dictationLanguage:'en',writingStyle:'auto',instructModeEnabled:true};
    const calls=[];let spoken='hello world';
    const api=load('aiService.js',{'./store':{store:{getSettings:()=>settings,getDictionary:()=>[]}},'./geminiFormatting':{
      formatWithGemini:async text=>{calls.push('cleanup');return text;},
      generateText:async(system)=>{if(system.includes('meeting-notes')){calls.push('summary');return JSON.stringify({summary:'Summary',actions:[]});}calls.push('rewrite');return 'Revised text';}
    }},{fetch:async(url)=>{assert.ok(url.includes('/audio/transcriptions'));return new Response(spoken);}});
    const context={processName:'notepad',windowTitle:'',browserUrl:'',surroundingText:''};
    await api.processAudioDictation(Buffer.alloc(32044),context);
    spoken='rewrite as bullets';
    const rewrite=await api.processAudioDictation(Buffer.alloc(32044),{...context,selectedText:'Existing source'});assert.equal(rewrite.isInstruct,true,JSON.stringify(rewrite));assert.equal(rewrite.formattedText,'Revised text');
    const summary=await api.summarizeMeeting('A meeting transcript');assert.equal(summary.summary,'Summary');
    assert.deepEqual(calls,['cleanup','rewrite','summary']);
  }
});
