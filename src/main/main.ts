import { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, clipboard, dialog } from 'electron';
import path from 'path';
import { helperBridge } from './helperBridge';
import { processAudioDictation, transcribeAudio, summarizeMeeting, WindowContext, DictationResult } from './aiService';
import { store } from './store';
import { getLocalModels, speechModelAction, pullFormattingModel, importSpeechModel, deleteSpeechModel } from './localModels';
import { normalizeShortcut } from '../shared/shortcuts';
import { SpeechServer } from './speechServer';
import { LearningService } from './learningService';
import { text } from './validation';
import fs from 'fs';
import { LocalSetup } from './localSetup';
import { storagePaths } from './localStorage';
import type { StorageTarget } from '../shared/localSetup';
import { MeetingCaptureStore } from './meetingCapture';
import { WindowsStartup } from './windowsStartup';
import { startCloudServices, stopCloudServices, captureMetric, requireAccountAccess } from './cloudRuntime';

const windowsStartup = new WindowsStartup(app);

const speechDirectory=app.isPackaged ? path.join(process.resourcesPath,'speech') : path.resolve(__dirname,'../..');
const speechServer = new SpeechServer({ packaged: app.isPackaged, profile: app.getPath('userData'), resources: process.resourcesPath, speechDirectory });
const learningService = new LearningService(store);
const meetingCaptures = new MeetingCaptureStore(path.join(app.getPath('userData'), 'meeting-captures'));
let activeMeetingCapture: string | undefined;
let meetingStarting = false;
let meetingProcessing: AbortController | undefined;
let dictationRecovery: AbortController | undefined;
const ownsInstance = !app.isPackaged || app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
if (app.isPackaged && ownsInstance) app.on('second-instance', (_event, commandLine) => { if (!commandLine.includes('--startup')) createDashboardWindow(); });

let pillWindow: BrowserWindow | null = null;
let dashboardWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let lastFailure: { timestamp: number; errorMessage: string } | null = null;
let switchingModel = false;
const iconPath = path.join(__dirname, '../../assets/brand/owlio-icon.png');
const windowIconPath = path.join(__dirname, '../../assets/brand/owlio.ico');
app.setAppUserModelId('com.owlio.desktop');
app.setPath('userData', path.join(app.getPath('appData'), 'Owlio'));
let pillHover = false;
let pillHitArea = { x: 8, y: 8, width: 48, height: 32 };
let pillPointerTimer: ReturnType<typeof setInterval> | undefined;
let quitting = false;
let repairingPill = false;
let lastPillRepaint = 0;
let pillRevision = 0;
let latestPillState: Record<string, unknown> = { state: 'idle', revision: 0 };
const learningTargets = new Map<string,{historyId:string;original:string;expiresAt:number}>();
const pillBottomGap = 3;

let sessionSequence = 0;
let activeSession: { id: number; phase: 'recording' | 'processing' | 'submitted'; context: Promise<WindowContext>; controller: AbortController; stopTimer?: ReturnType<typeof setTimeout> } | null = null;
const localSetup = new LocalSetup({profile:app.getPath('userData'),speech:speechDirectory,
  currentModel:()=>store.getSettings().localSttModel,
  currentLanguage:()=>store.getSettings().dictationLanguage,
  beforeStart:()=>{if(activeSession || switchingModel || activeMeetingCapture || meetingStarting || meetingProcessing || dictationRecovery)throw Error('Finish recording, processing or model switching before setting up local speech.');},
  onReady:async(config,model,language)=>{
    switchingModel=true;
    const configPath=path.join(app.getPath('userData'),'speech-runtime.json');
    const previous=fs.existsSync(configPath)?fs.readFileSync(configPath):undefined;
    const settings=store.getSettings();
    const temporary=configPath+`.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(temporary,JSON.stringify(config,null,2));fs.renameSync(temporary,configPath);
      const updated=store.updateSettings({provider:'local',localSttUrl:'http://127.0.0.1:17861/v1',localSttModel:model,...(language?{dictationLanguage:language}:{})});
      await speechServer.reload();await speechServer.ensure(updated);
      dashboardWindow?.webContents.send('dictation-updated');
    } catch(error) {
      await speechServer.reload();
      if(previous)fs.writeFileSync(configPath,previous);else if(fs.existsSync(configPath))fs.unlinkSync(configPath);
      store.updateSettings({provider:settings.provider,localSttUrl:settings.localSttUrl,localSttModel:settings.localSttModel,dictationLanguage:settings.dictationLanguage});
      if(previous)void speechServer.ensure(settings).catch(()=>{});
      throw error;
    } finally {if(fs.existsSync(temporary))fs.unlinkSync(temporary);switchingModel=false;}
  }});
localSetup.on('status',status=>dashboardWindow?.webContents.send('local-setup-status',status));
let currentContext: WindowContext = {
  processName: 'desktop',
  windowTitle: '',
  browserUrl: '',
  surroundingText: '',
};

function createPillWindow() {
  clearInterval(pillPointerTimer);
  const primaryDisplay = screen.getPrimaryDisplay();
  const area = primaryDisplay.workArea;

  const pillWidth = 64;
  const pillHeight = 40;
  const x = area.x + Math.round((area.width - pillWidth) / 2);
  const y = area.y + area.height - pillHeight - pillBottomGap;

  pillWindow = new BrowserWindow({
    width: pillWidth,
    height: pillHeight,
    minWidth: 1,
    minHeight: 1,
    x,
    y,
    frame: false,
    transparent: true,
    // Keep the idle companion in the normal window stack so it does not cover
    // video players or other foreground apps. Dictation raises it temporarily.
    alwaysOnTop: false,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: false,
    type: 'toolbar',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      autoplayPolicy: 'no-user-gesture-required',
      // A transparent toolbar can be treated as occluded by Windows even while
      // its microphone is running. Keep its frames drawing in the background.
      backgroundThrottling: false,
    },
  });

  const devUrl = 'http://localhost:5173?view=pill';
  const prodPath = path.join(__dirname, '../renderer/index.html');

  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    pillWindow.loadURL(`file://${prodPath}?view=pill`).catch(() => {
      pillWindow?.loadURL(devUrl);
    });
  } else {
    pillWindow.loadFile(prodPath, { query: { view: 'pill' } });
  }

  pillWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
  pillWindow.setIgnoreMouseEvents(true, { forward: true });
  const window = pillWindow;
  window.once('ready-to-show', () => showPillWindow());
  window.webContents.on('did-finish-load', () => {
    if (quitting || pillWindow !== window) return;
    showPillWindow();
    window.webContents.send('pill-state-changed', { ...latestPillState, snapshot: true });
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    if (quitting) return;
    console.error('Floating bar renderer exited:', details.reason);
    if (activeSession?.phase !== 'submitted') finishSession({ state: 'error', errorMessage: 'The floating bar restarted. Please retry dictation.' });
    // Recreate the native transparent surface as well as the renderer. Reloading
    // a crashed renderer can leave Windows' old layered surface blank.
    setTimeout(() => { if (!quitting && !window.isDestroyed()) window.destroy(); }, 100);
  });
  window.on('closed', () => {
    if (pillWindow !== window) return;
    pillWindow = null;
    if (!quitting) {
      if (!repairingPill && activeSession?.phase !== 'submitted') finishSession({ state: 'error', errorMessage: 'The floating bar restarted. Please retry dictation.' });
      // finishSession may already create the replacement while showing its error.
      if (!pillWindow) createPillWindow();
    }
  });
  // Mouse forwarding varies between Windows window styles. Track the native cursor
  // against the visible controls, so transparent margins always remain click-through.
  pillPointerTimer = setInterval(() => {
    if (!pillWindow || pillWindow.isDestroyed()) return;
    if (!pillWindow.isVisible() || pillWindow.isMinimized()) showPillWindow();
    if (Date.now() - lastPillRepaint >= 1000) {
      lastPillRepaint = Date.now();
      pillWindow.webContents.invalidate();
    }
    const cursor = screen.getCursorScreenPoint();
    const bounds = pillWindow.getBounds();
    const hit = cursor.x >= bounds.x + pillHitArea.x && cursor.x < bounds.x + pillHitArea.x + pillHitArea.width &&
      cursor.y >= bounds.y + pillHitArea.y && cursor.y < bounds.y + pillHitArea.y + pillHitArea.height;
    if (hit !== pillHover) {
      pillHover = hit;
      pillWindow.setIgnoreMouseEvents(!hit, { forward: true });
      pillWindow.webContents.send('pill-hover', hit);
    }
  }, 50);
  pillPointerTimer.unref();
}

function showPillWindow(reposition = false) {
  if (quitting) return;
  if (!pillWindow || pillWindow.isDestroyed()) { createPillWindow(); return; }
  if (reposition) {
    const area = screen.getPrimaryDisplay().workArea;
    const { width, height } = pillWindow.getBounds();
    pillWindow.setBounds({ x: area.x + Math.round((area.width - width) / 2), y: area.y + area.height - height - pillBottomGap, width, height });
  }
  if (pillWindow.isMinimized()) pillWindow.restore();
  const dictationInProgress = activeSession !== null;
  pillWindow.setAlwaysOnTop(dictationInProgress, 'floating');
  pillWindow.showInactive();
  if (dictationInProgress) pillWindow.moveTop();
  pillWindow.webContents.invalidate();
}

function repairPillWindow() {
  if (quitting) return;
  if (activeSession) { showPillWindow(true); return; }
  const settings = store.getSettings();
  latestPillState = { state: 'idle', hotkey: settings.hotkey, mode: settings.mode, microphoneDeviceId: settings.microphoneDeviceId, revision: ++pillRevision };
  repairingPill = true;
  try {
    if (pillWindow && !pillWindow.isDestroyed()) pillWindow.destroy();
    else createPillWindow();
  } finally { repairingPill = false; }
}

function createDashboardWindow(tab?: 'settings' | 'notetaker' | 'dictation' | 'account', minimized = false) {
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.show();
    dashboardWindow.focus();
    if (tab) dashboardWindow.webContents.send('dashboard-navigate', tab);
    return;
  }

  dashboardWindow = new BrowserWindow({
    width: 1120,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: !minimized,
    icon: windowIconPath,
    title: 'Owlio - AI Voice Dictation & Notes',
    backgroundColor: '#F5F3EE',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const prodPath = path.join(__dirname, '../renderer/index.html');
  dashboardWindow.loadFile(prodPath, { query: { view: 'dashboard', ...(tab ? { tab } : {}) } });
  if (minimized) dashboardWindow.once('ready-to-show', () => { dashboardWindow?.showInactive(); dashboardWindow?.minimize(); });

  dashboardWindow.on('closed', () => {
    dashboardWindow = null;
    const capture = activeMeetingCapture;
    activeMeetingCapture = undefined;
    if (capture) void meetingCaptures.failed(capture).catch(console.error);
    void helperBridge.cancelShortcut().catch(() => {});
  });
}

function setupTray() {
  const icon = nativeImage.createFromPath(iconPath).resize({ width: 24, height: 24 });
  tray = new Tray(icon);
  tray.setToolTip('Owlio - Voice Dictation Active');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Dashboard',
      click: () => createDashboardWindow(),
    },
    {
      label: 'Show floating bar',
      click: () => repairPillWindow(),
    },
    {
      label: 'Start dictation',
      click: () => startDictation(),
    },
    { type: 'separator' },
    {
      label: 'Quit Owlio',
      click: () => {
        helperBridge.stop();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => createDashboardWindow());
  tray.on('double-click', () => createDashboardWindow());
}

function notifyPill(message: Record<string, unknown>) {
  latestPillState = message.state
    ? { hotkey: latestPillState.hotkey, mode: latestPillState.mode, barDesign: latestPillState.barDesign, ...message, revision: ++pillRevision }
    : { ...latestPillState, ...message, revision: ++pillRevision };
  if (message.state === 'error') {
    lastFailure = { timestamp: Date.now(), errorMessage: String(message.errorMessage || 'Dictation failed') };
    dashboardWindow?.webContents.send('dictation-updated');
  }
  if (message.state && message.state !== 'idle') showPillWindow();
  if (pillWindow && !pillWindow.isDestroyed() && !pillWindow.webContents.isCrashed()) pillWindow.webContents.send('pill-state-changed', { ...message, revision: pillRevision });
}

function finishSession(message: Record<string, unknown>) {
  const session = activeSession;
  const sessionId = activeSession?.id;
  clearTimeout(activeSession?.stopTimer);
  activeSession = null;
  session?.controller.abort();
  notifyPill({ ...message, sessionId });
}

function startDictation(targetHwnd?: string) {
  try{requireAccountAccess();}catch(error){notifyPill({state:'error',errorMessage:(error as Error).message});createDashboardWindow('account');return;}
  if (activeMeetingCapture || meetingStarting || meetingProcessing || dictationRecovery) { notifyPill({state:'error', errorMessage:'Finish the current recording or recovery before dictating.'}); return; }
  if (switchingModel) { notifyPill({ state: 'error', errorMessage: 'Speech model is loading. Wait for it to finish before dictating.' }); return; }
  if (activeSession) return;
  learningTargets.clear();
  const context = helperBridge.getContext(targetHwnd);
  const session = { id: ++sessionSequence, phase: 'recording' as const, context, controller: new AbortController() };
  activeSession = session;
  // Start the microphone immediately; slow UI Automation must not delay or reorder recording.
  notifyPill({ state: 'listening', sessionId: session.id, microphoneDeviceId: store.getSettings().microphoneDeviceId });
  void context.then((result) => {
    if (activeSession === session) currentContext = result;
  }).catch((error: Error) => {
    if (activeSession === session) finishSession({ state: 'error', errorMessage: error.message });
  });
}

function stopDictation() {
  const session = activeSession;
  if (!session || session.phase !== 'recording') return;
  session.phase = 'processing';
  notifyPill({ state: 'processing', sessionId: session.id, targetApp: currentContext.processName });
  session.stopTimer = setTimeout(() => {
    if (activeSession === session && session.phase === 'processing') finishSession({ state: 'error', errorMessage: 'Microphone did not finish recording. Please retry.' });
  }, 10000);
}

function setupHelperListeners() {
  helperBridge.on('learning-correction', async message => {
    const target = learningTargets.get(message?.targetId);
    learningTargets.delete(message?.targetId);
    if (!target || Date.now()>target.expiresAt || !store.getSettings().autoLearnCorrections || message.originalText !== target.original || typeof message.editedText !== 'string' || message.editedText.length>5000) return;
    try {
      await learningService.correct(target.historyId,message.editedText);
      dashboardWindow?.webContents.send('writing-memory-updated');
      dashboardWindow?.webContents.send('dictation-updated');
    } catch { /* Optional correction learning must not interrupt a new dictation. */ }
  });
  helperBridge.on('hotkey_down', (message) => {
    startDictation(message?.targetHwnd);
  });

  helperBridge.on('hotkey_up', () => {
    stopDictation();
  });

  helperBridge.on('hotkey_toggle', (message) => {
    if (activeSession) {
      stopDictation();
    } else {
      startDictation(message?.targetHwnd);
    }
  });

  helperBridge.on('helper-error', (error: Error) => {
    finishSession({ state: 'error', errorMessage: error.message });
    dashboardWindow?.webContents.send('shortcut-feedback', { name: 'shortcut_cancelled', message: error.message });
  });
  helperBridge.on('shortcut-event', (message) => dashboardWindow?.webContents.send('shortcut-feedback', message));
  const settings = store.getSettings();
  helperBridge.updateHotkey(settings.hotkey, settings.mode);
  helperBridge.start();
}

app.whenReady().then(() => {
  if (!ownsInstance) return;
  startCloudServices(()=>{
    finishSession({state:'idle'});helperBridge.cancelPaste();meetingProcessing?.abort();dictationRecovery?.abort();
    if(activeMeetingCapture){const id=activeMeetingCapture;activeMeetingCapture=undefined;void meetingCaptures.failed(id).catch(()=>{});}
    createDashboardWindow('account');
  });
  createPillWindow();
  // Always show the required account/terms gate on launch, including upgrades.
  createDashboardWindow(undefined, process.argv.includes('--startup'));
  setupTray();
  setupHelperListeners();
  void meetingCaptures.list().catch(error => console.error('Meeting recovery cleanup failed:', error));
  if(store.getSettings().setupCompleted !== false) void speechServer.ensure(store.getSettings()).catch(error => finishSession({ state: 'error', errorMessage: error.message }));
  screen.on('display-added', () => showPillWindow(true));
  screen.on('display-removed', () => showPillWindow(true));
  screen.on('display-metrics-changed', () => showPillWindow(true));

  // IPC Handlers
  ipcMain.handle('get-pill-state', () => latestPillState);
  ipcMain.handle('get-local-setup',()=>localSetup.getStatus());
  ipcMain.handle('start-local-setup',(_event,request)=>{requireAccountAccess();return localSetup.start(request);});
  ipcMain.handle('cancel-local-setup',()=>localSetup.cancel());
  ipcMain.handle('choose-local-storage',async(_event,target:StorageTarget)=>{
    if(!['root','runtimes','models','cache'].includes(target))throw Error('Choose a supported storage folder.');
    localSetup.assertIdle();
    const locations=localSetup.getStatus().storage!;
    const names={root:'OwlioData',runtimes:'Owlio-environments',models:'Owlio-models',cache:'Owlio-downloads'};
    const options={title:`Choose a parent folder for ${names[target]}`,defaultPath:locations[target],properties:['openDirectory','createDirectory'] as ('openDirectory'|'createDirectory')[],buttonLabel:'Use this folder'};
    const result=dashboardWindow?await dialog.showOpenDialog(dashboardWindow,options):await dialog.showOpenDialog(options);
    if(result.canceled||!result.filePaths.length)return localSetup.getStatus();
    const selected=result.filePaths[0];
    const folder=path.basename(selected).toLowerCase()===names[target].toLowerCase()?selected:path.join(selected,names[target]);
    return localSetup.setStorage(target==='root'?storagePaths(folder):{...locations,[target]:folder});
  });
  ipcMain.handle('reset-local-storage',()=>localSetup.resetStorage());
  ipcMain.handle('copy-local-models',()=>localSetup.copyModels());
  ipcMain.handle('clear-local-download-cache',()=>localSetup.clearCache());
  ipcMain.handle('show-floating-bar', () => repairPillWindow());
  ipcMain.on('audio-recorded', async (_event, payload: any) => {
    const session = activeSession;
    if (!session || payload?.sessionId !== session.id || session.phase !== 'processing') return;
    session.phase = 'submitted';
    clearTimeout(session.stopTimer);
    let result: DictationResult | undefined;
    let context: WindowContext | undefined;
    let wavBuffer: Buffer | undefined;
    let audioSeconds = 0;
    let inserted = false;
    let audioSaved = false;
    const metricsStarted=Date.now();
    const historyId = String(Date.now()) + '-' + session.id;
    const saveHistory = (errorMessage?: string, processing = false) => {
      if (!context || !wavBuffer) return;
      const text = result?.formattedText || '';
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      store.addHistory({
        id: historyId, timestamp: Date.now(), processName: context.processName, windowTitle: context.windowTitle,
        rawText: result?.rawText || '', formattedText: text, isInstruct: result?.isInstruct || false, warning: result?.warning,
        durationMs: Math.round(audioSeconds * 1000), wordCount: words,
        wpm: Math.round(words / Math.max(audioSeconds, .5) * 60),
        deliveryStatus: inserted ? 'inserted' : processing ? 'processing' : 'failed', errorMessage,
      }, audioSaved ? undefined : wavBuffer);
      audioSaved = true;
      dashboardWindow?.webContents.send('dictation-updated');
    };
    try {
      context = await session.context;
      requireAccountAccess();
      if (activeSession !== session) return;
      const arrayBuffer = payload?.buffer || payload;
      if (!arrayBuffer || (!(arrayBuffer instanceof ArrayBuffer) && !Buffer.isBuffer(arrayBuffer))) throw new Error('Invalid audio payload');
      wavBuffer = Buffer.isBuffer(arrayBuffer) ? arrayBuffer : Buffer.from(new Uint8Array(arrayBuffer));
      if (wavBuffer.length > 25 * 1024 * 1024) throw new Error('Audio payload is too large');
      if (wavBuffer.length < 1000) throw new Error('No audio captured. Hold the key longer and check your microphone.');
      audioSeconds = typeof payload.durationSeconds === 'number' && Number.isFinite(payload.durationSeconds) && payload.durationSeconds > 0 && payload.durationSeconds <= 900
        ? payload.durationSeconds : Math.max(0, (wavBuffer.length - 44) / 32000);
      try { saveHistory('Processing recording. If interrupted, use the retained audio to recover it.', true); }
      catch (error) { console.error('Recovery recording could not be saved:', error); }
      await speechServer.ensure(store.getSettings());
      if (activeSession !== session) return;
      result = await processAudioDictation(wavBuffer, context, {signal: session.controller.signal,
        onStage:(stage,outcome,duration_ms)=>captureMetric(outcome==='success'?'stage_completed':'stage_failed',{stage,outcome,duration_ms}),
        onTranscribed: rawText => {
        result = {rawText, formattedText: rawText, isInstruct: false};
        try { saveHistory('Speech recognized; text cleanup is still processing.', true); }
        catch (error) { console.error('Recognized text could not be saved:', error); }
      }});
      if (activeSession !== session) return;
      if (!result.formattedText.trim()) throw new Error('No speech detected. Check your microphone and try again.');
      if (result.skipInsertion) throw new Error(result.warning || 'The rewrite could not finish. The selected text was left unchanged.');
      if (result.isInstruct && !result.replaceText?.trim()) throw new Error('A rewrite requires the exact selected source text. Your revision was saved to history.');
      requireAccountAccess();
      clipboard.writeText(result.formattedText);
      const learn = store.getSettings().autoLearnCorrections === true && !result.isInstruct;
      const insertionStarted=Date.now();
      const pasted = result.isInstruct
        ? await helperBridge.paste(result.formattedText, context.targetId, false, result.replaceText)
        : await helperBridge.paste(result.formattedText, context.targetId, learn);
      captureMetric(pasted?'stage_completed':'stage_failed',{stage:'insertion',outcome:pasted?'success':'failed',duration_ms:Date.now()-insertionStarted});
      if (!pasted) throw new Error('Could not paste. Your words are on the clipboard; use Ctrl+V in your text field.');
      inserted = true;
      const metricSettings=store.getSettings();
      captureMetric('dictation_completed',{provider:metricSettings.provider,model:metricSettings.provider==='groq'?'turbo':metricSettings.localSttModel,language:metricSettings.dictationLanguage,audio_seconds:audioSeconds,words:result.formattedText.trim().split(/\s+/).length,is_rewrite:result.isInstruct,duration_ms:Date.now()-metricsStarted});
      if (activeSession !== session) return;
      // Failure to save history must never reclassify a successful insertion or paste twice.
      try {
        saveHistory();
        if (learn && context.targetId) learningTargets.set(context.targetId,{historyId,original:result.formattedText.replace(/\r\n?/g,'\n'),expiresAt:Date.now()+32000});
      } catch (error) { console.error('History could not be saved:', error); }
      notifyPill({ state: 'pasted', sessionId: session.id, targetApp: context.processName, transcription: result.formattedText, isInstruct: result.isInstruct });
    } catch (err: any) {
      if(!inserted)captureMetric('dictation_failed',{outcome:session.controller.signal.aborted?'cancelled':'failed',duration_ms:Date.now()-metricsStarted});
      if (activeSession !== session) {
        if (!inserted && wavBuffer && context) { try { saveHistory('Processing cancelled. Retained audio and recognized words remain available in history.'); } catch {} }
        return;
      }
      console.error('Dictation pipeline error:', err);
      const reason = err.message || 'Processing error';
      try { if (!inserted) saveHistory(reason); } catch (error) { console.error('Recovery history could not be saved:', error); }
      notifyPill({ state: 'error', sessionId: session.id, errorMessage: reason });
    } finally {
      if (activeSession === session) activeSession = null;
    }
  });

  ipcMain.on('toggle-dictation', () => {
    if (activeSession) stopDictation(); else startDictation();
  });
  ipcMain.on('recording-failed', (_event, payload) => {
    if (payload?.sessionId === activeSession?.id) finishSession({ state: 'error', errorMessage: String(payload?.errorMessage || 'Microphone recording failed').slice(0, 500) });
  });

  ipcMain.on('open-dashboard', (_event, tab) => {
    createDashboardWindow(tab === 'settings' || tab === 'notetaker' || tab === 'dictation' ? tab : undefined);
  });

  ipcMain.on('pill-layout', (event, payload) => {
    if (!pillWindow || event.sender !== pillWindow.webContents) return;
    const area = screen.getPrimaryDisplay().workArea;
    const expanded = payload?.expanded === true;
    const active = payload?.active === true;
    const width = expanded ? 260 : active ? 140 : 64;
    const height = expanded ? 96 : 40;
    pillHitArea = expanded || active
      ? { x: width / 2 - 60, y: height - 32, width: 120, height: 32 }
      : { x: 8, y: height - 32, width: 48, height: 32 };
    const bounds = pillWindow.getBounds();
    if (bounds.width !== width || bounds.height !== height) pillWindow.setBounds({
      x: area.x + Math.round((area.width - width) / 2), y: area.y + area.height - height - pillBottomGap, width, height,
    });
  });
  ipcMain.on('pill-hit-area', (event, rectangle) => {
    if (!pillWindow || event.sender !== pillWindow.webContents || !rectangle) return;
    const bounds = pillWindow.getBounds();
    const { x, y, width, height } = rectangle;
    if ([x, y, width, height].every(Number.isFinite) && x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= bounds.width + 1 && y + height <= bounds.height + 1) {
      pillHitArea = { x, y, width, height };
    }
  });
  ipcMain.handle('begin-shortcut-capture', async () => {
    if (activeSession) throw new Error('Finish dictation before recording a shortcut.');
    await helperBridge.beginShortcutCapture();
  });
  ipcMain.handle('begin-shortcut-test', async (_event, payload) => {
    if (activeSession) throw new Error('Finish dictation before testing a shortcut.');
    if (!['push_to_talk', 'toggle'].includes(payload?.mode)) throw new Error('Choose a dictation mode.');
    await helperBridge.beginShortcutTest(normalizeShortcut(payload?.key), payload.mode);
  });
  ipcMain.handle('cancel-shortcut', () => helperBridge.cancelShortcut());

  ipcMain.handle('begin-meeting-capture', async () => {
    requireAccountAccess();
    if (activeSession || activeMeetingCapture || meetingStarting || meetingProcessing || dictationRecovery || switchingModel) throw new Error('Finish the current recording or processing first.');
    meetingStarting = true;
    try {
      if ((await meetingCaptures.list()).length >= 20) throw new Error('Recover or discard an unfinished meeting before recording another.');
      const captureId = await meetingCaptures.create(store.getSettings().retainAudio);
      try { requireAccountAccess(); }
      catch (error) { await meetingCaptures.failed(captureId).catch(()=>{}); throw error; }
      activeMeetingCapture = captureId;
      return activeMeetingCapture;
    } finally { meetingStarting = false; }
  });
  ipcMain.handle('append-meeting-chunk', async (_event, id, index, buffer) => {
    requireAccountAccess();
    if (id !== activeMeetingCapture || (!(buffer instanceof ArrayBuffer) && !Buffer.isBuffer(buffer))) throw new Error('This meeting recording is no longer active.');
    await meetingCaptures.append(id, index, Buffer.from(new Uint8Array(buffer)));
  });
  ipcMain.handle('get-meeting-recoveries', () => meetingCaptures.list());
  ipcMain.handle('discard-meeting-capture', async (_event, id) => {
    if (meetingProcessing || id === activeMeetingCapture) throw new Error('Finish the meeting before discarding it.');
    await meetingCaptures.remove(text(id, 100));
  });
  ipcMain.handle('abandon-meeting-capture', async (_event, id) => {
    if (id !== activeMeetingCapture) return;
    activeMeetingCapture = undefined;
    await meetingCaptures.failed(id);
  });
  ipcMain.handle('finish-meeting-capture', async (_event, id) => {
    requireAccountAccess();
    if (activeSession || meetingProcessing || dictationRecovery || (activeMeetingCapture && activeMeetingCapture !== id)) throw new Error('Finish the current recording or processing first.');
    const captureId = text(id, 100);
    activeMeetingCapture = undefined;
    const controller = new AbortController();
    meetingProcessing = controller;
    const meetingStarted=Date.now();
    try {
      await speechServer.ensure(store.getSettings());
      const transcript = await meetingCaptures.transcript(captureId, wav => transcribeAudio(wav, {processName:'meeting',windowTitle:'',browserUrl:'',surroundingText:''}, controller.signal), controller.signal);
      const result = await summarizeMeeting(transcript.text, controller.signal);
      controller.signal.throwIfAborted();
      requireAccountAccess();
      const note = store.addMeeting({id:captureId, timestamp:Date.now(), title:`Meeting Note — ${new Date().toLocaleDateString()}`, duration:transcript.seconds, transcript:result.transcript, summary:result.summary, actions:result.actions, warning:result.warning});
      try { await meetingCaptures.remove(captureId); } catch (error) { console.error('Completed meeting audio cleanup failed:', error); }
      captureMetric('stage_completed',{stage:'meeting',outcome:'success',duration_ms:Date.now()-meetingStarted});
      return note;
    } catch (error) {
      captureMetric('stage_failed',{stage:'meeting',outcome:controller.signal.aborted?'cancelled':'failed',duration_ms:Date.now()-meetingStarted});
      try {
        const partial = await meetingCaptures.progress(captureId);
        if (partial.text.trim()) store.addMeeting({id:captureId, timestamp:Date.now(), title:'Unfinished meeting — partial transcript', duration:partial.seconds, transcript:partial.text, summary:partial.text, actions:[], warning:'Processing stopped before completion. This is the recognized portion only.'});
      } catch { /* Preserve the original processing error. */ }
      await meetingCaptures.failed(captureId).catch(() => {});
      throw error;
    } finally { if (meetingProcessing === controller) meetingProcessing = undefined; }
  });
  ipcMain.handle('cancel-meeting-processing', () => { meetingProcessing?.abort(); });

  ipcMain.handle('recover-dictation', async (_event, id) => {
    requireAccountAccess();
    if (activeSession || activeMeetingCapture || meetingStarting || meetingProcessing || dictationRecovery) throw new Error('Finish the current recording or processing first.');
    const item = store.getHistory().find(entry => entry.id === text(id, 100));
    if (!item) throw new Error('This recording is no longer in history.');
    const audio = store.getHistoryAudio(item.id);
    const controller = new AbortController();
    dictationRecovery = controller;
    try {
    await speechServer.ensure(store.getSettings());
    // Recovery copies text only; never inject into a field captured by an old session.
    const result = await processAudioDictation(audio, {processName:item.processName,windowTitle:'',browserUrl:'',surroundingText:''}, {signal:controller.signal});
    requireAccountAccess();
    clipboard.writeText(result.formattedText);
    store.addHistory({...item, ...result, deliveryStatus:'failed', errorMessage:'Recovered text copied to the clipboard. Paste it into your intended field.'});
    dashboardWindow?.webContents.send('dictation-updated');
    return result.formattedText;
    } finally { if (dictationRecovery === controller) dictationRecovery = undefined; }
  });

  ipcMain.on('cancel-dictation', () => {
    finishSession({ state: 'idle' });
    helperBridge.cancelPaste();
  });

  ipcMain.handle('get-settings', () => windowsStartup.settings(store.getSettings()));
  ipcMain.handle('get-startup-status', () => windowsStartup.status());
  ipcMain.handle('get-last-failure', () => lastFailure);
  ipcMain.handle('copy-text', (_event, text) => {
    if (typeof text !== 'string' || text.length > 100000) throw new Error('Cannot copy invalid or oversized text.');
    clipboard.writeText(text);
  });
  ipcMain.handle('get-local-models', async () => {
    try { await speechServer.ensure(store.getSettings()); }
    catch (error) { const status = await getLocalModels(); status.speech.error = (error as Error).message; return status; }
    return getLocalModels();
  });
  ipcMain.handle('speech-model-action', async (_event, model, action) => {
    requireAccountAccess();
    if ((activeSession || activeMeetingCapture || meetingProcessing || dictationRecovery) && action === 'activate') throw new Error('Finish dictation or meeting processing before switching speech models.');
    if (switchingModel) throw new Error('A speech model is already loading.');
    if (action !== 'activate') return speechModelAction(model, action);
    switchingModel = true;
    try {
      const job = await speechModelAction(model, action);
      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) {
        const catalogue = await getLocalModels();
        const progress = catalogue.speech.jobs?.find((item: any) => item.id === job.id);
        if (progress?.status === 'failed') throw new Error(progress.error || 'Model could not load.');
        if (progress?.status === 'ready') {
          const updated = store.updateSettings({ localSttModel: model });
          dashboardWindow?.webContents.send('dictation-updated');
          return updated;
        }
        await new Promise(resolve => setTimeout(resolve, 750));
      }
      throw new Error('Model loading timed out. Check the speech server before trying again.');
    } finally { switchingModel = false; }
  });
  ipcMain.handle('import-speech-model', (_event, url) => {requireAccountAccess();return importSpeechModel(url);});
  ipcMain.handle('delete-speech-model', async (_event, model) => {
    if (activeSession || activeMeetingCapture || meetingStarting || meetingProcessing || dictationRecovery) {
      throw new Error('Finish dictation before deleting speech models.');
    }
    const res = await deleteSpeechModel(model);
    const current = store.getSettings();
    if (current.localSttModel === model || current.localSttModel === ('hf:' + model)) {
      store.updateSettings({ localSttModel: 'base' });
      dashboardWindow?.webContents.send('dictation-updated');
    }
    return res;
  });
  ipcMain.handle('pull-formatting-model', (_event, model) => {requireAccountAccess();return pullFormattingModel(model);});
  ipcMain.handle('update-settings', async (_event, newSettings) => {
    const current = store.getSettings();
    if(switchingModel) throw new Error('Wait for speech setup or model switching to finish before saving settings.');
    const connectionFields = ['provider','groqApiKey','geminiApiKey','localSttUrl','localSttModel','dictationLanguage','instructModeEnabled','writingProvider','formattingProvider','romanizationProvider','localLlmUrl','localLlmModel'] as const;
    if(localSetup.getStatus().state==='running'&&connectionFields.some(key=>newSettings[key]!==undefined&&newSettings[key]!==current[key])) throw new Error('Wait for speech setup to finish, or cancel it, before changing speech or text connections.');
    if ((activeSession || activeMeetingCapture || meetingStarting || meetingProcessing || dictationRecovery) && connectionFields.some(key => newSettings[key] !== undefined && newSettings[key] !== current[key])) throw new Error('Finish dictation or meeting processing before changing speech or text connections.');
    const changingShortcut = (newSettings.hotkey !== undefined && normalizeShortcut(newSettings.hotkey) !== current.hotkey) ||
      (newSettings.mode !== undefined && newSettings.mode !== current.mode);
    if (activeSession && newSettings.localSttModel !== undefined && newSettings.localSttModel !== current.localSttModel) throw new Error('Finish dictation before switching speech models.');
    if (activeSession && newSettings.romanizationProvider !== undefined && newSettings.romanizationProvider !== current.romanizationProvider) throw new Error('Finish dictation before changing Roman Hinglish conversion.');
    if (activeSession && changingShortcut) throw new Error('Finish dictation before changing the shortcut or mode.');
    const target=store.previewSettings(newSettings);
    const checkingSpeech=target.provider==='local'&&(target.localSttModel!==current.localSttModel||target.localSttModel.startsWith('hf:')&&target.dictationLanguage!==current.dictationLanguage);
    const checkingWriter=target.writingProvider==='local'&&target.instructModeEnabled&&['writingProvider','formattingProvider','instructModeEnabled','localLlmUrl','localLlmModel'].some(key=>(newSettings as any)[key]!==undefined&&(newSettings as any)[key]!==(current as any)[key]);
    if(checkingSpeech||checkingWriter){
      if(checkingSpeech&&target.localSttUrl!==current.localSttUrl) throw new Error('Save the speech server address before selecting a different model.');
      if(checkingWriter&&target.localLlmUrl!==current.localLlmUrl) throw new Error('Save the Ollama address before enabling voice rewrites.');
      switchingModel=true;
      try {
        if(checkingSpeech) await speechServer.ensure(current);
        const catalogue=await getLocalModels();
        if(checkingSpeech&&(!catalogue.speech.online||!catalogue.speech.models?.some((model:any)=>model.id===target.localSttModel&&model.downloaded))) throw new Error('Download the selected speech model before saving settings.');
        if(checkingSpeech&&catalogue.speech.models?.find((model:any)=>model.id===target.localSttModel)?.runtime_ready===false)throw new Error('Set up the selected speech model before saving settings. It needs additional speech libraries.');
        const declared=checkingSpeech?catalogue.speech.models?.find((model:any)=>model.id===target.localSttModel)?.languages:undefined;
        if(declared?.length&&target.dictationLanguage!=='auto'&&(!declared.includes(target.dictationLanguage==='hinglish'?'hi':target.dictationLanguage)||target.dictationLanguage==='hinglish'&&!declared.includes('en')))throw new Error('This custom model does not declare the selected language. Choose a compatible speech model.');
        if(checkingWriter&&(!catalogue.formatting.online||!catalogue.formatting.models?.some((model:any)=>model.name===target.localLlmModel||model.name===target.localLlmModel+':latest'))) throw new Error('Start Ollama and install the selected Writing AI model before enabling voice rewrites.');
      } finally {switchingModel=false;}
    }
    const { startWithWindows, ...settingsPatch } = newSettings;
    let updated = store.updateSettings(settingsPatch);
    let startupError: string | undefined;
    if (startWithWindows !== undefined) {
      try {
        updated = windowsStartup.save(startWithWindows, () => store.updateSettings({ startWithWindows }));
      } catch (error) {
        // A Windows Startup registration failure must not discard unrelated
        // settings from the same Save action (for example a downloaded model).
        startupError = (error as Error).message;
      }
    }
    updated = windowsStartup.settings(updated);
    if(!current.setupCompleted&&updated.setupCompleted)captureMetric('setup_completed');
    if (newSettings.hotkey || newSettings.mode) {
      helperBridge.updateHotkey(updated.hotkey, updated.mode);
    }
    notifyPill({ hotkey: updated.hotkey, mode: updated.mode, microphoneDeviceId: updated.microphoneDeviceId, barDesign: updated.barDesign });
    if (updated.autoLearnCorrections === false) { learningTargets.clear(); helperBridge.cancelLearning(); }
    return startupError ? { ...updated, startupError } : updated;
  });

  ipcMain.handle('get-dictionary', () => store.getDictionary());
  const memory = () => ({ vocabulary:store.getLearnedVocabulary(), preferences:store.getWritingPreferences() });
  ipcMain.handle('get-writing-memory', memory);
  ipcMain.handle('set-writing-preferences', (_event,value) => {
    store.setWritingPreferences(value);
    dashboardWindow?.webContents.send('writing-memory-updated');
    return memory();
  });
  ipcMain.handle('review-learned-word', (_event,id,action) => {
    if (!['accept','forget'].includes(action)) throw new Error('Choose accept or forget.');
    store.reviewLearnedWord(text(id,100),action);
    dashboardWindow?.webContents.send('writing-memory-updated');
    return memory();
  });
  ipcMain.handle('correct-dictation', async (_event,id,edited) => {
    requireAccountAccess();
    learningTargets.clear(); helperBridge.cancelLearning();
    const result = await learningService.correct(id,edited);
    dashboardWindow?.webContents.send('writing-memory-updated');
    dashboardWindow?.webContents.send('dictation-updated');
    return result;
  });
  ipcMain.handle('set-dictionary', (_event, dict) => {
    store.setDictionary(dict);
    return store.getDictionary();
  });

  ipcMain.handle('get-snippets', () => store.getSnippets());
  ipcMain.handle('set-snippets', (_event, s) => {
    store.setSnippets(s);
    return store.getSnippets();
  });

  ipcMain.handle('get-scratchpad', () => store.getScratchpad());
  ipcMain.handle('set-scratchpad', (_event, text) => {
    store.setScratchpad(text);
    return store.getScratchpad();
  });

  ipcMain.handle('get-history', () => store.getHistory());
  ipcMain.handle('clear-history', () => {
    if (activeSession || dictationRecovery) throw new Error('Finish processing or cancel dictation before clearing history.');
    learningTargets.clear(); helperBridge.cancelLearning();
    store.clearHistory();
    return [];
  });
  ipcMain.handle('get-meetings', () => store.getMeetings());
  ipcMain.handle('add-meeting', (_event, note) => store.addMeeting(note));
  ipcMain.handle('clear-meetings', () => { store.clearMeetings(); return []; });

  ipcMain.handle('trigger-test-dictation', async () => {
    startDictation();
    setTimeout(() => {
      stopDictation();
    }, 2500);
  });
});

app.on('window-all-closed', () => {
  // Keep running in the system tray after the dashboard closes.
});

app.on('before-quit', () => {
  stopCloudServices();
  quitting = true;
  activeSession?.controller.abort();
  meetingProcessing?.abort();
  dictationRecovery?.abort();
  clearInterval(pillPointerTimer);
  helperBridge.stop();
  speechServer.stop();
  localSetup.cancel(true);
});
