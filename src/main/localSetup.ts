import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { supportsSpeechLanguage,languageName } from '../shared/speechLanguages';
import { RUNTIME_PRESETS, SETUP_MODELS, type SetupRequest, type LocalSetupStatus, type RuntimePreset, type StoragePaths } from '../shared/localSetup';
import { loadStorage, saveStorage, storagePaths, within, availableBytes, markCache, clearDownloadCache, copyModelCache, validateStorage, physicalPath } from './localStorage';

// Published Astral release: fixed artifact and SHA-256, never a renderer-supplied URL.
export const PYTHON_RELEASE = {
  version: '3.11.17', bytes: 25240347,
  url: 'https://github.com/astral-sh/python-build-standalone/releases/download/20261013/cpython-3.11.17%2B20261013-x86_64-pc-windows-msvc-install_only_stripped.tar.gz',
  sha256: '54a38c5e7cc1a5fd2b0182b495f29606dc1455d18ebfd3b5bf0a3c09253b5031',
};
type Candidate = { root: string; python: string; preset: RuntimePreset; libraries: boolean; librariesKey?: string };
export type SpeechRuntimeConfig = { python: string; models: string; device?: string; managed?: boolean; preset?: RuntimePreset };
type Options = { profile: string; speech: string; beforeStart?: () => void; currentModel?:()=>string; currentLanguage?:()=>string; onReady: (config: SpeechRuntimeConfig, model: string, language?:string) => Promise<void> };
type Runner = (executable: string, args: string[], input?: object) => Promise<string>;
type Dependencies = { download?: (target: string, signal: AbortSignal, progress: (received: number, total: number) => void) => Promise<void>; run?: Runner };

export function setupRequest(value: unknown): SetupRequest {
  const v = value as Partial<SetupRequest> | null;
  if (!v || !['python','libraries','model','all','check'].includes(v.action || '') || !RUNTIME_PRESETS.some(p => p.id === v.preset) || !SETUP_MODELS.some(m => m.id === v.model)) throw Error('Choose a supported setup action, speech package and model.');
  if (v.preset === 'whisper-cpu' && v.model === 'bodhan-flex') throw Error('Bodhan Flex needs a Full speech package.');
  if (v.token !== undefined && (typeof v.token !== 'string' || v.token.length > 512 || (v.token.trim() && !/^hf_[A-Za-z0-9]+$/.test(v.token.trim())))) throw Error('Enter a Hugging Face read token beginning with hf_.');
  if(v.language!==undefined&&(typeof v.language!=='string'||!supportsSpeechLanguage('local',v.model!,v.language)))throw Error('Choose a language supported by the setup model.');
  return { language:v.language, action: v.action!, preset: v.preset!, model: v.model!, token: v.token?.trim() };
}
export function cleanSetupLog(value: string, token = ''): string {
  return (token ? value.split(token).join('[redacted]') : value).replace(/(?:hf_[A-Za-z0-9]{10,}|sk-[A-Za-z0-9_-]{20,}|AQ\.[A-Za-z0-9_-]{20,})/g,'[redacted]').replace(/\x1b\[[0-9;]*[A-Za-z]/g,'').trim().slice(-500);
}
export function isolatedPythonEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, PYTHONNOUSERSITE: '1', PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1', PIP_DISABLE_PIP_VERSION_CHECK: '1' };
  for (const name of ['PYTHONPATH','PYTHONHOME','PYTHONSTARTUP','VIRTUAL_ENV','HF_TOKEN','HUGGING_FACE_HUB_TOKEN']) delete env[name];
  return env;
}
export function dependencyFingerprint(speech:string,preset:RuntimePreset):string {
  const hash=createHash('sha256').update(preset+'torch-2.8.0');
  hash.update(fs.readFileSync(path.join(speech,'requirements-core.txt')));
  if(preset!=='whisper-cpu')hash.update(fs.readFileSync(path.join(speech,'requirements-full.txt')));
  return hash.digest('hex');
}

export class LocalSetup extends EventEmitter {
  private root: string;
  private cache: string;
  private locations: StoragePaths;
  private candidate?: Candidate;
  private controller?: AbortController;
  private child?: ChildProcess;
  private token = '';
  private status: LocalSetupStatus;
  constructor(private options: Options, private dependencies: Dependencies = {}) {
    super();
    this.locations=loadStorage(options.profile);this.root=this.locations.root;this.cache=this.locations.cache;
    this.loadCandidate();
    this.status = { revision:0,state:'idle',stage:'idle',message:'Choose a speech package to get started.',runtimeConfigured:false,managed:false,
      pythonInstalled:false,librariesInstalled:false,modelInstalled:false,runtimeFolder:this.locations.runtimes,modelFolder:this.locations.models,log:[] };
  }
  private loadCandidate() {
    this.candidate=undefined;
    try {
      const marker=path.join(this.locations.runtimes,'candidate.json');
      const saved = JSON.parse(fs.readFileSync(fs.existsSync(marker)?marker:path.join(this.root,'candidate.json'),'utf8')) as Candidate;
      if (this.owned(saved.root) && this.owned(saved.python) && RUNTIME_PRESETS.some(p => p.id === saved.preset)) {
        this.candidate = saved;
        if(saved.librariesKey!==dependencyFingerprint(this.options.speech,saved.preset))saved.libraries=false;
      }
    } catch { /* A missing or interrupted setup can be retried. */ }
  }
  private owned(target: string): boolean {
    if (typeof target !== 'string' || !path.isAbsolute(target)) return false;
    return within(this.locations.runtimes,target);
  }
  private configured(): SpeechRuntimeConfig | undefined {
    try { const c=JSON.parse(fs.readFileSync(path.join(this.options.profile,'speech-runtime.json'),'utf8')) as SpeechRuntimeConfig;
      return c.python && path.isAbsolute(c.python) && fs.existsSync(c.python) && c.models && path.isAbsolute(c.models) && fs.existsSync(c.models) ? c : undefined;
    } catch { return; }
  }
  getStatus(): LocalSetupStatus {
    const c=this.configured();
    return structuredClone({ ...this.status, runtimeConfigured:!!c, managed:!!c?.managed, pythonInstalled:!!this.candidate && fs.existsSync(this.candidate.python), librariesInstalled:!!this.candidate?.libraries,
      runtimeFolder:this.locations.runtimes, modelFolder:this.locations.models, storage:this.locations,
      defaultStorage:JSON.stringify(this.locations)===JSON.stringify(storagePaths(path.join(this.options.profile,'local-speech'))),
      runtimeFreeBytes:availableBytes(this.locations.runtimes),modelFreeBytes:availableBytes(this.locations.models),cacheFreeBytes:availableBytes(this.locations.cache),
      connectedPython:c?.python,connectedModels:c?.models,
      connectedPreset:c && RUNTIME_PRESETS.some(preset=>preset.id===c.preset)?c.preset:undefined,
      connectedModel:c?this.options.currentModel?.():undefined });
  }
  private update(patch: Partial<LocalSetupStatus>) { this.status={...this.status,...patch,revision:(this.status.revision||0)+1}; this.emit('status',this.getStatus()); }
  private stage(stage: string, message: string) { this.update({stage,message,progress:undefined,received:undefined,total:undefined,log:[]}); }
  private saveCandidate() {
    fs.mkdirSync(this.locations.runtimes,{recursive:true});
    fs.writeFileSync(path.join(this.locations.runtimes,'candidate.json'),JSON.stringify(this.candidate));
  }
  assertIdle() {if(this.controller)throw Error('Wait for the current setup or cancel it first.');this.options.beforeStart?.();}
  setStorage(value:StoragePaths):LocalSetupStatus {
    this.assertIdle();
    this.locations=saveStorage(this.options.profile,value);this.root=this.locations.root;this.cache=this.locations.cache;
    markCache(this.options.profile,this.cache);this.loadCandidate();
    this.update({state:'idle',stage:'idle',message:'Storage location saved. New setup files will use these folders; your connected runtime is unchanged.',modelInstalled:false,error:undefined,progress:undefined,received:undefined,total:undefined,log:[]});
    return this.getStatus();
  }
  resetStorage():LocalSetupStatus {return this.setStorage(storagePaths(path.join(this.options.profile,'local-speech')));}
  async clearCache():Promise<LocalSetupStatus> {
    this.assertIdle();const verified=this.status.modelInstalled;this.controller=new AbortController();
    this.stage('cache','Clearing cached downloads…');this.update({state:'running',error:undefined});
    try {
      const configured=this.configured(),cache=physicalPath(this.cache);
      if(configured)for(const protectedFolder of [path.dirname(configured.python),configured.models].map(physicalPath))
        if(path.relative(cache,protectedFolder)===''||within(cache,protectedFolder)||within(protectedFolder,cache))throw Error('The cache overlaps your connected environment or models. Choose a separate download cache folder before clearing it.');
      await clearDownloadCache(this.options.profile,this.locations,this.controller.signal);this.update({state:verified?'ready':'idle',stage:'idle',modelInstalled:verified,message:'Download cache cleared. Python, libraries and models are unchanged.'});
    }
    catch(error){this.update({state:this.controller.signal.aborted?'cancelled':'failed',stage:'failed',error:this.controller.signal.aborted?undefined:(error as Error).message,message:this.controller.signal.aborted?'Cache cleanup cancelled. Python, libraries and models are unchanged.':'Cache cleanup needs attention.'});}
    finally{this.controller=undefined;}
    return this.getStatus();
  }
  copyModels():LocalSetupStatus {
    this.assertIdle();const configured=this.configured();if(!configured)throw Error('Connect an existing local runtime before copying its models.');
    validateStorage(this.locations);this.controller=new AbortController();
    this.update({state:'running',stage:'copying',message:'Copying your downloaded models to the selected folder…',modelInstalled:false,error:undefined,log:[],progress:0});
    void copyModelCache(configured.models,this.locations.models,this.controller.signal,(received,total)=>this.update({received,total,progress:total?received/total:0}))
      .then(()=>this.update({state:'idle',stage:'idle',message:'Models copied. Run local speech setup to verify and connect the new location. The original files are kept.',progress:1}))
      .catch(error=>this.update({state:this.controller?.signal.aborted?'cancelled':'failed',stage:'failed',message:this.controller?.signal.aborted?'Model copy cancelled. Your connected runtime is unchanged.':'Model copy needs attention. You can retry.',error:this.controller?.signal.aborted?undefined:cleanSetupLog((error as Error).message),progress:undefined}))
      .finally(()=>{this.controller=undefined;});
    return this.getStatus();
  }
  private checkSpace(request:SetupRequest) {
    const gib=1024**3;
    const candidate=this.candidate,c=this.configured();
    const fresh=!candidate||!fs.existsSync(candidate.python)||candidate.preset!==request.preset||request.action==='python'||(c?.python===candidate.python&&request.action!=='model');
    const libraries=fresh||!candidate?.libraries||request.action==='libraries';
    const packages=request.action==='python' ? 0.25 : !libraries ? 0.05 : request.preset==='full-cuda' ? 14 : request.preset==='full-cpu' ? 7 : 1.5;
    const modelSizes={tiny:75,base:145,small:500,turbo:1600,'bodhan-flex':4900};
    const needed:[string,number][]=[[this.locations.runtimes,packages*.6*gib],[this.cache,packages*.4*gib]];
    if(request.action==='model'||request.action==='all')needed.push([this.locations.models,modelSizes[request.model]*1024**2+.1*gib]);
    const drives=new Map<string,{folder:string;bytes:number}>();
    for(const [folder,bytes]of needed){const key=path.parse(physicalPath(folder)).root.toLowerCase();const previous=drives.get(key);drives.set(key,{folder,bytes:(previous?.bytes||0)+bytes});}
    for(const {folder,bytes}of drives.values()){const free=availableBytes(folder);if(free!==undefined&&free<bytes)throw Error(`Not enough free space at ${folder}. Allow at least ${Math.ceil(bytes/gib)} GB on this drive.`);}
  }
  start(value: unknown): LocalSetupStatus {
    const request=setupRequest(value);
    this.assertIdle();
    const language=request.language||this.options.currentLanguage?.();
    if(language&&['all','model'].includes(request.action)&&!supportsSpeechLanguage('local',request.model,language))throw Error(`${languageName(language)} needs another model. Choose a compatible starting model or change the spoken language before setup.`);
    this.controller=new AbortController(); this.token=request.token || '';
    this.update({state:'running',stage:'starting',message:'Preparing local speech setup…',preset:request.preset,model:request.model,error:undefined,modelInstalled:false,log:[]});
    void this.perform(request).then(()=>this.update({state:'ready',message:request.action==='python'?'Python downloaded. Install speech libraries next.':request.action==='libraries'?'Speech libraries verified. Download a model next.':'Local speech setup verified.',progress:1}))
      .catch(error=>{const cancelled=this.controller?.signal.aborted; this.update({state:cancelled?'cancelled':'failed',stage:cancelled?'cancelled':'failed',message:cancelled?'Setup cancelled. Your previous configuration is unchanged.':'Setup needs attention. You can retry.',error:cancelled?undefined:cleanSetupLog((error as Error).message,this.token),progress:undefined});})
      .finally(()=>{this.controller=undefined;this.token='';this.child=undefined;});
    return this.getStatus();
  }
  cancel(force=false) { if(this.status.state==='running'&&this.status.stage==='connecting'&&!force)throw Error('Setup is connecting the verified runtime. Wait for it to finish.');this.controller?.abort(); if(this.child?.pid) { const child=this.child;const kill=spawn('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});kill.on('error',()=>child.kill()); } return this.getStatus(); }
  private cancelled() { if(this.controller?.signal.aborted) throw Error('Setup cancelled.'); }
  private async perform(request: SetupRequest) {
    if(process.platform!=='win32' || process.arch!=='x64') throw Error('Automatic local setup currently supports Windows x64.');
    if(request.action==='check') {
      const c=this.configured(); if(!c) throw Error('No local runtime is connected. Choose Download and set up local speech.');
      this.stage('checking','Checking Python, speech libraries and the configured model…');
      await this.run(c.python,[path.join(this.options.speech,'setup_runtime.py'),'verify-model'],{preset:c.preset || request.preset,model:this.options.currentModel?.() || request.model,models:c.models});
      this.update({modelInstalled:true});return;
    }
    validateStorage(this.locations);this.checkSpace(request);
    for(const folder of [this.locations.runtimes,this.locations.models,this.cache])fs.mkdirSync(folder,{recursive:true});
    markCache(this.options.profile,this.cache);
    const models=this.locations.models;
    // Repair into a fresh candidate; never pip-install over the currently connected runtime.
    const c=this.configured();
    if(!this.candidate || !fs.existsSync(this.candidate.python) || this.candidate.preset!==request.preset || request.action==='python' || (c?.python===this.candidate.python && request.action!=='model')) {
      const candidateRoot=path.join(this.locations.runtimes,randomUUID());fs.mkdirSync(candidateRoot,{recursive:true});
      this.stage('python','Downloading Owlio’s private Python runtime…');
      const archive=path.join(this.cache,`python-${PYTHON_RELEASE.version}.tar.gz`);
      await this.download(archive);
      this.cancelled();this.stage('extracting','Installing Python into Owlio’s own folder…');
      await this.run('tar.exe',['-xzf',archive,'-C',candidateRoot]);
      const python=path.join(candidateRoot,'python','python.exe');
      if(!fs.existsSync(python)) throw Error('The downloaded Python runtime is incomplete. Retry setup.');
      await this.run(python,['-I','--version']);
      this.candidate={root:candidateRoot,python,preset:request.preset,libraries:false};this.saveCandidate();
    }
    if(request.action==='python') return;
    const candidate=this.candidate!;
    if(!candidate.libraries || request.action==='libraries') {
      this.stage('libraries','Downloading and installing speech libraries…');
      const pip=['-I','-m','pip','install','--isolated','--only-binary=:all:','--cache-dir',path.join(this.cache,'pip'),'--timeout','30','--retries','2'];
      if(request.preset!=='whisper-cpu') {
        this.stage('pytorch',request.preset==='full-cuda'?'Downloading PyTorch and NVIDIA GPU libraries…':'Downloading CPU PyTorch libraries…');
        await this.run(candidate.python,[...pip,'torch==2.8.0','torchaudio==2.8.0','--index-url',request.preset==='full-cuda'?'https://download.pytorch.org/whl/cu128':'https://download.pytorch.org/whl/cpu']);
      }
      this.stage('libraries','Installing the speech recognition and model libraries…');
      await this.run(candidate.python,[...pip,'--index-url','https://pypi.org/simple','-r',path.join(this.options.speech,request.preset==='whisper-cpu'?'requirements-core.txt':'requirements-full.txt')]);
      this.stage('checking','Checking that all speech libraries work…');
      await this.run(candidate.python,[path.join(this.options.speech,'setup_runtime.py'),'check'],{preset:request.preset});
      candidate.libraries=true;candidate.librariesKey=dependencyFingerprint(this.options.speech,request.preset);this.saveCandidate();
    }
    if(request.action==='libraries') return;
    this.stage('model',`Downloading and verifying ${SETUP_MODELS.find(m=>m.id===request.model)?.name}…`);
    await this.run(candidate.python,[path.join(this.options.speech,'setup_runtime.py'),'model'],{preset:request.preset,model:request.model,models,token:this.token});
    this.cancelled();this.options.beforeStart?.();
    const config: SpeechRuntimeConfig={python:candidate.python,models,device:request.preset==='full-cuda'?'cuda':'cpu',managed:true,preset:request.preset};
    this.stage('connecting','Connecting the verified runtime to Owlio…');
    await this.options.onReady(config,request.model,request.language);
    this.update({modelInstalled:true});
  }
  private async download(target: string) {
    const checksum=()=>fs.existsSync(target)&&createHash('sha256').update(fs.readFileSync(target)).digest('hex')===PYTHON_RELEASE.sha256;
    if(checksum()) return;
    const progress=(received:number,total:number)=>this.update({received,total,progress:total?received/total:undefined});
    if(this.dependencies.download) { await this.dependencies.download(target,this.controller!.signal,progress); if(!checksum()) throw Error('Python download checksum failed. Retry setup.'); return; }
    const partial=target+'.part';
    const response=await fetch(PYTHON_RELEASE.url,{signal:AbortSignal.any([this.controller!.signal,AbortSignal.timeout(15*60*1000)])});
    if(!response.ok || !response.body) throw Error(`Python download failed (${response.status}). Check your internet connection and retry.`);
    const size=Number(response.headers.get('content-length')) || PYTHON_RELEASE.bytes;
    if(size>100*1024**2) throw Error('Python download is larger than expected.');
    const hash=createHash('sha256'),file=fs.openSync(partial,'w');let received=0,last=0;
    try {
      for await(const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        this.cancelled();received+=chunk.length;
        if(received>100*1024**2) throw Error('Python download is larger than expected.');
        fs.writeSync(file,chunk);hash.update(chunk);
        if(Date.now()-last>200){progress(received,size);last=Date.now();}
      }
      if(hash.digest('hex')!==PYTHON_RELEASE.sha256) throw Error('Python download checksum failed. Retry setup.');
    } catch(error) { fs.closeSync(file);fs.unlinkSync(partial);throw error; }
    fs.closeSync(file);fs.renameSync(partial,target);progress(received,size);
  }
  private run(executable:string,args:string[],input?:object):Promise<string> {
    this.cancelled(); if(this.dependencies.run) return this.dependencies.run(executable,args,input);
    return new Promise((resolve,reject)=>{
      const child=spawn(executable,args,{cwd:this.options.speech,windowsHide:true,stdio:['pipe','pipe','pipe'],env:isolatedPythonEnvironment()});this.child=child;
      let output='',tail='',last=0;
      const timer=setTimeout(()=>{this.cancel();reject(Error('Setup timed out. Check your connection and retry.'));},2*60*60*1000);
      const consume=(data:Buffer)=>{
        const clean=cleanSetupLog(data.toString('utf8'),this.token); output=(output+'\n'+clean).slice(-64000);tail=(tail+' '+clean).slice(-1000);
        if(Date.now()-last>350){this.update({log:[...this.status.log,clean].slice(-5)});last=Date.now();}
      };
      child.stdout!.on('data',consume);child.stderr!.on('data',consume);
      child.on('error',error=>{clearTimeout(timer);reject(error);});
      child.stdin!.on('error',()=>{});
      child.on('close',code=>{clearTimeout(timer);if(this.child===child)this.child=undefined;
        if(this.controller?.signal.aborted) reject(Error('Setup cancelled.'));
        else if(code!==0) reject(Error(tail || `Speech setup exited with ${code}.`));
        else resolve(output);
      });
      child.stdin!.end(input?JSON.stringify(input):'');
    });
  }
}
