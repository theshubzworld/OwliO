import React, { useEffect, useRef, useState } from 'react';
import { Check, Keyboard, Key, Radio } from 'lucide-react';
import { formatShortcut, normalizeShortcut } from '../shared/shortcuts';

type Props = {
  shortcut: string;
  mode: 'push_to_talk' | 'toggle';
  onShortcutChange: (shortcut: string) => void;
  onModeChange: (mode: 'push_to_talk' | 'toggle') => void;
};

export function ShortcutSettings({ shortcut, mode, onShortcutChange, onModeChange }: Props) {
  const [activity, setActivity] = useState<'capture' | 'test' | null>(null);
  const [feedback, setFeedback] = useState('');
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState('');
  const onChangeRef = useRef(onShortcutChange);
  useEffect(() => { onChangeRef.current = onShortcutChange; }, [onShortcutChange]);
  useEffect(() => { setVerified(false); setFeedback(''); setError(''); }, [shortcut, mode]);
  useEffect(() => {
    const api = (window as any).api;
    const cleanup = api.onShortcutFeedback((message: any) => {
      switch (message.name) {
        case 'shortcut_candidate': setFeedback(message.shortcut ? formatShortcut(message.shortcut) : 'Press your shortcut…'); break;
        case 'shortcut_captured':
          onChangeRef.current(message.shortcut);
          setActivity(null);
          break;
        case 'shortcut_test_progress': setFeedback(message.message); break;
        case 'shortcut_tested':
          setActivity(null); setVerified(true);
          setFeedback(message.mode === 'toggle' ? 'Verified: both presses were detected.' : 'Verified: press and release were detected.');
          break;
        case 'shortcut_cancelled':
          setActivity(null); setFeedback('');
          if (message.message !== 'Cancelled') setError(message.message);
          break;
      }
    });
    return () => { cleanup(); void api.cancelShortcut().catch(() => {}); };
  }, []);

  const start = async (type: 'capture' | 'test') => {
    setError(''); setVerified(false); setActivity(type);
    setFeedback(type === 'capture' ? 'Press your shortcut, then release. Esc cancels.' : mode === 'toggle' ? 'Press your shortcut twice. Esc cancels.' : 'Hold your shortcut, then release. Esc cancels.');
    try {
      if (type === 'capture') await (window as any).api.beginShortcutCapture();
      else await (window as any).api.beginShortcutTest(normalizeShortcut(shortcut), mode);
    } catch (failure) {
      setActivity(null); setFeedback(''); setError(failure instanceof Error ? failure.message : 'Could not start shortcut verification.');
    }
  };

  return (
    <div className="card shortcut-card">
      <div className="shortcut-heading"><Key size={20} style={{ color: 'var(--c-76608c)' }} /><h3>Start and stop dictation</h3></div>
      <p className="shortcut-description">Choose a shortcut and how it works.</p>
      <div className="shortcut-fields">
        <div>
          <label htmlFor="dictation-shortcut">Dictation shortcut</label>
          <div className="shortcut-input-row">
            <input id="dictation-shortcut" className="input" value={shortcut} disabled={activity !== null}
              placeholder="Ctrl+Win" onChange={(event) => onShortcutChange(event.target.value)} spellCheck={false} />
            <button className="btn btn-secondary" disabled={activity !== null} onClick={() => void start('capture')}><Keyboard size={15} />Choose keys</button>
          </div>
        </div>
        <div>
          <label htmlFor="dictation-mode">How the shortcut works</label>
          <select id="dictation-mode" className="select" value={mode} disabled={activity !== null}
            onChange={(event) => onModeChange(event.target.value as Props['mode'])}>
            <option value="push_to_talk">Hold to speak</option>
            <option value="toggle">Press to start / stop</option>
          </select>
        </div>
      </div>
      <div className="shortcut-presets">Suggested shortcuts:
        {['Ctrl+Win', 'Ctrl+Shift+Space', 'F8', 'RALT'].map(value => <button key={value} type="button" disabled={activity !== null}
          onClick={() => onShortcutChange(value)}>{formatShortcut(value)}</button>)}
      </div>
      <div className="shortcut-test-row">
        {activity ? <button className="btn btn-secondary" onClick={() => void (window as any).api.cancelShortcut().catch((failure: Error) => { setActivity(null); setError(failure.message); })}>Cancel</button> :
          <button className="btn btn-secondary" onClick={() => void start('test')}>{verified ? <Check size={15} /> : <Radio size={15} />}Test shortcut</button>}
        <span className={verified ? 'shortcut-feedback verified' : 'shortcut-feedback'} role="status">{feedback || 'Test your shortcut without recording.'}</span>
      </div>
      {error && <p className="shortcut-error" role="alert">{error}</p>}
    </div>
  );
}
