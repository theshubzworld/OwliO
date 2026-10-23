import React from 'react';

export function PrivacySettings() {
  return <section className="card privacy-settings" aria-labelledby="privacy-heading">
    <h3 id="privacy-heading">Privacy</h3>
    <p className="muted">What leaves this computer depends on the providers you choose.</p>
    <details className="settings-disclosure">
      <summary>What Owlio sends and saves</summary>
      <dl>
        <dt><strong>Speech recognition</strong></dt>
        <dd>Local models process audio on this computer. Groq receives audio when selected as your speech provider.</dd>
        <dt><strong>Hindi output</strong></dt>
        <dd>English-letter output sends Hindi text to Gemini. It runs only with Hindi or Hinglish selected.</dd>
        <dt><strong>Text cleanup</strong></dt>
        <dd>Basic cleanup runs locally. Gemini cleanup receives dictated text, relevant writing rules, approved vocabulary and an app category.</dd>
        <dt><strong>Rewrites and meeting summaries</strong></dt>
        <dd>Cloud Writing AI receives the selected text and spoken command for rewrites, or the meeting transcript for summaries. Ollama processes these on your local server.</dd>
        <dt><strong>Correction learning</strong></dt>
        <dd>When correction learning is enabled, Owlio checks edits in the same focused field for up to 30 seconds after pasting. With Gemini Writing AI configured, changed spelling candidates are sent for review. Password fields are excluded. Other suggestions wait for your approval in Dictionary.</dd>
        <dt><strong>Saved data</strong></dt>
        <dd>History, writing rules and vocabulary are saved on this computer. Audio is retained when Save audio recordings is enabled. API keys use Windows encryption. Cloud providers apply their own data policies and usage limits.</dd>
        <dt><strong>Required account, agreement and basic usage reporting</strong></dt>
        <dd>Sign-in and accepted Terms of Use are required for the free official app. Basic reporting starts after acceptance and shares counts, timings and feature categories with a random installation ID, without your audio, text or account email in usage events. Account and agreement records are stored separately. Signing out stops reporting and locks app access. Read the documents in Account &amp; privacy.</dd>
      </dl>
    </details>
  </section>;
}
