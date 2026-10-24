const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('streaming capture flushes bounded continuous chunks and retains the partial tail',async()=>{
  const stream={getTracks:()=>[{stop(){}}],getAudioTracks:()=>[{readyState:'live',label:'Synthetic',addEventListener(){}}]};
  const h=harness(async()=>stream),chunks=[];
  h.recorder.chunkSeconds=60;h.recorder.maxDurationSeconds=7200;h.recorder.onChunk=buffer=>chunks.push(buffer);
  await h.recorder.start();h.samples(.1,125*16000);
  const result=await h.recorder.stop();
  assert.equal(chunks.length,2);assert.equal(chunks[0].byteLength,44+60*32000);
  assert.equal(result.durationSeconds,125);assert.equal(result.buffer.byteLength,44+5*32000);assert.equal(result.isTooShort,false);
  await h.recorder.dispose();
});

test('recording duration limit fires once and excludes samples beyond the bound',async()=>{
  const stream={getTracks:()=>[{stop(){}}],getAudioTracks:()=>[{readyState:'live',label:'Synthetic',addEventListener(){}}]};
  const h=harness(async()=>stream);let reached=0;h.recorder.maxDurationSeconds=2;h.recorder.onDurationLimit=()=>{reached++;};
  await h.recorder.start();h.samples(.1,3*16000);h.samples(.1,16000);await Promise.resolve();
  const result=await h.recorder.stop();assert.equal(reached,1);assert.equal(result.durationSeconds,2);
  await h.recorder.dispose();
});

function harness(getUserMedia) {
  let clock = 1000;
  const processors = [];
  const contexts = [];
  class Context {
    state = 'running';
    constructor() { contexts.push(this); }
    audioWorklet = { addModule: async () => {} };
    destination = {};
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createAnalyser() { return { connect() {}, disconnect() {}, frequencyBinCount: 32, getByteFrequencyData() {} }; }
    async resume() { this.state = 'running'; }
    async close() { this.state = 'closed'; }
  }
  class Worklet {
    id = null;
    tail = null;
    deferStart = false;
    port = { onmessage: null, postMessage: message => {
      this.id = message.id;
      queueMicrotask(() => {
        if (message.type === 'stop' && this.tail) {
          this.port.onmessage({data:{type:'chunk',id:message.id,samples:this.tail}});
          this.tail = null;
        }
        if (message.type === 'start' && this.deferStart) return;
        this.port.onmessage({data:{type:message.type==='start'?'started':'done',id:message.id}});
      });
    } };
    constructor() { processors.push(this); }
    connect() {}
    disconnect() {}
  }
  const exports = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '.compiled/audioRecorder.js'), 'utf8'), {
    exports, navigator: { mediaDevices: { getUserMedia } }, AudioContext: Context, AudioWorkletNode: Worklet, DOMException,
    setTimeout, clearTimeout, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    performance: { now: () => clock }, Float32Array, ArrayBuffer, DataView, Uint8Array, Math,
  });
  return {
    recorder: new exports.AudioRecorder(),
    contexts, processors,
    advance: ms => { clock += ms; },
    samples: (value, count=4096) => { const node=processors.at(-1); node.port.onmessage({data:{type:'chunk',id:node.id,samples:new Float32Array(count).fill(value)}}); },
    tail: (value, count) => { processors.at(-1).tail = new Float32Array(count).fill(value); },
  };
}
function stream() {
  const listeners = {};
  const track = { stopped: false, readyState: 'live', label: 'Laptop microphone', stop() { this.stopped = true; }, addEventListener(name, handler) { listeners[name] = handler; } };
  return { track, getTracks: () => [track], getAudioTracks: () => [track], disconnect() { track.readyState = 'ended'; listeners.ended?.(); } };
}

test('speech produces a valid padded WAV and releases the microphone', async () => {
  const mic = stream(); const h = harness(async () => mic);
  await h.recorder.start(); h.samples(0.1); h.advance(500);
  const result = await h.recorder.stop();
  assert.equal(result.isTooShort, false);
  assert.equal(result.buffer.byteLength, 32044);
  assert.equal(new DataView(result.buffer).getUint32(24, true), 16000);
  assert.equal(mic.track.stopped, true);
});

test('cancelling while microphone permission is pending closes the late stream', async () => {
  let resolve;
  const mic = stream(); const h = harness(() => new Promise(r => { resolve = r; }));
  const start = h.recorder.start();
  await h.recorder.stop(); resolve(mic);
  await assert.rejects(start, /cancelled/);
  assert.equal(mic.track.stopped, true);
  assert.equal((await h.recorder.stop()).buffer.byteLength, 0);
});

test('a late cancelled start cannot stop a subsequent recording', async () => {
  const requests = [], oldMic = stream(), newMic = stream();
  const h = harness(() => new Promise(resolve => requests.push(resolve)));
  const oldStart = h.recorder.start(); await h.recorder.stop();
  const newStart = h.recorder.start(); requests[1](newMic); await newStart;
  requests[0](oldMic); await assert.rejects(oldStart, /cancelled/);
  assert.equal(oldMic.track.stopped, true); assert.equal(newMic.track.stopped, false);
  h.samples(0.2); h.advance(500);
  assert.equal((await h.recorder.stop()).isTooShort, false);
});

test('muted audio produces no upload and stopping twice is safe', async () => {
  const mic = stream(); const h = harness(async () => mic);
  await h.recorder.start(); h.samples(0); h.advance(1000);
  assert.equal((await h.recorder.stop()).buffer.byteLength, 0);
  assert.equal((await h.recorder.stop()).buffer.byteLength, 0);
});

test('an unavailable headset falls back once to the Windows default microphone', async () => {
  const requests = [], mic = stream();
  const h = harness(async constraints => {
    requests.push(constraints.audio);
    if (requests.length === 1) throw new DOMException('Device disconnected', 'NotFoundError');
    return mic;
  });
  let label;
  h.recorder.onMicrophoneChange = value => { label = value; };
  await h.recorder.start('old-headset');
  assert.equal(requests[0].deviceId.exact, 'old-headset');
  assert.equal(requests[1].deviceId, undefined);
  assert.equal(label, 'Laptop microphone');
  h.samples(.2); h.advance(1000);
  assert.equal((await h.recorder.stop()).isTooShort, false);
});

test('communications routing is a preference and disconnected input is reported', async () => {
  const mic = stream(); let constraints; let ended = 0;
  const h = harness(async request => { constraints = request.audio; return mic; });
  h.recorder.onInputEnded = () => { ended++; };
  await h.recorder.start('communications');
  assert.equal(constraints.deviceId.ideal, 'communications');
  mic.disconnect(); assert.equal(ended, 1);
  await h.recorder.stop();
  mic.disconnect(); assert.equal(ended, 1);
});

test('permission denial does not trigger a second microphone request', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; throw new DOMException('Permission denied', 'NotAllowedError'); });
  await assert.rejects(h.recorder.start('headset'), /Permission denied/);
  assert.equal(calls, 1);
});

test('cancelling a failed headset request does not open a fallback microphone', async () => {
  let reject; let calls = 0;
  const h = harness(() => { calls++; return new Promise((resolve, failure) => { reject = failure; }); });
  const pending = h.recorder.start('headset');
  await h.recorder.stop();
  reject(new DOMException('Device gone', 'NotFoundError'));
  await assert.rejects(pending, /cancelled/); assert.equal(calls, 1);
});

test('preparing and reusing the audio engine never keeps microphone tracks open',async()=>{
  const microphones=[stream(),stream()]; let requests=0;
  const h=harness(async()=>microphones[requests++]);
  await h.recorder.prepare();
  assert.equal(requests,0,'Background preparation must not request the mic');
  for(let index=0;index<2;index++) {
    await h.recorder.start(); h.samples(.1); await h.recorder.stop();
    assert.equal(microphones[index].track.stopped,true);
  }
  assert.equal(h.contexts.length,1); assert.equal(h.processors.length,1);
  assert.equal(h.contexts[0].state,'running');
  await h.recorder.dispose(); assert.equal(h.contexts[0].state,'closed');
});

test('stop flushes the last partial audio chunk and uses captured sample duration',async()=>{
  const h=harness(async()=>stream());
  await h.recorder.start(); h.samples(.1,4480); h.tail(.5,128);
  const result=await h.recorder.stop();
  assert.equal(result.durationSeconds,4608/16000);
  assert.equal(new DataView(result.buffer).getInt16(44+4480*2,true),Math.trunc(.5*32767));
});

test('start readiness waits for the audio thread acknowledgment',async()=>{
  const h=harness(async()=>stream()); await h.recorder.prepare();
  const node=h.processors[0]; node.deferStart=true;
  let ready=false;
  const starting=h.recorder.start().then(()=>{ready=true;});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ready,false);
  node.port.onmessage({data:{type:'started',id:node.id}});
  await starting; assert.equal(ready,true); await h.recorder.stop();
});

test('worklet emits 40 ms packets, flushes the tail, isolates sessions and outputs silence',()=>{
  const messages=[]; let Processor;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/renderer/public/recorderWorklet.js'),'utf8'),{
    AudioWorkletProcessor:class{port={postMessage:message=>messages.push(message)};},
    registerProcessor:(_name,value)=>{Processor=value;},Float32Array,
  });
  const worklet=new Processor();
  const output=new Float32Array(128).fill(.7);
  worklet.process([[new Float32Array(128).fill(.2)]],[[output]]);
  assert.equal(messages.length,0); assert.ok(output.every(value=>value===0));
  worklet.port.onmessage({data:{type:'start',id:1}});
  for(let i=0;i<6;i++)worklet.process([[new Float32Array(128).fill(.2)]],[[output]]);
  worklet.port.onmessage({data:{type:'stop',id:1}});
  assert.deepEqual(messages.filter(m=>m.type==='chunk').map(m=>m.samples.length),[640,128]);
  assert.equal(messages.at(-1).type,'done');
  worklet.port.onmessage({data:{type:'start',id:2}});
  worklet.port.onmessage({data:{type:'stop',id:1}});
  for(let i=0;i<5;i++)worklet.process([[new Float32Array(128).fill(.3)]],[[output]]);
  assert.equal(messages.at(-1).id,2);
  assert.equal(messages.at(-1).samples.length,640);
});
