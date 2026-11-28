-- The hourly monitor (docs/database.md#the-hourly-monitor): the profiles.timezone check, the server-only receipts
-- queue, the service-role RPCs the monitor function calls, its pg_cron job through pg_net and the Vault, and the prune.

create extension if not exists pg_net with schema extensions;

-- profiles.timezone ------------------------------------------------------------------------------

-- IANA region names (`Area/Location`) and UTC or GMT, as the tz database the server has knows them. Not a CHECK: the
-- list changes with tzdata. Abbreviations and POSIX rules (`EST`, `EST5EDT`, `UTC+3`) are in pg_timezone_names or
-- parse in AT TIME ZONE, but name no place, so they are refused; so are the `posix/` and `right/` copies.
create function private.is_time_zone(p text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p is not null
    and (p in ('UTC', 'GMT') or (p ~ '^[A-Za-z]+/[A-Za-z0-9_+/-]+$' and p !~ '^(posix|right)/'))
    and exists (select 1 from pg_catalog.pg_timezone_names where name = p)
$$;

revoke execute on function private.is_time_zone(text) from public, anon, authenticated;

-- Rows saved before the check: an unknown zone reads as none until the phone sends its zone again.
update public.profiles set timezone = null where timezone is not null and not private.is_time_zone(timezone);

-- Security definer: clients have no usage on the private schema.
create function public.profiles_check_timezone()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.timezone is not null and not private.is_time_zone(new.timezone) then
    raise exception using errcode = '22023', message = 'timezone: not an IANA zone name';
  end if;
  return new;
end;
$$;

revoke execute on function public.profiles_check_timezone() from public, anon, authenticated;

create trigger profiles_check_timezone
  before insert or update of timezone on public.profiles
  for each row execute function public.profiles_check_timezone();

-- public.push_tickets -----------------------------------------------------------------------------

-- Expo's ticket per accepted push, until its receipt is read (15 minutes to 24 hours later) and a dead token deleted.
create table public.push_tickets (
  ticket_id text primary key check (char_length(ticket_id) between 1 and 100),
  token text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.push_tickets is
  'Expo push tickets awaiting their receipt, written and read only by the monitor (service role); kept 2 days.';

create index push_tickets_created_at_idx on public.push_tickets (created_at);
create index push_tickets_user_id_idx on public.push_tickets (user_id);

alter table public.push_tickets enable row level security;

revoke all on public.push_tickets from anon, authenticated;

-- The monitor's RPCs (service role only) ----------------------------------------------------------

-- Every onboarded user with a zone, every hour: the window only decides whether to push, inside the function.
-- `known_triggers` lets the run start the forecasts its users need before it reaches them.
create function public.monitor_targets()
returns table (
  user_id uuid,
  timezone text,
  notify_start time,
  notify_end time,
  notify_daily_cap smallint,
  lock_screen_detail boolean,
  language text,
  coarse_lat numeric,
  coarse_lon numeric,
  known_triggers text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, p.timezone, p.notify_start, p.notify_end, p.notify_daily_cap, p.lock_screen_detail,
         p.language::text, p.coarse_lat, p.coarse_lon, p.known_triggers
  from public.profiles p
  where p.timezone is not null
    and p.onboarding_completed_at is not null
  order by p.user_id;
$$;

-- Upserts this hour's signals (keeping pushed_at), drops the unpushed rows that no longer hold, and answers the push
-- log decidePush reads: the last 48 hours' pushes (the cap and the 24-hour rule), every pushed key still computed (a
-- key is pushed once ever), and the pushed quiet stretches (a stretch whose last check-in left the records' window
-- comes back as quiet:never).
create function public.save_signals(p_user_id uuid, p_local_date date, p_signals jsonb)
returns table (cause_key text, cause text, pushed_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_keys text[];
begin
  if p_user_id is null or p_local_date is null or p_signals is null or pg_catalog.jsonb_typeof(p_signals) <> 'array' then
    raise exception using errcode = '22023', message = 'save_signals: a user, a local date and an array of signals';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('signals:' || p_user_id::text, 0));

  select coalesce(pg_catalog.array_agg(s ->> 'causeKey'), '{}') into v_keys
  from pg_catalog.jsonb_array_elements(p_signals) s;

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

-- The push claim: under the user's lock, so overlapping or retried runs cannot both pass, it re-checks what decidePush
-- checked (the key unpushed, the cap since local midnight, the 24-hour cause rule, a pushed quiet stretch) and that the
-- user has a token, stamps pushed_at, and answers the tokens. No row means send nothing.
create function public.claim_signal_push(p_user_id uuid, p_cause_key text, p_time_zone text, p_cap integer, p_same_cause_hours integer)
returns table (signal_id uuid, token text, language text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_id uuid;
  v_cause text;
  v_midnight timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('signals:' || p_user_id::text, 0));

  if p_cap is null or p_cap <= 0 or p_same_cause_hours is null or p_same_cause_hours < 0 or not private.is_time_zone(p_time_zone) then
    return;
  end if;

  -- A token another account registered more recently is that account's now.
  if not exists (
    select 1 from public.push_tokens t
    where t.user_id = p_user_id
      and not exists (select 1 from public.push_tokens n where n.token = t.token and n.updated_at > t.updated_at)
  ) then
    return;
  end if;

  select sg.id, sg.cause into v_id, v_cause
  from public.signals sg
  where sg.user_id = p_user_id and sg.cause_key = p_cause_key and sg.pushed_at is null;
  if v_id is null then
    return;
  end if;

  v_midnight := ((pg_catalog.now() at time zone p_time_zone)::date)::timestamp at time zone p_time_zone;
  if (select count(*) from public.signals sg where sg.user_id = p_user_id and sg.pushed_at >= v_midnight) >= p_cap then
    return;
  end if;

  if exists (
    select 1 from public.signals sg
    where sg.user_id = p_user_id and sg.cause = v_cause
      and sg.pushed_at > pg_catalog.now() - pg_catalog.make_interval(hours => p_same_cause_hours)
  ) then
    return;
  end if;

  if p_cause_key = 'quiet:never' and exists (
    select 1 from public.signals sg
    where sg.user_id = p_user_id and sg.kind = 'quiet_tracker' and sg.pushed_at is not null and sg.cause_key <> 'quiet:never'
  ) then
    return;
  end if;

  update public.signals set pushed_at = pg_catalog.now() where id = v_id;

  return query
    select v_id, t.token, p.language::text
    from public.push_tokens t
    left join public.profiles p on p.user_id = t.user_id
    where t.user_id = p_user_id
      and not exists (select 1 from public.push_tokens n where n.token = t.token and n.updated_at > t.updated_at)
    order by t.updated_at desc;
end;
$$;

create function public.save_push_tickets(p_user_id uuid, p_tickets jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_tickets is null or pg_catalog.jsonb_typeof(p_tickets) <> 'array' then
    raise exception using errcode = '22023', message = 'save_push_tickets: a user and an array of tickets';
  end if;
  insert into public.push_tickets (ticket_id, token, user_id)
  select t ->> 'id', t ->> 'token', p_user_id
  from pg_catalog.jsonb_array_elements(p_tickets) t
  on conflict (ticket_id) do nothing;
end;
$$;

-- Expo keeps a receipt for 24 hours and may not have it before 15 minutes.
create function public.push_receipts_due(p_limit integer default 1000)
returns table (ticket_id text, token text)
language sql
stable
security definer
set search_path = ''
as $$
  select k.ticket_id, k.token
  from public.push_tickets k
  where k.created_at <= pg_catalog.now() - interval '15 minutes'
    and k.created_at > pg_catalog.now() - interval '24 hours'
  order by k.created_at, k.ticket_id
  limit least(greatest(coalesce(p_limit, 1000), 0), 1000);
$$;

create function public.forget_push_tickets(p_ids text[])
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tickets where ticket_id = any (coalesce(p_ids, '{}'));
$$;

revoke execute on function public.monitor_targets() from public, anon, authenticated;
revoke execute on function public.save_signals(uuid, date, jsonb) from public, anon, authenticated;
revoke execute on function public.claim_signal_push(uuid, text, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.save_push_tickets(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.push_receipts_due(integer) from public, anon, authenticated;
revoke execute on function public.forget_push_tickets(text[]) from public, anon, authenticated;
grant execute on function public.monitor_targets() to service_role;
grant execute on function public.save_signals(uuid, date, jsonb) to service_role;
grant execute on function public.claim_signal_push(uuid, text, text, integer, integer) to service_role;
grant execute on function public.save_push_tickets(uuid, jsonb) to service_role;
grant execute on function public.push_receipts_due(integer) to service_role;
grant execute on function public.forget_push_tickets(text[]) to service_role;

-- The monitor job ---------------------------------------------------------------------------------

-- The URL and the shared secret come from the Vault (seeded locally, set by hand on the hosted project), and nothing is
-- sent without them. The warning carries only the SQLSTATE, so neither reaches the logs. pg_net stops waiting after
-- 30 s; the function runs on.
create function public.request_monitor()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'monitor_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'monitor_secret';
  if v_url is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := pg_catalog.jsonb_build_object('content-type', 'application/json', 'x-webhook-secret', v_secret),
    timeout_milliseconds := 30000
  );
exception when others then
  raise warning 'request_monitor: %', sqlstate;
end;
$$;

alter function public.request_monitor() owner to postgres;

comment on function public.request_monitor() is
  'Posts to the monitor Edge Function with the Vault URL and secret; nothing without them. '
  'Run hourly by the pg_cron job monitor; no client grants.';

revoke execute on function public.request_monitor() from public, anon, authenticated;

select cron.schedule('monitor', '5 * * * *', 'select public.request_monitor()');

-- public.prune_expired_caches(): signals and tickets ----------------------------------------------

-- The first four deletes are unchanged from 20261129120300_push_tokens.sql.
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
end;
$$;

comment on function public.prune_expired_caches() is
  'Deletes cache rows past their lifetime, expired push claims, claim starts over an hour old, signals 30 days stale '
  '(but each user''s newest pushed quiet stretch), push tickets over 2 days old and a week-old run history of Nimbo''s '
  'jobs. Run daily by the pg_cron job prune-expired-caches; no client grants.';
