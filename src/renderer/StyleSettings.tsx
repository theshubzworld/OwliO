import React from 'react';
import type { AppSettings } from '../main/store';

const tones: {id:AppSettings['writingStyle'];title:string;description:string;example:string}[] = [
  {id:'auto',title:'Natural',description:'Keep your own tone and wording.',example:'Hey Rahul, please send the report before tomorrow’s meeting.'},
  {id:'professional',title:'Professional',description:'Polished wording and complete punctuation.',example:'Hi Rahul, please send the report before tomorrow’s meeting.'},
  {id:'casual',title:'Casual',description:'Relaxed, conversational wording.',example:'Hey Rahul, send the report before tomorrow’s meeting.'},
  {id:'code',title:'Technical',description:'Preserve identifiers, capitalization and code symbols.',example:'Pass userId to fetchUserProfile, then check the response.'},
];

export function StyleSettings({settings,onChange,onOpenSettings}:{settings:AppSettings;onChange:(patch:Partial<AppSettings>)=>void;onOpenSettings:()=>void}) {
  const provider=settings.formattingProvider||'basic';
  const ai=provider!=='basic'&&settings.writingProvider!=='off';
  const gemini=ai&&settings.writingProvider==='gemini';
  return <>
    {!ai && <div className="style-provider-note"><p>Basic punctuation can adjust capitalization and sentence endings. Tone, custom writing rules and smart lists need AI cleanup.</p><button type="button" className="btn btn-secondary" onClick={onOpenSettings}>Set up AI cleanup</button></div>}
    <section className="card" aria-labelledby="tone-heading">
      <h3 id="tone-heading">Writing tone</h3>
      <p className="muted">One default tone for your dictations. Use writing preferences below for rules in particular apps.</p>
      <fieldset disabled={!ai} className="tone-options" role="group" aria-label="Writing tone">
        {tones.map(tone=><button type="button" key={tone.id} data-style={tone.id} aria-pressed={settings.writingStyle===tone.id} className={`tone-option${settings.writingStyle===tone.id?' selected':''}`} onClick={()=>onChange({writingStyle:tone.id})}>
          <span className="tone-title">{tone.title}<span aria-hidden="true" className="tone-selection">{settings.writingStyle===tone.id?'✓':''}</span></span>
          <span className="tone-description">{tone.description}</span>
          <span className="tone-example">{tone.example}</span>
        </button>)}
      </fieldset>
      <p className="muted">Examples are illustrative. Results depend on what you say.</p>
    </section>
    <section className="card" aria-labelledby="structure-heading">
      <h3 id="structure-heading">Cleanup &amp; structure</h3>
      <p className="muted">Gemini fixes punctuation, removes fillers and resolves spoken corrections while keeping your details.</p>
      <label className="structure-toggle" htmlFor="gemini-structured-formatting"><input id="gemini-structured-formatting" type="checkbox" checked={settings.geminiStructuredFormatting!==false} disabled={!gemini} onChange={event=>onChange({geminiStructuredFormatting:event.target.checked})}/>Automatically organize lists and steps</label>
      <p className="muted" id="list-formatting-help">{gemini?'Use bullets for lists and numbers for steps. Turn off to keep dictation as paragraphs.':settings.writingProvider==='gemini'?'Enable AI cleanup under Output & cleanup to organize lists.':'Connect Gemini and enable AI cleanup to organize lists automatically.'}</p>
      <div className="style-example" aria-label="List formatting example"><span>Example when enabled</span><p>Kal do kaam hain:</p><ul><li>Rahul ko call karna.</li><li>Report bhejna.</li></ul></div>
    </section>
    <details className="settings-disclosure settings-advanced"><summary>Advanced punctuation<span>Spacing and sentence endings</span></summary>
    <section className="card" aria-labelledby="punctuation-heading">
      <h3 id="punctuation-heading">Punctuation &amp; spacing</h3>
      <label className="structure-toggle" htmlFor="context-aware-punctuation"><input id="context-aware-punctuation" type="checkbox" checked={settings.contextAwarePunctuation!==false} aria-describedby="cursor-punctuation-help" onChange={event=>onChange({contextAwarePunctuation:event.target.checked})}/>Match surrounding text</label>
      <p id="cursor-punctuation-help" className="muted">Adjust spacing and capitalization using nearby text when available.</p>
      <label className="settings-field-label" htmlFor="punctuation-mode">Sentence endings</label>
      <select id="punctuation-mode" className="select" value={settings.punctuationMode||'auto'} disabled={settings.contextAwarePunctuation===false} aria-describedby="punctuation-mode-help" onChange={event=>onChange({punctuationMode:event.target.value as AppSettings['punctuationMode']})}><option value="auto">Automatic</option><option value="full">Standard</option><option value="minimal">Minimal</option></select>
      <p id="punctuation-mode-help" className="muted">{settings.contextAwarePunctuation===false?'Turn on Match surrounding text to use these adjustments.':settings.punctuationMode==='full'?'Keep final periods unless the text continues an existing sentence.':settings.punctuationMode==='minimal'?'Omit final periods in short dictations. Keep question marks and exclamation marks.':'Use fewer final periods in short chats. Professional tone keeps them.'}</p>
      <details className="settings-disclosure"><summary>How punctuation works</summary><p className="muted">These adjustments run locally. Technical tone, code and multiline text keep their structure. Spacing and capitalization need reliable cursor information; final-period adjustments can run without it. Cursor text is not sent to Gemini cleanup.</p></details>
    </section>
    </details>
    <p className="style-save-note"><strong>Save settings</strong> applies all pending settings.</p>
  </>;
}
