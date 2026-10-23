import React from 'react';

type Props = { state?: 'idle' | 'starting' | 'listening' | 'processing' | 'pasted' | 'error'; awake?: boolean };

// A small vector keeps the owl crisp at different Windows display scales.
export function OwlAvatar({ state = 'idle', awake = false }: Props) {
  return <svg className={`owl-avatar ${state}${awake ? ' awake' : ''}`} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
    <ellipse cx="20" cy="37" rx="12" ry="1.5" fill="#33232D" opacity=".16" />
    <path d="M13 34v3m3-3v3m8-3v3m3-3v3" stroke="#D9A16B" strokeWidth="2" strokeLinecap="round" />
    <path d="M7 16 6 4l10 5h8l10-5-1 12c5 16-1 20-13 20S2 32 7 16Z" fill="#78586A" stroke="#453340" strokeWidth="1.3" strokeLinejoin="round" />
    <ellipse cx="20" cy="26" rx="10" ry="9" fill="#C6A0A9" />
    <path className="owl-wing owl-wing-left" d="M8 19c-5 3-6 9-2 13 4-1 6-7 2-13Z" fill="#604454" stroke="#453340" strokeWidth="1" />
    <path className="owl-wing owl-wing-right" d="M32 19c5 3 6 9 2 13-4-1-6-7-2-13Z" fill="#604454" stroke="#453340" strokeWidth="1" />
    <path d="M20 13c-6-8-15-2-13 5 1 5 9 7 13 3 4 4 12 2 13-3 2-7-7-13-13-5Z" fill="#FFF0D8" />
    <g className="owl-eyes">
      <ellipse cx="13.5" cy="16.5" rx="3.6" ry="4.2" fill="#352C38" />
      <ellipse cx="26.5" cy="16.5" rx="3.6" ry="4.2" fill="#352C38" />
      <circle cx="14.6" cy="15" r="1.25" fill="#FFF" />
      <circle cx="27.6" cy="15" r="1.25" fill="#FFF" />
      <circle cx="12.7" cy="18" r=".6" fill="#FFF" opacity=".7" />
      <circle cx="25.7" cy="18" r=".6" fill="#FFF" opacity=".7" />
    </g>
    <path className="owl-closed-eyes" d="M10 17q3.5 3 7 0m6 0q3.5 3 7 0" fill="none" stroke="#352C38" strokeWidth="1.8" strokeLinecap="round" />
    <ellipse cx="9.5" cy="22" rx="2.2" ry="1.2" fill="#EEB0AF" opacity=".9" />
    <ellipse cx="30.5" cy="22" rx="2.2" ry="1.2" fill="#EEB0AF" opacity=".9" />
    <path d="m17.5 20 2.5 4 2.5-4q-2.5-2-5 0Z" fill="#EAAF66" />
    <path d="m16 28 1.2 1.2M22.8 28l1.2 1.2M19 31l1 1" fill="none" stroke="#AA7D8D" strokeWidth="1.2" strokeLinecap="round" />
    {state !== 'idle' && <g className="owl-status">
      <circle cx="32" cy="30" r="6" fill={state === 'listening' ? '#E98387' : state === 'pasted' ? '#9ED2B1' : '#F3C789'} stroke="#453340" strokeWidth="1" />
      {state === 'listening' ? <circle className="owl-record-dot" cx="32" cy="30" r="2.4" fill="#633342" /> :
        state === 'processing' || state === 'starting' ? <path className="owl-thinking" d="M32 26.5a3.5 3.5 0 0 1 3.5 3.5" fill="none" stroke="#633E36" strokeWidth="1.8" strokeLinecap="round" /> :
        state === 'pasted' ? <path d="m29 30 2 2 4-4" fill="none" stroke="#315D44" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /> :
        <path d="M32 27v3m0 2v.1" fill="none" stroke="#68423A" strokeWidth="1.8" strokeLinecap="round" />}
    </g>}
  </svg>;
}
