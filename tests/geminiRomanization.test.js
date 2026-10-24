const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const original = 'मुझे कल 10 बजे meeting में जाना है और Rahul को call करना है।';
const romanized = 'mujhe kal 10 baje meeting mein jana hai aur Rahul ko call karna hai।';
const settings = {provider:'local',formattingProvider:'basic',romanizationProvider:'gemini',geminiApiKey:'test-private-key',localSttModel:'hf:Trelis/whisper-hinglish-preview',localSttUrl:'http://localhost:8000/v1',localLlmUrl:'http://localhost:11434',dictationLanguage:'hinglish',writingStyle:'auto',instructModeEnabled:false};
const context = {processName:'notepad',windowTitle:'Private title',browserUrl:'https://private.invalid',surroundingText:'Private field'};
const completed = text => Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text}]}}]});

function load(file, fetch, replacements={}) {
  const exports = {};
  vm.runInNewContext(fs.readFileSync(path.join(root,'dist/main',file),'utf8'), {
    exports, require: name => replacements[name] || (name.startsWith('.') ? require(path.join(root,'dist/main',name)) : require(name)),
    fetch, AbortSignal, Blob, FormData, Buffer, structuredClone, console,
  });
  return exports;
}
function modules(network) {
  const formatting = load('geminiFormatting.js', network);
  return {formatting, romanization:load('geminiRomanization.js',network,{'./geminiFormatting':formatting})};
}
function pipeline(data, network, dictionary=[]) {
  const {formatting,romanization} = modules(network);
  return load('aiService.js',network,{
    './store':{store:{getSettings:()=>data,getDictionary:()=>dictionary}},
    './geminiFormatting':formatting,'./geminiRomanization':romanization,
  });
}

test('English-only and already Romanized text bypass conversion without a key',async()=>{
  const {romanization} = modules(()=>{throw Error('No network expected');});
  for(const input of ['  Hello José, userId=42!\n','kal meeting hai','']) {
    assert.equal(await romanization.romanizeWithGemini(input,''),input);
  }
});

test('conversion uses JSON transcript only, strict parameters, and restores boundary whitespace',async()=>{
  const input = '  '+original+'\n ';
  const {romanization} = modules(async(url,options)=>{
    assert.match(url,/gemini-3.1-flash-lite:generateContent$/);
    assert.equal(options.headers['x-goog-api-key'],settings.geminiApiKey);
    const body=JSON.parse(options.body);
    assert.equal(JSON.parse(body.contents[0].parts[0].text).text,input);
    assert.equal(body.generationConfig.temperature,0);
    assert.ok(!options.body.includes(context.surroundingText));
    assert.ok(!options.body.includes(context.browserUrl));
    assert.ok(!options.body.includes(settings.geminiApiKey));
    return completed(romanized);
  });
  assert.equal(await romanization.romanizeWithGemini(input,settings.geminiApiKey),'  '+romanized+'\n ');
});

test('checks reject changed English, facts, omissions, repetition, script and punctuation',()=>{
  const {romanization} = modules(fetch);
  for(const output of [
    romanized.replace('Rahul','John'),romanized.replace('10','11'),
    romanized.replace('meeting ','') ,romanized+' extra',
    romanized.replace('mujhe','मुझे'),romanized.replace('।','.'),
    JSON.stringify(romanized),'```'+romanized+'```',
    romanized.replace('kal ','kal  '),
  ]) assert.throws(()=>romanization.validateRomanization(original,output));
  assert.doesNotThrow(()=>romanization.validateRomanization('"कल meeting है।"','"kal meeting hai।"'));
  assert.throws(()=>romanization.validateRomanization('José को भेजो।','Jose ko bhejo।'),/English/);
});

test('Hindi compounds can expand into Roman words while literals and line breaks stay fixed',()=>{
  const {romanization} = modules(fetch);
  for(const [input,output] of [
    ['सबकुछ ठीक है।','sab kuch theek hai।'],
    ['मैं करूँगा।','main kar unga।'],
    ['सबकुछ API_v2 42!\nठीक है।','sab kuch API_v2 42!\ntheek hai।'],
    ['userIdको भेजो।','userIdko bhejo।'],
    ['सबकुछ\t\tठीक है।','sab kuch\t\ttheek hai।'],
  ]) assert.doesNotThrow(()=>romanization.validateRomanization(input,output));
  for(const output of ['sab kuch API_v3 42!\ntheek hai।','sab kuch API_v2 43!\ntheek hai।','sab kuch API_v2 42! theek hai।']) {
    assert.throws(()=>romanization.validateRomanization('सबकुछ API_v2 42!\nठीक है।',output));
  }
  assert.throws(()=>romanization.validateRomanization('कल '.repeat(500)+'है।','kal '.repeat(500)+'hai!'));
});

test('oversized input and provider failures do not expose provider error details',async()=>{
  const {romanization} = modules(async()=>Response.json({error:{message:'private account details'}},{status:429}));
  await assert.rejects(()=>romanization.romanizeWithGemini('क'.repeat(12001),'key'),/too long/);
  await assert.rejects(()=>romanization.romanizeWithGemini(original,'key'),error=>/quota/.test(error.message) && !/private/.test(error.message));
});

test('Trelis recognition flows through conversion to basic punctuation while raw history stays Hindi',async()=>{
  const requests=[];
  const api=pipeline(settings,async(url,options)=>{
    requests.push(url);
    if(url.startsWith('http://localhost:8000')) {
      assert.equal(options.body.get('model'),settings.localSttModel);
      assert.equal(options.body.get('language'),'hinglish');
      return new Response(original);
    }
    return completed(romanized);
  });
  const result=await api.processAudioDictation(Buffer.alloc(32044),context);
  assert.equal(result.rawText,original);
  assert.equal(result.formattedText,'M'+romanized.slice(1));
  assert.equal(result.warning,undefined);
  assert.equal(requests.length,2);
});

test('conversion rejection returns the exact raw transcript without cleanup or dictionary mutation',async()=>{
  for(const response of [()=>completed(romanized.replace('10','11')),()=>Response.json({}, {status:429})]) {
    let calls=0;
    const api=pipeline({...settings,formattingProvider:'auto'},async url=>{
      calls++;
      if(url.startsWith('http://localhost:8000'))return new Response(original);
      return response();
    },[{from:'Rahul',to:'Changed'}]);
    const result=await api.processAudioDictation(Buffer.alloc(32044),context);
    assert.equal(result.formattedText,original);
    assert.equal(result.isInstruct,false);
    assert.match(result.warning,/original transcript was preserved/);
    assert.equal(calls,2);
  }
});

test('optional Gemini cleanup runs after conversion and receives the Romanized text',async()=>{
  let count=0;
  const api=pipeline({...settings,formattingProvider:'gemini'},async(url,options)=>{
    if(url.startsWith('http://localhost:8000'))return new Response(original);
    count++;
    if(count===1)return completed(romanized);
    const body=JSON.parse(options.body);
    assert.equal(body.contents[0].parts[0].text,romanized);
    assert.match(body.systemInstruction.parts[0].text,/Latin letters only/);
    return completed('M'+romanized.slice(1));
  });
  assert.equal((await api.processAudioDictation(Buffer.alloc(32044),context)).warning,undefined);
  assert.equal(count,2);
});

test('cleanup and dictionary cannot reintroduce Hindi into a successful Roman conversion',async()=>{
  const api=pipeline({...settings,formattingProvider:'basic'},async url=>{
    if(url.startsWith('http://localhost:8000'))return new Response(original);
    return completed(romanized);
  },[{from:'Rahul',to:'राहुल'}]);
  const result=await api.processAudioDictation(Buffer.alloc(32044),context);
  assert.equal(result.formattedText,romanized);
  assert.match(result.warning,/output script/);
});

test('disabled mode, already Romanized speech and explicit meeting path skip conversion',async()=>{
  for(const [data,input,options] of [
    [{...settings,romanizationProvider:'off'},original,{}],
    [settings,'kal meeting hai',{}],
    [settings,original,{romanize:false}],
  ]) {
    let calls=0;
    const api=pipeline(data,async url=>{calls++;assert.match(url,/localhost:8000/);return new Response(input);});
    await api.processAudioDictation(Buffer.alloc(32044),context,options);
    assert.equal(calls,1);
  }
});

test('Romanization defaults off, requires a key, and persists without changing the cleanup choice',()=>{
  fs.mkdirSync(path.join(__dirname,'.runtime'),{recursive:true});
  const directory=fs.mkdtempSync(path.join(__dirname,'.runtime/roman-store-'));
  const {Store}=load('store.js',fetch,{
    electron:{app:{getPath:()=>directory},safeStorage:{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from('protected:'+value),decryptString:value=>value.toString().slice(10)}},
    './validation':require('../dist/main/validation'),
  });
  const store=new Store(directory);
  assert.equal(store.getSettings().romanizationProvider,'off');
  assert.throws(()=>store.updateSettings({romanizationProvider:'gemini'}),/Vertex API key/);
  store.updateSettings({romanizationProvider:'gemini',geminiApiKey:'synthetic-secret',formattingProvider:'basic'});
  const saved=new Store(directory).getSettings();
  assert.equal(saved.romanizationProvider,'gemini');
  assert.equal(saved.formattingProvider,'basic');
  const disk=fs.readFileSync(path.join(directory,'owlio_config.json'),'utf8');
  assert.ok(!disk.includes('synthetic-secret'));
  assert.throws(()=>store.updateSettings({romanizationProvider:'invalid'}),/Expected one/);
  const parsed=JSON.parse(disk);delete parsed.settings.romanizationProvider;
  fs.writeFileSync(path.join(directory,'owlio_config.json'),JSON.stringify(parsed));
  assert.equal(new Store(directory).getSettings().romanizationProvider,'off');
});
