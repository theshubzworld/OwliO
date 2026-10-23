import fs from 'fs';
import path from 'path';
import { app, safeStorage } from 'electron';
import { randomUUID } from 'crypto';
import { pathToFileURL } from 'url';
import { supportsSpeechLanguage, languageName } from '../shared/speechLanguages';
import type { WritingProvider } from '../shared/writingConfig';
import type { BarDesign } from '../shared/barDesigns';
import { dictionaryItem, historyItem, learnedWord, list, meetingNote, record, snippetItem, text, validateSettings, writingPreference } from './validation';

export interface SnippetItem {
  id: string;
  trigger: string;
  replacement: string;
  description: string;
}

export interface AppSettings {
  provider: 'groq' | 'local';
  groqApiKey: string;
  formattingProvider: 'auto' | 'basic' | 'gemini' | 'ai';
  writingProvider: WritingProvider;
  geminiApiKey: string;
  geminiStructuredFormatting: boolean;
  romanizationProvider: 'off' | 'gemini';
  autoLearnCorrections: boolean;
  contextAwarePunctuation: boolean;
  punctuationMode: 'auto' | 'full' | 'minimal';
  barDesign: BarDesign;
  setupCompleted: boolean;
  localSttUrl: string;       // e.g. http://localhost:8000/v1 (Faster-Whisper / Speaches / Whisper.cpp)
  localSttModel: string;
  localLlmUrl: string;       // e.g. http://localhost:11434 (Ollama)
  localLlmModel: string;     // e.g. llama3.2, mistral, qwen2.5
  hotkey: string;
  mode: 'push_to_talk' | 'toggle';
  writingStyle: 'auto' | 'casual' | 'professional' | 'code';
  instructModeEnabled: boolean;
  minAudioDurationMs: number;
  microphoneDeviceId: string;
  dictationLanguage: string; // Whisper language code, Hinglish, or automatic detection
  retainAudio: boolean;
  startWithWindows: boolean;
}

export interface DictionaryItem {
  id: string;
  from: string;
  to: string;
}

export interface LearnedWord {
  id: string; word: string; observedSource: string; processName: string; language: string;
  status: 'learned' | 'pending'; count: number; createdAt: number; lastUsed: number;
}
export interface WritingPreference {
  id: string; text: string; app: string; language: string; enabled: boolean;
}

export interface HistoryItem {
  id: string;
  timestamp: number;
  processName: string;
  windowTitle: string;
  rawText: string;
  formattedText: string;
  durationMs: number;
  wordCount?: number;
  wpm?: number;
  audioUrl?: string;
  audioFile?: string;
  isInstruct?: boolean;
  isMeeting?: boolean;
  meetingSummary?: string;
  actionItems?: string[];
  deliveryStatus?: 'inserted' | 'failed' | 'processing';
  errorMessage?: string;
  warning?: string;
  editedText?: string;
}

export interface AppData {
  settings: AppSettings;
  dictionary: DictionaryItem[];
  learnedVocabulary: LearnedWord[];
  writingPreferences: WritingPreference[];
  snippets: SnippetItem[];
  scratchpadText: string;
  history: HistoryItem[];
  meetings: MeetingNote[];
}

export interface MeetingNote {
  id: string;
  timestamp: number;
  title: string;
  duration: number;
  transcript: string;
  summary: string;
  actions: string[];
  warning?: string;
}

const SCRATCHPAD_WELCOME = 'Welcome to your Owlio Scratchpad!\n\nClick the text area to type or dictate ideas, notes and drafts. Select Save draft to keep your text for next time.';

const DEFAULT_DATA: AppData = {
  settings: {
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
    setupCompleted: false,
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
  },
  dictionary: [
    { id: '1', from: 'whisper', to: 'Whisper' },
    { id: '2', from: 'owl io', to: 'Owlio' },
    { id: '3', from: 'k8s', to: 'Kubernetes' },
    { id: '4', from: 'ollama', to: 'Ollama' },
  ],
  learnedVocabulary: [],
  writingPreferences: [],
  snippets: [
    { id: '1', trigger: ';intro', replacement: 'Hey there! Hope you are having a productive day.', description: 'Casual greeting' },
    { id: '2', trigger: ';call', replacement: 'Let us jump on a quick 10-minute huddle to align on this.', description: 'Quick meeting invite' },
  ],
  scratchpadText: SCRATCHPAD_WELCOME,
  history: [],
  meetings: [],
};

export class Store {
  private filePath: string;
  private audioDir: string;
  private cache?: AppData;

  constructor(root = app.getPath('userData')) {
    this.filePath = path.join(root, 'owlio_config.json');
    this.audioDir = path.join(root, 'recordings');
  }

  // Load lazily: OS credential encryption is available only after Electron is ready.
  private get data(): AppData {
    if (this.cache) return this.cache;
    if (!fs.existsSync(this.filePath)) return this.cache = structuredClone(DEFAULT_DATA);
    try {
      const raw = record(JSON.parse(fs.readFileSync(this.filePath, 'utf8')));
      const settings = { ...DEFAULT_DATA.settings, ...record(raw.settings) };
      const previous = record(raw.settings);
      const retiredSpeech = previous.provider === 'openai' || previous.provider === 'mock';
      if (retiredSpeech) settings.provider = 'local';
      if (previous.writingProvider === undefined || ['groq','openai'].includes(String(previous.writingProvider))) {
        settings.writingProvider = previous.formattingProvider === 'gemini' || previous.geminiApiKey ? 'gemini' : previous.provider === 'local' && previous.formattingProvider === 'auto' ? 'local' : 'off';
      }
      if (settings.writingProvider !== 'gemini') settings.formattingProvider = 'basic';
      if (settings.writingProvider === 'off') settings.instructModeEnabled = false;
      // Removed speech choices return to setup without discarding history or other preferences.
      settings.setupCompleted = retiredSpeech ? false : previous.setupCompleted === undefined ? true : settings.setupCompleted;
      for (const key of ['groqApiKey', 'geminiApiKey'] as const) {
        const value = text(settings[key], 20000);
        if (value.startsWith('encrypted:')) {
          settings[key] = safeStorage.decryptString(Buffer.from(value.slice(10), 'base64'));
        }
      }
      const loaded: AppData = {
        settings: validateSettings(settings),
        dictionary: list(raw.dictionary ?? DEFAULT_DATA.dictionary, dictionaryItem),
        learnedVocabulary: list(raw.learnedVocabulary ?? [], learnedWord, 200),
        writingPreferences: list(raw.writingPreferences ?? [], writingPreference, 50),
        snippets: list(raw.snippets ?? DEFAULT_DATA.snippets, snippetItem),
        history: list(raw.history ?? [], historyItem, 200).map(item => item.deliveryStatus === 'processing' ? {...item, deliveryStatus:'failed' as const, errorMessage:'Processing was interrupted. Recognized text and retained audio are available for recovery.'} : item),
        meetings: list(raw.meetings ?? [], meetingNote, 100),
        scratchpadText: text(raw.scratchpadText ?? ''),
      };
      // Migrate legacy plaintext keys and discard ephemeral blob URLs on the first read.
      this.cache = loaded;
      if (loaded.settings.groqApiKey || loaded.settings.geminiApiKey || retiredSpeech || previous.openaiApiKey !== undefined) this.commit(loaded);
      this.pruneAudio(loaded.history);
      return loaded;
    } catch {
      throw new Error('Cannot load or securely migrate saved data. The original config was preserved; check its permissions, format and Windows account before retrying.');
    }
  }

  private commit(next: AppData): void {
    const disk = structuredClone(next);
    for (const key of ['groqApiKey', 'geminiApiKey'] as const) {
      if (disk.settings[key]) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows credential encryption is unavailable. API keys were not saved.');
        disk.settings[key] = 'encrypted:' + safeStorage.encryptString(disk.settings[key]).toString('base64');
      }
    }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = this.filePath + '.' + randomUUID() + '.tmp';
    try {
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(disk, null, 2)); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      fs.renameSync(temporary, this.filePath);
      this.cache = next;
    } catch {
      throw new Error('Could not save data to disk. Check available space and file permissions; your changes were not saved.');
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }

  public getSettings(): AppSettings { return structuredClone(this.data.settings); }
  public previewSettings(settings: Partial<AppSettings>): AppSettings {
    const patch = {...record(settings)};
    if(patch.writingProvider===undefined&&patch.formattingProvider==='gemini') patch.writingProvider='gemini';
    if(patch.writingProvider===undefined&&patch.formattingProvider==='auto') patch.writingProvider=this.data.settings.geminiApiKey?'gemini':'off';
    const next = validateSettings({ ...this.data.settings, ...patch });
    if(!supportsSpeechLanguage(next.provider,next.localSttModel,next.dictationLanguage))throw new Error(`${languageName(next.dictationLanguage)} is not available with the selected speech model. Choose a compatible speech model or another spoken language.`);
    if (next.provider === 'groq' && !next.groqApiKey.trim()) throw new Error('Enter a Groq API key before selecting Groq.');
    if ((next.formattingProvider === 'gemini' || next.formattingProvider === 'ai' && next.writingProvider === 'gemini' || next.instructModeEnabled && next.writingProvider === 'gemini') && !next.geminiApiKey.trim()) throw new Error('Enter your Vertex API key before selecting Gemini cleanup.');
    if (next.romanizationProvider === 'gemini' && !next.geminiApiKey.trim()) throw new Error('Enter your Vertex API key before selecting Gemini Roman Hinglish.');
    if (next.formattingProvider === 'ai' && next.writingProvider !== 'gemini') throw new Error('Connect a Writing AI using Gemini before enabling AI cleanup. Ollama supports rewrites and meeting summaries.');
    if (next.instructModeEnabled && next.writingProvider === 'off') throw new Error('Connect a Writing AI before enabling voice rewrites.');
    return next;
  }
  public updateSettings(settings: Partial<AppSettings>): AppSettings {
    const next=this.previewSettings(settings);
    this.commit({ ...this.data, settings: next });
    return this.getSettings();
  }

  public getDictionary(): DictionaryItem[] { return structuredClone(this.data.dictionary); }
  public getLearnedVocabulary(): LearnedWord[] { return structuredClone(this.data.learnedVocabulary); }
  public getWritingPreferences(): WritingPreference[] { return structuredClone(this.data.writingPreferences); }
  public setWritingPreferences(value: WritingPreference[]): WritingPreference[] {
    const preferences = list(value, writingPreference, 50);
    this.commit({ ...this.data, writingPreferences: preferences });
    return this.getWritingPreferences();
  }
  public reviewLearnedWord(id: string, action: 'accept' | 'forget'): LearnedWord[] {
    const words = this.data.learnedVocabulary;
    if (!words.some(word => word.id === id)) throw new Error('This vocabulary entry no longer exists.');
    this.commit({ ...this.data, learnedVocabulary: action === 'forget' ? words.filter(word => word.id !== id) : words.map(word => word.id === id ? { ...word, status: 'learned' as const } : word) });
    return this.getLearnedVocabulary();
  }
  public saveCorrection(historyId: string, editedText: string, candidates: {word:string;observedSource:string}[], accepted: string[]): void {
    const history = this.data.history.find(item => item.id === historyId);
    if (!history || history.deliveryStatus !== 'inserted' || history.isInstruct || history.isMeeting) throw new Error('Only an inserted dictation can teach vocabulary.');
    const checkedText = text(editedText, 5000).trim();
    if (!checkedText) throw new Error('A correction cannot be empty.');
    const words = structuredClone(this.data.learnedVocabulary);
    const now = Date.now();
    for (const candidate of candidates.slice(0, 4)) {
      const existing = words.find(word => word.word.toLocaleLowerCase() === candidate.word.toLocaleLowerCase());
      if (existing) { existing.lastUsed = now; existing.count++; if (accepted.includes(candidate.word)) existing.status = 'learned'; }
      else words.push(learnedWord({ id: randomUUID(), ...candidate, processName: history.processName, language: this.data.settings.dictationLanguage, status: accepted.includes(candidate.word) ? 'learned' : 'pending', count: 1, createdAt: now, lastUsed: now }));
    }
    words.sort((a,b) => b.lastUsed-a.lastUsed);
    this.commit({ ...this.data, learnedVocabulary: words.slice(0,200), history: this.data.history.map(item => item.id === historyId ? { ...item, editedText: checkedText } : item) });
  }
  public setDictionary(dictionary: DictionaryItem[]): void {
    this.commit({ ...this.data, dictionary: list(dictionary, dictionaryItem) });
  }
  public getSnippets(): SnippetItem[] { return structuredClone(this.data.snippets); }
  public setSnippets(snippets: SnippetItem[]): void {
    this.commit({ ...this.data, snippets: list(snippets, snippetItem) });
  }
  public getScratchpad(): string { return this.data.scratchpadText; }
  public setScratchpad(value: string): void { this.commit({ ...this.data, scratchpadText: text(value) }); }

  public getHistory(): HistoryItem[] {
    return this.data.history.map((item) => ({ ...structuredClone(item), audioUrl: item.audioFile && fs.existsSync(path.join(this.audioDir, item.audioFile)) ? pathToFileURL(path.join(this.audioDir, item.audioFile)).href : undefined }));
  }

  public addHistory(item: HistoryItem, audio?: Buffer): void {
    const checked = historyItem(item);
    const previous = this.data.history.find(entry => entry.id === checked.id);
    if (!audio && previous?.audioFile) checked.audioFile = previous.audioFile;
    let audioPath: string | undefined;
    if (audio && this.data.settings.retainAudio) {
      fs.mkdirSync(this.audioDir, { recursive: true });
      checked.audioFile = randomUUID() + '.wav';
      audioPath = path.join(this.audioDir, checked.audioFile);
      fs.writeFileSync(audioPath, audio, { flag: 'wx', mode: 0o600 });
    }
    const history = [checked, ...this.data.history.filter(entry => entry.id !== checked.id)].slice(0, 200);
    try { this.commit({ ...this.data, history }); }
    catch (error) { if (audioPath) fs.unlinkSync(audioPath); throw error; }
    this.pruneAudio(history);
  }

  public getHistoryAudio(id: string): Buffer {
    const item = this.data.history.find(entry => entry.id === id);
    if (!item?.audioFile) throw new Error('This dictation has no retained audio. Enable recording retention for future recovery.');
    return fs.readFileSync(path.join(this.audioDir, item.audioFile));
  }

  private pruneAudio(history: HistoryItem[]): void {
    if (!fs.existsSync(this.audioDir)) return;
    const keep = new Set(history.map((item) => item.audioFile));
    for (const file of fs.readdirSync(this.audioDir)) {
      if (/^[a-f0-9-]+\.wav$/.test(file) && !keep.has(file)) fs.unlinkSync(path.join(this.audioDir, file));
    }
  }
  public clearHistory(): void {
    this.commit({ ...this.data, history: [] });
    // Report a deletion failure rather than claim private recordings were removed.
    this.pruneAudio([]);
  }
  public getMeetings(): MeetingNote[] { return structuredClone(this.data.meetings); }
  public addMeeting(note: MeetingNote): MeetingNote {
    const checked = meetingNote(note);
    this.commit({ ...this.data, meetings: [checked, ...this.data.meetings.filter(item => item.id !== checked.id)].slice(0, 100) });
    return structuredClone(checked);
  }
  public clearMeetings(): void { this.commit({ ...this.data, meetings: [] }); }
}

export const store = new Store();
