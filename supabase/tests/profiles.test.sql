-- public.profiles and the consent RPCs: own-row access only, consent set only through the RPCs
-- with the server clock, and anon reaches nothing but keep_alive().
begin;

create extension if not exists pgtap with schema extensions;

select plan(37);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-b@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

-- 1. The signup trigger creates exactly one row, with the safe defaults.
select is(
  (select count(*)::int from public.profiles where user_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'a new auth user has exactly one profile row'
);

select is(
  (select theme::text || ',' || ai_enabled::text || ',' || notify_daily_cap::text
   from public.profiles where user_id = '11111111-1111-1111-1111-111111111111'),
  'system,false,2',
  'the new row defaults to theme system, AI off and a daily cap of 2'
);

-- Impersonate user A.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

-- 2. A sees only their own row.
select is((select count(*)::int from public.profiles), 1, 'user A sees one profile row');

select is_empty(
  $$ select 1 from public.profiles where user_id = '22222222-2222-2222-2222-222222222222' $$,
  'user A cannot see user B''s row'
);

-- A's update of B's row is filtered out by RLS: it does not raise and changes nothing.
select lives_ok(
  $$ update public.profiles set theme = 'dim' where user_id = '22222222-2222-2222-2222-222222222222' $$,
  'user A updating user B''s row does not raise'
);

reset role;
select is(
  (select theme::text from public.profiles where user_id = '22222222-2222-2222-2222-222222222222'),
  'system',
  'user A''s update did not change user B''s row'
);

set local role authenticated;

-- 3. The client-editable columns update.
select lives_ok(
  $$ update public.profiles set theme = 'dim' $$,
  'user A can update theme'
);

select is((select theme::text from public.profiles), 'dim', 'the theme update applied');

-- 4. Consent, identity and condition columns are not client-writable.
select throws_ok($$ update public.profiles set ai_enabled = true $$, '42501', null, 'a client cannot set ai_enabled');
select throws_ok($$ update public.profiles set adult_confirmed_at = now() $$, '42501', null, 'a client cannot set adult_confirmed_at');
select throws_ok($$ update public.profiles set boundary_accepted_at = now() $$, '42501', null, 'a client cannot set boundary_accepted_at');
select throws_ok($$ update public.profiles set ai_consent_at = now() $$, '42501', null, 'a client cannot set ai_consent_at');
select throws_ok($$ update public.profiles set ai_consent_answered_at = now() $$, '42501', null, 'a client cannot set ai_consent_answered_at');
select throws_ok($$ update public.profiles set onboarding_completed_at = now() $$, '42501', null, 'a client cannot set onboarding_completed_at');
select throws_ok($$ update public.profiles set condition = 'migraine' $$, '42501', null, 'a client cannot set condition');
select throws_ok(
  $$ update public.profiles set user_id = '33333333-3333-3333-3333-333333333333' $$,
  '42501', null, 'a client cannot move a profile to another user'
);

-- 5. accept_terms needs both confirmations and stamps them once, with the server clock.
select throws_ok($$ select public.accept_terms(true, false) $$, '22023', null, 'accept_terms(true, false) raises 22023');
select throws_ok($$ select public.accept_terms(false, true) $$, '22023', null, 'accept_terms(false, true) raises 22023');

select is(
  (select (adult_confirmed_at is null)::text || ',' || (boundary_accepted_at is null)::text from public.profiles),
  'true,true',
  'a refused accept_terms leaves both timestamps null'
);

select lives_ok($$ select public.accept_terms(true, true) $$, 'accept_terms(true, true) succeeds');

select is(
  (select (adult_confirmed_at = now())::text || ',' || (boundary_accepted_at = now())::text from public.profiles),
  'true,true',
  'accept_terms stamps both timestamps with the server clock'
);

reset role;
update public.profiles
set adult_confirmed_at = '2020-01-01T00:00:00Z', boundary_accepted_at = '2020-01-02T00:00:00Z'
where user_id = '11111111-1111-1111-1111-111111111111';

set local role authenticated;
select public.accept_terms(true, true);

reset role;
select is(
  (select adult_confirmed_at::text || ',' || boundary_accepted_at::text from public.profiles
   where user_id = '11111111-1111-1111-1111-111111111111'),
  '2020-01-01 00:00:00+00,2020-01-02 00:00:00+00',
  'a second accept_terms does not change the stored timestamps'
);

set local role authenticated;

-- 6. set_ai_consent records the answer and the consent together.
select public.set_ai_consent(true);

select is(
  (select ai_enabled::text || ',' || (ai_consent_at = now())::text || ',' || (ai_consent_answered_at = now())::text
   from public.profiles),
  'true,true,true',
  'set_ai_consent(true) sets ai_enabled, ai_consent_at and ai_consent_answered_at'
);

select public.set_ai_consent(false);

select is(
  (select ai_enabled::text || ',' || (ai_consent_at is null)::text || ',' || (ai_consent_answered_at = now())::text
   from public.profiles),
  'false,true,true',
  'set_ai_consent(false) clears ai_consent_at, disables AI and keeps ai_consent_answered_at'
);

-- 7. Value limits, and coordinates rounded to one decimal.
select throws_ok($$ update public.profiles set notify_daily_cap = 3 $$, '23514', null, 'a daily cap of 3 violates the check');
select throws_ok($$ update public.profiles set coarse_lat = 91 $$, '23514', null, 'a latitude of 91 violates the check');

select lives_ok($$ update public.profiles set coarse_lat = 12.3456 $$, 'a precise latitude is accepted');
select is((select coarse_lat from public.profiles), 12.3, 'the latitude is stored at one decimal');

-- 8. Function privileges: only keep_alive() is open to anon.
reset role;

select ok(not has_function_privilege('anon', 'public.accept_terms(boolean, boolean)', 'execute'), 'anon cannot execute accept_terms');
select ok(not has_function_privilege('anon', 'public.set_ai_consent(boolean)', 'execute'), 'anon cannot execute set_ai_consent');
select ok(has_function_privilege('anon', 'public.keep_alive()', 'execute'), 'anon can execute keep_alive');
select ok(has_function_privilege('authenticated', 'public.accept_terms(boolean, boolean)', 'execute'), 'authenticated can execute accept_terms');
select ok(has_function_privilege('authenticated', 'public.set_ai_consent(boolean)', 'execute'), 'authenticated can execute set_ai_consent');

select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select public.accept_terms(true, true) $$, '42501', null, 'anon calling accept_terms is refused');

-- 9. No client insert or delete, and anon reads nothing.
select throws_ok($$ select count(*) from public.profiles $$, '42501', null, 'anon cannot read profiles');

reset role;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok(
  $$ insert into public.profiles (user_id) values ('33333333-3333-3333-3333-333333333333') $$,
  '42501', null, 'a client cannot insert a profile'
);

select throws_ok(
  $$ delete from public.profiles where user_id = '11111111-1111-1111-1111-111111111111' $$,
  '42501', null, 'a client cannot delete a profile'
);

reset role;

select * from finish();

rollback;
