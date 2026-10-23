import React, { useEffect, useState } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import { SPEECH_LANGUAGES,languageName } from '../shared/speechLanguages';
import type { LearnedWord, WritingPreference } from '../main/store';

type Memory = {preferences:WritingPreference[];vocabulary:LearnedWord[]};

export function WritingMemory({ view }: {view:'preferences'|'vocabulary'}) {
  const [memory,setMemory]=useState<Memory>({preferences:[],vocabulary:[]});
  const [rule,setRule]=useState('');
  const [app,setApp]=useState('all');
  const [language,setLanguage]=useState('all');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const api=(window as any).api;
  useEffect(()=>{
    let disposed=false;
    const refresh=()=>api.getWritingMemory().then((value:Memory)=>{if(!disposed)setMemory(value);}).catch(()=>{});
    void refresh();
    const cleanup=api.onWritingMemoryUpdated(refresh);
    return()=>{disposed=true;cleanup();};
  },[]);
  const run=async(action:()=>Promise<Memory>)=>{
    setBusy(true);setError('');
    try{setMemory(await action());}catch(error){setError(error instanceof Error?error.message:'Could not save writing memory.');}finally{setBusy(false);}
  };
  const changePreference=(id:string,remove:boolean)=>run(async()=>{
    const current:Memory=await api.getWritingMemory();
    const preferences=remove?current.preferences.filter(item=>item.id!==id):current.preferences.map(item=>item.id===id?{...item,enabled:!item.enabled}:item);
    return api.setWritingPreferences(preferences);
  });
  return <section className="card writing-memory" aria-label={view==='preferences'?'Saved writing preferences':'Learned spellings'}>
    <h3>{view==='preferences'?'Your writing preferences':'Learned spellings'}</h3>
    <p className="muted">{view==='preferences'?'Rules guide AI cleanup. Requires a Writing AI connection.':'Accepted spellings improve AI cleanup. Review suggestions before they are used.'}</p>
    {view==='preferences'&&<p className="muted">Rules save immediately.</p>}
    {view==='preferences' && <form className="memory-form" onSubmit={event=>{
      event.preventDefault();if(busy||!rule.trim())return;
      if(app!=='all'&&!app.trim()){setError('Enter an app name.');return;}
      void run(async()=>{
        const current:Memory=await api.getWritingMemory();
        const result=await api.setWritingPreferences([...current.preferences,{id:crypto.randomUUID(),text:rule.trim(),app:app.trim()||'all',language,enabled:true}]);
        setRule('');return result;
      });
    }}>
      <label>Writing rule<input className="input" maxLength={300} value={rule} onChange={event=>setRule(event.target.value)} placeholder="For example: Avoid em dashes" required /></label>
      <p className="muted">For example: “Avoid em dashes” or “Keep messages casual.”</p>
      <div className="memory-scopes">
        <label>App<select className="select" aria-label="Rule app scope" value={app==='all'?'all':'specific'} onChange={event=>setApp(event.target.value==='all'?'all':'')}><option value="all">All apps</option><option value="specific">Specific app</option></select></label>
        {app!=='all'&&<label>App name<input className="input" aria-label="Rule app name" maxLength={100} value={app} onChange={event=>setApp(event.target.value)} placeholder="notepad" required /></label>}
        <label>Spoken language<select className="select" aria-label="Rule spoken language" value={language} onChange={event=>setLanguage(event.target.value)}><option value="all">All languages</option>{SPEECH_LANGUAGES.map(item=><option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
        <button className="btn btn-primary" disabled={busy||!rule.trim()}><Plus size={16}/>Save rule</button>
      </div>
      {app!=='all'&&<details className="settings-disclosure"><summary>How app matching works</summary><p className="muted">Use the app’s process name, such as notepad or slack. Browser names apply to every site in that browser.</p></details>}
    </form>}
    <div className="memory-list">
      {(view==='preferences'?memory.preferences:memory.vocabulary).map(item=><div className="memory-row" key={item.id}>
        <div>{'text' in item?<><label className="structure-toggle"><input type="checkbox" checked={item.enabled} disabled={busy} onChange={()=>void changePreference(item.id,false)}/>{item.text}</label><p className="muted">{item.app==='all'?'Every app':item.app} · {item.language==='all'?'All languages':languageName(item.language)}</p></>:<><strong>{item.word}</strong><p className="muted">Corrected from “{item.observedSource}” · {item.status==='learned'?'Learned':'Needs review'}</p></>}</div>
        <div className="memory-actions">
          {'status' in item && item.status==='pending' && <button className="btn btn-secondary" disabled={busy} onClick={()=>void run(()=>api.reviewLearnedWord(item.id,'accept'))}><Check size={14}/>Accept</button>}
          <button className="btn btn-secondary" disabled={busy} aria-label={`${'text' in item?'Delete rule':'Forget spelling'} ${'text' in item?item.text:item.word}`} onClick={()=>void ('text' in item?changePreference(item.id,true):run(()=>api.reviewLearnedWord(item.id,'forget')))}><Trash2 size={14}/>{'text' in item?'Delete':'Forget'}</button>
        </div>
      </div>)}
      {(view==='preferences'?memory.preferences:memory.vocabulary).length===0 && <p className="muted">{view==='preferences'?'No writing rules saved yet.':'No learned spellings yet. Correct a recent dictation in the target app or in Dictation history to get started.'}</p>}
    </div>
    {error && <p className="delivery-error" role="alert">{error}</p>}
  </section>;
}
