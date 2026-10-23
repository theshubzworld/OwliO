-- Schedule cleanup even when clients stop reporting. Local test engines that do
-- not provide pg_cron keep the purge function and can schedule it externally.
do $setup$
begin
  if not exists(select 1 from pg_available_extensions where name='pg_cron') then
    raise notice 'pg_cron unavailable: schedule public.owlio_purge_usage externally';
    return;
  end if;
  execute 'create extension if not exists pg_cron';
  execute $schedule$select cron.schedule('owlio-retention', '0 3 * * *', $job$
    select public.owlio_purge_usage();
    delete from owlio_private.access_audit where changed_at < now() - interval '90 days';
  $job$)$schedule$;
end;
$setup$;
