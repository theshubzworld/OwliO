// Real API checks with synthetic dictation and the isolated development test profile.
// No installed settings, microphone audio or text from other windows is used.
const {app}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const output=path.join(__dirname,'.runtime/gemini-integration');
app.setPath('userData',path.join(output,'profile'));
app.disableHardwareAcceleration();
const {Store}=require('../dist/main/store');
const {formatWithGemini}=require('../dist/main/geminiFormatting');
app.whenReady().then(async()=>{
  const key=new Store(app.getPath('userData')).getSettings().geminiApiKey;
  assert.ok(key,'The isolated Gemini test profile needs a Vertex key');
  const samples=[
    {name:'hinglish-tasks',input:'Kal teen kaam karne hain Rahul ko call karna report bhejni hai aur meeting schedule karni hai',items:3,words:[/Rahul/i,/report/i,/meeting/i]},
    {name:'ordered-steps',input:'First open Settings then select Gemini finally save the changes',steps:3,words:[/Settings/i,/Gemini/i,/save/i]},
    {name:'conversation',input:'Hey Rahul kal main office gaya tha aur tumse milna chahta tha lekin tum busy the',prose:true,words:[/^Hey Rahul/i,/office/i,/busy/i]},
    {name:'correction-in-list',input:'Hey team do kaam hain pehla report Friday nahi Monday ko bhejna doosra Rahul ko call karna',items:2,words:[/^Hey team/i,/Monday/i,/Rahul/i],rejected:/\bFriday\b/i},
    {name:'structure-disabled',input:'Kal teen kaam karne hain Rahul ko call karna report bhejni hai aur meeting schedule karni hai',structured:false,prose:true,words:[/Rahul/i,/report/i,/meeting/i]},
  ];
  const results=[];
  for(const sample of samples){
    const started=Date.now();
    const text=await formatWithGemini(sample.input,{key,style:'auto',romanized:true,structured:sample.structured!==false});
    const result={name:sample.name,input:sample.input,text,formattingMs:Date.now()-started};
    results.push(result);
    fs.writeFileSync(path.join(output,'structure-live-result.json'),JSON.stringify({success:false,cases:results},null,2));
    for(const word of sample.words)assert.match(text,word,`${sample.name}: a spoken detail was lost`);
    assert.ok(!/[\u0900-\u097f]/.test(text),'Output must remain Romanized');
    if(sample.items)assert.equal((text.match(/^\s*[•*-]\s+.+$/gm)||[]).length,sample.items,`${sample.name}: bullet count`);
    if(sample.steps)assert.deepEqual([...text.matchAll(/^\s*(\d+)\.\s+.+$/gm)].map(match=>Number(match[1])),[1,2,3]);
    if(sample.prose)assert.ok(!/^\s*(?:[•*-]|\d+\.)\s+/m.test(text),'Ordinary speech / disabled organization must stay prose');
    if(sample.rejected)assert.ok(!sample.rejected.test(text),'Spoken correction must remove the rejected detail');
  }
  fs.writeFileSync(path.join(output,'structure-live-result.json'),JSON.stringify({success:true,cases:results},null,2));
  console.log(JSON.stringify({success:true,cases:results}));
  app.quit();
}).catch(error=>{console.error('Structured formatting test failed:',error.message);app.exit(1);});
