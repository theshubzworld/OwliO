import React, { useState } from 'react';
import { Palette, Check } from 'lucide-react';
import { BAR_DESIGNS, normalizeBarDesign, type BarDesign } from '../shared/barDesigns';
import { BarAvatar } from './BarAvatar';

export function AppearanceSettings({ design, onSaved }: { design: BarDesign; onSaved: (design: BarDesign) => void }) {
  const [preview, setPreview] = useState<BarDesign | null>(null);
  const selected = normalizeBarDesign(design);
  const choose = (next: BarDesign) => { if(next!==selected) onSaved(next); };
  return <section className="card appearance-settings" aria-labelledby="appearance-heading">
    <div className="shortcut-heading"><Palette size={20} style={{ color: 'var(--c-76608c)' }} /><h3 id="appearance-heading">Appearance</h3></div>
    <p className="muted">Choose a floating bar design. Hover or focus to preview it.</p>
    <div className="appearance-options" role="group" aria-label="Bar design">
      {BAR_DESIGNS.map(item => <label key={item.id} className={`appearance-option${selected === item.id ? ' selected' : ''}`}
        onMouseEnter={() => setPreview(item.id)} onMouseLeave={() => setPreview(null)}>
        <input className="sr-only" type="radio" name="bar-design" value={item.id} checked={selected === item.id}
          onChange={() => void choose(item.id)} onFocus={() => setPreview(item.id)} onBlur={() => setPreview(null)} />
        <span className="appearance-preview"><BarAvatar design={item.id} state={preview === item.id ? 'listening' : 'idle'} awake={preview === item.id} volume={.55} /></span>
        <span className="appearance-title">{item.name}{selected === item.id && <Check size={15} aria-hidden="true" />}</span>
        <span className="appearance-description">{item.description}</span>
      </label>)}
    </div>
    <p className="muted" role="status">{`Selected bar: ${BAR_DESIGNS.find(item => item.id === selected)?.name}. Save settings to apply.`}</p>
  </section>;
}
