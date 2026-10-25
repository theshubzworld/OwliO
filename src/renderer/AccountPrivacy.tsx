import React, { useEffect, useRef, useState } from 'react';
import { BarChart3, LogOut, ShieldCheck, UserRound } from 'lucide-react';
import { accountAccessError } from '../shared/accountAccess';
import { TERMS_DOCUMENT, PRIVACY_DOCUMENT, TERMS_VERSION, PRIVACY_VERSION, POLICY_HASH, LEGAL_REVIEWED } from '../shared/legal';
import type {
  AccountStatus,
  AdminMetrics,
  AdminAccount,
  AnalyticsStatus
} from '../shared/cloud';

interface CloudApi {
  getAccountStatus(): Promise<AccountStatus>;
  signInGoogle(): Promise<AccountStatus>;
  sendSignInCode(email: string): Promise<void>;
  verifySignInCode(email: string, code: string): Promise<AccountStatus>;
  cancelSignIn(): Promise<AccountStatus>;
  signOut(): Promise<AccountStatus>;
  onAccountChanged(callback: (status: AccountStatus) => void): () => void;
  getAnalyticsStatus(): Promise<AnalyticsStatus>;
  acceptTerms(confirmed: boolean): Promise<AccountStatus>;
  refreshAccountAccess(): Promise<AccountStatus>;
  getAdminMetrics(days: number): Promise<AdminMetrics>;
  getAdminAccounts(search: string, page: number): Promise<AdminAccount[]>;
  setAdminAccountAccess(
    userId: string,
    blocked: boolean,
    reason: string
  ): Promise<void>;
}
const api = () => (window as unknown as { api: CloudApi }).api;
const message = (error: unknown) =>
  error instanceof Error
    ? error.message.replace(
        /^Error invoking remote method '[^']+': Error: /,
        ''
      )
    : 'This request could not be completed. Please try again.';

export function UsageConsent({ compact = false }: { compact?: boolean }) {
  const [status, setStatus] = useState<AnalyticsStatus | null>(null);
  useEffect(() => {
    let active = true;
    const refresh = () => { void api().getAnalyticsStatus().then(next => { if (active) setStatus(next); }).catch(() => {}); };
    refresh();
    const unsubscribe = api().onAccountChanged(refresh);
    const timer = setInterval(refresh, 15000);
    return () => { active = false; clearInterval(timer); unsubscribe(); };
  }, []);
  return <section className="card usage-consent" aria-labelledby="usage-consent-heading">
    <div className="shortcut-heading"><ShieldCheck size={20}/><h3 id="usage-consent-heading">Usage reporting</h3></div>
    <p>Owlio is free to use with no account. In guest mode nothing is reported. If you choose to sign in, basic usage reporting is part of the account terms.</p>
    <p className="muted">Reporting includes activity counts, model and language categories, processing times, audio duration, word counts, app and Windows versions, and success or failure counts.</p>
    <p className="muted">No audio, dictated or selected text, commands, API keys, window titles, or account email is included in usage events. Events use a random installation ID and expire after 90 days.</p>
    <p className="muted">Reporting starts only after sign-in and terms acceptance. Sign out at any time to stop reporting and keep using Owlio as a guest. Account and acceptance records are stored separately.</p>
    {!compact && <p className="muted" role="status">{!status ? 'Checking reporting status…' : status.enabled ? `Reporting active · ${status.queued} events waiting` : 'Not reporting. Guest mode and unverified accounts send no usage data.'}</p>}
  </section>;
}

function TermsAgreement({ status, busy, accept }: { status: AccountStatus | null; busy: boolean; accept: () => void }) {
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => { setConfirmed(false); }, [status?.user?.id]);
  const accepted = !!status?.access?.termsAccepted && status.access.termsVersion === TERMS_VERSION && status.access.privacyVersion === PRIVACY_VERSION && status.access.policyHash === POLICY_HASH;
  return <section className="card terms-agreement" aria-labelledby="terms-heading">
    <h3 id="terms-heading">{accepted ? 'Your agreement' : status?.user ? 'Review and accept to continue' : 'Account terms'}</h3>
    {!LEGAL_REVIEWED && <p className="account-notice">Draft preview — these documents are awaiting owner review before public release.</p>}
    <p>You can use Owlio without an account. Signing in is optional; accounts require agreement to the Terms of Use and acknowledgement of the Privacy Notice, including basic usage reporting for signed-in accounts.</p>
    {[TERMS_DOCUMENT, PRIVACY_DOCUMENT].map(doc => <details key={doc.title} className="settings-disclosure legal-document">
      <summary>{doc.title} · {doc.version}</summary>
      <div className="legal-document-body">{doc.sections.map(section => <section key={section.title}><h4>{section.title}</h4><p>{section.text}</p></section>)}</div>
    </details>)}
    {accepted ? <p role="status">Accepted version {TERMS_VERSION}{status?.access?.acceptedAt ? ' on ' + new Date(status.access.acceptedAt).toLocaleString() : ''}. Signing out returns you to guest mode.</p> : <>
      <label className="usage-choice"><input id="terms-acceptance" type="checkbox" checked={confirmed} disabled={busy || !status?.user || status.access?.blocked} onChange={event => setConfirmed(event.target.checked)}/><span>I accept the Terms of Use and acknowledge the Privacy Notice, including basic usage reporting while I am signed in.</span></label>
      <button className="btn btn-primary" id="accept-terms" disabled={!confirmed || busy || !status?.user || status.access?.blocked} onClick={accept}>{busy ? 'Saving…' : 'Accept and continue'}</button>
      {!status?.user && <p className="muted">Only needed if you sign in. You are using Owlio as a guest: no account, no usage reporting.</p>}
    </>}
  </section>;
}

export function AccountPrivacy({
  onContinue,
  onAdmin
}: {
  onContinue: () => void;
  onAdmin: () => void;
}) {
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(false);
  useEffect(() => {
    let active = true,
      observed = false;
    mounted.current = true;
    const unsubscribe = api().onAccountChanged((next) => {
      observed = true;
      if (active) setStatus(next);
    });
    void api()
      .getAccountStatus()
      .then((next) => {
        if (active && !observed) setStatus(next);
      })
      .catch((error) => {
        if (active) setError(message(error));
      });
    return () => {
      active = false;
      mounted.current = false;
      unsubscribe();
    };
  }, []);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (error) {
      if (mounted.current) setError(message(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const send = () =>
    run(async () => {
      await api().sendSignInCode(email.trim());
      if (mounted.current) {
        setSentTo(email.trim());
        setCode('');
      }
    });
  const disabled = busy || !!status?.signingIn || !status?.configured;
  return (
    <div className="settings-page account-page">
      <div className="settings-page-heading">
        <span className="settings-eyebrow">Free app · Account optional</span>
        <h1>Account &amp; privacy</h1>
        <p>
          Owlio works fully as a guest, with no account and no usage reporting. Sign in only if you want an account; accounts accept the Terms of Use and Privacy Notice, including basic usage reporting.
        </p>
      </div>
      <section className="card account-card" aria-labelledby="account-heading">
        <div className="shortcut-heading">
          <UserRound size={20} />
          <h3 id="account-heading">
            {status?.user ? 'Your account' : 'Sign in to Owlio'}
          </h3>
        </div>
        {!status ? (
          <p className="muted" role="status">
            Checking your account…
          </p>
        ) : status.user ? (
          <>
            <p className="account-email">{status.user.email || 'Signed in'}</p>
            {status.access?.blocked && (
              <div className="account-notice" role="alert">
                <strong>This account is suspended</strong>
                <p>
                  {status.access.reason ||
                    'The administrator has suspended access for this account.'}
                </p>
                <p>Contact the administrator to restore access, or sign out to keep using Owlio as a guest.</p>
              </div>
            )}
            {status.access?.offline && (
              <p className="muted">
                Access checks are offline. A verified account with accepted terms can use local features for up to 24 hours after its last successful check.
              </p>
            )}
            <p className="muted">
              Your account is connected. History, dictionary, settings, and
              provider keys stay on this computer. Cloud sync is not enabled.
            </p>
            <button
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => {
                void run(async () => {
                  const next = await api().signOut();
                  if (mounted.current) {
                    setStatus(next);
                    setSentTo('');
                    setCode('');
                  }
                });
              }}
            >
              <LogOut size={16} />
              Sign out on this computer
            </button>
          </>
        ) : (
          <>
            {!status.configured && (
              <p className="account-notice">
                Account services are not configured in this build. Owlio runs in guest mode with every local feature and no usage reporting.
              </p>
            )}
            <button
              className="btn btn-secondary google-signin"
              disabled={disabled || status.emailLinkPending}
              onClick={() => {
                void run(async () => {
                  const next = await api().signInGoogle();
                  if (mounted.current) setStatus(next);
                });
              }}
            >
              Continue with Google
            </button>
            <p className="muted">
              Or receive a sign-in link by email. Custom email templates may
              provide a numeric code instead.
            </p>
            <form
              className="account-form"
              onSubmit={(event) => {
                event.preventDefault();
                void (sentTo
                  ? run(async () => {
                      const next = await api().verifySignInCode(sentTo, code);
                      if (mounted.current) {
                        setStatus(next);
                        setCode('');
                      }
                    })
                  : send());
              }}
            >
              <label htmlFor="account-email">Email address</label>
              <input
                className="input"
                id="account-email"
                type="email"
                autoComplete="email"
                maxLength={254}
                required
                value={email}
                disabled={disabled || !!sentTo}
                onChange={(event) => setEmail(event.target.value)}
              />
              {sentTo && (
                <>
                  <p className="muted" role="status">
                    Sign-in email sent to {sentTo}. Open its link on this
                    computer while Owlio stays open. If it contains a code,
                    enter it below. Check your spam folder too.
                  </p>
                  <label htmlFor="account-code">Email code</label>
                  <input
                    className="input"
                    id="account-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6,8}"
                    minLength={6}
                    maxLength={8}
                    required
                    value={code}
                    disabled={disabled}
                    onChange={(event) =>
                      setCode(event.target.value.replace(/\D/g, ''))
                    }
                  />
                </>
              )}
              <div className="account-actions">
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={disabled}
                >
                  {busy
                    ? 'Please wait…'
                    : sentTo
                      ? 'Verify and sign in'
                      : 'Send sign-in email'}
                </button>
                {sentTo && (
                  <button
                    className="btn btn-secondary"
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      void run(async () => {
                        const next = await api().cancelSignIn();
                        if (mounted.current) {
                          setStatus(next);
                          setSentTo('');
                          setCode('');
                        }
                      });
                    }}
                  >
                    Use another email / resend
                  </button>
                )}
              </div>
            </form>
            <p className="muted">
              Signing in sends your email and authentication details to the
              configured account service. Usage reporting starts only after you explicitly accept the terms.
            </p>
          </>
        )}
        {(status?.signingIn || status?.emailLinkPending) && (
          <div className="account-actions">
            <p role="status">
              {status.emailLinkPending
                ? 'Waiting for your email link or code.'
                : 'Complete sign-in in your browser.'}
            </p>
            <button
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => {
                void run(async () => {
                  const next = await api().cancelSignIn();
                  if (mounted.current) {
                    setStatus(next);
                    setSentTo('');
                    setCode('');
                  }
                });
              }}
            >
              Cancel sign-in
            </button>
          </div>
        )}
        {(error || status?.error) && (
          <p className="shortcut-error" role="alert">
            {error || status?.error}
          </p>
        )}
        {!status?.user && status?.error && (
          <button
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => {
              void run(async () => {
                const next = await api().signOut();
                if (mounted.current) setStatus(next);
              });
            }}
          >
            Clear saved sign-in
          </button>
        )}
      </section>
      {status?.user && accountAccessError(status) && !status.access?.blocked && <p className="account-notice" role="status">{accountAccessError(status)}</p>}
      <TermsAgreement status={status} busy={busy} accept={() => { void run(async () => { const next = await api().acceptTerms(true); if (mounted.current) setStatus(next); }); }}/>
      {status?.user && <button className="btn btn-secondary" disabled={busy} onClick={() => { void run(async () => { const next = await api().refreshAccountAccess(); if (mounted.current) setStatus(next); }); }}>Refresh account access</button>}
      {!accountAccessError(status) && <button className="btn btn-secondary account-continue" disabled={busy} onClick={onContinue}>Back to dictation</button>}
      <UsageConsent />
      <section className="card">
        <div className="shortcut-heading">
          <BarChart3 size={20} />
          <h3>Owner dashboard</h3>
        </div>
        <p className="muted">
          Aggregate usage reports and account controls are available to
          administrators authorized by the project owner.
        </p>
        <button
          className="btn btn-secondary"
          disabled={busy || !status?.user || !!accountAccessError(status)}
          onClick={onAdmin}
        >
          Open admin dashboard
        </button>
      </section>
    </div>
  );
}

export function AdminDashboard({ onBack }: { onBack: () => void }) {
  const [days, setDays] = useState(30);
  const [refresh, setRefresh] = useState(0);
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let mounted = true;
    let accountChanged = false;
    setLoading(true);
    setMetrics(null);
    setError('');
    void api()
      .getAdminMetrics(days)
      .then((data) => {
        if (mounted && !accountChanged) setMetrics(data);
      })
      .catch((error) => {
        if (mounted) setError(message(error));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    // Drop rendered data immediately if account access changes.
    const unsubscribe = api().onAccountChanged((status) => {
      if (!status.user || status.access?.blocked) {
        accountChanged = true;
        if (mounted) {
          setMetrics(null);
          setError(
            'Account changed. Return to Account & privacy and sign in again.'
          );
        }
      }
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [days, refresh]);
  const number = (value: number) => value.toLocaleString();
  return (
    <div className="settings-page admin-page">
      <div className="settings-page-heading">
        <span className="settings-eyebrow">Owner dashboard</span>
        <h1>Usage overview</h1>
        <p>
          Reporting installations are counted only after sign-in and terms acceptance. Counts are
          approximate and do not represent all downloads or unique people.
        </p>
      </div>
      <div className="account-actions">
        <button className="btn btn-secondary" onClick={onBack}>
          ← Account &amp; privacy
        </button>
        <label htmlFor="metrics-period">Period (UTC)</label>
        <select
          id="metrics-period"
          className="input"
          value={days}
          onChange={(event) => setDays(Number(event.target.value))}
        >
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
        <button
          className="btn btn-secondary"
          disabled={loading}
          onClick={() => setRefresh((value) => value + 1)}
        >
          Refresh
        </button>
      </div>
      {loading && <p role="status">Loading authorized usage report…</p>}
      {error && (
        <section className="card" role="alert">
          <h3>Report unavailable</h3>
          <p>{error}</p>
        </section>
      )}
      {metrics && (
        <>
          <AccountManagement />
          <div className="admin-metrics">
            {[
              ['Reporting installs · 90 days', metrics.installations],
              ['Active today', metrics.activeToday],
              ['Active in period', metrics.activeInPeriod],
              ['Registered accounts · all time', metrics.accounts],
              ['Dictations delivered', metrics.successfulDictations],
              ['Dictations failed / cancelled', metrics.failedDictations],
              ['Audio minutes delivered', metrics.audioMinutes],
              ['Words delivered', metrics.words],
              ['Setups completed in period', metrics.setupCompletions],
              ['Installs with a dictation', metrics.activatedInstallations]
            ].map(([label, value]) => (
              <div className="card admin-metric" key={label}>
                <span>{label}</span>
                <strong>{number(value as number)}</strong>
              </div>
            ))}
          </div>
          <section className="card">
            <h3>Pipeline stages</h3>
            <div className="admin-table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th scope="col">Stage</th>
                    <th scope="col">Runs</th>
                    <th scope="col">Failed / cancelled</th>
                    <th scope="col">Average time</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.stages.map((row) => (
                    <tr key={row.stage}>
                      <th scope="row">{row.stage}</th>
                      <td>{number(row.total)}</td>
                      <td>{number(row.failed)}</td>
                      <td>{number(row.averageMs ?? 0)} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!metrics.stages.length && (
              <p className="muted">No stage events in this period.</p>
            )}
          </section>
          <div className="admin-breakdowns">
            {[
              [
                'Speech models · dictations',
                metrics.models.map((row) => ({
                  label: row.model,
                  count: row.count
                }))
              ],
              [
                'Languages · dictations',
                metrics.languages.map((row) => ({
                  label: row.language,
                  count: row.count
                }))
              ],
              [
                'App versions · reporting installs',
                metrics.versions.map((row) => ({
                  label: row.version,
                  count: row.count
                }))
              ]
            ].map(([title, rows]) => (
              <section className="card" key={title as string}>
                <h3>{title as string}</h3>
                <ul>
                  {(rows as { label: string; count: number }[]).map((row) => (
                    <li key={row.label}>
                      <span>{row.label}</span>
                      <strong>{number(row.count)}</strong>
                    </li>
                  ))}
                </ul>
                {!(rows as unknown[]).length && (
                  <p className="muted">No events in this period.</p>
                )}
              </section>
            ))}
          </div>
          <section className="card">
            <h3>Daily activity (UTC)</h3>
            <div className="admin-table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th scope="col">Day</th>
                    <th scope="col">Active installs</th>
                    <th scope="col">Delivered</th>
                    <th scope="col">Failed / cancelled</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.daily.map((row) => (
                    <tr key={row.day}>
                      <th scope="row">{row.day}</th>
                      <td>{number(row.active)}</td>
                      <td>{number(row.dictations)}</td>
                      <td>{number(row.failures)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <p className="muted">
            Usage events are retained for 90 days. Account counts are
            independent of usage reporting. Signing out resets the local reporting
            installation ID. A single installation can appear under multiple
            versions.
          </p>
        </>
      )}
    </div>
  );
}

function AccountManagement() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [rows, setRows] = useState<AdminAccount[]>([]);
  const [selected, setSelected] = useState<AdminAccount | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setRows([]);
    setError('');
    void api()
      .getAdminAccounts(query, page)
      .then((data) => {
        if (mounted) setRows(data);
      })
      .catch((error) => {
        if (mounted) setError(message(error));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [query, page, refresh]);
  const change = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    setChanging(true);
    setError('');
    setNotice('');
    try {
      await api().setAdminAccountAccess(selected.id, !selected.blocked, reason);
      setNotice(
        selected.blocked
          ? 'Account access restored.'
          : 'Account suspended. The change takes effect on its next online access check.'
      );
      setSelected(null);
      setReason('');
      setRefresh((value) => value + 1);
    } catch (error) {
      setError(message(error));
    } finally {
      setChanging(false);
    }
  };
  return (
    <section
      className="card account-management"
      aria-labelledby="account-management-heading"
    >
      <h3 id="account-management-heading">Account access</h3>
      <p className="muted">
        Suspend accounts or restore access. Suspension applies to the signed-in account and its reporting; the user can still sign out and use Owlio as a guest. This control is separate from future paid plans.
      </p>
      <form
        className="account-actions"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(search.trim());
          setPage(0);
          setSelected(null);
          setRefresh((value) => value + 1);
        }}
      >
        <label htmlFor="admin-account-search">Email or account ID</label>
        <input
          className="input"
          id="admin-account-search"
          maxLength={100}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button type="submit" className="btn btn-secondary" disabled={changing}>
          Search
        </button>
      </form>
      {loading ? (
        <p role="status">Loading accounts…</p>
      ) : (
        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th scope="col">Account</th>
                <th scope="col">Status</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row">
                    {row.email || 'No email'}
                    <span className="admin-account-id">{row.id}</span>
                  </th>
                  <td>
                    {row.administrator
                      ? 'Administrator'
                      : row.blocked
                        ? 'Suspended'
                        : 'Active'}
                    {row.blocked && (
                      <span className="admin-account-id">{row.reason}</span>
                    )}
                  </td>
                  <td>
                    <button
                      className="btn btn-secondary"
                      disabled={row.administrator || changing}
                      onClick={() => {
                        setSelected(row);
                        setReason('');
                        setNotice('');
                      }}
                    >
                      {row.blocked ? 'Restore access' : 'Suspend'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <p className="muted">No matching accounts.</p>}
        </div>
      )}
      <div className="account-actions">
        <button
          className="btn btn-secondary"
          disabled={page === 0 || loading || changing}
          onClick={() => {
            setPage((value) => value - 1);
            setSelected(null);
          }}
        >
          Previous
        </button>
        <span>Page {page + 1}</span>
        <button
          className="btn btn-secondary"
          disabled={rows.length < 50 || loading || changing || page >= 2000}
          onClick={() => {
            setPage((value) => value + 1);
            setSelected(null);
          }}
        >
          Next
        </button>
      </div>
      {selected && (
        <form
          className="account-form account-notice"
          onSubmit={(event) => {
            void change(event);
          }}
        >
          <strong>
            {selected.blocked ? 'Restore access for' : 'Suspend'}{' '}
            {selected.email || selected.id}?
          </strong>
          {!selected.blocked && (
            <>
              <label htmlFor="suspension-reason">
                Reason shown to this user (optional)
              </label>
              <input
                className="input"
                id="suspension-reason"
                maxLength={200}
                value={reason}
                disabled={changing}
                onChange={(event) => setReason(event.target.value)}
              />
            </>
          )}
          <div className="account-actions">
            <button
              className="btn btn-primary"
              disabled={changing}
              type="submit"
            >
              {changing
                ? 'Saving…'
                : selected.blocked
                  ? 'Restore account access'
                  : 'Suspend account'}
            </button>
            <button
              className="btn btn-secondary"
              disabled={changing}
              type="button"
              onClick={() => setSelected(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="shortcut-error">
          {error}
        </p>
      )}
    </section>
  );
}
