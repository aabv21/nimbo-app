-- entitlements: read-own only, no client writes, and has_premium's grant/purchase rules.
begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-b@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

select ok(not public.has_premium('11111111-1111-1111-1111-111111111111'), 'no row is not premium');

insert into public.entitlements (user_id, granted, granted_note)
values ('11111111-1111-1111-1111-111111111111', true, 'a'), ('22222222-2222-2222-2222-222222222222', true, 'b');

select ok(public.has_premium('11111111-1111-1111-1111-111111111111'), 'a grant with no end is premium');
update public.entitlements set granted_until = now() - interval '1 day' where user_id = '11111111-1111-1111-1111-111111111111';
select ok(not public.has_premium('11111111-1111-1111-1111-111111111111'), 'a grant that ended yesterday is not premium');
update public.entitlements set granted_until = now() + interval '1 day' where user_id = '11111111-1111-1111-1111-111111111111';
select ok(public.has_premium('11111111-1111-1111-1111-111111111111'), 'a grant ending tomorrow is premium');

update public.entitlements
set granted = false, granted_until = null, purchase_active = true, purchase_expires_at = now() - interval '1 day'
where user_id = '11111111-1111-1111-1111-111111111111';
select ok(not public.has_premium('11111111-1111-1111-1111-111111111111'), 'an expired purchase is not premium');

update public.entitlements set purchase_active = false, purchase_expires_at = null where user_id = '11111111-1111-1111-1111-111111111111';
select ok(not public.has_premium('11111111-1111-1111-1111-111111111111'), 'nothing active is not premium');

update public.entitlements set purchase_active = true, purchase_expires_at = null where user_id = '11111111-1111-1111-1111-111111111111';
select ok(public.has_premium('11111111-1111-1111-1111-111111111111'), 'a purchase with no end is premium');

update public.entitlements
set purchase_active = true, purchase_expires_at = now() - interval '1 day', granted = true, granted_until = null
where user_id = '11111111-1111-1111-1111-111111111111';
select ok(public.has_premium('11111111-1111-1111-1111-111111111111'), 'an expired purchase does not remove an active grant');

update public.entitlements
set purchase_active = true, purchase_expires_at = now() + interval '30 days', granted = false
where user_id = '11111111-1111-1111-1111-111111111111';
select ok(public.has_premium('11111111-1111-1111-1111-111111111111'), 'a revoked grant does not remove an active purchase');

-- Back to a plain grant so the client checks below have a row to read.
update public.entitlements
set purchase_active = false, purchase_expires_at = null, granted = true
where user_id = '11111111-1111-1111-1111-111111111111';

select ok(public.has_premium('22222222-2222-2222-2222-222222222222'), 'with no auth.uid (the table owner) it answers about anyone');

-- The grant and purchase end exactly now: not premium (now() is fixed inside the transaction).
update public.entitlements set granted_until = now(), purchase_active = false where user_id = '11111111-1111-1111-1111-111111111111';
select ok(not public.has_premium('11111111-1111-1111-1111-111111111111'), 'a grant ending exactly now is not premium');
update public.entitlements
set granted = false, granted_until = null, purchase_active = true, purchase_expires_at = now()
where user_id = '11111111-1111-1111-1111-111111111111';
select ok(not public.has_premium('11111111-1111-1111-1111-111111111111'), 'a purchase ending exactly now is not premium');
update public.entitlements
set granted = true, purchase_active = false, purchase_expires_at = null
where user_id = '11111111-1111-1111-1111-111111111111';

-- The real service role goes through the grant, with a JWT that has no sub.
set local role service_role;
select set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
select ok(public.has_premium('22222222-2222-2222-2222-222222222222'), 'service_role asks about any user through the grant');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

select is((select count(*)::int from public.entitlements), 1, 'A sees one row');
select is((select user_id::text from public.entitlements), '11111111-1111-1111-1111-111111111111', 'and it is A''s');
select is((select count(*)::int from public.entitlements where user_id = '22222222-2222-2222-2222-222222222222'), 0, 'A cannot read B''s row');

select throws_ok($$ insert into public.entitlements (user_id) values ('11111111-1111-1111-1111-111111111111') $$, '42501', null, 'insert is refused');
select throws_ok($$ update public.entitlements set purchase_active = true $$, '42501', null, 'updating purchase_active is refused');
select throws_ok($$ update public.entitlements set purchase_expires_at = now() $$, '42501', null, 'updating purchase_expires_at is refused');
select throws_ok($$ update public.entitlements set purchase_source = 'x' $$, '42501', null, 'updating purchase_source is refused');
select throws_ok($$ update public.entitlements set granted = true $$, '42501', null, 'updating granted is refused');
select throws_ok($$ update public.entitlements set granted_until = now() $$, '42501', null, 'updating granted_until is refused');
select throws_ok($$ update public.entitlements set granted_note = 'x' $$, '42501', null, 'updating granted_note is refused');
select throws_ok($$ delete from public.entitlements $$, '42501', null, 'delete is refused');

select ok(public.has_premium('11111111-1111-1111-1111-111111111111'), 'A asks about A');
select throws_ok($$ select public.has_premium('22222222-2222-2222-2222-222222222222') $$, '42501', null, 'A asking about B raises 42501');

reset role;
select ok(not has_function_privilege('anon', 'public.has_premium(uuid)', 'execute'), 'anon cannot execute has_premium');

select * from finish();
rollback;
