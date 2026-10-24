const test = require('node:test');
const assert = require('node:assert/strict');
const {WindowsStartup} = require('../dist/main/windowsStartup');
const path = require('node:path');
const name = 'com.owlio.desktop';
function fixture({packaged=true, platform='win32', approved=false, registered=false, executable='Owlio.exe'}={}) {
  const writes=[];
  const state={openAtLogin:registered, executableWillLaunchAtLogin:registered&&approved, launchItems:registered?[{name,scope:'user',enabled:approved}]:[]};
  const host={isPackaged:packaged,getPath:()=>path.join(process.cwd(),executable),
    getLoginItemSettings(options){assert.equal(options.path,host.getPath());assert.deepEqual(options.args,['--startup']);return structuredClone(state);},
    setLoginItemSettings(options){writes.push(options);state.openAtLogin=options.openAtLogin;state.executableWillLaunchAtLogin=options.openAtLogin&&options.enabled;state.launchItems=options.openAtLogin?[{name,scope:'user',enabled:options.enabled}]:[];}};
  return {host,state,writes,startup:new WindowsStartup(host,platform)};
}
test('startup requires the packaged Owlio Windows executable; reading never registers it',()=>{
  for(const options of [{packaged:false},{platform:'darwin'},{executable:'electron.exe'}]){
    const {startup,writes}=fixture(options);assert.equal(startup.status().supported,false);
    assert.throws(()=>startup.save(true,()=>{}),/Install Owlio/);assert.equal(writes.length,0);
  }
  const {startup,writes}=fixture();assert.deepEqual(startup.status(),{supported:true,enabled:false});assert.equal(writes.length,0);
});
test('startup enable/disable verifies OS state and commits only after success',()=>{
  const {startup,writes}=fixture();let saved=false;
  assert.equal(startup.save(true,()=>{saved=true;return 'saved';}),'saved');assert.equal(saved,true);
  assert.equal(startup.status().enabled,true);assert.equal(writes[0].name,name);assert.deepEqual(writes[0].args,['--startup']);
  startup.save(false,()=>{});assert.equal(startup.status().enabled,false);
});
test('Windows disabling startup overrides stale profile data without being re-enabled',()=>{
  const {startup,writes}=fixture({registered:true,approved:false});
  assert.equal(startup.settings({startWithWindows:true,other:'keep'}).startWithWindows,false);
  startup.save(undefined,()=>{});assert.equal(writes.length,0);
  startup.save(true,()=>{});assert.equal(startup.status().enabled,true);
});
test('failed profile writes restore a previously disabled Windows entry',()=>{
  const {startup,state}=fixture({registered:true,approved:false});
  assert.throws(()=>startup.save(true,()=>{throw Error('disk full');}),/disk full/);
  assert.equal(state.openAtLogin,true);assert.equal(state.launchItems[0].enabled,false);
});
test('Windows refusing a startup change cannot save a successful-looking preference',()=>{
  const {startup,host}=fixture();let committed=false;host.setLoginItemSettings=()=>{};
  assert.throws(()=>startup.save(true,()=>{committed=true;}),/Windows did not apply/);assert.equal(committed,false);
});
test('startup read errors are exposed and do not overwrite saved settings',()=>{
  const {startup,host}=fixture();host.getLoginItemSettings=()=>{throw Error('denied');};
  assert.match(startup.status().error,/Could not read/);assert.equal(startup.settings({startWithWindows:true}).startWithWindows,true);
  assert.throws(()=>startup.save(true,()=>{}),/denied/);
});
