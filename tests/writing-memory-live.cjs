// Synthetic text only; uses a separate encrypted test profile, never installed settings.
const {app}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const output=path.join(__dirname,'.runtime/writing-memory');
app.setPath('userData',path.join(__dirname,'.runtime/gemini-integration/profile'));
app.disableHardwareAcceleration();
const {Store}=require('../dist/main/store');
const {classifyVocabulary,formatWithGemini}=require('../dist/main/geminiFormatting');
const {LearningService}=require('../dist/main/learningService');
const {matchingPreferences,preferredVocabulary,adaptPunctuation}=require('../dist/main/writingMemory');
app.whenReady().then(async()=>{
  const key=new Store(app.getPath('userData')).getSettings().geminiApiKey;
  assert.ok(key,'Isolated Gemini test profile needs a key');
  fs.mkdirSync(output,{recursive:true});
  const profile=new Store(path.join(output,'live-profile'));
  profile.updateSettings({formattingProvider:'gemini',geminiApiKey:key,dictationLanguage:'hinglish',autoLearnCorrections:true});
  for(const word of profile.getLearnedVocabulary())profile.reviewLearnedWord(word.id,'forget');
  profile.clearHistory();
  profile.addHistory({id:'live-memory',timestamp:Date.now(),processName:'notepad',windowTitle:'Synthetic',rawText:'Please ask Jhon about Owlio',formattedText:'Please ask Jhon about Owlio.',deliveryStatus:'inserted',durationMs:1000});
  const started=Date.now();
  const learning=await new LearningService(profile).correct('live-memory','Please ask John about Owlio.');
  const classificationMs=Date.now()-started;
  assert.equal(learning.added,1,'A clear proper-name typo should be learned');
  const acceptedWrong=await classifyVocabulary([{word:'Sarah',observedSource:'John'}],key);
  assert.deepEqual(acceptedWrong,[],'Changing a person is not a spelling correction');
  profile.setWritingPreferences([{id:'rule',text:'Never use em dashes. Keep the original greeting.',app:'notepad',language:'hinglish',enabled:true},{id:'unrelated',text:'Write in Hindi script',app:'outlook',language:'hi',enabled:true}]);
  const context={processName:'notepad',windowTitle:'',browserUrl:'',surroundingText:'private text never sent'};
  const cases=[
    {name:'learned-name',input:'hey Jhon kal project update bhejna',words:[/^hey/i,/John/,/kal/i,/project/i]},
    {name:'writing-rule',input:'hey team the release is ready but um the documentation needs one more review',words:[/^hey team/i,/release/i,/documentation/i]},
    {name:'common-word',input:'please use the word shown in the report',words:[/shown/i,/report/i]},
  ];
  const results=[];
  for(const sample of cases){
    const tick=Date.now();
    const text=await formatWithGemini(sample.input,{key,style:'auto',romanized:true,preferences:matchingPreferences(profile.getWritingPreferences(),context,'hinglish'),vocabulary:preferredVocabulary(profile.getLearnedVocabulary()),category:'other'});
    results.push({name:sample.name,input:sample.input,text,formattingMs:Date.now()-tick});
    fs.writeFileSync(path.join(output,'live-result.json'),JSON.stringify({success:false,learning,classificationMs,cases:results},null,2));
    for(const word of sample.words)assert.match(text,word);
    assert.ok(!/[—\u0900-\u097f]/.test(text));
    if(sample.name==='common-word')assert.ok(!/John/.test(text),'Vocabulary hints must not replace unrelated words');
  }
  assert.equal(adaptPunctuation('Hey John.',{...context,processName:'slack'},profile.getSettings()),'Hey John');
  fs.writeFileSync(path.join(output,'live-result.json'),JSON.stringify({success:true,learning,classificationMs,rejectedDifferentPerson:true,cases:results},null,2));
  console.log(JSON.stringify({success:true,learning,classificationMs,rejectedDifferentPerson:true,cases:results}));
  app.quit();
}).catch(error=>{console.error('Writing memory live test failed:',error.message);app.exit(1);});
