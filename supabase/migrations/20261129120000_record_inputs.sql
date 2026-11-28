-- One read of the records the insights (and later the signals) run on, in the shape `parseRecordInputs` takes.
-- Security invoker: RLS limits a signed-in caller to their own rows, so another user's id reads as empty.

create function public.record_inputs(p_user_id uuid, p_since timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'timeZone', p.timezone,
    'knownTriggers', coalesce(pg_catalog.to_jsonb(p.known_triggers), '[]'::jsonb),
    'onboardedAt', p.onboarding_completed_at,
    -- Whether a coarse area is saved, never the area itself.
    'hasLocation', coalesce(p.coarse_lat is not null, false),
    'episodes', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', e.id,
        'startedAt', e.started_at,
        'endedAt', e.ended_at,
        'intensity', e.intensity,
        'triggers', pg_catalog.to_jsonb(e.triggers),
        'helped', pg_catalog.to_jsonb(e.helped),
        'didNotHelp', pg_catalog.to_jsonb(e.did_not_help),
        'debriefedAt', e.debriefed_at
      ) order by e.started_at, e.id)
      from public.episodes e
      -- An attack still open counts however long ago it started.
      where e.user_id = p_user_id and (e.started_at >= p_since or e.ended_at is null)
    ), '[]'::jsonb),
    'checkins', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'localDate', c.local_date,
        'sleepBand', c.sleep_band,
        'stress', c.stress
      ) order by c.local_date)
      from public.checkins c
      -- A day earlier than the UTC date, so a zone behind UTC still gets its first local day.
      where c.user_id = p_user_id and c.local_date >= (p_since at time zone 'UTC')::date - 1
    ), '[]'::jsonb),
    'doses', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', d.id,
        'medicationId', d.medication_id,
        'episodeId', d.episode_id,
        'takenAt', d.taken_at,
        'helped', d.helped
      ) order by d.taken_at, d.id)
      from public.doses d
      where d.user_id = p_user_id and d.taken_at >= p_since
    ), '[]'::jsonb),
    -- Archived ones too: their past doses still name them.
    'medications', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', m.id,
        'name', m.name,
        'kind', m.kind,
        'class', m.class
      ) order by m.created_at, m.id)
      from public.medications m
      where m.user_id = p_user_id
    ), '[]'::jsonb)
  )
  from (select 1) as one
  left join public.profiles p on p.user_id = p_user_id;
$$;

revoke execute on function public.record_inputs(uuid, timestamptz) from public, anon;
grant execute on function public.record_inputs(uuid, timestamptz) to authenticated, service_role;
