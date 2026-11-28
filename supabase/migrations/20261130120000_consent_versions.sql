-- Consent versions: the published texts, the version each profile accepted and the append-only history that proves
-- which text each user answered, in which language. Replaces the unversioned accept_terms and set_ai_consent.

-- The published versions. A version is the date of its text; publishing one is a new migration.
create table public.consent_texts (
  kind text not null check (kind in ('terms', 'ai')),
  version text not null check (version ~ '^\d{4}-\d{2}-\d{2}$'),
  published_at date not null,
  primary key (kind, version)
);

comment on table public.consent_texts is 'Published consent text versions; the consent RPCs refuse any other version.';

alter table public.consent_texts enable row level security;

create policy "consent_texts_select_all" on public.consent_texts
  for select
  to authenticated
  using (true);

revoke all on public.consent_texts from anon, authenticated;
grant select on public.consent_texts to authenticated;

insert into public.consent_texts (kind, version, published_at)
values ('terms', '2026-12-01', '2026-12-01'), ('ai', '2026-12-01', '2026-12-01');

-- No column grant: the table-wide select covers them, and only the two RPCs below write them.
alter table public.profiles
  add column terms_version text,
  add column ai_consent_version text;

-- The profile keeps only the latest answer; this keeps every one (grants, declines, the Profile switch).
create table public.consent_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  version text not null,
  locale public.app_language not null,
  granted boolean not null,
  created_at timestamptz not null default now(),
  foreign key (kind, version) references public.consent_texts (kind, version)
);

comment on table public.consent_events is 'Append-only consent history, written only by accept_terms and set_ai_consent.';

create index consent_events_user_id_created_at_idx on public.consent_events (user_id, created_at);

alter table public.consent_events enable row level security;

create policy "consent_events_select_own" on public.consent_events
  for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.consent_events from anon, authenticated;
grant select on public.consent_events to authenticated;

-- Replaced, not overloaded: an old build calling the two-argument form must fail rather than skip the versions.
drop function public.accept_terms(boolean, boolean);
drop function public.set_ai_consent(boolean);

-- Every box is required, so a half-accepted state never exists. The stamps are kept within a version and set again
-- when the version changes, so they always date the acceptance of the text named in terms_version. A version older than
-- the stored one is refused: an outdated build must not roll back what a newer one recorded.
create function public.accept_terms(
  p_adult boolean,
  p_boundary boolean,
  p_health boolean,
  p_version text,
  p_locale public.app_language
)
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
  if p_adult is not true or p_boundary is not true or p_health is not true then
    raise exception 'every confirmation is required' using errcode = '22023';
  end if;
  if p_locale is null then
    raise exception 'a locale is required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.consent_texts where kind = 'terms' and version = p_version) then
    raise exception 'unknown terms version' using errcode = '22023';
  end if;

  update public.profiles
  set adult_confirmed_at = case
        when terms_version is distinct from p_version then pg_catalog.now()
        else coalesce(adult_confirmed_at, pg_catalog.now())
      end,
      boundary_accepted_at = case
        when terms_version is distinct from p_version then pg_catalog.now()
        else coalesce(boundary_accepted_at, pg_catalog.now())
      end,
      terms_version = p_version
  where user_id = v_user
    and (terms_version is null or terms_version <= p_version);

  -- No event without the profile change it proves.
  if not found then
    raise exception 'no profile, or a newer terms version is already accepted' using errcode = '22023';
  end if;

  insert into public.consent_events (user_id, kind, version, locale, granted)
  values (v_user, 'terms', p_version, p_locale, true);
end;
$$;

revoke execute on function public.accept_terms(boolean, boolean, boolean, text, public.app_language) from public, anon;
grant execute on function public.accept_terms(boolean, boolean, boolean, text, public.app_language) to authenticated;

-- Answering is recorded apart from the answer, so a "no" is remembered. The version is kept on a decline too: it is
-- the text the user answered. A grant under an older version than the stored one is refused, but a withdrawal always
-- succeeds (consent can be revoked at any time) and keeps the newer stored version; its event names the text it used.
create function public.set_ai_consent(p_enabled boolean, p_version text, p_locale public.app_language)
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
  if p_enabled is null then
    raise exception 'an answer is required' using errcode = '22023';
  end if;
  if p_locale is null then
    raise exception 'a locale is required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.consent_texts where kind = 'ai' and version = p_version) then
    raise exception 'unknown ai consent version' using errcode = '22023';
  end if;

  update public.profiles
  set ai_consent_answered_at = pg_catalog.now(),
      ai_enabled = p_enabled,
      ai_consent_at = case when p_enabled then pg_catalog.now() end,
      ai_consent_version = case when p_enabled then p_version else greatest(ai_consent_version, p_version) end
  where user_id = v_user
    and (not p_enabled or ai_consent_version is null or ai_consent_version <= p_version);

  if not found then
    raise exception 'no profile, or a newer ai consent version is already answered' using errcode = '22023';
  end if;

  insert into public.consent_events (user_id, kind, version, locale, granted)
  values (v_user, 'ai', p_version, p_locale, p_enabled);
end;
$$;

revoke execute on function public.set_ai_consent(boolean, text, public.app_language) from public, anon;
grant execute on function public.set_ai_consent(boolean, text, public.app_language) to authenticated;

-- Same contract as before, plus an accepted terms version: stamps set before versions existed do not count.
create or replace function public.complete_onboarding()
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
    and ai_consent_answered_at is not null
    and terms_version is not null;

  if not found then
    raise exception 'consent gates are not complete' using errcode = '22023';
  end if;
end;
$$;
