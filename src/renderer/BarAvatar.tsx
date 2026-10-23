import React, { useId } from 'react';
import { normalizeBarDesign, type BarDesign, type BarState } from '../shared/barDesigns';
import { OwlAvatar } from './OwlAvatar';

type Props = { design?: BarDesign; state?: BarState; awake?: boolean; volume?: number };

// Presentation only: every design fits the original 32px avatar and uses the same controls.
export function BarAvatar({ design = 'owl', state = 'idle', awake = false, volume = 0 }: Props) {
  const gradient = useId();
  const selected = normalizeBarDesign(design);
  const level = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0;
  const resting = state === 'idle' && !awake;
  const accent = state === 'error' ? '#E49883' : state === 'pasted' ? '#99CDAE' : '#7CAFA7';
  if (selected === 'owl') return <OwlAvatar state={state} awake={awake} />;
  const eyes = (left: number, right: number, y: number) => resting
    ? <path d={`M${left - 2} ${y}q2 2 4 0m${right - left - 4} 0q2 2 4 0`} fill="none" stroke="#493947" strokeWidth="1.5" strokeLinecap="round" />
    : <g className="companion-eyes"><circle cx={left} cy={y} r="1.9" fill="#493947" /><circle cx={right} cy={y} r="1.9" fill="#493947" /></g>;

  return <svg className={`bar-avatar design-${selected} ${state}${awake ? ' awake' : ''}`} viewBox="0 0 40 40" aria-hidden="true" focusable="false"
    style={{ '--voice': level } as React.CSSProperties}>
    {selected === 'cat' && <>
      <ellipse cx="20" cy="36" rx="13" ry="1.3" fill="#5C3E3C" opacity=".14" />
      <g className="cat-body"><ellipse cx="21" cy="27" rx="14" ry="8.5" fill="#D5B297" stroke="#745A50" strokeWidth="1.2" />
        <path d="M29 24c9 0 9 10 0 10H19" fill="none" stroke="#AB8070" strokeWidth="4.5" strokeLinecap="round" />
        <path className="cat-ears" d="m8 19-1-9 8 5h7l7-5-1 10" fill="#D5B297" stroke="#745A50" strokeWidth="1.2" strokeLinejoin="round" />
        <path d="m10 15-1-3 4 3m11 0 3-3-1 4" fill="#E5A8A4" />
        <ellipse cx="18" cy="22" rx="12" ry="9" fill="#E8CBB0" stroke="#745A50" strokeWidth="1.2" />
        {eyes(13, 23, 21)}<path d="m16.5 24 1.5 1.6 1.5-1.6" fill="#B3777D" />
        <path className="cat-whiskers" d="m6 23 5 1m-5 2 5-1m14-1 5-1m-5 2 5 1" stroke="#947161" strokeWidth="1" strokeLinecap="round" />
        <path d="M16 27q2 1 4 0" fill="none" stroke="#947161" strokeWidth="1" strokeLinecap="round" />
      </g>
    </>}
    {selected === 'cloud' && <g className="cloud-body">
      <path d="M10 31C1 31 2 18 10 18c-1-10 13-13 17-4 10-2 14 16 3 17Z" fill="#E1EBF3" stroke="#8399AD" strokeWidth="1.3" />
      {eyes(15, 25, 23)}<path d="M18 27q2 2 4 0" fill="none" stroke="#72879B" strokeWidth="1.3" strokeLinecap="round" />
      <ellipse cx="11" cy="26" rx="2" ry="1" fill="#EDBFCC" /><ellipse cx="29" cy="26" rx="2" ry="1" fill="#EDBFCC" />
      {state === 'processing' && <g className="cloud-dots" fill="#8399AD"><circle cx="15" cy="35" r="1" /><circle cx="20" cy="35" r="1" /><circle cx="25" cy="35" r="1" /></g>}
    </g>}
    {selected === 'robot' && <>
      <path d="M20 9V5" stroke="#608F8B" strokeWidth="2" /><circle className="robot-light" cx="20" cy="4" r="2.3" fill="#E4B37C" />
      <rect x="3" y="18" width="4" height="10" rx="2" fill="#83B0A7" /><rect x="33" y="18" width="4" height="10" rx="2" fill="#83B0A7" />
      <rect x="6" y="10" width="28" height="25" rx="8" fill="#BBD9CD" stroke="#608F8B" strokeWidth="1.3" />
      <rect x="10" y="15" width="20" height="16" rx="5" fill="#EAF2E8" />{eyes(15, 25, 21)}
      <rect className="robot-mouth" x="16" y={26 - (state === 'listening' ? level * 1.5 : 0)} width="8" height={state === 'listening' ? 2 + level * 3 : 2} rx="1" fill="#608F8B" />
    </>}
    {selected === 'waveform' && <>
      <rect x="2" y="11" width="36" height="18" rx="9" fill="#294A47" stroke="#759C93" strokeWidth="1" />
      {[.4, .75, 1, .7, .35].map((scale, index) => {
        const height = state === 'listening' ? 4 + level * 12 * scale : resting ? 3 + scale * 2 : 4 + scale * 9;
        return <rect className="mini-wave" key={index} x={10 + index * 4.5} y={20 - height / 2} width="2.5" height={height} rx="1.25" fill={state === 'listening' ? '#B4DED1' : accent} style={{ animationDelay: `${index * 100}ms` }} />;
      })}
    </>}
    {selected === 'pebble' && <>
      <defs><radialGradient id={gradient}><stop offset="0" stopColor="#F0E8FF" /><stop offset=".55" stopColor="#BCA8D6" /><stop offset="1" stopColor="#725C94" /></radialGradient></defs>
      <ellipse className="pebble-glow" cx="20" cy="22" rx={16 + level * 2} ry={10 + level * 2} fill="#C2ADDE" opacity={state === 'listening' ? .2 + level * .5 : .16} />
      <ellipse className="pebble-body" cx="20" cy="22" rx="14" ry="8" fill={`url(#${gradient})`} stroke="#78608F" strokeWidth="1" />
      <path d="M12 19q6-4 13-1" fill="none" stroke="#FFF8FF" strokeWidth="1.3" strokeLinecap="round" opacity=".65" />
    </>}
    {selected === 'firefly' && <>
      <defs><radialGradient id={gradient}><stop offset="0" stopColor="#F8D882" stopOpacity=".7" /><stop offset="1" stopColor="#F8D882" stopOpacity="0" /></radialGradient></defs>
      <circle className="firefly-glow" cx="20" cy="26" r="13" fill={`url(#${gradient})`} opacity={resting ? .3 : .7 + level * .3} />
      <g className="firefly-body"><g transform="rotate(-28 11 20)"><ellipse className="firefly-wing left" cx="11" cy="20" rx="7" ry="4" fill="#E2ECE0" stroke="#92AAA1" strokeWidth="1" /></g>
        <g transform="rotate(28 29 20)"><ellipse className="firefly-wing right" cx="29" cy="20" rx="7" ry="4" fill="#E2ECE0" stroke="#92AAA1" strokeWidth="1" /></g>
        <ellipse cx="20" cy="26" rx="6" ry="8" fill={resting ? '#C4AD70' : '#ECCD77'} stroke="#8A784D" strokeWidth="1.2" />
        <path d="M16 26h8m-7 4h6m-6-16-3-5m9 5 3-5" fill="none" stroke="#8A784D" strokeWidth="1" strokeLinecap="round" />
        <circle cx="20" cy="16" r="6" fill="#BACAC1" stroke="#748D81" strokeWidth="1.2" />{eyes(18, 22, 16)}
      </g>
    </>}
    {state !== 'idle' && <g className="companion-status">
      <circle cx="33" cy="31" r="5.5" fill={state === 'listening' ? '#EDA4A1' : state === 'pasted' ? '#AED7BB' : '#F3D09A'} stroke="#59404E" strokeWidth="1" />
      {state === 'listening' ? <circle className="companion-record-dot" cx="33" cy="31" r="2" fill="#7C4053" /> :
        state === 'starting' || state === 'processing' ? <path className="companion-thinking" d="M33 28a3 3 0 0 1 3 3" fill="none" stroke="#715048" strokeWidth="1.6" strokeLinecap="round" /> :
        state === 'pasted' ? <path d="m30.5 31 1.7 1.7 3.6-3.6" fill="none" stroke="#3F6650" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /> :
        <path d="M33 28.5v2.8m0 2v.1" stroke="#8D4D3E" strokeWidth="1.7" strokeLinecap="round" />}
    </g>}
  </svg>;
}
