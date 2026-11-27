-- Tracking: episodes, medications, doses and check-ins. Clients read their own rows; every write
-- goes through an RPC, and each create is keyed by a client-made uuid so retries are safe.

create type public.episode_source as enum ('manual', 'voice', 'chat');
create type public.medication_kind as enum ('preventive', 'acute');
create type public.medication_form as enum ('oral', 'injection', 'nasal', 'other');
create type public.medication_class as enum (
  'simple_analgesic', 'triptan', 'ergot', 'opioid', 'combination_analgesic', 'gepant', 'other'
);
create type public.medication_schedule as enum ('daily', 'monthly', 'quarterly');
create type public.sleep_band as enum ('lt5', '5_6', '6_7', '7_8', 'gt8');
create type public.sleep_quality as enum ('bad', 'ok', 'good');
create type public.stress_level as enum ('low', 'mid', 'high');

-- Catalog helpers. The key list is generated from the TypeScript condition pack (`pnpm catalog:sql`);
-- a test compares it with the pack. They are granted to `authenticated` because a check constraint
-- runs as the writing role, and profiles.known_triggers is still written directly by the client.
create or replace function public.catalog_keys(p_catalog text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_catalog
    when 'painAreas' then array['forehead', 'temple_left', 'temple_right', 'eye_left', 'eye_right', 'face', 'crown', 'back_left', 'back_right', 'neck']::text[]
    when 'symptoms' then array['aura_visual', 'light_sensitivity', 'sound_sensitivity', 'smell_sensitivity', 'nausea', 'vomiting', 'dizziness', 'numbness_tingling', 'neck_stiffness', 'brain_fog', 'fatigue']::text[]
    when 'triggers' then array['caffeine', 'alcohol', 'stress', 'short_sleep', 'oversleep', 'dehydration', 'skipped_meal', 'food', 'screens', 'weather', 'hormones', 'bright_light', 'strong_smell', 'loud_noise', 'exertion', 'travel']::text[]
    when 'reliefs' then array['medication', 'sleep', 'water', 'cold_pack', 'heat', 'dark_room', 'caffeine', 'massage', 'meditation', 'fresh_air']::text[]
  end;
$$;

create function public.is_catalog_subset(p_values text[], p_catalog text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_values operator(pg_catalog.<@) public.catalog_keys(p_catalog)
    and pg_catalog.cardinality(p_values) = (select pg_catalog.count(distinct v) from pg_catalog.unnest(p_values) as v),
    false
  );
$$;

revoke execute on function public.catalog_keys(text), public.is_catalog_subset(text[], text) from public, anon;
grant execute on function public.catalog_keys(text), public.is_catalog_subset(text[], text) to authenticated;

-- Internal helpers live in a schema the API does not expose.
create schema private;
revoke all on schema private from public, anon, authenticated;

create function private.check_keys(p_fields jsonb, p_allowed text[])
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
begin
  if p_fields is null or pg_catalog.jsonb_typeof(p_fields) <> 'object' then
    raise exception 'fields must be a json object' using errcode = '22023';
  end if;
  for v_key in select pg_catalog.jsonb_object_keys(p_fields) loop
    if v_key <> all (p_allowed) then
      raise exception 'unknown field: %', v_key using errcode = '22023';
    end if;
  end loop;
end;
$$;

-- A phone clock can be wrong, but not by hours: this keeps a future or pre-2000 time out.
create function private.check_time(p_at timestamptz)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_at is null or p_at > pg_catalog.now() + interval '5 minutes' or p_at < timestamptz '2000-01-01 00:00:00+00' then
    raise exception 'time out of range' using errcode = '22023';
  end if;
end;
$$;

create function private.to_text_array(p_value jsonb)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or pg_catalog.jsonb_typeof(p_value) = 'null' then
    return '{}';
  end if;
  if pg_catalog.jsonb_typeof(p_value) <> 'array' then
    raise exception 'an array is required' using errcode = '22023';
  end if;
  return array(select pg_catalog.jsonb_array_elements_text(p_value));
end;
$$;

revoke execute on function private.check_keys(jsonb, text[]), private.check_time(timestamptz), private.to_text_array(jsonb) from public, anon, authenticated;

create table public.episodes (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  condition text not null default 'migraine' check (condition in ('migraine')),
  started_at timestamptz not null,
  ended_at timestamptz,
  intensity smallint check (intensity between 0 and 10),
  pain_areas text[] not null default '{}' check (public.is_catalog_subset(pain_areas, 'painAreas')),
  symptoms text[] not null default '{}' check (public.is_catalog_subset(symptoms, 'symptoms')),
  triggers text[] not null default '{}' check (public.is_catalog_subset(triggers, 'triggers')),
  reliefs text[] not null default '{}' check (public.is_catalog_subset(reliefs, 'reliefs')),
  notes text check (char_length(notes) <= 2000),
  source public.episode_source not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at >= started_at)
);

create table public.medications (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80 and name = btrim(name)),
  kind public.medication_kind not null,
  form public.medication_form not null default 'oral',
  class public.medication_class not null,
  dose_text text check (char_length(dose_text) <= 120),
  min_interval_minutes integer check (min_interval_minutes between 15 and 4320),
  schedule public.medication_schedule,
  schedule_time time,
  schedule_anchor date,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind = 'preventive' or schedule is null),
  check (schedule is null or schedule_time is not null),
  check (schedule is null or schedule not in ('monthly', 'quarterly') or schedule_anchor is not null)
);

create table public.doses (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  medication_id uuid not null references public.medications (id),
  episode_id uuid references public.episodes (id) on delete set null,
  taken_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.checkins (
  user_id uuid not null references auth.users (id) on delete cascade,
  local_date date not null,
  sleep_band public.sleep_band,
  sleep_quality public.sleep_quality,
  stress public.stress_level,
  low_water boolean not null default false,
  extra_caffeine boolean not null default false,
  alcohol boolean not null default false,
  skipped_meal boolean not null default false,
  screen_heavy boolean not null default false,
  period_started boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, local_date)
);

create index episodes_user_started_idx on public.episodes (user_id, started_at desc);
create index medications_user_idx on public.medications (user_id);
create index doses_user_taken_idx on public.doses (user_id, taken_at desc);
create index doses_episode_idx on public.doses (episode_id);
create index doses_medication_idx on public.doses (medication_id);

create trigger episodes_set_updated_at before update on public.episodes
  for each row execute function public.set_updated_at();
create trigger medications_set_updated_at before update on public.medications
  for each row execute function public.set_updated_at();
create trigger doses_set_updated_at before update on public.doses
  for each row execute function public.set_updated_at();
create trigger checkins_set_updated_at before update on public.checkins
  for each row execute function public.set_updated_at();

alter table public.episodes enable row level security;
alter table public.medications enable row level security;
alter table public.doses enable row level security;
alter table public.checkins enable row level security;

create policy "episodes_select_own" on public.episodes
  for select to authenticated using (user_id = (select auth.uid()));
create policy "medications_select_own" on public.medications
  for select to authenticated using (user_id = (select auth.uid()));
create policy "doses_select_own" on public.doses
  for select to authenticated using (user_id = (select auth.uid()));
create policy "checkins_select_own" on public.checkins
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.episodes, public.medications, public.doses, public.checkins from anon, authenticated;
grant select on public.episodes, public.medications, public.doses, public.checkins to authenticated;

-- RPCs. Each one is security definer, so it filters by the caller itself (the owner role skips RLS).

create function public.log_episode(p_id uuid, p_started_at timestamptz, p_fields jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  perform private.check_keys(p_fields, array['ended_at', 'intensity', 'pain_areas', 'symptoms', 'triggers', 'reliefs', 'notes', 'source']);
  perform private.check_time(p_started_at);
  if p_fields ->> 'ended_at' is not null then
    perform private.check_time((p_fields ->> 'ended_at')::timestamptz);
  end if;

  insert into public.episodes (id, user_id, started_at, ended_at, intensity, pain_areas, symptoms, triggers, reliefs, notes, source)
  values (
    p_id, v_user, p_started_at,
    (p_fields ->> 'ended_at')::timestamptz,
    (p_fields ->> 'intensity')::smallint,
    private.to_text_array(p_fields -> 'pain_areas'),
    private.to_text_array(p_fields -> 'symptoms'),
    private.to_text_array(p_fields -> 'triggers'),
    private.to_text_array(p_fields -> 'reliefs'),
    p_fields ->> 'notes',
    coalesce((p_fields ->> 'source')::public.episode_source, 'manual')
  )
  on conflict (id) do nothing;
end;
$$;

create function public.update_episode(p_id uuid, p_fields jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  perform private.check_keys(p_fields, array['ended_at', 'intensity', 'pain_areas', 'symptoms', 'triggers', 'reliefs', 'notes', 'source']);
  if p_fields ->> 'ended_at' is not null then
    perform private.check_time((p_fields ->> 'ended_at')::timestamptz);
  end if;

  update public.episodes
  set ended_at = case when p_fields ? 'ended_at' then (p_fields ->> 'ended_at')::timestamptz else ended_at end,
      intensity = case when p_fields ? 'intensity' then (p_fields ->> 'intensity')::smallint else intensity end,
      pain_areas = case when p_fields ? 'pain_areas' then private.to_text_array(p_fields -> 'pain_areas') else pain_areas end,
      symptoms = case when p_fields ? 'symptoms' then private.to_text_array(p_fields -> 'symptoms') else symptoms end,
      triggers = case when p_fields ? 'triggers' then private.to_text_array(p_fields -> 'triggers') else triggers end,
      reliefs = case when p_fields ? 'reliefs' then private.to_text_array(p_fields -> 'reliefs') else reliefs end,
      notes = case when p_fields ? 'notes' then p_fields ->> 'notes' else notes end,
      source = case when p_fields ? 'source' then (p_fields ->> 'source')::public.episode_source else source end
  where id = p_id and user_id = v_user;

  if not found then
    raise exception 'episode not found' using errcode = 'P0002';
  end if;
end;
$$;

create function public.end_episode(p_id uuid, p_ended_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  perform private.check_time(p_ended_at);

  update public.episodes set ended_at = p_ended_at where id = p_id and user_id = v_user;

  if not found then
    raise exception 'episode not found' using errcode = 'P0002';
  end if;
end;
$$;

create function public.delete_episode(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  delete from public.episodes where id = p_id and user_id = v_user;
end;
$$;

-- Patch when the row exists, insert when it does not, so `{"archived": true}` alone works. An id that
-- belongs to someone else matches neither branch and reads as not found.
create function public.save_medication(p_id uuid, p_fields jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_archived boolean;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  perform private.check_keys(p_fields, array[
    'name', 'kind', 'form', 'class', 'dose_text', 'min_interval_minutes',
    'schedule', 'schedule_time', 'schedule_anchor', 'archived'
  ]);
  v_archived := (p_fields ->> 'archived')::boolean;

  update public.medications
  set name = case when p_fields ? 'name' then p_fields ->> 'name' else name end,
      kind = case when p_fields ? 'kind' then (p_fields ->> 'kind')::public.medication_kind else kind end,
      form = case when p_fields ? 'form' then (p_fields ->> 'form')::public.medication_form else form end,
      class = case when p_fields ? 'class' then (p_fields ->> 'class')::public.medication_class else class end,
      dose_text = case when p_fields ? 'dose_text' then p_fields ->> 'dose_text' else dose_text end,
      min_interval_minutes = case when p_fields ? 'min_interval_minutes' then (p_fields ->> 'min_interval_minutes')::integer else min_interval_minutes end,
      schedule = case when p_fields ? 'schedule' then (p_fields ->> 'schedule')::public.medication_schedule else schedule end,
      schedule_time = case when p_fields ? 'schedule_time' then (p_fields ->> 'schedule_time')::time else schedule_time end,
      schedule_anchor = case when p_fields ? 'schedule_anchor' then (p_fields ->> 'schedule_anchor')::date else schedule_anchor end,
      archived_at = case
        when not (p_fields ? 'archived') then archived_at
        when v_archived then coalesce(archived_at, pg_catalog.now())
      end
  where id = p_id and user_id = v_user;

  if found then
    return;
  end if;
  -- Checked before the insert so a half-filled call for someone else's id is not a 23502.
  if exists (select 1 from public.medications where id = p_id) then
    raise exception 'medication not found' using errcode = 'P0002';
  end if;

  insert into public.medications (id, user_id, name, kind, form, class, dose_text, min_interval_minutes, schedule, schedule_time, schedule_anchor, archived_at)
  values (
    p_id, v_user,
    p_fields ->> 'name',
    (p_fields ->> 'kind')::public.medication_kind,
    coalesce((p_fields ->> 'form')::public.medication_form, 'oral'),
    (p_fields ->> 'class')::public.medication_class,
    p_fields ->> 'dose_text',
    (p_fields ->> 'min_interval_minutes')::integer,
    (p_fields ->> 'schedule')::public.medication_schedule,
    (p_fields ->> 'schedule_time')::time,
    (p_fields ->> 'schedule_anchor')::date,
    case when v_archived then pg_catalog.now() end
  )
  on conflict (id) do nothing;

  if not found then
    raise exception 'medication not found' using errcode = 'P0002';
  end if;
end;
$$;

create function public.log_dose(p_id uuid, p_medication_id uuid, p_taken_at timestamptz, p_episode_id uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  perform private.check_time(p_taken_at);
  if not exists (select 1 from public.medications where id = p_medication_id and user_id = v_user) then
    raise exception 'medication not found' using errcode = 'P0002';
  end if;
  if p_episode_id is not null and not exists (select 1 from public.episodes where id = p_episode_id and user_id = v_user) then
    raise exception 'episode not found' using errcode = 'P0002';
  end if;

  insert into public.doses (id, user_id, medication_id, episode_id, taken_at)
  values (p_id, v_user, p_medication_id, p_episode_id, p_taken_at)
  on conflict (id) do nothing;
end;
$$;

create function public.delete_dose(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  delete from public.doses where id = p_id and user_id = v_user;
end;
$$;

-- The date is the user's local day, so it may be a day ahead of UTC (and a day behind it).
create function public.save_checkin(p_local_date date, p_fields jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  perform private.check_keys(p_fields, array[
    'sleep_band', 'sleep_quality', 'stress', 'low_water', 'extra_caffeine',
    'alcohol', 'skipped_meal', 'screen_heavy', 'period_started'
  ]);
  if p_local_date is null
    or p_local_date > (pg_catalog.now() at time zone 'utc')::date + 1
    or p_local_date < date '2000-01-01' then
    raise exception 'date out of range' using errcode = '22023';
  end if;

  insert into public.checkins (
    user_id, local_date, sleep_band, sleep_quality, stress,
    low_water, extra_caffeine, alcohol, skipped_meal, screen_heavy, period_started
  )
  values (
    v_user, p_local_date,
    (p_fields ->> 'sleep_band')::public.sleep_band,
    (p_fields ->> 'sleep_quality')::public.sleep_quality,
    (p_fields ->> 'stress')::public.stress_level,
    coalesce((p_fields ->> 'low_water')::boolean, false),
    coalesce((p_fields ->> 'extra_caffeine')::boolean, false),
    coalesce((p_fields ->> 'alcohol')::boolean, false),
    coalesce((p_fields ->> 'skipped_meal')::boolean, false),
    coalesce((p_fields ->> 'screen_heavy')::boolean, false),
    coalesce((p_fields ->> 'period_started')::boolean, false)
  )
  on conflict (user_id, local_date) do update
  set sleep_band = case when p_fields ? 'sleep_band' then excluded.sleep_band else public.checkins.sleep_band end,
      sleep_quality = case when p_fields ? 'sleep_quality' then excluded.sleep_quality else public.checkins.sleep_quality end,
      stress = case when p_fields ? 'stress' then excluded.stress else public.checkins.stress end,
      low_water = case when p_fields ? 'low_water' then excluded.low_water else public.checkins.low_water end,
      extra_caffeine = case when p_fields ? 'extra_caffeine' then excluded.extra_caffeine else public.checkins.extra_caffeine end,
      alcohol = case when p_fields ? 'alcohol' then excluded.alcohol else public.checkins.alcohol end,
      skipped_meal = case when p_fields ? 'skipped_meal' then excluded.skipped_meal else public.checkins.skipped_meal end,
      screen_heavy = case when p_fields ? 'screen_heavy' then excluded.screen_heavy else public.checkins.screen_heavy end,
      period_started = case when p_fields ? 'period_started' then excluded.period_started else public.checkins.period_started end;
end;
$$;

revoke execute on function
  public.log_episode(uuid, timestamptz, jsonb),
  public.update_episode(uuid, jsonb),
  public.end_episode(uuid, timestamptz),
  public.delete_episode(uuid),
  public.save_medication(uuid, jsonb),
  public.log_dose(uuid, uuid, timestamptz, uuid),
  public.delete_dose(uuid),
  public.save_checkin(date, jsonb)
from public, anon;
grant execute on function
  public.log_episode(uuid, timestamptz, jsonb),
  public.update_episode(uuid, jsonb),
  public.end_episode(uuid, timestamptz),
  public.delete_episode(uuid),
  public.save_medication(uuid, jsonb),
  public.log_dose(uuid, uuid, timestamptz, uuid),
  public.delete_dose(uuid),
  public.save_checkin(date, jsonb)
to authenticated;
