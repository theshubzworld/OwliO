-- Keep privileged implementations outside exposed API schemas. Public RPCs
-- are invoker wrappers; private implementations retain UID/admin checks.
alter function public.owlio_account_access() set schema owlio_private;
alter function public.owlio_admin_metrics(integer) set schema owlio_private;
alter function public.owlio_admin_accounts(text,integer) set schema owlio_private;
alter function public.owlio_admin_set_access(uuid,boolean,text) set schema owlio_private;

grant usage on schema owlio_private to authenticated;
revoke all on function owlio_private.owlio_account_access(), owlio_private.owlio_admin_metrics(integer), owlio_private.owlio_admin_accounts(text,integer), owlio_private.owlio_admin_set_access(uuid,boolean,text) from public, anon;
grant execute on function owlio_private.owlio_account_access(), owlio_private.owlio_admin_metrics(integer), owlio_private.owlio_admin_accounts(text,integer), owlio_private.owlio_admin_set_access(uuid,boolean,text) to authenticated;

create function public.owlio_account_access() returns jsonb
language sql security invoker set search_path='' as $$select owlio_private.owlio_account_access()$$;
create function public.owlio_admin_metrics(period_days integer default 30) returns jsonb
language sql security invoker set search_path='' as $$select owlio_private.owlio_admin_metrics(period_days)$$;
create function public.owlio_admin_accounts(search_text text default '',page_number integer default 0) returns jsonb
language sql security invoker set search_path='' as $$select owlio_private.owlio_admin_accounts(search_text,page_number)$$;
create function public.owlio_admin_set_access(target_user uuid,is_blocked boolean,block_reason text default '') returns void
language sql security invoker set search_path='' as $$select owlio_private.owlio_admin_set_access(target_user,is_blocked,block_reason)$$;

revoke all on function public.owlio_account_access(), public.owlio_admin_metrics(integer), public.owlio_admin_accounts(text,integer), public.owlio_admin_set_access(uuid,boolean,text) from public, anon;
grant execute on function public.owlio_account_access(), public.owlio_admin_metrics(integer), public.owlio_admin_accounts(text,integer), public.owlio_admin_set_access(uuid,boolean,text) to authenticated;
comment on schema owlio_private is 'Not exposed through the Data API. Table grants are revoked and RLS intentionally denies all client table access; invoker RPCs call explicitly authorized private functions.';
