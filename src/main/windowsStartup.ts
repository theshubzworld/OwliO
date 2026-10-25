import path from 'path';
import type { App, LoginItemSettings } from 'electron';

const ENTRY_NAME = 'com.owlio.desktop';
// Electron's Windows launch-item parser drops leading dash-prefixed arguments
// unless they follow the conventional `--` argument separator.
const STARTUP_ARGS = ['--', '--startup'];
type Host = Pick<App, 'isPackaged' | 'getPath' | 'getLoginItemSettings' | 'setLoginItemSettings'>;
export type StartupStatus = { supported: boolean; enabled: boolean; error?: string };

// Opening Owlio must respect changes made in Windows Startup settings.
export class WindowsStartup {
  constructor(private host: Host, private platform = process.platform) {}

  private supported(): boolean {
    return this.platform === 'win32' && this.host.isPackaged && path.basename(this.host.getPath('exe')).toLowerCase() === 'owlio.exe';
  }
  private read(): LoginItemSettings {
    return this.host.getLoginItemSettings({ path: this.host.getPath('exe'), args: STARTUP_ARGS });
  }
  private ownEntry(state: LoginItemSettings) {
    const executable = path.resolve(this.host.getPath('exe')).toLowerCase();
    return state.launchItems.find(item => item.name === ENTRY_NAME && item.scope === 'user' && path.resolve(item.path).toLowerCase() === executable);
  }
  private write(registered: boolean, enabled = registered): void {
    this.host.setLoginItemSettings({ name: ENTRY_NAME, path: this.host.getPath('exe'), args: STARTUP_ARGS, openAtLogin: registered, enabled });
  }
  status(): StartupStatus {
    if (!this.supported()) return { supported: false, enabled: false };
    try {
      const state = this.read();
      // On Windows Electron can report openAtLogin=false for dash-prefixed
      // arguments even while launchItems contains the correctly enabled entry.
      const own = this.ownEntry(state);
      return { supported: true, enabled: Boolean(own?.enabled) };
    } catch {
      return { supported: true, enabled: false, error: 'Could not read Windows startup settings. Close and reopen Owlio to try again.' };
    }
  }
  settings<T extends { startWithWindows?: boolean }>(settings: T): T {
    const status = this.status();
    return status.supported && !status.error ? { ...settings, startWithWindows: status.enabled } : settings;
  }
  save<T>(enabled: boolean | undefined, commit: () => T): T {
    if (enabled === undefined) return commit();
    if (typeof enabled !== 'boolean') throw Error('Windows startup must be on or off.');
    if (!this.supported()) throw Error('Install Owlio on Windows to change startup settings.');
    const previous = this.read();
    const previousEntry = this.ownEntry(previous);
    try {
      this.write(enabled);
      const actual = this.read();
      const actualEntry = this.ownEntry(actual);
      if (enabled ? !actualEntry?.enabled : actualEntry?.enabled) throw Error('Windows did not apply the startup change. Check Settings → Apps → Startup, then try again.');
      return commit();
    } catch (error) {
      try { this.write(Boolean(previousEntry), previousEntry?.enabled ?? false); }
      catch { throw Error('Could not save or restore startup settings. Check Owlio in Windows Settings → Apps → Startup.'); }
      throw error;
    }
  }
}
