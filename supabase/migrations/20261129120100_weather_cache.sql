-- The pressure forecast cache, one row per coarse cell and UTC hour, and the daily prune of the server-only
-- caches and of pg_cron's run history (docs/database.md#pressure-forecast-cache).

-- In `pg_catalog` as Supabase's Cron docs show (its objects live in `cron`); schedules are in GMT.
create extension if not exists pg_cron with schema pg_catalog;

-- Only what the prune (security definer, owned by postgres) reads and deletes.
grant usage on schema cron to postgres;
grant select on cron.job to postgres;
grant select, delete on cron.job_run_details to postgres;

-- A shared cache, never per user: no user id, and the key is the one-decimal cell (about 11 km).
create table public.weather_cache (
  location_key text not null check (location_key ~ '^-?[0-9]{1,2}\.[0-9],-?[0-9]{1,3}\.[0-9]$'),
  fetched_at timestamptz not null default now(),
  payload jsonb not null,
  primary key (location_key, fetched_at)
);

comment on table public.weather_cache is
  'Hourly pressure forecasts per one-decimal cell, written and read only by the Edge Functions (service role).';

-- RLS on with no policy, and no client grant: only the service role reads or writes it.
alter table public.weather_cache enable row level security;

revoke all on public.weather_cache from anon, authenticated;

-- Each later migration that adds a cache redefines this function with its own delete added.
create function public.prune_expired_caches()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The functions read a forecast for 3 hours at most.
  delete from public.weather_cache
  where fetched_at < pg_catalog.now() - interval '2 days';

  -- pg_cron never deletes run history; Nimbo's jobs keep a week of it.
  delete from cron.job_run_details d
  using cron.job j
  where j.jobid = d.jobid
    and j.jobname in ('prune-expired-caches', 'monitor')
    and coalesce(d.end_time, d.start_time) < pg_catalog.now() - interval '7 days';
end;
$$;

alter function public.prune_expired_caches() owner to postgres;

comment on function public.prune_expired_caches() is
  'Deletes cache rows past their lifetime and a week-old run history of Nimbo''s jobs. '
  'Run daily by the pg_cron job prune-expired-caches; no client grants.';

revoke execute on function public.prune_expired_caches() from public, anon, authenticated;

-- Scheduling under an existing job name replaces that job.
select cron.schedule('prune-expired-caches', '17 3 * * *', 'select public.prune_expired_caches()');
