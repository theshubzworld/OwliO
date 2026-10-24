const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { TERMS_VERSION, PRIVACY_VERSION, POLICY_HASH } = require('../dist/shared/legal');
const { PGlite } = require('@electric-sql/pglite');

test('Postgres enforces administrator access, anonymous ingest credentials, deduplication and account suspension', async t => {
  const db = new PGlite();
  const owner = randomUUID(), member = randomUUID(), installation = randomUUID();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key, email text, created_at timestamptz default now(), last_sign_in_at timestamptz);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid$$;
      grant usage on schema auth to anon, authenticated, service_role;
      grant execute on function auth.uid() to anon, authenticated, service_role;`);
    for (const name of fs.readdirSync(path.join(__dirname, '../supabase/migrations')).sort()) {
      await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations', name), 'utf8'));
    }
    await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [owner, 'owner@example.test', member, 'member@example.test']);
    await db.query('insert into owlio_private.administrators values($1)', [owner]);
    const role = async (name, user, sql, args = []) => {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user || '']);
      await db.exec('set role ' + name);
      try { return await db.query(sql, args); } finally { await db.exec('reset role'); }
    };
    const rpc = (name, user, sql, args) => role(name, user, sql, args);
    await t.test('guests and ordinary members cannot read metrics, accounts or private records', async () => {
      const functions=await db.query("select p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('owlio_account_access','owlio_admin_metrics','owlio_admin_accounts','owlio_admin_set_access')");
      assert.equal(functions.rows.length,4);assert.ok(functions.rows.every(row=>row.prosecdef===false));
      await assert.rejects(rpc('anon', null, 'select public.owlio_admin_metrics(30)'), /permission denied/);
      await assert.rejects(rpc('authenticated', member, 'select public.owlio_admin_metrics(30)'), /Administrator access required/);
      await assert.rejects(rpc('authenticated', member, "select public.owlio_admin_accounts('',0)"), /Administrator access required/);
      await assert.rejects(role('authenticated', owner, 'select * from owlio_private.usage_events'), /permission denied/);
      await assert.rejects(rpc('authenticated', member, 'select public.owlio_admin_set_access($1,true,\'no\')', [owner]), /Administrator access required/);
    });
    const batch = [
      { id: randomUUID(), event: 'app_opened', timestamp: new Date().toISOString(), properties: { version: '1.0.14' } },
      { id: randomUUID(), event: 'dictation_completed', timestamp: new Date().toISOString(), properties: { audio_seconds: 30, words: 80, model: 'hinglish-transformers', language: 'hinglish' } },
      { id: randomUUID(), event: 'stage_completed', timestamp: new Date().toISOString(), properties: { stage: 'romanization', duration_ms: 400 } },
    ];
    const ingest = (token = 'a'.repeat(64)) => rpc('service_role', null,
      'select public.owlio_ingest_usage($1,$2,$3,$4::jsonb) as accepted', [installation, token, 'b'.repeat(64), JSON.stringify(batch)]);
    await t.test('only service ingestion accepts an installation token and retries are idempotent', async () => {
      await assert.rejects(rpc('anon', null, "select public.owlio_ingest_usage($1,$2,$3,'[]'::jsonb)", [installation, 'a'.repeat(64), 'b'.repeat(64)]), /permission denied/);
      assert.equal((await ingest()).rows[0].accepted.length, 3);
      assert.deepEqual((await ingest()).rows[0].accepted, []);
      await assert.rejects(ingest('c'.repeat(64)), /Invalid installation credential/);
    });
    await t.test('authorized metrics aggregate real events and contain no account email', async () => {
      const report = (await rpc('authenticated', owner, 'select public.owlio_admin_metrics(7) as report')).rows[0].report;
      assert.equal(report.installations, 1); assert.equal(report.activeInPeriod, 1);
      assert.equal(report.accounts, 2); assert.equal(report.successfulDictations, 1);
      assert.equal(report.audioMinutes, 0.5); assert.equal(report.words, 80);
      assert.equal(report.daily.length, 7); assert.equal(report.stages[0].stage, 'romanization');
      assert.equal(report.stages[0].averageMs, 400);
      assert.ok(!JSON.stringify(report).includes('@'));
      await assert.rejects(rpc('authenticated', owner, 'select public.owlio_admin_metrics(365)'), /Invalid reporting period/);
    });
    await t.test('owner can suspend/restore a member; member sees only own access; changes are audited', async () => {
      await rpc('authenticated', owner, 'select public.owlio_admin_set_access($1,true,$2)', [member, 'Contact the owner']);
      const access = (await rpc('authenticated', member, 'select public.owlio_account_access() as access')).rows[0].access;
      assert.equal(access.blocked,true); assert.equal(access.reason,'Contact the owner'); assert.equal(access.termsAccepted,false);
      const accounts = (await rpc('authenticated', owner, "select public.owlio_admin_accounts('member',0) as accounts")).rows[0].accounts;
      assert.equal(accounts.length, 1); assert.equal(accounts[0].email, 'member@example.test'); assert.equal(accounts[0].blocked, true);
      await assert.rejects(rpc('authenticated', owner, 'select public.owlio_admin_set_access($1,true,\'\')', [owner]), /cannot be suspended/);
      await rpc('authenticated', owner, 'select public.owlio_admin_set_access($1,false,\'\')', [member]);
      assert.equal((await rpc('authenticated', member, 'select public.owlio_account_access() as access')).rows[0].access.blocked, false);
      assert.equal((await db.query('select count(*)::int as n from owlio_private.access_audit')).rows[0].n, 2);
      await assert.rejects(role('authenticated', member, 'select * from owlio_private.access_audit'), /permission denied/);
    });
    await t.test('agreement is private, account-bound, explicit, versioned and idempotent; suspension cannot be bypassed', async () => {
      const args=[TERMS_VERSION,PRIVACY_VERSION,POLICY_HASH,'1.0.16'];
      const accept=(name,user,values=args)=>rpc(name,user,'select public.owlio_accept_terms($1,$2,$3,$4)',values);
      const access=async user=>(await rpc('authenticated',user,'select public.owlio_account_access() as status')).rows[0].status;
      assert.equal((await access(owner)).termsAccepted,false);
      await assert.rejects(accept('anon',null),/permission denied/);
      await assert.rejects(accept('authenticated',null),/Sign in required/);
      await assert.rejects(accept('authenticated',member,['old',PRIVACY_VERSION,POLICY_HASH,'1.0.16']),/current terms/);
      await assert.rejects(accept('authenticated',member,[TERMS_VERSION,PRIVACY_VERSION,'a'.repeat(64),'1.0.16']),/current terms/);
      await assert.rejects(accept('authenticated',member,[TERMS_VERSION,PRIVACY_VERSION,POLICY_HASH,'bad']),/Invalid app version/);
      await assert.rejects(role('authenticated',member,'select * from owlio_private.terms_acceptances'),/permission denied/);
      await accept('authenticated',member);const first=await access(member);assert.equal(first.termsAccepted,true);assert.equal(first.policyHash,POLICY_HASH);
      await accept('authenticated',member);assert.equal((await access(member)).acceptedAt,first.acceptedAt);
      assert.equal((await access(owner)).termsAccepted,false);
      assert.equal((await db.query('select count(*)::int n from owlio_private.terms_acceptances')).rows[0].n,1);
      await rpc('authenticated',owner,'select public.owlio_admin_set_access($1,true,$2)',[member,'Suspended']);
      await assert.rejects(accept('authenticated',member),/Account suspended/);
      await rpc('authenticated',owner,'select public.owlio_admin_set_access($1,false,$2)',[member,'']);
      await db.exec("update owlio_private.legal_policies set active=false");
      await db.query('insert into owlio_private.legal_policies values($1,$2,$3,true)',['next','next','b'.repeat(64)]);
      assert.equal((await access(member)).termsAccepted,false);
      await assert.rejects(accept('authenticated',member),/current terms/);
      await db.query('delete from auth.users where id=$1',[member]);
      assert.equal((await db.query('select count(*)::int n from owlio_private.terms_acceptances')).rows[0].n,0);
      const wrapper=await db.query("select prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='owlio_accept_terms'");assert.equal(wrapper.rows[0].prosecdef,false);
    });
    await t.test('database rate caps and retention run with service permissions only', async () => {
      await db.query("update owlio_private.rate_buckets set events=2000 where bucket like $1", ['install:' + installation + ':%']);
      await assert.rejects(ingest(), /Usage rate limited/);
      await db.query("insert into owlio_private.usage_events values($1,$2,'app_opened',now()-interval '91 days','{}')", [randomUUID(), installation]);
      await assert.rejects(rpc('anon', null, 'select public.owlio_purge_usage()'), /permission denied/);
      await rpc('service_role', null, 'select public.owlio_purge_usage()');
      assert.equal((await db.query('select count(*)::int as n from owlio_private.usage_events')).rows[0].n, 3);
    });
  } finally { await db.close(); }
});
