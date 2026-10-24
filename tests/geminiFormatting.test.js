const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const baseSettings = {provider:'local',formattingProvider:'gemini',geminiApiKey:'synthetic-test-key',localSttModel:'bodhan-flex',localSttUrl:'http://localhost:8000/v1',localLlmUrl:'http://localhost:11434',localLlmModel:'llama3.2',dictationLanguage:'hinglish',writingStyle:'auto',instructModeEnabled:false};
const context = {processName:'Editor',windowTitle:'Private title',browserUrl:'',surroundingText:'Private surrounding text'};
function moduleWith(file, fetch, replacements={}) {
  const exports={};
  vm.runInNewContext(fs.readFileSync(path.join(root,'dist/main',file),'utf8'),{
    exports, require: name=>replacements[name]||(name.startsWith('.')?require(path.join(root,'dist/main',name)):require(name)), fetch, AbortSignal, Blob, FormData, Buffer, structuredClone,
  });
  return exports;
}
function pipeline(settings, fetch) {
  return moduleWith('aiService.js',fetch,{
    './store':{store:{getSettings:()=>settings,getDictionary:()=>[]}},
    './geminiFormatting':moduleWith('geminiFormatting.js',fetch),
  });
}

test('full dictation cleanup uses approved memory and exact app/language rules without sending cursor text',async()=>{
  let sent;
  const data={...baseSettings,contextAwarePunctuation:true,punctuationMode:'auto'};
  const network=async(url,options)=>{
    if(url.startsWith('http://localhost:8000'))return new Response('hey Jhon kal project update bhejna');
    sent=JSON.parse(options.body);
    return completed('Hey John, kal project update bhejna.');
  };
  const api=moduleWith('aiService.js',network,{
    './store':{store:{getSettings:()=>data,getDictionary:()=>[],getLearnedVocabulary:()=>[{word:'John',observedSource:'Jhon',status:'learned',count:1,lastUsed:1},{word:'Unapproved',observedSource:'Other',status:'pending',count:1,lastUsed:1}],getWritingPreferences:()=>[{id:'a',text:'Keep final sentence periods',app:'notepad',language:'hinglish',enabled:true},{id:'b',text:'irrelevant-rule',app:'outlook',language:'all',enabled:true}]}},
    './geminiFormatting':moduleWith('geminiFormatting.js',network),
  });
  const result=await api.processAudioDictation(Buffer.alloc(32044),{...context,processName:'notepad',beforeText:'',afterText:'',selectedText:''});
  assert.equal(result.formattedText,'Hey John, kal project update bhejna.');
  assert.match(sent.systemInstruction.parts[0].text,/John/);
  assert.match(sent.systemInstruction.parts[0].text,/Keep final sentence periods/);
  assert.ok(!JSON.stringify(sent).includes('Unapproved'));
  assert.ok(!JSON.stringify(sent).includes('irrelevant-rule'));
  assert.ok(!JSON.stringify(sent).includes(context.surroundingText));
});
const completed=text=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text}]}}]});

test('Gemini receives recognized text only while speech stays on local Bodhan Flex',async()=>{
  const calls=[];
  const api=pipeline(baseSettings,async(url,options)=>{
    calls.push([url,options]);
    return url.startsWith('http://localhost:8000')?new Response('bhai kal meeting hai nahi parso meeting hai'):completed('Bhai, parso meeting hai.');
  });
  const result=await api.processAudioDictation(Buffer.alloc(32044),context);
  assert.equal(result.formattedText,'Bhai, parso meeting hai.');
  assert.equal(result.warning,undefined);
  assert.equal(calls.length,2);
  assert.equal(calls[0][1].body.get('model'),'bodhan-flex');
  assert.equal(calls[0][1].body.get('output_mode'),'native');
  assert.equal(calls[1][0],'https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3.1-flash-lite:generateContent');
  const body=JSON.parse(calls[1][1].body);
  assert.equal(body.contents[0].parts[0].text,result.rawText);
  assert.match(body.systemInstruction.parts[0].text,/existing greetings/);
  assert.match(body.systemInstruction.parts[0].text,/Latin letters only/);
  assert.equal(calls[1][1].headers['x-goog-api-key'],'synthetic-test-key');
  assert.ok(!calls[1][1].body.includes(context.surroundingText));
  assert.ok(!calls[1][1].body.includes(context.windowTitle));
  assert.ok(!calls[1][1].body.includes('synthetic-test-key'));
});

test('rate limits and network failures preserve words and report basic punctuation fallback',async()=>{
  for(const fail of [()=>Response.json({error:{message:'never expose this response body'}},{status:429}),()=>{throw new Error('private network detail');}]) {
    const api=pipeline(baseSettings,async url=>url.startsWith('http://localhost:8000')?new Response('kal meeting hai'):fail());
    const result=await api.processAudioDictation(Buffer.alloc(32044),context);
    assert.equal(result.formattedText,'Kal meeting hai.');
    assert.match(result.warning,/words were preserved/);
    assert.ok(!result.warning.includes('private network detail'));
    assert.ok(!result.warning.includes('never expose'));
  }
});

test('blocked, truncated, empty and wrong-script responses never replace the recognized words',async()=>{
  for(const response of [
    Response.json({promptFeedback:{blockReason:'SAFETY'}}),
    Response.json({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'Partial'}]}}]}),
    completed(''),completed('कल मीटिंग है।'),completed('```output```'),
  ]) {
    const api=pipeline(baseSettings,async url=>url.startsWith('http://localhost:8000')?new Response('kal meeting hai'):response);
    const result=await api.processAudioDictation(Buffer.alloc(32044),context);
    assert.equal(result.formattedText,'Kal meeting hai.');
    assert.match(result.warning,/Gemini cleanup/);
  }
});

test('Gemini ignores thought parts and permits the selected native Hindi script',async()=>{
  const api=moduleWith('geminiFormatting.js',async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'Do not insert thoughts'},{text:'कल मीटिंग है।'}]}}]}));
  const result=await api.formatWithGemini('कल मीटिंग है',{key:'test',style:'auto',romanized:false});
  assert.equal(result,'कल मीटिंग है।');
});

test('basic punctuation never calls a formatting API',async()=>{
  let calls=0;
  const api=pipeline({...baseSettings,formattingProvider:'basic'},async url=>{assert.ok(url.startsWith('http://localhost:8000'));calls++;return new Response('hello world');});
  const result=await api.processAudioDictation(Buffer.alloc(32044),context);
  assert.equal(result.formattedText,'Hello world.');
  assert.equal(calls,1);
});

test('structured cleanup preserves multiline bullets and the saved prose-only option reaches Gemini',async()=>{
  for(const structured of [true,false]) {
    const output=structured?'Kal do kaam hain:\n• Rahul ko call karna.\n• Report bhejna.':'Kal do kaam hain: Rahul ko call karna aur report bhejna.';
    let calls=0;
    const api=pipeline({...baseSettings,geminiStructuredFormatting:structured},async(url,options)=>{
      calls++;
      if(url.startsWith('http://localhost:8000'))return new Response('kal do kaam hain Rahul ko call karna aur report bhejna');
      const prompt=JSON.parse(options.body).systemInstruction.parts[0].text;
      assert.ok(prompt.includes(structured?'Automatically organize clear lists':'Do not create bullet points or numbered lists'));
      return completed(output);
    });
    const result=await api.processAudioDictation(Buffer.alloc(32044),context);
    assert.equal(result.formattedText,output);
    assert.equal(result.warning,undefined);
    assert.equal(calls,2,'Organization must not make an extra model request');
  }
});

test('Gemini key is encrypted and survives a settings restart; an absent key cannot enable Gemini',()=>{
  const directory=fs.mkdtempSync(path.join(__dirname,'.runtime/gemini-store-'));
  const electron={app:{getPath:()=>directory},safeStorage:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from('protected:'+value),decryptString:value=>value.toString().slice(10)}};
  const replacements={electron,'./validation':require('../dist/main/validation')};
  const {Store}=moduleWith('store.js',fetch,replacements);
  const store=new Store(directory);
  assert.equal(store.getSettings().formattingProvider,'basic');
  assert.equal(store.getSettings().geminiStructuredFormatting,true);
  assert.throws(()=>store.updateSettings({formattingProvider:'gemini'}),/Vertex API key/);
  const selected=store.updateSettings({geminiApiKey:'synthetic-secret',formattingProvider:'gemini'});
  assert.equal(selected.provider,'local');
  const disk=JSON.parse(fs.readFileSync(path.join(directory,'owlio_config.json'),'utf8'));
  assert.ok(disk.settings.geminiApiKey.startsWith('encrypted:'));
  assert.ok(!JSON.stringify(disk).includes('synthetic-secret'));
  assert.equal(new Store(directory).getSettings().geminiApiKey,'synthetic-secret');
  assert.equal(new Store(directory).getSettings().formattingProvider,'ai');
  store.updateSettings({geminiStructuredFormatting:false});
  assert.equal(new Store(directory).getSettings().geminiStructuredFormatting,false);
  assert.throws(()=>store.updateSettings({geminiStructuredFormatting:'false'}),/true or false/);
});
