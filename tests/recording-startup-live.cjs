// Compare recorder startup with the installed baseline. PCM stays transient and is discarded.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const output=path.join(__dirname,'.runtime');
app.setPath('userData',path.join(output,'startup-audio-profile'));
app.whenReady().then(async()=>{
  const window=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required'}});
  window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(true));
  const page=path.join(output,'startup-audio.html');
  fs.writeFileSync(page,'<!doctype html><title>Owlio local audio startup measurement</title>');
  await window.loadFile(page);
  const baseline=fs.readFileSync(path.join(output,'installed-baseline-recorder.js'),'utf8');
  const source=fs.readFileSync(path.join(__dirname,'.compiled/audioRecorder.js'),'utf8');
  const workletUrl=pathToFileURL(path.join(root,'dist/renderer/recorderWorklet.js')).href;
  const result=await window.webContents.executeJavaScript(`(async()=>{
    ${baseline}
    const exports={};
    ${source}
    const tracks=[];
    const acquire=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    let requests=0;
    navigator.mediaDevices.getUserMedia=async options=>{requests++;const stream=await acquire(options);tracks.push(...stream.getTracks());return stream;};
    const recorder=new exports.AudioRecorder(${JSON.stringify(workletUrl)});
    const prepareStarted=performance.now();
    await recorder.prepare();
    const preparationMs=performance.now()-prepareStarted;
    if(requests)throw Error('Preparing the engine accessed the microphone');
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const results=[];
    for(let round=0;round<3;round++){
      for(const kind of round%2?['worklet','installed']:['installed','worklet']){
        const current=kind==='worklet'?recorder:new BaselineRecorder();
        let firstChunkMs=null,timing;
        const started=performance.now();
        if(kind==='worklet')current.onStartupTiming=value=>{timing=value;if(value.firstChunkMs!==undefined)firstChunkMs=value.firstChunkMs;};
        await current.start('default');
        const captureReadyMs=performance.now()-started;
        if(kind==='installed'){
          const receive=current.scriptProcessor.onaudioprocess;
          current.scriptProcessor.onaudioprocess=event=>{if(firstChunkMs===null)firstChunkMs=performance.now()-started;receive(event);};
        }
        const end=performance.now()+2500;
        while(firstChunkMs===null&&performance.now()<end)await wait(5);
        await wait(300);
        await current.stop();
        if(tracks.some(track=>track.readyState!=='ended'))throw Error('Microphone stayed open between recordings');
        if(firstChunkMs===null)throw Error('Audio engine produced no chunks');
        results.push({kind,round,captureReadyMs:Math.round(captureReadyMs),firstChunkMs:Math.round(firstChunkMs),...(timing?{engineReadyMs:Math.round(timing.engineReadyMs),microphoneReadyMs:Math.round(timing.microphoneReadyMs)}:{})});
      }
    }
    await recorder.dispose();
    return {preparationMs:Math.round(preparationMs),preparationMicRequests:0,microphoneReleased:true,samplesSaved:false,samplesUploaded:false,results};
  })()`);
  assert.equal(result.results.length,6);
  assert.equal(result.microphoneReleased,true);
  fs.writeFileSync(path.join(output,'recording-startup-result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
  window.destroy();app.quit();
}).catch(error=>{console.error('Startup measurement failed:',error.message);app.exit(1);});
