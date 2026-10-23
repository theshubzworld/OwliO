import path from 'path';
import type { App, LoginItemSettings } from 'electron';

const ENTRY_NAME = 'com.owlio.desktop';
const STARTUP_ARGS = ['--startup'];
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
  private approved(state: LoginItemSettings): boolean {
    const own = state.launchItems.find(item => item.name === ENTRY_NAME && item.scope === 'user');
    return own ? own.enabled : state.executableWillLaunchAtLogin;
  }
  private write(openAtLogin: boolean, enabled = openAtLogin): void {
    this.host.setLoginItemSettings({ name: ENTRY_NAME, path: this.host.getPath('exe'), args: STARTUP_ARGS, openAtLogin, enabled });
  }
  status(): StartupStatus {
    if (!this.supported()) return { supported: false, enabled: false };
    try {
      const state = this.read();
      return { supported: true, enabled: state.openAtLogin && this.approved(state) };
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
    try {
      this.write(enabled);
      const actual = this.read();
      if (actual.openAtLogin !== enabled || enabled && !this.approved(actual)) throw Error('Windows did not apply the startup change. Check Settings → Apps → Startup, then try again.');
      return commit();
    } catch (error) {
      try { this.write(previous.openAtLogin, this.approved(previous)); }
      catch { throw Error('Could not save or restore startup settings. Check Owlio in Windows Settings → Apps → Startup.'); }
      throw error;
    }
  }
}
