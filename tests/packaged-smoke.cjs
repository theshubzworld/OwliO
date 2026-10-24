const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const port = Number(process.argv[2] || 9337);
const output = path.join(__dirname, '.runtime');
const waitFor = async check => {
  const end = Date.now() + 90000;
  while (Date.now() < end) { try { const result=await check(); if(result) return result; } catch {} await new Promise(resolve=>setTimeout(resolve,250)); }
  throw new Error('Packaged app did not become ready');
};
async function connect(page) {
  const ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  let sequence=0; const pending=new Map();
  ws.addEventListener('message',event=>{
    const msg=JSON.parse(event.data); const item=pending.get(msg.id);
    if(item){pending.delete(msg.id);clearTimeout(item.timer);msg.error?item.reject(new Error(msg.error.message)):item.resolve(msg.result);}
  });
  const call=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error('Timed out: '+method));},90000);
    pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));
  });
  const js=async expression=>{
    const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    if(result.exceptionDetails)throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  return {call,js,close:()=>ws.close()};
}
(async()=>{
  const pages=await waitFor(async()=>{const response=await fetch(`http://127.0.0.1:${port}/json/list`);const pages=await response.json();return pages.some(page=>page.url.includes('view=dashboard'))&&pages.some(page=>page.url.includes('view=pill'))?pages:null;});
  const dashboard=await connect(pages.find(page=>page.url.includes('view=dashboard')));
  const pill=await connect(pages.find(page=>page.url.includes('view=pill')));
  try {
    await waitFor(()=>dashboard.js('document.querySelector(".brand-title")?.textContent === "Owlio" && document.querySelector(".brand-icon img")?.naturalWidth === 256'));
    await waitFor(()=>pill.js('!!document.querySelector(".owl-avatar")'));
    const source=JSON.parse(fs.readFileSync(path.join(process.env.APPDATA,'Electron/owlio_config.json'),'utf8'));
    const settings=await dashboard.js('window.api.getSettings()');
    for(const field of ['hotkey','mode','localSttModel','dictationLanguage'])assert.equal(settings[field],source.settings[field]);
    const history=await dashboard.js('window.api.getHistory()');
    assert.equal(history.length,source.history.length);
    const status=await dashboard.js('window.api.getLocalModels()');
    assert.equal(status.speech.online,true);
    assert.equal(status.speech.models.find(model=>model.id===settings.localSttModel).downloaded,true);
    const switched=await dashboard.js(`window.api.speechModelAction(${JSON.stringify(settings.localSttModel)},"activate")`);
    assert.equal(switched.localSttModel,settings.localSttModel);
    const active=await dashboard.js('window.api.getLocalModels()');
    assert.equal(active.speech.loaded_model,settings.localSttModel);
    await dashboard.js('window.api.openDashboard("settings")');
    await waitFor(()=>dashboard.js('!!document.querySelector(".settings-page")'));
    fs.writeFileSync(path.join(output,'packaged-settings.png'),Buffer.from((await dashboard.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    const result={success:true,historyCount:history.length,hotkey:settings.hotkey,model:settings.localSttModel,runtime:active.speech.runtime,cache:active.speech.cache_directory};
    fs.writeFileSync(path.join(output,'packaged-result.json'),JSON.stringify(result));console.log(result);
  } finally {dashboard.close();pill.close();}
})().catch(error=>{fs.writeFileSync(path.join(output,'packaged-result.json'),JSON.stringify({success:false,error:error.stack}));console.error(error);process.exitCode=1;});
