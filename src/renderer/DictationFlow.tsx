import React from 'react';
import { usesHindiConversion } from '../shared/speechLanguages';
import { writingProvider } from '../shared/writingConfig';
import type { AppSettings } from '../main/store';
import { speechModelLabel } from '../shared/speechModels';

export function DictationFlow({settings}: {settings: AppSettings}) {
  const local = settings.provider === 'local';
  const speech = local ? (speechModelLabel(settings.localSttModel).split('/').pop() || 'Local model')
    : 'Groq';
  const script = settings.romanizationProvider === 'gemini'&&usesHindiConversion(settings.dictationLanguage) ? 'Roman Hinglish'
    : 'Original script';
  const writer=writingProvider(settings);
  const cleanup=settings.formattingProvider==='basic'||writer!=='gemini'?'Basic punctuation':'Writing AI · Gemini';
  const steps = [
    {title:'Speech recognition', value:speech, detail:local ? 'On this computer'  : 'Audio sent online'},
    {title:'Output script', value:script, detail:settings.romanizationProvider === 'gemini'&&usesHindiConversion(settings.dictationLanguage) ? 'Gemini online · Hindi text only' : 'From your speech model'},
    {title:'Text cleanup', value:cleanup, detail:settings.formattingProvider==='basic'||writer==='local'||writer==='off'?'On this computer':'Recognized text sent online'},
  ];
  return <section className="dictation-flow" aria-label="Dictation flow preview">
    <div className="flow-heading"><strong>Your dictation flow</strong><span>Preview of your choices · save changes to apply</span></div>
    <ol>{steps.map((step,index)=><li key={step.title}><span className="flow-step">{index+1}</span><div><span className="flow-label">{step.title}</span><strong>{step.value}</strong><span className="flow-detail">{step.detail}</span></div></li>)}</ol>
  </section>;
}
