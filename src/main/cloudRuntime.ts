import { app, safeStorage, shell, ipcMain, BrowserWindow } from 'electron';
import path from 'path';
import { pathToFileURL } from 'url';
import { loadCloudConfig } from './cloudConfig';
import { SecureSessionStorage } from './secureSessionStorage';
import { AccountService } from './accountService';
import { AnalyticsService } from './analyticsService';
import type { MetricEventName } from '../shared/telemetry';
import { accountAccessError } from '../shared/accountAccess';
let analytics: AnalyticsService | undefined,
  account: AccountService | undefined;
export function captureMetric(
  event: MetricEventName,
  properties: Record<string, unknown> = {}
) {
  try {
    if (accountAccessError(account?.status())) return;
    analytics?.capture(event, properties);
  } catch {
    /* Metrics never block the product. */
  }
}
export function requireAccountAccess() {
  const error = accountAccessError(account?.status());
  if (error) throw Error(error);
  if (!analytics?.status().enabled) throw Error('Required basic usage reporting could not start. Restart Owlio and check account access.');
}
export function startCloudServices(onAccessLost?: () => void) {
  if (!app?.isReady?.()) return;
  let config;
  try {
    config = loadCloudConfig();
  } catch {
    console.warn(
      'Cloud configuration was rejected. Accounts and usage reporting are unavailable.'
    );
  }
  const profile = app.getPath('userData');
  account = new AccountService(
    config,
    new SecureSessionStorage(
      path.join(profile, 'account-session.bin'),
      safeStorage
    ),
    (url) => shell.openExternal(url)
  );
  analytics = new AnalyticsService(
    path.join(profile, 'usage-metrics.json'),
    config,
    app.getVersion()
  );
  // A persisted reporting preference never authorizes collection by itself.
  analytics.setAccessAllowed(false);
  let wasAllowed = false;
  let clearedSignedOutReporting = false;
  const syncAccess = () => {
    const status = account!.status();
    let allowed = !accountAccessError(status);
    try {
      analytics!.setAccessAllowed(allowed);
      if (allowed && !analytics!.status().enabled) analytics!.setEnabled(true);
      else if (!status.user && !clearedSignedOutReporting) analytics!.setEnabled(false);
      clearedSignedOutReporting = !status.user;
    } catch { allowed = false; analytics!.setAccessAllowed(false); }
    if (!allowed && wasAllowed) {
      onAccessLost?.();
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('account-changed', status);
    }
    wasAllowed = allowed;
  };
  account.on('changed', (status) => {
    syncAccess();
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send('account-changed', status);
  });
  // Enforce cache expiry even while the account server cannot be reached.
  const accessTimer = setInterval(syncAccess, 15000);
  accessTimer.unref?.();
  accessTimers.push(accessTimer);
  void account.initialize();
  analytics.start();
  const trusted = (event: Electron.IpcMainInvokeEvent) => {
    const frame = event.senderFrame;
    const expected = pathToFileURL(
      path.resolve(__dirname, '../renderer/index.html')
    );
    if (!frame || frame !== event.sender.mainFrame)
      throw Error(
        'Account controls are available only in the Owlio dashboard.'
      );
    const actual = new URL(frame.url);
    actual.search = '';
    actual.hash = '';
    if (actual.href !== expected.href)
      throw Error(
        'Account controls are available only in the Owlio dashboard.'
      );
  };
  const handle = (name: string, action: (...args: any[]) => unknown) =>
    ipcMain.handle(name, (event, ...args) => {
      trusted(event);
      return action(...args);
    });
  handle('account-status', () => account!.status());
  handle('account-google', () => account!.signInGoogle());
  handle('account-email-code', (email) => account!.sendEmailCode(email));
  handle('account-verify-code', (email, code) =>
    account!.verifyEmailCode(email, code)
  );
  handle('account-sign-out', () => account!.signOut());
  handle('account-cancel', () => account!.cancelSignIn());
  handle('account-accept-terms', (confirmed) => account!.acceptTerms(confirmed, app.getVersion()));
  handle('account-refresh-access', async () => { await account!.refreshAccess(); return account!.status(); });
  handle('analytics-status', () => analytics!.status());
  handle('analytics-consent', () => { throw Error('Basic usage reporting is required under the Terms of Use. Sign out to stop using the app and stop reporting.'); });
  handle('admin-metrics', (days) => { requireAccountAccess(); return account!.adminMetrics(days); });
  handle('admin-accounts', (search, page) =>
    { requireAccountAccess(); return account!.adminAccounts(search, page); }
  );
  handle('admin-set-access', (userId, blocked, reason) =>
    { requireAccountAccess(); return account!.adminSetAccess(userId, blocked, reason); }
  );
}
const accessTimers: ReturnType<typeof setInterval>[] = [];
export function stopCloudServices() {
  for (const timer of accessTimers.splice(0)) clearInterval(timer);
  analytics?.dispose();
  account?.dispose();
}
