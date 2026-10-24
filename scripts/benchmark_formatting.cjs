// Keys arrive once through a pipe and are never written to results or application settings.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const {performance} = require('node:perf_hooks');
const strict = process.argv.includes('--strict');
const output = path.resolve(__dirname, '../tests/.runtime/api-formatting', strict ? 'strict' : '.');
fs.mkdirSync(output, {recursive:true});
const instructions = 'Clean up this voice dictation into ready-to-paste text. Fix punctuation and capitalization, remove um/uh and accidental repeated words, and apply explicit spoken corrections. Preserve the meaning, names, technical identifiers and original language. Keep Hindi-English speech in Romanized Hinglish using Latin letters; never translate it or use Devanagari. Do not add facts, greetings, explanations, quotes or markdown fences. Output only the cleaned text.' + (strict ? ' Resolve self-corrections into the final intended statement: delete the abandoned words and correction markers, not just punctuate them. Examples: "at ten actually eleven" becomes "at eleven"; "kal meeting hai nahi actually parso meeting hai" becomes "parso meeting hai"; "Friday nahi Monday ko karna" becomes "Monday ko karna"; "deploy on Thursday actually make that Friday" becomes "deploy on Friday". Preserve every other request and detail.' : '');
const samples = [
  {id:'english', text:'um can you send the the project update to Priya tomorrow morning at ten actually make that eleven please'},
  {id:'hinglish', text:'haan um kal meeting hai nahi actually parso meeting hai Rahul ko bol do ki report ready rakhe aur invoice bhi bhej de'},
  {id:'technical', text:'bhai um fetchUserProfile function mein userId pass karo aur error aaye to console dot error use karo deployment Friday nahi Monday ko karna'},
  {id:'long', text:'hey team um I reviewed the release notes and the the checkout changes look good please ask Priya to test the refund flow and ask Rahul to check the dashboard numbers we were planning to deploy on Thursday actually make that Friday morning at ten thirty also keep the existing login page unchanged and send me a short update once testing is finished'}
];
const report = {created:new Date().toISOString(), metric:'complete formatted response, client wall-clock milliseconds', syntheticSamples:true, instructions, samples, probes:[], trials:[], models:[]};
let keys;
const safeCode = data => typeof data?.error?.code === 'string' ? data.error.code : typeof data?.error?.status === 'string' ? data.error.status : undefined;
const save = () => fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));
async function post(provider, model, text) {
  const started=performance.now();
  const googleConfig={temperature:0.1,maxOutputTokens:300};
  if(model.startsWith('gemini-2.5'))googleConfig.thinkingConfig={thinkingBudget:0};
  if(model.startsWith('gemini-3.'))googleConfig.thinkingConfig={thinkingLevel:'MINIMAL'};
  const oaBody={model,messages:[{role:'system',content:instructions},{role:'user',content:text}],max_completion_tokens:300,store:false};
  if(model.startsWith('gpt-5')||model.startsWith('gpt-6'))oaBody.reasoning_effort='none';
  else oaBody.temperature=0.1;
  const url=provider==='gemini' ? `https://aiplatform.googleapis.com/v1/publishers/google/models/${model}:generateContent` : 'https://api.openai.com/v1/chat/completions';
  const headers=provider==='gemini'?{'Content-Type':'application/json','x-goog-api-key':keys.gemini}:{'Content-Type':'application/json',Authorization:'Bearer '+keys.openai};
  try {
    const response=await fetch(url,{method:'POST',headers,body:JSON.stringify(provider==='gemini'?{systemInstruction:{parts:[{text:instructions}]},contents:[{role:'user',parts:[{text}]}],generationConfig:googleConfig}:oaBody),signal:AbortSignal.timeout(25000)});
    const data=await response.json();
    const elapsedMs=Math.round(performance.now()-started);
    if(!response.ok)return {ok:false,status:response.status,code:safeCode(data),elapsedMs};
    const result=provider==='gemini' ? (data.candidates?.[0]?.content?.parts||[]).filter(part=>!part.thought).map(part=>part.text||'').join('').trim() : (data.choices?.[0]?.message?.content||'').trim();
    return {ok:!!result,status:response.status,elapsedMs,text:result,usage:provider==='gemini'?data.usageMetadata:data.usage,finishReason:provider==='gemini'?data.candidates?.[0]?.finishReason:data.choices?.[0]?.finish_reason};
  } catch(error) {return {ok:false,code:error.name,elapsedMs:Math.round(performance.now()-started)};}
}
const configs=[
  {provider:'gemini',model:'gemini-3.1-flash-lite'},
  {provider:'gemini',model:'gemini-2.5-flash-lite'},
  {provider:'openai',model:'gpt-4.1-nano'},
  {provider:'openai',model:'gpt-4o-mini'},
  {provider:'openai',model:'gpt-5.4-nano'}
].filter(config => !strict || ['gemini-3.1-flash-lite', 'gpt-4.1-nano'].includes(config.model));
async function main() {
  const input=readline.createInterface({input:process.stdin,terminal:false});
  console.log('Ready for credentials via stdin.');
  keys=JSON.parse(await new Promise(resolve=>input.once('line',resolve)));input.close();
  const available=[];
  const blockedProviders=new Set();
  for(const config of configs) {
    if(blockedProviders.has(config.provider))continue;
    const result=await post(config.provider,config.model,'um the meeting is tomorrow at ten actually eleven');
    report.probes.push({...config,...result});save();
    console.log(JSON.stringify({phase:'probe',...config,ok:result.ok,status:result.status,code:result.code,elapsedMs:result.elapsedMs}));
    if(result.ok)available.push(config);
    else if([401,403].includes(result.status)||result.code==='insufficient_quota')blockedProviders.add(config.provider);
  }
  // Same four samples twice per model. Alternate order to reduce time-of-day bias.
  for(let round=0;round<2;round++)for(const sample of samples)for(const config of (round?available.slice().reverse():available)) {
    if(blockedProviders.has(config.provider))continue;
    const result=await post(config.provider,config.model,sample.text);
    report.trials.push({...config,sample:sample.id,round,...result});save();
    console.log(JSON.stringify({phase:'trial',...config,sample:sample.id,round,ok:result.ok,status:result.status,elapsedMs:result.elapsedMs}));
    if(result.status===429){blockedProviders.add(config.provider);console.log(config.provider+' rate limited; stopping its requests.');}
    await new Promise(resolve=>setTimeout(resolve,150));
  }
  for(const config of available) {
    const trials=report.trials.filter(t=>t.provider===config.provider&&t.model===config.model);
    const sorted=trials.filter(t=>t.ok).map(t=>t.elapsedMs).sort((a,b)=>a-b);
    report.models.push({...config,attempts:trials.length,successes:sorted.length,medianMs:sorted.length?Math.round((sorted[Math.floor((sorted.length-1)/2)]+sorted[Math.floor(sorted.length/2)])/2):null,minMs:sorted[0],maxMs:sorted.at(-1),nonLatinOutputs:trials.filter(t=>t.ok&&/[\u0900-\u097f]/.test(t.text)).length});
  }
  save();console.log(JSON.stringify({summary:report.models,output:path.join(output,'results.json')}));keys=undefined;
}
main().catch(error=>{keys=undefined;console.error('Benchmark stopped:',error.name);process.exitCode=1;});
