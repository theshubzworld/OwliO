import type { AppSettings, DictionaryItem, HistoryItem, LearnedWord, MeetingNote, SnippetItem, WritingPreference } from './store';
import { normalizeShortcut } from '../shared/shortcuts';
import { speechModelId } from '../shared/speechModels';
import { SPEECH_LANGUAGE_CODES } from '../shared/speechLanguages';
import { BAR_DESIGNS } from '../shared/barDesigns';

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
  return value as Record<string, unknown>;
}

export function text(value: unknown, max = 100000): string {
  if (typeof value !== 'string' || value.length > max) throw new Error('Invalid or oversized text');
  return value;
}

function choice<T extends string>(value: unknown, values: readonly T[]): T {
  if (!values.includes(value as T)) throw new Error(`Expected one of: ${values.join(', ')}`);
  return value as T;
}

function number(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Invalid number');
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Expected true or false');
  return value;
}

function localUrl(value: unknown): string {
  const result = text(value, 2048);
  const url = new URL(result);
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) {
    throw new Error('Local provider URLs must use HTTP(S) on localhost, 127.0.0.1 or [::1], without credentials or queries');
  }
  return result.replace(/\/+$/, '');
}

export function validateSettings(value: unknown): AppSettings {
  const s = record(value);
  return {
    provider: choice(s.provider, ['local', 'groq']),
    groqApiKey: text(s.groqApiKey, 4096),
    formattingProvider: s.formattingProvider === 'gemini' || s.formattingProvider === 'auto' ? 'ai' : choice(s.formattingProvider ?? 'basic', ['basic', 'ai']),
    writingProvider: choice(s.writingProvider ?? (s.formattingProvider === 'gemini' ? 'gemini' : 'off'), ['off','gemini','local']),
    geminiApiKey: text(s.geminiApiKey ?? '', 4096).trim(),
    geminiStructuredFormatting: boolean(s.geminiStructuredFormatting ?? true),
    romanizationProvider: choice(s.romanizationProvider ?? 'off', ['off', 'gemini']),
    autoLearnCorrections: boolean(s.autoLearnCorrections ?? false),
    contextAwarePunctuation: boolean(s.contextAwarePunctuation ?? true),
    punctuationMode: choice(s.punctuationMode ?? 'auto', ['auto','full','minimal']),
    barDesign: choice(s.barDesign ?? 'owl', BAR_DESIGNS.map(design => design.id)),
    setupCompleted: boolean(s.setupCompleted ?? false),
    localSttUrl: localUrl(s.localSttUrl), localLlmUrl: localUrl(s.localLlmUrl),
    localSttModel: speechModelId(s.localSttModel ?? 'base'),
    localLlmModel: text(s.localLlmModel, 200) || 'llama3.2',
    hotkey: normalizeShortcut(s.hotkey),
    mode: choice(s.mode, ['push_to_talk', 'toggle']),
    writingStyle: choice(s.writingStyle, ['auto', 'casual', 'professional', 'code']),
    instructModeEnabled: boolean(s.instructModeEnabled),
    minAudioDurationMs: number(s.minAudioDurationMs, 100, 5000),
    microphoneDeviceId: text(s.microphoneDeviceId, 1024),
    dictationLanguage: choice(s.dictationLanguage, SPEECH_LANGUAGE_CODES),
    retainAudio: boolean(s.retainAudio),
    startWithWindows: boolean(s.startWithWindows ?? false),
    theme: choice(s.theme ?? 'system', ['system', 'light', 'dark']),
    meetingNotesEnabled: boolean(s.meetingNotesEnabled ?? false),
  };
}

export function list<T>(value: unknown, validate: (item: unknown) => T, max = 1000): T[] {
  if (!Array.isArray(value) || value.length > max) throw new Error('Invalid or oversized list');
  return value.map(validate);
}

export function dictionaryItem(value: unknown): DictionaryItem {
  const v = record(value);
  const item = { id: text(v.id, 100), from: text(v.from, 1000).trim(), to: text(v.to, 10000).trim() };
  if (!item.id || !item.from || !item.to) throw new Error('Dictionary fields cannot be empty');
  return item;
}

export function snippetItem(value: unknown): SnippetItem {
  const v = record(value);
  const item = { id: text(v.id, 100), trigger: text(v.trigger, 1000).trim(), replacement: text(v.replacement, 10000).trim(), description: text(v.description, 1000) };
  if (!item.id || !item.trigger || !item.replacement) throw new Error('Snippet fields cannot be empty');
  return item;
}

export function learnedWord(value: unknown): LearnedWord {
  const v = record(value);
  const word = text(v.word, 120).trim(), observedSource = text(v.observedSource,120).trim();
  if (!word || !observedSource || /[\r\n]/.test(word + observedSource)) throw new Error('Invalid learned spelling');
  return { id: text(v.id,100), word, observedSource, processName: text(v.processName,100), language: text(v.language,20), status: choice(v.status,['learned','pending']), count: number(v.count,1), createdAt: number(v.createdAt), lastUsed: number(v.lastUsed) };
}

export function writingPreference(value: unknown): WritingPreference {
  const v = record(value), rule = text(v.text,300).trim(), appName = text(v.app,100).trim().toLowerCase().replace(/\.exe$/,'');
  if (!rule || !appName || /[\r\n]/.test(appName)) throw new Error('A writing rule and app scope are required');
  return { id: text(v.id,100), text: rule, app: appName, language: choice(v.language,['all',...SPEECH_LANGUAGE_CODES]), enabled: boolean(v.enabled) };
}

export function historyItem(value: unknown): HistoryItem {
  const v = record(value);
  return {
    id: text(v.id, 100), timestamp: number(v.timestamp), processName: text(v.processName, 1000),
    windowTitle: text(v.windowTitle, 10000), rawText: text(v.rawText), formattedText: text(v.formattedText),
    durationMs: number(v.durationMs), wordCount: v.wordCount === undefined ? undefined : number(v.wordCount),
    wpm: v.wpm === undefined ? undefined : number(v.wpm), isInstruct: v.isInstruct === true,
    deliveryStatus: v.deliveryStatus === 'processing' ? 'processing' : v.deliveryStatus === 'failed' ? 'failed' : 'inserted',
    errorMessage: v.errorMessage === undefined ? undefined : text(v.errorMessage, 10000),
    warning: v.warning === undefined ? undefined : text(v.warning, 1000),
    editedText: v.editedText === undefined ? undefined : text(v.editedText, 5000),
    audioFile: typeof v.audioFile === 'string' && /^[a-f0-9-]+\.wav$/.test(v.audioFile) ? v.audioFile : undefined,
  };
}

export function meetingNote(value: unknown): MeetingNote {
  const v = record(value);
  return { id: text(v.id, 100), timestamp: number(v.timestamp), title: text(v.title, 1000),
    duration: number(v.duration), transcript: text(v.transcript, 500000), summary: text(v.summary),
    actions: list(v.actions, (a) => text(a, 10000), 100),
    warning: v.warning === undefined ? undefined : text(v.warning, 1000) };
}
