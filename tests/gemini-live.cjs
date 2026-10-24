const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const readline=require('node:readline');
const {performance}=require('node:perf_hooks');
const root=path.resolve(__dirname,'..');
const output=path.join(__dirname,'.runtime/gemini-integration');
fs.mkdirSync(output,{recursive:true});
const {formatWithGemini}=require('../dist/main/geminiFormatting');
(async()=>{
  const input=readline.createInterface({input:process.stdin,terminal:false});
  const key=await new Promise(resolve=>input.once('line',resolve));input.close();
  const cases=[
    {name:'greeting',text:'hey team um meeting kal nahi parso hai please Rahul ko bata do',greeting:/^hey team/i,abandoned:/\bkal\b/},
    {name:'technical',text:'bhai um fetchUserProfile function mein userId pass karo deployment Friday nahi Monday ko karna',greeting:/^bhai/i,abandoned:/\bFriday\b/},
    {name:'english',text:'hey team um please send the update tomorrow morning at ten actually eleven',greeting:/^hey team/i,abandoned:/\bten\b/}
  ];
  const results=[];
  for(const sample of cases){
    const started=performance.now();
    const text=await formatWithGemini(sample.text,{key,style:'auto',romanized:true});
    results.push({name:sample.name,input:sample.text,text,formattingMs:Math.round(performance.now()-started)});
    fs.writeFileSync(path.join(output,'live-cases.json'),JSON.stringify(results,null,2));
    assert.match(text,sample.greeting,'Existing greeting must remain');
    assert.ok(!sample.abandoned.test(text),'Abandoned correction must be removed');
    assert.ok(!/[\u0900-\u097f]/.test(text),'Hinglish must stay Romanized');
  }
  // Exercise real local speech recognition followed by the same Gemini module.
  const settings={provider:'local',formattingProvider:'gemini',geminiApiKey:key,localSttModel:'bodhan-flex',localSttUrl:process.env.OWLIO_TEST_STT_URL||'http://localhost:8000/v1',localLlmUrl:'http://localhost:11434',localLlmModel:'llama3.2',dictationLanguage:'en',writingStyle:'auto',instructModeEnabled:false};
  const api={};
  vm.runInNewContext(fs.readFileSync(path.join(root,'dist/main/aiService.js'),'utf8'),{exports:api,require:name=>name==='./store'?{store:{getSettings:()=>settings,getDictionary:()=>[]}}:require(path.join(root,'dist/main',name)),fetch,Blob,FormData,AbortSignal,Buffer,console});
  const started=performance.now();
  const result=await api.processAudioDictation(fs.readFileSync(path.join(output,'synthetic.wav')),{processName:'test',windowTitle:'',browserUrl:'',surroundingText:''});
  assert.ok(result.rawText.trim());assert.ok(result.formattedText.trim());assert.equal(result.warning,undefined);
  fs.writeFileSync(path.join(output,'live-result.json'),JSON.stringify({success:true,cases:results,pipeline:{...result,totalMs:Math.round(performance.now()-started)},installedAppChanged:false},null,2));
  console.log(JSON.stringify({success:true,cases:results,pipeline:{...result,totalMs:Math.round(performance.now()-started)}}));
})().catch(error=>{console.error('Gemini live integration failed:',error.message);process.exitCode=1;});
