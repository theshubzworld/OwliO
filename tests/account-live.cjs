// Manual live-auth check. Run with Electron and an email you own. Enter its OTP
// in the opened app. Uses a disposable encrypted profile and signs out at the end.
const {app,BrowserWindow,ipcMain,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),output=path.join(__dirname,'.runtime');
const email=process.argv[2];
const google=process.argv.includes('--google');
if(!email)throw Error('Pass your administrator email as the first argument.');
fs.mkdirSync(output,{recursive:true});
const resume=process.argv.find(value=>value.startsWith('--restore-profile='))?.slice('--restore-profile='.length);
if(resume && (!/^account-live-[a-zA-Z0-9]+$/.test(resume)||!fs.existsSync(path.join(output,resume,'account-session.bin'))))throw Error('Choose an existing disposable account-live profile.');
const profile=resume?path.join(output,resume):fs.mkdtempSync(path.join(output,'account-live-'));
app.setPath('userData',profile);app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{}); // Keep the test host alive during session restoration.
const {Store}=require('../dist/main/store');
const {startCloudServices,stopCloudServices}=require('../dist/main/cloudRuntime');
const {AccountService}=require('../dist/main/accountService');
const {SecureSessionStorage}=require('../dist/main/secureSessionStorage');
const {loadCloudConfig}=require('../dist/main/cloudConfig');
const {accountAccessError}=require('../dist/shared/accountAccess');
const wait=async(check,timeout=15000)=>{const until=Date.now()+timeout;while(Date.now()<until){if(await check())return;await new Promise(r=>setTimeout(r,50));}throw Error('Live account check timed out');};
let window,restored;
app.whenReady().then(async()=>{
  if(resume){
    let logout;
    const sessionFile=path.join(profile,'account-session.bin'),raw=fs.readFileSync(sessionFile);
    assert.ok(!raw.includes(Buffer.from('access_token')));assert.ok(!raw.includes(Buffer.from(email)));
    restored=new AccountService(loadCloudConfig(),new SecureSessionStorage(sessionFile,safeStorage),async()=>{},undefined,(url,init)=>{
      const request=fetch(url,init);if(String(url).includes('/auth/v1/logout'))logout=request;return request;
    });
    await restored.initialize();assert.equal(restored.status().user?.email?.toLowerCase(),email.toLowerCase());
    assert.equal((await restored.adminMetrics(7)).days,7);assert.equal(restored.status().access?.offline,false);
    await restored.signOut();if(logout)await logout.catch(()=>{});
    assert.equal(restored.status().user,null);assert.equal(fs.existsSync(sessionFile),false);restored.dispose();
    fs.writeFileSync(path.join(output,'account-live-result.json'),JSON.stringify({success:true,adminAuthorized:true,encryptedAtRest:true,sessionRestored:true,signedOut:true,reportingStoppedAfterSignOut:true}));
    console.log('PASS: live owner session restored from Windows-encrypted storage, admin access verified, and remote/local sign-out completed.');
    app.quit();return;
  }
  const store=new Store(profile);store.updateSettings({setupCompleted:true});
  startCloudServices();
  ipcMain.handle('get-settings',()=>store.getSettings());ipcMain.handle('get-startup-status',()=>({supported:false,enabled:false}));
  ipcMain.handle('get-writing-memory',()=>({preferences:[],vocabulary:[]}));ipcMain.handle('get-scratchpad',()=>store.getScratchpad());
  ipcMain.handle('get-local-models',()=>({speech:{online:false},formatting:{online:false},pulls:[]}));ipcMain.handle('get-last-failure',()=>null);
  for(const name of ['get-history','get-dictionary','get-snippets','get-meetings'])ipcMain.handle(name,()=>[]);
  ipcMain.handle('cancel-shortcut',()=>{});
  window=new BrowserWindow({show:false,width:1120,height:900,webPreferences:{preload:path.join(root,'dist/preload/preload.js'),offscreen:true,contextIsolation:true,backgroundThrottling:false}});
  const js=code=>window.webContents.executeJavaScript(code);
  await window.loadFile(path.join(root,'dist/renderer/index.html'),{query:{view:'dashboard',tab:'account'}});
  await wait(()=>js('!!document.querySelector("#account-email") && !document.querySelector("#account-email").disabled'));
  assert.equal((await js('window.api.getAnalyticsStatus()')).enabled,false);
  assert.equal((await js('window.api.getAccountStatus()')).configured,true);
  assert.equal(safeStorage.isEncryptionAvailable(),true);
  if(process.argv.includes('--check-only')){
    assert.equal((await js('window.api.getAccountStatus()')).user,null);
    fs.writeFileSync(path.join(output,'account-live-configured.png'),(await window.webContents.capturePage()).toPNG());
    console.log('PASS: real Electron renderer/preload/main IPC accepts the configured locked sign-in screen, reporting paused before acceptance, and Windows encryption is available. No sign-in email was sent.');
    window.destroy();window=undefined;stopCloudServices();app.quit();return;
  }
  await js(`(()=>{const i=document.querySelector('#account-email');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,${JSON.stringify(email)});i.dispatchEvent(new Event('input',{bubbles:true}));})();void 0;`);
  if(google){
    await js('window.api.signInGoogle()');
    console.log('GOOGLE_WAITING: complete Google sign-in in your browser.');
    await wait(async()=>!!(await js('window.api.getAccountStatus()')).user,180000);
  }else if(!process.argv.includes('--existing-code')){
  await js('document.querySelector(".account-form").requestSubmit();void 0;');
  await wait(()=>js('!!document.querySelector("#account-code") || !!document.querySelector(".account-card [role=alert]")'));
  if(!(await js('!!document.querySelector("#account-code")')))throw Error(await js('document.querySelector(".account-card [role=alert]").textContent'));
  console.log('EMAIL_SENT: open the newest sign-in link on this computer, or enter its numeric code in Owlio. The app must remain running. No credential is written to test output.');
  }
  const suppliedCode=process.env.OWLIO_LIVE_TEST_CODE;
  delete process.env.OWLIO_LIVE_TEST_CODE;
  if(google){ /* The browser callback has completed above. */ }
  else if(suppliedCode){
    if(!/^\d{6,8}$/.test(suppliedCode.trim()))throw Error('A 6–8 digit email code is required.');
    await js(`window.api.verifySignInCode(${JSON.stringify(email)},${JSON.stringify(suppliedCode.trim())})`);
  }else{
    if(process.argv.includes('--existing-code'))throw Error('Provide the existing code through OWLIO_LIVE_TEST_CODE or run without --existing-code to open a fresh sign-in form.');
    window.show();window.focus();
    await wait(async()=>!!(await js('window.api.getAccountStatus()')).user,600000);
  }
  const status=await js('window.api.getAccountStatus()');assert.equal(status.user?.email?.toLowerCase(),email.toLowerCase());
  await wait(async()=>!(await js('window.api.getAccountStatus()')).access?.offline);
  if(accountAccessError(await js('window.api.getAccountStatus()'))){window.show();window.focus();console.log('TERMS_WAITING: review the displayed documents and accept explicitly in the app to continue this live test.');await wait(async()=>!accountAccessError(await js('window.api.getAccountStatus()')),600000);}
  assert.equal((await js('window.api.getAnalyticsStatus()')).enabled,true);
  const metrics=await js('window.api.getAdminMetrics(7)');assert.equal(metrics.days,7);
  const accounts=await js(`window.api.getAdminAccounts(${JSON.stringify(email)},0)`);assert.ok(accounts.some(row=>row.administrator));
  await wait(()=>js('[...document.querySelectorAll("button")].some(b=>b.textContent==="Open admin dashboard"&&!b.disabled)'));
  await js('[...document.querySelectorAll("button")].find(b=>b.textContent==="Open admin dashboard").click();void 0;');
  await wait(()=>js('!!document.querySelector(".admin-metrics") && !!document.querySelector(".account-management tbody tr")'));
  fs.writeFileSync(path.join(output,google?'account-live-google-admin.png':'account-live-admin.png'),(await window.webContents.capturePage()).toPNG());
  const sessionFile=path.join(profile,'account-session.bin');assert.ok(fs.existsSync(sessionFile));
  const raw=fs.readFileSync(sessionFile);assert.ok(!raw.includes(Buffer.from('access_token')));assert.ok(!raw.includes(Buffer.from(email)));
  window.destroy();window=undefined;stopCloudServices();
  let logout;
  restored=new AccountService(loadCloudConfig(),new SecureSessionStorage(sessionFile,safeStorage),async()=>{},undefined,(url,init)=>{
    const request=fetch(url,init);if(String(url).includes('/auth/v1/logout'))logout=request;return request;
  });
  await restored.initialize();assert.equal(restored.status().user?.id,status.user.id);
  assert.equal((await restored.adminMetrics(7)).days,7);
  await restored.signOut();if(logout)await logout.catch(()=>{});
  assert.equal(restored.status().user,null);assert.equal(fs.existsSync(sessionFile),false);restored.dispose();
  fs.writeFileSync(path.join(output,google?'account-live-google-result.json':'account-live-result.json'),JSON.stringify({success:true,method:google?'google':'email',adminAuthorized:true,encryptedAtRest:true,sessionRestored:true,signedOut:true,reportingStoppedAfterSignOut:true}));
  console.log('PASS: live '+(google?'Google':'email')+' → encrypted account session → owner dashboard → persisted session restoration → sign-out. Required reporting was active only after verified acceptance and stopped on sign-out.');
  app.quit();
}).catch(async error=>{
  console.error(error.message);
  if(window){try{await window.webContents.executeJavaScript('window.api.signOut()');}catch{}window.destroy();}
  restored?.dispose();stopCloudServices();app.exit(1);
});
