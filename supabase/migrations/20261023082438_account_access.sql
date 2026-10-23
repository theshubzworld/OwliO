-- Account suspension is separate from telemetry consent and future billing.
-- Guests remain allowed. No plans, charges or payment enforcement are enabled.
create table owlio_private.account_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  blocked boolean not null default false,
  reason text not null default '' check (length(reason) <= 200),
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users(id) on delete set null
);
create table owlio_private.access_audit (
  id bigint generated always as identity primary key,
  target_user uuid references auth.users(id) on delete set null,
  administrator uuid references auth.users(id) on delete set null,
  blocked boolean not null,
  reason text not null check (length(reason) <= 200),
  changed_at timestamptz not null default now()
);
create index account_access_changed_by on owlio_private.account_access(changed_by);
create index access_audit_target on owlio_private.access_audit(target_user);
create index access_audit_administrator on owlio_private.access_audit(administrator);
create index access_audit_changed_at on owlio_private.access_audit(changed_at);
alter table owlio_private.account_access enable row level security;
alter table owlio_private.access_audit enable row level security;
revoke all on owlio_private.account_access, owlio_private.access_audit from public, anon, authenticated;

create function public.owlio_account_access() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in required' using errcode='42501'; end if;
  select jsonb_build_object('blocked', blocked, 'reason', reason) into result
    from owlio_private.account_access where user_id=auth.uid();
  return coalesce(result, '{"blocked":false,"reason":""}'::jsonb);
end;
$$;
revoke all on function public.owlio_account_access() from public, anon;
grant execute on function public.owlio_account_access() to authenticated;

create function public.owlio_admin_accounts(search_text text default '', page_number integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from owlio_private.administrators where user_id=auth.uid()) then
    raise exception 'Administrator access required' using errcode='42501';
  end if;
  if search_text is null or length(search_text)>100 or page_number is null or page_number not between 0 and 2000 then raise exception 'Invalid account search'; end if;
  select coalesce(jsonb_agg(to_jsonb(accounts)), '[]'::jsonb) into result from (
    select u.id, u.email, u.created_at as "createdAt", u.last_sign_in_at as "lastSignInAt",
      coalesce(a.blocked,false) as blocked, coalesce(a.reason,'') as reason,
      exists(select 1 from owlio_private.administrators where user_id=u.id) as administrator
    from auth.users u left join owlio_private.account_access a on a.user_id=u.id
    where search_text='' or position(lower(search_text) in lower(coalesce(u.email,'')))>0 or u.id::text=search_text
    order by u.created_at desc, u.id limit 50 offset page_number*50
  ) accounts;
  return result;
end;
$$;
revoke all on function public.owlio_admin_accounts(text,integer) from public, anon;
grant execute on function public.owlio_admin_accounts(text,integer) to authenticated;

create function public.owlio_admin_set_access(target_user uuid, is_blocked boolean, block_reason text default '')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists(select 1 from owlio_private.administrators where user_id=auth.uid()) then
    raise exception 'Administrator access required' using errcode='42501';
  end if;
  if is_blocked is null or block_reason is null or length(block_reason)>200 then raise exception 'Invalid access change'; end if;
  if not exists(select 1 from auth.users where id=target_user) then raise exception 'Account not found'; end if;
  if is_blocked and exists(select 1 from owlio_private.administrators where user_id=target_user) then
    raise exception 'Administrator accounts cannot be suspended';
  end if;
  insert into owlio_private.account_access(user_id,blocked,reason,changed_by)
    values(target_user,is_blocked,case when is_blocked then trim(block_reason) else '' end,auth.uid())
    on conflict(user_id) do update set blocked=excluded.blocked,reason=excluded.reason,changed_at=now(),changed_by=auth.uid();
  insert into owlio_private.access_audit(target_user,administrator,blocked,reason)
    values(target_user,auth.uid(),is_blocked,case when is_blocked then trim(block_reason) else '' end);
end;
$$;
revoke all on function public.owlio_admin_set_access(uuid,boolean,text) from public, anon;
grant execute on function public.owlio_admin_set_access(uuid,boolean,text) to authenticated;
