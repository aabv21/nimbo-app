-- The AI quotas: one counter per user, day and kind, spent only through consume_quota by the Edge
-- Functions (service role). No policy and no grant: a client can neither read nor write a counter.

create type public.quota_kind as enum ('companion', 'dictation');

create table public.usage_counters (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  kind public.quota_kind not null,
  count integer not null check (count >= 0),
  primary key (user_id, day, kind)
);

alter table public.usage_counters enable row level security;

revoke all on public.usage_counters from anon, authenticated;

-- The quota resets at the user's local midnight: the app sends its local day, counted as given when
-- within one day of the UTC date (every time zone is), else on the UTC day. The day is a counter key,
-- not a stored time, so it takes this rule rather than private.client_time.
-- NOTE: changing the device date can spread one user's calls over up to 3 day counters in 24 h; acceptable at these limits; upgrade: count on profiles.timezone's day once every profile has one.
create function public.consume_quota(p_user_id uuid, p_kind public.quota_kind, p_limit integer, p_day date)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_utc_day date := (pg_catalog.now() at time zone 'utc')::date;
  v_day date;
  v_written boolean;
begin
  if p_limit is null or p_limit < 1 then
    return false;
  end if;

  v_day := case when p_day between v_utc_day - 1 and v_utc_day + 1 then p_day else v_utc_day end;

  insert into public.usage_counters (user_id, day, kind, count)
  values (p_user_id, v_day, p_kind, 1)
  on conflict (user_id, day, kind) do update
    set count = public.usage_counters.count + 1
    where public.usage_counters.count < p_limit
  returning true into v_written;

  return coalesce(v_written, false);
end;
$$;

revoke execute on function public.consume_quota(uuid, public.quota_kind, integer, date) from public, anon, authenticated;
grant execute on function public.consume_quota(uuid, public.quota_kind, integer, date) to service_role;
