-- The database audit's catalog pins (docs/audits/database.md): each query lists the objects that break a rule and must
-- come back empty. The exact client grant sets and function lists stay in api_audit.test.sql, the cascade in account.test.sql.
begin;

create extension if not exists pgtap with schema extensions;

select plan(20);

-- 1. RLS on every table in public.
select is_empty(
  $$
    select c.relname::text
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
  $$,
  'every public table has row level security enabled'
);

-- 2.
select is_empty(
  $$
    select c.relname::text
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
      and not exists (select 1 from pg_catalog.pg_constraint k where k.conrelid = c.oid and k.contype = 'p')
  $$,
  'every public table has a primary key'
);

-- 3. A bare auth.uid() in a policy runs once per row; wrapped in a select it runs once per statement (an init plan).
select is_empty(
  $$
    select tablename::text || '.' || policyname::text
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and pg_catalog.regexp_replace(
            coalesce(qual, '') || ' ' || coalesce(with_check, ''),
            '\(\s*SELECT\s+auth\.(uid|jwt|role)\(\)\s+AS\s+\w+\)', '', 'gi'
          ) ~* 'auth\.(uid|jwt|role)\(\)'
  $$,
  'every policy calls auth.uid(), auth.jwt() and auth.role() only inside a select'
);

-- 4.
select is_empty(
  $$
    select tablename::text || '.' || policyname::text
    from pg_catalog.pg_policies
    where schemaname = 'public' and roles <> '{authenticated}'::name[]
  $$,
  'every policy is to authenticated only'
);

-- 5. Security invoker functions too: a trigger or check function runs with the writer's search_path otherwise.
select is_empty(
  $$
    select n.nspname::text || '.' || p.proname::text
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and not exists (select 1 from pg_catalog.pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and not ('search_path=""' = any (coalesce(p.proconfig, '{}')))
  $$,
  'every function in public and private sets search_path to empty'
);

-- 6. A null proacl means the default, which grants execute to PUBLIC.
select is_empty(
  $$
    select n.nspname::text || '.' || p.proname::text
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    where n.nspname in ('public', 'private')
      and not exists (select 1 from pg_catalog.pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and a.grantee = 0
  $$,
  'no function in public or private is executable by PUBLIC'
);

-- 7. api_audit pins public; this adds private.
select set_eq(
  $$
    select n.nspname::text || '.' || p.proname::text
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and has_function_privilege('anon', p.oid, 'execute')
  $$,
  $$ values ('public.keep_alive') $$,
  'anon executes nothing in public or private but keep_alive'
);

-- 8.
select is_empty(
  $$
    select p.proname::text
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and has_function_privilege('authenticated', p.oid, 'execute')
  $$,
  'authenticated executes nothing in private'
);

-- 9. A foreign key without an index on its leading columns makes every delete or key update on the referenced table scan
-- the referencing one (the auth.users cascade included). Partial indexes do not cover every row.
select is_empty(
  $$
    select k.conrelid::regclass::text || ' ' || k.conname::text
    from pg_catalog.pg_constraint k
    join pg_catalog.pg_class r on r.oid = k.conrelid
    join pg_catalog.pg_namespace n on n.oid = r.relnamespace
    where k.contype = 'f' and n.nspname = 'public'
      and not exists (
        select 1 from pg_catalog.pg_index i
        where i.indrelid = k.conrelid
          and i.indpred is null
          and (i.indkey::int2[])[0:pg_catalog.cardinality(k.conkey) - 1] @> k.conkey
          and (i.indkey::int2[])[0:pg_catalog.cardinality(k.conkey) - 1] <@ k.conkey
      )
  $$,
  'every public foreign key has an index on its leading columns'
);

-- 10. Supabase's default privileges grant every new sequence (an identity column's included) to the API roles.
select is_empty(
  $$
    select c.relname::text || ' ' || r.rolname::text
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'::name), ('authenticated'::name)) r (rolname)
    where n.nspname = 'public' and c.relkind = 'S'
      and (has_sequence_privilege(r.rolname, c.oid, 'usage')
        or has_sequence_privilege(r.rolname, c.oid, 'select')
        or has_sequence_privilege(r.rolname, c.oid, 'update'))
  $$,
  'anon and authenticated hold no privilege on a public sequence'
);

-- 11.
select is_empty(
  $$
    select table_name::text || ' ' || privilege_type::text
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'anon'
    union all
    select table_name::text || '.' || column_name::text || ' ' || privilege_type::text
    from information_schema.column_privileges
    where table_schema = 'public' and grantee = 'anon'
  $$,
  'anon holds no table or column privilege in public'
);

-- 12. The client's only writes: the profiles settings columns (pinned exactly in api_audit) and its own push token rows.
select is_empty(
  $$
    select table_name::text || ' ' || privilege_type::text
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee = 'authenticated'
      and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES')
      and not (table_name = 'push_tokens' and privilege_type = 'DELETE')
    union all
    select table_name::text || '.' || column_name::text || ' ' || privilege_type::text
    from information_schema.column_privileges
    where table_schema = 'public' and grantee = 'authenticated'
      and privilege_type in ('INSERT', 'UPDATE', 'REFERENCES')
      and not (table_name = 'profiles' and privilege_type = 'UPDATE')
  $$,
  'authenticated writes nothing but the profiles settings columns and push_tokens deletes'
);

-- 13. Local wall times are `time` and local days `date`; an instant is always timestamptz.
select is_empty(
  $$
    select table_name::text || '.' || column_name::text
    from information_schema.columns
    where table_schema = 'public' and data_type = 'timestamp without time zone'
  $$,
  'no public column is a timestamp without time zone'
);

-- 14. A text column is bounded by a check or a foreign key. Scope: plain text and varchar columns of public tables; any
-- check or foreign key naming the column counts as its bound (its content is not read); jsonb and text[] are left out
-- (text[] columns carry catalog checks). The two consent versions are the reviewed exceptions: only accept_terms and
-- set_ai_consent write them, after checking the version is a consent_texts row.
select set_eq(
  $$
    select c.relname::text || '.' || a.attname::text
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
      and a.atttypid in ('text'::regtype, 'varchar'::regtype)
      and not exists (
        select 1 from pg_catalog.pg_constraint k
        where k.conrelid = c.oid and k.contype in ('c', 'f') and a.attnum = any (k.conkey)
      )
  $$,
  $$ values ('profiles.terms_version'), ('profiles.ai_consent_version') $$,
  'every public text column but the two consent versions has a check or a foreign key'
);

-- 15. Hourly, so the policy's shortest period (push ownership checks, up to 2 hours) holds.
select set_eq(
  $$ select jobname::text || ' | ' || schedule || ' | ' || username::text from cron.job $$,
  $$ values ('prune-expired-caches | 17 * * * * | postgres'), ('monitor | 5 * * * * | postgres') $$,
  'the two jobs run as postgres, the prune hourly at :17 and the monitor at :05'
);

-- 16-17. Every period the privacy policy states, one row past it and one inside it.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data)
values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'audit-db@example.com', crypt('password', gen_salt('bf')), '{}', '{}');

insert into public.weather_cache (location_key, fetched_at, payload) values
  ('4.6,-74.1', now() - interval '3 days', '{}'), ('4.6,-74.1', now() - interval '1 day', '{}');
insert into public.signals (user_id, kind, cause, cause_key, local_date, evidence, computed_at) values
  ('11111111-1111-1111-1111-111111111111', 'pressure', 'pressure', 'pressure:old', current_date - 31, '{}', now() - interval '31 days'),
  ('11111111-1111-1111-1111-111111111111', 'pressure', 'pressure', 'pressure:new', current_date - 29, '{}', now() - interval '29 days');
insert into public.push_tickets (ticket_id, token, user_id, created_at) values
  ('ticket-old', 'ExponentPushToken[audit]', '11111111-1111-1111-1111-111111111111', now() - interval '3 days'),
  ('ticket-new', 'ExponentPushToken[audit]', '11111111-1111-1111-1111-111111111111', now() - interval '1 day');
insert into public.push_claims (token, user_id, code_hash, nonce_hash, expires_at) values
  ('ExponentPushToken[old]', '11111111-1111-1111-1111-111111111111', repeat('a', 64), repeat('b', 64), now() - interval '1 minute'),
  ('ExponentPushToken[new]', '11111111-1111-1111-1111-111111111111', repeat('a', 64), repeat('b', 64), now() + interval '5 minutes');
insert into public.push_claim_starts (token, user_id, started_at) values
  ('ExponentPushToken[old]', '11111111-1111-1111-1111-111111111111', now() - interval '61 minutes'),
  ('ExponentPushToken[new]', '11111111-1111-1111-1111-111111111111', now() - interval '59 minutes');
insert into public.usage_counters (user_id, day, kind, count) values
  ('11111111-1111-1111-1111-111111111111', (now() at time zone 'utc')::date - 31, 'companion', 1),
  ('11111111-1111-1111-1111-111111111111', (now() at time zone 'utc')::date - 29, 'companion', 1);

select public.prune_expired_caches();

select is(
  (select count(*)::int from public.weather_cache where fetched_at < now() - interval '2 days')
    + (select count(*)::int from public.signals where cause_key = 'pressure:old')
    + (select count(*)::int from public.push_tickets where ticket_id = 'ticket-old')
    + (select count(*)::int from public.push_claims where token = 'ExponentPushToken[old]')
    + (select count(*)::int from public.push_claim_starts where token = 'ExponentPushToken[old]')
    + (select count(*)::int from public.usage_counters where day < (now() at time zone 'utc')::date - 30),
  0,
  'the prune removes forecasts, signals, receipts, ownership checks and usage counts past the policy''s periods'
);
select is(
  (select count(*)::int from public.weather_cache where location_key = '4.6,-74.1')
    + (select count(*)::int from public.signals where cause_key = 'pressure:new')
    + (select count(*)::int from public.push_tickets where ticket_id = 'ticket-new')
    + (select count(*)::int from public.push_claims where token = 'ExponentPushToken[new]')
    + (select count(*)::int from public.push_claim_starts where token = 'ExponentPushToken[new]')
    + (select count(*)::int from public.usage_counters where user_id = '11111111-1111-1111-1111-111111111111'),
  6,
  'the prune keeps every row still inside its period'
);

-- 18. supabase db lint (plpgsql_check) flags an untyped '{}' returned as text[].
select ok(
  pg_catalog.pg_get_functiondef('private.to_text_array(jsonb)'::regprocedure) like '%return ''{}''::text[];%',
  'private.to_text_array returns a typed empty array, so supabase db lint is clean'
);

-- 19-20. The signal kinds the database accepts, read from the live constraint whatever migration form added it.
-- scripts/__tests__/schema-parity.test.ts compares the migration text with the pack's signals.priority; these fail
-- first if a later check is written in a form that test's pattern misses.
select is(
  (select count(*)::int
   from pg_catalog.pg_constraint k
   join pg_catalog.pg_attribute a on a.attrelid = k.conrelid and a.attname = 'kind'
   where k.conrelid = 'public.signals'::regclass and k.contype = 'c' and a.attnum = any (k.conkey)),
  1,
  'one check constraint bounds signals.kind'
);
select set_eq(
  $$
    select m[1]
    from pg_catalog.pg_constraint k
    join pg_catalog.pg_attribute a on a.attrelid = k.conrelid and a.attname = 'kind'
    cross join lateral pg_catalog.regexp_matches(pg_catalog.pg_get_constraintdef(k.oid), '''([a-z_]+)''', 'g') m
    where k.conrelid = 'public.signals'::regclass and k.contype = 'c' and a.attnum = any (k.conkey)
  $$,
  $$ values ('long_attack'), ('overuse_limit'), ('debrief_due'), ('overuse_warn'), ('short_sleep'), ('pressure'), ('quiet_tracker') $$,
  'signals.kind accepts exactly the seven signal kinds'
);

select * from finish();
rollback;
