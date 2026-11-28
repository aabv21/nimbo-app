-- push_tokens: written only through register_push_token() with the phone's device secret (another secret
-- can't register or take over a token; the same secret, a new account on that phone, takes it over), the
-- secret's hash unreadable by clients, own rows only, no anon access, the cascade on user delete; the
-- service-role-only claim RPCs and their limits; prune_expired_caches() dropping expired claims.
begin;

create extension if not exists pgtap with schema extensions;

select plan(53);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-b@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

-- Two phones' device secrets (64 hex characters, as the app makes them).
create temporary table phone (name text primary key, secret text) on commit drop;
insert into phone values ('one', repeat('1a', 32)), ('two', repeat('2b', 32));
grant select on phone to authenticated;

-- 1. The table, its grants and the RPCs' privileges.
select has_table('public', 'push_tokens', 'public.push_tokens exists');
select ok((select relrowsecurity from pg_class where oid = 'public.push_tokens'::regclass), 'RLS is on');
select is(
  (select array_agg(policyname::text || ':' || cmd order by policyname) from pg_policies where schemaname = 'public' and tablename = 'push_tokens'),
  array['push_tokens_delete_own:DELETE', 'push_tokens_select_own:SELECT'],
  'the only policies are read-own and delete-own'
);
select has_index('public', 'push_tokens', 'push_tokens_token_idx', 'push_tokens has an index on the token');
select hasnt_column('public', 'push_tokens', 'review_ready', 'no per-notice preference columns');
select ok(
  not has_table_privilege('authenticated', 'public.push_tokens', 'INSERT')
    and not has_table_privilege('authenticated', 'public.push_tokens', 'UPDATE')
    and not has_any_column_privilege('authenticated', 'public.push_tokens', 'INSERT')
    and not has_any_column_privilege('authenticated', 'public.push_tokens', 'UPDATE'),
  'authenticated has no insert or update on any push_tokens column'
);
select ok(
  not has_column_privilege('authenticated', 'public.push_tokens', 'device_secret_hash', 'SELECT')
    and has_column_privilege('authenticated', 'public.push_tokens', 'token', 'SELECT')
    and has_table_privilege('authenticated', 'public.push_tokens', 'DELETE'),
  'authenticated can read the token and delete, but never read device_secret_hash'
);
select ok(
  not has_table_privilege('anon', 'public.push_tokens', 'SELECT')
    and not has_table_privilege('anon', 'public.push_tokens', 'DELETE'),
  'anon has no access to push_tokens'
);
select ok(
  has_function_privilege('authenticated', 'public.register_push_token(text, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.register_push_token(text, text, text)', 'execute'),
  'only authenticated can register a token'
);
select is_definer('public', 'register_push_token', array['text', 'text', 'text']::name[], 'register_push_token is security definer');
select ok(
  (select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.register_push_token(text, text, text)'::regprocedure),
  'register_push_token runs with an empty search_path'
);

-- 2. register_push_token() as the app calls it.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

select lives_ok(
  $$ select public.register_push_token('ExponentPushToken[aaaa]', 'android', (select secret from phone where name = 'one')) $$,
  'A registers phone one''s token'
);
select results_eq(
  $$ select user_id, token, platform from public.push_tokens $$,
  $$ values ('11111111-1111-1111-1111-111111111111'::uuid, 'ExponentPushToken[aaaa]'::text, 'android'::text) $$,
  'the row is the caller''s'
);
select throws_ok(
  $$ select device_secret_hash from public.push_tokens $$,
  '42501', null, 'A cannot read the secret''s hash, even on their own row'
);
select lives_ok(
  $$ select public.register_push_token('ExponentPushToken[aaaa]', 'android', (select secret from phone where name = 'one')) $$,
  'registering again from the same phone is a no-op update'
);
select is((select count(*)::int from public.push_tokens), 1, 'still one row');
select lives_ok(
  $$ select public.register_push_token('ExpoPushToken[bbbb]', 'ios', (select secret from phone where name = 'one')) $$,
  'the ExpoPushToken[…] form is accepted too'
);
select throws_ok(
  $$ select public.register_push_token('not-a-token', 'android', (select secret from phone where name = 'one')) $$,
  '22023', null, 'a token in another format is refused'
);
select throws_ok(
  $$ select public.register_push_token('ExponentPushToken[cccc]', 'web', (select secret from phone where name = 'one')) $$,
  '22023', null, 'a platform other than ios or android is refused'
);
select throws_ok(
  $$ select public.register_push_token('ExponentPushToken[cccc]', 'android', 'short') $$,
  '22023', null, 'a device secret under 128 bits is refused'
);
select throws_ok(
  $$ insert into public.push_tokens (token, platform, device_secret_hash) values ('ExponentPushToken[dddd]', 'android', repeat('0', 64)) $$,
  '42501', null, 'A cannot insert a row directly'
);
select throws_ok(
  $$ update public.push_tokens set platform = 'ios' $$,
  '42501', null, 'A cannot update a row directly'
);
select throws_ok(
  $$ select public.start_push_claim('11111111-1111-1111-1111-111111111111', 'ExponentPushToken[aaaa]', repeat('c', 64), repeat('b1', 32)) $$,
  '42501', null, 'A cannot start a claim directly'
);

select set_config('request.jwt.claims', json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);

select is((select count(*)::int from public.push_tokens), 0, 'B sees none of A''s tokens');
with deleted as (
  delete from public.push_tokens returning 1
)
select is((select count(*)::int from deleted), 0, 'B''s delete reaches none of A''s tokens');

-- B knows phone one's token but holds phone two's secret: refused, and A keeps the token.
select throws_ok(
  $$ select public.register_push_token('ExponentPushToken[aaaa]', 'android', (select secret from phone where name = 'two')) $$,
  '42501', null, 'another account''s token under a different secret is refused'
);
reset role;
select is(
  (select array_agg(user_id::text) from public.push_tokens where token = 'ExponentPushToken[aaaa]'),
  array['11111111-1111-1111-1111-111111111111'],
  'A''s row is untouched'
);

-- B signs in on phone one (same secret): B takes the token over and A's row goes.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);
select lives_ok(
  $$ select public.register_push_token('ExponentPushToken[aaaa]', 'android', (select secret from phone where name = 'one')) $$,
  'the same secret registers the token for B'
);
reset role;
select is(
  (select array_agg(user_id::text) from public.push_tokens where token = 'ExponentPushToken[aaaa]'),
  array['22222222-2222-2222-2222-222222222222'],
  'the same phone''s secret takes the token over: the older account''s row is gone'
);
select is(
  (select device_secret_hash from public.push_tokens where token = 'ExponentPushToken[aaaa]'),
  encode(extensions.digest(repeat('1a', 32), 'sha256'), 'hex'),
  'the row keeps the SHA-256 of the secret, never the secret'
);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);
with deleted as (
  delete from public.push_tokens where token = 'ExpoPushToken[bbbb]' returning 1
)
select is((select count(*)::int from deleted), 1, 'A can delete their own token');
-- A takes phone one's token back for the claims below.
select public.register_push_token('ExponentPushToken[aaaa]', 'android', (select secret from phone where name = 'one'));
reset role;

-- 3. push_claims: B holds phone two; to reclaim A's token B must prove receipt of a push.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
select ('00000000-0000-4000-8000-00000000000' || i)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'claimant-' || i || '@example.com', crypt('password', gen_salt('bf')), '{}', '{}'
from generate_series(1, 7) i;
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-c@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

select ok(
  not has_table_privilege('authenticated', 'public.push_claims', 'SELECT')
    and not has_table_privilege('authenticated', 'public.push_claims', 'INSERT')
    and not has_table_privilege('authenticated', 'public.push_claims', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.push_claims', 'DELETE')
    and not has_table_privilege('anon', 'public.push_claims', 'SELECT')
    and not has_table_privilege('authenticated', 'public.push_claim_starts', 'SELECT')
    and not has_table_privilege('anon', 'public.push_claim_starts', 'SELECT'),
  'clients have no access to push_claims or push_claim_starts'
);
select ok(
  not has_function_privilege('authenticated', 'public.start_push_claim(uuid, text, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.start_push_claim(uuid, text, text, text)', 'execute')
    and not has_function_privilege('authenticated', 'public.push_claim_attempt(uuid, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.push_claim_attempt(uuid, text, text)', 'execute')
    and not has_function_privilege('authenticated', 'public.finish_push_claim(uuid, text, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.finish_push_claim(uuid, text, text, text)', 'execute')
    and has_function_privilege('service_role', 'public.start_push_claim(uuid, text, text, text)', 'execute')
    and has_function_privilege('service_role', 'public.push_claim_attempt(uuid, text, text)', 'execute')
    and has_function_privilege('service_role', 'public.finish_push_claim(uuid, text, text, text)', 'execute'),
  'only the service role (push-claim) runs the claim functions'
);
select is(
  public.start_push_claim('22222222-2222-2222-2222-222222222222', 'ExponentPushToken[nobody]', repeat('c', 64), repeat('b1', 32)),
  false,
  'no claim for a token nobody holds (it can simply be registered)'
);
select is(
  public.start_push_claim('11111111-1111-1111-1111-111111111111', 'ExponentPushToken[aaaa]', repeat('c', 64), repeat('b1', 32)),
  false,
  'the account holding the token can''t claim it'
);
select is((select count(*)::int from public.push_claim_starts), 0, 'and the holder''s attempt isn''t counted');
select is(
  public.start_push_claim('22222222-2222-2222-2222-222222222222', 'ExponentPushToken[aaaa]', encode(extensions.digest('CODE1234', 'sha256'), 'hex'), repeat('b1', 32)),
  true,
  'B starts a claim on A''s token'
);
select is(
  public.start_push_claim('22222222-2222-2222-2222-222222222222', 'ExponentPushToken[aaaa]', repeat('d', 64), repeat('b1', 32)),
  false,
  'one start per token and account per 10 minutes'
);
select is(
  public.start_push_claim('33333333-3333-3333-3333-333333333333', 'ExponentPushToken[aaaa]', encode(extensions.digest('CCCC5678', 'sha256'), 'hex'), repeat('c1', 32)),
  true,
  'another account''s active claim doesn''t block C''s start'
);
select is(
  public.push_claim_attempt('22222222-2222-2222-2222-222222222222', 'ExponentPushToken[aaaa]', repeat('c1', 32)),
  null,
  'another claim''s nonce matches nothing'
);
select is(
  public.push_claim_attempt('22222222-2222-2222-2222-222222222222', 'ExponentPushToken[aaaa]', repeat('b1', 32)),
  encode(extensions.digest('CODE1234', 'sha256'), 'hex'),
  'an attempt answers the code''s hash for the function to compare'
);
select public.push_claim_attempt('22222222-2222-2222-2222-222222222222', 'ExponentPushToken[aaaa]', repeat('b1', 32)) from generate_series(2, 5);
select is(
  public.push_claim_attempt('22222222-2222-2222-2222-222222222222', 'ExponentPushToken[aaaa]', repeat('b1', 32)),
  null,
  'the 6th attempt is refused'
);
update public.push_claims set attempts = 0, expires_at = now() - interval '1 second'
where user_id = '22222222-2222-2222-2222-222222222222';
select is(
  public.push_claim_attempt('22222222-2222-2222-2222-222222222222', 'ExponentPushToken[aaaa]', repeat('b1', 32)),
  null,
  'an expired claim is refused'
);
select is(
  public.finish_push_claim('22222222-2222-2222-2222-222222222222', 'ExponentPushToken[aaaa]', 'android', (select secret from phone where name = 'two')),
  false,
  'an expired claim can''t finish either'
);
update public.push_claims set expires_at = now() + interval '5 minutes'
where user_id = '22222222-2222-2222-2222-222222222222';
select throws_ok(
  $$ select public.finish_push_claim('22222222-2222-2222-2222-222222222222', 'ExponentPushToken[aaaa]', 'web', repeat('2b', 32)) $$,
  '22023', null, 'finish refuses a bad platform'
);
select is(
  public.finish_push_claim('22222222-2222-2222-2222-222222222222', 'ExponentPushToken[aaaa]', 'android', (select secret from phone where name = 'two')),
  true,
  'a proven claim finishes, whatever other claims are open'
);
select results_eq(
  $$ select user_id, device_secret_hash = encode(extensions.digest(repeat('2b', 32), 'sha256'), 'hex') from public.push_tokens where token = 'ExponentPushToken[aaaa]' $$,
  $$ values ('22222222-2222-2222-2222-222222222222'::uuid, true) $$,
  'B now holds the token under phone two''s secret; A''s row is gone'
);
select is((select count(*)::int from public.push_claims where token = 'ExponentPushToken[aaaa]'), 0, 'every claim on the token is gone, C''s too');

-- The limits, against tokens B holds: C may start at most 5 claims an hour across tokens, and a token takes
-- claims from at most 6 distinct accounts an hour.
insert into public.push_tokens (user_id, token, platform, device_secret_hash)
select '22222222-2222-2222-2222-222222222222', 'ExponentPushToken[t' || i || ']', 'android', repeat('f', 64)
from generate_series(1, 6) i;
select is(
  (select count(*)::int from generate_series(1, 6) i
   where public.start_push_claim('33333333-3333-3333-3333-333333333333', 'ExponentPushToken[t' || i || ']', repeat('a', 64), repeat('c1', 32))),
  4,
  'C''s hour allows 5 starts: the one above and 4 more'
);
delete from public.push_claim_starts;
delete from public.push_claims;
select is(
  (select count(*)::int from generate_series(1, 6) i
   where public.start_push_claim(('00000000-0000-4000-8000-00000000000' || i)::uuid, 'ExponentPushToken[t1]', repeat('a', 64), repeat('b1', 32))),
  6,
  '6 distinct accounts can each claim one token in an hour'
);
select is(
  public.start_push_claim('00000000-0000-4000-8000-000000000007', 'ExponentPushToken[t1]', repeat('a', 64), repeat('b1', 32)),
  false,
  'a 7th account in the hour is refused'
);

-- 4. The daily cleanup.
insert into public.push_claims (token, user_id, code_hash, nonce_hash, expires_at) values
  ('ExpoPushToken[old]', '22222222-2222-2222-2222-222222222222', repeat('e', 64), repeat('b1', 32), now() - interval '1 minute');
update public.push_claim_starts set started_at = now() - interval '2 hours';
delete from public.push_claims where expires_at > now();
select public.prune_expired_caches();
select is(
  (select count(*)::int from public.push_claims) + (select count(*)::int from public.push_claim_starts),
  0,
  'prune_expired_caches() removes an expired claim and starts over an hour old'
);

-- 5. The cascade.
delete from auth.users where id = '22222222-2222-2222-2222-222222222222';
select is(
  (select count(*)::int from public.push_tokens where user_id = '22222222-2222-2222-2222-222222222222'),
  0,
  'deleting the user deletes their tokens'
);

select * from finish();

rollback;
