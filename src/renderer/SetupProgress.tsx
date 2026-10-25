import React, {useEffect,useState} from 'react';
import type {LocalSetupStatus} from '../shared/localSetup';

export function setupDuration(milliseconds:number):string {
  const seconds=Math.max(0,Math.floor(milliseconds/1000));
  return seconds<60?`${seconds}s`:`${Math.floor(seconds/60)}m ${seconds%60}s`;
}

export function SetupProgress({status,onCancel}:{status:LocalSetupStatus;onCancel:()=>void}) {
  const [now,setNow]=useState(Date.now);
  const running=status.state==='running';
  useEffect(()=>{setNow(Date.now());if(!running)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[running,status.startedAt]);
  const end=running?now:status.finishedAt??now;
  const elapsed=status.startedAt===undefined?undefined:setupDuration(end-status.startedAt);
  const quiet=status.lastActivityAt===undefined?undefined:Math.max(0,now-status.lastActivityAt);
  const transferSeconds=status.transferStartedAt?Math.max(0,(now-status.transferStartedAt)/1000):0;
  const speed=running&&status.received&&transferSeconds>=2&&quiet!==undefined&&quiet<10000?status.received/transferSeconds:undefined;
  const remaining=speed&&status.total&&status.total>status.received!?(status.total-status.received!)/speed:undefined;
  const measured=typeof status.progress==='number'&&Number.isFinite(status.progress);
  const waiting=running&&quiet!==undefined&&quiet>=60000;
  return <div className={`setup-progress ${status.state}`} aria-label="Speech setup progress">
    <strong role="status">{status.message}</strong>
    {running&&<progress aria-label="Current step progress" {...(measured?{value:Math.max(0,Math.min(1,status.progress!)),max:1}:{})}/>}
    <div className="setup-progress-facts">
      {elapsed&&<span>Elapsed {elapsed}</span>}
      {running&&status.stageStartedAt!==undefined&&<span>This step {setupDuration(now-status.stageStartedAt)}</span>}
      {running&&measured&&<span>{Math.round(Math.max(0,Math.min(1,status.progress!))*100)}% of this step</span>}
    </div>
    {running&&status.received!==undefined&&<span>{(status.received/1024**2).toFixed(1)} MB {status.stage==='copying'?'copied':'downloaded'}{status.total?` of ${(status.total/1024**2).toFixed(1)} MB`:''}{speed?` · ${(speed/1024**2).toFixed(1)} MB/s`:''}{remaining!==undefined?` · about ${setupDuration(remaining*1000)} left for this transfer`:''}</span>}
    {running&&status.activity&&<p className="setup-current-activity">{status.activity}</p>}
    {running&&!measured&&<p className="muted">{['libraries','pytorch'].includes(status.stage)?'Library downloads and installation can take several minutes, especially for NVIDIA support.':'This step does not report a completion percentage.'} Remaining time is unavailable for this step.</p>}
    {running&&quiet!==undefined&&<p className={waiting?'model-warning':'muted'}>{waiting?`No new installer output for ${setupDuration(quiet)}. It may still be unpacking or checking libraries. Open details to inspect the last activity; this does not confirm a stall.`:`Last activity ${setupDuration(quiet)} ago`}</p>}
    {status.error&&<p className="shortcut-error" role="alert">{status.error}</p>}
    {!!status.log.length&&<details><summary>Installation details</summary><pre>{status.log.join('\n')}</pre></details>}
    {running&&<button type="button" className="btn btn-secondary" disabled={status.stage==='connecting'} onClick={onCancel}>Cancel setup</button>}
  </div>;
}
