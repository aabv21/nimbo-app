-- Consent versions: the published texts, the version on the profile, the append-only history, the versioned
-- accept_terms and set_ai_consent, and complete_onboarding's terms_version check.
begin;

create extension if not exists pgtap with schema extensions;

select plan(63);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-b@example.com', crypt('password', gen_salt('bf')), '{}', '{}'),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-c@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

-- 1. Shape: both tables with RLS, the seeded versions, the history index, and the old signatures gone.
select has_table('public', 'consent_texts', 'consent_texts exists');
select has_table('public', 'consent_events', 'consent_events exists');
select ok((select relrowsecurity from pg_class where oid = 'public.consent_texts'::regclass), 'RLS is on for consent_texts');
select ok((select relrowsecurity from pg_class where oid = 'public.consent_events'::regclass), 'RLS is on for consent_events');
select has_index('public', 'consent_events', 'consent_events_user_id_created_at_idx', 'consent_events has an index on (user_id, created_at)');

select results_eq(
  $$ select kind, version, published_at::text from public.consent_texts order by kind, version $$,
  $$ values ('ai', '2026-12-01', '2026-12-01'), ('terms', '2026-12-01', '2026-12-01') $$,
  'the migration seeds the terms and ai versions 2026-12-01'
);

select throws_ok(
  $$ insert into public.consent_texts (kind, version, published_at) values ('terms', 'v2', '2027-01-01') $$,
  '23514', null, 'a version that is not a date is refused'
);
select throws_ok(
  $$ insert into public.consent_texts (kind, version, published_at) values ('push', '2027-01-01', '2027-01-01') $$,
  '23514', null, 'an unknown consent kind is refused'
);

select hasnt_function('public', 'accept_terms', array['boolean', 'boolean'], 'the unversioned accept_terms is gone');
select hasnt_function('public', 'set_ai_consent', array['boolean'], 'the unversioned set_ai_consent is gone');

select ok(
  (select bool_and(prosecdef and proconfig @> array['search_path=""'])
   from pg_proc
   where oid in (
     'public.accept_terms(boolean, boolean, boolean, text, public.app_language)'::regprocedure,
     'public.set_ai_consent(boolean, text, public.app_language)'::regprocedure,
     'public.complete_onboarding()'::regprocedure
   )),
  'the consent RPCs are security definer with an empty search_path'
);

select ok(not has_function_privilege('anon', 'public.accept_terms(boolean, boolean, boolean, text, public.app_language)', 'execute'), 'anon cannot execute accept_terms');
select ok(not has_function_privilege('anon', 'public.set_ai_consent(boolean, text, public.app_language)', 'execute'), 'anon cannot execute set_ai_consent');
select ok(has_function_privilege('authenticated', 'public.accept_terms(boolean, boolean, boolean, text, public.app_language)', 'execute'), 'authenticated can execute accept_terms');
select ok(has_function_privilege('authenticated', 'public.set_ai_consent(boolean, text, public.app_language)', 'execute'), 'authenticated can execute set_ai_consent');

-- 2. accept_terms as user A: every box, a published version and a locale, or nothing changes.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

select throws_ok($$ select public.accept_terms(true, true, false, '2026-12-01', 'en') $$, '22023', null, 'accept_terms without the health consent raises 22023');
select throws_ok($$ select public.accept_terms(false, true, true, '2026-12-01', 'en') $$, '22023', null, 'accept_terms without the adult confirmation raises 22023');
select throws_ok($$ select public.accept_terms(true, true, true, '2099-01-01', 'en') $$, '22023', null, 'accept_terms with an unpublished version raises 22023');
select throws_ok($$ select public.accept_terms(true, true, true, '2026-12-01', null) $$, '22023', null, 'accept_terms without a locale raises 22023');

select is(
  (select (terms_version is null)::text || ',' || (boundary_accepted_at is null)::text from public.profiles),
  'true,true',
  'a refused accept_terms leaves the version and the stamps null'
);
select is_empty($$ select 1 from public.consent_events $$, 'a refused accept_terms writes no event');

select lives_ok($$ select public.accept_terms(true, true, true, '2026-12-01', 'en') $$, 'a complete accept_terms succeeds');

select is(
  (select terms_version || ',' || (adult_confirmed_at = now())::text || ',' || (boundary_accepted_at = now())::text from public.profiles),
  '2026-12-01,true,true',
  'accept_terms sets terms_version and stamps both times with the server clock'
);
select results_eq(
  $$ select kind, version, locale::text, granted from public.consent_events $$,
  $$ values ('terms', '2026-12-01', 'en', true) $$,
  'accept_terms writes exactly one terms event'
);

-- The same version again keeps the first stamps.
reset role;
update public.profiles
set adult_confirmed_at = '2020-01-01T00:00:00Z', boundary_accepted_at = '2020-01-02T00:00:00Z'
where user_id = '11111111-1111-1111-1111-111111111111';
set local role authenticated;

select public.accept_terms(true, true, true, '2026-12-01', 'pt');

reset role;
select is(
  (select adult_confirmed_at::text || ',' || boundary_accepted_at::text from public.profiles
   where user_id = '11111111-1111-1111-1111-111111111111'),
  '2020-01-01 00:00:00+00,2020-01-02 00:00:00+00',
  'a second accept_terms with the same version keeps the stamps'
);
select is(
  (select count(*)::int from public.consent_events where user_id = '11111111-1111-1111-1111-111111111111' and kind = 'terms'),
  2,
  'every accept_terms call writes one event'
);

-- A newer published version re-stamps both times.
insert into public.consent_texts (kind, version, published_at) values ('terms', '2027-01-01', '2027-01-01');
set local role authenticated;

select public.accept_terms(true, true, true, '2027-01-01', 'es');

reset role;
select is(
  (select terms_version || ',' || (boundary_accepted_at > '2020-01-02T00:00:00Z')::text || ',' || (boundary_accepted_at = now())::text
     || ',' || (adult_confirmed_at = now())::text
   from public.profiles where user_id = '11111111-1111-1111-1111-111111111111'),
  '2027-01-01,true,true,true',
  'accept_terms with a new version sets it and re-stamps both times'
);
select is(
  (select locale::text from public.consent_events where version = '2027-01-01'),
  'es',
  'the event keeps the locale the text was read in'
);
set local role authenticated;

-- An older version than the stored one is refused, and nothing is recorded.
select throws_ok($$ select public.accept_terms(true, true, true, '2026-12-01', 'en') $$, '22023', null, 'accept_terms with an older version than the stored one raises 22023');
select is(
  (select terms_version || ',' || (select count(*) from public.consent_events where kind = 'terms')::text from public.profiles),
  '2027-01-01,3',
  'a refused downgrade keeps the newer version and writes no event'
);

-- 3. set_ai_consent: a published ai version and a locale; the version is kept on decline too.
select throws_ok($$ select public.set_ai_consent(true, '2099-01-01', 'en') $$, '22023', null, 'set_ai_consent with an unpublished version raises 22023');
select throws_ok($$ select public.set_ai_consent(true, '2027-01-01', 'en') $$, '22023', null, 'set_ai_consent with a terms-only version raises 22023');
select throws_ok($$ select public.set_ai_consent(true, '2026-12-01', null) $$, '22023', null, 'set_ai_consent without a locale raises 22023');
select throws_ok($$ select public.set_ai_consent(null, '2026-12-01', 'en') $$, '22023', null, 'set_ai_consent without an answer raises 22023');

select public.set_ai_consent(false, '2026-12-01', 'es');

select is(
  (select ai_consent_version || ',' || ai_enabled::text || ',' || (ai_consent_at is null)::text || ',' || (ai_consent_answered_at = now())::text
   from public.profiles),
  '2026-12-01,false,true,true',
  'set_ai_consent(false) sets ai_consent_version, keeps the AI off and stamps the answer'
);
select results_eq(
  $$ select kind, version, locale::text, granted from public.consent_events where kind = 'ai' $$,
  $$ values ('ai', '2026-12-01', 'es', false) $$,
  'a decline writes one ai event with granted false'
);

select public.set_ai_consent(true, '2026-12-01', 'en');

select is(
  (select ai_enabled::text || ',' || (ai_consent_at = now())::text from public.profiles),
  'true,true',
  'set_ai_consent(true) turns the AI on and stamps the consent'
);
select is(
  (select count(*)::int from public.consent_events where kind = 'ai'),
  2,
  'every set_ai_consent call writes one event'
);

reset role;
insert into public.consent_texts (kind, version, published_at) values ('ai', '2027-01-01', '2027-01-01');
set local role authenticated;

select lives_ok($$ select public.set_ai_consent(true, '2027-01-01', 'en') $$, 'set_ai_consent with a newer published version succeeds');
select throws_ok($$ select public.set_ai_consent(true, '2026-12-01', 'en') $$, '22023', null, 'a grant under an older version than the stored one raises 22023');
select is(
  (select ai_consent_version || ',' || ai_enabled::text || ',' || (select count(*) from public.consent_events where kind = 'ai')::text from public.profiles),
  '2027-01-01,true,3',
  'a refused AI downgrade keeps the newer version and the answer, and writes no event'
);

-- A withdrawal always succeeds, even from an older build: the AI goes off and the newer version stays.
select lives_ok($$ select public.set_ai_consent(false, '2026-12-01', 'pt') $$, 'a withdrawal under an older version succeeds');
select is(
  (select ai_consent_version || ',' || ai_enabled::text || ',' || (ai_consent_at is null)::text from public.profiles),
  '2027-01-01,false,true',
  'the withdrawal turns the AI off and keeps the newer stored version'
);
select results_eq(
  $$ select version, granted from public.consent_events where kind = 'ai' and locale = 'pt' $$,
  $$ values ('2026-12-01', false) $$,
  'the withdrawal writes one event naming the text it used'
);

-- 4. Clients read only their own history, and never write the history, the texts or the versions.
select set_config('request.jwt.claims', json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);

select is_empty($$ select 1 from public.consent_events $$, 'user B cannot see user A''s consent events');
select is((select count(*)::int from public.consent_texts), 4, 'a signed-in user reads the published texts');

select throws_ok(
  $$ insert into public.consent_events (user_id, kind, version, locale, granted)
     values ('22222222-2222-2222-2222-222222222222', 'terms', '2026-12-01', 'en', true) $$,
  '42501', null, 'a client cannot insert a consent event'
);
select throws_ok($$ update public.consent_events set granted = false $$, '42501', null, 'a client cannot update consent events');
select throws_ok($$ delete from public.consent_events $$, '42501', null, 'a client cannot delete consent events');
select throws_ok(
  $$ insert into public.consent_texts (kind, version, published_at) values ('terms', '2028-01-01', '2028-01-01') $$,
  '42501', null, 'a client cannot publish a consent text'
);
select throws_ok($$ update public.consent_texts set published_at = '2020-01-01' $$, '42501', null, 'a client cannot update consent texts');
select throws_ok($$ delete from public.consent_texts $$, '42501', null, 'a client cannot delete consent texts');
select throws_ok($$ update public.profiles set terms_version = '2026-12-01' $$, '42501', null, 'a client cannot set terms_version');
select throws_ok($$ update public.profiles set ai_consent_version = '2026-12-01' $$, '42501', null, 'a client cannot set ai_consent_version');

-- 5. complete_onboarding also needs an accepted version: the two stamps alone are not enough.
reset role;
update public.profiles
set adult_confirmed_at = now(), boundary_accepted_at = now(), ai_consent_answered_at = now()
where user_id = '22222222-2222-2222-2222-222222222222';
set local role authenticated;

select throws_ok($$ select public.complete_onboarding() $$, '22023', null, 'complete_onboarding raises 22023 with both stamps but no terms_version');

select public.accept_terms(true, true, true, '2026-12-01', 'en');
select lives_ok($$ select public.complete_onboarding() $$, 'complete_onboarding succeeds once a version is accepted');

-- 6. No profile row, no event: the history only proves answers the profile holds.
reset role;
delete from public.profiles where user_id = '33333333-3333-3333-3333-333333333333';
select set_config('request.jwt.claims', json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text, true);
set local role authenticated;

select throws_ok($$ select public.accept_terms(true, true, true, '2026-12-01', 'en') $$, '22023', null, 'accept_terms without a profile row raises 22023');
select throws_ok($$ select public.set_ai_consent(true, '2026-12-01', 'en') $$, '22023', null, 'set_ai_consent without a profile row raises 22023');
select is_empty($$ select 1 from public.consent_events $$, 'neither refused call wrote an event');

-- 7. anon reads nothing.
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;

select throws_ok($$ select count(*) from public.consent_events $$, '42501', null, 'anon cannot read consent events');
select throws_ok($$ select count(*) from public.consent_texts $$, '42501', null, 'anon cannot read consent texts');
select throws_ok($$ select public.accept_terms(true, true, true, '2026-12-01', 'en') $$, '42501', null, 'anon calling accept_terms is refused');

-- 8. The history goes with the account.
reset role;
delete from auth.users where id = '11111111-1111-1111-1111-111111111111';
select is(
  (select count(*)::int from public.consent_events where user_id = '11111111-1111-1111-1111-111111111111'),
  0,
  'deleting the auth user cascades to its consent events'
);

select * from finish();

rollback;
