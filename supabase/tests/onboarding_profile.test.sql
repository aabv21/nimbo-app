-- The profile changes of the tracking wave: the widened priority, track_period, the known_triggers
-- catalog check and the complete_onboarding RPC.
begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

-- complete_onboarding waits for both gates.
select throws_ok($$ select public.complete_onboarding() $$, '22023', null, 'complete_onboarding raises 22023 before any gate');

select public.accept_terms(true, true, true, '2026-12-01', 'en');
select throws_ok($$ select public.complete_onboarding() $$, '22023', null, 'complete_onboarding raises 22023 before the AI answer');

select public.set_ai_consent(false, '2026-12-01', 'en');
select lives_ok($$ select public.complete_onboarding() $$, 'complete_onboarding succeeds once both gates are set');
select ok((select onboarding_completed_at = now() from public.profiles), 'it stamps the server time');

reset role;
update public.profiles set onboarding_completed_at = '2020-01-01T00:00:00Z';
set local role authenticated;
select public.complete_onboarding();
reset role;
select is((select onboarding_completed_at::text from public.profiles), '2020-01-01 00:00:00+00', 'a repeat keeps the first stamp');
set local role authenticated;

-- known_triggers is checked against the catalog.
select lives_ok($$ update public.profiles set known_triggers = '{weather,stress}' $$, 'known catalog triggers are accepted');
select throws_ok($$ update public.profiles set known_triggers = '{weather,bogus}' $$, '23514', null, 'a trigger outside the catalog raises 23514');
select throws_ok($$ update public.profiles set known_triggers = '{weather,weather}' $$, '23514', null, 'a repeated trigger raises 23514');

-- priority has the four onboarding choices.
select lives_ok($$ update public.profiles set priority = 'overuse' $$, 'priority overuse is accepted');
select throws_ok($$ update public.profiles set priority = 'doctor' $$, '23514', null, 'the old priority doctor raises 23514');

-- track_period is client-writable.
select lives_ok($$ update public.profiles set track_period = true $$, 'track_period is updatable');
select is((select track_period from public.profiles), true, 'the update applied');

reset role;
select ok(not has_function_privilege('anon', 'public.complete_onboarding()', 'execute'), 'anon cannot execute complete_onboarding');

select * from finish();

rollback;
