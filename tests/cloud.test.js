const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { AnalyticsService } = require('../dist/main/analyticsService');
const { SecureSessionStorage } = require('../dist/main/secureSessionStorage');
const { AccountService } = require('../dist/main/accountService');
const { validateCloudConfig } = require('../dist/main/cloudConfig');
const { metricProperties, metricModel } = require('../dist/shared/telemetry');
const { SPEECH_LANGUAGE_CODES } = require('../dist/shared/speechLanguages');
const { TERMS_VERSION, PRIVACY_VERSION, POLICY_HASH } = require('../dist/shared/legal');
const { accountAccessError } = require('../dist/shared/accountAccess');
const config = { supabaseUrl: 'https://example.supabase.co', publishableKey: 'sb_publishable_example_public_test_key' };
const temporary = t => { const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'owlio-cloud-')); t.after(() => fs.rmSync(folder, {recursive:true,force:true})); return folder; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function encrypted(file) {
  const key = crypto.randomBytes(32);
  return new SecureSessionStorage(file, {
    isEncryptionAvailable: () => true,
    encryptString: text => { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key, iv); const payload = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), payload]); },
    decryptString: buffer => { const decipher = crypto.createDecipheriv('aes-256-gcm', key, buffer.subarray(0,12)); decipher.setAuthTag(buffer.subarray(12,28)); return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString(); },
  });
}

test('Edge credentials prefer injected secret keys and support older runtimes without client exposure', async () => {
  const {serverKey}=await import('../supabase/functions/_shared/server-key.mjs');
  const env={SUPABASE_SECRET_KEYS:JSON.stringify({default:'sb_secret_server_only'}),SUPABASE_SERVICE_ROLE_KEY:'legacy'.repeat(12)};
  assert.equal(serverKey(key=>env[key]),'sb_secret_server_only');
  env.SUPABASE_SECRET_KEYS='invalid-json';assert.equal(serverKey(key=>env[key]),env.SUPABASE_SERVICE_ROLE_KEY);
  assert.throws(()=>serverKey(()=>undefined),/unavailable/);
});

test('cloud config accepts only HTTPS origins and public keys', () => {
  assert.deepEqual(validateCloudConfig(config), config);
  for (const supabaseUrl of ['http://example.test', 'https://example.test/path', 'https://user:pass@example.test', 'https://example.test/?x=1']) assert.throws(() => validateCloudConfig({...config,supabaseUrl}));
  const service = 'x.' + Buffer.from(JSON.stringify({role:'service_role'})).toString('base64url') + '.x';
  assert.throws(() => validateCloudConfig({...config,publishableKey:service}));
  assert.throws(() => validateCloudConfig({...config,publishableKey:'sb_secret_not_for_apps'}));
  assert.throws(() => validateCloudConfig({...config,password:'never-package-private-values'}));
});
test('credentials are encrypted at rest and plaintext fallback is refused', t => {
  const file = path.join(temporary(t),'session.bin'), storage = encrypted(file);
  storage.setItem('session', 'private-refresh-token'); assert.equal(storage.getItem('session'),'private-refresh-token');
  assert.ok(!fs.readFileSync(file).includes('private-refresh-token'));
  storage.removeItem('session'); assert.equal(storage.getItem('session'),null);
  assert.throws(() => new SecureSessionStorage(file, {isEncryptionAvailable:()=>false}).setItem('secret','x'), /encryption is unavailable/);
});
test('client and ingress reject content-bearing or unbounded analytics properties', async () => {
  const { validateUsageBatch } = await import('../supabase/functions/_shared/usage-schema.mjs');
  assert.deepEqual(metricProperties({text:'private words', email:'private@example.test', selectedText:'secret', duration_ms:Infinity, model:'private/repo'}), {});
  assert.equal(metricModel('hf:Oriserve/Whisper-Hindi2Hinglish-Apex'),'hinglish-transformers');
  const body = {installationId:crypto.randomUUID(),token:'a'.repeat(64),events:[{id:crypto.randomUUID(),event:'dictation_completed',timestamp:new Date().toISOString(),properties:{}}]};
  for (const language of SPEECH_LANGUAGE_CODES) {
    body.events[0].properties = metricProperties({language}); assert.equal(validateUsageBatch(body),body);
  }
  for (const properties of [{text:'private'}, {language:'hello world'}, {duration_ms:Infinity}, {words:-1}, {model:'private/repo'}, {is_rewrite:'yes'}, {__unknown:'x'}]) {
    body.events[0].properties=properties; assert.throws(() => validateUsageBatch(body));
  }
  body.events[0].properties={}; body.events[0].timestamp=new Date(Date.now()-8*86400000).toISOString(); assert.throws(() => validateUsageBatch(body));
});
test('reporting starts only after account authorization, queues offline, sanitizes payloads and rotates identity on sign-out', async t => {
  const file=path.join(temporary(t),'metrics.json'), requests=[];
  let online=false;
  const analytics=new AnalyticsService(file,config,'1.0.14',async (_url,init)=>{requests.push(JSON.parse(init.body));if(!online)throw Error('offline');return {ok:true};});
  t.after(()=>analytics.dispose());
  analytics.capture('dictation_completed',{text:'private words'}); await analytics.flush(); assert.equal(requests.length,0);
  analytics.setAccessAllowed(true); analytics.setEnabled(true); await tick(); assert.equal(analytics.status().enabled,true); assert.equal(analytics.status().queued,2);
  analytics.capture('dictation_completed',{text:'private words', email:'private@example.test', model:'private/repo',words:10});
  online=true; await analytics.flush(); assert.equal(analytics.status().queued,0);
  assert.ok(!JSON.stringify(requests).includes('private')); assert.equal(requests.at(-1).events.at(-1).properties.model,'custom');
  const oldId=requests[0].installationId;
  analytics.setEnabled(false); assert.equal(analytics.status().queued,0);
  analytics.setAccessAllowed(true); analytics.setEnabled(true); await tick(); assert.notEqual(requests.at(-1).installationId,oldId);
  analytics.setEnabled(false); const count=requests.length; analytics.capture('app_opened'); await analytics.flush(); assert.equal(requests.length,count);
});
test('turning off reporting aborts an in-flight batch; late success cannot restore it', async t => {
  let finish, signal;
  const analytics=new AnalyticsService(path.join(temporary(t),'metrics.json'),config,'1.0.14',async(_url,init)=>{signal=init.signal;return await new Promise(resolve=>{finish=resolve;});});
  t.after(()=>analytics.dispose());
  analytics.setAccessAllowed(true); analytics.setEnabled(true); assert.equal(signal.aborted,false); analytics.setEnabled(false); assert.equal(signal.aborted,true);
  finish({ok:true}); await tick(); assert.equal(analytics.status().queued,0); assert.equal(analytics.status().lastSentAt,undefined);
});
test('offline queue is bounded and an unconfigured build never starts reporting', t => {
  const folder=temporary(t), analytics=new AnalyticsService(path.join(folder,'off.json'),undefined,'1.0.14',()=>{throw Error('unexpected network');});
  assert.throws(()=>analytics.setEnabled(true),/not configured/); analytics.start(); analytics.dispose();
  const offline=new AnalyticsService(path.join(folder,'on.json'),config,'1.0.14',async()=>{throw Error('offline');});
  offline.setAccessAllowed(true); offline.setEnabled(true); for(let i=0;i<230;i++)offline.capture('app_opened'); assert.equal(offline.status().queued,200); offline.dispose();
});

function mockAuth(accessToken) {
  const clients=[];
  const factory=(_url,_key,options)=>{
    let callback;
    const user={id:crypto.randomUUID(),email:'member@example.test'};
    const client={options,user,blocked:false,rpcError:false,accepted:false,
      rpc:async (name,args)=> {
        if(name==='owlio_account_access')return {data:{blocked:client.blocked,reason:client.blocked?'Contact owner':'',termsAccepted:client.accepted,termsVersion:TERMS_VERSION,privacyVersion:PRIVACY_VERSION,policyHash:POLICY_HASH,acceptedAt:client.accepted?'2026-10-23T09:00:00Z':null},error:client.rpcError?{message:'offline'}:null};
        if(name==='owlio_accept_terms'){client.acceptArgs=args;if(client.rpcError||client.blocked)return {error:{message:'denied'}};client.accepted=true;return {error:null};}
        return {data:null,error:{message:'denied'}};
      },
      auth:{
        onAuthStateChange:handler=>{callback=handler;return {data:{subscription:{unsubscribe:()=>{}}}};},
        getSession:async()=>({data:{session:null},error:null}),
        signInWithOtp:async args=>{client.email=args.email;client.emailRedirect=args.options.emailRedirectTo;return {error:null};},
        verifyOtp:async()=>{options.auth.storage.setItem('session','secret-session-token');callback('SIGNED_IN',{user,access_token:accessToken});return {error:null};},
        signInWithOAuth:async args=>{client.redirect=args.options.redirectTo;return {data:{url:config.supabaseUrl+'/auth/v1/authorize?provider=google'},error:null};},
        exchangeCodeForSession:async()=>{options.auth.storage.setItem('session','secret-session-token');callback('SIGNED_IN',{user,access_token:accessToken});return {error:null};},
        signOut:async()=>({error:null}),stopAutoRefresh:async()=>{},
      }};
    clients.push(client);return client;
  };
  return {factory,clients};
}
test('email sign-in, owner-only RPC errors, suspension cache and offline sign-out', async t => {
  const storage=encrypted(path.join(temporary(t),'session.bin')), mock=mockAuth();
  const account=new AccountService(config,storage,async()=>{},mock.factory);t.after(()=>account.dispose());await account.initialize();
  await assert.rejects(account.verifyEmailCode('broken','123456'),/valid email/);
  await account.sendEmailCode('member@example.test'); await account.verifyEmailCode('member@example.test','123456'); await tick();
  assert.equal(account.status().user.email,'member@example.test');assert.ok(!JSON.stringify(account.status()).includes('session-token'));
  await assert.rejects(account.adminMetrics(30),/owner-authorized/);
  mock.clients[0].blocked=true; await account.refreshAccess();assert.equal(account.status().access.blocked,true);
  mock.clients[0].rpcError=true;await account.refreshAccess();assert.equal(account.status().access.blocked,true);assert.equal(account.status().access.offline,true);
  assert.ok(storage.getItem('owlio-account-access').includes('Contact owner'));
  await account.signOut();assert.equal(account.status().user,null);assert.equal(account.status().access,undefined);assert.equal(storage.getItem('session'),null);
});
test('sign-out clears local credentials immediately and revokes only the current remote session without waiting', async t => {
  const mock=mockAuth('private-access-token'),storage=encrypted(path.join(temporary(t),'session.bin'));let request;
  const account=new AccountService(config,storage,async()=>{},mock.factory,async(url,init)=>{request={url,init};return new Promise(()=>{});});
  t.after(()=>account.dispose());await account.initialize();await account.verifyEmailCode('member@example.test','123456');await tick();
  assert.ok(!JSON.stringify(account.status()).includes('private-access-token'));
  await account.signOut();assert.equal(account.status().user,null);assert.equal(storage.getItem('session'),null);
  assert.equal(request.url,config.supabaseUrl+'/auth/v1/logout?scope=local');assert.equal(request.init.headers.Authorization,'Bearer private-access-token');assert.ok(request.init.signal);
});

test('email verification cannot overlap Google or another code check, and sign-out rejects its late session', async t => {
  const mock=mockAuth(),storage=encrypted(path.join(temporary(t),'session.bin'));
  const account=new AccountService(config,storage,async()=>{},mock.factory);t.after(()=>account.dispose());await account.initialize();
  const client=mock.clients[0],original=client.auth.verifyOtp;let finish;
  client.auth.verifyOtp=async()=>{await new Promise(resolve=>{finish=resolve;});return original();};
  const pending=account.verifyEmailCode('member@example.test','123456');
  await assert.rejects(account.signInGoogle(),/already in progress/);
  await assert.rejects(account.verifyEmailCode('member@example.test','123456'),/current sign-in/);
  await account.signOut();finish();await pending;
  assert.equal(account.status().user,null);assert.equal(storage.getItem('session'),null);
});

test('default email magic links use the same PKCE loopback exchange and cannot overlap Google', async t => {
  const mock=mockAuth(),storage=encrypted(path.join(temporary(t),'session.bin'));
  const account=new AccountService(config,storage,async()=>{},mock.factory);t.after(()=>account.dispose());await account.initialize();
  await account.sendEmailCode('member@example.test');const client=mock.clients[0];
  assert.equal(account.status().emailLinkPending,true);assert.match(client.emailRedirect,/^http:\/\/127\.0\.0\.1:17865\/auth\/callback\/[0-9a-f]{48}$/);
  await assert.rejects(account.signInGoogle(),/already in progress/);
  await assert.rejects(account.sendEmailCode('other@example.test'),/current sign-in/);
  const response=await fetch(client.emailRedirect+'?code=synthetic-email-auth-code');assert.equal(response.status,200);await tick();
  assert.equal(account.status().user.email,'member@example.test');assert.equal(account.status().emailLinkPending,false);
  await account.signOut();await account.sendEmailCode('member@example.test');account.cancelSignIn();
  assert.equal(account.status().emailLinkPending,false);assert.equal(storage.getItem('session'),null);
});

test('Google uses a nonce loopback callback and cancellation invalidates late credential writes', async t => {
  const mock=mockAuth(),storage=encrypted(path.join(temporary(t),'session.bin'));let opened;
  const account=new AccountService(config,storage,async url=>{opened=url;},mock.factory);t.after(()=>account.dispose());await account.initialize();
  await account.signInGoogle(); assert.match(opened,/\/auth\/v1\/authorize/);
  const client=mock.clients[0];assert.match(client.redirect,/^http:\/\/127\.0\.0\.1:17865\/auth\/callback\/[0-9a-f]{48}$/);
  const wrong=await fetch('http://127.0.0.1:17865/auth/callback/wrong?code=x');assert.equal(wrong.status,404);
  const response=await fetch(client.redirect+'?code=temporary-code');assert.equal(response.status,200);await tick();assert.equal(account.status().user.email,'member@example.test');
  await account.signOut();await account.signInGoogle();const cancelled=mock.clients.at(-1);account.cancelSignIn();
  cancelled.options.auth.storage.setItem('session','late-secret');assert.equal(storage.getItem('session'),null);assert.equal(account.status().user,null);
});


test('acceptance requires an explicit confirmation and signed-in identity; account changes invalidate late acceptance', async t => {
  const mock=mockAuth(),storage=encrypted(path.join(temporary(t),'session.bin'));
  const account=new AccountService(config,storage,async()=>{},mock.factory);t.after(()=>account.dispose());await account.initialize();
  await assert.rejects(account.acceptTerms(true,'1.0.16'),/Sign in/);
  await account.verifyEmailCode('member@example.test','123456');await tick();
  assert.match(accountAccessError(account.status()),/Accept the current/);
  await assert.rejects(account.acceptTerms(false,'1.0.16'),/Accept the Terms/);
  const accepted=await account.acceptTerms(true,'1.0.16');assert.equal(accountAccessError(accepted),undefined);
  assert.deepEqual(mock.clients[0].acceptArgs,{terms_version:TERMS_VERSION,privacy_version:PRIVACY_VERSION,document_hash:POLICY_HASH,app_version:'1.0.16'});
  assert.equal(JSON.parse(storage.getItem('owlio-account-access')).termsAccepted,true);
  mock.clients[0].rpcError=true;await account.refreshAccess();assert.equal(accountAccessError(account.status()),undefined);
  let finish;mock.clients[0].rpc=async()=>{await new Promise(resolve=>{finish=resolve;});return {error:null};};
  const pending=account.acceptTerms(true,'1.0.16');await account.signOut();finish();await assert.rejects(pending,/Account changed/);
  assert.equal(account.status().user,null);
});

test('a saved reporting flag cannot send or queue events before current account authorization', async t => {
  const file=path.join(temporary(t),'metrics.json');let requests=0;
  const first=new AnalyticsService(file,config,'1.0.16',async()=>{requests++;return {ok:true};});
  first.setAccessAllowed(true);first.setEnabled(true);await tick();first.dispose();const sent=requests;
  const restored=new AnalyticsService(file,config,'1.0.16',async()=>{requests++;return {ok:true};});t.after(()=>restored.dispose());
  restored.start();restored.capture('dictation_completed');await restored.flush();assert.equal(requests,sent);assert.equal(restored.status().enabled,false);
  restored.setAccessAllowed(true);restored.capture('app_opened');await restored.flush();assert.ok(requests>sent);
  restored.setAccessAllowed(false);const stopped=requests;restored.capture('app_opened');await restored.flush();assert.equal(requests,stopped);assert.equal(restored.status().queued,0);
});
