import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { EventEmitter } from 'events';
import { createServer, type Server } from 'http';
import { randomBytes } from 'crypto';
import type {
  AccountStatus,
  AdminMetrics,
  AdminAccount,
  CloudConfig
} from '../shared/cloud';
import { SecureSessionStorage } from './secureSessionStorage';
import { TERMS_VERSION, PRIVACY_VERSION, POLICY_HASH } from '../shared/legal';

export class AccountService extends EventEmitter {
  private client?: SupabaseClient;
  private state: AccountStatus;
  private callback?: Server;
  private timer?: ReturnType<typeof setTimeout>;
  private operation = 0;
  private generation = 0;
  private request?: AbortController;
  private unsubscribe?: () => void;
  private accessTimer?: ReturnType<typeof setInterval>;
  private checkingAccess = false;
  private accessToken?: string;
  private emailBusy = false;
  private pendingEmail?: string;
  constructor(
    private config: CloudConfig | undefined,
    private storage: SecureSessionStorage,
    private openBrowser: (url: string) => Promise<void>,
    private factory = createClient,
    private network: typeof fetch = fetch
  ) {
    super();
    this.state = { configured: !!config, user: null, signingIn: false };
  }
  status(): AccountStatus {
    return structuredClone(this.state);
  }
  private update(patch: Partial<AccountStatus>) {
    this.state = { ...this.state, ...patch };
    this.emit('changed', this.status());
  }
  async initialize(): Promise<void> {
    if (!this.config || this.client) return;
    const generation = ++this.generation,
      request = new AbortController();
    this.request = request;
    try {
      const client = this.factory(
        this.config.supabaseUrl,
        this.config.publishableKey,
        {
          // Cancelled clients must never write a late session back to disk.
          auth: {
            storage: {
              getItem: (key) =>
                generation === this.generation
                  ? this.storage.getItem(key)
                  : null,
              setItem: (key, value) => {
                if (generation === this.generation)
                  this.storage.setItem(key, value);
              },
              removeItem: (key) => {
                if (generation === this.generation)
                  this.storage.removeItem(key);
              }
            },
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: false,
            flowType: 'pkce'
          },
          global: {
            fetch: (input, init) =>
              this.network(input, {
                ...init,
                signal: AbortSignal.any([
                  request.signal,
                  AbortSignal.timeout(10000),
                  ...(init?.signal ? [init.signal] : [])
                ])
              })
          }
        }
      );
      this.client = client;
      const {
        data: { subscription }
      } = client.auth.onAuthStateChange((_event, session) => {
        if (generation !== this.generation) return;
        if (session) {
          this.closeCallback();
          this.pendingEmail = undefined;
        }
        this.accessToken = session?.access_token;
        this.update({
          user: session
            ? { id: session.user.id, email: session.user.email }
            : null,
          access: session ? this.savedAccess(session.user.id) : undefined,
          ...(session
            ? { signingIn: false, emailLinkPending: false, error: undefined }
            : {})
        });
        if (session)
          queueMicrotask(() => {
            void this.refreshAccess();
          });
      });
      this.unsubscribe = () => subscription.unsubscribe();
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (generation === this.generation) {
        this.accessToken = data.session?.access_token;
        this.update({
          user: data.session
            ? { id: data.session.user.id, email: data.session.user.email }
            : null,
          access: data.session
            ? this.savedAccess(data.session.user.id)
            : undefined
        });
        await this.refreshAccess();
        if (generation === this.generation) {
          this.accessTimer = setInterval(() => {
            void this.refreshAccess();
          }, 60000);
          this.accessTimer.unref?.();
        }
      }
    } catch {
      if (generation === this.generation)
        this.update({
          error:
            'Your saved account could not be connected. Reconnect and sign in, or sign out to continue as a guest.'
        });
    }
  }
  private requireClient(): SupabaseClient {
    if (!this.client)
      throw Error(
        'Account services are not configured for this build. Owlio runs in guest mode without an account.'
      );
    return this.client;
  }
  private email(value: unknown): string {
    if (
      typeof value !== 'string' ||
      value.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
    )
      throw Error('Enter a valid email address.');
    return value.trim();
  }
  async sendEmailCode(value: unknown): Promise<void> {
    const email = this.email(value),
      client = this.requireClient();
    if (this.state.signingIn || this.state.emailLinkPending || this.emailBusy)
      throw Error('Finish or cancel the current sign-in first.');
    if (this.state.user)
      throw Error('Sign out before signing in with another account.');
    const generation = this.generation;
    const operation = ++this.operation;
    this.emailBusy = true;
    try {
      this.pendingEmail = email;
      this.update({ emailLinkPending: true, error: undefined });
      const emailRedirectTo = await this.startCallback(
        client,
        operation,
        600000
      );
      if (operation !== this.operation) throw Error('Sign-in cancelled.');
      const { error } = await client.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true, emailRedirectTo }
      });
      if (error)
        throw Error(
          'Could not send a sign-in email. Check your connection or wait before trying again.'
        );
    } catch {
      if (operation === this.operation) this.cancelSignIn();
      throw Error(
        'Could not send a sign-in email. Check your connection, wait before retrying, and ensure port 17865 is available.'
      );
    } finally {
      if (generation === this.generation) this.emailBusy = false;
    }
  }
  async verifyEmailCode(
    value: unknown,
    token: unknown
  ): Promise<AccountStatus> {
    const email = this.email(value),
      client = this.requireClient();
    if (this.state.signingIn || this.emailBusy)
      throw Error('Finish or cancel the current sign-in first.');
    if (this.state.user)
      throw Error('Sign out before signing in with another account.');
    if (typeof token !== 'string' || !/^\d{6,8}$/.test(token.trim()))
      throw Error('Enter the numeric code from your email.');
    if (
      this.pendingEmail &&
      email.toLowerCase() !== this.pendingEmail.toLowerCase()
    )
      throw Error('Use the email address from the pending sign-in.');
    const generation = this.generation;
    this.emailBusy = true;
    try {
      const { error } = await client.auth.verifyOtp({
        email,
        token: token.trim(),
        type: 'email'
      });
      if (error)
        throw Error(
          'The code is invalid or expired. Request a new code and try again.'
        );
      return this.status();
    } finally {
      if (generation === this.generation) this.emailBusy = false;
    }
  }
  private async startCallback(
    client: SupabaseClient,
    operation: number,
    timeoutMs: number
  ): Promise<string> {
    const route = '/auth/callback/' + randomBytes(24).toString('hex');
    const server = createServer((req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'none'; frame-ancestors 'none'"
      );
      let url: URL;
      try {
        url = new URL(req.url || '/', 'http://127.0.0.1:17865');
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }
      if (
        req.method !== 'GET' ||
        req.headers.host !== '127.0.0.1:17865' ||
        url.pathname !== route
      ) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      if (this.emailBusy) {
        res.writeHead(409);
        res.end(
          'A sign-in check is in progress. Return to Owlio, then try the email link again.'
        );
        return;
      }
      const code = url.searchParams.get('code');
      if (!code || code.length > 2048) {
        res.writeHead(400);
        res.end('Sign-in was not completed. Return to Owlio and try again.');
        this.cancelSignIn();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Return to Owlio to check your sign-in. You may close this tab.');
      this.closeCallback();
      void client.auth
        .exchangeCodeForSession(code)
        .then(({ error }) => {
          if (operation !== this.operation) return;
          if (error)
            this.update({
              signingIn: false,
              error: 'Sign-in could not be completed. Please try again.'
            });
          else this.update({ signingIn: false, error: undefined });
        })
        .catch(() => {
          if (operation === this.operation)
            this.update({
              signingIn: false,
              error: 'Sign-in could not be completed. Please try again.'
            });
        });
    });
    this.callback = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(17865, '127.0.0.1', resolve);
    });
    this.timer = setTimeout(() => {
      if (operation === this.operation) {
        this.cancelSignIn();
        this.update({ error: 'Sign-in timed out. Please try again.' });
      }
    }, timeoutMs);
    this.timer.unref?.();
    return 'http://127.0.0.1:17865' + route;
  }
  async signInGoogle(): Promise<AccountStatus> {
    const client = this.requireClient();
    if (this.state.signingIn || this.state.emailLinkPending || this.emailBusy)
      throw Error('A sign-in is already in progress.');
    if (this.state.user)
      throw Error('Sign out before signing in with another account.');
    const operation = ++this.operation;
    this.update({ signingIn: true, error: undefined });
    try {
      const redirectTo = await this.startCallback(client, operation, 180000);
      const { data, error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          skipBrowserRedirect: true
        }
      });
      if (operation !== this.operation) throw Error('Cancelled');
      if (error || !data.url) throw Error('Unavailable');
      const url = new URL(data.url);
      if (
        url.origin !== this.config!.supabaseUrl ||
        url.pathname !== '/auth/v1/authorize'
      )
        throw Error('Unexpected authorization endpoint');
      await this.openBrowser(url.href);
      return this.status();
    } catch {
      if (operation === this.operation) this.cancelSignIn();
      throw Error(
        'Could not start browser sign-in. Check your connection and that port 17865 is available.'
      );
    }
  }
  private closeCallback() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.callback?.close();
    this.callback = undefined;
  }
  private detach() {
    ++this.generation;
    this.request?.abort();
    this.request = undefined;
    clearInterval(this.accessTimer);
    this.accessTimer = undefined;
    this.checkingAccess = false;
    this.emailBusy = false;
    this.accessToken = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    void this.client?.auth.stopAutoRefresh();
    this.client = undefined;
  }
  cancelSignIn(): AccountStatus {
    const pending =
      this.state.signingIn || this.state.emailLinkPending || this.emailBusy;
    ++this.operation;
    this.closeCallback();
    this.pendingEmail = undefined;
    if (pending) {
      this.detach();
      let error: string | undefined;
      try {
        this.storage.clear();
      } catch {
        error = 'Saved sign-in could not be cleared. Please try again.';
      }
      this.update({
        user: null,
        signingIn: false,
        emailLinkPending: false,
        access: undefined,
        error
      });
      void this.initialize();
    } else this.update({ signingIn: false, emailLinkPending: false });
    return this.status();
  }
  async signOut(): Promise<AccountStatus> {
    this.pendingEmail = undefined;
    ++this.operation;
    this.closeCallback();
    const accessToken = this.accessToken;
    this.detach();
    this.storage.clear();
    this.update({
      user: null,
      signingIn: false,
      emailLinkPending: false,
      error: undefined,
      access: undefined
    });
    if (accessToken && this.config) {
      // Revoke the current remote session when reachable; local sign-out never waits on it.
      void this.network(
        this.config.supabaseUrl + '/auth/v1/logout?scope=local',
        {
          method: 'POST',
          headers: {
            apikey: this.config.publishableKey,
            Authorization: 'Bearer ' + accessToken
          },
          signal: AbortSignal.timeout(5000)
        }
      ).catch(() => {});
    }
    await this.initialize();
    return this.status();
  }
  async adminMetrics(days: unknown): Promise<AdminMetrics> {
    if (![7, 30, 90].includes(days as number))
      throw Error('Choose a 7, 30 or 90 day reporting period.');
    const client = this.requireClient();
    if (!this.state.user)
      throw Error(
        'Sign in with an administrator account to view usage metrics.'
      );
    const { data, error } = await client.rpc('owlio_admin_metrics', {
      period_days: days
    });
    if (error)
      throw Error(
        'Admin metrics are unavailable. Sign in with an owner-authorized administrator account.'
      );
    return data as AdminMetrics;
  }
  private savedAccess(userId: string): AccountStatus['access'] {
    try {
      const saved = JSON.parse(
        this.storage.getItem('owlio-account-access') || 'null'
      );
      if (
        saved?.userId === userId &&
        saved?.project === this.config?.supabaseUrl &&
        typeof saved.blocked === 'boolean'
      )
        return {
          blocked: saved.blocked,
          reason:
            typeof saved.reason === 'string'
              ? saved.reason.slice(0, 200)
              : undefined,
          checkedAt: saved.checkedAt,
          termsAccepted: saved.termsAccepted === true,
          termsVersion: saved.termsVersion,
          privacyVersion: saved.privacyVersion,
          policyHash: saved.policyHash,
          acceptedAt: saved.acceptedAt,
          offline: true
        };
    } catch {
      /* Unreadable cache is not authority for a different account. */
    }
    return { blocked: false, offline: true };
  }
  async refreshAccess(): Promise<void> {
    const user = this.state.user,
      client = this.client,
      generation = this.generation;
    if (!user || !client || this.checkingAccess) return;
    this.checkingAccess = true;
    try {
      const { data, error } = await client.rpc('owlio_account_access');
      if (generation !== this.generation || this.state.user?.id !== user.id)
        return;
      if (error || typeof data?.blocked !== 'boolean')
        throw Error('Access status unavailable');
      const access = {
        blocked: data.blocked,
        reason:
          typeof data.reason === 'string'
            ? data.reason.slice(0, 200)
            : undefined,
        checkedAt: Date.now(),
        termsAccepted: data.termsAccepted === true,
        termsVersion: typeof data.termsVersion === 'string' ? data.termsVersion : undefined,
        privacyVersion: typeof data.privacyVersion === 'string' ? data.privacyVersion : undefined,
        policyHash: typeof data.policyHash === 'string' ? data.policyHash : undefined,
        acceptedAt: typeof data.acceptedAt === 'string' ? data.acceptedAt : undefined,
        offline: false
      };
      try {
        this.storage.setItem(
          'owlio-account-access',
          JSON.stringify({
            ...access,
            userId: user.id,
            project: this.config!.supabaseUrl
          })
        );
      } catch {
        /* Continue using the in-memory status. */
      }
      this.update({ access });
    } catch {
      if (generation === this.generation && this.state.user?.id === user.id)
        this.update({
          access: {
            ...this.state.access,
            blocked: this.state.access?.blocked ?? false,
            offline: true
          }
        });
    } finally {
      if (generation === this.generation) this.checkingAccess = false;
    }
  }
  async acceptTerms(confirmed: unknown, appVersion: string): Promise<AccountStatus> {
    if (confirmed !== true) throw Error('Accept the Terms of Use and required reporting to continue.');
    const userId = this.state.user?.id, generation = this.generation;
    if (!userId) throw Error('Sign in before accepting the Terms of Use.');
    const { error } = await this.requireClient().rpc('owlio_accept_terms', {
      terms_version: TERMS_VERSION, privacy_version: PRIVACY_VERSION,
      document_hash: POLICY_HASH, app_version: appVersion
    });
    if (generation !== this.generation || this.state.user?.id !== userId)
      throw Error('Account changed. Sign in and review the terms again.');
    if (error) throw Error('Could not record your acceptance. Reconnect, check for an app update, and try again.');
    // Discard an older, concurrent access response before rechecking acceptance.
    while (this.checkingAccess && generation === this.generation)
      await new Promise(resolve => setTimeout(resolve, 10));
    if (generation !== this.generation) throw Error('Account changed. Sign in and review the terms again.');
    await this.refreshAccess();
    return this.status();
  }
  async adminAccounts(search: unknown, page: unknown): Promise<AdminAccount[]> {
    if (
      typeof search !== 'string' ||
      search.length > 100 ||
      typeof page !== 'number' ||
      !Number.isInteger(page) ||
      page < 0 ||
      page > 2000
    )
      throw Error('Invalid account search.');
    const { data, error } = await this.requireClient().rpc(
      'owlio_admin_accounts',
      { search_text: search, page_number: page }
    );
    if (error)
      throw Error(
        'Account management requires owner-authorized administrator access.'
      );
    return data as AdminAccount[];
  }
  async adminSetAccess(
    userId: unknown,
    blocked: unknown,
    reason: unknown
  ): Promise<void> {
    if (
      typeof userId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(userId) ||
      typeof blocked !== 'boolean' ||
      typeof reason !== 'string' ||
      reason.length > 200
    )
      throw Error('Invalid account access change.');
    const { error } = await this.requireClient().rpc('owlio_admin_set_access', {
      target_user: userId,
      is_blocked: blocked,
      block_reason: reason.trim()
    });
    if (error)
      throw Error(
        'Could not change account access. Administrator accounts cannot be suspended.'
      );
  }
  dispose() {
    ++this.operation;
    this.closeCallback();
    this.detach();
  }
}
