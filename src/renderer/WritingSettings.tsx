import React,{useEffect,useState} from 'react';
import type { AppSettings } from '../main/store';
import { usesHindiConversion } from '../shared/speechLanguages';
import { LocalModels } from './LocalModels';

export function WritingSettings({settings,onChange}:{settings:AppSettings;onChange:(patch:Partial<AppSettings>)=>void}) {
  const writer=settings.writingProvider || 'off';
  const [localReady,setLocalReady]=useState(false);
  useEffect(()=>{
    let alive=true;let timer:ReturnType<typeof setTimeout>;
    setLocalReady(false);
    const check=async()=>{
      try {const data=await (window as any).api.getLocalModels();if(alive)setLocalReady(data.formatting.online&&data.formatting.models?.some((model:{name:string})=>model.name===settings.localLlmModel||model.name===settings.localLlmModel+':latest'));} catch {if(alive)setLocalReady(false);}
      if(alive)timer=setTimeout(check,3000);
    };
    if(writer==='local')void check();
    return()=>{alive=false;clearTimeout(timer);};
  },[writer,settings.localLlmModel,settings.localLlmUrl]);
  const ready=writer==='gemini'?!!settings.geminiApiKey.trim():writer==='local'&&localReady;
  const chooseWriter=(writingProvider:AppSettings['writingProvider'])=>onChange({writingProvider,formattingProvider:'basic',instructModeEnabled:false});
  return <>
    <section className="card" aria-labelledby="output-heading">
      <h3 id="output-heading">Hindi output</h3>
      <label className="settings-field-label" htmlFor="romanization-provider">How Hindi words are written</label>
      <select id="romanization-provider" className="select" aria-describedby="hindi-output-help" value={settings.romanizationProvider} onChange={event=>onChange({romanizationProvider:event.target.value as AppSettings['romanizationProvider']})}>
        <option value="off">Original script</option><option value="gemini">English letters</option>
      </select>
      <p id="hindi-output-help" className="muted">{settings.romanizationProvider==='gemini'?'Uses Gemini for Hindi and Hinglish. English stays unchanged.':'Keep the script returned by your speech model.'}</p>
      {settings.romanizationProvider==='gemini'&&!usesHindiConversion(settings.dictationLanguage)&&<p className="muted" role="status">Hindi conversion is inactive for this spoken-language setting. Choose Hindi or Hinglish in Speech &amp; models to use it.</p>}
    </section>
    <section className="card" aria-labelledby="cleanup-heading">
      <h3 id="cleanup-heading">Text cleanup</h3>
      <label className="settings-field-label" htmlFor="formatting-provider">Cleanup</label>
      <select id="formatting-provider" className="select" aria-describedby="cleanup-help" value={settings.formattingProvider==='basic'?'basic':'ai'} onChange={event=>onChange({formattingProvider:event.target.value as AppSettings['formattingProvider']})}>
        <option value="basic">Basic</option><option value="ai" disabled={writer!=='gemini'||!ready}>Gemini cleanup</option>
      </select>
      <p id="cleanup-help" className="muted">{settings.formattingProvider==='basic'?'Adjust capitalization and punctuation offline.':'Clean up wording using your selected tone. Language and meaning are preserved.'} {(writer!=='gemini'||!ready)&&'Connect Gemini below to enable AI cleanup. Ollama supports rewrites and meeting summaries.'}</p>
    </section>
    <section className="card writing-connection" aria-labelledby="writing-ai-heading">
      <h3 id="writing-ai-heading">Writing AI</h3>
      <p className="muted">Gemini handles AI cleanup, voice rewrites and meeting summaries. Ollama is available for rewrites and meeting summaries.</p>
      <label className="settings-field-label" htmlFor="writing-provider">Connection</label>
      <select id="writing-provider" className="select" value={writer} onChange={event=>chooseWriter(event.target.value as AppSettings['writingProvider'])}>
        <option value="off">Not connected</option><option value="gemini">Gemini</option>
        {!['off','gemini'].includes(writer)&&<option value={writer}>Ollama (local)</option>}
      </select>
      {(writer==='gemini'||settings.romanizationProvider==='gemini')&&<>
        <label className="settings-field-label" htmlFor="gemini-api-key">Gemini Vertex API key</label>
        <input id="gemini-api-key" className="input" type="password" autoComplete="off" spellCheck={false} value={settings.geminiApiKey} onChange={event=>onChange({geminiApiKey:event.target.value})}/>
        <p className="muted">Shared with Hindi conversion. Stored with Windows encryption. Gemini receives text for processing.</p>
      </>}
      <label className="structure-toggle"><input type="checkbox" aria-label="Rewrite text with voice commands" checked={settings.instructModeEnabled} disabled={!ready&&!settings.instructModeEnabled} onChange={event=>onChange({instructModeEnabled:event.target.checked})}/>Rewrite selected text with voice commands</label>
      <p className="muted">Select text, then say “make it formal.”</p>
      <details className="settings-disclosure settings-advanced"><summary>Advanced Writing AI<span>Local Ollama models</span></summary>
        <p className="muted">When both are enabled, Hindi conversion runs before AI cleanup. Cloud providers may charge for usage.</p>
        <label className="settings-field-label" htmlFor="advanced-writing-provider">Writing AI provider</label>
        <select id="advanced-writing-provider" className="select" value={writer} onChange={event=>chooseWriter(event.target.value as AppSettings['writingProvider'])}>
          <option value="off">Not connected</option><option value="gemini">Gemini</option><option value="local">Ollama (local)</option>
        </select>
        {writer==='local'&&<><label className="settings-field-label" htmlFor="local-llm-url">Ollama server address</label><input id="local-llm-url" className="input" value={settings.localLlmUrl} onChange={event=>onChange({localLlmUrl:event.target.value})}/><p className="muted">Save a changed server address before checking or downloading models.</p><LocalModels section="formatting" settings={settings} onSettingsChange={onChange}/></>}
      </details>
    </section>
  </>;
}
