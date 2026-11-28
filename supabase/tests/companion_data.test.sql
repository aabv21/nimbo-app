-- The companion's data: the debrief columns and keys, set_dose_helped, and agent_notes with their RPCs
-- (read-own RLS, no direct writes, the 20-note and 200-character limits, ownership).
begin;

create extension if not exists pgtap with schema extensions;

select plan(55);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-b@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

-- Seeded as the table owner, so the tests do not depend on the Wave 2 RPCs.
insert into public.episodes (id, user_id, started_at, ended_at) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', '2026-11-20T10:00:00Z', '2026-11-20T14:00:00Z'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', '2026-11-20T10:00:00Z', null);
insert into public.medications (id, user_id, name, kind, class) values
  ('aaaaaaaa-1000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Ibuprofen', 'acute', 'simple_analgesic'),
  ('bbbbbbbb-1000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'Sumatriptan', 'acute', 'triptan');
insert into public.doses (id, user_id, medication_id, episode_id, taken_at) values
  ('aaaaaaaa-2000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-1000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000000a', '2026-11-20T10:30:00Z'),
  ('bbbbbbbb-2000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-1000-0000-0000-00000000000b', null, '2026-11-20T10:30:00Z');
insert into public.agent_notes (id, user_id, text) values
  ('bbbbbbbb-3000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'Prefers short answers');

select ok((select relrowsecurity from pg_class where oid = 'public.agent_notes'::regclass), 'RLS is on for agent_notes');
select is(
  (select array_agg(column_name::text order by column_name::text) from information_schema.columns
    where table_schema = 'public' and table_name = 'episodes' and column_name in ('helped', 'did_not_help', 'debriefed_at')),
  array['debriefed_at', 'did_not_help', 'helped'],
  'episodes has the three debrief columns'
);
select is(
  (select helped::text || ',' || did_not_help::text from public.episodes where id = 'aaaaaaaa-0000-0000-0000-00000000000a'),
  '{},{}',
  'the debrief arrays default to empty'
);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

-- 1. The relief catalog guards both arrays.
select lives_ok($$ select public.update_episode('aaaaaaaa-0000-0000-0000-00000000000a', '{"helped": ["dark_room"]}') $$, 'update_episode accepts a relief in helped');
select is((select helped from public.episodes where id = 'aaaaaaaa-0000-0000-0000-00000000000a'), array['dark_room'], 'helped is stored');
select throws_ok($$ select public.update_episode('aaaaaaaa-0000-0000-0000-00000000000a', '{"helped": ["bogus"]}') $$, '23514', null, 'a key outside the reliefs in helped raises 23514');
select throws_ok($$ select public.update_episode('aaaaaaaa-0000-0000-0000-00000000000a', '{"did_not_help": ["bogus"]}') $$, '23514', null, 'a key outside the reliefs in did_not_help raises 23514');
select throws_ok($$ select public.update_episode('aaaaaaaa-0000-0000-0000-00000000000a', '{"helped": ["sleep", "sleep"]}') $$, '23514', null, 'a repeated relief raises 23514');
select throws_ok($$ select public.update_episode('aaaaaaaa-0000-0000-0000-00000000000a', '{"helped": "dark_room"}') $$, '22023', null, 'helped that is not an array raises 22023');

-- 2. debriefed stamps once and keeps the first time; false clears it.
select lives_ok($$ select public.update_episode('aaaaaaaa-0000-0000-0000-00000000000a', '{"debriefed": true}') $$, 'update_episode accepts debriefed true');
select is((select debriefed_at from public.episodes where id = 'aaaaaaaa-0000-0000-0000-00000000000a'), now(), 'debriefed true stamps debriefed_at with the server clock');
reset role;
-- now() is fixed inside this transaction, so an earlier stamp is set by hand to tell a repeat from a restamp.
update public.episodes set debriefed_at = '2026-11-21T09:00:00Z' where id = 'aaaaaaaa-0000-0000-0000-00000000000a';
set local role authenticated;
select lives_ok($$ select public.update_episode('aaaaaaaa-0000-0000-0000-00000000000a', '{"debriefed": true}') $$, 'a repeated debriefed true succeeds');
select is(
  (select debriefed_at from public.episodes where id = 'aaaaaaaa-0000-0000-0000-00000000000a'),
  '2026-11-21T09:00:00Z'::timestamptz,
  'a repeat keeps the first debriefed_at'
);
select lives_ok($$ select public.update_episode('aaaaaaaa-0000-0000-0000-00000000000a', '{"debriefed": false}') $$, 'update_episode accepts debriefed false');
select is((select debriefed_at from public.episodes where id = 'aaaaaaaa-0000-0000-0000-00000000000a'), null, 'debriefed false clears debriefed_at');
select throws_ok($$ select public.update_episode('aaaaaaaa-0000-0000-0000-00000000000a', '{"debriefed": "yes"}') $$, '22023', null, 'a debriefed that is not a boolean raises 22023');
select throws_ok($$ select public.update_episode('aaaaaaaa-0000-0000-0000-00000000000a', '{"debriefed": null}') $$, '22023', null, 'a null debriefed raises 22023');

-- 3. Both arrays in one patch, next to a Wave 2 key, and a replay changes nothing.
select lives_ok(
  $$ select public.update_episode('aaaaaaaa-0000-0000-0000-00000000000a', '{"helped": ["dark_room"], "did_not_help": ["caffeine"], "triggers": ["stress"], "debriefed": true}') $$,
  'update_episode accepts helped, did_not_help, triggers and debriefed together'
);
select lives_ok(
  $$ select public.update_episode('aaaaaaaa-0000-0000-0000-00000000000a', '{"helped": ["dark_room"], "did_not_help": ["caffeine"], "triggers": ["stress"], "debriefed": true}') $$,
  'the same debrief replayed succeeds'
);
select is(
  (select helped::text || ' ' || did_not_help::text || ' ' || triggers::text || ' ' || (debriefed_at is not null)::text
    from public.episodes where id = 'aaaaaaaa-0000-0000-0000-00000000000a'),
  '{dark_room} {caffeine} {stress} true',
  'helped, did_not_help, triggers and debriefed_at are stored'
);
select throws_ok($$ select public.update_episode('bbbbbbbb-0000-0000-0000-00000000000b', '{"debriefed": true}') $$, 'P0002', null, 'debriefing B''s episode raises P0002');

-- 4. set_dose_helped: set, cleared by omitting p_helped, idempotent, and only on the caller's dose.
select lives_ok($$ select public.set_dose_helped('aaaaaaaa-2000-0000-0000-00000000000a', true) $$, 'set_dose_helped sets true');
select is((select helped from public.doses where id = 'aaaaaaaa-2000-0000-0000-00000000000a'), true, 'the dose is marked helped');
select lives_ok($$ select public.set_dose_helped('aaaaaaaa-2000-0000-0000-00000000000a', false) $$, 'set_dose_helped sets false');
select lives_ok($$ select public.set_dose_helped('aaaaaaaa-2000-0000-0000-00000000000a', false) $$, 'a repeated set_dose_helped succeeds');
select is((select helped from public.doses where id = 'aaaaaaaa-2000-0000-0000-00000000000a'), false, 'the dose is marked as not helping');
select lives_ok($$ select public.set_dose_helped('aaaaaaaa-2000-0000-0000-00000000000a') $$, 'set_dose_helped without p_helped succeeds');
select is((select helped from public.doses where id = 'aaaaaaaa-2000-0000-0000-00000000000a'), null, 'a call without p_helped clears it');
select throws_ok($$ select public.set_dose_helped('bbbbbbbb-2000-0000-0000-00000000000b', true) $$, 'P0002', null, 'set_dose_helped on B''s dose raises P0002');
select throws_ok($$ select public.set_dose_helped('aaaaaaaa-2000-0000-0000-0000000000ff', true) $$, 'P0002', null, 'set_dose_helped on a missing dose raises P0002');

-- 5. agent_notes: read-own, no direct writes.
select is((select count(*)::int from public.agent_notes), 0, 'A sees none of B''s notes');
select throws_ok($$ insert into public.agent_notes (user_id, text) values ((select auth.uid()), 'x') $$, '42501', null, 'a direct insert into agent_notes is refused');
select throws_ok($$ update public.agent_notes set text = 'x' $$, '42501', null, 'a direct update of agent_notes is refused');
select throws_ok($$ delete from public.agent_notes $$, '42501', null, 'a direct delete from agent_notes is refused');

-- 7. Length and control characters, checked before the count fills up.
select throws_ok(format($$ select public.save_agent_note(%L) $$, repeat('a', 201)), '23514', null, 'a 201-character note raises 23514');
select throws_ok($$ select public.save_agent_note('   ') $$, '23514', null, 'a blank note raises 23514');
select throws_ok(format($$ select public.save_agent_note(%L) $$, 'bell' || chr(7)), '22023', null, 'a note with a control character raises 22023');
select throws_ok($$ select public.save_agent_note(null) $$, '22023', null, 'a null note raises 22023');

select isnt(public.save_agent_note('  Likes the dark room first  '), null, 'save_agent_note returns the new id');
select is((select text from public.agent_notes), 'Likes the dark room first', 'the note is stored trimmed, under the caller');
select lives_ok(format($$ select public.save_agent_note(%L) $$, repeat('b', 200)), 'a 200-character note is accepted');

-- 6. The 21st note is refused.
select lives_ok($$ select public.save_agent_note('note ' || g) from generate_series(1, 18) as g $$, 'notes up to 20 are accepted');
select is((select count(*)::int from public.agent_notes), 20, 'A has 20 notes');
select throws_ok($$ select public.save_agent_note('one too many') $$, '23514', null, 'the 21st note raises 23514');

-- 8. delete_agent_note: a foreign or missing row is a no-op; the caller's own goes.
select lives_ok($$ select public.delete_agent_note('bbbbbbbb-3000-0000-0000-00000000000b') $$, 'deleting B''s note succeeds as a no-op');
select lives_ok($$ select public.delete_agent_note('aaaaaaaa-3000-0000-0000-0000000000ff') $$, 'deleting a missing note succeeds as a no-op');
select lives_ok(
  $$ select public.delete_agent_note((select id from public.agent_notes where text = 'Likes the dark room first')) $$,
  'deleting an own note succeeds'
);
select is((select count(*)::int from public.agent_notes), 19, 'the own note is gone');

-- Signed out, every new RPC is refused.
select set_config('request.jwt.claims', '', true);
select throws_ok($$ select public.set_dose_helped('aaaaaaaa-2000-0000-0000-00000000000a', true) $$, '42501', null, 'set_dose_helped signed out raises 42501');
select throws_ok($$ select public.save_agent_note('x') $$, '42501', null, 'save_agent_note signed out raises 42501');
select throws_ok($$ select public.delete_agent_note('bbbbbbbb-3000-0000-0000-00000000000b') $$, '42501', null, 'delete_agent_note signed out raises 42501');

reset role;
select is((select count(*)::int from public.agent_notes where id = 'bbbbbbbb-3000-0000-0000-00000000000b'), 1, 'B''s note is still there');

-- 9. Privileges.
select ok(not has_function_privilege('anon', 'public.set_dose_helped(uuid, boolean)', 'execute'), 'anon cannot execute set_dose_helped');
select ok(not has_function_privilege('anon', 'public.save_agent_note(text)', 'execute'), 'anon cannot execute save_agent_note');
select ok(not has_function_privilege('anon', 'public.delete_agent_note(uuid)', 'execute'), 'anon cannot execute delete_agent_note');

select * from finish();

rollback;
