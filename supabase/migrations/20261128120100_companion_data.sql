-- The companion's data: what helped in an attack (the debrief), whether a dose helped, and the agent's
-- short notes about how the user likes things. Writes go through the RPCs below, as for the tracking tables.

alter table public.episodes
  add column helped text[] not null default '{}' check (public.is_catalog_subset(helped, 'reliefs')),
  add column did_not_help text[] not null default '{}' check (public.is_catalog_subset(did_not_help, 'reliefs')),
  add column debriefed_at timestamptz;

alter table public.doses add column helped boolean;

-- The body of 20261127120000_tracking.sql, plus helped, did_not_help and debriefed. `debriefed: true` keeps the
-- first stamp, so a replayed debrief after a lost reply does not move it; `false` clears it.
create or replace function public.update_episode(p_id uuid, p_fields jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_started timestamptz;
  v_start_clamped boolean := false;
  v_ended timestamptz;
  v_debriefed boolean;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  perform private.check_keys(p_fields, array[
    'started_at', 'ended_at', 'intensity', 'pain_areas', 'symptoms', 'triggers', 'reliefs', 'notes', 'source',
    'helped', 'did_not_help', 'debriefed'
  ]);
  -- A start can be moved (people log late) but never cleared: a json null fails the time check.
  if p_fields ? 'started_at' then
    v_started := private.client_time((p_fields ->> 'started_at')::timestamptz);
    v_start_clamped := v_started < (p_fields ->> 'started_at')::timestamptz;
  end if;
  if p_fields ->> 'ended_at' is not null then
    v_ended := private.client_time((p_fields ->> 'ended_at')::timestamptz);
  end if;
  if p_fields ? 'debriefed' then
    if pg_catalog.jsonb_typeof(p_fields -> 'debriefed') <> 'boolean' then
      raise exception 'debriefed must be a boolean' using errcode = '22023';
    end if;
    v_debriefed := (p_fields ->> 'debriefed')::boolean;
  end if;

  -- A start clamped to now may pass an end stored earlier, which the phone saw as later: it stops at that end.
  -- An unclamped start after the end is still the client's error (23514).
  update public.episodes
  set started_at = case
        when not (p_fields ? 'started_at') then started_at
        when v_start_clamped then least(v_started, coalesce(case when p_fields ? 'ended_at' then v_ended else ended_at end, v_started))
        else v_started
      end,
      ended_at = case when p_fields ? 'ended_at' then v_ended else ended_at end,
      intensity = case when p_fields ? 'intensity' then (p_fields ->> 'intensity')::smallint else intensity end,
      pain_areas = case when p_fields ? 'pain_areas' then private.to_text_array(p_fields -> 'pain_areas') else pain_areas end,
      symptoms = case when p_fields ? 'symptoms' then private.to_text_array(p_fields -> 'symptoms') else symptoms end,
      triggers = case when p_fields ? 'triggers' then private.to_text_array(p_fields -> 'triggers') else triggers end,
      reliefs = case when p_fields ? 'reliefs' then private.to_text_array(p_fields -> 'reliefs') else reliefs end,
      notes = case when p_fields ? 'notes' then p_fields ->> 'notes' else notes end,
      source = case when p_fields ? 'source' then (p_fields ->> 'source')::public.episode_source else source end,
      helped = case when p_fields ? 'helped' then private.to_text_array(p_fields -> 'helped') else helped end,
      did_not_help = case when p_fields ? 'did_not_help' then private.to_text_array(p_fields -> 'did_not_help') else did_not_help end,
      debriefed_at = case
        when v_debriefed is null then debriefed_at
        when v_debriefed then coalesce(debriefed_at, pg_catalog.now())
        else null
      end
  where id = p_id and user_id = v_user;

  if not found then
    raise exception 'episode not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Omitting p_helped clears the answer: the generated type makes it optional, and the outbox never sends a null.
create function public.set_dose_helped(p_id uuid, p_helped boolean default null)
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
  update public.doses set helped = p_helped where id = p_id and user_id = v_user;
  if not found then
    raise exception 'dose not found' using errcode = 'P0002';
  end if;
end;
$$;

create table public.agent_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  text text not null check (char_length(text) between 1 and 200),
  created_at timestamptz not null default now()
);

create index agent_notes_user_created_idx on public.agent_notes (user_id, created_at);

alter table public.agent_notes enable row level security;

create policy "agent_notes_select_own" on public.agent_notes
  for select to authenticated using (user_id = (select auth.uid()));

revoke all on public.agent_notes from anon, authenticated;
grant select on public.agent_notes to authenticated;

-- At most 20 notes per user; the prompt quotes them, so a control character (one that could fake a line or a
-- tag boundary) is refused rather than stored.
create function public.save_agent_note(p_text text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_text text;
  v_id uuid;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_text is null or p_text ~ '[[:cntrl:]]' then
    raise exception 'the note has a control character' using errcode = '22023';
  end if;
  v_text := pg_catalog.btrim(p_text);
  if pg_catalog.char_length(v_text) not between 1 and 200 then
    raise exception 'the note must be 1 to 200 characters' using errcode = '23514';
  end if;

  -- Serializes this user's saves on their profile row, so two at once cannot both see 19 and make a 21st.
  -- It relies on that row existing: handle_new_user() creates one for every auth user at signup.
  perform 1 from public.profiles where user_id = v_user for update;
  if (select pg_catalog.count(*) from public.agent_notes where user_id = v_user) >= 20 then
    raise exception 'at most 20 notes' using errcode = '23514';
  end if;

  insert into public.agent_notes (user_id, text) values (v_user, v_text) returning id into v_id;
  return v_id;
end;
$$;

create function public.delete_agent_note(p_id uuid)
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
  delete from public.agent_notes where id = p_id and user_id = v_user;
end;
$$;

revoke execute on function
  public.set_dose_helped(uuid, boolean),
  public.save_agent_note(text),
  public.delete_agent_note(uuid)
from public, anon;
grant execute on function
  public.set_dose_helped(uuid, boolean),
  public.save_agent_note(text),
  public.delete_agent_note(uuid)
to authenticated;
