-- The hourly monitor's database side: the profiles.timezone check, monitor_targets(), save_signals() and its push
-- log, claim_signal_push() and each rule it re-checks, the push_tickets queue and its RPCs, request_monitor() with
-- and without the Vault secrets, the monitor job, the prune of signals and tickets, and who may call what.
begin;

create extension if not exists pgtap with schema extensions;

select plan(53);

-- A: onboarded with a token; B: no zone; C: not onboarded; D: onboarded, no token; E, F, G: one claim rule each.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
select ('00000000-0000-4000-8000-00000000000' || n)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'monitor-' || n || '@example.com', crypt('password', gen_salt('bf')), '{}', '{}'
from unnest(array['a', 'b', 'c', 'd', 'e', 'f']) n;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values ('00000000-0000-4000-8000-000000000010', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'monitor-g@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

create temporary table who (name text primary key, id uuid) on commit drop;
insert into who values
  ('a', '00000000-0000-4000-8000-00000000000a'), ('b', '00000000-0000-4000-8000-00000000000b'),
  ('c', '00000000-0000-4000-8000-00000000000c'), ('d', '00000000-0000-4000-8000-00000000000d'),
  ('e', '00000000-0000-4000-8000-00000000000e'), ('f', '00000000-0000-4000-8000-00000000000f'),
  ('g', '00000000-0000-4000-8000-000000000010');
grant select on who to authenticated;

update public.profiles
set timezone = 'America/Bogota', onboarding_completed_at = now() - interval '60 days', language = 'es'
where user_id in (select id from who where name in ('a', 'd', 'e', 'f', 'g'));
update public.profiles set timezone = 'America/Bogota' where user_id = (select id from who where name = 'c');
-- A's window is empty (start = end), so A is outside it whatever the hour.
update public.profiles set notify_start = '09:00', notify_end = '09:00', known_triggers = '{weather}', coarse_lat = 4.6, coarse_lon = -74.1
where user_id = (select id from who where name = 'a');

insert into public.push_tokens (user_id, token, platform, device_secret_hash)
select id, 'ExponentPushToken[monitor-' || name || ']', 'android', repeat('ab', 32)
from who where name in ('a', 'e', 'f', 'g');

-- 1. The timezone check, as the signed-in owner writes it.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-00000000000b', 'role', 'authenticated')::text, true);

select throws_ok($$ update public.profiles set timezone = 'EST' $$, '22023', 'timezone: not an IANA zone name', 'EST (an abbreviation) is refused');
select throws_ok($$ update public.profiles set timezone = 'UTC+3' $$, '22023', null, 'UTC+3 (a POSIX offset) is refused');
select throws_ok($$ update public.profiles set timezone = 'Mars/Base' $$, '22023', null, 'Mars/Base (no such zone) is refused');
select throws_ok($$ update public.profiles set timezone = 'posix/America/Bogota' $$, '22023', null, 'a posix/ copy is refused');
select lives_ok($$ update public.profiles set timezone = 'America/Santiago' $$, 'America/Santiago is saved');
select is((select timezone from public.profiles), 'America/Santiago', 'and reads back');
select lives_ok($$ update public.profiles set timezone = 'UTC' $$, 'UTC is saved');
select lives_ok($$ update public.profiles set timezone = null $$, 'a null zone is saved');

reset role;

select ok(
  exists (select 1 from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'profiles_check_timezone' and not tgisinternal),
  'the trigger is on profiles'
);

-- 2. monitor_targets(): every onboarded user with a zone, whatever their window.
select is(
  array(select user_id from public.monitor_targets() where user_id in (select id from who) order by user_id),
  array(select id from who where name in ('a', 'd', 'e', 'f', 'g') order by id),
  'A, D, E, F and G are targets; B (no zone) and C (not onboarded) are not'
);
select results_eq(
  $$ select timezone, notify_start, notify_end, notify_daily_cap::int, lock_screen_detail, language, coarse_lat, coarse_lon, known_triggers
     from public.monitor_targets() where user_id = '00000000-0000-4000-8000-00000000000a' $$,
  $$ values ('America/Bogota', '09:00'::time, '09:00'::time, 2, false, 'es', 4.6::numeric, -74.1::numeric, '{weather}'::text[]) $$,
  'A is a target outside an (empty) window, with what the function needs'
);

-- 3. save_signals().
set local role service_role;

select is(
  (select count(*)::int from public.save_signals('00000000-0000-4000-8000-00000000000a', current_date, $$[
    {"kind": "pressure", "cause": "pressure", "causeKey": "pressure:k1", "evidence": {"nowHpa": 1012, "laterHpa": 1006, "laterAt": "2026-11-28T13:00:00Z", "dropHpa": 6.5}},
    {"kind": "quiet_tracker", "cause": "quiet_tracker", "causeKey": "quiet:2026-11-20", "evidence": {"lastCheckinDate": "2026-11-20"}},
    {"kind": "debrief_due", "cause": "debrief:e1", "causeKey": "debrief:e1", "evidence": {"episodeId": "e1", "endedAt": "2026-11-26T18:00:00Z"}},
    {"kind": "overuse_warn", "cause": "overuse:triptan", "causeKey": "overuse:triptan:warn:2026-11", "evidence": {"scope": "triptan", "days": 8, "limit": 10, "level": "warn"}}
  ]$$::jsonb)),
  0,
  'a first save stores the rows and answers an empty push log'
);
select is((select count(*)::int from public.signals where user_id = '00000000-0000-4000-8000-00000000000a'), 4, 'four rows');

reset role;
update public.signals set pushed_at = now() - interval '1 hour', computed_at = now() - interval '1 hour'
where user_id = '00000000-0000-4000-8000-00000000000a' and cause_key = 'pressure:k1';
update public.signals set pushed_at = now() - interval '3 days'
where user_id = '00000000-0000-4000-8000-00000000000a' and cause_key in ('debrief:e1', 'overuse:triptan:warn:2026-11');
set local role service_role;

create temporary table log1 on commit drop as
select * from public.save_signals('00000000-0000-4000-8000-00000000000a', current_date, $$[
  {"kind": "pressure", "cause": "pressure", "causeKey": "pressure:k1", "evidence": {"nowHpa": 1012, "laterHpa": 1005, "laterAt": "2026-11-28T13:00:00Z", "dropHpa": 7.0}},
  {"kind": "debrief_due", "cause": "debrief:e1", "causeKey": "debrief:e1", "evidence": {"episodeId": "e1", "endedAt": "2026-11-26T18:00:00Z"}}
]$$::jsonb);

select ok(
  (select pushed_at between now() - interval '61 minutes' and now() - interval '59 minutes' and computed_at = now() and evidence ->> 'dropHpa' = '7.0'
   from public.signals where user_id = '00000000-0000-4000-8000-00000000000a' and cause_key = 'pressure:k1'),
  'an upsert keeps pushed_at and refreshes the evidence and computed_at'
);
select is(
  (select count(*)::int from public.signals where user_id = '00000000-0000-4000-8000-00000000000a' and cause_key = 'quiet:2026-11-20'),
  0,
  'an unpushed row missing from the new set is deleted'
);
select is(
  (select count(*)::int from public.signals where user_id = '00000000-0000-4000-8000-00000000000a' and cause_key = 'overuse:triptan:warn:2026-11'),
  1,
  'a pushed row missing from the new set is kept'
);
select is(
  array(select cause_key from log1 order by cause_key),
  array['debrief:e1', 'pressure:k1'],
  'the push log: the push an hour ago, and the one 3 days ago whose key is in the set (not the old one outside it)'
);

-- 4. claim_signal_push().
select results_eq(
  $$ select token, language from public.claim_signal_push('00000000-0000-4000-8000-00000000000a', 'overuse:triptan:warn:2026-11', 'America/Bogota', 2, 24) $$,
  $$ select null::text, null::text where false $$,
  'an already pushed key claims nothing'
);

reset role;
update public.signals set pushed_at = null where user_id = '00000000-0000-4000-8000-00000000000a' and cause_key = 'pressure:k1';
set local role service_role;

select results_eq(
  $$ select token, language from public.claim_signal_push('00000000-0000-4000-8000-00000000000a', 'pressure:k1', 'America/Bogota', 2, 24) $$,
  $$ values ('ExponentPushToken[monitor-a]', 'es') $$,
  'the claim answers the token with the profile language'
);
select ok(
  (select pushed_at = now() from public.signals where user_id = '00000000-0000-4000-8000-00000000000a' and cause_key = 'pressure:k1'),
  'and stamps pushed_at'
);
select is(
  (select count(*)::int from public.claim_signal_push('00000000-0000-4000-8000-00000000000a', 'pressure:k1', 'America/Bogota', 2, 24)),
  0,
  'a second identical claim answers no row'
);
select is(
  (select count(*)::int from public.claim_signal_push('00000000-0000-4000-8000-00000000000a', 'no-such-key', 'America/Bogota', 2, 24)),
  0,
  'a key with no row claims nothing'
);

-- The cap: E pushed another cause at 08:00 local today.
reset role;
insert into public.signals (user_id, kind, cause, cause_key, local_date, evidence, pushed_at) values
  ('00000000-0000-4000-8000-00000000000e', 'debrief_due', 'debrief:e9', 'debrief:e9', current_date, '{}',
   ((now() at time zone 'America/Bogota')::date + time '08:00') at time zone 'America/Bogota'),
  ('00000000-0000-4000-8000-00000000000e', 'pressure', 'pressure', 'pressure:e', current_date, '{}', null);
set local role service_role;

select is(
  (select count(*)::int from public.claim_signal_push('00000000-0000-4000-8000-00000000000e', 'pressure:e', 'America/Bogota', 1, 24)),
  0,
  'with a cap of 1 and a push at 08:00 local today, nothing is claimed'
);

reset role;
update public.signals
set pushed_at = ((now() at time zone 'America/Bogota')::date - 1 + time '23:30') at time zone 'America/Bogota'
where user_id = '00000000-0000-4000-8000-00000000000e' and cause_key = 'debrief:e9';
set local role service_role;

select is(
  (select count(*)::int from public.claim_signal_push('00000000-0000-4000-8000-00000000000e', 'pressure:e', 'America/Bogota', 1, 24)),
  1,
  'a push at 23:30 local yesterday does not count against today''s cap'
);

-- The 24-hour cause rule: F pushed the same cause 22 hours ago.
reset role;
insert into public.signals (user_id, kind, cause, cause_key, local_date, evidence, pushed_at) values
  ('00000000-0000-4000-8000-00000000000f', 'pressure', 'pressure', 'pressure:f-old', current_date - 1, '{}', now() - interval '22 hours'),
  ('00000000-0000-4000-8000-00000000000f', 'pressure', 'pressure', 'pressure:f-new', current_date, '{}', null);
set local role service_role;

select is(
  (select count(*)::int from public.claim_signal_push('00000000-0000-4000-8000-00000000000f', 'pressure:f-new', 'America/Bogota', 2, 24)),
  0,
  'the same cause pushed 22 hours ago blocks the claim'
);
select is(
  (select count(*)::int from public.claim_signal_push('00000000-0000-4000-8000-00000000000f', 'pressure:f-new', 'America/Bogota', 2, 20)),
  1,
  'and does not once it is past the given hours'
);

-- A quiet stretch already pushed: quiet:never (its last check-in out of the window) is the same stretch.
reset role;
insert into public.signals (user_id, kind, cause, cause_key, local_date, evidence, pushed_at) values
  ('00000000-0000-4000-8000-000000000010', 'quiet_tracker', 'quiet_tracker', 'quiet:2026-08-20', '2026-08-23', '{"lastCheckinDate": "2026-08-20"}', now() - interval '90 days'),
  ('00000000-0000-4000-8000-000000000010', 'quiet_tracker', 'quiet_tracker', 'quiet:never', current_date, '{"lastCheckinDate": null}', null);
set local role service_role;

select is(
  (select count(*)::int from public.claim_signal_push('00000000-0000-4000-8000-000000000010', 'quiet:never', 'America/Bogota', 2, 24)),
  0,
  'quiet:never is not claimed after a dated quiet stretch was pushed'
);

-- No token: nothing claimed and pushed_at stays null.
reset role;
insert into public.signals (user_id, kind, cause, cause_key, local_date, evidence) values
  ('00000000-0000-4000-8000-00000000000d', 'pressure', 'pressure', 'pressure:d', current_date, '{}');
set local role service_role;

select is(
  (select count(*)::int from public.claim_signal_push('00000000-0000-4000-8000-00000000000d', 'pressure:d', 'America/Bogota', 2, 24)),
  0,
  'a user with no token gets no row'
);
select is(
  (select pushed_at from public.signals where user_id = '00000000-0000-4000-8000-00000000000d' and cause_key = 'pressure:d'),
  null,
  'and pushed_at stays null'
);
select is(
  (select count(*)::int from public.claim_signal_push('00000000-0000-4000-8000-00000000000d', 'pressure:d', 'EST', 2, 24)),
  0,
  'a zone that is not an IANA name claims nothing (and does not throw)'
);

-- 5. The tickets.
select lives_ok(
  $$ select public.save_push_tickets('00000000-0000-4000-8000-00000000000a', '[{"id": "t-20m", "token": "ExponentPushToken[monitor-a]"}, {"id": "t-5m", "token": "ExponentPushToken[monitor-a]"}, {"id": "t-25h", "token": "ExponentPushToken[monitor-a]"}]') $$,
  'save_push_tickets stores the tickets'
);
select lives_ok(
  $$ select public.save_push_tickets('00000000-0000-4000-8000-00000000000a', '[{"id": "t-20m", "token": "ExponentPushToken[monitor-a]"}]') $$,
  'and a ticket saved twice is ignored'
);
select throws_ok($$ select public.save_push_tickets('00000000-0000-4000-8000-00000000000a', '{}') $$, '22023', null, 'tickets that are not an array are refused');

reset role;
update public.push_tickets set created_at = now() - interval '20 minutes' where ticket_id = 't-20m';
update public.push_tickets set created_at = now() - interval '5 minutes' where ticket_id = 't-5m';
update public.push_tickets set created_at = now() - interval '25 hours' where ticket_id = 't-25h';
set local role service_role;

select results_eq(
  $$ select ticket_id, token from public.push_receipts_due() where ticket_id like 't-%' $$,
  $$ values ('t-20m', 'ExponentPushToken[monitor-a]') $$,
  'receipts are due for a ticket 20 minutes old, not one 5 minutes or 25 hours old'
);
select lives_ok($$ select public.forget_push_tickets(array['t-20m']) $$, 'forget_push_tickets runs');
select is((select count(*)::int from public.push_tickets where ticket_id like 't-%'), 2, 'and deletes the checked ticket');

reset role;

-- 6. The table and the privileges.
select ok((select relrowsecurity from pg_class where oid = 'public.push_tickets'::regclass), 'push_tickets has RLS on');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'push_tickets'), 0, 'and no policy');
select has_index('public', 'push_tickets', 'push_tickets_created_at_idx', 'push_tickets has an index on created_at');

select ok(
  not has_function_privilege('authenticated', 'public.monitor_targets()', 'execute')
    and not has_function_privilege('authenticated', 'public.save_signals(uuid, date, jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.claim_signal_push(uuid, text, text, integer, integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.save_push_tickets(uuid, jsonb)', 'execute')
    and not has_function_privilege('authenticated', 'public.push_receipts_due(integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.forget_push_tickets(text[])', 'execute')
    and not has_function_privilege('authenticated', 'public.request_monitor()', 'execute')
    and not has_function_privilege('authenticated', 'public.profiles_check_timezone()', 'execute'),
  'authenticated can execute none of the monitor''s functions'
);
select ok(
  not has_function_privilege('anon', 'public.monitor_targets()', 'execute')
    and not has_function_privilege('anon', 'public.save_signals(uuid, date, jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.claim_signal_push(uuid, text, text, integer, integer)', 'execute')
    and not has_function_privilege('anon', 'public.save_push_tickets(uuid, jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.push_receipts_due(integer)', 'execute')
    and not has_function_privilege('anon', 'public.forget_push_tickets(text[])', 'execute')
    and not has_function_privilege('anon', 'public.request_monitor()', 'execute'),
  'nor can anon'
);
select ok(
  has_function_privilege('service_role', 'public.monitor_targets()', 'execute')
    and has_function_privilege('service_role', 'public.save_signals(uuid, date, jsonb)', 'execute')
    and has_function_privilege('service_role', 'public.claim_signal_push(uuid, text, text, integer, integer)', 'execute')
    and has_function_privilege('service_role', 'public.save_push_tickets(uuid, jsonb)', 'execute')
    and has_function_privilege('service_role', 'public.push_receipts_due(integer)', 'execute')
    and has_function_privilege('service_role', 'public.forget_push_tickets(text[])', 'execute'),
  'the service role can execute the RPCs'
);
select ok(
  (select bool_and(prosecdef and proconfig @> array['search_path=""'])
   from pg_proc where oid in ('public.monitor_targets()'::regprocedure, 'public.save_signals(uuid, date, jsonb)'::regprocedure,
     'public.claim_signal_push(uuid, text, text, integer, integer)'::regprocedure, 'public.save_push_tickets(uuid, jsonb)'::regprocedure,
     'public.push_receipts_due(integer)'::regprocedure, 'public.forget_push_tickets(text[])'::regprocedure,
     'public.request_monitor()'::regprocedure, 'public.profiles_check_timezone()'::regprocedure)),
  'every one is a security definer with an empty search_path'
);
select is(
  (select pg_get_userbyid(proowner)::text from pg_proc where oid = 'public.request_monitor()'::regprocedure),
  'postgres',
  'request_monitor() is owned by postgres, as the job runs it'
);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-4000-8000-00000000000a', 'role', 'authenticated')::text, true);
select throws_ok($$ select * from public.push_tickets $$, '42501', null, 'authenticated cannot select push_tickets');
select throws_ok($$ select * from public.monitor_targets() $$, '42501', null, 'authenticated cannot call monitor_targets');
reset role;
set local role anon;
select throws_ok($$ select * from public.push_tickets $$, '42501', null, 'anon cannot select push_tickets');
reset role;

-- 7. The job and its pg_net call.
select is(
  (select schedule || ' | ' || command || ' | ' || active::text from cron.job where jobname = 'monitor'),
  '5 * * * * | select public.request_monitor() | true',
  'the monitor job runs at :05 every hour'
);

delete from vault.secrets where name in ('monitor_url', 'monitor_secret');
select lives_ok($$ select public.request_monitor() $$, 'without the Vault secrets the job does nothing and succeeds');
select is((select count(*)::int from net.http_request_queue where url = 'http://example.test/functions/v1/monitor'), 0, 'and sends nothing');

select vault.create_secret('http://example.test/functions/v1/monitor', 'monitor_url');
select vault.create_secret('monitor-test-secret', 'monitor_secret');
select public.request_monitor();
select results_eq(
  $$ select method::text, headers ->> 'x-webhook-secret', timeout_milliseconds from net.http_request_queue where url = 'http://example.test/functions/v1/monitor' $$,
  $$ values ('POST', 'monitor-test-secret', 30000) $$,
  'with them it posts once to the Vault URL with the secret header and a 30 s timeout'
);

-- 8. The prune.
insert into public.signals (user_id, kind, cause, cause_key, local_date, evidence, computed_at, pushed_at) values
  ('00000000-0000-4000-8000-00000000000d', 'pressure', 'pressure', 'pressure:stale', current_date - 31, '{}', now() - interval '31 days', null),
  ('00000000-0000-4000-8000-00000000000d', 'debrief_due', 'debrief:old', 'debrief:old', current_date - 31, '{}', now() - interval '31 days', now() - interval '31 days'),
  ('00000000-0000-4000-8000-00000000000d', 'quiet_tracker', 'quiet_tracker', 'quiet:old', current_date - 60, '{}', now() - interval '57 days', now() - interval '57 days'),
  ('00000000-0000-4000-8000-00000000000d', 'quiet_tracker', 'quiet_tracker', 'quiet:newest', current_date - 40, '{}', now() - interval '37 days', now() - interval '37 days'),
  ('00000000-0000-4000-8000-00000000000d', 'pressure', 'pressure', 'pressure:fresh', current_date - 29, '{}', now() - interval '29 days', null);
update public.push_tickets set created_at = now() - interval '3 days' where ticket_id = 't-25h';
update public.push_tickets set created_at = now() - interval '1 day' where ticket_id = 't-5m';
select public.prune_expired_caches();

select is(
  array(select cause_key from public.signals where user_id = '00000000-0000-4000-8000-00000000000d' order by cause_key),
  array['pressure:d', 'pressure:fresh', 'quiet:newest'],
  'the prune drops signals 30 days stale, pushed or not, but keeps the newest pushed quiet stretch'
);
select is(array(select ticket_id from public.push_tickets where ticket_id like 't-%'), array['t-5m'], 'and tickets over 2 days old');

select * from finish();

rollback;
