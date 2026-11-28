-- Profile changes for onboarding: the four approved priorities, an opt-in for period tracking, a
-- catalog check on known_triggers, and the RPC that finishes onboarding once both gates are answered.

-- Every row is null today, so the narrower check cannot reject existing data.
alter table public.profiles drop constraint profiles_priority_check;
alter table public.profiles
  add constraint profiles_priority_check check (priority in ('fewer', 'triggers', 'overuse', 'logging'));

alter table public.profiles add column track_period boolean not null default false;

alter table public.profiles
  add constraint profiles_known_triggers_check check (public.is_catalog_subset(known_triggers, 'triggers'));

grant update (track_period) on public.profiles to authenticated;

create function public.complete_onboarding()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  update public.profiles
  set onboarding_completed_at = coalesce(onboarding_completed_at, pg_catalog.now())
  where user_id = (select auth.uid())
    and boundary_accepted_at is not null
    and ai_consent_answered_at is not null;

  if not found then
    raise exception 'consent gates are not complete' using errcode = '22023';
  end if;
end;
$$;

revoke execute on function public.complete_onboarding() from public, anon;
grant execute on function public.complete_onboarding() to authenticated;
