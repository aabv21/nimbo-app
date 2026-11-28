-- Account data: usage counters are kept 30 days, and save_signals tolerates an account deleted mid-run. Export and deletion
-- need no table of their own: every user table cascades from auth.users (docs/database.md#account-deletion-and-export).

-- Every statement but the last is unchanged from 20261129120400_monitor.sql.
create or replace function public.prune_expired_caches()
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

  delete from public.push_claims
  where expires_at < pg_catalog.now();

  -- push-claim's limits look back one hour.
  delete from public.push_claim_starts
  where started_at < pg_catalog.now() - interval '1 hour';

  -- A signal that still holds is recomputed every hour, so a row 30 days stale is a key that cannot come back (its date,
  -- month, attack or stage has passed). The exception is each user's newest pushed quiet stretch: it keeps quiet:never
  -- from pushing that stretch again once its last check-in leaves the records' window.
  delete from public.signals s
  where s.computed_at < pg_catalog.now() - interval '30 days'
    and not (
      s.kind = 'quiet_tracker'
      and s.pushed_at is not null
      and not exists (
        select 1 from public.signals newer
        where newer.user_id = s.user_id and newer.kind = 'quiet_tracker' and newer.pushed_at > s.pushed_at
      )
    );

  -- A receipt is read within 24 hours or not at all.
  delete from public.push_tickets
  where created_at < pg_catalog.now() - interval '2 days';

  -- A quota counts one day (the user's local day, within a day of UTC); a month of counts is all the export shows.
  delete from public.usage_counters
  where day < (pg_catalog.now() at time zone 'utc')::date - 30;
end;
$$;

comment on function public.prune_expired_caches() is
  'Deletes cache rows past their lifetime, expired push claims, claim starts over an hour old, signals 30 days stale '
  '(but each user''s newest pushed quiet stretch), push tickets over 2 days old, usage counters over 30 days old and a '
  'week-old run history of Nimbo''s jobs. Run daily by the pg_cron job prune-expired-caches; no client grants.';

-- The monitor reads its targets once, so an account deleted mid-run still reaches save_signals: its signals would break
-- the foreign key, and the run would count a failure. A user who is gone has nothing to save, so that answers no rows;
-- any other foreign key error still raises. Unchanged from 20261129120400_monitor.sql but for the exception block.
create or replace function public.save_signals(p_user_id uuid, p_local_date date, p_signals jsonb)
returns table (cause_key text, cause text, pushed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_keys text[];
  v_constraint text;
begin
  if p_user_id is null or p_local_date is null or p_signals is null or pg_catalog.jsonb_typeof(p_signals) <> 'array' then
    raise exception using errcode = '22023', message = 'save_signals: a user, a local date and an array of signals';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('signals:' || p_user_id::text, 0));

  select coalesce(pg_catalog.array_agg(s ->> 'causeKey'), '{}') into v_keys
  from pg_catalog.jsonb_array_elements(p_signals) s;

  begin
    insert into public.signals (user_id, kind, cause, cause_key, local_date, evidence, computed_at)
    select distinct on (s ->> 'causeKey')
           p_user_id, s ->> 'kind', s ->> 'cause', s ->> 'causeKey', p_local_date, s -> 'evidence', pg_catalog.now()
    from pg_catalog.jsonb_array_elements(p_signals) s
    order by s ->> 'causeKey'
    on conflict (user_id, cause_key) do update
      set kind = excluded.kind,
          cause = excluded.cause,
          local_date = excluded.local_date,
          evidence = excluded.evidence,
          computed_at = excluded.computed_at;
  exception
    when foreign_key_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'signals_user_id_fkey' then
        raise;
      end if;
      return;
  end;

  delete from public.signals sg
  where sg.user_id = p_user_id
    and sg.pushed_at is null
    and not (sg.cause_key = any (v_keys));

  return query
    select sg.cause_key, sg.cause, sg.pushed_at
    from public.signals sg
    where sg.user_id = p_user_id
      and sg.pushed_at is not null
      and (sg.pushed_at > pg_catalog.now() - interval '48 hours' or sg.cause_key = any (v_keys) or sg.kind = 'quiet_tracker')
    order by sg.pushed_at, sg.cause_key;
end;
$$;
