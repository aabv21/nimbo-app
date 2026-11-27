-- Episodes, medications, doses and check-ins: read-own RLS, no direct writes, and the RPC contracts
-- (idempotent writes, patch semantics, ownership as P0002, catalog and range checks).
begin;

create extension if not exists pgtap with schema extensions;

select plan(93);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-b@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

-- Seed one row of each kind per user as the table owner, so the read tests do not depend on the RPCs.
insert into public.episodes (id, user_id, started_at) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '2026-11-20T10:00:00Z'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', '2026-11-20T10:00:00Z');
insert into public.medications (id, user_id, name, kind, class) values
  ('aaaaaaaa-1000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Ibuprofen', 'acute', 'simple_analgesic'),
  ('bbbbbbbb-1000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'Sumatriptan', 'acute', 'triptan');
insert into public.doses (id, user_id, medication_id, taken_at) values
  ('aaaaaaaa-2000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-1000-0000-0000-00000000000a', '2026-11-20T10:30:00Z'),
  ('bbbbbbbb-2000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-1000-0000-0000-00000000000b', '2026-11-20T10:30:00Z');
insert into public.checkins (user_id, local_date) values
  ('11111111-1111-1111-1111-111111111111', '2026-11-20'),
  ('22222222-2222-2222-2222-222222222222', '2026-11-20');

-- RLS is on for every table.
select ok((select relrowsecurity from pg_class where oid = 'public.episodes'::regclass), 'RLS is on for episodes');
select ok((select relrowsecurity from pg_class where oid = 'public.medications'::regclass), 'RLS is on for medications');
select ok((select relrowsecurity from pg_class where oid = 'public.doses'::regclass), 'RLS is on for doses');
select ok((select relrowsecurity from pg_class where oid = 'public.checkins'::regclass), 'RLS is on for checkins');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

-- A sees only A's rows.
select is((select count(*)::int from public.episodes where user_id <> (select auth.uid())), 0, 'A sees no other user''s episode');
select is((select count(*)::int from public.medications where user_id <> (select auth.uid())), 0, 'A sees no other user''s medication');
select is((select count(*)::int from public.doses where user_id <> (select auth.uid())), 0, 'A sees no other user''s dose');
select is((select count(*)::int from public.checkins where user_id <> (select auth.uid())), 0, 'A sees no other user''s check-in');
select is((select count(*)::int from public.episodes), 1, 'A sees their own episode');
select is((select count(*)::int from public.checkins), 1, 'A sees their own check-in');

-- No direct writes.
select throws_ok($$ insert into public.episodes (user_id, started_at) values ((select auth.uid()), now()) $$, '42501', null, 'a direct insert into episodes is refused');
select throws_ok($$ update public.episodes set notes = 'x' $$, '42501', null, 'a direct update of episodes is refused');
select throws_ok($$ delete from public.episodes $$, '42501', null, 'a direct delete from episodes is refused');
select throws_ok($$ insert into public.medications (user_id, name, kind, class) values ((select auth.uid()), 'x', 'acute', 'other') $$, '42501', null, 'a direct insert into medications is refused');
select throws_ok($$ update public.medications set name = 'x' $$, '42501', null, 'a direct update of medications is refused');
select throws_ok($$ delete from public.medications $$, '42501', null, 'a direct delete from medications is refused');
select throws_ok($$ insert into public.doses (user_id, medication_id, taken_at) values ((select auth.uid()), 'aaaaaaaa-1000-0000-0000-00000000000a', now()) $$, '42501', null, 'a direct insert into doses is refused');
select throws_ok($$ update public.doses set taken_at = now() $$, '42501', null, 'a direct update of doses is refused');
select throws_ok($$ delete from public.doses $$, '42501', null, 'a direct delete from doses is refused');
select throws_ok($$ insert into public.checkins (user_id, local_date) values ((select auth.uid()), '2026-11-21') $$, '42501', null, 'a direct insert into checkins is refused');
select throws_ok($$ update public.checkins set alcohol = true $$, '42501', null, 'a direct update of checkins is refused');
select throws_ok($$ delete from public.checkins $$, '42501', null, 'a direct delete from checkins is refused');

-- log_episode stores the caller and is idempotent on the id.
select lives_ok(
  $$ select public.log_episode('aaaaaaaa-0000-0000-0000-000000000001', now() - interval '1 hour', '{"intensity": 6, "notes": "first"}') $$,
  'log_episode accepts a new episode'
);
select is(
  (select user_id::text || ',' || source::text || ',' || condition from public.episodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '11111111-1111-1111-1111-111111111111,manual,migraine',
  'log_episode stores user_id = A, source manual and condition migraine'
);
select lives_ok(
  $$ select public.log_episode('aaaaaaaa-0000-0000-0000-000000000001', now() - interval '2 hours', '{"intensity": 9, "notes": "second"}') $$,
  'a repeated log_episode id succeeds'
);
select is(
  (select count(*)::int || ',' || min(notes) || ',' || min(intensity) from public.episodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '1,first,6',
  'a repeated id leaves one row with the first fields'
);

-- log_episode validation.
select throws_ok($$ select public.log_episode('aaaaaaaa-0000-0000-0000-000000000002', now(), '{"bogus": 1}') $$, '22023', null, 'an unknown key raises 22023');
select throws_ok($$ select public.log_episode('aaaaaaaa-0000-0000-0000-000000000002', now() + interval '1 hour', '{}') $$, '22023', null, 'a start an hour ahead raises 22023');
select throws_ok($$ select public.log_episode('aaaaaaaa-0000-0000-0000-000000000002', '1999-12-31T00:00:00Z', '{}') $$, '22023', null, 'a start before 2000 raises 22023');
select lives_ok($$ select public.log_episode('aaaaaaaa-0000-0000-0000-000000000002', now() + interval '3 minutes', '{}') $$, 'a start three minutes ahead is within the clock skew');
select throws_ok($$ select public.log_episode('aaaaaaaa-0000-0000-0000-000000000003', now(), '{"triggers": ["not_a_key"]}') $$, '23514', null, 'a trigger outside the pack raises 23514');
select throws_ok($$ select public.log_episode('aaaaaaaa-0000-0000-0000-000000000003', now(), '{"symptoms": ["nausea", "nausea"]}') $$, '23514', null, 'a duplicate symptom raises 23514');
select throws_ok($$ select public.log_episode('aaaaaaaa-0000-0000-0000-000000000003', now(), '{"intensity": 11}') $$, '23514', null, 'an intensity of 11 raises 23514');
select lives_ok($$ select public.log_episode('aaaaaaaa-0000-0000-0000-000000000003', now(), '{"triggers": ["weather", "stress"], "pain_areas": ["temple_left"], "source": "voice"}') $$, 'catalog keys and a source are accepted');

-- update_episode is an owner-only patch.
select lives_ok($$ select public.update_episode('aaaaaaaa-0000-0000-0000-000000000001', '{"intensity": 4}') $$, 'update_episode patches one key');
select is(
  (select intensity::text || ',' || notes from public.episodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '4,first',
  'update_episode changes only the keys given'
);
select lives_ok($$ select public.update_episode('aaaaaaaa-0000-0000-0000-000000000001', '{"notes": null}') $$, 'update_episode accepts a json null');
select is((select notes from public.episodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), null, 'a json null clears the notes');
select throws_ok($$ select public.update_episode('aaaaaaaa-0000-0000-0000-000000000001', '{"bogus": 1}') $$, '22023', null, 'update_episode rejects an unknown key');
select throws_ok($$ select public.update_episode('aaaaaaaa-0000-0000-0000-0000000000ff', '{"intensity": 1}') $$, 'P0002', null, 'update_episode on a missing id raises P0002');

reset role;
select set_config('request.jwt.claims', json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok($$ select public.update_episode('aaaaaaaa-0000-0000-0000-000000000001', '{"intensity": 1}') $$, 'P0002', null, 'B updating A''s episode raises P0002');

reset role;
select is((select intensity::int from public.episodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 4, 'B''s update left A''s row unchanged');
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);
set local role authenticated;

-- end_episode.
select throws_ok($$ select public.end_episode('aaaaaaaa-0000-0000-0000-000000000001', now() - interval '3 hours') $$, '23514', null, 'ending before the start raises 23514');
select lives_ok($$ select public.end_episode('aaaaaaaa-0000-0000-0000-000000000001', now()) $$, 'end_episode succeeds');
select lives_ok(
  $$ select public.end_episode('aaaaaaaa-0000-0000-0000-000000000001', (select ended_at from public.episodes where id = 'aaaaaaaa-0000-0000-0000-000000000001')) $$,
  'a repeat with the same value succeeds'
);
select throws_ok($$ select public.end_episode('aaaaaaaa-0000-0000-0000-000000000001', now() + interval '1 hour') $$, '22023', null, 'an end an hour ahead raises 22023');

-- save_medication (runs before the dose tests, which need a medication of A's).
select throws_ok($$ select public.save_medication('aaaaaaaa-1000-0000-0000-000000000001', '{"name": "Naproxen", "kind": "acute"}') $$, '23502', null, 'a new medication without a class raises 23502');
select throws_ok($$ select public.save_medication('aaaaaaaa-1000-0000-0000-000000000001', '{"name": "Naproxen", "kind": "acute", "class": "simple_analgesic", "schedule": "daily", "schedule_time": "08:00"}') $$, '23514', null, 'a schedule on an acute medication raises 23514');
select throws_ok($$ select public.save_medication('aaaaaaaa-1000-0000-0000-000000000001', '{"name": "Naproxen", "kind": "acute", "class": "bogus"}') $$, '22P02', null, 'an unknown class is refused');
select lives_ok($$ select public.save_medication('aaaaaaaa-1000-0000-0000-000000000001', '{"name": "Naproxen", "kind": "acute", "class": "simple_analgesic", "min_interval_minutes": 240}') $$, 'save_medication inserts a new medication');
select is((select form::text || ',' || user_id::text from public.medications where id = 'aaaaaaaa-1000-0000-0000-000000000001'), 'oral,11111111-1111-1111-1111-111111111111', 'the form defaults to oral and the owner is A');
select lives_ok($$ select public.save_medication('aaaaaaaa-1000-0000-0000-000000000001', '{"dose_text": "500 mg"}') $$, 'a second call patches the row');
select is((select name || ',' || dose_text from public.medications where id = 'aaaaaaaa-1000-0000-0000-000000000001'), 'Naproxen,500 mg', 'the patch kept the other fields');
select lives_ok($$ select public.save_medication('aaaaaaaa-1000-0000-0000-000000000001', '{"archived": true}') $$, 'archived true is accepted');
select ok((select archived_at is not null from public.medications where id = 'aaaaaaaa-1000-0000-0000-000000000001'), 'archived true stamps archived_at');
select lives_ok($$ select public.save_medication('aaaaaaaa-1000-0000-0000-000000000001', '{"archived": false}') $$, 'archived false is accepted');
select ok((select archived_at is null from public.medications where id = 'aaaaaaaa-1000-0000-0000-000000000001'), 'archived false clears archived_at');
select lives_ok($$ select public.save_medication('aaaaaaaa-1000-0000-0000-000000000002', '{"name": "Topiramate", "kind": "preventive", "class": "other", "schedule": "monthly", "schedule_time": "08:00", "schedule_anchor": "2026-11-01"}') $$, 'a preventive with a schedule is accepted');
select throws_ok($$ select public.save_medication('aaaaaaaa-1000-0000-0000-000000000003', '{"name": "X", "kind": "preventive", "class": "other", "schedule": "monthly", "schedule_time": "08:00"}') $$, '23514', null, 'a monthly schedule without an anchor raises 23514');

-- log_dose, then delete_episode detaching the dose.
select lives_ok($$ select public.log_dose('aaaaaaaa-2000-0000-0000-000000000001', 'aaaaaaaa-1000-0000-0000-000000000001', now(), 'aaaaaaaa-0000-0000-0000-000000000001') $$, 'log_dose accepts A''s medication and episode');
select lives_ok($$ select public.log_dose('aaaaaaaa-2000-0000-0000-000000000001', 'aaaaaaaa-1000-0000-0000-000000000001', now() - interval '5 hours', null) $$, 'a repeated dose id succeeds');
select is((select count(*)::int || ',' || (episode_id is not null)::text from public.doses where id = 'aaaaaaaa-2000-0000-0000-000000000001' group by episode_id), '1,true', 'a repeated id leaves one dose with the first fields');
select throws_ok($$ select public.log_dose('aaaaaaaa-2000-0000-0000-000000000002', 'aaaaaaaa-1000-0000-0000-000000000001', now() + interval '1 hour', null) $$, '22023', null, 'a dose an hour ahead raises 22023');

select lives_ok($$ select public.delete_episode('aaaaaaaa-0000-0000-0000-000000000001') $$, 'delete_episode succeeds');
select is((select count(*)::int from public.episodes where id = 'aaaaaaaa-0000-0000-0000-000000000001'), 0, 'the episode is gone');
select is((select episode_id from public.doses where id = 'aaaaaaaa-2000-0000-0000-000000000001'), null, 'its dose keeps existing with a null episode_id');
select lives_ok($$ select public.delete_episode('aaaaaaaa-0000-0000-0000-000000000001') $$, 'a repeat delete_episode succeeds');

-- Ownership of doses, medications and episodes, run as B against A's records.
reset role;
select set_config('request.jwt.claims', json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok($$ select public.log_dose('bbbbbbbb-2000-0000-0000-000000000001', 'aaaaaaaa-1000-0000-0000-000000000001', now(), null) $$, 'P0002', null, 'B logging a dose of A''s medication raises P0002');
select throws_ok(
  $$ select public.log_dose('bbbbbbbb-2000-0000-0000-000000000001', 'bbbbbbbb-1000-0000-0000-00000000000b', now(), 'aaaaaaaa-0000-0000-0000-00000000000a') $$,
  'P0002', null, 'B''s medication with A''s episode raises P0002'
);
select throws_ok($$ select public.save_medication('aaaaaaaa-1000-0000-0000-000000000001', '{"name": "Stolen"}') $$, 'P0002', null, 'B saving A''s medication raises P0002');
select lives_ok($$ select public.delete_dose('aaaaaaaa-2000-0000-0000-000000000001') $$, 'B deleting A''s dose does not raise');
select lives_ok($$ select public.delete_episode('aaaaaaaa-0000-0000-0000-00000000000a') $$, 'B deleting A''s episode does not raise');

reset role;
select is((select count(*)::int from public.doses where id = 'aaaaaaaa-2000-0000-0000-000000000001'), 1, 'B''s delete_dose changed nothing');
select is((select count(*)::int from public.episodes where id = 'aaaaaaaa-0000-0000-0000-00000000000a'), 1, 'B''s delete_episode changed nothing');
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);
set local role authenticated;

select lives_ok($$ select public.delete_dose('aaaaaaaa-2000-0000-0000-000000000001') $$, 'A deleting their dose succeeds');
select lives_ok($$ select public.delete_dose('aaaaaaaa-2000-0000-0000-000000000001') $$, 'a repeat delete_dose succeeds');
select is((select count(*)::int from public.doses where id = 'aaaaaaaa-2000-0000-0000-000000000001'), 0, 'the dose is gone');

-- save_checkin merges into one row per date.
select lives_ok($$ select public.save_checkin('2026-11-21', '{"sleep_band": "5_6", "alcohol": true}') $$, 'save_checkin inserts a day');
select lives_ok($$ select public.save_checkin('2026-11-21', '{"stress": "high"}') $$, 'a second save_checkin on the date merges');
select is(
  (select count(*)::int || ',' || sleep_band::text || ',' || stress::text || ',' || alcohol::text from public.checkins where local_date = '2026-11-21' group by sleep_band, stress, alcohol),
  '1,5_6,high,true',
  'both calls landed in one row'
);
select throws_ok($$ select public.save_checkin((now() at time zone 'utc')::date + 2, '{}') $$, '22023', null, 'a date two days ahead raises 22023');
select throws_ok($$ select public.save_checkin('2026-11-22', '{"bogus": true}') $$, '22023', null, 'save_checkin rejects an unknown key');

-- Function and schema privileges.
reset role;

select ok(not has_function_privilege('anon', 'public.log_episode(uuid, timestamptz, jsonb)', 'execute'), 'anon cannot execute log_episode');
select ok(not has_function_privilege('anon', 'public.update_episode(uuid, jsonb)', 'execute'), 'anon cannot execute update_episode');
select ok(not has_function_privilege('anon', 'public.end_episode(uuid, timestamptz)', 'execute'), 'anon cannot execute end_episode');
select ok(not has_function_privilege('anon', 'public.delete_episode(uuid)', 'execute'), 'anon cannot execute delete_episode');
select ok(not has_function_privilege('anon', 'public.save_medication(uuid, jsonb)', 'execute'), 'anon cannot execute save_medication');
select ok(not has_function_privilege('anon', 'public.log_dose(uuid, uuid, timestamptz, uuid)', 'execute'), 'anon cannot execute log_dose');
select ok(not has_function_privilege('anon', 'public.delete_dose(uuid)', 'execute'), 'anon cannot execute delete_dose');
select ok(not has_function_privilege('anon', 'public.save_checkin(date, jsonb)', 'execute'), 'anon cannot execute save_checkin');
select ok(not has_function_privilege('anon', 'public.catalog_keys(text)', 'execute'), 'anon cannot execute catalog_keys');
select ok(not has_function_privilege('anon', 'public.is_catalog_subset(text[], text)', 'execute'), 'anon cannot execute is_catalog_subset');
select ok(not has_schema_privilege('authenticated', 'private', 'usage'), 'authenticated has no usage on schema private');

select * from finish();

rollback;
