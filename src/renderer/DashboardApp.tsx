import React, { useEffect, useState, useRef } from 'react';
import {
  Mic,
  Users,
  BarChart3,
  BookA,
  Scissors,
  Palette,
  FileText,
  Settings as SettingsIcon,
  Play,
  Pause,
  Copy,
  Check,
  Plus,
  Trash2,
  Square,
  Sparkles,
  Sliders,
  CheckSquare,
  Volume2,
  Key,
  Flame,
  Zap,
  Globe,
  Radio,
  Cpu,
  Type,
  ArrowUpRight,
  ChevronDown,
  ShieldCheck,
} from 'lucide-react';
import { ShortcutSettings } from './ShortcutSettings';
import { PrivacySettings } from './PrivacySettings';
import { AccountPrivacy, AdminDashboard } from './AccountPrivacy';
import { accountAccessError } from '../shared/accountAccess';
import type { AccountStatus } from '../shared/cloud';
import { LocalModels } from './LocalModels';
import { AudioRecorder } from './audioRecorder';
import { WritingMemory } from './WritingMemory';
import { HistoryCorrection } from './HistoryCorrection';
import { WritingSettings } from './WritingSettings';
import { SPEECH_LANGUAGES, supportsSpeechLanguage, providerSupportsLanguage, selectSpeechModel, languageName, usesHindiConversion } from '../shared/speechLanguages';
import { writingProvider } from '../shared/writingConfig';
import { StyleSettings } from './StyleSettings';
import { AppearanceSettings } from './AppearanceSettings';
import { DictationFlow } from './DictationFlow';
import { LocalSpeechSettings } from './LocalSpeechSettings';
import { FirstRunSetup, LocalSetupPanel } from './LocalSetup';
import owlioIcon from '../../assets/brand/owlio-icon.png';

type DashboardTab = 'dictation' | 'notetaker' | 'insights' | 'dictionary' | 'snippets' | 'style' | 'scratchpad' | 'settings' | 'models' | 'text' | 'account' | 'admin';
type SettingsSection = 'speech' | 'text' | 'general' | 'style';
const SETTINGS_FIELDS: Record<SettingsSection, string[]> = {
  speech: ['localSttModel', 'provider', 'groqApiKey', 'localSttUrl', 'dictationLanguage'],
  text: ['writingProvider', 'localLlmModel', 'groqApiKey', 'formattingProvider', 'geminiApiKey', 'romanizationProvider', 'localLlmUrl', 'instructModeEnabled'],
  general: ['barDesign', 'microphoneDeviceId', 'hotkey', 'mode', 'retainAudio', 'startWithWindows'],
  style: ['writingStyle', 'geminiStructuredFormatting', 'contextAwarePunctuation', 'punctuationMode', 'autoLearnCorrections'],
};
const DASHBOARD_TABS: DashboardTab[] = ['dictation', 'notetaker', 'insights', 'dictionary', 'snippets', 'style', 'scratchpad', 'settings', 'models', 'text', 'account', 'admin'];

export const DashboardApp: React.FC = () => {
  const [accountStatus,setAccountStatus]=useState<AccountStatus|null>(null);
  const accessLocked = !!accountAccessError(accountStatus);
  const accessAllowedRef = useRef(false);
  accessAllowedRef.current = !accessLocked;
  useEffect(()=>{
    let mounted=true,observed=false;const api=(window as any).api;
    const unsubscribe=api.onAccountChanged?.((status:AccountStatus)=>{observed=true;if(mounted)setAccountStatus(status);});
    void api.getAccountStatus?.().then((status:AccountStatus)=>{if(mounted&&!observed)setAccountStatus(status);}).catch(()=>{});
    return()=>{mounted=false;unsubscribe?.();};
  },[]);
  const [activeTab, setActiveTab] = useState<DashboardTab>(() => {
    const tab = new URLSearchParams(window.location.search).get('tab') as DashboardTab;
    return DASHBOARD_TABS.includes(tab) ? tab : 'dictation';
  });

  // Audio input devices
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [isTestingMic, setIsTestingMic] = useState(false);
  const [micTestVolume, setMicTestVolume] = useState(0);
  const testRecorderRef = useRef<AudioRecorder | null>(null);

  // Settings state
  const [settings, setSettings] = useState<any>({
    provider: 'local',
    groqApiKey: '',
    formattingProvider: 'basic',
    writingProvider: 'off',
    geminiApiKey: '',
    geminiStructuredFormatting: true,
    romanizationProvider: 'off',
    autoLearnCorrections: false,
    contextAwarePunctuation: true,
    punctuationMode: 'auto',
    barDesign: 'owl',
    setupCompleted: true,
    localSttUrl: 'http://localhost:8000/v1',
    localSttModel: 'base',
    localLlmUrl: 'http://localhost:11434',
    localLlmModel: 'llama3.2',
    hotkey: 'F8',
    mode: 'push_to_talk',
    writingStyle: 'auto',
    instructModeEnabled: false,
    minAudioDurationMs: 300,
    microphoneDeviceId: '',
    dictationLanguage: 'hinglish',
    retainAudio: true,
    startWithWindows: false,
  });

  // History state
  const [lastFailure, setLastFailure] = useState<{ timestamp: number; errorMessage: string } | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [searchHistory, setSearchHistory] = useState('');
  const [setupExpanded, setSetupExpanded] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);

  // Dictionary state
  const [dictionary, setDictionary] = useState<any[]>([]);
  const dictionaryRef = useRef<any[]>([]);
  const dictionarySaveRef = useRef(Promise.resolve());
  const [newFrom, setNewFrom] = useState('');
  const [newTo, setNewTo] = useState('');

  // Snippets state
  const [snippets, setSnippets] = useState<any[]>([]);
  const snippetsRef = useRef<any[]>([]);
  const snippetsSaveRef = useRef(Promise.resolve());
  const [newSnippetTrigger, setNewSnippetTrigger] = useState('');
  const [newSnippetText, setNewSnippetText] = useState('');
  const [newSnippetDesc, setNewSnippetDesc] = useState('');

  // Scratchpad state
  const [scratchpadText, setScratchpadText] = useState('');
  const [isScratchpadSaved, setIsScratchpadSaved] = useState(false);

  // Meeting Notetaker state
  const [isMeetingRecording, setIsMeetingRecording] = useState(false);
  const [meetingDuration, setMeetingDuration] = useState(0);
  const [meetingNotes, setMeetingNotes] = useState<any[]>([]);
  const [currentMeetingSummary, setCurrentMeetingSummary] = useState<string | null>(null);
  const [currentActionItems, setCurrentActionItems] = useState<string[]>([]);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const meetingRecorderRef = useRef<AudioRecorder | null>(null);
  const meetingTimerRef = useRef<any>(null);
  const meetingSessionRef = useRef<{id: string; index: number; queue: Promise<void>; error?: Error; stopping: boolean} | null>(null);
  const meetingStartingRef = useRef(false);
  const [isMeetingStarting, setIsMeetingStarting] = useState(false);
  const [meetingError, setMeetingError] = useState('');
  const [meetingRecoveries, setMeetingRecoveries] = useState<{id:string;createdAt:number;seconds:number}[]>([]);
  const [recoveringId, setRecoveringId] = useState('');
  useEffect(() => {
    if (!accessLocked) return;
    const session = meetingSessionRef.current;
    if (session) session.stopping = true;
    meetingSessionRef.current = null;
    clearInterval(meetingTimerRef.current);
    void meetingRecorderRef.current?.dispose();
    void testRecorderRef.current?.dispose();
    meetingRecorderRef.current = null;
    testRecorderRef.current = null;
    setIsMeetingRecording(false);
    setIsTestingMic(false);
    setMicTestVolume(0);
    audioPlayerRef.current?.pause();
  }, [accessLocked]);

  const [choosingLanguage,setChoosingLanguage]=useState(false);
  const [languageModelNotice,setLanguageModelNotice]=useState('');
  const languageSelection=useRef(0);
  const [savedSettings, setSavedSettings] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [startupStatus, setStartupStatus] = useState<{supported:boolean;enabled:boolean;error?:string}|null>(null);
  const allSettingsFields = [...new Set(Object.values(SETTINGS_FIELDS).flat())];
  const sectionDirty = (_section: SettingsSection) => savedSettings && allSettingsFields.some(key => settings[key] !== savedSettings[key]);
  const sectionSaved = (section: SettingsSection) => !!savedSettings && !sectionDirty(section);
  const applySavedSettings = (patch: any) => {
    setSettings((previous: any) => ({...previous, ...patch}));
    setSavedSettings((previous: any) => ({...previous, ...patch}));
  };
  const syncSetupSettings = (patch: any) => {
    // A background runtime refresh must not replace a pending provider or server edit.
    setSettings((previous: any) => ({...previous, ...Object.fromEntries(Object.entries(patch).filter(([key]) => !savedSettings || previous[key] === savedSettings[key]))}));
    setSavedSettings((previous: any) => ({...previous, ...patch}));
  };

  useEffect(() => {
    document.querySelector('.main-content')?.scrollTo({top: 0});
    setSaveError('');
    if (activeTab === 'notetaker') void refreshMeetingRecoveries();
  }, [activeTab]);

  useEffect(() => {
    void loadAll();
    let startupDisposed = false;
    void (window as any).api.getStartupStatus?.().then((status: {supported:boolean;enabled:boolean;error?:string}) => { if (!startupDisposed) setStartupStatus(status); }).catch(() => { if (!startupDisposed) setStartupStatus({supported:true,enabled:false,error:'Could not read Windows startup settings. Reopen Owlio to try again.'}); });
    void loadAudioDevices(true);
    const devicesChanged = () => { void loadAudioDevices(false); };
    navigator.mediaDevices.addEventListener('devicechange', devicesChanged);
    const cleanupNavigation = (window as any).api.onDashboardNavigate((tab: string) => {
      if (DASHBOARD_TABS.includes(tab as DashboardTab)) setActiveTab(tab as DashboardTab);
    });
    let disposed = false;
    const refreshDictation = async () => {
      const [history, failure] = await Promise.all([(window as any).api.getHistory(), (window as any).api.getLastFailure()]);
      if (!disposed) { setHistory(history || []); setLastFailure(failure); }
    };
    void refreshDictation().catch(console.error);
    const cleanupDictation = (window as any).api.onDictationUpdated(() => { void refreshDictation().catch(console.error); });
    return () => {
      disposed = true;
      startupDisposed = true;
      languageSelection.current++;
      navigator.mediaDevices.removeEventListener('devicechange', devicesChanged);
      cleanupDictation();
      audioPlayerRef.current?.pause();
      cleanupNavigation();
      void testRecorderRef.current?.dispose();
      void meetingRecorderRef.current?.dispose();
      clearInterval(meetingTimerRef.current);
    };
  }, []);

  const loadAudioDevices = async (requestPermission = false) => {
    try {
      // Request temporary permission to get full device labels
      if (requestPermission) await navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        stream.getTracks().forEach((t) => t.stop());
      }).catch(() => {});

      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices.filter((d) => d.kind === 'audioinput');
      setAudioDevices(mics);
    } catch (e) {
      console.warn('Could not enumerate audio devices', e);
    }
  };

  const loadAll = async () => {
    try {
      const s = await (window as any).api.getSettings();
      setSettings(s);
      setSavedSettings(s);
      const h = await (window as any).api.getHistory();
      setHistory(h || []);
      const d = await (window as any).api.getDictionary();
      dictionaryRef.current = d || [];
      setDictionary(dictionaryRef.current);
      const snips = await (window as any).api.getSnippets?.();
      snippetsRef.current = snips || [];
      setSnippets(snippetsRef.current);
      const scratch = await (window as any).api.getScratchpad?.();
      setScratchpadText(scratch || '');
      const meetings = await (window as any).api.getMeetings?.();
      setMeetingNotes(meetings || []);
    } catch (e) {
      console.error('Failed to load data', e);
    }
  };

  const settingsSnapshot=useRef(settings);settingsSnapshot.current=settings;
  const chooseSpokenLanguage=async(language:string,provider=settings.provider)=>{
    const revision=++languageSelection.current;
    setLanguageModelNotice('');
    setSettings((previous:any)=>({...previous,provider,dictationLanguage:language}));
    if(provider!=='local'){setChoosingLanguage(false);return;}
    setChoosingLanguage(true);
    try {
      const catalogue=await Promise.race([(window as any).api.getLocalModels().catch(()=>null),new Promise(resolve=>setTimeout(()=>resolve(null),8000))]);
      if(revision!==languageSelection.current)return;
      const latest=settingsSnapshot.current;
      if(latest.provider!=='local'||latest.dictationLanguage!==language)return;
      const models=catalogue?.speech?.models || [];
      const choice=selectSpeechModel(language,latest.localSttModel,models);
      const name=models.find((model:{id:string;name:string})=>model.id===choice.model)?.name || (choice.model==='bodhan-flex'?'Bodhan Flex':`Whisper ${choice.model==='turbo'?'large v3 turbo':choice.model}`);
      setLanguageModelNotice(`${choice.changed?'Selected':'Keeping'} ${name} for ${languageName(language)}. ${!catalogue?.speech?.online?'Check setup below; download status is unavailable.':choice.downloaded?'Save settings to apply.':'Download or set up the selected model below, then Save settings.'}`);
      setSettings((previous:any)=>previous.provider==='local'&&previous.dictationLanguage===language?{...previous,localSttModel:choice.model}:previous);
    } finally {if(revision===languageSelection.current)setChoosingLanguage(false);}
  };

  const handleSaveSettings = async (section: SettingsSection) => {
    setSaving(true);
    try {
      setSaveError('');
      const patch = Object.fromEntries(allSettingsFields.filter(key=>settings[key]!==savedSettings[key]).map(key => [key, settings[key]]));
      const updated = await (window as any).api.updateSettings(patch);
      setSavedSettings(updated);
      // Apply only fields that still match this save, preserving edits made while it was in flight.
      setSettings((previous: any) => ({...previous, ...Object.fromEntries(Object.keys(patch).filter(key => previous[key] === patch[key]).map(key => [key, updated[key]]))}));
    } catch (e) {
      console.error(e);
      setSaveError(e instanceof Error ? e.message : 'Settings could not be saved.');
    } finally { setSaving(false); }
  };

  const saveButton = (section: SettingsSection) => <div className="section-save">
    {sectionDirty(section) && <span className="unsaved-note" role="status">Unsaved changes</span>}
    <button className="btn btn-primary" disabled={saving || choosingLanguage || !savedSettings || !sectionDirty(section)} onClick={() => void handleSaveSettings(section)}>
      {sectionSaved(section) ? <Check size={16}/> : <Sliders size={16}/>}
      <span>{saving ? 'Saving…' : sectionSaved(section) ? 'Saved!' : 'Save settings'}</span>
    </button>
  </div>;

  const handleTestMicToggle = async () => {
    if (isTestingMic) {
      setIsTestingMic(false);
      setMicTestVolume(0);
      await testRecorderRef.current?.dispose();
      testRecorderRef.current = null;
    } else {
      setIsTestingMic(true);
      await testRecorderRef.current?.dispose();
      if (!accessAllowedRef.current) { setIsTestingMic(false); return; }
      testRecorderRef.current = new AudioRecorder();
      testRecorderRef.current.onVolumeChange = (vol) => {
        setMicTestVolume(vol);
      };
      try {
        await testRecorderRef.current.start(settings.microphoneDeviceId);
      } catch (err) {
        console.error('Failed to test microphone', err);
        await testRecorderRef.current?.dispose();
        setIsTestingMic(false);
      }
    }
  };

  const handlePlayAudio = (audioUrl: string, id: string) => {
    if (!audioUrl) return;

    if (playingId === id) {
      audioPlayerRef.current?.pause();
      setPlayingId(null);
      return;
    }

    if (audioPlayerRef.current) {
      audioPlayerRef.current.pause();
    }

    const audio = new Audio(audioUrl);
    audioPlayerRef.current = audio;
    setPlayingId(id);

    audio.onended = () => {
      setPlayingId(null);
    };

    audio.onerror = () => {
      setPlayingId(null);
    };

    audio.play().catch(() => setPlayingId(null));
  };

  const handleAddDictionaryItem = async () => {
    if (!newFrom.trim() || !newTo.trim()) return;
    const newItem = { id: String(Date.now()), from: newFrom.trim(), to: newTo.trim() };
    const updated = [...dictionaryRef.current, newItem];
    dictionaryRef.current = updated;
    setDictionary(updated);
    setNewFrom('');
    setNewTo('');
    dictionarySaveRef.current = dictionarySaveRef.current.catch(() => {}).then(() => (window as any).api.setDictionary(updated));
    try { await dictionarySaveRef.current; } catch (e) { setSaveError(e instanceof Error ? e.message : 'Dictionary could not be saved.'); await loadAll(); }
  };

  const handleDeleteDictionaryItem = async (id: string) => {
    const updated = dictionaryRef.current.filter((item) => item.id !== id);
    dictionaryRef.current = updated;
    setDictionary(updated);
    dictionarySaveRef.current = dictionarySaveRef.current.catch(() => {}).then(() => (window as any).api.setDictionary(updated));
    try { await dictionarySaveRef.current; } catch (e) { setSaveError(e instanceof Error ? e.message : 'Dictionary could not be saved.'); await loadAll(); }
  };

  const handleAddSnippet = async () => {
    if (!newSnippetTrigger.trim() || !newSnippetText.trim()) return;
    const newItem = {
      id: String(Date.now()),
      trigger: newSnippetTrigger.trim(),
      replacement: newSnippetText.trim(),
      description: newSnippetDesc.trim(),
    };
    const updated = [...snippetsRef.current, newItem];
    snippetsRef.current = updated;
    setSnippets(updated);
    setNewSnippetTrigger('');
    setNewSnippetText('');
    setNewSnippetDesc('');
    snippetsSaveRef.current = snippetsSaveRef.current.catch(() => {}).then(() => (window as any).api.setSnippets?.(updated));
    try { await snippetsSaveRef.current; } catch (e) { setSaveError(e instanceof Error ? e.message : 'Snippets could not be saved.'); await loadAll(); }
  };

  const handleDeleteSnippet = async (id: string) => {
    const updated = snippetsRef.current.filter((item) => item.id !== id);
    snippetsRef.current = updated;
    setSnippets(updated);
    snippetsSaveRef.current = snippetsSaveRef.current.catch(() => {}).then(() => (window as any).api.setSnippets?.(updated));
    try { await snippetsSaveRef.current; } catch (e) { setSaveError(e instanceof Error ? e.message : 'Snippets could not be saved.'); await loadAll(); }
  };

  const handleSaveScratchpad = async () => {
    try {
      await (window as any).api.setScratchpad?.(scratchpadText);
      setSaveError(''); setIsScratchpadSaved(true);
      setTimeout(() => setIsScratchpadSaved(false), 2000);
    } catch (e) { setSaveError(e instanceof Error ? e.message : 'Scratchpad could not be saved.'); }
  };

  const handleCopyHistory = async (text: string, id: string) => {
    try {
      await (window as any).api.copyText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch (error) { setSaveError(error instanceof Error ? error.message : 'Could not copy your words.'); }
  };

  const handleClearHistory = async () => {
    if (confirm('Are you sure you want to clear your dictation history?')) {
      try { await (window as any).api.clearHistory(); setHistory([]); }
      catch (e) { setSaveError(e instanceof Error ? e.message : 'History could not be cleared.'); }
    }
  };

  // Meeting Notetaker Controls
  const refreshMeetingRecoveries = async () => {
    try { const entries = await (window as any).api.getMeetingRecoveries?.(); if (entries) setMeetingRecoveries(entries); }
    catch (error) { setMeetingError(error instanceof Error ? error.message : 'Could not load unfinished meetings.'); }
  };
  const queueMeetingChunk = (session: NonNullable<typeof meetingSessionRef.current>, buffer: ArrayBuffer) => {
    const index = session.index++;
    session.queue = session.queue.then(async () => {
      if (!session.error) await (window as any).api.appendMeetingChunk(session.id, index, buffer);
    }).catch(error => {
      session.error = error instanceof Error ? error : new Error('Could not save meeting audio.');
      if (!session.stopping) void stopMeetingRecording();
    });
  };
  const completeMeeting = async (id: string) => {
    const note = await (window as any).api.finishMeetingCapture(id);
    setCurrentMeetingSummary(note.summary);
    setCurrentActionItems(note.actions || []);
    setMeetingNotes(previous => [note, ...previous.filter(item => item.id !== note.id)]);
    if (note.warning) setMeetingError(note.warning);
  };
  const startMeetingRecording = async () => {
    if (meetingStartingRef.current || meetingSessionRef.current || isSummarizing) return;
    meetingStartingRef.current = true;
    setIsMeetingStarting(true); setMeetingError('');
    meetingRecorderRef.current ??= new AudioRecorder();
    setMeetingDuration(0);
    setCurrentMeetingSummary(null);
    setCurrentActionItems([]);

    try {
      const id = await (window as any).api.beginMeetingCapture();
      if (!accessAllowedRef.current) {
        await (window as any).api.abandonMeetingCapture(id).catch(() => {});
        return;
      }
      const session = {id, index:0, queue:Promise.resolve(), stopping:false};
      meetingSessionRef.current = session;
      const recorder = meetingRecorderRef.current;
      recorder.chunkSeconds = 60; recorder.maxDurationSeconds = 7200;
      recorder.onChunk = buffer => queueMeetingChunk(session, buffer);
      recorder.onDurationLimit = () => { setMeetingError('The two-hour recording limit was reached. Generating notes from the captured audio.'); void stopMeetingRecording(); };
      recorder.onInputEnded = () => { setMeetingError('The microphone disconnected. Processing the audio captured so far.'); void stopMeetingRecording(); };
      setIsMeetingRecording(true);
      await recorder.start(settings.microphoneDeviceId);
      if (!session.stopping) meetingTimerRef.current = setInterval(() => setMeetingDuration(d => d + 1), 1000);
    } catch (e) {
      const session = meetingSessionRef.current;
      if (!session?.stopping) {
        setMeetingError(e instanceof Error ? e.message : 'Could not start the meeting microphone.');
        setIsMeetingRecording(false); clearInterval(meetingTimerRef.current);
        if (session) await (window as any).api.abandonMeetingCapture(session.id).catch(() => {});
        meetingSessionRef.current = null;
      }
    } finally { meetingStartingRef.current = false; setIsMeetingStarting(false); }
  };

  const stopMeetingRecording = async () => {
    const session = meetingSessionRef.current;
    if (!session || session.stopping) return;
    session.stopping = true;
    setIsMeetingRecording(false);
    clearInterval(meetingTimerRef.current);
    setIsSummarizing(true);

    try {
      const res = await meetingRecorderRef.current?.stop();
      if (res?.buffer.byteLength) queueMeetingChunk(session, res.buffer);
      await session.queue;
      if (session.error) throw session.error;
      if (!res || res.isTooShort) throw new Error('Meeting recording is empty or too short.');
      await completeMeeting(session.id);
    } catch (e) {
      setMeetingError(e instanceof Error ? e.message : 'Meeting processing failed.');
      await (window as any).api.abandonMeetingCapture(session.id).catch(() => {});
    } finally {
      meetingSessionRef.current = null;
      setIsSummarizing(false);
      void (window as any).api.getMeetings().then(setMeetingNotes).catch(() => {});
      void refreshMeetingRecoveries();
    }
  };

  const recoverMeeting = async (id: string) => {
    setIsSummarizing(true); setMeetingError('');
    try { await completeMeeting(id); }
    catch (error) { setMeetingError(error instanceof Error ? error.message : 'Could not recover this meeting.'); }
    finally { setIsSummarizing(false); void refreshMeetingRecoveries(); void (window as any).api.getMeetings().then(setMeetingNotes).catch(() => {}); }
  };

  const formatMeetingTime = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const s = sec % 60;
    return `${mins}:${s < 10 ? '0' : ''}${s}`;
  };

  // Stats calculation
  const totalRecordedWords = history.reduce((acc, item) => {
    return acc + (item.wordCount || (item.formattedText || '').trim().split(/\s+/).filter(Boolean).length);
  }, 0);

  const validWpms = history.map((h) => h.wpm).filter((w) => w && w > 0);
  const averageWpm = validWpms.length > 0 ? Math.round(validWpms.reduce((a, b) => a + b, 0) / validWpms.length) : 0;
  const activeDays = new Set(history.map((item) => new Date(item.timestamp).toDateString()));
  let streak = 0;
  const day = new Date();
  while (activeDays.has(day.toDateString())) { streak += 1; day.setDate(day.getDate() - 1); }
  const appCounts = history.reduce<Record<string, number>>((counts, item) => {
    const app = item.processName || 'Unknown'; counts[app] = (counts[app] || 0) + 1; return counts;
  }, {});
  const topApps = Object.entries(appCounts).sort((a, b) => b[1] - a[1]).slice(0, 4);

  const filteredHistory = history.filter(
    (item) =>
      (item.formattedText || '').toLowerCase().includes(searchHistory.toLowerCase()) ||
      (item.processName || '').toLowerCase().includes(searchHistory.toLowerCase())
  );
  const microphoneName = audioDevices.find(device => device.deviceId === settings.microphoneDeviceId)?.label || 'System default';
  const speechModelName = settings.provider === 'local'
    ? settings.localSttModel === 'bodhan-flex' ? 'Bodhan Flex' : settings.localSttModel?.replace(/^hf:/, '') || 'Whisper base'
    : 'Groq';
  const outputScript = settings.romanizationProvider === 'gemini' && usesHindiConversion(settings.dictationLanguage) ? 'Roman Hinglish · Gemini'
    : 'Speech model’s original script';
  const cleanupName = settings.formattingProvider==='basic'?'Basic punctuation':`Writing AI · ${writingProvider(settings)}`;

  return (
    <div className="dashboard-layout">
      {/* Workspace tools and configuration */}
      <div className="sidebar" inert={settings.setupCompleted===false || accessLocked}>
        <div className="brand">
          <div className="brand-icon"><img src={owlioIcon} alt="" width={32} height={32} /></div>
          <div>
            <div className="brand-title">Owlio</div>
            <div style={{ fontSize: '11px', color: '#746F6B' }}>Voice & Meeting AI</div>
          </div>
        </div>

        <nav className="nav-menu" aria-label="Main navigation">
          <div className="nav-group-label">Workspace</div>
          <button
            className={`nav-item ${activeTab === 'dictation' ? 'active' : ''}`}
            onClick={() => setActiveTab('dictation')}
          >
            <Mic size={18} />
            <span>Dictation</span>
          </button>

          <button
            className={`nav-item ${activeTab === 'notetaker' ? 'active' : ''}`}
            onClick={() => setActiveTab('notetaker')}
          >
            <Users size={18} />
            <span>Notetaker</span>
          </button>

          <button
            className={`nav-item ${activeTab === 'insights' ? 'active' : ''}`}
            onClick={() => setActiveTab('insights')}
          >
            <BarChart3 size={18} />
            <span>Insights</span>
          </button>

          <button
            className={`nav-item ${activeTab === 'dictionary' ? 'active' : ''}`}
            onClick={() => setActiveTab('dictionary')}
          >
            <BookA size={18} />
            <span>Dictionary</span>
          </button>

          <button
            className={`nav-item ${activeTab === 'snippets' ? 'active' : ''}`}
            onClick={() => setActiveTab('snippets')}
          >
            <Scissors size={18} />
            <span>Snippets</span>
          </button>

          <button
            className={`nav-item ${activeTab === 'scratchpad' ? 'active' : ''}`}
            onClick={() => setActiveTab('scratchpad')}
          >
            <FileText size={18} />
            <span>Scratchpad</span>
          </button>

          <div className="nav-group-label configure-label">Configure</div>
          <button className={`nav-item ${activeTab === 'account' || activeTab === 'admin' ? 'active' : ''}`} aria-current={activeTab === 'account' || activeTab === 'admin' ? 'page' : undefined} onClick={() => setActiveTab('account')}><ShieldCheck size={18}/><span>Account &amp; privacy</span></button>
          <button className={`nav-item ${activeTab === 'models' ? 'active' : ''}`} aria-current={activeTab === 'models' ? 'page' : undefined} onClick={() => setActiveTab('models')}>
            <Cpu size={18}/><span>Speech &amp; models</span>{sectionDirty('speech') && <span className="draft-dot" aria-label="Unsaved speech changes"/>}
          </button>
          <button className={`nav-item ${activeTab === 'text' || activeTab === 'style' ? 'active' : ''}`} aria-current={activeTab === 'text' || activeTab === 'style' ? 'page' : undefined} onClick={() => setActiveTab('text')}>
            <Type size={18}/><span>Text &amp; style</span>{(sectionDirty('text') || sectionDirty('style')) && <span className="draft-dot" aria-label="Unsaved text changes"/>}
          </button>
          <button
            className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <SettingsIcon size={18} />
            <span>General settings</span>{sectionDirty('general') && <span className="draft-dot" aria-label="Unsaved general changes"/>}
          </button>
        </nav>

        <div style={{ marginTop: 'auto', padding: '12px 8px' }}>
          <button
            className="btn btn-secondary"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={() => void (window as any).api.showFloatingBar().catch((error: Error) => setSaveError(error.message))}
          >
            <Mic size={16} />
            <span>Show floating bar</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="main-content">
        {accessLocked?<AccountPrivacy onContinue={()=>setActiveTab('dictation')} onAdmin={()=>{}}/>:settings.setupCompleted===false && activeTab!=='account' && activeTab!=='admin'?<FirstRunSetup onChange={applySavedSettings} onDone={()=>setActiveTab('models')} onAccount={()=>setActiveTab('account')}/>:<>
        {activeTab==='account' && <AccountPrivacy onContinue={()=>setActiveTab('dictation')} onAdmin={()=>setActiveTab('admin')}/>}
        {activeTab==='admin' && <AdminDashboard onBack={()=>setActiveTab('account')}/>}
        {saveError && (
          <div className="card" role="alert" style={{ borderColor: 'rgba(239, 68, 68, 0.45)', color: '#B14848', marginBottom: '16px' }}>
            {saveError}
          </div>
        )}
        {/* ================= DICTATION TAB ================= */}
        {activeTab === 'dictation' && (
          <section className="dictation-page" aria-label="Dictation dashboard">
              <div className="header-row">
                <div>
                  <h1 className="page-title">Your voice workspace</h1>
                  <p style={{ color: '#746F6B', fontSize: '14px', marginTop: '4px' }}>
                    {settings.mode === 'toggle' ? 'Press' : 'Hold'} {settings.hotkey} to dictate into your selected text field.
                  </p>
                </div>
              </div>

            <div className="dictation-layout">
            <div className="dictation-feed" role="region" aria-label="Dictation history" tabIndex={0}>
              {lastFailure && (
                <div className="recovery-notice" role="status">
                  <strong>Last dictation issue · {new Date(lastFailure.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
                  <p>{lastFailure.errorMessage}</p>
                  <span>Transcribed words that could not be inserted are kept in the history below. Copy them and paste into your text field.</span>
                </div>
              )}
              {/* Informational Banner */}
              <div
                className="dictation-banner"
              >
                <h2>Your words, without the keyboard.</h2>
                <p>
                   Language: <strong>{languageName(settings.dictationLanguage)}</strong>. {settings.provider === 'local' ? 'Speech recognition runs on this computer.'  : 'Audio is sent to the selected cloud provider.'} {settings.formattingProvider !== 'basic' && writingProvider(settings)==='gemini' && 'Text cleanup uses Gemini online.'}
                </p>
              </div>

              <div className="history-toolbar" role="group" aria-label="History controls">
                <input
                  type="search"
                  className="input"
                  aria-label="Search dictation history"
                  placeholder="Search past dictations or apps..."
                  value={searchHistory}
                  onChange={(e) => setSearchHistory(e.target.value)}
                />
                {history.length > 0 && <button className="btn btn-danger" onClick={handleClearHistory}>
                  <Trash2 size={16}/><span>Clear history</span>
                </button>}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {filteredHistory.length === 0 ? (
                  <div className="card" style={{ textAlign: 'center', padding: '40px', color: '#746F6B' }}>
                    <Mic size={32} style={{ margin: '0 auto 12px auto', opacity: 0.5 }} />
                    <p>
                      No dictations yet. Hold your hotkey (<strong>{settings.hotkey}</strong>) and speak into your headset!
                    </p>
                  </div>
                ) : (
                  filteredHistory.map((item) => (
                    <div key={item.id} className="history-item">
                      <div className="history-meta">
                        <span className="app-badge">{item.processName || 'Window'}</span>
                        {item.isInstruct && (
                          <span className="app-badge" style={{ background: 'rgba(168, 85, 247, 0.2)', color: '#80559A' }}>
                            ✨ Instruct
                          </span>
                        )}
                        <span>{new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        {item.wpm && <span style={{ color: '#396F68' }}>{item.wpm} WPM</span>}

                        <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
                          {item.deliveryStatus === 'failed' && item.audioUrl && <button className="btn btn-secondary" disabled={Boolean(recoveringId)} onClick={async () => {
                            setRecoveringId(item.id);
                            try { await (window as any).api.recoverDictation(item.id); setCopiedId(item.id); }
                            catch (error) { setSaveError(error instanceof Error ? error.message : 'Could not recover this recording.'); }
                            finally { setRecoveringId(''); }
                          }}>{recoveringId === item.id ? 'Recovering…' : 'Transcribe again'}</button>}
                          {item.audioUrl && (
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '4px 8px', fontSize: '12px' }}
                              onClick={() => handlePlayAudio(item.audioUrl, item.id)}
                            >
                              {playingId === item.id ? <Pause size={14} color="#396F68" /> : <Play size={14} color="#76608C" />}
                              <span>{playingId === item.id ? 'Pause' : 'Play Audio'}</span>
                            </button>
                          )}
                          <button
                            className="btn btn-secondary"
                            style={{ padding: '4px 8px', fontSize: '12px' }}
                            onClick={() => handleCopyHistory(item.editedText || item.formattedText, item.id)}
                          >
                            {copiedId === item.id ? <Check size={14} color="#36754C" /> : <Copy size={14} />}
                            <span>{copiedId === item.id ? 'Copied' : 'Copy'}</span>
                          </button>
                        </div>
                      </div>
                      {item.deliveryStatus === 'failed' && <p className="delivery-error"><strong>Not inserted.</strong> {item.errorMessage} {item.formattedText ? 'Use Copy to recover your words.' : 'Use Transcribe again when audio is available.'}</p>}
                      {item.deliveryStatus === 'processing' && <p className="muted" role="status">Processing recording…</p>}
                      <div className="history-text">{item.editedText || item.formattedText || 'No transcript yet. Use Transcribe again if audio is available.'}</div>
                      {item.editedText && <p className="muted">Corrected version · Original dictation is retained.</p>}
                      <HistoryCorrection item={item}/>
                      {item.warning && <p className="muted">{item.warning}</p>}
                    </div>
                  ))
                )}
              </div>
            </div>

            <aside className="dictation-summary" aria-label="Activity and current setup" tabIndex={0}>
              <section className="card activity-card" aria-labelledby="activity-heading">
                <div className="summary-card-heading"><h2 id="activity-heading">Activity</h2><span>All time</span></div>
                <dl className="activity-metrics">
                  <div><dt>Total words</dt><dd>{totalRecordedWords.toLocaleString()}</dd></div>
                  <div><dt>Average WPM</dt><dd>{averageWpm || '—'}</dd></div>
                </dl>
                <div className="activity-streak"><Flame size={16}/><span>{streak ? `${streak} day${streak === 1 ? '' : 's'} in a row` : 'Start a streak today'}</span></div>
              </section>

              <section className={`card current-setup${setupExpanded ? ' expanded' : ''}`} aria-labelledby="current-setup-heading">
                <div className="summary-card-heading"><h2 id="current-setup-heading">Current setup</h2><button className="setup-expand" aria-label={setupExpanded ? 'Hide setup details' : 'Show setup details'} aria-expanded={setupExpanded} aria-controls="setup-summary-details" onClick={()=>setSetupExpanded(previous=>!previous)}><ChevronDown size={16}/></button></div>
                <div className="setup-mode"><Zap size={14}/>{settings.provider === 'local' ? 'Local speech'  : 'Cloud speech'}</div>
                <p className="setup-compact-value">{speechModelName} · {outputScript}</p>
                <dl className="setup-summary-list" id="setup-summary-details">
                  <div className="setup-summary-row">
                    <dt><Cpu size={15}/>Speech recognition</dt>
                    <dd><span>{speechModelName}</span>
                      <p>{settings.provider === 'local' ? 'Audio processed on this computer'  : 'Audio sent to your speech provider'}</p>
                      <button className="setup-change" aria-label="Change speech model" onClick={()=>setActiveTab('models')}>Change<ArrowUpRight size={13}/></button>
                    </dd>
                  </div>
                  <div className="setup-summary-row">
                    <dt><Mic size={15}/>Microphone</dt>
                    <dd><span>{microphoneName}</span>
                      <button className="setup-change" aria-label="Change microphone" onClick={()=>setActiveTab('settings')}>Change<ArrowUpRight size={13}/></button>
                    </dd>
                  </div>
                  <div className="setup-summary-row">
                    <dt><Type size={15}/>Text output</dt>
                    <dd><span>{outputScript}</span>
                      <p>{cleanupName}</p>
                      <button className="setup-change" aria-label="Change text output" onClick={()=>setActiveTab('text')}>Change<ArrowUpRight size={13}/></button>
                    </dd>
                  </div>
                </dl>
              </section>
            </aside>
            </div>
          </section>
        )}

        {/* ================= NOTETAKER TAB ================= */}
        {activeTab === 'notetaker' && (
          <>
            <div className="header-row">
              <div>
                <h1 className="page-title">Meeting Notetaker</h1>
                <p style={{ color: '#746F6B', fontSize: '14px', marginTop: '4px' }}>
                  Records your microphone for up to two hours. Voices heard only through headphones are not captured. Turn on recording retention to retry unfinished recordings.
                </p>
              </div>
              {!isMeetingRecording ? (
                <button className="btn btn-primary" disabled={isMeetingStarting || isSummarizing} onClick={startMeetingRecording}>
                  <Play size={16} />
                  <span>{isMeetingStarting ? 'Starting microphone…' : 'Start recording'}</span>
                </button>
              ) : (
                <button className="btn btn-danger" onClick={stopMeetingRecording}>
                  <Square size={16} />
                  <span>Stop recording</span>
                </button>
              )}
            </div>

            {writingProvider(settings)==='off'&&<p className="muted">Meetings save a transcript. Connect Writing AI in Text &amp; style to add summaries.</p>}
            {meetingError && <p className="delivery-error" role="alert">{meetingError}</p>}
            {meetingRecoveries.length > 0 && <section className="card" aria-label="Unfinished meeting recordings">
              <h3>Unfinished recordings</h3><p className="muted">Retry uses completed transcription chunks. Discard removes the saved recording.</p>
              {meetingRecoveries.map(entry => <div key={entry.id} className="model-actions">
                <span>{new Date(entry.createdAt).toLocaleString()} · {formatMeetingTime(Math.round(entry.seconds))}</span>
                <button className="btn btn-secondary" disabled={isSummarizing || isMeetingRecording || isMeetingStarting} onClick={() => void recoverMeeting(entry.id)}>Retry meeting</button>
                <button className="btn btn-secondary" disabled={isSummarizing || isMeetingRecording || isMeetingStarting} onClick={async () => {
                  try { await (window as any).api.discardMeetingCapture(entry.id); await refreshMeetingRecoveries(); }
                  catch (error) { setMeetingError(error instanceof Error ? error.message : 'Could not discard this recording.'); }
                }}>Discard</button>
              </div>)}
            </section>}

            {isMeetingRecording && (
              <div
                className="card"
                style={{
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  background: 'rgba(239, 68, 68, 0.05)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <div
                    style={{
                      width: '14px',
                      height: '14px',
                      borderRadius: '50%',
                      background: '#EF4444',
                      animation: 'pulse 1s infinite',
                    }}
                  />
                  <div>
                    <h4 style={{ fontWeight: 600 }}>Meeting Recording in Progress</h4>
                    <p style={{ fontSize: '13px', color: '#746F6B' }}>Capturing microphone audio · two-hour limit</p>
                  </div>
                </div>
                <div style={{ fontSize: '20px', fontWeight: 700, fontFamily: 'monospace', color: '#EF4444' }}>
                  {formatMeetingTime(meetingDuration)}
                </div>
              </div>
            )}

            {isSummarizing && (
              <div className="card" style={{ textAlign: 'center', padding: '30px' }}>
                <p style={{ color: '#76608C' }}>Processing meeting audio and extracting action items...</p>
                <button className="btn btn-secondary" onClick={() => void (window as any).api.cancelMeetingProcessing().catch((error: Error) => setMeetingError(error.message))}>Cancel processing</button>
              </div>
            )}

            {currentMeetingSummary && (
              <div className="card" style={{ borderColor: 'rgba(99, 102, 241, 0.3)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <FileText size={18} color="#76608C" />
                  <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Latest Meeting Summary</h3>
                </div>
                <p style={{ fontSize: '14px', lineHeight: 1.6, color: '#292627', marginTop: '8px' }}>
                  {currentMeetingSummary}
                </p>

                {currentActionItems.length > 0 && (
                  <div style={{ marginTop: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                      <CheckSquare size={16} color="#36754C" />
                      <span style={{ fontSize: '14px', fontWeight: 600 }}>Action Items / Todos</span>
                    </div>
                    <ul style={{ listStyleType: 'disc', paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {currentActionItems.map((action, i) => (
                        <li key={i} style={{ fontSize: '13px', color: '#514C4D' }}>
                          {action}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
              {meetingNotes.map((note) => (
                <div key={note.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h4 style={{ fontWeight: 600 }}>{note.title}</h4>
                    <span className="app-badge">{formatMeetingTime(note.duration)}</span>
                  </div>
                  <p style={{ fontSize: '13px', color: '#746F6B', marginTop: '6px' }}>{note.summary}</p>
                  {note.warning && <p className="delivery-error">{note.warning}</p>}
                  <details><summary>Transcript</summary><p style={{whiteSpace:'pre-wrap'}}>{note.transcript}</p></details>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ================= INSIGHTS TAB ================= */}
        {activeTab === 'insights' && (
          <>
            <div className="header-row">
              <div>
                <h1 className="page-title">Voice Insights</h1>
                <p style={{ color: '#746F6B', fontSize: '14px', marginTop: '4px' }}>
                  Analytics on your dictation volume, speaking speed, and top applications.
                </p>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', marginBottom: '20px' }}>
              <div className="card">
                <div style={{ fontSize: '13px', color: '#746F6B' }}>Total Dictated Words</div>
                <div style={{ fontSize: '28px', fontWeight: 700, color: '#292627', marginTop: '6px' }}>
                  {totalRecordedWords.toLocaleString()}
                </div>
              </div>
              <div className="card">
                <div style={{ fontSize: '13px', color: '#746F6B' }}>Average Speaking Speed</div>
                <div style={{ fontSize: '28px', fontWeight: 700, color: '#396F68', marginTop: '6px' }}>
                  {averageWpm} <span style={{ fontSize: '14px', color: '#746F6B' }}>WPM</span>
                </div>
              </div>
              <div className="card">
                <div style={{ fontSize: '13px', color: '#746F6B' }}>Typing Time Saved</div>
                <div style={{ fontSize: '28px', fontWeight: 700, color: '#36754C', marginTop: '6px' }}>
                  {(totalRecordedWords / 40 / 60).toFixed(1)} <span style={{ fontSize: '14px', color: '#746F6B' }}>Hours</span>
                </div>
              </div>
            </div>

            <div className="card">
              <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Top Applications Dictated Into</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '14px' }}>
                 {topApps.length === 0 ? <p style={{ color: '#746F6B' }}>No application data yet.</p> : topApps.map(([app, count]) => (
                   <div key={app} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                     <span style={{ fontSize: '14px', color: '#292627' }}>{app}</span>
                     <span className="app-badge">{count} dictation{count === 1 ? '' : 's'}</span>
                   </div>
                 ))}
              </div>
            </div>
          </>
        )}

        {/* ================= DICTIONARY TAB ================= */}
        {activeTab === 'dictionary' && (
          <>
            <div className="header-row">
              <div>
                <h1 className="page-title">Custom Vocabulary</h1>
                <p style={{ color: '#746F6B', fontSize: '14px', marginTop: '4px' }}>
                  Define custom names, Hinglish phrases, acronyms, and automatic text replacements.
                </p>
              </div>
            </div>

            <WritingMemory view="vocabulary"/>
            <div className="card">
              <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Add word or replacement</h3>
              <div style={{ display: 'flex', gap: '12px', marginTop: '10px' }}>
                <input
                  type="text"
                  className="input"
                  placeholder="When you say (e.g. 'k8s')..."
                  value={newFrom}
                  onChange={(e) => setNewFrom(e.target.value)}
                />
                <input
                  type="text"
                  className="input"
                  placeholder="Replace with (e.g. 'Kubernetes')..."
                  value={newTo}
                  onChange={(e) => setNewTo(e.target.value)}
                />
                <button className="btn btn-primary" onClick={handleAddDictionaryItem}>
                  <Plus size={16} />
                  <span>Add</span>
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {dictionary.map((item) => (
                <div
                  key={item.id}
                  className="history-item"
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <span style={{ color: '#746F6B', fontFamily: 'monospace' }}>"{item.from}"</span>
                    <span style={{ color: '#746F6B' }}>→</span>
                    <span style={{ color: '#76608C', fontWeight: 600, fontFamily: 'monospace' }}>"{item.to}"</span>
                  </div>
                  <button className="btn btn-secondary" style={{ padding: '6px' }} onClick={() => handleDeleteDictionaryItem(item.id)}>
                    <Trash2 size={14} color="#B14848" />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ================= SNIPPETS TAB ================= */}
        {activeTab === 'snippets' && (
          <>
            <div className="header-row">
              <div>
                <h1 className="page-title">Snippets</h1>
                <p style={{ color: '#746F6B', fontSize: '14px', marginTop: '4px' }}>
                  Expand voice trigger words into entire templated messages automatically.
                </p>
              </div>
            </div>

            <div className="card">
              <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Add New Snippet</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '10px' }}>
                <input
                  type="text"
                  className="input"
                  placeholder="Trigger phrase (e.g. ';intro')"
                  value={newSnippetTrigger}
                  onChange={(e) => setNewSnippetTrigger(e.target.value)}
                />
                <input
                  type="text"
                  className="input"
                  placeholder="Description (optional)"
                  value={newSnippetDesc}
                  onChange={(e) => setNewSnippetDesc(e.target.value)}
                />
              </div>
              <textarea
                className="input"
                style={{ marginTop: '10px', height: '80px', resize: 'vertical' }}
                placeholder="Expanded template text..."
                value={newSnippetText}
                onChange={(e) => setNewSnippetText(e.target.value)}
              />
              <button className="btn btn-primary" style={{ marginTop: '10px' }} onClick={handleAddSnippet}>
                <Plus size={16} />
                <span>Add snippet</span>
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {snippets.map((snip) => (
                <div key={snip.id} className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span className="app-badge" style={{ fontFamily: 'monospace' }}>{snip.trigger}</span>
                      <span style={{ fontSize: '13px', color: '#746F6B' }}>{snip.description}</span>
                    </div>
                    <button className="btn btn-secondary" style={{ padding: '6px' }} onClick={() => handleDeleteSnippet(snip.id)}>
                      <Trash2 size={14} color="#B14848" />
                    </button>
                  </div>
                  <div style={{ marginTop: '8px', fontSize: '14px', color: '#292627', whiteSpace: 'pre-wrap' }}>
                    {snip.replacement}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ================= STYLE TAB ================= */}
        {activeTab === 'style' && (
          <section className="style-page" aria-label="Writing style">
            <div className="header-row">
              <div>
                <h1 className="page-title">Text &amp; style</h1>
                <p style={{ color: '#746F6B', fontSize: '14px', marginTop: '4px' }}>
                  Your writing tone, smart lists, punctuation and personal rules.
                </p>
              </div>
              {saveButton('style')}
            </div>

            <div className="settings-subnav" aria-label="Text settings views">
              <button onClick={()=>setActiveTab('text')}>Output &amp; cleanup{sectionDirty('text') && <span className="draft-dot" aria-label="Unsaved output changes"/>}</button>
              <button className="selected" aria-current="page" onClick={()=>setActiveTab('style')}>Writing style</button>
            </div>
            <StyleSettings settings={settings} onChange={patch=>setSettings((previous:any)=>({...previous,...patch}))} onOpenSettings={()=>setActiveTab('text')}/>
            <details className="settings-disclosure settings-advanced"><summary>Advanced writing preferences<span>Correction learning and custom rules</span></summary>
            <section className="card writing-learning" aria-label="Correction learning">
              <h3>Correction learning</h3>
              <label className="structure-toggle"><input type="checkbox" checked={settings.autoLearnCorrections !== false} onChange={event=>setSettings((previous:any)=>({...previous,autoLearnCorrections:event.target.checked}))}/>Learn spellings from my corrections</label>
              <p className="muted">Learn spellings from corrections to recent dictations. Review suggestions in Dictionary.</p>
              <details className="settings-disclosure"><summary>How learning works</summary><p className="muted">Owlio checks the same focused field for up to 30 seconds after pasting. With Gemini Writing AI configured, changed spelling candidates are sent for review. Password fields are excluded. You can also use “Correct this dictation” in History.</p></details>
            </section>

            <WritingMemory view="preferences"/>
            </details>
          </section>
        )}

        {/* ================= SCRATCHPAD TAB ================= */}
        {activeTab === 'scratchpad' && (
          <>
            <div className="header-row">
              <div>
                <h1 className="page-title">Scratchpad</h1>
                <p style={{ color: '#746F6B', fontSize: '14px', marginTop: '4px' }}>
                  A place for ideas, notes and drafts. Select Save draft to keep your text.
                </p>
              </div>
              <button className="btn btn-primary" onClick={handleSaveScratchpad}>
                {isScratchpadSaved ? <Check size={16} /> : <FileText size={16} />}
                <span>{isScratchpadSaved ? 'Saved!' : 'Save draft'}</span>
              </button>
            </div>

            <textarea
              className="input"
              style={{
                width: '100%',
                height: '420px',
                fontSize: '15px',
                lineHeight: 1.6,
                padding: '16px',
                resize: 'vertical',
              }}
              value={scratchpadText}
              onChange={(e) => setScratchpadText(e.target.value)}
              placeholder={`Click here to type, or ${settings.mode === 'toggle' ? 'press' : 'hold'} ${settings.hotkey || 'your shortcut'} to dictate…`}
            />
          </>
        )}

        {/* ================= SPEECH & MODELS ================= */}
        {activeTab === 'models' && (
          <section className="settings-page models-page" aria-label="Speech and models">
            <div className="header-row"><div><h1 className="page-title">Speech &amp; models</h1><p className="page-description">Choose who hears your voice and which language you speak.</p></div>{saveButton('speech')}</div>
            <DictationFlow settings={settings} />
            <div className="settings-basics">
            {/* AI Speech & Formatting Provider */}
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Sparkles size={20} color="#76608C" />
                <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Speech provider</h3>
              </div>

              <div style={{ marginTop: '12px' }}>
                <select
                  aria-label="Dictation provider"
                  className="select"
                  value={settings.provider}
                  onChange={event=>void chooseSpokenLanguage(settings.dictationLanguage,event.target.value)}
                >
                  <option value="local">On this computer (local)</option>
                  <option value="groq">Groq (cloud)</option>
                </select>
              </div>
              <p className="muted">{settings.provider === 'local' ? 'Speech recognition runs on your computer. Save connection changes before managing models.'  : 'Audio is sent to the selected cloud provider. Enter your API key and save to connect.'}</p>

              {settings.provider === 'local' && (
                <details className="settings-disclosure settings-advanced" style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <summary>Advanced speech connection<span>Use an existing local speech server</span></summary>
                  <div>
                    <label style={{ fontSize: '13px', color: '#746F6B', display: 'block', marginBottom: '6px' }}>
                      Speech server address
                    </label>
                    <input
                      type="text"
                      className="input"
                      value={settings.localSttUrl || 'http://localhost:8000/v1'}
                      onChange={(e) => setSettings({ ...settings, localSttUrl: e.target.value })}
                    />
                    <div style={{ fontSize: '11px', color: '#746F6B', marginTop: '4px' }}>
                      Managed speech starts automatically. Use local setup below if it needs repair.
                    </div>
                  </div>
                </details>
              )}

              {settings.provider === 'groq' && (
                <div style={{ marginTop: '12px' }}>
                  <label style={{ fontSize: '13px', color: '#746F6B', display: 'block', marginBottom: '6px' }}>
                    Groq API Key
                  </label>
                  <input
                    type="password"
                    className="input"
                    placeholder="gsk_..."
                    value={settings.groqApiKey || ''}
                    onChange={(e) => setSettings({ ...settings, groqApiKey: e.target.value })}
                  />
                </div>
              )}



            </div>

            {/* Dictation Languages */}
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Globe size={20} color="#76608C" />
                <h3 style={{ fontSize: '16px', fontWeight: 600 }}>What language do you speak?</h3>
              </div>
              <p style={{ fontSize: '13px', color: '#746F6B', marginTop: '4px' }}>
                Choose a language or detect it automatically. Speech stays in its original language and script. Use Hinglish for Hindi-English speech.
              </p>

              <select
                aria-label="Spoken language"
                className="select"
                style={{ marginTop: '12px' }}
                value={settings.dictationLanguage || 'hinglish'}
                disabled={choosingLanguage}
                onChange={event=>void chooseSpokenLanguage(event.target.value)}
              >
                {SPEECH_LANGUAGES.filter(language=>providerSupportsLanguage(settings.provider,language.code)||language.code===settings.dictationLanguage).map(language=><option key={language.code} value={language.code} disabled={!providerSupportsLanguage(settings.provider,language.code)}>{language.name}</option>)}
              </select>
              {!supportsSpeechLanguage(settings.provider,settings.localSttModel,settings.dictationLanguage)&&<p className="model-warning" role="alert">The selected speech model does not support this language. Choose a compatible model or another language before saving.</p>}
              <p className="muted">{settings.provider==='local'?'Owlio keeps a model with documented support or selects a compatible downloaded model for this language. If one is needed, its download appears below.':'Recognition uses the selected cloud speech provider.'}</p>
              {choosingLanguage&&<p role="status" className="muted">Checking compatible downloaded models…</p>}
              {!choosingLanguage&&languageModelNotice&&settings.provider==='local'&&<p role="status" className="settings-status" id="language-model-selection">{languageModelNotice}</p>}
            </div>
            </div>
            <p className="settings-save-note"><strong>Save settings</strong> applies all pending settings. Downloads and repairs start when selected.</p>
            {settings.provider === 'local' && <LocalSpeechSettings settings={settings} currentModel={savedSettings?.localSttModel} onChange={patch=>{if(patch.localSttModel!==undefined)setLanguageModelNotice('');setSettings((previous:any)=>({...previous,...patch}));}} onConnected={syncSetupSettings} onOpenWizard={()=>{
              void(window as any).api.updateSettings({setupCompleted:false}).then(()=>setSettings((previous:any)=>({...previous,setupCompleted:false}))).catch((error:Error)=>setSaveError(error.message));
            }}/>}
            <button className="btn btn-secondary style-link" onClick={()=>setActiveTab('text')}>Choose text output &amp; cleanup →</button>
          </section>
        )}

        {/* ================= TEXT OUTPUT ================= */}
        {activeTab === 'text' && (
          <section className="settings-page text-page" aria-label="Text output and cleanup">
            <div className="header-row"><div><h1 className="page-title">Text &amp; style</h1><p className="page-description">Choose the script, cleanup and writing behavior of your pasted text.</p></div>{saveButton('text')}</div>
            <div className="settings-subnav" aria-label="Text settings views">
              <button className="selected" aria-current="page" onClick={()=>setActiveTab('text')}>Output &amp; cleanup</button>
              <button onClick={()=>setActiveTab('style')}>Writing style{sectionDirty('style') && <span className="draft-dot" aria-label="Unsaved writing style changes"/>}</button>
            </div>
            <DictationFlow settings={settings}/>
            <WritingSettings settings={settings} onChange={patch=>setSettings((previous:any)=>({...previous,...patch}))}/>
            <button className="btn btn-secondary style-link" onClick={()=>setActiveTab('style')}>Writing style →</button>
            <p className="settings-save-note">Use <strong>Save settings</strong> to apply all pending settings.</p>
          </section>
        )}

        {/* ================= GENERAL SETTINGS ================= */}
        {activeTab === 'settings' && (
          <section className="settings-page" aria-label="General settings">
            <div className="header-row"><div><h1 className="page-title">General settings</h1><p className="page-description">Your microphone, shortcuts, floating bar and recording history.</p></div>{saveButton('general')}</div>
            <p className="settings-save-note"><strong>Save settings</strong> applies all pending settings.</p>
            <section className="card" aria-labelledby="startup-heading">
              <h3 id="startup-heading" style={{ fontSize: '16px', fontWeight: 600 }}>Startup</h3>
              <label className="structure-toggle" htmlFor="start-with-windows">
                <input id="start-with-windows" type="checkbox" checked={settings.startWithWindows === true} disabled={!startupStatus?.supported || !!startupStatus.error} onChange={event => setSettings((previous:any) => ({...previous,startWithWindows:event.target.checked}))} aria-describedby="startup-description"/>
                Start Owlio when I sign in to Windows
              </label>
              <p id="startup-description" className="muted">{!startupStatus?'Checking Windows startup settings…':!startupStatus.supported?'Available in the installed Windows app.':startupStatus.error||'After setup, Owlio starts minimized with the floating bar ready.'}</p>
            </section>
            {/* Microphone Selection & Test VU Meter */}
            <div className="card">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Volume2 size={20} color="#396F68" />
                <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Your microphone</h3>
              </div>
              <p style={{ fontSize: '13px', color: '#746F6B', marginTop: '4px' }}>
                Use the Windows default or choose a microphone.
              </p>

              <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                <select
                  aria-label="Your microphone"
                  className="select"
                  style={{ flex: 1 }}
                  value={settings.microphoneDeviceId || ''}
                  onChange={(e) => setSettings({ ...settings, microphoneDeviceId: e.target.value })}
                >
                  <option value="">Windows default</option>
                  {audioDevices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Microphone ${d.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>

                <button
                  className={`btn ${isTestingMic ? 'btn-danger' : 'btn-secondary'}`}
                  onClick={handleTestMicToggle}
                >
                  <Mic size={16} />
                  <span>{isTestingMic ? 'Stop test' : 'Test microphone'}</span>
                </button>
              </div>

              {/* Live VU Meter */}
              {isTestingMic && (
                <div style={{ marginTop: '14px', padding: '12px', background: '#EDEAE3', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#746F6B', marginBottom: '6px' }}>
                    <span>Speak and watch the level move:</span>
                    <span>{Math.round(micTestVolume * 100)}% Volume</span>
                  </div>
                  <div style={{ width: '100%', height: '10px', background: '#E3DFD7', borderRadius: '5px', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${Math.min(100, micTestVolume * 100)}%`,
                        height: '100%',
                        background: micTestVolume > 0.05 ? '#36754C' : '#B14848',
                        transition: 'width 0.05s ease-out',
                      }}
                    />
                  </div>
                </div>
              )}
            </div>

            <ShortcutSettings shortcut={settings.hotkey} mode={settings.mode}
              onShortcutChange={(hotkey) => setSettings((previous: any) => ({ ...previous, hotkey }))}
              onModeChange={(mode) => setSettings((previous: any) => ({ ...previous, mode }))} />

            <AppearanceSettings design={settings.barDesign} onSaved={barDesign => setSettings((previous:any)=>({...previous,barDesign}))} />

            <div className="card">
              <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Recording history</h3>
              <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '14px' }}>
                <input type="checkbox" checked={settings.retainAudio !== false} onChange={(e) => setSettings({ ...settings, retainAudio: e.target.checked })} />
                Save audio recordings
              </label>
              <p style={{ fontSize: '12px', color: '#746F6B', marginTop: '6px' }}>Keep new recordings for playback in History. Turn off to save transcripts only.</p>
            </div>
            <PrivacySettings/>
          </section>
        )}
        </>}
      </div>
    </div>
  );
};
