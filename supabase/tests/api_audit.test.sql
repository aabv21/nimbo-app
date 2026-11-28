-- The API audit's PostgREST pins (docs/audits/api.md): BOLA (B with A's ids changes nothing of A's), BOPLA (unknown
-- jsonb keys refused, the client's grants exactly as listed) and BFLA (no service-only RPC executable by a client).
begin;

create extension if not exists pgtap with schema extensions;

select plan(41);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'audit-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'audit-b@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

-- A's rows, seeded as the owner; B owns one medication so B's dose calls get past their own checks.
insert into public.episodes (id, user_id, started_at, ended_at, intensity, notes) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', now() - interval '3 hours', now() - interval '1 hour', 7, 'A note'),
  ('aaaaaaaa-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', now() - interval '30 minutes', null, 5, null);
insert into public.medications (id, user_id, name, kind, class) values
  ('aaaaaaaa-1000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Ibuprofen', 'acute', 'simple_analgesic'),
  ('bbbbbbbb-1000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'Naproxen', 'acute', 'simple_analgesic');
insert into public.doses (id, user_id, medication_id, episode_id, taken_at, helped) values
  ('aaaaaaaa-2000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-1000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-00000000000a', now() - interval '2 hours', true);
insert into public.checkins (user_id, local_date, alcohol) values
  ('11111111-1111-1111-1111-111111111111', current_date, true);
insert into public.agent_notes (id, user_id, text) values
  ('aaaaaaaa-3000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Prefers short answers');
insert into public.entitlements (user_id, granted) values ('11111111-1111-1111-1111-111111111111', true);

-- Everything of A's that B could reach, as one fingerprint per table, taken before B's calls.
create temporary table a_rows on commit drop as
select 'episodes' as name, md5(string_agg(t::text, '|' order by t.id)) as digest from public.episodes t where user_id = '11111111-1111-1111-1111-111111111111'
union all select 'medications', md5(string_agg(t::text, '|' order by t.id)) from public.medications t where user_id = '11111111-1111-1111-1111-111111111111'
union all select 'doses', md5(string_agg(t::text, '|' order by t.id)) from public.doses t where user_id = '11111111-1111-1111-1111-111111111111'
union all select 'checkins', md5(string_agg(t::text, '|' order by t.local_date)) from public.checkins t where user_id = '11111111-1111-1111-1111-111111111111'
union all select 'agent_notes', md5(string_agg(t::text, '|' order by t.id)) from public.agent_notes t where user_id = '11111111-1111-1111-1111-111111111111';

-- BOLA: B calls every client RPC that takes a row id with A's ids.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);

-- 1-4. Creating with A's id is a no-op for B (on conflict do nothing), never an overwrite.
select lives_ok(
  $$ select public.log_episode('aaaaaaaa-0000-0000-0000-00000000000a', now() - interval '10 minutes', '{"intensity": 1, "notes": "B was here"}') $$,
  'BOLA: log_episode with A''s episode id does not fail for B'
);
select lives_ok(
  $$ select public.log_dose('aaaaaaaa-2000-0000-0000-00000000000a', 'bbbbbbbb-1000-0000-0000-00000000000b', now() - interval '5 minutes') $$,
  'BOLA: log_dose with A''s dose id (and B''s own medication) does not fail for B'
);
select throws_ok(
  $$ select public.log_dose('bbbbbbbb-2000-0000-0000-000000000001', 'aaaaaaaa-1000-0000-0000-00000000000a', now() - interval '5 minutes') $$,
  'P0002', null, 'BOLA: log_dose naming A''s medication is not found for B'
);
select throws_ok(
  $$ select public.log_dose('bbbbbbbb-2000-0000-0000-000000000002', 'bbbbbbbb-1000-0000-0000-00000000000b', now() - interval '5 minutes', 'aaaaaaaa-0000-0000-0000-00000000000a') $$,
  'P0002', null, 'BOLA: log_dose attaching to A''s episode is not found for B'
);
-- 5-9. Changing A's rows reads as not found.
select throws_ok(
  $$ select public.save_medication('aaaaaaaa-1000-0000-0000-00000000000a', '{"name": "Renamed by B"}') $$,
  'P0002', null, 'BOLA: save_medication on A''s medication is not found for B'
);
select throws_ok(
  $$ select public.save_medication('aaaaaaaa-1000-0000-0000-00000000000a', '{"name": "Mine now", "kind": "acute", "class": "other"}') $$,
  'P0002', null, 'BOLA: a full save_medication on A''s medication id never inserts it as B''s'
);
select throws_ok(
  $$ select public.update_episode('aaaaaaaa-0000-0000-0000-00000000000a', '{"notes": "B was here", "intensity": 1}') $$,
  'P0002', null, 'BOLA: update_episode on A''s episode is not found for B'
);
select throws_ok(
  $$ select public.end_episode('aaaaaaaa-0000-0000-0000-00000000000b', now()) $$,
  'P0002', null, 'BOLA: end_episode on A''s open episode is not found for B'
);
select throws_ok(
  $$ select public.set_dose_helped('aaaaaaaa-2000-0000-0000-00000000000a', false) $$,
  'P0002', null, 'BOLA: set_dose_helped on A''s dose is not found for B'
);
-- 10-13. Deleting A's rows deletes nothing; save_checkin is keyed by the caller, so it writes B's own day.
select lives_ok($$ select public.delete_episode('aaaaaaaa-0000-0000-0000-00000000000a') $$, 'BOLA: delete_episode with A''s id answers like a missing row');
select lives_ok($$ select public.delete_dose('aaaaaaaa-2000-0000-0000-00000000000a') $$, 'BOLA: delete_dose with A''s id answers like a missing row');
select lives_ok($$ select public.delete_agent_note('aaaaaaaa-3000-0000-0000-00000000000a') $$, 'BOLA: delete_agent_note with A''s id answers like a missing row');
select lives_ok($$ select public.save_checkin(current_date, '{"alcohol": false}') $$, 'BOLA: save_checkin for the same day writes B''s own row');

-- 14-15. Reads keyed by a user id.
select is(
  public.record_inputs('11111111-1111-1111-1111-111111111111', now() - interval '30 days'),
  '{"timeZone": null, "onboardedAt": null, "hasLocation": false, "knownTriggers": [], "episodes": [], "checkins": [], "doses": [], "medications": []}'::jsonb,
  'BOLA: record_inputs(A) called by B returns empty arrays'
);
select throws_ok(
  $$ select public.has_premium('11111111-1111-1111-1111-111111111111') $$,
  '42501', null, 'BOLA: has_premium(A) called by B raises 42501'
);

reset role;

-- 16-20. A's rows are byte for byte what they were.
select is(
  (select md5(string_agg(t::text, '|' order by t.id)) from public.episodes t where user_id = '11111111-1111-1111-1111-111111111111'),
  (select digest from a_rows where name = 'episodes'),
  'BOLA: A''s episodes are unchanged after B''s calls'
);
select is(
  (select md5(string_agg(t::text, '|' order by t.id)) from public.medications t where user_id = '11111111-1111-1111-1111-111111111111'),
  (select digest from a_rows where name = 'medications'),
  'BOLA: A''s medications are unchanged after B''s calls'
);
select is(
  (select md5(string_agg(t::text, '|' order by t.id)) from public.doses t where user_id = '11111111-1111-1111-1111-111111111111'),
  (select digest from a_rows where name = 'doses'),
  'BOLA: A''s doses are unchanged after B''s calls'
);
select is(
  (select md5(string_agg(t::text, '|' order by t.local_date)) from public.checkins t where user_id = '11111111-1111-1111-1111-111111111111'),
  (select digest from a_rows where name = 'checkins'),
  'BOLA: A''s check-ins are unchanged after B''s calls'
);
select is(
  (select md5(string_agg(t::text, '|' order by t.id)) from public.agent_notes t where user_id = '11111111-1111-1111-1111-111111111111'),
  (select digest from a_rows where name = 'agent_notes'),
  'BOLA: A''s agent notes are unchanged after B''s calls'
);
-- 21. Nothing B did landed under A's ids as B's row either.
select is(
  (select count(*)::int from public.episodes where user_id = '22222222-2222-2222-2222-222222222222' and id = 'aaaaaaaa-0000-0000-0000-00000000000a')
    + (select count(*)::int from public.doses where user_id = '22222222-2222-2222-2222-222222222222' and id = 'aaaaaaaa-2000-0000-0000-00000000000a')
    + (select count(*)::int from public.medications where user_id = '22222222-2222-2222-2222-222222222222' and id = 'aaaaaaaa-1000-0000-0000-00000000000a'),
  0,
  'BOLA: no row of B''s carries one of A''s ids'
);

-- BOPLA / mass assignment: every client RPC with a jsonb argument refuses a key outside its list (here, user_id).
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);

-- 22-26.
select throws_ok(
  $$ select public.log_episode('bbbbbbbb-0000-0000-0000-000000000001', now(), '{"user_id": "11111111-1111-1111-1111-111111111111"}') $$,
  '22023', null, 'BOPLA: log_episode refuses a user_id key'
);
select throws_ok(
  $$ select public.update_episode('bbbbbbbb-0000-0000-0000-000000000001', '{"user_id": "11111111-1111-1111-1111-111111111111"}') $$,
  '22023', null, 'BOPLA: update_episode refuses a user_id key'
);
select throws_ok(
  $$ select public.save_medication('bbbbbbbb-1000-0000-0000-00000000000b', '{"user_id": "11111111-1111-1111-1111-111111111111"}') $$,
  '22023', null, 'BOPLA: save_medication refuses a user_id key'
);
select throws_ok(
  $$ select public.save_checkin(current_date, '{"user_id": "11111111-1111-1111-1111-111111111111"}') $$,
  '22023', null, 'BOPLA: save_checkin refuses a user_id key'
);
select throws_ok(
  $$ select public.save_medication('bbbbbbbb-1000-0000-0000-00000000000b', '{"archived_at": "2000-01-01T00:00:00Z"}') $$,
  '22023', null, 'BOPLA: save_medication refuses a column name it does not list (archived_at)'
);

reset role;

-- 27. The four RPCs above are every client-executable function with a jsonb argument; a new one fails here until its
-- check_keys call is pinned above.
select set_eq(
  $$
    select p.proname::text
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and 'jsonb'::regtype::oid = any (p.proargtypes::oid[])
      and has_function_privilege('authenticated', p.oid, 'execute')
  $$,
  $$ values ('log_episode'), ('update_episode'), ('save_medication'), ('save_checkin') $$,
  'BOPLA: the client RPCs with a jsonb argument are exactly the four whose key lists are pinned'
);

-- 28. A client updates only the profile's settings columns: no consent stamp, version, onboarding stamp or user id.
select set_eq(
  $$
    select column_name::text
    from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'profiles' and grantee = 'authenticated' and privilege_type = 'UPDATE'
  $$,
  $$
    values ('language'), ('timezone'), ('theme'), ('reduce_motion'), ('notify_start'), ('notify_end'), ('notify_daily_cap'),
      ('lock_screen_detail'), ('coarse_lat'), ('coarse_lon'), ('known_triggers'), ('priority'), ('track_period')
  $$,
  'BOPLA: authenticated may update exactly the thirteen profile settings columns'
);
-- 29. No other column grant lets a client write anywhere.
select is_empty(
  $$
    select table_name::text || '.' || column_name::text || ' ' || privilege_type::text
    from information_schema.column_privileges
    where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type in ('INSERT', 'UPDATE', 'REFERENCES')
      and not (table_name = 'profiles' and grantee = 'authenticated' and privilege_type = 'UPDATE')
  $$,
  'BOPLA: no insert, reference or other update column grant exists for a client'
);
-- 30. Table grants: select on the read-own tables, delete on push_tokens (RLS delete-own, for sign-out), nothing else.
select set_eq(
  $$
    select table_name::text || ' ' || privilege_type::text
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'authenticated'
  $$,
  $$
    values ('profiles SELECT'), ('episodes SELECT'), ('medications SELECT'), ('doses SELECT'), ('checkins SELECT'),
      ('agent_notes SELECT'), ('entitlements SELECT'), ('signals SELECT'), ('consent_texts SELECT'), ('consent_events SELECT'),
      ('push_tokens DELETE')
  $$,
  'BOPLA: authenticated holds only these table grants'
);
-- 31.
select is_empty(
  $$ select table_name::text from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon' $$,
  'BOPLA: anon holds no table grant in public'
);

-- BFLA: the service-only RPCs.
-- 32-39.
select ok(
  not has_function_privilege('authenticated', 'public.consume_quota(uuid, public.quota_kind, integer, date)', 'execute')
    and not has_function_privilege('anon', 'public.consume_quota(uuid, public.quota_kind, integer, date)', 'execute'),
  'BFLA: no client executes consume_quota'
);
select ok(
  not has_function_privilege('authenticated', 'public.monitor_targets()', 'execute')
    and not has_function_privilege('anon', 'public.monitor_targets()', 'execute'),
  'BFLA: no client executes monitor_targets'
);
select ok(
  not has_function_privilege('authenticated', 'public.save_signals(uuid, date, jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.save_signals(uuid, date, jsonb)', 'execute'),
  'BFLA: no client executes save_signals'
);
select ok(
  not has_function_privilege('authenticated', 'public.claim_signal_push(uuid, text, text, integer, integer)', 'execute')
    and not has_function_privilege('anon', 'public.claim_signal_push(uuid, text, text, integer, integer)', 'execute'),
  'BFLA: no client executes claim_signal_push'
);
select ok(
  not has_function_privilege('authenticated', 'public.start_push_claim(uuid, text, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.start_push_claim(uuid, text, text, text)', 'execute')
    and not has_function_privilege('authenticated', 'public.push_claim_attempt(uuid, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.push_claim_attempt(uuid, text, text)', 'execute')
    and not has_function_privilege('authenticated', 'public.finish_push_claim(uuid, text, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.finish_push_claim(uuid, text, text, text)', 'execute'),
  'BFLA: no client executes the push claim RPCs'
);
select ok(
  not has_function_privilege('authenticated', 'public.prune_expired_caches()', 'execute')
    and not has_function_privilege('anon', 'public.prune_expired_caches()', 'execute'),
  'BFLA: no client executes prune_expired_caches'
);
select ok(
  not has_function_privilege('authenticated', 'public.request_monitor()', 'execute')
    and not has_function_privilege('anon', 'public.request_monitor()', 'execute'),
  'BFLA: no client executes request_monitor'
);
select ok(
  not has_function_privilege('authenticated', 'public.save_push_tickets(uuid, jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.push_receipts_due(integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.forget_push_tickets(text[])', 'execute')
    and not has_function_privilege('anon', 'public.save_push_tickets(uuid, jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.push_receipts_due(integer)', 'execute')
    and not has_function_privilege('anon', 'public.forget_push_tickets(text[])', 'execute'),
  'BFLA: no client executes the push ticket RPCs'
);

-- 40. Every public function a client can execute is on this list; a new one fails here until it is reviewed and added.
-- keep_alive reaches authenticated through Supabase's default privileges (it returns now(), nothing else).
select set_eq(
  $$
    select p.proname::text
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
  $$,
  $$
    values ('keep_alive'), ('catalog_keys'), ('is_catalog_subset'), ('log_episode'), ('update_episode'), ('end_episode'),
      ('delete_episode'), ('save_medication'), ('log_dose'), ('delete_dose'), ('save_checkin'), ('complete_onboarding'),
      ('has_premium'), ('set_dose_helped'), ('save_agent_note'), ('delete_agent_note'), ('record_inputs'),
      ('register_push_token'), ('accept_terms'), ('set_ai_consent')
  $$,
  'BFLA: authenticated executes exactly the reviewed client functions'
);
-- 41.
select set_eq(
  $$
    select p.proname::text
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
  $$,
  $$ values ('keep_alive') $$,
  'BFLA: anon executes nothing in public but keep_alive'
);

select * from finish();
rollback;
