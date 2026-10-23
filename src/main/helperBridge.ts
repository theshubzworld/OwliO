import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import type { WindowContext } from './aiService';

type Pending = { resolve: (message: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout>; operation: unknown };

export class HelperBridge extends EventEmitter {
  private process: ChildProcessWithoutNullStreams | null = null;
  private pending = new Map<string, Pending>();
  private sequence = 0;
  private stopping = false;
  private restartTimer?: ReturnType<typeof setTimeout>;
  private hotkey = { key: 'F8', mode: 'push_to_talk' as 'push_to_talk' | 'toggle' };

  public start(): void {
    if (this.process) return;
    this.stopping = false;
    const helperPath = this.resolveHelperPath();
    if (!fs.existsSync(helperPath)) {
      this.emit('helper-error', new Error('Windows helper is missing: ' + helperPath));
      return;
    }
    const child = spawn(helperPath, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.process = child;
    child.stdout.setEncoding('utf8');
    let buffer = '';
    child.stdout.on('data', (data: string) => {
      if (this.process !== child) return;
      buffer += data;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let message: any;
        try { message = JSON.parse(line.trim()); }
        catch { console.warn('Invalid Windows helper message'); continue; }
        this.handleHelperMessage(message);
      }
    });
    child.stderr.on('data', (data: Buffer) => console.error('[WindowsHelper] ' + data.toString('utf8').trim()));
    const failed = (error: Error) => {
      if (this.process !== child) return;
      for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
      this.pending.clear();
      if (!this.stopping) this.emit('helper-error', error);
    };
    child.on('error', failed);
    child.stdin.on('error', failed);
    child.on('close', (code) => {
      if (this.process !== child) return;
      failed(new Error('Windows helper disconnected (' + code + '). Please retry.'));
      this.process = null;
      if (!this.stopping) this.restartTimer = setTimeout(() => this.start(), 2000);
    });
  }

  private resolveHelperPath(): string {
    const packagedPath = process.resourcesPath ? path.join(process.resourcesPath, 'windows-helper/windows-helper.exe') : '';
    if (packagedPath && fs.existsSync(packagedPath)) return packagedPath;
    const appRoot = path.resolve(__dirname, '../../');
    const releasePath = path.join(appRoot, 'windows-helper/bin/Release/net8.0-windows/publish/windows-helper.exe');
    if (fs.existsSync(releasePath)) return releasePath;
    const debugPath = path.join(appRoot, 'windows-helper/bin/Debug/net8.0-windows/windows-helper.exe');
    return fs.existsSync(debugPath) ? debugPath : releasePath;
  }

  private handleHelperMessage(message: any): void {
    if (message.type === 'ready') {
      this.send({ type: 'set_hotkey', ...this.hotkey });
      this.emit('ready');
    } else if (message.type === 'event') {
      if (['hotkey_down', 'hotkey_up', 'hotkey_toggle'].includes(message.name)) this.emit(message.name, message);
      else if (message.name?.startsWith('shortcut_')) this.emit('shortcut-event', message);
      else if (message.name === 'learning-correction') this.emit('learning-correction',message);
    } else if (message.type === 'error' && !message.requestId) {
      this.emit('helper-error', new Error(message.message || 'Windows helper failed'));
    } else {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId);
      clearTimeout(pending.timer);
      if (message.error || message.success === false) pending.reject(new Error(message.error || 'Text could not be sent to the selected window'));
      else pending.resolve(message);
    }
  }

  private request(command: Record<string, unknown>, timeout: number): Promise<any> {
    if (!this.process?.stdin.writable) return Promise.reject(new Error('Windows helper is unavailable. Please retry.'));
    const requestId = String(++this.sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error('Windows text access timed out. The helper was restarted; check your target field before retrying.');
        this.restart(error);
        this.emit('helper-error', error);
      }, timeout);
      this.pending.set(requestId, { resolve, reject, timer, operation: command.type });
      this.send({ ...command, requestId, expiresAt: Date.now() + timeout - 250 });
    });
  }

  public async getContext(targetHwnd?: string): Promise<WindowContext> {
    const message = await this.request({ type: 'get_context', targetHwnd }, 3000);
    return {
      targetId: message.requestId,
      processName: message.processName || '', windowTitle: message.windowTitle || '',
      browserUrl: message.browserUrl || '', surroundingText: message.surroundingText || '',
      ...(typeof message.beforeText === 'string' && typeof message.afterText === 'string' && typeof message.selectedText === 'string' ? { beforeText:message.beforeText, afterText:message.afterText, selectedText:message.selectedText } : {}),
    };
  }

  public async paste(text: string, targetId?: string, learn = false, expectedSelection?: string): Promise<boolean> {
    if (!targetId) throw new Error('No dictation target was captured. Select a text field and retry.');
    await this.request({ type: 'paste', text, targetId, learn, ...(expectedSelection !== undefined ? {expectedSelection} : {}) }, 5000);
    return true;
  }

  public cancelLearning(): void { this.send({type:'cancel_learning'}); }

  private restart(error: Error): void {
    const child = this.process;
    this.process = null; // Ignore stale stdout/close events from the old generation.
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
    child?.kill();
    clearTimeout(this.restartTimer);
    if (!this.stopping) this.restartTimer = setTimeout(() => this.start(), 100);
  }

  public cancelPaste(): void {
    if ([...this.pending.values()].some(pending => pending.operation === 'paste')) this.restart(new Error('Text insertion cancelled. Check the target field before retrying.'));
  }

  public updateHotkey(key: string, mode: 'push_to_talk' | 'toggle'): void {
    this.hotkey = { key, mode };
    this.send({ type: 'set_hotkey', ...this.hotkey });
  }

  public async beginShortcutCapture(): Promise<void> {
    await this.request({ type: 'begin_shortcut_capture' }, 3000);
  }

  public async beginShortcutTest(key: string, mode: 'push_to_talk' | 'toggle'): Promise<void> {
    await this.request({ type: 'begin_shortcut_test', key, mode }, 3000);
  }

  public async cancelShortcut(): Promise<void> {
    await this.request({ type: 'cancel_shortcut' }, 3000);
  }

  private send(command: unknown): void {
    if (this.process?.stdin.writable) this.process.stdin.write(JSON.stringify(command) + '\n');
  }

  public stop(): void {
    this.stopping = true;
    clearTimeout(this.restartTimer);
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Windows helper stopped')); }
    this.pending.clear();
    this.send({ type: 'quit' });
    this.process?.kill();
    this.process = null;
  }
}

export const helperBridge = new HelperBridge();
