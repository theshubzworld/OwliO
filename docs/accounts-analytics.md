# Guest mode, optional sign-in and account usage reporting

**Guest mode (1.0.24+):** Owlio is free and works with no account. Without a signed-in account, every local feature is available and **no usage data is reported**. Builds without `cloud-config.json` (including forks) run in guest mode out of the box.

Signing in is optional. A signed-in account must explicitly accept the versioned Terms of Use and Privacy Notice; basic usage reporting then applies to that account. Signing in alone does not accept the terms or enable reporting. Signing out stops collection, clears the queue and returns the app to guest mode. A signed-in account that is suspended, has not accepted the current terms, or has an expired access cache is asked to fix that or sign out to continue as a guest. The owner dashboard is available only to signed-in administrators. There is no billing or payment collection. Existing installed 1.0.15 binaries retain their earlier optional-account behavior; this source update cannot retroactively change those binaries.

**Guest mode:** [Terms of Use](legal/terms-of-use.md) and [Privacy Notice](legal/privacy-notice.md), version `2026-10-26`, govern the free official app. Signing in is optional and usage reporting applies only to signed-in accounts that accept these versions; version `2026-10-23` (Release 1.0.16) required an account. Earlier draft documents are retained for history. The final policy is a separate immutable version and hash. No existing user is auto-accepted. The installer retains checks against draft legal documents and overwriting an existing installer.

When configured, the desktop main process handles Google browser sign-in, default email magic links, and numeric email codes with Supabase. Session credentials use Electron `safeStorage` (Windows encryption); tokens never cross the renderer IPC bridge. Analytics uses a small explicit collector, with no autocapture, session replay or account identification.

## 1. Create a Supabase project

Create a project in your own Supabase account. Save the database password securely. From the project connection/API settings, copy the project HTTPS URL and **publishable** key (legacy `anon` keys also work).

Copy `cloud-config.example.json` to `cloud-config.json` at the repository root and replace its values:

```json
{
  "supabaseUrl": "https://YOUR_PROJECT_REF.supabase.co",
  "publishableKey": "sb_publishable_YOUR_PUBLIC_KEY"
}
```

This file is ignored by Git and included in installer builds. The values are public configuration, not an authorization boundary. **Never put the service-role key, an `sb_secret_` key, database password, SMTP password or Google client secret in the desktop app.** Validation rejects service-role/secret keys.

Missing or invalid config disables account services and the app runs in guest mode with no reporting. Forks can configure their own backend. The application source is MIT licensed (see `LICENSE`); speech model weights keep their own licenses.

## 2. Apply the database migrations

In Supabase's SQL editor, run these files in order:

1. `supabase/migrations/20261023082427_optional_accounts_usage.sql`
2. `supabase/migrations/20261023082438_account_access.sql`
3. `supabase/migrations/20261023082647_usage_retention.sql`
4. `supabase/migrations/20261023082923_private_account_rpcs.sql`
5. `supabase/migrations/20261023093909_required_account_terms.sql`
6. `supabase/migrations/20261023093921_publish_free_access_terms.sql`

For an existing CLI migration workflow, link the project and use `supabase db push` instead. Apply each migration once. The private schema must **not** be added to the API's exposed schemas.

The migrations create private tables with row-level security and no direct client table grants. Public account RPCs are invoker wrappers around private implementations with explicit UID/admin checks. Schema usage permits calling these functions without granting access to table contents. Ordinary signed-in accounts can request their own access and acceptance status or explicitly record their own acceptance. The server checks the active document versions and SHA-256 fingerprint, stores server time and app version, refuses suspended accounts and rejects stale versions. Repeated acceptance is idempotent; users cannot read or edit the underlying tables or accept for another account. Deleting an account cascades to its agreement records. Administrator membership is stored in an owner-managed table, not user-editable signup metadata. Reports contain aggregates; the separate admin account search includes account email so the owner can manage suspensions.

## 3. Configure email links, optional codes and Google

In Authentication, enable the Email provider and allow new signups. The default **Magic Link / OTP** template works: Owlio sends a PKCE link whose allowed redirect returns to a temporary loopback listener. Open the email's link on the same computer while Owlio remains running. Email sign-in waits up to ten minutes. Add the loopback redirect URL below before testing either Google or email links. Never substitute an unrelated `localhost:3000` redirect.

Supabase's built-in mail service has delivery restrictions and is not a public production mail service. Configure a custom SMTP provider before public distribution; the dashboard may also require custom SMTP before allowing template edits. Owlio does **not** need an edited template for email links.

If you prefer numeric codes after setting up SMTP, edit the **Magic Link / OTP email template**:

```html
<h2>Sign in to Owlio</h2>
<p>Enter this code in Owlio: {{ .Token }}</p>
```

Test delivery with an address outside your project team. Keep Supabase's authentication rate limits enabled. Owlio accepts 6–8 digit codes when a code template is used. See [Supabase passwordless email documentation](https://supabase.com/docs/guides/auth/auth-email-passwordless).

For Google, create a Web OAuth client in Google Cloud, configure the consent screen, and put its client ID/secret in Supabase's Google provider settings. Google should redirect to the **Supabase callback URL displayed there**, typically `https://YOUR_PROJECT_REF.supabase.co/auth/v1/callback`.

In Supabase Authentication → URL Configuration, add this additional allowed redirect URL:

```text
http://127.0.0.1:17865/auth/callback/**
```

The app uses PKCE and a random callback path for both Google and email links; it listens only on loopback. Port 17865 must be available. Google browser sign-in expires after three minutes; email links wait ten minutes. Cancelling closes the listener, invalidates pending client requests, and prevents late session writes. Use another email / resend cancels the previous attempt before starting a new one. See [Supabase Google setup](https://supabase.com/docs/guides/auth/social-login/auth-google) and [redirect URL rules](https://supabase.com/docs/guides/auth/redirect-urls).

## 4. Deploy the usage collector

Authentication and account suspension work without the usage function. Reporting needs the function too. Use the Supabase CLI from this repository:

```powershell
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
```

The collector uses Supabase's injected `SUPABASE_SECRET_KEYS` by default, with support for older runtimes' `SUPABASE_SERVICE_ROLE_KEY`. It derives a separate rate-limit hashing key from this server-only credential. No extra secret is required for basic deployment:

```powershell
npx supabase functions deploy usage-events --project-ref YOUR_PROJECT_REF --no-verify-jwt
```

For an independent rate-limit key, optionally create an ignored `supabase/functions/.env` file with a newly generated random secret of at least 32 characters:

```dotenv
USAGE_RATE_SECRET=REPLACE_WITH_A_LONG_RANDOM_SECRET
```

Generate that value in a password manager. It is used only to hash daily network rate-limit buckets. Then upload the ignored file:

```powershell
npx supabase secrets set --env-file supabase/functions/.env --project-ref YOUR_PROJECT_REF
```

`verify_jwt=false` is intentional: reporting does not require a user account. The Edge Function applies strict schema/size checks, per-install credentials, and database rate limits. Supabase injects backend credentials **inside the function runtime**. Do not copy them to the desktop or Git. MCP deployment must include `usage-events/index.ts`, `_shared/usage-schema.mjs` and `_shared/server-key.mjs`. See [Edge Function secrets](https://supabase.com/docs/guides/functions/secrets).

Default ingestion caps are 2,000 events per installation/day, 10,000 per hashed network bucket/day, and 100,000 per project/day. Each batch has at most 20 events and 32 KiB. These are application caps, not a guarantee against invocation charges or abuse. Keep provider quotas, alerts and available spending limits configured before public distribution. Public client telemetry is approximate and can be fabricated by modified clients; it is unsuitable for billing.

## 5. Schedule retention cleanup

The retention migration enables **Supabase Cron** when available and creates `owlio-retention` at 03:00 UTC daily. Verify that this job is active in Cron. On environments without `pg_cron`, configure an external daily job executing:

```sql
select public.owlio_purge_usage();
delete from owlio_private.access_audit where changed_at < now() - interval '90 days';
```

Usage events and inactive installation records expire after 90 days. Ingestion also performs usage cleanup at most once per day, but the scheduled job is necessary for cleanup when nobody sends events. Account records persist until the owner deletes them through Supabase Auth. Suspension status persists until restored or the account is deleted. Delete an account through Supabase Auth to remove its access status and administrator membership as well. Audit UUID references are nulled on account deletion; short reasons expire via the scheduled job. Avoid putting sensitive information in suspension reasons.

## 6. Optional PostHog mirror

The in-app admin dashboard reads Supabase; **PostHog is optional**. To use its funnels or retention analysis, create your own PostHog project and append these values to the same ignored function env file:

```dotenv
POSTHOG_PROJECT_TOKEN=YOUR_POSTHOG_PROJECT_TOKEN
POSTHOG_HOST=https://us.i.posthog.com
```

Use `https://eu.i.posthog.com` for an EU project. Re-run `supabase secrets set`. No desktop rebuild is needed for server secret changes. Mirroring sends only already-accepted allowlisted events, with person-profile processing and GeoIP disabled. It is best-effort: failures do not affect dictation or Supabase reporting. Set PostHog's event retention to 90 days too before enabling this mirror, and maintain a separate deletion process there if needed. Supabase cleanup does not delete PostHog copies. See [PostHog capture API](https://posthog.com/docs/api/capture).

## 7. Authorize your administrator account

Start Owlio, open **Account & privacy**, and sign in. In Supabase Auth's Users page, copy your verified account UUID. In the SQL editor run:

```sql
insert into owlio_private.administrators(user_id)
values ('YOUR_VERIFIED_AUTH_USER_UUID'::uuid)
on conflict do nothing;
```

Open **Account & privacy → Open admin dashboard**. It shows 7/30/90-day UTC activity, delivered/failed dictations, stage timing/failures, models, languages, app versions and account search. Grant administrators only from the SQL editor; do not add a public role-grant endpoint. Revoke one with:

```sql
delete from owlio_private.administrators where user_id='ADMIN_AUTH_USER_UUID'::uuid;
```

Account access controls require a review step: choose an account, optionally enter a short user-visible reason, then select **Suspend account**. Restore works from the same table. Admin accounts cannot be suspended, and every change writes a private audit entry.

Sign-in and terms checks run at startup/sign-in and approximately every 60 seconds online. Access is checked in the main process before dictation, meetings, recovery and insertion. Loss of access cancels active processing and opens the account screen. Signing out keeps the app locked; it cannot bypass suspension. The account ID, project, accepted versions and policy hash must match an encrypted access cache checked successfully within the past **24 hours**. A missing, stale or old-format cache is denied. Cache expiry is checked locally as well as during network refreshes. Initial sign-in/acceptance requires internet; local speech may run offline within that 24-hour window. Remote changes take effect on reconnection or expiry. This is not a tamper-proof licensing system.

## 8. Build and verify

```powershell
npm ci
npm run typecheck
npm run build:renderer
npm run build:main
npm start
```

For subsequent releases, review any document changes and activate the matching policy, then increase `package.json`/lockfile to a fresh version, then run `npm run package` on Windows. The script refuses to overwrite an existing versioned installer and refuses to package draft legal documents. `cloud-config.json` must be present before packaging the official build.

Local tests cover the real Postgres migration functions using PGlite with Supabase Auth role/UID stubs, encryption, versioned acceptance, mandatory-reporting gates and queue behavior, mocked authentication, and renderer flows in Electron. They do not establish live Google, SMTP, hosted Supabase or PostHog connectivity. After creating your projects, verify:

1. Fresh profile and upgrades: the app works as a guest and sends no usage events. Neither signing in alone nor a previously enabled reporting flag sends events before current terms acceptance. The acceptance checkbox starts unchecked.
2. Email: default link arrives and opens back into the app; with a code template, wrong codes fail and correct codes sign in. Restart restores the encrypted session and sign-out works offline.
3. Google: browser opens, callback completes, cancel/timeout leaves no signed-in session.
4. A member cannot read admin reports or change access. Your SQL-authorized admin can.
5. Suspend a disposable member account; its connected app stops processing after the next check. Restore it. Signing out returns the app to guest mode with no reporting.
6. As a guest, before acceptance and after sign-out, no usage HTTP requests occur. After acceptance, reporting applies to the signed-in account; an attempt to toggle the old consent IPC is rejected with a pointer to guest mode. Inspect event properties to confirm there is no text/audio/email/key.
7. Disconnect: only the valid 24-hour access cache permits local features. Queue events within bounds (200 / seven days). Sign out: pending sends abort and the queue clears. Test missing/expired cache, a different account, and updated policy versions; none may start reporting, and each offers sign-out to continue as a guest.

Internal automated email/admin verification tools and their temporary profiles are maintained locally and are not part of the public source. Use the checklist above to verify your deployment.

### Interpreting database advisor results

The private tables intentionally have RLS with no client policies and no client table grants: clients must use the guarded RPCs. Supabase may report [RLS Enabled No Policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) as informational for those tables. Creating broad policies would change that protection. Newly created supporting indexes may also show [Unused Index](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) until traffic uses them. The account RPC migration keeps privileged implementations out of exposed API schemas; public account wrappers use invoker security.

The app uses OTP/OAuth, but the project may separately allow password authentication. If the advisor flags [Leaked Password Protection Disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), configure that in Supabase before offering password login.

## Open source and possible paid features later

Publish the migrations, function source and this guide. The official build requires the configured backend, sign-in and terms. Contributors can run their own backend or modify the client under the source licence; client-only checks cannot restrict permitted forks. Publishing the frontend/project URL and publishable key does not grant administrator access; database permissions remain essential. Do not publish production data, profiles, credentials, service keys or env files. Model weights and third-party licenses need their own release review.

Supabase does not determine whether Owlio is free or paid. A future paid version should add a separate entitlement layer (for example `free`/`pro` with explicit feature grants), verified on the backend, and a billing-provider webhook with signature verification and idempotent handling. Suspension is for access administration, not a substitute for payment state. Do not calculate bills from client analytics.

Future paid features need separate disclosed prices and explicit purchase approval. Accepting the free app’s terms does not authorize future charges. Hosted AI, sync or team features can have server-enforced entitlements; client checks in open-source code can be modified.

The repository currently declares MIT. MIT permits modification, redistribution and sale subject to its notice conditions; charging for official binaries does not prevent people building or distributing permitted copies. Open-source client checks can be removed in forks. Choose your licensing and business model before publishing if exclusive paid access is essential. See the [MIT license text](https://opensource.org/license/mit).
