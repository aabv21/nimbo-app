-- The signals the hourly monitor computes, one row per cause key, read by their owner (Today's pressure row,
-- the companion's get_signals). Clients never write it (docs/database.md#signals).

create table public.signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('long_attack', 'overuse_limit', 'debrief_due', 'overuse_warn', 'short_sleep', 'pressure', 'quiet_tracker')),
  cause text not null check (char_length(cause) between 1 and 120),
  cause_key text not null check (char_length(cause_key) between 1 and 160),
  local_date date not null,
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  computed_at timestamptz not null default now(),
  pushed_at timestamptz,
  -- A cause key is stored, and so pushed, at most once per user.
  unique (user_id, cause_key)
);

comment on table public.signals is
  'Signals computed by the monitor (service role), one per cause key; the owner reads them, no client writes.';

-- The push cap and the 24-hour cause rule read a user's pushed rows; Today and get_signals read one day.
create index signals_user_pushed_idx on public.signals (user_id, pushed_at) where pushed_at is not null;
create index signals_user_date_idx on public.signals (user_id, local_date);

alter table public.signals enable row level security;

create policy "signals_select_own" on public.signals
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.signals from anon, authenticated;
grant select on public.signals to authenticated;
