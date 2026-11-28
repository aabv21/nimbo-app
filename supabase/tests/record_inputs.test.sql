-- record_inputs: the caller's own records in one JSON (archived medications included, the location as a flag
-- only), empty for anyone else's id under RLS, the p_since cut, and who may call it.
begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-b@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

-- Seeded as the table owner, so the tests do not depend on the write RPCs.
update public.profiles set timezone = 'America/Bogota', known_triggers = '{weather}', onboarding_completed_at = '2026-09-01T12:00:00Z'
  where user_id = '11111111-1111-1111-1111-111111111111';
update public.profiles set timezone = 'Europe/Madrid' where user_id = '22222222-2222-2222-2222-222222222222';

insert into public.episodes (id, user_id, started_at, ended_at, intensity, triggers, helped, did_not_help, debriefed_at) values
  -- Recent and ended.
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '2026-11-20T10:00:00Z', '2026-11-20T14:00:00Z', 6, '{stress}', '{dark_room}', '{caffeine}', '2026-11-21T09:00:00Z'),
  -- Before p_since and ended: dropped.
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', '2026-05-01T10:00:00Z', '2026-05-01T12:00:00Z', 4, '{}', '{}', '{}', null),
  -- Before p_since but still open: kept.
  ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', '2026-05-02T10:00:00Z', null, null, '{}', '{}', '{}', null),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', '2026-11-20T10:00:00Z', null, 7, '{}', '{}', '{}', null);
insert into public.medications (id, user_id, name, kind, class, archived_at) values
  ('aaaaaaaa-1000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Sumatriptan', 'acute', 'triptan', null),
  ('aaaaaaaa-1000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Rizatriptan', 'acute', 'triptan', '2026-10-01T00:00:00Z'),
  ('bbbbbbbb-1000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Ibuprofen', 'acute', 'simple_analgesic', null);
insert into public.doses (id, user_id, medication_id, episode_id, taken_at, helped) values
  ('aaaaaaaa-2000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-1000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '2026-11-20T10:30:00Z', true),
  -- Before p_since: dropped.
  ('aaaaaaaa-2000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-1000-0000-0000-000000000002', null, '2026-05-01T10:30:00Z', null),
  ('bbbbbbbb-2000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-1000-0000-0000-000000000001', null, '2026-11-20T10:30:00Z', null);
insert into public.checkins (user_id, local_date, sleep_band, stress) values
  ('11111111-1111-1111-1111-111111111111', '2026-11-19', 'lt5', 'high'),
  -- The day before the UTC date of p_since is still kept; two days before is not.
  ('11111111-1111-1111-1111-111111111111', '2026-05-31', '7_8', null),
  ('11111111-1111-1111-1111-111111111111', '2026-05-30', '6_7', 'low'),
  ('22222222-2222-2222-2222-222222222222', '2026-11-19', 'gt8', 'low');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

create temporary table own on commit drop as
  select public.record_inputs('11111111-1111-1111-1111-111111111111', '2026-06-01T00:00:00Z') as v;
create temporary table other on commit drop as
  select public.record_inputs('22222222-2222-2222-2222-222222222222', '2026-06-01T00:00:00Z') as v;

-- 1. A's own records.
select is((select v ->> 'timeZone' from own), 'America/Bogota', 'the profile zone comes back');
select is((select v -> 'knownTriggers' from own), '["weather"]'::jsonb, 'the known triggers come back');
select ok((select (v ->> 'onboardedAt')::timestamptz = '2026-09-01T12:00:00Z' from own), 'the onboarding time comes back');
select is((select v -> 'hasLocation' from own), 'false'::jsonb, 'no saved area reads hasLocation false');
select is(
  (select (v -> 'episodes' -> 0) - 'startedAt' - 'endedAt' - 'debriefedAt' from own),
  '{"id": "aaaaaaaa-0000-0000-0000-000000000003", "intensity": null, "triggers": [], "helped": [], "didNotHelp": []}'::jsonb,
  'episodes come oldest first, the open one included'
);
select is(
  (select (v -> 'episodes' -> 1) - 'startedAt' - 'endedAt' - 'debriefedAt' from own),
  '{"id": "aaaaaaaa-0000-0000-0000-000000000001", "intensity": 6, "triggers": ["stress"], "helped": ["dark_room"], "didNotHelp": ["caffeine"]}'::jsonb,
  'an episode carries its triggers and debrief answers'
);
select ok(
  (select (v -> 'episodes' -> 1 ->> 'startedAt')::timestamptz = '2026-11-20T10:00:00Z' and (v -> 'episodes' -> 1 ->> 'debriefedAt')::timestamptz = '2026-11-21T09:00:00Z' from own),
  'episode times are timestamps with their offset'
);
select is(
  (select v -> 'checkins' from own),
  '[{"localDate": "2026-05-31", "sleepBand": "7_8", "stress": null}, {"localDate": "2026-11-19", "sleepBand": "lt5", "stress": "high"}]'::jsonb,
  'check-ins from the day before p_since, with the band and stress'
);
select is(
  (select (v -> 'doses' -> 0) - 'takenAt' from own),
  '{"id": "aaaaaaaa-2000-0000-0000-000000000001", "medicationId": "aaaaaaaa-1000-0000-0000-000000000001", "episodeId": "aaaaaaaa-0000-0000-0000-000000000001", "helped": true}'::jsonb,
  'a dose carries its medication, episode and helped answer'
);
select is(
  (select v -> 'medications' from own),
  '[{"id": "aaaaaaaa-1000-0000-0000-000000000001", "name": "Sumatriptan", "kind": "acute", "class": "triptan"}, {"id": "aaaaaaaa-1000-0000-0000-000000000002", "name": "Rizatriptan", "kind": "acute", "class": "triptan"}]'::jsonb,
  'every medication, archived included, with its class'
);

-- 3. The p_since cut.
select is((select jsonb_array_length(v -> 'episodes') from own), 2, 'an ended episode before p_since is dropped, an open one kept');
select is((select jsonb_array_length(v -> 'doses') from own), 1, 'a dose before p_since is dropped');

-- 2. B's id from A's session: nothing of B's.
select is((select v -> 'episodes' from other), '[]'::jsonb, 'A asking for B gets no episodes');
select is((select v -> 'checkins' from other), '[]'::jsonb, 'A asking for B gets no check-ins');
select is((select v -> 'doses' from other), '[]'::jsonb, 'A asking for B gets no doses');
select is((select v -> 'medications' from other), '[]'::jsonb, 'A asking for B gets no medications');
select is((select v ->> 'timeZone' from other), null, 'A asking for B gets a null zone');
select is((select v -> 'onboardedAt' from other), 'null'::jsonb, 'A asking for B gets a null onboarding time');

-- 5. The coordinates never leave, by key or by value.
reset role;
update public.profiles set coarse_lat = 4.6, coarse_lon = -74.1 where user_id = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
select is(
  (public.record_inputs('11111111-1111-1111-1111-111111111111', '2026-06-01T00:00:00Z') -> 'hasLocation'),
  'true'::jsonb,
  'a saved area reads hasLocation true'
);
select ok(
  (select public.record_inputs('11111111-1111-1111-1111-111111111111', '2026-06-01T00:00:00Z')::text !~ '(coarse_lat|coarse_lon|-74\.1|4\.6\M)'),
  'the output never holds coarse_lat, coarse_lon or their values'
);

reset role;

-- 4. Privileges.
select ok(not has_function_privilege('anon', 'public.record_inputs(uuid, timestamptz)', 'execute'), 'anon cannot execute record_inputs');
select ok(has_function_privilege('service_role', 'public.record_inputs(uuid, timestamptz)', 'execute'), 'service_role can execute record_inputs');

select * from finish();

rollback;
