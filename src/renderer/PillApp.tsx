import React, { useEffect, useLayoutEffect, useState, useRef } from 'react';
import { CircleDot, ChevronUp, X } from 'lucide-react';
import { formatShortcut } from '../shared/shortcuts';
import { AudioRecorder } from './audioRecorder';
import { BarAvatar } from './BarAvatar';
import { normalizeBarDesign, type BarDesign } from '../shared/barDesigns';

export const PillApp: React.FC = () => {
  const [state, setState] = useState<'idle' | 'starting' | 'listening' | 'processing' | 'pasted' | 'error'>('idle');
  const [targetApp, setTargetApp] = useState<string>('');
  const [transcription, setTranscription] = useState<string>('');
  const [volume, setVolume] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isInstruct, setIsInstruct] = useState<boolean>(false);
  const [hotkey, setHotkey] = useState('F8');
  const [microphoneLabel, setMicrophoneLabel] = useState('');
  const [barDesign, setBarDesign] = useState<BarDesign>('owl');

  const [hovered, setHovered] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [tooltip, setTooltip] = useState('');
  const collapseRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recorderRef = useRef<AudioRecorder | null>(null);
  const timerRef = useRef<any>(null);
  const timeoutRef = useRef<any>(null);
  const sessionRef = useRef<number | null>(null);
  const [mode, setMode] = useState('push_to_talk');

  useEffect(() => {
    (window as any).api.setPillLayout(expanded, state !== 'idle');
  }, [expanded, state]);

  useEffect(() => {
    const cleanup = (window as any).api.onPillHover((hit: boolean) => {
      if (collapseRef.current) clearTimeout(collapseRef.current);
      collapseRef.current = null;
      setHovered(hit);
      if (hit) setExpanded(true);
      else {
        setTooltip('');
        // Keep the native window large enough for the closing animation to finish.
        const delay = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220;
        collapseRef.current = setTimeout(() => { setExpanded(false); collapseRef.current = null; }, delay);
      }
    });
    return () => { cleanup(); if (collapseRef.current) clearTimeout(collapseRef.current); };
  }, []);

  useLayoutEffect(() => {
    const update = () => {
      const element = document.querySelector('.pill-rest, .pill-controls');
      if (!element) return;
      const { x, y, width, height } = element.getBoundingClientRect();
      (window as any).api.setPillHitArea({ x, y, width, height });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [expanded, state]);

  useEffect(() => {
    const api = (window as any).api;
    let disposed = false;
    let requestedState = 'idle';
    let recordingSessionId: number | null = null;
    let microphoneDeviceId = '';
    let microphoneRevision = 0;
    let appearanceRevision = 0;
    const recorder = new AudioRecorder();
    recorderRef.current = recorder;
    void recorder.prepare().catch(() => {}); // Start retries if background preparation fails.
    const settingsReady = api.getSettings().then((settings: any) => {
      if (!disposed) {
        setHotkey(settings.hotkey); setMode(settings.mode);
        if (!appearanceRevision) setBarDesign(normalizeBarDesign(settings.barDesign));
        if (!microphoneRevision) microphoneDeviceId = settings.microphoneDeviceId || '';
      }
    }).catch(() => {});
    let revision = -1;
    const applyState = async (msg: any, snapshot = false) => {
      snapshot = snapshot || msg.snapshot === true;
      if (disposed || (typeof msg.revision === 'number' && msg.revision <= revision)) return;
      if (typeof msg.revision === 'number') revision = msg.revision;
      if (msg.hotkey) setHotkey(msg.hotkey);
      if (msg.mode) setMode(msg.mode);
      if (typeof msg.barDesign === 'string') { setBarDesign(normalizeBarDesign(msg.barDesign)); appearanceRevision++; }
      if (typeof msg.microphoneDeviceId === 'string') { microphoneDeviceId = msg.microphoneDeviceId; microphoneRevision++; }
      if (!msg.state) return;
      if (!snapshot && msg.state !== 'listening' && msg.sessionId !== undefined && msg.sessionId !== sessionRef.current) return;
      if (snapshot && msg.state === 'processing') sessionRef.current = msg.sessionId;
      clearTimeout(timeoutRef.current);
      clearInterval(timerRef.current);
      requestedState = msg.state;
      setState(msg.state === 'listening' ? 'starting' : msg.state);
      setTargetApp(msg.targetApp || '');
      setTranscription(msg.transcription || '');
      setErrorMessage(msg.errorMessage || '');
      setIsInstruct(Boolean(msg.isInstruct));

      if (msg.state === 'listening') {
        sessionRef.current = msg.sessionId;
        const sessionId = msg.sessionId;
        recordingSessionId = sessionId;
        setMicrophoneLabel('');
        recorder.onVolumeChange = (vol) => {
          if (!disposed && sessionRef.current === sessionId) setVolume(vol);
        };
        recorder.onMicrophoneChange = label => { if (!disposed && sessionRef.current === sessionId) setMicrophoneLabel(label); };
        recorder.onInputEnded = () => {
          if (!disposed && sessionRef.current === sessionId) api.recordingFailed({ sessionId, errorMessage: 'Microphone disconnected during recording. Retry dictation to use the current microphone.' });
        };
        recorder.onDurationLimit = () => {
          if (!disposed && sessionRef.current === sessionId && requestedState === 'listening') api.toggleDictation();
        };
        setDuration(0);
        void (async () => {
          try {
            await settingsReady;
            if (disposed || sessionRef.current !== sessionId || requestedState !== 'listening') return;
            await recorder.start(microphoneDeviceId);
            if (disposed || sessionRef.current !== sessionId || requestedState !== 'listening') return;
            setState('listening');
            timerRef.current = setInterval(() => setDuration((d) => d + 1), 1000);
          } catch (error: any) {
            if (!disposed && sessionRef.current === sessionId && requestedState === 'listening') {
              api.recordingFailed({ sessionId, errorMessage: 'Microphone: ' + (error.message || 'Cannot start recording') });
            }
          }
        })();
      } else if (msg.state === 'processing') {
        const sessionId = msg.sessionId;
        // A restored processing snapshot belongs to audio already submitted by the old renderer.
        if (recordingSessionId !== sessionId) return;
        recordingSessionId = null;
        try {
          // Release cancels pending mic acquisition immediately; it must not start late.
          const result = await recorder.stop();
          if (disposed || sessionRef.current !== sessionId) return;
          if (!result?.buffer.byteLength || result.isTooShort) {
            api.recordingFailed({ sessionId, errorMessage: 'No audio captured. Wait for Listening before speaking, then hold the key while you speak.' });
          } else {
            api.submitRecordedAudio({ buffer: result.buffer, sessionId, durationSeconds: result.durationSeconds });
          }
        } catch (error: any) {
          if (!disposed && sessionRef.current === sessionId) api.recordingFailed({ sessionId, errorMessage: 'Microphone: ' + (error.message || 'Cannot finish recording') });
        }
      } else {
        recordingSessionId = null;
        sessionRef.current = null;
        void recorderRef.current?.stop().catch(() => {});
        setVolume(0);
        if (msg.state === 'pasted' || msg.state === 'error') timeoutRef.current = setTimeout(() => setState('idle'), msg.state === 'error' ? 6000 : 2500);
      }
    };
    const cleanup = api.onPillStateChange((message: any) => { void applyState(message); });
    void api.getPillState().then((message: any) => applyState(message, true)).catch(() => {});
    return () => {
      disposed = true;
      cleanup();
      sessionRef.current = null;
      clearInterval(timerRef.current);
      clearTimeout(timeoutRef.current);
      void recorder.dispose().catch(() => {});
    };
  }, []);

  const handleClick = () => {
    if (state === 'error') { (window as any).api.openDashboard('dictation'); return; }
    if (state !== 'processing') (window as any).api.toggleDictation();
  };

  const getBarHeight = (multiplier: number) => {
    const minH = 4;
    const maxH = 22;
    const h = minH + volume * (maxH - minH) * multiplier;
    return `${Math.min(maxH, Math.max(minH, h))}px`;
  };

  const shortcutLabel = formatShortcut(hotkey);
  const busy = state === 'starting' || state === 'listening' || state === 'processing';
  const dictateTip = state === 'starting' ? 'Starting microphone…' : state === 'listening' ? `Stop dictation${microphoneLabel ? ' · ' + microphoneLabel : ''}` : `Dictate · ${shortcutLabel}`;
  const statusTip = state === 'error' ? errorMessage : state === 'pasted' ? transcription : state === 'processing' ? 'Transcribing and formatting…' : dictateTip;

  return (
    <div className="pill-container" data-bar-design={barDesign}>
      {hovered && (tooltip || statusTip) && <div className="pill-tooltip" role="tooltip">{tooltip || statusTip}</div>}
      {state === 'idle' && !expanded ? (
        <button className="pill-rest" data-pill-hit aria-label={`Dictate ${shortcutLabel}`}
          title={`${mode === 'toggle' ? 'Press' : 'Hold'} ${shortcutLabel} or click to dictate`} onClick={handleClick}><BarAvatar design={barDesign} /></button>
      ) : (
        <div className={`pill-controls ${state}${state === 'idle' && !hovered ? ' closing' : ''}`} data-pill-hit onClick={state === 'listening' || state === 'starting' ? handleClick : undefined}>
          <button className={`pill-mic ${state}`} data-pill-hit onClick={(event) => { event.stopPropagation(); handleClick(); }}
            disabled={state === 'processing'} aria-label={state === 'error' ? 'View dictation failure' : state === 'listening' || state === 'starting' ? 'Stop dictation' : 'Start dictation'}
            onMouseEnter={() => setTooltip(statusTip)} title={statusTip}>
            <BarAvatar design={barDesign} state={state} awake={hovered} volume={volume} />
          </button>
          {state === 'listening' ? (
            <div className="pill-live" aria-live="polite">
              <div className="waveform-bars">{[0.6, 1.1, 1.4, 0.9, 0.5].map((scale, index) => <span key={index} className="wave-bar" style={{ height: getBarHeight(scale) }} />)}</div>
              <span aria-label={`Listening, ${duration} seconds`}>{duration}s</span>
            </div>
          ) : state !== 'idle' ? (
            <span className="pill-status" aria-live="polite">{state === 'starting' ? 'Starting…' : state === 'processing' ? 'Working…' : state === 'pasted' ? isInstruct ? 'Rewritten' : 'Inserted' : /microphone|audio|speech/i.test(errorMessage) ? 'Check mic' : 'Not inserted'}</span>
          ) : (
            <>
              <button className="pill-meeting" data-pill-hit aria-label="Meeting notes" title="Meeting notes"
                onMouseEnter={() => setTooltip('Meeting notes')} onClick={() => (window as any).api.openDashboard('notetaker')}>
                <CircleDot size={18} />
              </button>
              <button className="pill-settings" data-pill-hit aria-label="Open shortcut settings" title="Shortcut settings"
                onMouseEnter={() => setTooltip('Shortcuts & settings')} onClick={() => (window as any).api.openDashboard('settings')}>
                <ChevronUp size={14} />
              </button>
            </>
          )}
          {busy && <span className="sr-only">Dictating into {targetApp || 'selected window'}</span>}
          {state === 'processing' && <button className="pill-settings" aria-label="Cancel dictation processing" title="Cancel processing" onClick={() => (window as any).api.cancelDictation()}><X size={16}/></button>}
        </div>
      )}
    </div>
  );
};
