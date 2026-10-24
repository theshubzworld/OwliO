const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const languages=require('../dist/shared/speechLanguages');
const root=path.resolve(__dirname,'..');
function load(name,replacements={},extra={}){
  const exports={};vm.runInNewContext(fs.readFileSync(path.join(root,'dist/main',name),'utf8'),{exports,require:name=>replacements[name]||(name.startsWith('.')?require(path.join(root,'dist/main',name)):require(name)),structuredClone,Buffer,Blob,FormData,AbortSignal,console,...extra});return exports;
}
function profile(){
  const directory=fs.mkdtempSync(path.join(__dirname,'.runtime/languages-'));
  const {Store}=load('store.js',{electron:{app:{getPath:()=>directory},safeStorage:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()}}});
  return {Store,directory,store:new Store(directory)};
}
test('Whisper language names and model-specific choices are complete and unique',()=>{
  assert.equal(languages.WHISPER_LANGUAGES.length,100);assert.equal(new Set(languages.SPEECH_LANGUAGE_CODES).size,114);
  for(const code of ['ta','te','bn','mr','gu','pa','ur','fr','de','es','ja','ar','zh']){
    assert.ok(languages.supportsSpeechLanguage('local','small',code));assert.notEqual(languages.languageName(code),code);
    assert.equal(languages.supportsSpeechLanguage('local','bodhan-flex',code),languages.FLEX_LANGUAGE_CODES.includes(code));
  }
  assert.equal(languages.supportsSpeechLanguage('local','base','yue'),false);
  assert.equal(languages.supportsSpeechLanguage('local','turbo','yue'),true);
  assert.equal(languages.supportsSpeechLanguage('local','large-v3','yue'),true);
  assert.equal(languages.supportsSpeechLanguage('openai','base','yue'),false);
  assert.equal(languages.supportsSpeechLanguage('local','base','invented'),false);
});
test('multilingual settings and scoped rules survive restart; incompatible model changes are rejected',()=>{
  const {Store,directory,store}=profile();
  for(const code of languages.SPEECH_LANGUAGE_CODES.filter(code=>languages.supportsSpeechLanguage('local','base',code))){
    store.updateSettings({dictationLanguage:code});assert.equal(new Store(directory).getSettings().dictationLanguage,code);
  }
  store.updateSettings({dictationLanguage:'fr'});
  store.setWritingPreferences([{id:'tamil',text:'Keep wording',app:'all',language:'ta',enabled:true}]);
  assert.equal(new Store(directory).getWritingPreferences()[0].language,'ta');
  assert.throws(()=>store.updateSettings({localSttModel:'bodhan-flex'}),/compatible speech/);
  assert.equal(store.getSettings().localSttModel,'base');assert.equal(store.getSettings().dictationLanguage,'fr');
  assert.throws(()=>store.updateSettings({dictationLanguage:'invalid'}),/Expected one/);
  store.updateSettings({dictationLanguage:'hi',localSttModel:'bodhan-flex'});
  assert.equal(store.getSettings().localSttModel,'bodhan-flex');
});
test('all transcription providers forward explicit languages and omit automatic detection hints',async()=>{
  for(const provider of ['local','groq'])for(const language of ['ta','ar','fr','ja','auto']){
    const settings={provider,dictationLanguage:language,formattingProvider:'basic',writingProvider:'off',romanizationProvider:'off',localSttModel:'small',localSttUrl:'http://localhost:8000/v1',groqApiKey:'test',writingStyle:'auto',instructModeEnabled:false};
    const transcript='வணக்கம் — مرحبا — Bonjour — こんにちは';let form;
    const api=load('aiService.js',{'./store':{store:{getSettings:()=>settings,getDictionary:()=>[]}}},{fetch:async(url,options)=>{assert.ok(url.includes('/audio/transcriptions'));form=options.body;return new Response(transcript);}});
    const result=await api.processAudioDictation(Buffer.alloc(32044),{processName:'notepad',windowTitle:'',browserUrl:'',surroundingText:''});
    assert.equal(form.get('language'),language==='auto'?null:language);
    assert.equal(form.get('prompt'),null);assert.equal(form.get('task'),null);assert.equal(result.rawText,transcript);
  }
});
test('Hindi conversion never processes other Devanagari languages or automatic language detection',async()=>{
  for(const language of ['mr','ne','sa','auto']){
    const settings={provider:'local',dictationLanguage:language,formattingProvider:'basic',writingProvider:'off',romanizationProvider:'gemini',geminiApiKey:'test',localSttModel:'small',localSttUrl:'http://localhost:8000/v1',writingStyle:'auto',instructModeEnabled:false};
    let calls=0;const transcript='माझे नाव';
    const api=load('aiService.js',{'./store':{store:{getSettings:()=>settings,getDictionary:()=>[]}}},{fetch:async url=>{calls++;assert.ok(url.startsWith('http://localhost'));return new Response(transcript);}});
    const result=await api.processAudioDictation(Buffer.alloc(32044),{processName:'notepad',windowTitle:'',browserUrl:'',surroundingText:''});
    assert.equal(calls,1);assert.equal(result.rawText,transcript);assert.ok(result.formattedText.includes(transcript));
  }
  assert.equal(languages.usesHindiConversion('hi'),true);assert.equal(languages.usesHindiConversion('hinglish'),true);
});

test('AI cleanup preserves non-Latin scripts instead of applying Latin-only Hinglish instructions',async()=>{
  for(const [language,transcript] of [['ta','வணக்கம்'],['ar','مرحبا'],['ja','こんにちは'],['mr','माझे नाव']]){
    for(const writer of ['gemini']){
      const settings={provider:'local',dictationLanguage:language,formattingProvider:'ai',writingProvider:writer,romanizationProvider:'off',geminiApiKey:'test',localSttModel:'small',localSttUrl:'http://localhost:8000/v1',localLlmUrl:'http://localhost:11434',localLlmModel:'test',writingStyle:'auto',instructModeEnabled:false};
      let cleaned=false;
      const api=load('aiService.js',{'./store':{store:{getSettings:()=>settings,getDictionary:()=>[]}},'./geminiFormatting':{formatWithGemini:async(text,options)=>{assert.equal(options.romanized,false);assert.equal(text,transcript);cleaned=true;return text;}}},{fetch:async(url,options)=>{

        return new Response(transcript);
      }});
      const result=await api.processAudioDictation(Buffer.alloc(32044),{processName:'notepad',windowTitle:'',browserUrl:'',surroundingText:''});
      assert.equal(cleaned,true);assert.equal(result.formattedText,transcript);assert.equal(result.warning,undefined);
    }
  }
});


test('automatic model selection respects documented coverage and installed models',()=>{
  const trelis='hf:Trelis/whisper-hinglish-preview';
  const models=[{id:trelis,downloaded:true},{id:'bodhan-flex',downloaded:true},{id:'small',downloaded:true},{id:'turbo',downloaded:false}];
  assert.equal(languages.supportsSpeechLanguage('local',trelis,'ta'),false);
  assert.equal(languages.selectSpeechModel('hi',trelis,models).model,trelis);
  assert.equal(languages.selectSpeechModel('ta',trelis,models).model,'small');
  assert.equal(languages.selectSpeechModel('ta','bodhan-flex',models).model,'bodhan-flex');
  assert.equal(languages.selectSpeechModel('fr','bodhan-flex',models).model,'small');
  assert.equal(languages.selectSpeechModel('bho','small',models).model,'bodhan-flex');
  assert.equal(languages.selectSpeechModel('auto',trelis,models).model,'small');
  assert.equal(languages.selectSpeechModel('yue','base',models).model,'turbo');
  assert.equal(languages.selectSpeechModel('yue','base',models).downloaded,false);
  assert.equal(languages.selectSpeechModel('ja','turbo',models).model,'small','Reuse a download when the currently staged compatible model is missing');
  assert.equal(languages.selectSpeechModel('ja','turbo',[{id:'turbo',downloaded:false}]).model,'turbo','Keep a compatible pending choice if no installed match exists');
});

test('missing models choose an explicit download and never invent custom coverage',()=>{
  const unknown=[{id:'hf:owner/unknown',downloaded:true}];
  assert.equal(languages.selectSpeechModel('ta','hf:owner/unknown',unknown).model,'small');
  assert.equal(languages.selectSpeechModel('bho','small',unknown).model,'bodhan-flex');
  assert.equal(languages.selectSpeechModel('ta','hf:owner/unknown',unknown).downloaded,false);
  const declared=[{id:'hf:owner/tamil',downloaded:true,languages:['ta']}];
  assert.equal(languages.selectSpeechModel('ta','hf:owner/tamil',declared).model,'hf:owner/tamil');
  assert.equal(languages.selectSpeechModel('fr','hf:owner/tamil',declared).model,'small');
  assert.equal(languages.documentedModelLanguages('hf:openai/whisper-base.en').join(','),'en');
  assert.equal(languages.selectSpeechModel('fr','hf:openai/whisper-base.en',[{id:'base',downloaded:true}]).model,'base');
});

test('installed modern Hinglish models participate in automatic selection with verified coverage',()=>{
  const mayank='hf:mayank-dubey-ai/whisper-large-v3-turbo-hinglish';
  const apex='hf:Oriserve/Whisper-Hindi2Hinglish-Apex';
  for(const model of [mayank,apex]) {
    assert.deepEqual(languages.documentedModelLanguages(model),['hi','en']);
    assert.equal(languages.selectSpeechModel('hinglish','base',[{id:model,downloaded:true},{id:'bodhan-flex',downloaded:true}]).model,model);
    assert.equal(languages.supportsSpeechLanguage('local',model,'ta'),false);
  }
  assert.equal(languages.selectSpeechModel('hinglish','base',[{id:apex,downloaded:true},{id:mayank,downloaded:true}]).model,mayank);
});
