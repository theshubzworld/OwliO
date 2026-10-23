import React, {useEffect,useState} from 'react';
import type {AppSettings} from '../main/store';
import type {LocalSetupStatus} from '../shared/localSetup';
import {LocalModels} from './LocalModels';
import {LocalSetupPanel} from './LocalSetup';

export function LocalSpeechSettings({settings,currentModel,onChange,onConnected,onOpenWizard}:{settings:AppSettings;currentModel?:string;onChange:(patch:Partial<AppSettings>)=>void;onConnected:(patch:Partial<AppSettings>)=>void;onOpenWizard:()=>void}) {
  const [status,setStatus]=useState<LocalSetupStatus|null>(null);
  const [error,setError]=useState('');
  useEffect(()=>{
    let alive=true;
    const accept=(next:LocalSetupStatus)=>{if(alive)setStatus(previous=>(previous?.revision||0)>(next.revision||0)?previous:next);};
    const api=(window as any).api;
    const off=api.onLocalSetupStatus(accept);
    void api.getLocalSetup().then(accept).catch((error:Error)=>{if(alive)setError(error.message);});
    return()=>{alive=false;off();};
  },[]);
  if(error)return <p role="alert">{error}</p>;
  if(!status)return <p role="status">Checking local speech…</p>;
  const manage=()=>{
    const picker=document.querySelector<HTMLDetailsElement>('.models-page .model-picker');
    if(picker){picker.open=true;picker.scrollIntoView({block:'center',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});picker.querySelector<HTMLSelectElement>('select')?.focus({preventScroll:true});}
  };
  const setup=<LocalSetupPanel initialModel={settings.localSttModel} initialLanguage={settings.dictationLanguage} currentModel={currentModel} onConnected={onConnected} onManageModels={status.runtimeConfigured?manage:undefined} onOpenWizard={onOpenWizard}/>;
  return status.runtimeConfigured?<>
    <LocalModels section="speech" settings={settings} onSettingsChange={onChange}/>
    <details className="settings-disclosure settings-advanced"><summary>Advanced local speech<span>Repair, storage and diagnostics</span></summary>{setup}</details>
  </>:setup;
}
