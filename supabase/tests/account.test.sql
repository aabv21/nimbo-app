-- Account deletion and export coverage: every public table with a user_id cascades from auth.users, the set of such
-- tables is pinned (export-data's EXPORTED_TABLES plus EXCLUDED_TABLES), deleting a user leaves none of their rows, and
-- prune_expired_caches() keeps 30 days of usage_counters, and save_signals answers nothing for an account deleted mid-run.
begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-a@example.com', crypt('password', gen_salt('bf')), '{}', '{}'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user-b@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

-- 1. The cascade pin: a user_id column without an on-delete-cascade FK to auth.users would outlive the account.
select is_empty(
  $$
    select c.table_name::text
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public'
      and c.column_name = 'user_id'
      and not exists (
        select 1
        from pg_catalog.pg_constraint k
        join pg_catalog.pg_attribute a on a.attrelid = k.conrelid and a.attname = 'user_id'
        where k.contype = 'f'
          and k.conrelid = pg_catalog.format('public.%I', c.table_name)::regclass
          and k.confrelid = 'auth.users'::regclass
          and k.confdeltype = 'c'
          and k.conkey = array[a.attnum]
      )
  $$,
  'every public table with a user_id has an on delete cascade foreign key to auth.users'
);

-- 2. The table pin: a new user table fails here until export-data exports it or excludes it on purpose. This list is the
-- only copy in SQL; export-data's unit test reads it from this file and checks EXPORTED_TABLES plus EXCLUDED_TABLES equal it.
create temporary table pinned_user_tables on commit drop as
select pg_catalog.unnest(array[
  'profiles', 'episodes', 'medications', 'doses', 'checkins', 'agent_notes', 'entitlements',
  'usage_counters', 'signals', 'push_tokens', 'consent_events',
  'push_claims', 'push_claim_starts', 'push_tickets'
]::text[]) as name;

select set_eq(
  $$
    select c.table_name::text
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'user_id'
  $$,
  $$ select name from pinned_user_tables $$,
  'the public tables with a user_id are exactly export-data''s exported and excluded tables'
);

-- Any other way to point at a user (an owner_id, a second foreign key) must be on a pinned table and cascade too.
select is_empty(
  $$
    select k.conrelid::regclass::text || ' ' || k.conname::text
    from pg_catalog.pg_constraint k
    join pg_catalog.pg_class r on r.oid = k.conrelid
    join pg_catalog.pg_namespace n on n.oid = r.relnamespace
    where k.contype = 'f'
      and n.nspname = 'public'
      and k.confrelid = 'auth.users'::regclass
      and (k.confdeltype <> 'c' or r.relname::text not in (select name from pinned_user_tables))
  $$,
  'every public foreign key to auth.users cascades and sits on a pinned user table'
);

-- doses -> medications is NO ACTION (not cascade): its check runs at the end of the statement, after the cascade from
-- auth.users has removed the doses too. Pinned so a later change to RESTRICT (checked at once) fails here.
select is(
  (select confdeltype::text from pg_catalog.pg_constraint
   where conrelid = 'public.doses'::regclass and confrelid = 'public.medications'::regclass and contype = 'f'),
  'a',
  'doses.medication_id references medications with NO ACTION'
);

-- 3. Both users with a row in every one of the 14 tables (the profile comes from the signup trigger).
insert into public.episodes (id, user_id, started_at, ended_at) values
  ('aaaaaaaa-0000-4000-8000-00000000000a', '11111111-1111-1111-1111-111111111111', now() - interval '2 hours', null),
  ('bbbbbbbb-0000-4000-8000-00000000000b', '22222222-2222-2222-2222-222222222222', now() - interval '2 hours', null);
insert into public.medications (id, user_id, name, kind, class) values
  ('aaaaaaaa-1000-4000-8000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Ibuprofen', 'acute', 'simple_analgesic'),
  ('bbbbbbbb-1000-4000-8000-00000000000b', '22222222-2222-2222-2222-222222222222', 'Sumatriptan', 'acute', 'triptan');
insert into public.doses (id, user_id, medication_id, episode_id, taken_at) values
  ('aaaaaaaa-2000-4000-8000-00000000000a', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-1000-4000-8000-00000000000a', 'aaaaaaaa-0000-4000-8000-00000000000a', now() - interval '90 minutes'),
  ('aaaaaaaa-2000-4000-8000-00000000000c', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-1000-4000-8000-00000000000a', null, now() - interval '30 minutes'),
  ('bbbbbbbb-2000-4000-8000-00000000000b', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-1000-4000-8000-00000000000b', 'bbbbbbbb-0000-4000-8000-00000000000b', now() - interval '90 minutes');
insert into public.checkins (user_id, local_date, sleep_band) values
  ('11111111-1111-1111-1111-111111111111', current_date, '6_7'),
  ('22222222-2222-2222-2222-222222222222', current_date, '7_8');
insert into public.agent_notes (user_id, text) values
  ('11111111-1111-1111-1111-111111111111', 'Prefers short answers'),
  ('22222222-2222-2222-2222-222222222222', 'Walks in the evening');
insert into public.entitlements (user_id, granted) values
  ('11111111-1111-1111-1111-111111111111', true),
  ('22222222-2222-2222-2222-222222222222', true);
insert into public.usage_counters (user_id, day, kind, count) values
  ('11111111-1111-1111-1111-111111111111', current_date, 'companion', 3),
  ('22222222-2222-2222-2222-222222222222', current_date, 'companion', 1);
insert into public.signals (user_id, kind, cause, cause_key, local_date, evidence) values
  ('11111111-1111-1111-1111-111111111111', 'long_attack', 'attack', 'long_attack:a', current_date, '{}'),
  ('22222222-2222-2222-2222-222222222222', 'long_attack', 'attack', 'long_attack:b', current_date, '{}');
insert into public.push_tokens (user_id, token, platform, device_secret_hash) values
  ('11111111-1111-1111-1111-111111111111', 'ExponentPushToken[account-a]', 'android', repeat('a', 64)),
  ('22222222-2222-2222-2222-222222222222', 'ExponentPushToken[account-b]', 'ios', repeat('b', 64));
insert into public.consent_events (user_id, kind, version, locale, granted) values
  ('11111111-1111-1111-1111-111111111111', 'terms', '2026-12-01', 'en', true),
  ('22222222-2222-2222-2222-222222222222', 'terms', '2026-12-01', 'es', true);
insert into public.push_claims (token, user_id, code_hash, nonce_hash, expires_at) values
  ('ExponentPushToken[account-b]', '11111111-1111-1111-1111-111111111111', repeat('c', 64), repeat('d', 64), now() + interval '10 minutes'),
  ('ExponentPushToken[account-a]', '22222222-2222-2222-2222-222222222222', repeat('c', 64), repeat('d', 64), now() + interval '10 minutes');
insert into public.push_claim_starts (token, user_id) values
  ('ExponentPushToken[account-b]', '11111111-1111-1111-1111-111111111111'),
  ('ExponentPushToken[account-a]', '22222222-2222-2222-2222-222222222222');
insert into public.push_tickets (ticket_id, token, user_id) values
  ('ticket-a', 'ExponentPushToken[account-a]', '11111111-1111-1111-1111-111111111111'),
  ('ticket-b', 'ExponentPushToken[account-b]', '22222222-2222-2222-2222-222222222222');

create temporary view account_rows as
  select 'profiles' as tbl, user_id from public.profiles
  union all select 'episodes', user_id from public.episodes
  union all select 'medications', user_id from public.medications
  union all select 'doses', user_id from public.doses
  union all select 'checkins', user_id from public.checkins
  union all select 'agent_notes', user_id from public.agent_notes
  union all select 'entitlements', user_id from public.entitlements
  union all select 'usage_counters', user_id from public.usage_counters
  union all select 'signals', user_id from public.signals
  union all select 'push_tokens', user_id from public.push_tokens
  union all select 'consent_events', user_id from public.consent_events
  union all select 'push_claims', user_id from public.push_claims
  union all select 'push_claim_starts', user_id from public.push_claim_starts
  union all select 'push_tickets', user_id from public.push_tickets;

select is(
  (select count(distinct tbl)::integer from account_rows where user_id = '11111111-1111-1111-1111-111111111111'),
  14,
  'user A has rows in all 14 user tables before the deletion'
);

-- 4. Deleting A (what the admin API does) cascades through every table, the NO ACTION doses included.
select lives_ok(
  $$ delete from auth.users where id = '11111111-1111-1111-1111-111111111111' $$,
  'deleting a user with doses on a medication, an open episode and a row in every table succeeds'
);

select is_empty(
  $$ select tbl from account_rows where user_id = '11111111-1111-1111-1111-111111111111' $$,
  'no row of the deleted user is left in any of the 14 tables'
);

select results_eq(
  $$ select tbl, count(*)::integer from account_rows where user_id = '22222222-2222-2222-2222-222222222222' group by tbl order by tbl $$,
  $$ values ('agent_notes', 1), ('checkins', 1), ('consent_events', 1), ('doses', 1), ('entitlements', 1), ('episodes', 1),
            ('medications', 1), ('profiles', 1), ('push_claim_starts', 1), ('push_claims', 1), ('push_tickets', 1),
            ('push_tokens', 1), ('signals', 1), ('usage_counters', 1) $$,
  'user B keeps every row'
);

select is(
  (select episode_id::text from public.doses where id = 'bbbbbbbb-2000-4000-8000-00000000000b'),
  'bbbbbbbb-0000-4000-8000-00000000000b',
  'user B''s dose still points at their episode'
);

-- A monitor run that read its targets before the deletion still calls save_signals for A: nothing is stored or answered.
select is_empty(
  $$ select * from public.save_signals(
       '11111111-1111-1111-1111-111111111111', current_date,
       '[{"kind": "long_attack", "cause": "attack", "causeKey": "long_attack:late", "evidence": {}}]'
     ) $$,
  'save_signals for a deleted user answers no rows instead of raising'
);
select is_empty(
  $$ select 1 from public.signals where user_id = '11111111-1111-1111-1111-111111111111' $$,
  'save_signals stores no signal for a deleted user'
);
select ok(
  has_function_privilege('service_role', 'public.save_signals(uuid, date, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.save_signals(uuid, date, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.save_signals(uuid, date, jsonb)', 'execute')
  and (select prosecdef and proconfig @> array['search_path=""'] from pg_catalog.pg_proc
       where oid = 'public.save_signals(uuid, date, jsonb)'::regprocedure),
  'save_signals stays service-role only, security definer with an empty search_path'
);

-- Only the user foreign key is tolerated: any other foreign key error still raises. signals has no other foreign key,
-- so this transaction adds one for the check (rolled back with the rest).
create table public.signals_fk_probe (cause_key text primary key);
alter table public.signals
  add constraint signals_cause_key_probe_fkey foreign key (cause_key) references public.signals_fk_probe (cause_key) not valid;
select throws_ok(
  $$ select * from public.save_signals(
       '22222222-2222-2222-2222-222222222222', current_date,
       '[{"kind": "long_attack", "cause": "attack", "causeKey": "long_attack:unprobed", "evidence": {}}]'
     ) $$,
  '23503', null,
  'save_signals re-raises a foreign key error other than signals_user_id_fkey'
);
alter table public.signals drop constraint signals_cause_key_probe_fkey;
drop table public.signals_fk_probe;

-- 5. prune_expired_caches(): usage counters live 30 days.
insert into public.usage_counters (user_id, day, kind, count) values
  ('22222222-2222-2222-2222-222222222222', (now() at time zone 'utc')::date - 31, 'companion', 4),
  ('22222222-2222-2222-2222-222222222222', (now() at time zone 'utc')::date - 29, 'companion', 5),
  ('22222222-2222-2222-2222-222222222222', (now() at time zone 'utc')::date - 30, 'dictation', 6);

select public.prune_expired_caches();

select results_eq(
  $$ select (now() at time zone 'utc')::date - day, count from public.usage_counters
     where user_id = '22222222-2222-2222-2222-222222222222' order by day $$,
  $$ values (30, 6), (29, 5), (0, 1) $$,
  'prune_expired_caches() deletes a 31-day-old usage counter and keeps the 30- and 29-day-old ones'
);

select ok(
  (select prosecdef and proconfig @> array['search_path=""'] from pg_catalog.pg_proc
   where oid = 'public.prune_expired_caches()'::regprocedure),
  'prune_expired_caches() stays security definer with an empty search_path'
);

select ok(
  not has_function_privilege('anon', 'public.prune_expired_caches()', 'execute')
  and not has_function_privilege('authenticated', 'public.prune_expired_caches()', 'execute'),
  'neither anon nor authenticated can run prune_expired_caches()'
);

select alike(
  obj_description('public.prune_expired_caches()'::regprocedure, 'pg_proc'),
  '%usage counters over 30 days old%'::text,
  'the prune''s comment names the usage counter lifetime'
);

select * from finish();
rollback;
