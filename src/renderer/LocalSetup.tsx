import React, { useEffect, useRef, useState } from 'react';
import { Download, Check, Mic, Settings2, ArrowRight, Cloud, Laptop, RefreshCw, FolderOpen, Trash2, Copy } from 'lucide-react';
import { RUNTIME_PRESETS, SETUP_MODELS, recommendedPreset, type RuntimePreset, type SetupModel, type SetupAction, type SetupRequest, type LocalSetupStatus, type StorageTarget } from '../shared/localSetup';
import type { AppSettings } from '../main/store';
import { AudioRecorder } from './audioRecorder';
import owlioLogo from '../../assets/brand/owlio-logo.png';
import { UsageConsent } from './AccountPrivacy';

type SetupApi = {
  getLocalSetup:()=>Promise<LocalSetupStatus>; startLocalSetup:(request:SetupRequest)=>Promise<LocalSetupStatus>;
  cancelLocalSetup:()=>Promise<unknown>; onLocalSetupStatus:(callback:(status:LocalSetupStatus)=>void)=>()=>void;
  chooseLocalStorage:(target:StorageTarget)=>Promise<LocalSetupStatus>; resetLocalStorage:()=>Promise<LocalSetupStatus>;
  copyLocalModels:()=>Promise<LocalSetupStatus>; clearLocalDownloadCache:()=>Promise<LocalSetupStatus>;
  getSettings:()=>Promise<AppSettings>; updateSettings:(patch:Partial<AppSettings>)=>Promise<AppSettings>;
};
const api=()=> (window as unknown as {api:SetupApi}).api;
type Props = { onConnected:(patch:Partial<AppSettings>)=>void; firstRun?:boolean; onFinish?:()=>void; onOpenWizard?:()=>void; currentModel?:string; initialModel?:string; initialLanguage?:string; onManageModels?:()=>void };

function SetupMicrophoneTest() {
  const recorder=useRef<AudioRecorder|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null),mounted=useRef(true);
  const [testing,setTesting]=useState(false),[starting,setStarting]=useState(false),[level,setLevel]=useState(0),[heard,setHeard]=useState(false),[error,setError]=useState('');
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;if(timer.current)clearTimeout(timer.current);void recorder.current?.dispose();};},[]);
  const stop=async()=>{if(timer.current)clearTimeout(timer.current);await recorder.current?.stop();if(mounted.current){setTesting(false);setStarting(false);setLevel(0);}};
  const start=async()=>{
    setStarting(true);setError('');setHeard(false);
    const audio=recorder.current || new AudioRecorder();recorder.current=audio;
    audio.onVolumeChange=volume=>{if(mounted.current){setLevel(volume);if(volume>.04)setHeard(true);}};
    try{await audio.start();if(mounted.current){setTesting(true);setStarting(false);timer.current=setTimeout(()=>{void stop();},30000);}}
    catch(error){if(mounted.current){setError(error instanceof Error?error.message:'Could not open the microphone.');setStarting(false);}}
  };
  return <div className="setup-mic-test">
    <div><h4>Check your microphone</h4><p className="muted">Speak a few words and watch the level. This test uses your Windows default microphone; audio is discarded.</p></div>
    <button type="button" className="btn btn-secondary" onClick={()=>{void(testing||starting?stop():start());}}><Mic size={16}/>{testing||starting?'Stop microphone test':'Test microphone'}</button>
    {(testing||heard)&&<><div className="setup-meter" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level*100)}><span style={{width:`${Math.min(100,level*100)}%`}}/></div><p role="status" className="muted">{heard?'Microphone signal detected.':'Speak and watch the level move…'}</p></>}
    {error&&<p role="alert" className="shortcut-error">{error}</p>}
  </div>;
}

export function LocalSetupPanel({onConnected,firstRun=false,onFinish,onOpenWizard,currentModel,initialModel,initialLanguage,onManageModels}:Props) {
  const [status,setStatus]=useState<LocalSetupStatus|null>(null),[presetChoice,setPresetChoice]=useState<RuntimePreset|'auto'>('auto'),[model,setModel]=useState<SetupModel>(SETUP_MODELS.find(item=>item.id===initialModel)?.id||'base');
  const [token,setToken]=useState(''),[error,setError]=useState(''),[requesting,setRequesting]=useState(false);
  const [editingPackage,setEditingPackage]=useState(false);
  const connected=useRef(onConnected);connected.current=onConnected;
  useEffect(()=>{
    let mounted=true;
    const update=(next:LocalSetupStatus)=>{if(mounted)setStatus(previous=>typeof next.revision==='number'&&typeof previous?.revision==='number'&&next.revision<previous.revision?previous:next);};
    const unsub=api().onLocalSetupStatus?.(update);
    void api().getLocalSetup().then(update).catch(error=>{if(mounted)setError(error instanceof Error?error.message:'Cannot check local setup.');});
    return()=>{mounted=false;unsub?.();};
  },[]);
  useEffect(()=>{
    if(status?.state!=='ready'||!status.modelInstalled)return;
    let mounted=true;
    void api().getSettings().then(settings=>{if(mounted)connected.current({provider:settings.provider,localSttUrl:settings.localSttUrl,localSttModel:settings.localSttModel,dictationLanguage:settings.dictationLanguage});}).catch(error=>{if(mounted)setError(error.message);});
    return()=>{mounted=false;};
  },[status?.state,status?.modelInstalled]);
  const preset=presetChoice==='auto'?recommendedPreset(model,status?.connectedPreset):presetChoice;
  const busy=requesting||status?.state==='running';
  const configured=status?.runtimeConfigured===true;
  useEffect(()=>{const desired=SETUP_MODELS.find(item=>item.id===initialModel);if(!configured&&desired){setModel(desired.id);setPresetChoice('auto');}},[initialModel,configured]);
  const connectedModel=currentModel || status?.connectedModel;
  const connectedPackage=RUNTIME_PRESETS.find(item=>item.id===status?.connectedPreset);
  const connectedModelName=SETUP_MODELS.find(item=>item.id===connectedModel)?.name || connectedModel?.replace(/^hf:/,'');
  const showInstaller=!!status && (!configured || editingPackage);
  const openInstaller=()=>{
    const nextPreset=recommendedPreset(connectedModel||'base',status?.connectedPreset);
    setPresetChoice('auto');
    const setupModel=SETUP_MODELS.find(item=>item.id===connectedModel&&(!item.full||nextPreset!=='whisper-cpu'));
    setModel(setupModel?.id || 'base');setToken('');setError('');setEditingPackage(true);
  };
  const acceptStatus=(next:LocalSetupStatus)=>setStatus(previous=>typeof next.revision==='number'&&typeof previous?.revision==='number'&&next.revision<previous.revision?previous:next);
  const storageAction=async(action:()=>Promise<LocalSetupStatus>)=>{
    setRequesting(true);setError('');try{acceptStatus(await action());}catch(error){setError(error instanceof Error?error.message:'Could not update storage.');}finally{setRequesting(false);}
  };
  const start=async(action:SetupAction)=>{
    setRequesting(true);setError('');
    try{const result=await api().startLocalSetup({action,...(initialLanguage&&['all','model'].includes(action)?{language:initialLanguage}:{}),preset:action==='check'?recommendedPreset(connectedModel||model,status?.connectedPreset):preset,model,token:token.trim()||undefined});acceptStatus(result);setToken('');}
    catch(error){setError(error instanceof Error?error.message:'Could not start setup.');}
    finally{setRequesting(false);}
  };
  const free=(bytes?:number)=>bytes===undefined?'Drive space unavailable':`${(bytes/1024**3).toFixed(1)} GB free`;
  const differentModels=!!status?.connectedModels&&!!status.storage&&status.connectedModels.toLowerCase()!==status.storage.models.toLowerCase();
  return <section className={`card local-setup${firstRun?' first-run-local':''}`} aria-labelledby="local-setup-heading">
    <div className="shortcut-heading"><Download size={20} color="#76608C"/><h3 id="local-setup-heading">{configured?'Installed speech package':'Set up local speech'}</h3></div>
    {!status?<p className="muted" role="status">Checking your local speech setup…</p>:configured?<>
      <div className="setup-installed" aria-label="Connected speech setup">
        <p className="setup-connected"><Check size={15}/>{status.managed?'Managed by Owlio':'Manually connected runtime'}</p>
        <dl><div><dt>Connected package</dt><dd>{connectedPackage?.name || 'Package not recorded for this runtime'}</dd></div>
          {connectedModelName&&<div><dt>Selected speech model</dt><dd>{connectedModelName}</dd></div>}</dl>
        <p className="muted">Manage downloads and switch models under <strong>Speech model</strong>.</p>
        <div className="setup-actions">
          {onManageModels&&<button type="button" className="btn btn-secondary" disabled={busy} onClick={onManageModels}>Manage speech models</button>}
          <button id="repair-speech-package" type="button" className="btn btn-secondary" disabled={busy} aria-expanded={editingPackage} aria-controls="speech-package-installer" onClick={()=>editingPackage?setEditingPackage(false):openInstaller()}><Settings2 size={15}/>{editingPackage?'Close installation options':'Repair or change package'}</button>
          {!busy&&<button type="button" className="btn btn-secondary" onClick={()=>{void start('check');}}><RefreshCw size={15}/>Check current setup</button>}
        </div>
      </div>
      {firstRun&&!editingPackage&&<button type="button" className="btn btn-primary setup-finish" disabled={busy} onClick={onFinish}>Use this setup<ArrowRight size={16}/></button>}
    </>:<p className="muted">Choose a speech model. Owlio installs what it needs.</p>}
    {status?.storage&&<details className="settings-disclosure settings-advanced"><summary>Advanced storage<span>Download folders and disk space</span></summary><div className="setup-storage" aria-label="Local speech storage">
      <div className="setup-storage-heading"><div><h4><FolderOpen size={17}/>Storage location</h4><p className="muted">Choose where the large Python, library and model files are saved.</p></div>
        <button id="choose-storage-root" type="button" className="btn btn-secondary" disabled={busy} onClick={()=>{void storageAction(()=>api().chooseLocalStorage('root'));}}>Choose folder</button></div>
      <p className="setup-storage-path">{status.storage.root}</p>
      <p className="muted">Owlio creates an OwlioData folder here. New downloads use this location.</p>
      <details className="setup-storage-advanced"><summary>Advanced folders &amp; free space</summary>
        {(['runtimes','models','cache'] as const).map((target,index)=><div className="setup-storage-row" key={target}><div><strong>{target==='runtimes'?'Python & libraries':target==='models'?'Speech models':'Download cache'}</strong>
          <p className="setup-storage-path">{status.storage![target]}</p><span className="muted">{free([status.runtimeFreeBytes,status.modelFreeBytes,status.cacheFreeBytes][index])}</span></div>
          <button id={`choose-storage-${target}`} type="button" className="btn btn-secondary" aria-label={`Change ${target==='runtimes'?'environment':target==='models'?'model':'download cache'} folder`} disabled={busy} onClick={()=>{void storageAction(()=>api().chooseLocalStorage(target));}}>Change</button></div>)}
        <p className="muted">Each choice creates a separate Owlio folder. Folder changes save immediately.</p>
        <details><summary>Changing locations</summary><p className="muted">Existing files stay connected until the new setup is verified. Separate folders use the names Owlio-environments, Owlio-models and Owlio-downloads.</p></details>
        {!status.defaultStorage&&<button id="reset-storage" type="button" className="btn btn-secondary" disabled={busy} onClick={()=>{void storageAction(()=>api().resetLocalStorage());}}>Use default location</button>}
        {status.connectedPython&&<div className="setup-storage-connected"><strong>Currently connected</strong><p className="setup-storage-path">Python: {status.connectedPython}<br/>Models: {status.connectedModels}</p></div>}
      </details>
      <div className="setup-actions">
        {differentModels&&<button id="copy-existing-models" type="button" className="btn btn-secondary" disabled={busy} onClick={()=>{void storageAction(()=>api().copyLocalModels());}}><Copy size={15}/>Copy existing models</button>}
        <button id="clear-download-cache" type="button" className="btn btn-secondary" disabled={busy} onClick={()=>{void storageAction(()=>api().clearLocalDownloadCache());}}><Trash2 size={15}/>Clear download cache</button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>{void storageAction(()=>api().getLocalSetup());}}><RefreshCw size={15}/>Refresh space</button>
      </div>
      <p className="muted">Clearing the cache keeps installed models and libraries.</p>
      {differentModels&&<p className="muted">Copying keeps the originals. Run setup afterward to connect the new location.</p>}
    </div></details>}
    {showInstaller&&<div id="speech-package-installer" className="setup-installer" aria-label="Speech package installation options">
    {configured&&<><h4>Repair or change your package</h4><p className="muted">Choose a package and model for the repaired setup. Changes apply after verification.</p>
      {connectedModel&&!SETUP_MODELS.some(item=>item.id===connectedModel)&&<p className="muted">This installer does not include your current model, {connectedModelName}. Choose a model below to connect after installation.</p>}</>}
    <div className="setup-fields">
      <label>{configured?'Model to connect after setup':'Starting speech model'}<select id="setup-model" className="select" aria-label="Setup speech model" value={model} disabled={busy} onChange={event=>{setModel(event.target.value as SetupModel);setPresetChoice('auto');}}>{SETUP_MODELS.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
    </div>
    <p className="setup-plan">Owlio installs the required speech libraries automatically. {SETUP_MODELS.find(item=>item.id===model)?.size}. {RUNTIME_PRESETS.find(item=>item.id===preset)?.disk}</p>
    {model==='bodhan-flex'?<div className="setup-model-access"><p className="muted">Bodhan Flex needs approved <a href="https://huggingface.co/bodhan-ai/indic-transcribe-flex" target="_blank" rel="noreferrer">Hugging Face model access</a>. After approval, paste a read token for the download. The token is used only for this setup and is not saved.</p>
      <label>Hugging Face read token<input id="setup-hf-token" type="password" className="input" aria-label="Hugging Face read token" value={token} disabled={busy} onChange={event=>setToken(event.target.value)} autoComplete="off" spellCheck={false} placeholder="hf_…"/></label>
      </div>:null}
    <div className="setup-actions">
      <button type="button" className="btn btn-primary" disabled={busy||!status} onClick={()=>{void start('all');}}><Download size={16}/>{status?.state==='failed'||status?.state==='cancelled'?'Retry local speech setup':configured?'Repair and connect speech':'Download and set up local speech'}</button>
    </div>
    <details className="settings-disclosure setup-individual"><summary>Advanced installation<span>Package and component setup</span></summary>
      <label>Package<select id="setup-package" className="select" aria-label="Speech package" value={presetChoice} disabled={busy} onChange={event=>setPresetChoice(event.target.value as RuntimePreset|'auto')}><option value="auto">Automatic</option>{RUNTIME_PRESETS.map(item=><option key={item.id} value={item.id} disabled={item.id==='whisper-cpu'&&model==='bodhan-flex'}>{item.id==='whisper-cpu'?'Lightweight CPU':item.id==='full-cpu'?'Full CPU':'NVIDIA GPU'}</option>)}</select></label>
      <p className="muted">{presetChoice==='auto'?'Reuse a compatible setup or install the CPU package this model needs.':RUNTIME_PRESETS.find(item=>item.id===presetChoice)?.detail}</p>
      <p className="muted">Install components in order: Python, libraries, then model.</p>
      <div className="setup-actions"><button type="button" className="btn btn-secondary" disabled={busy||!status} onClick={()=>{void start('python');}}>Download Python</button><button type="button" className="btn btn-secondary" disabled={busy||!status} onClick={()=>{void start('libraries');}}>Install / repair libraries</button><button type="button" className="btn btn-secondary" disabled={busy||!status} onClick={()=>{void start('model');}}>Download / verify model</button></div>
      <details><summary>Download troubleshooting</summary><p className="muted">Retry interrupted downloads. Python and library downloads are cached; models remain in the model folder. A new setup connects only after model verification.</p></details>
      {status&&<p className="muted setup-path">Runtime: {status.runtimeFolder}<br/>Models: {status.modelFolder}</p>}
    </details>
    </div>}
    {busy&&<div className="setup-actions"><button type="button" className="btn btn-secondary" disabled={status?.stage==='connecting'} onClick={()=>{void api().cancelLocalSetup().catch(error=>setError(error.message));}}>Cancel setup</button></div>}
    {status&&(!configured||status.stage!=='idle'||status.state!=='idle')&&<div className={`setup-progress ${status.state}`} role="status" aria-live="polite">
      <strong>{status.message}</strong>
      {busy&&<progress aria-label="Local setup progress" {...(typeof status.progress==='number'?{value:status.progress,max:1}:{})}/>}
      {busy&&status.received!==undefined&&<span>{(status.received/1024**2).toFixed(1)} MB {status.stage==='copying'?'copied':'downloaded'}{status.total?` of ${(status.total/1024**2).toFixed(1)} MB`:''}</span>}
      {status.error&&<p className="shortcut-error">{status.error}</p>}
      {!!status.log.length&&<details><summary>Download details</summary><pre>{status.log.join('\n')}</pre></details>}
    </div>}
    {error&&<p role="alert" className="shortcut-error">{error}</p>}
    {(status?.modelInstalled&&status.state==='ready')&&<><SetupMicrophoneTest/>{firstRun&&editingPackage&&<button type="button" className="btn btn-primary setup-finish" onClick={onFinish}>Finish setup<ArrowRight size={16}/></button>}</>}
    {!firstRun&&<>{onOpenWizard&&<button type="button" className="btn btn-secondary" disabled={busy} onClick={onOpenWizard}><Settings2 size={15}/>Open guided setup</button>}</>}
  </section>;
}

export function FirstRunSetup({onChange,onDone,onAccount}:{onChange:(patch:Partial<AppSettings>)=>void;onDone:()=>void;onAccount?:()=>void}) {
  const [choice,setChoice]=useState<'welcome'|'local'|'cloud'>('welcome');
  const [key,setKey]=useState(''),[error,setError]=useState(''),[saving,setSaving]=useState(false);
  const complete=async(later=false)=>{
    setSaving(true);setError('');
    try{if(later)await api().cancelLocalSetup();const updated=await api().updateSettings({setupCompleted:true});onChange(updated);onDone();}
    catch(error){setError(error instanceof Error?error.message:'Could not save setup choice.');}finally{setSaving(false);}
  };
  const cloud=async(event:React.FormEvent)=>{
    event.preventDefault();setSaving(true);setError('');
    try{await api().cancelLocalSetup();const updated=await api().updateSettings({provider:'groq',groqApiKey:key.trim(),setupCompleted:true});setKey('');onChange(updated);onDone();}
    catch(error){setError(error instanceof Error?error.message:'Could not save cloud setup.');}finally{setSaving(false);}
  };
  return <section className="first-run-setup" aria-label="Welcome to Owlio">
    <img className="setup-logo" src={owlioLogo} alt="Owlio"/>
    <div className="first-run-heading"><span className="settings-eyebrow">Welcome to Owlio</span><h1>Set up speech recognition</h1><p>Choose where to transcribe your speech.</p></div>
    {choice==='welcome'?<div className="setup-choice-grid">
      <button type="button" className="setup-choice" onClick={()=>setChoice('local')}><Laptop size={28}/><strong>On this computer</strong><span>Transcribe offline after setup. Download required.</span><b>Set up local speech →</b></button>
      <button type="button" className="setup-choice" onClick={()=>setChoice('cloud')}><Cloud size={28}/><strong>With a cloud provider</strong><span>Send audio to Groq. API key required.</span><b>Set up cloud speech →</b></button>
    </div>:choice==='local'?<><button type="button" className="btn btn-secondary setup-back" onClick={()=>setChoice('welcome')}>← Other setup options</button><LocalSetupPanel firstRun onConnected={onChange} onFinish={()=>{void complete();}}/></>:<form className="card setup-cloud" onSubmit={event=>{void cloud(event);}}>
      <button type="button" className="btn btn-secondary setup-back" onClick={()=>setChoice('welcome')}>← Other setup options</button><h3>Cloud speech recognition</h3><p className="muted">Audio is sent to your selected provider. Provider usage charges or limits may apply. Gemini is for text cleanup and is configured separately.</p>
      <label>API key<input className="input" type="password" value={key} onChange={event=>setKey(event.target.value)} autoComplete="off" spellCheck={false} required placeholder="gsk_…"/></label><p className="muted">Saved with Windows encryption. Add or change your key later in Speech &amp; models.</p><button type="submit" className="btn btn-primary" disabled={saving||!key.trim()}>Save and continue<ArrowRight size={16}/></button>
    </form>}
    {error&&<p role="alert" className="shortcut-error">{error}</p>}
    <button type="button" className="btn btn-secondary setup-later" disabled={saving} onClick={()=>{void complete(true);}}><Settings2 size={16}/>Set up later</button>
    <p className="muted">You can return to setup under Speech &amp; models.</p>
    <UsageConsent compact/>
    <p className="muted">Sign-in and accepted terms are required. {onAccount && <button className="setup-account-link" type="button" onClick={onAccount}>Account &amp; privacy settings →</button>}</p>
  </section>;
}
