const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { accountAccessError } = require('../dist/shared/accountAccess');
const { TERMS_VERSION, PRIVACY_VERSION, POLICY_HASH, TERMS_DOCUMENT, PRIVACY_DOCUMENT, ACCESS_CACHE_MS } = require('../dist/shared/legal');

const authorized = () => ({ configured: true, user: { id: 'member' }, signingIn: false, access: {
  blocked: false, checkedAt: Date.now(), termsAccepted: true, termsVersion: TERMS_VERSION, privacyVersion: PRIVACY_VERSION, policyHash: POLICY_HASH
} });
test('only a signed-in, unsuspended account accepting the exact policy bundle can use the app', () => {
  assert.match(accountAccessError(null), /unavailable/);
  assert.match(accountAccessError({configured:true,user:null}), /Sign in/);
  const status=authorized();assert.equal(accountAccessError(status),undefined);
  status.access.blocked=true;assert.match(accountAccessError(status),/suspended/);
  status.access.blocked=false;
  for(const field of ['termsVersion','privacyVersion','policyHash']) {
    const invalid=structuredClone(status);invalid.access[field]='different';assert.match(accountAccessError(invalid),/Accept the current/);
  }
  status.access.termsAccepted=false;assert.match(accountAccessError(status),/Accept the current/);
  status.access=undefined;assert.match(accountAccessError(status),/internet/);
});
test('offline use requires a matching, unexpired server-verified cache; a missing or future timestamp is denied', () => {
  const status=authorized();status.access.offline=true;const now=Date.now();
  status.access.checkedAt=now-ACCESS_CACHE_MS+1;assert.equal(accountAccessError(status,now),undefined);
  status.access.checkedAt=now-ACCESS_CACHE_MS-1;assert.match(accountAccessError(status,now),/internet/);
  for(const timestamp of [undefined,NaN,Infinity,now+120000]){status.access.checkedAt=timestamp;assert.match(accountAccessError(status,now),/internet/);}
});
test('in-app release documents, published copies and database policy share one immutable fingerprint', () => {
  const hash=createHash('sha256').update(JSON.stringify([TERMS_DOCUMENT,PRIVACY_DOCUMENT])).digest('hex');
  assert.equal(hash,POLICY_HASH);
  for(const file of ['terms-of-use.md','privacy-notice.md']) assert.ok(fs.readFileSync(require('node:path').join(__dirname,'../docs/legal',file),'utf8').includes(hash));
  const migrations=fs.readdirSync(require('node:path').join(__dirname,'../supabase/migrations'));
  const policy=migrations.find(file=>file.endsWith('_publish_free_access_terms.sql'));
  assert.ok(fs.readFileSync(require('node:path').join(__dirname,'../supabase/migrations',policy),'utf8').includes(hash));
});

test('main-process gate starts required reporting only after acceptance and cancels access on sign-out or cache expiry', async t => {
  const { EventEmitter }=require('node:events'), path=require('node:path'), vm=require('node:vm');
  const temporary=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'owlio-required-access-'));
  t.after(()=>fs.rmSync(temporary,{recursive:true,force:true}));
  const handlers=new Map(), timers=[];let account,analytics,requests=0,lost=0;
  class FakeAccount extends EventEmitter {
    constructor(){super();account=this;this.state={configured:true,user:null,signingIn:false};}
    status(){return structuredClone(this.state);}
    initialize(){return Promise.resolve();}
    set(state){this.state=state;this.emit('changed',this.status());}
    dispose(){}
  }
  class Reporting extends (require('../dist/main/analyticsService').AnalyticsService) {
    constructor(...args){super(...args,async()=>{requests++;return {ok:true};});analytics=this;}
  }
  const electron={app:{isReady:()=>true,getPath:()=>temporary,getVersion:()=>'1.0.16'},safeStorage:{},shell:{},ipcMain:{handle:(name,callback)=>handlers.set(name,callback)},BrowserWindow:{getAllWindows:()=>[]}};
  const replacements={electron,'./accountService':{AccountService:FakeAccount},'./analyticsService':{AnalyticsService:Reporting},'./cloudConfig':{loadCloudConfig:()=>({supabaseUrl:'https://example.supabase.co',publishableKey:'sb_publishable_test_public_key'})}};
  const runtime={},dir=path.join(__dirname,'../dist/main');
  vm.runInNewContext(fs.readFileSync(path.join(dir,'cloudRuntime.js'),'utf8'),{
    exports:runtime,__dirname:dir,URL,console,
    require:name=>replacements[name]||(name.startsWith('.')?require(path.join(dir,name)):require(name)),
    setInterval:callback=>{timers.push(callback);return {unref(){}};},clearInterval(){}
  });
  runtime.startCloudServices(()=>{lost++;});t.after(()=>runtime.stopCloudServices());
  assert.throws(()=>runtime.requireAccountAccess(),/Sign in/);assert.equal(requests,0);
  const status=authorized();status.access.termsAccepted=false;account.set(status);
  runtime.captureMetric('app_opened');assert.equal(analytics.status().queued,0);assert.throws(()=>runtime.requireAccountAccess(),/Accept the current/);
  status.access.termsAccepted=true;account.set(status);runtime.requireAccountAccess();assert.equal(analytics.status().enabled,true);
  await new Promise(resolve=>setImmediate(resolve));assert.ok(requests>0);
  const frame={url:require('node:url').pathToFileURL(path.resolve(dir,'../renderer/index.html')).href};
  assert.throws(()=>handlers.get('analytics-consent')({senderFrame:frame,sender:{mainFrame:frame}},false),/required/);
  account.set({configured:true,user:null,signingIn:false});assert.equal(lost,1);assert.equal(analytics.status().enabled,false);assert.equal(analytics.status().queued,0);
  const count=requests;runtime.captureMetric('app_opened');await analytics.flush();assert.equal(requests,count);assert.throws(()=>runtime.requireAccountAccess(),/Sign in/);
  account.set(authorized());account.state.access.checkedAt=Date.now()-ACCESS_CACHE_MS-1;
  assert.throws(()=>runtime.requireAccountAccess(),/internet/);timers[0]();assert.equal(lost,2);assert.equal(analytics.status().enabled,false);
});
