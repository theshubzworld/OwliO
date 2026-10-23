import React, { useState } from 'react';
import type { HistoryItem } from '../main/store';

export function HistoryCorrection({item}:{item:HistoryItem}) {
  const [open,setOpen]=useState(false),[draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  if(item.deliveryStatus!=='inserted'||item.isInstruct||item.isMeeting||item.formattedText.length>5000)return null;
  return <div className="history-correction">
    {!open?<button className="btn btn-secondary" onClick={()=>{setDraft(item.editedText||item.formattedText);setMessage('');setOpen(true);}}>Correct this dictation</button>:<form onSubmit={async event=>{
      event.preventDefault();setBusy(true);setMessage('');
      try{
        const result=await (window as any).api.correctDictation(item.id,draft);
        setMessage(result.added?`Saved correction and learned ${result.added} spelling${result.added===1?'':'s'}.`:result.pending?`Saved correction. Review ${result.pending} spelling suggestion${result.pending===1?'':'s'} in Dictionary.`:'Saved correction.');setOpen(false);
      }catch(error){setMessage(error instanceof Error?error.message:'Could not save the correction.');}finally{setBusy(false);}
    }}>
      <label>Corrected version<textarea className="input" maxLength={5000} rows={3} value={draft} onChange={event=>setDraft(event.target.value)} required /></label>
      <p className="muted">This updates history and teaches spellings when learning is enabled. It does not change text already pasted in another app.</p>
      <div className="memory-actions"><button className="btn btn-primary" disabled={busy||!draft.trim()}>{busy?'Checking…':'Save correction'}</button><button type="button" className="btn btn-secondary" disabled={busy} onClick={()=>setOpen(false)}>Cancel</button></div>
    </form>}
    {message&&<p className="muted" role="status">{message}</p>}
  </div>;
}
