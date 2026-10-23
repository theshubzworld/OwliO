import { contextBridge, ipcRenderer } from 'electron';
import type { SetupRequest, LocalSetupStatus, StorageTarget } from '../shared/localSetup';

export interface PillStateMessage {
  state?: 'idle' | 'listening' | 'processing' | 'pasted' | 'error';
  sessionId?: number;
  hotkey?: string;
  mode?: 'push_to_talk' | 'toggle';
  microphoneDeviceId?: string;
  targetApp?: string;
  transcription?: string;
  errorMessage?: string;
  isInstruct?: boolean;
  revision?: number;
}

contextBridge.exposeInMainWorld('api', {
  getAccountStatus: () => ipcRenderer.invoke('account-status'),
  signInGoogle: () => ipcRenderer.invoke('account-google'),
  sendSignInCode: (email:string) => ipcRenderer.invoke('account-email-code',email),
  verifySignInCode: (email:string,code:string) => ipcRenderer.invoke('account-verify-code',email,code),
  signOut: () => ipcRenderer.invoke('account-sign-out'),
  cancelSignIn: () => ipcRenderer.invoke('account-cancel'),
  acceptTerms: (confirmed:boolean) => ipcRenderer.invoke('account-accept-terms',confirmed),
  refreshAccountAccess: () => ipcRenderer.invoke('account-refresh-access'),
  getAnalyticsStatus: () => ipcRenderer.invoke('analytics-status'),
  setAnalyticsConsent: (enabled:boolean) => ipcRenderer.invoke('analytics-consent',enabled),
  getAdminMetrics: (days:number) => ipcRenderer.invoke('admin-metrics',days),
  getAdminAccounts: (search:string,page:number) => ipcRenderer.invoke('admin-accounts',search,page),
  setAdminAccountAccess: (userId:string,blocked:boolean,reason:string) => ipcRenderer.invoke('admin-set-access',userId,blocked,reason),
  onAccountChanged: (callback:(status:unknown)=>void) => {
    const handler=(_event:unknown,status:unknown)=>callback(status);
    ipcRenderer.on('account-changed',handler);
    return ()=>ipcRenderer.removeListener('account-changed',handler);
  },
  // Pill Window Controls
  onPillStateChange: (callback: (data: PillStateMessage) => void) => {
    const handler = (_event: any, data: PillStateMessage) => callback(data);
    ipcRenderer.on('pill-state-changed', handler);
    return () => ipcRenderer.removeListener('pill-state-changed', handler);
  },
  submitRecordedAudio: (payload: { buffer: ArrayBuffer; sessionId: number; durationSeconds?: number }) => {
    ipcRenderer.send('audio-recorded', payload);
  },
  toggleDictation: () => ipcRenderer.send('toggle-dictation'),
  getPillState: () => ipcRenderer.invoke('get-pill-state'),
  showFloatingBar: () => ipcRenderer.invoke('show-floating-bar'),
  setPillLayout: (expanded: boolean, active: boolean) => ipcRenderer.send('pill-layout', { expanded, active }),
  setPillHitArea: (rectangle: { x: number; y: number; width: number; height: number }) => ipcRenderer.send('pill-hit-area', rectangle),
  onPillHover: (callback: (hovered: boolean) => void) => {
    const handler = (_event: unknown, hovered: boolean) => callback(hovered);
    ipcRenderer.on('pill-hover', handler);
    return () => ipcRenderer.removeListener('pill-hover', handler);
  },
  recordingFailed: (payload: { sessionId: number; errorMessage: string }) => ipcRenderer.send('recording-failed', payload),
  beginMeetingCapture: () => ipcRenderer.invoke('begin-meeting-capture') as Promise<string>,
  appendMeetingChunk: (id: string, index: number, buffer: ArrayBuffer) => ipcRenderer.invoke('append-meeting-chunk', id, index, buffer),
  finishMeetingCapture: (id: string) => ipcRenderer.invoke('finish-meeting-capture', id),
  abandonMeetingCapture: (id: string) => ipcRenderer.invoke('abandon-meeting-capture', id),
  getMeetingRecoveries: () => ipcRenderer.invoke('get-meeting-recoveries'),
  discardMeetingCapture: (id: string) => ipcRenderer.invoke('discard-meeting-capture', id),
  cancelMeetingProcessing: () => ipcRenderer.invoke('cancel-meeting-processing'),
  recoverDictation: (id: string) => ipcRenderer.invoke('recover-dictation', id),
  openDashboard: (tab?: 'settings' | 'notetaker' | 'dictation') => {
    ipcRenderer.send('open-dashboard', tab);
  },
  onDashboardNavigate: (callback: (tab: string) => void) => {
    const handler = (_event: unknown, tab: string) => callback(tab);
    ipcRenderer.on('dashboard-navigate', handler);
    return () => ipcRenderer.removeListener('dashboard-navigate', handler);
  },
  onShortcutFeedback: (callback: (message: any) => void) => {
    const handler = (_event: unknown, message: any) => callback(message);
    ipcRenderer.on('shortcut-feedback', handler);
    return () => ipcRenderer.removeListener('shortcut-feedback', handler);
  },
  beginShortcutCapture: () => ipcRenderer.invoke('begin-shortcut-capture'),
  beginShortcutTest: (key: string, mode: string) => ipcRenderer.invoke('begin-shortcut-test', { key, mode }),
  cancelShortcut: () => ipcRenderer.invoke('cancel-shortcut'),
  cancelDictation: () => {
    ipcRenderer.send('cancel-dictation');
  },

  // Dashboard Controls
  getSettings: () => ipcRenderer.invoke('get-settings'),
  getStartupStatus: () => ipcRenderer.invoke('get-startup-status'),
  getLocalSetup: () => ipcRenderer.invoke('get-local-setup') as Promise<LocalSetupStatus>,
  startLocalSetup: (request:SetupRequest) => ipcRenderer.invoke('start-local-setup',request) as Promise<LocalSetupStatus>,
  cancelLocalSetup: () => ipcRenderer.invoke('cancel-local-setup'),
  chooseLocalStorage: (target:StorageTarget) => ipcRenderer.invoke('choose-local-storage',target) as Promise<LocalSetupStatus>,
  resetLocalStorage: () => ipcRenderer.invoke('reset-local-storage') as Promise<LocalSetupStatus>,
  copyLocalModels: () => ipcRenderer.invoke('copy-local-models') as Promise<LocalSetupStatus>,
  clearLocalDownloadCache: () => ipcRenderer.invoke('clear-local-download-cache') as Promise<LocalSetupStatus>,
  onLocalSetupStatus: (callback:(status:LocalSetupStatus)=>void) => {
    const handler=(_event:unknown,status:LocalSetupStatus)=>callback(status);
    ipcRenderer.on('local-setup-status',handler);return ()=>ipcRenderer.removeListener('local-setup-status',handler);
  },
  getLastFailure: () => ipcRenderer.invoke('get-last-failure'),
  copyText: (text: string) => ipcRenderer.invoke('copy-text', text),
  getLocalModels: () => ipcRenderer.invoke('get-local-models'),
  speechModelAction: (model: string, action: 'download' | 'activate') => ipcRenderer.invoke('speech-model-action', model, action),
  importSpeechModel: (url: string) => ipcRenderer.invoke('import-speech-model', url),
  deleteSpeechModel: (model: string) => ipcRenderer.invoke('delete-speech-model', model),
  pullFormattingModel: (model: string) => ipcRenderer.invoke('pull-formatting-model', model),
  onDictationUpdated: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('dictation-updated', handler);
    return () => ipcRenderer.removeListener('dictation-updated', handler);
  },
  updateSettings: (settings: any) => ipcRenderer.invoke('update-settings', settings),
  getDictionary: () => ipcRenderer.invoke('get-dictionary'),
  getWritingMemory: () => ipcRenderer.invoke('get-writing-memory'),
  setWritingPreferences: (preferences: unknown) => ipcRenderer.invoke('set-writing-preferences',preferences),
  reviewLearnedWord: (id: string, action: 'accept'|'forget') => ipcRenderer.invoke('review-learned-word',id,action),
  correctDictation: (id: string, edited: string) => ipcRenderer.invoke('correct-dictation',id,edited),
  onWritingMemoryUpdated: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('writing-memory-updated',handler);
    return () => ipcRenderer.removeListener('writing-memory-updated',handler);
  },
  setDictionary: (dictionary: any) => ipcRenderer.invoke('set-dictionary', dictionary),
  getSnippets: () => ipcRenderer.invoke('get-snippets'),
  setSnippets: (snippets: any) => ipcRenderer.invoke('set-snippets', snippets),
  getScratchpad: () => ipcRenderer.invoke('get-scratchpad'),
  setScratchpad: (text: string) => ipcRenderer.invoke('set-scratchpad', text),
  getHistory: () => ipcRenderer.invoke('get-history'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  getMeetings: () => ipcRenderer.invoke('get-meetings'),
  addMeeting: (meeting: unknown) => ipcRenderer.invoke('add-meeting', meeting),
  clearMeetings: () => ipcRenderer.invoke('clear-meetings'),
  triggerTestDictation: () => ipcRenderer.invoke('trigger-test-dictation'),
});
