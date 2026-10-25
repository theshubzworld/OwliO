import React, { useEffect, useRef, useState } from 'react';
import { modelLanguageSummary,modelHasDocumentedLanguage,documentedModelLanguages,languageName } from '../shared/speechLanguages';
import { recommendedPreset, type LocalSetupStatus } from '../shared/localSetup';
import { Download, Cpu, RefreshCw, Check, Loader2, Trash2 } from 'lucide-react';
import {SetupProgress} from './SetupProgress';

type SpeechModel = { id: string; name: string; downloaded: boolean; bytes?: number; engine?: string; languages?:string[]|null; runtime_ready?:boolean; runtime_error?:string };
type Job = { id: string; model: string; status: string; action?: string; error?: string; state?: string; completed?: number; total?: number };
type Catalogue = {
  speech: { online: boolean; error?: string; loaded_model?: string; cache_directory?: string; runtime?: { device?: string; compute_type?: string }; models?: SpeechModel[]; jobs?: Job[] };
  formatting: { online: boolean; error?: string; models?: { name: string }[] }; pulls: Job[];
};
export function LocalModels({ settings, onSettingsChange, section = 'both' }: { settings: any; onSettingsChange: (patch: any) => void; section?: 'speech' | 'formatting' | 'both' }) {
  const [catalogue, setCatalogue] = useState<Catalogue | null>(null);
  const [selected, setSelected] = useState(settings.localSttModel || 'base');
  const [formatting, setFormatting] = useState(settings.localLlmModel || 'llama3.2');
  const [setup,setSetup]=useState<LocalSetupStatus|null>(null);
  const [pendingSelection,setPendingSelection]=useState('');
  const [pendingSetupRevision,setPendingSetupRevision]=useState<number|null>(null);
  const [accessToken,setAccessToken]=useState('');
  const picker=useRef<HTMLDetailsElement|null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [modelUrl, setModelUrl] = useState('');
  const mounted = useRef(false);
  const refresh = async (manual = false) => {
    if (manual) { setRefreshing(true); setError(''); setMessage(''); }
    try {
      const [data,nextSetup]:[Catalogue,LocalSetupStatus|null]=await Promise.all([
        (window as any).api.getLocalModels(),
        section==='formatting'?Promise.resolve(null):(window as any).api.getLocalSetup(),
      ]);
      if (mounted.current) {
        setCatalogue(data);if(nextSetup)setSetup(previous=>(previous?.revision??0)>(nextSetup.revision??0)?previous:nextSetup);
        if (manual && section !== 'speech') {
          if (!data.formatting.online) setError('Cannot refresh models. Start Ollama at the saved address, then try again.');
          else {
            const count = new Set(data.formatting.models?.map(model => model.name)).size;
            setMessage(count ? `${count} local model${count === 1 ? '' : 's'} found. Select a model, then Save settings.` : 'No installed Ollama models found. Enter a model name below and choose Download.');
          }
        }
      }
    }
    catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : 'Cannot check local models.'); }
    finally { if (manual && mounted.current) setRefreshing(false); }
  };
  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => { await refresh(); if (mounted.current) timer = setTimeout(poll, 3000); };
    void poll();
    return () => { mounted.current = false; clearTimeout(timer); };
  }, []);
  useEffect(() => { setSelected(settings.localSttModel || 'base'); }, [settings.localSttModel]);
  useEffect(() => { setFormatting(settings.localLlmModel || 'llama3.2'); }, [settings.localLlmModel]);
  const act = async () => {
    setBusy('download');setError('');setMessage('');
    try {
      if(selected==='bodhan-flex'||selected==='bark-pro'||needsRuntime) {
        const next:LocalSetupStatus=await (window as any).api.startLocalSetup({action:'model',language:settings.dictationLanguage,preset:recommendedPreset(selected,setup?.connectedPreset||(catalogue?.speech.runtime?.device==='cuda'?'full-cuda':undefined)),model:selected,token:accessToken.trim()||undefined});
        if(!mounted.current)return;
        setSetup(next);setPendingSetupRevision(next.revision??0);
        setMessage('Installing the libraries and model needed for speech. Setup connects it after verification.');
      } else {
        setPendingSetupRevision(null);
        await (window as any).api.speechModelAction(selected,'download');
        setMessage('Downloading. Save settings once the model is ready.');
      }
      setAccessToken('');setPendingSelection(selected);await refresh();
    } catch(error) {if(mounted.current)setError(error instanceof Error?error.message:'Model download failed.');}
    finally {if(mounted.current)setBusy('');}
  };
  const pull = async () => {
    setBusy('pull'); setError('');
    try { await (window as any).api.pullFormattingModel(formatting); if (mounted.current) { setMessage('Model download started.'); await refresh(); } }
    catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : 'Download failed.'); }
    finally { if (mounted.current) setBusy(''); }
  };
  const importModel = async () => {
    setBusy('import'); setError(''); setMessage('');
    try {
      const job = await (window as any).api.importSpeechModel(modelUrl);
      if (mounted.current) {
        setMessage('Checking the repository and downloading its speech model. Choose it when the download finishes, then Save settings.');
        await refresh();
        // Selection is available once the repository has passed the server's compatibility check.
        if (job.status === 'ready') setSelected(job.model);
      }
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : 'Could not import this model.'); }
    finally { if (mounted.current) setBusy(''); }
  };
  const deleteModel = async (id: string) => {
    if (!id || Boolean(busy) || running) return;
    setBusy('delete'); setError(''); setMessage('');
    try {
      await (window as any).api.deleteSpeechModel(id);
      setMessage('Model removed successfully.');
      if (settings.localSttModel === id) {
        setSelected('base');
        onSettingsChange({ localSttModel: 'base' });
      } else {
        setSelected(settings.localSttModel || 'base');
      }
      await refresh(true);
    } catch (error) {
      if (mounted.current) setError(error instanceof Error ? error.message : 'Could not remove this model.');
    } finally {
      if (mounted.current) setBusy('');
    }
  };
  const model = catalogue?.speech.models?.find(model => model.id === selected);
  const selectedLanguages = documentedModelLanguages(selected)||model?.languages;
  const currentModel = catalogue?.speech.models?.find(model => model.id === settings.localSttModel);
  useEffect(()=>{if(picker.current&&catalogue?.speech.online&&!currentModel?.downloaded)picker.current.open=true;},[settings.localSttModel,catalogue?.speech.online,currentModel?.downloaded]);
  const running = setup?.state==='running'||catalogue?.speech.jobs?.some(job => ['queued', 'inspecting', 'downloading', 'loading'].includes(job.status));
  const needsRuntime=model?.runtime_ready===false||(['bodhan-flex','bark-pro'].includes(selected)&&setup?.connectedPreset==='whisper-cpu');
  useEffect(()=>{
    if(pendingSelection&&pendingSetupRevision!==null&&(setup?.state==='failed'||setup?.state==='cancelled')){setPendingSelection('');setPendingSetupRevision(null);return;}
    const setupReady=pendingSetupRevision===null||!!setup&&setup.state==='ready'&&setup.modelInstalled&&(setup.revision??0)>=pendingSetupRevision;
    if(pendingSelection&&catalogue?.speech.models?.some(item=>item.id===pendingSelection&&item.downloaded&&item.runtime_ready!==false)&&setup?.state!=='running'&&setupReady){onSettingsChange({localSttModel:pendingSelection});setPendingSelection('');setPendingSetupRevision(null);}
  },[catalogue,pendingSelection,pendingSetupRevision,setup]);
  const installed = catalogue?.formatting.models?.some(model => model.name === settings.localLlmModel || model.name === settings.localLlmModel + ':latest');
  const installedModels = [...new Set(catalogue?.formatting.models?.map(model => model.name) || [])].sort((a, b) => a.localeCompare(b));
  const installedSelection = installedModels.includes(formatting) ? formatting : installedModels.includes(formatting + ':latest') ? formatting + ':latest' : '';
  const speechJobs = catalogue?.speech.jobs?.slice(-1) || [];
  const formattingJobs = catalogue?.pulls.slice(-1) || [];
  const modelName = (id: string) => id === 'bodhan-flex' ? 'Bodhan Flex' : catalogue?.speech.models?.find(model => model.id === id)?.name || id.replace(/^hf:/, '');
  return <section className="card local-models" aria-labelledby={`local-models-heading-${section}`}>
    <div className="model-heading"><Cpu size={20} /><h3 id={`local-models-heading-${section}`}>{section === 'formatting' ? 'Local AI model' : section === 'speech' ? 'Speech model' : 'Speech & text'}</h3><button className="btn btn-secondary" aria-label={section === 'formatting' ? 'Refresh models' : 'Refresh model status'} disabled={refreshing} onClick={() => void refresh(true)}>{refreshing ? <Loader2 size={15} className="pill-spinner"/> : <RefreshCw size={15} />}{section === 'formatting' && <span>{refreshing ? 'Refreshing…' : 'Refresh models'}</span>}</button></div>
    {section !== 'formatting' && <div className="model-section">
      <div className="speech-overview"><div><span className="settings-eyebrow">Selected speech model</span><h4>{modelName(settings.localSttModel || 'base')}</h4><p className="muted">{modelLanguageSummary(settings.localSttModel,currentModel?.languages)}</p></div>
        {catalogue?.speech.online && currentModel?.downloaded && <span className="settings-status"><Check size={13} />{catalogue.speech.loaded_model === settings.localSttModel ? 'Ready to dictate' : 'Downloaded'}</span>}</div>
      {!catalogue ? <p className="muted">Checking the speech server…</p> : !catalogue.speech.online ? <p role="status" className="model-warning">Speech server unavailable. {catalogue.speech.error}</p> : <>
        <details ref={picker} className="settings-disclosure model-picker">
        <summary>Change speech model<span>Installed models and downloads</span></summary>
        <label className="sr-only" htmlFor="speech-model">Speech model</label>
        <select id="speech-model" className="select" value={selected} disabled={Boolean(busy) || running} onChange={event => {const id=event.target.value;setSelected(id);setMessage('');setPendingSelection('');setPendingSetupRevision(null);if(catalogue?.speech.models?.some(item=>item.id===id&&item.downloaded&&item.runtime_ready!==false)&&!(['bodhan-flex','bark-pro'].includes(id)&&setup?.connectedPreset==='whisper-cpu'))onSettingsChange({localSttModel:id});}}>
          {catalogue.speech.models?.map(model => <option key={model.id} value={model.id}>{model.name} · {model.downloaded ? 'Downloaded' : 'Download needed'}</option>)}
        </select>
        <div className="model-actions"><span className="muted">{model?.downloaded ? `${((model.bytes || 0) / 1024 / 1024).toFixed(0)} MB of model weights on disk` : 'Download before switching. Larger models need more memory and processing time.'}</span>
          <button className="btn btn-secondary" disabled={Boolean(busy)||running||setup?.state==='running'||!!model?.downloaded&&!needsRuntime} onClick={()=>void act()}><Download size={15}/>{needsRuntime?'Set up model':'Download'}</button>
          {(model?.downloaded || selected.startsWith('hf:')) && (
            <button className="btn btn-danger" style={{ marginLeft: '8px' }} aria-label={selected.startsWith('hf:') ? 'Delete and remove model' : 'Delete model files'} disabled={Boolean(busy) || running} onClick={() => void deleteModel(selected)}>
              {busy === 'delete' ? <Loader2 size={15} className="pill-spinner" /> : <Trash2 size={15} />}
              {selected.startsWith('hf:') ? 'Delete & remove' : 'Delete files'}
            </button>
          )}
        </div>
        <p className="muted">{modelLanguageSummary(selected,model?.languages)}</p>
        {model?.engine==='parakeet-tdt'&&<p className="muted">Transcribes speech as spoken, including fillers. Writing cleanup and dictionary replacements apply afterward; vocabulary prompts are unavailable for this model.</p>}
        {!!selectedLanguages?.length&&settings.dictationLanguage!=='auto'&&!modelHasDocumentedLanguage({id:selected,languages:selectedLanguages},settings.dictationLanguage)&&<p className="model-warning" role="alert">This model does not document support for {languageName(settings.dictationLanguage)}. Choose a compatible model before saving.</p>}
        {!!selectedLanguages?.length&&settings.dictationLanguage==='auto'&&selectedLanguages.length<99&&<p className="muted">Automatic detection is limited to this model’s listed languages.</p>}
        <p className="muted">{needsRuntime?'Setup adds the libraries this model needs.':'Select Save settings to switch. The model loads on your next dictation.'}</p>
        {selected==='bodhan-flex'&&!model?.downloaded&&<label>Hugging Face read token<input id="model-hf-token" type="password" className="input" value={accessToken} onChange={event=>setAccessToken(event.target.value)} autoComplete="off" placeholder="Approved Flex access required"/></label>}
        </details>
        <details className="settings-disclosure">
        <summary>Advanced models<span>Custom model imports and technical details</span></summary>
        <label htmlFor="huggingface-model-url" className="muted">Custom Hugging Face model URL</label>
        <div className="model-actions"><input id="huggingface-model-url" className="input" type="text" value={modelUrl} onChange={event => setModelUrl(event.target.value)} placeholder="https://huggingface.co/owner/speech-model" spellCheck={false} />
          <button className="btn btn-secondary" disabled={Boolean(busy) || running || !modelUrl.trim()} onClick={() => void importModel()}>{busy === 'import' ? <Loader2 size={15} className="pill-spinner" /> : <Download size={15} />}Download URL</button></div>
        <p className="muted"><strong>Supported models:</strong> Whisper and Transformers Parakeet TDT checkpoints, including Bark Pro. Other architectures need an additional backend.</p>
        <p className="muted"><strong>Setup:</strong> Full Whisper and Parakeet models need a Full speech package. Choose Set up model when additional libraries are needed.</p>
        <p className="muted"><strong>Access:</strong> Flex requires Hugging Face approval to download. Downloaded models run offline.</p>
        <p className="muted"><strong>Languages:</strong> Bark Pro supports English; Trelis supports Hindi, English and Hinglish; Flex supports 27 languages. Other custom models need declared language coverage for automatic selection.</p>
        </details>
        <details className="settings-disclosure">
        <summary>Model details<span>Storage location and processing information</span></summary>
        <p className="muted">Documented languages: {(documentedModelLanguages(settings.localSttModel)||currentModel?.languages)?.map(languageName).join(', ')||'Not recorded for this custom checkpoint.'}</p>
        {catalogue.speech.loaded_model && <p className="muted">Loaded: {catalogue.speech.loaded_model.replace(/^hf:/, '')}</p>}
        {catalogue.speech.runtime?.device && <p className="muted">{catalogue.speech.runtime.device.toUpperCase()} · {catalogue.speech.runtime.compute_type}</p>}
        {catalogue.speech.cache_directory && <p className="muted">Model folder: {catalogue.speech.cache_directory}</p>}
        </details>
      </>}
      {speechJobs.filter(job => job.status !== 'ready').map(job => <p key={job.id} className={job.status === 'failed' ? 'model-warning' : 'muted'} role="status">{modelName(job.model)}: {job.error || job.status}</p>)}
      {setup&&setup.state!=='idle'&&<SetupProgress status={setup} onCancel={()=>void (window as any).api.cancelLocalSetup().then(()=>refresh()).catch((error:Error)=>setError(error.message))}/>}
    </div>}
    {section !== 'speech' && (section === 'formatting' || settings.writingProvider === 'local') && <details open={section === 'formatting' ? true : undefined} className="settings-disclosure optional-formatting">
      <summary>Ollama model<span>Local Writing AI</span></summary>
      <p className="muted">{catalogue?.formatting.online ? `Ollama · ${settings.localLlmModel || 'No model'} · ${installed ? 'Available' : 'Download needed'}` : 'Ollama is not connected. Start it and install a model to enable local Writing AI.'}</p>
      <label htmlFor="installed-formatting-model" className="settings-field-label">Installed Ollama models</label>
      <div className="model-actions">
        <select id="installed-formatting-model" className="select" value={installedSelection} disabled={Boolean(busy) || refreshing || !catalogue?.formatting.online || installedModels.length === 0} onChange={event=>{setFormatting(event.target.value);onSettingsChange({localLlmModel:event.target.value});setMessage('Model selected. Save settings to apply.');}}>
          <option value="" disabled>{!catalogue ? 'Checking models…' : !catalogue.formatting.online ? 'Ollama unavailable' : installedModels.length ? 'Select a model' : 'No models installed'}</option>
          {installedModels.map(name => <option key={name} value={name}>{name}{name === settings.localLlmModel || name === settings.localLlmModel + ':latest' ? ' · In use' : ''}</option>)}
        </select>
        {section === 'both' && <button className="btn btn-secondary" disabled={refreshing} onClick={() => void refresh(true)}><RefreshCw size={15}/>{refreshing ? 'Refreshing…' : 'Refresh models'}</button>}
      </div>
      <p className="muted">Choose an installed model, then select Save settings.</p>
      <>
        <label htmlFor="formatting-model" className="muted">Model name</label>
        <div className="model-actions"><input id="formatting-model" className="input" value={formatting} onChange={event=>{setFormatting(event.target.value);onSettingsChange({localLlmModel:event.target.value});}} placeholder="e.g. llama3.2" />
          <button className="btn btn-secondary" disabled={Boolean(busy) || !catalogue?.formatting.online || catalogue.pulls.some(job => job.state === 'running') || !formatting.trim()} onClick={() => void pull()}><Download size={15} />Download model</button>
</div>
      </>
      {!catalogue?.formatting.online && <p className="muted">Start Ollama, then select Refresh models.</p>}
      {formattingJobs.map(job => <p key={job.id} className={job.state === 'failed' ? 'model-warning' : 'muted'} role="status">{job.model}: {job.error || job.status}{job.total && job.completed !== undefined ? ` · ${Math.round(job.completed / job.total * 100)}%` : ''}</p>)}
    </details>}
    {error && <p className="model-warning" role="alert">{error}</p>}
    {message && <p className="model-success" role="status">{message}</p>}
  </section>;
}
