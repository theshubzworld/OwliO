-- Versioned agreement records. No user is accepted automatically, including admins.
-- Draft policy is for review/testing; publish new immutable versions after owner review.
create table owlio_private.legal_policies (
  terms_version text not null,
  privacy_version text not null,
  document_hash text not null check (document_hash ~ '^[0-9a-f]{64}$'),
  active boolean not null default false,
  primary key (terms_version, privacy_version),
  unique (terms_version, privacy_version, document_hash)
);
create unique index legal_policies_one_active on owlio_private.legal_policies(active) where active;
create table owlio_private.terms_acceptances (
  user_id uuid not null references auth.users(id) on delete cascade,
  terms_version text not null,
  privacy_version text not null,
  document_hash text not null,
  accepted_at timestamptz not null default now(),
  app_version text not null check (length(app_version) <= 64),
  primary key (user_id, terms_version, privacy_version),
  foreign key (terms_version, privacy_version, document_hash)
    references owlio_private.legal_policies(terms_version, privacy_version, document_hash)
);
create index terms_acceptances_policy on owlio_private.terms_acceptances(terms_version, privacy_version, document_hash);
alter table owlio_private.legal_policies enable row level security;
alter table owlio_private.terms_acceptances enable row level security;
revoke all on owlio_private.legal_policies, owlio_private.terms_acceptances from public, anon, authenticated;

insert into owlio_private.legal_policies(terms_version, privacy_version, document_hash, active)
values ('2026-10-23-draft1', '2026-10-23-draft1', 'fe34f94b256c01b4e4a23fb89ad722c0189ac0edb6e171c63f1b3e11ef4ecb18', true);

create or replace function owlio_private.owlio_account_access() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare account_id uuid := auth.uid(); result jsonb; policy owlio_private.legal_policies; acceptance owlio_private.terms_acceptances;
begin
  if account_id is null then raise exception 'Sign in required' using errcode='42501'; end if;
  select jsonb_build_object('blocked', blocked, 'reason', reason) into result
    from owlio_private.account_access where user_id=account_id;
  select * into policy from owlio_private.legal_policies where active;
  select * into acceptance from owlio_private.terms_acceptances
    where user_id=account_id and terms_version=policy.terms_version
      and privacy_version=policy.privacy_version and document_hash=policy.document_hash;
  return coalesce(result, '{"blocked":false,"reason":""}'::jsonb) || jsonb_build_object(
    'termsAccepted', acceptance.user_id is not null,
    'termsVersion', policy.terms_version, 'privacyVersion', policy.privacy_version,
    'policyHash', policy.document_hash, 'acceptedAt', acceptance.accepted_at);
end;
$$;

create function owlio_private.owlio_accept_terms(terms_version text, privacy_version text, document_hash text, app_version text)
returns void language plpgsql security definer set search_path = '' as $$
declare account_id uuid := auth.uid();
begin
  if account_id is null then raise exception 'Sign in required' using errcode='42501'; end if;
  if exists(select 1 from owlio_private.account_access where user_id=account_id and blocked) then
    raise exception 'Account suspended' using errcode='42501';
  end if;
  if $4 is null or length($4)>64 or $4 !~ '^[0-9]+\.[0-9]+\.[0-9]+([+-][a-zA-Z0-9.-]+)?$' then
    raise exception 'Invalid app version' using errcode='22023';
  end if;
  -- Share-lock the active policy so publication cannot race acceptance.
  perform 1 from owlio_private.legal_policies p
    where p.active and p.terms_version=$1 and p.privacy_version=$2 and p.document_hash=$3 for share;
  if not found then raise exception 'Review the current terms in an updated app' using errcode='22023'; end if;
  insert into owlio_private.terms_acceptances(user_id,terms_version,privacy_version,document_hash,app_version)
    values(account_id,$1,$2,$3,$4) on conflict on constraint terms_acceptances_pkey do nothing;
end;
$$;
create function public.owlio_accept_terms(terms_version text, privacy_version text, document_hash text, app_version text)
returns void language sql security invoker set search_path = '' as $$
  select owlio_private.owlio_accept_terms($1,$2,$3,$4)
$$;
revoke all on function owlio_private.owlio_accept_terms(text,text,text,text), public.owlio_accept_terms(text,text,text,text) from public, anon;
grant execute on function owlio_private.owlio_accept_terms(text,text,text,text), public.owlio_accept_terms(text,text,text,text) to authenticated;
comment on table owlio_private.terms_acceptances is 'Account-linked explicit agreement records, distinct from pseudonymous usage events. No client table grants. Retained until account deletion; FK cascade deletes agreements.';
