-- signals: read-own RLS, no client writes, one row per (user, cause key), the kind and evidence checks, the
-- indexes, and the cascade from auth.users.
begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-b@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

-- Seeded as the table owner, as the monitor's service role will.
insert into public.signals (id, user_id, kind, cause, cause_key, local_date, evidence) values
  ('aaaaaaaa-5000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'pressure', 'pressure', 'pressure:2026-11-27', '2026-11-27',
   '{"nowHpa": 1012, "laterHpa": 1006, "laterAt": "2026-11-28T13:00:00Z", "dropHpa": 6.5}'),
  ('aaaaaaaa-5000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111', 'quiet_tracker', 'quiet_tracker', 'quiet:2026-11-23', '2026-11-27',
   '{"lastCheckinDate": "2026-11-23"}'),
  ('bbbbbbbb-5000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'pressure', 'pressure', 'pressure:2026-11-27', '2026-11-27',
   '{"nowHpa": 1010, "laterHpa": 1003, "laterAt": "2026-11-28T13:00:00Z", "dropHpa": 7.0}');

-- 1. The table.
select ok((select relrowsecurity from pg_class where oid = 'public.signals'::regclass), 'RLS is on');
select is(
  (select array_agg(policyname::text || ':' || cmd order by policyname) from pg_policies where schemaname = 'public' and tablename = 'signals'),
  array['signals_select_own:SELECT'],
  'the only policy is the read-own select'
);
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'signals' and indexname = 'signals_user_pushed_idx'
          and indexdef like '%(user_id, pushed_at)%WHERE (pushed_at IS NOT NULL)%'),
  'a partial index on (user_id, pushed_at) for the pushed rows'
);
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'signals' and indexname = 'signals_user_date_idx'
          and indexdef like '%(user_id, local_date)%'),
  'an index on (user_id, local_date) for one day''s rows'
);

-- 2. Reads and writes as user A.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

select is(
  array(select cause_key from public.signals order by cause_key),
  array['pressure:2026-11-27', 'quiet:2026-11-23'],
  'A reads only A''s rows'
);
select is(
  (select count(*)::int from public.signals where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'A cannot see B''s row even by its user id'
);
select throws_ok(
  $$ insert into public.signals (user_id, kind, cause, cause_key, local_date, evidence)
     values ('11111111-1111-1111-1111-111111111111', 'pressure', 'pressure', 'pressure:2026-11-28', '2026-11-28', '{}') $$,
  '42501', null, 'authenticated cannot insert'
);
select throws_ok(
  $$ update public.signals set pushed_at = now() where id = 'aaaaaaaa-5000-0000-0000-00000000000a' $$,
  '42501', null, 'authenticated cannot update'
);
select throws_ok(
  $$ delete from public.signals where id = 'aaaaaaaa-5000-0000-0000-00000000000a' $$,
  '42501', null, 'authenticated cannot delete'
);

reset role;
set local role anon;

select throws_ok($$ select * from public.signals $$, '42501', null, 'anon cannot select');
select throws_ok(
  $$ insert into public.signals (user_id, kind, cause, cause_key, local_date, evidence)
     values ('11111111-1111-1111-1111-111111111111', 'pressure', 'pressure', 'pressure:2026-11-28', '2026-11-28', '{}') $$,
  '42501', null, 'anon cannot insert'
);

reset role;
set local role service_role;

select lives_ok(
  $$ insert into public.signals (user_id, kind, cause, cause_key, local_date, evidence)
     values ('22222222-2222-2222-2222-222222222222', 'debrief_due', 'debrief:e1', 'debrief:e1', '2026-11-27', '{"episodeId": "e1", "endedAt": "2026-11-27T01:00:00Z"}') $$,
  'the service role inserts'
);
select lives_ok(
  $$ update public.signals set pushed_at = now() where cause_key = 'debrief:e1' $$,
  'the service role stamps a push'
);

reset role;

-- 3. The constraints.
select throws_ok(
  $$ insert into public.signals (user_id, kind, cause, cause_key, local_date, evidence)
     values ('11111111-1111-1111-1111-111111111111', 'pressure', 'pressure', 'pressure:2026-11-27', '2026-11-27', '{}') $$,
  '23505', null, 'a second row with the same (user_id, cause_key) is refused'
);
select lives_ok(
  $$ insert into public.signals (user_id, kind, cause, cause_key, local_date, evidence)
     values ('22222222-2222-2222-2222-222222222222', 'quiet_tracker', 'quiet_tracker', 'quiet:2026-11-23', '2026-11-27', '{"lastCheckinDate": "2026-11-23"}') $$,
  'the same cause key for another user is fine'
);
select throws_ok(
  $$ insert into public.signals (user_id, kind, cause, cause_key, local_date, evidence)
     values ('11111111-1111-1111-1111-111111111111', 'storm', 'storm', 'storm:2026-11-27', '2026-11-27', '{}') $$,
  '23514', null, 'kind storm is refused'
);
select throws_ok(
  $$ insert into public.signals (user_id, kind, cause, cause_key, local_date, evidence)
     values ('11111111-1111-1111-1111-111111111111', 'pressure', 'pressure', 'pressure:2026-11-29', '2026-11-29', '[1012, 1006]') $$,
  '23514', null, 'an evidence that is not an object is refused'
);
select throws_ok(
  $$ insert into public.signals (user_id, kind, cause, cause_key, local_date, evidence)
     values ('11111111-1111-1111-1111-111111111111', 'pressure', '', 'pressure:2026-11-30', '2026-11-30', '{}') $$,
  '23514', null, 'an empty cause is refused'
);
select throws_ok(
  $$ insert into public.signals (user_id, kind, cause, cause_key, local_date, evidence)
     values ('11111111-1111-1111-1111-111111111111', 'pressure', 'pressure', repeat('k', 161), '2026-11-30', '{}') $$,
  '23514', null, 'a cause key over 160 characters is refused'
);

-- 4. Deleting the account deletes its signals.
delete from auth.users where id = '11111111-1111-1111-1111-111111111111';
select is(
  (select count(*)::int from public.signals where user_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'deleting the auth user cascades to its signals'
);

select * from finish();

rollback;
