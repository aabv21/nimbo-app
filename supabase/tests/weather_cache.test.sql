-- weather_cache: a service-role-only shared cache (no client may read, write or delete), the cell key's
-- format, and public.prune_expired_caches() with its hourly pg_cron job.
begin;

create extension if not exists pgtap with schema extensions;

select plan(25);

-- 1. The table and who may touch it.
select ok(
  (select relrowsecurity from pg_class where oid = 'public.weather_cache'::regclass),
  'RLS is on'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'weather_cache'),
  0,
  'no policy: a client role sees nothing even with a grant'
);
select is(
  array(select a.attname::text from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
        where i.indrelid = 'public.weather_cache'::regclass and i.indisprimary order by a.attnum),
  array['location_key', 'fetched_at'],
  'the primary key leads with the cell, which every read filters by'
);

-- Seeded as the table owner.
insert into public.weather_cache (location_key, fetched_at, payload) values
  ('4.6,-74.1', now() - interval '3 days', '{"hours": [], "hPa": []}'),
  ('-23.5,-46.6', now() - interval '1 day', '{"hours": [], "hPa": []}');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

select throws_ok($$ select * from public.weather_cache $$, '42501', null, 'authenticated cannot select');
select throws_ok(
  $$ insert into public.weather_cache (location_key, payload) values ('4.6,-74.1', '{}') $$,
  '42501', null, 'authenticated cannot insert'
);
select throws_ok($$ delete from public.weather_cache $$, '42501', null, 'authenticated cannot delete');
select throws_ok($$ update public.weather_cache set payload = '{}' $$, '42501', null, 'authenticated cannot update');

reset role;
set local role anon;

select throws_ok($$ select * from public.weather_cache $$, '42501', null, 'anon cannot select');
select throws_ok(
  $$ insert into public.weather_cache (location_key, payload) values ('4.6,-74.1', '{}') $$,
  '42501', null, 'anon cannot insert'
);
select throws_ok($$ delete from public.weather_cache $$, '42501', null, 'anon cannot delete');

reset role;
set local role service_role;

select lives_ok(
  $$ insert into public.weather_cache (location_key, payload) values ('0.0,0.0', '{"hours": [], "hPa": []}') $$,
  'the service role inserts'
);
select is(
  (select count(*)::int from public.weather_cache where location_key in ('4.6,-74.1', '-23.5,-46.6', '0.0,0.0')),
  3,
  'the service role reads every row'
);
delete from public.weather_cache where location_key = '0.0,0.0';

reset role;

-- 2. The key: one decimal per coordinate, nothing else.
select throws_ok(
  $$ insert into public.weather_cache (location_key, payload) values ('4.62,-74.1', '{}') $$,
  '23514', null, 'a second decimal is refused'
);
select throws_ok(
  $$ insert into public.weather_cache (location_key, payload) values ('4,-74', '{}') $$,
  '23514', null, 'a whole number is refused'
);
select throws_ok(
  $$ insert into public.weather_cache (location_key, payload) values ('user:4.6,-74.1', '{}') $$,
  '23514', null, 'anything around the cell is refused'
);
select lives_ok(
  $$ insert into public.weather_cache (location_key, payload) values ('-89.9,-179.9', '{}'), ('45.0,120.5', '{}') $$,
  'the widest cells fit'
);
delete from public.weather_cache where location_key in ('-89.9,-179.9', '45.0,120.5');

-- 3. The prune.
-- Run history of Nimbo's two jobs and of another job; `monitor` does not exist yet, so the test schedules it.
-- (`runid` is given: only pg_cron itself may draw from its sequence.)
select cron.schedule('monitor', '5 * * * *', 'select 1');
select cron.schedule('someone-else', '0 * * * *', 'select 1');
insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
select jobid, 900000 + row_number() over (), 1, 'postgres', 'postgres', command, 'succeeded', jobname || '/' || age,
       now() - (case age when 'old' then interval '8 days' else interval '1 day' end),
       now() - (case age when 'old' then interval '8 days' else interval '1 day' end)
from cron.job, (values ('old'), ('recent')) ages (age)
where jobname in ('prune-expired-caches', 'monitor', 'someone-else');

select lives_ok($$ select public.prune_expired_caches() $$, 'postgres can run the prune');
select is(
  array(select location_key from public.weather_cache where location_key in ('4.6,-74.1', '-23.5,-46.6') order by 1),
  array['-23.5,-46.6'],
  'a forecast 3 days old goes and one 1 day old stays'
);
select is(
  array(select d.return_message from cron.job_run_details d where d.runid >= 900000 order by 1),
  array['monitor/recent', 'prune-expired-caches/recent', 'someone-else/old', 'someone-else/recent'],
  'run history over 7 days old goes for Nimbo''s jobs only'
);

-- 4. The job.
select is(
  (select schedule || ' | ' || command || ' | ' || active::text from cron.job where jobname = 'prune-expired-caches'),
  '17 * * * * | select public.prune_expired_caches() | true',
  'the prune runs hourly at :17'
);
select is(
  (select count(*)::int from cron.job where jobname = 'prune-expired-caches'),
  1,
  'one prune job is scheduled'
);

-- 5. The function's privileges.
select is(
  (select p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres' and p.proconfig = array['search_path=""']
   from pg_proc p where p.oid = 'public.prune_expired_caches()'::regprocedure),
  true,
  'the prune is security definer, owned by postgres, with an empty search_path'
);
select ok(
  not has_function_privilege('anon', 'public.prune_expired_caches()', 'execute')
  and not has_function_privilege('authenticated', 'public.prune_expired_caches()', 'execute'),
  'neither anon nor authenticated may execute the prune'
);
select ok(
  not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
    where p.oid = 'public.prune_expired_caches()'::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE'
  ),
  'public has no execute grant on the prune'
);

set local role authenticated;
select throws_ok($$ select public.prune_expired_caches() $$, '42501', null, 'an authenticated call is refused');

select * from finish();

rollback;
