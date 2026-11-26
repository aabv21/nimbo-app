-- Profiles: one row per auth user, with the settings and the consent state. Consent columns change
-- only through the two RPCs below, which stamp them with the server clock.

create type public.app_language as enum ('en', 'es', 'pt');
create type public.app_theme as enum ('day', 'dim');

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  condition text not null default 'migraine' check (condition in ('migraine')),
  language public.app_language,
  timezone text check (timezone is null or char_length(timezone) between 1 and 64),
  theme public.app_theme not null default 'day',
  reduce_motion boolean not null default false,
  notify_start time not null default '08:00',
  notify_end time not null default '21:00',
  notify_daily_cap smallint not null default 2 check (notify_daily_cap between 0 and 2),
  lock_screen_detail boolean not null default false,
  coarse_lat numeric(4,1) check (coarse_lat between -90 and 90),
  coarse_lon numeric(4,1) check (coarse_lon between -180 and 180),
  known_triggers text[] not null default '{}',
  priority text check (priority in ('triggers', 'doctor', 'medication', 'patterns')),
  adult_confirmed_at timestamptz,
  boundary_accepted_at timestamptz,
  ai_consent_answered_at timestamptz,
  ai_enabled boolean not null default false,
  ai_consent_at timestamptz,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.profiles is 'One profile row per auth.users row, created by handle_new_user().';

alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "profiles_update_own" on public.profiles
  for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Start from nothing: the default grants would let a client insert, delete and update every column.
-- There is no insert or delete policy either, so the signup trigger is the only writer of new rows.
revoke all on public.profiles from anon, authenticated;

grant select on public.profiles to authenticated;

grant update (
  language, timezone, theme, reduce_motion, notify_start, notify_end, notify_daily_cap,
  lock_screen_detail, coarse_lat, coarse_lon, known_triggers, priority
) on public.profiles to authenticated;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- Both confirmations are required, so a half-accepted state never exists. Stamped once, with the
-- server clock: a repeat call keeps the first timestamps.
create function public.accept_terms(p_adult boolean, p_boundary boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_adult is not true or p_boundary is not true then
    raise exception 'both confirmations are required' using errcode = '22023';
  end if;

  update public.profiles
  set adult_confirmed_at = coalesce(adult_confirmed_at, pg_catalog.now()),
      boundary_accepted_at = coalesce(boundary_accepted_at, pg_catalog.now())
  where user_id = (select auth.uid());
end;
$$;

revoke execute on function public.accept_terms(boolean, boolean) from public, anon;
grant execute on function public.accept_terms(boolean, boolean) to authenticated;

-- Answering is recorded apart from the answer, so a "no" is remembered and the question is not
-- asked again. Declining clears the consent time.
create function public.set_ai_consent(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_enabled is null then
    raise exception 'an answer is required' using errcode = '22023';
  end if;

  update public.profiles
  set ai_consent_answered_at = pg_catalog.now(),
      ai_enabled = p_enabled,
      ai_consent_at = case when p_enabled then pg_catalog.now() end
  where user_id = (select auth.uid());
end;
$$;

revoke execute on function public.set_ai_consent(boolean) from public, anon;
grant execute on function public.set_ai_consent(boolean) to authenticated;
