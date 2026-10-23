-- No user content or account identifiers belong in usage tables.
create schema if not exists owlio_private;
revoke all on schema owlio_private from public, anon, authenticated;

create table owlio_private.administrators (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table owlio_private.installations (
  id uuid primary key,
  credential_hash text not null check (credential_hash ~ '^[0-9a-f]{64}$'),
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create table owlio_private.usage_events (
  id uuid primary key,
  installation_id uuid not null references owlio_private.installations(id) on delete cascade,
  event text not null check (event in ('installation_registered','app_opened','setup_completed','dictation_completed','dictation_failed','stage_completed','stage_failed')),
  occurred_at timestamptz not null,
  properties jsonb not null check (jsonb_typeof(properties) = 'object')
);
create index usage_events_date on owlio_private.usage_events(occurred_at);
create index usage_events_installation on owlio_private.usage_events(installation_id, occurred_at);
create table owlio_private.rate_buckets (
  bucket text primary key,
  day date not null,
  events integer not null
);
create table owlio_private.maintenance (singleton boolean primary key default true check (singleton), cleaned_at timestamptz not null);

alter table owlio_private.administrators enable row level security;
alter table owlio_private.installations enable row level security;
alter table owlio_private.usage_events enable row level security;
alter table owlio_private.rate_buckets enable row level security;
alter table owlio_private.maintenance enable row level security;
revoke all on all tables in schema owlio_private from public, anon, authenticated;

create function public.owlio_purge_usage() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from owlio_private.usage_events where occurred_at < now() - interval '90 days';
  delete from owlio_private.installations where last_seen < now() - interval '90 days';
  delete from owlio_private.rate_buckets where day < (now() at time zone 'UTC')::date - 2;
end;
$$;
revoke all on function public.owlio_purge_usage() from public, anon, authenticated;
grant execute on function public.owlio_purge_usage() to service_role;

create function public.owlio_ingest_usage(install_id uuid, credential_hash text, network_bucket text, batch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  current_day date := (now() at time zone 'UTC')::date;
  batch_size integer;
  bucket_name text;
  bucket_limit integer;
  accepted jsonb;
begin
  if jsonb_typeof(batch) <> 'array' or jsonb_array_length(batch) not between 1 and 20
     or credential_hash !~ '^[0-9a-f]{64}$' or network_bucket !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid usage batch';
  end if;
  batch_size := jsonb_array_length(batch);
  -- Atomic counters cap traffic per installation, rotating network bucket and project.
  foreach bucket_name in array array['install:' || install_id::text, 'network:' || network_bucket, 'global'] loop
    bucket_limit := case when bucket_name = 'global' then 100000 when bucket_name like 'network:%' then 10000 else 2000 end;
    insert into owlio_private.rate_buckets as r(bucket, day, events)
      values (bucket_name || ':' || current_day, current_day, batch_size)
      on conflict (bucket) do update set events = r.events + excluded.events
      where r.events + excluded.events <= bucket_limit;
    if not found then raise exception 'Usage rate limited'; end if;
  end loop;
  insert into owlio_private.installations as i(id, credential_hash) values (install_id, credential_hash)
    on conflict (id) do update set last_seen = now() where i.credential_hash = excluded.credential_hash;
  if not found then raise exception 'Invalid installation credential'; end if;
  with inserted as (
    insert into owlio_private.usage_events(id, installation_id, event, occurred_at, properties)
      select (e->>'id')::uuid, install_id, e->>'event', (e->>'timestamp')::timestamptz, e->'properties'
      from jsonb_array_elements(batch) e
      on conflict (id) do nothing returning id
  ) select coalesce(jsonb_agg(id), '[]'::jsonb) into accepted from inserted;
  insert into owlio_private.maintenance as m(singleton, cleaned_at) values (true, now())
    on conflict (singleton) do update set cleaned_at = now() where m.cleaned_at < now() - interval '1 day';
  if found then perform public.owlio_purge_usage(); end if;
  return accepted;
end;
$$;
revoke all on function public.owlio_ingest_usage(uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.owlio_ingest_usage(uuid,text,text,jsonb) to service_role;

create function public.owlio_admin_metrics(period_days integer default 30)
returns jsonb language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare
  report jsonb;
begin
  -- Role comes from an owner-managed table, never signup metadata or a client flag.
  if auth.uid() is null or not exists (select 1 from owlio_private.administrators where user_id = auth.uid()) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if period_days not in (7,30,90) then raise exception 'Invalid reporting period'; end if;
  with events as (
    select * from owlio_private.usage_events
    where occurred_at >= current_date - (period_days - 1) and occurred_at <= now()
  ), days as (
    select generate_series(current_date - (period_days - 1), current_date, interval '1 day')::date as day
  ), daily as (
    select day, count(distinct installation_id) as active,
      count(*) filter (where event='dictation_completed') as dictations,
      count(*) filter (where event='dictation_failed') as failures
    from days left join events on occurred_at::date = day group by day order by day
  ), stages as (
    select properties->>'stage' as stage, count(*) as total,
      count(*) filter (where event='stage_failed') as failed,
      round(avg((properties->>'duration_ms')::numeric)) as "averageMs"
    from events where event in ('stage_completed','stage_failed') and properties ? 'stage' group by properties->>'stage'
  ), models as (
    select properties->>'model' as model, count(*) as count from events
    where event='dictation_completed' and properties ? 'model' group by properties->>'model' order by count(*) desc
  ), languages as (
    select properties->>'language' as language, count(*) as count from events
    where event='dictation_completed' and properties ? 'language' group by properties->>'language' order by count(*) desc
  ), versions as (
    select properties->>'version' as version, count(distinct installation_id) as count from events
    where properties ? 'version' group by properties->>'version' order by count(distinct installation_id) desc
  ) select jsonb_build_object(
    'days', period_days,
    'installations', (select count(*) from owlio_private.installations where last_seen >= now()-interval '90 days'),
    'activeToday', (select count(distinct installation_id) from events where occurred_at::date=current_date),
    'activeInPeriod', (select count(distinct installation_id) from events),
    'accounts', (select count(*) from auth.users),
    'successfulDictations', (select count(*) from events where event='dictation_completed'),
    'failedDictations', (select count(*) from events where event='dictation_failed'),
    'audioMinutes', (select coalesce(round(sum((properties->>'audio_seconds')::numeric)/60,1),0) from events where event='dictation_completed'),
    'words', (select coalesce(sum((properties->>'words')::numeric),0) from events where event='dictation_completed'),
    'setupCompletions', (select count(distinct installation_id) from events where event='setup_completed'),
    'activatedInstallations', (select count(distinct installation_id) from events where event='dictation_completed'),
    'daily', (select coalesce(jsonb_agg(to_jsonb(daily)), '[]'::jsonb) from daily),
    'stages', (select coalesce(jsonb_agg(to_jsonb(stages)), '[]'::jsonb) from stages),
    'models', (select coalesce(jsonb_agg(to_jsonb(models)), '[]'::jsonb) from models),
    'languages', (select coalesce(jsonb_agg(to_jsonb(languages)), '[]'::jsonb) from languages),
    'versions', (select coalesce(jsonb_agg(to_jsonb(versions)), '[]'::jsonb) from versions)
  ) into report;
  return report;
end;
$$;
revoke all on function public.owlio_admin_metrics(integer) from public, anon;
grant execute on function public.owlio_admin_metrics(integer) to authenticated;
