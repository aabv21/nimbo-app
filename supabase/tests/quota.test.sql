-- usage_counters and consume_quota: the daily limit, kinds (screen included) counted apart, the day rule, and no client access.
begin;

create extension if not exists pgtap with schema extensions;

select plan(23);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-b@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.usage_counters'::regclass), 'usage_counters has RLS on');
select is((select count(*)::integer from pg_catalog.pg_policies where schemaname = 'public' and tablename = 'usage_counters'), 0, 'usage_counters has no policy');

set local role service_role;

select is(
  (select bool_and(public.consume_quota('11111111-1111-1111-1111-111111111111', 'companion', 40, (now() at time zone 'utc')::date)) from generate_series(1, 40)),
  true,
  '40 companion calls succeed'
);
select is(
  public.consume_quota('11111111-1111-1111-1111-111111111111', 'companion', 40, (now() at time zone 'utc')::date),
  false,
  'the 41st companion call is refused'
);
select is(
  (select count from public.usage_counters where user_id = '11111111-1111-1111-1111-111111111111' and kind = 'companion'),
  40,
  'a refused call does not count'
);

select is(
  (select bool_and(public.consume_quota('11111111-1111-1111-1111-111111111111', 'dictation', 20, (now() at time zone 'utc')::date)) from generate_series(1, 20)),
  true,
  'dictation counts apart: 20 calls succeed after companion ran out'
);
select is(
  public.consume_quota('11111111-1111-1111-1111-111111111111', 'dictation', 20, (now() at time zone 'utc')::date),
  false,
  'the 21st dictation call is refused'
);

select is(
  (select bool_and(public.consume_quota('11111111-1111-1111-1111-111111111111', 'screen', 200, (now() at time zone 'utc')::date)) from generate_series(1, 200)),
  true,
  'screen counts apart: 200 screening calls succeed after companion ran out'
);
select is(
  public.consume_quota('11111111-1111-1111-1111-111111111111', 'screen', 200, (now() at time zone 'utc')::date),
  false,
  'the 201st screening call is refused'
);
select is(
  (select count from public.usage_counters where user_id = '11111111-1111-1111-1111-111111111111' and kind = 'companion'),
  40,
  'screening leaves the companion counter as it was'
);

select is(
  public.consume_quota('22222222-2222-2222-2222-222222222222', 'companion', 40, (now() at time zone 'utc')::date),
  true,
  'another user has their own budget'
);

-- The day is the app's local day when within one day of the UTC date, else the UTC day.
select is(
  public.consume_quota('22222222-2222-2222-2222-222222222222', 'dictation', 1, (now() at time zone 'utc')::date + 3),
  true,
  'a day three days ahead is accepted'
);
select is(
  (select day from public.usage_counters where user_id = '22222222-2222-2222-2222-222222222222' and kind = 'dictation'),
  (now() at time zone 'utc')::date,
  'and it counts on the UTC day'
);
select is(
  public.consume_quota('22222222-2222-2222-2222-222222222222', 'dictation', 1, (now() at time zone 'utc')::date),
  false,
  'so the UTC day is already spent'
);
select is(
  public.consume_quota('22222222-2222-2222-2222-222222222222', 'dictation', 1, (now() at time zone 'utc')::date - 3),
  false,
  'a day three days behind counts on the UTC day too'
);
select is(
  public.consume_quota('22222222-2222-2222-2222-222222222222', 'dictation', 1, (now() at time zone 'utc')::date + 1),
  true,
  'a local day one ahead of UTC gets its own counter'
);
select is(
  public.consume_quota('22222222-2222-2222-2222-222222222222', 'dictation', 1, null),
  false,
  'no day counts on the UTC day'
);

select is(public.consume_quota('22222222-2222-2222-2222-222222222222', 'companion', 0, null), false, 'a limit of 0 always refuses');
select is(public.consume_quota('22222222-2222-2222-2222-222222222222', 'companion', null, null), false, 'a null limit always refuses');

reset role;

-- Clients can neither call consume_quota nor read usage_counters, even for their own id.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

select throws_ok(
  $$ select public.consume_quota('11111111-1111-1111-1111-111111111111', 'companion', 40, current_date) $$,
  '42501',
  null,
  'authenticated cannot execute consume_quota'
);
select throws_ok($$ select count(*) from public.usage_counters $$, '42501', null, 'authenticated cannot select usage_counters');

select set_config('request.jwt.claims', '', true);
set local role anon;

select throws_ok(
  $$ select public.consume_quota('11111111-1111-1111-1111-111111111111', 'companion', 40, current_date) $$,
  '42501',
  null,
  'anon cannot execute consume_quota'
);
select throws_ok($$ select count(*) from public.usage_counters $$, '42501', null, 'anon cannot select usage_counters');

reset role;

select * from finish();

rollback;
