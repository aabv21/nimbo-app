-- Push registration (docs/database.md#push-tokens): `public.push_tokens`, written through `register_push_token()`
-- with the phone's device secret or reclaimed through `public.push_claims`, and the expired claims' cleanup.

-- public.push_tokens ---------------------------------------------------------------------------

create table public.push_tokens (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  token text not null,
  platform text not null,
  updated_at timestamptz not null default now(),
  -- SHA-256 (hex) of the phone's own random secret: only that phone can register or unregister the token.
  device_secret_hash text not null,
  primary key (user_id, token),
  constraint push_tokens_device_secret_hash_check check (device_secret_hash ~ '^[0-9a-f]{64}$'),
  constraint push_tokens_platform_check check (platform in ('ios', 'android')),
  constraint push_tokens_token_check check (token ~ '^(ExponentPushToken|ExpoPushToken)\[.+\]$' and char_length(token) <= 255)
);

comment on table public.push_tokens is
  'One phone''s Expo push token per row: that phone gets the signal pushes. Deleted on sign-out, when Expo '
  'says the phone is gone, and with the account. Never exported.';

-- The server deletes a dead token, takes a token over and claims it by the token alone.
create index push_tokens_token_idx on public.push_tokens (token);

alter table public.push_tokens enable row level security;

create policy "push_tokens_select_own" on public.push_tokens
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "push_tokens_delete_own" on public.push_tokens
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.push_tokens from anon;
-- Clients write only through register_push_token() (insert and update revoked outright, rather than
-- left to the missing policies), read every column but the secret's hash, and delete their own rows.
revoke select, insert, update, truncate, trigger, references on public.push_tokens from authenticated;
grant select (user_id, token, platform, updated_at) on public.push_tokens to authenticated;

-- `updated_at` is the server's registration time (clock_timestamp(), not now(): two registrations in one
-- transaction still order). Only a registration moves it.
create function public.push_tokens_stamp()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.clock_timestamp();
  return new;
end;
$$;

revoke execute on function public.push_tokens_stamp() from public, anon, authenticated;

create trigger push_tokens_stamp
  before insert or update of token, platform, device_secret_hash on public.push_tokens
  for each row execute function public.push_tokens_stamp();

-- public.register_push_token() -----------------------------------------------------------------

-- A token belongs to one phone, and the phone proves itself with its device secret: another account's
-- row for the token under a different secret refuses the call (someone who only knows the token), while
-- the same secret is that phone with a new account signed in, which takes the token over. The caller's
-- own row may change secret (a reinstall can keep the token but not the secret). A phone that lost its
-- secret reclaims its token by proving it receives the token's pushes (push_claims below).
-- NOTE: whoever holds the unlocked phone holds its secret and its pushes; upgrade: OS-backed device attestation, if the app ever holds data worth that.
create function public.register_push_token(p_token text, p_platform text, p_device_secret text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_hash text;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'register_push_token: not signed in';
  end if;
  if p_token is null or p_token !~ '^(ExponentPushToken|ExpoPushToken)\[.+\]$' or char_length(p_token) > 255 then
    raise exception using errcode = '22023', message = 'register_push_token: not an Expo push token';
  end if;
  if p_platform is null or p_platform not in ('ios', 'android') then
    raise exception using errcode = '22023', message = 'register_push_token: platform must be ios or android';
  end if;
  -- 32 hex characters is 128 bits; the app sends 64.
  if p_device_secret is null or p_device_secret !~ '^[0-9a-f]{32,128}$' then
    raise exception using errcode = '22023', message = 'register_push_token: the device secret must be 32 to 128 hex characters';
  end if;
  v_hash := pg_catalog.encode(extensions.digest(p_device_secret, 'sha256'), 'hex');

  -- Two registrations of one token wait for each other, so both can't pass the check.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('push_tokens:' || p_token, 0));

  if exists (
    select 1 from public.push_tokens
    where token = p_token and user_id <> v_user and device_secret_hash <> v_hash
  ) then
    raise exception using errcode = '42501', message = 'register_push_token: another device holds this token';
  end if;

  delete from public.push_tokens where token = p_token and user_id <> v_user;

  insert into public.push_tokens (user_id, token, platform, device_secret_hash)
  values (v_user, p_token, p_platform, v_hash)
  on conflict (user_id, token) do update
    set platform = excluded.platform,
        device_secret_hash = excluded.device_secret_hash;
end;
$$;

comment on function public.register_push_token(text, text, text) is
  'Stores the caller''s push token with the SHA-256 of the phone''s secret. 22023 for a bad token, platform '
  'or secret; 42501 when another account holds the token under another secret. The same secret (that '
  'phone, a new account) deletes the other accounts'' rows first.';

revoke execute on function public.register_push_token(text, text, text) from public, anon;
grant execute on function public.register_push_token(text, text, text) to authenticated;

-- public.push_claims, public.push_claim_starts ------------------------------------------------

-- A reclaim in flight, one per token and account: the push-claim function sent a code to the token as a
-- push; whoever types it back proves the phone receives that token's pushes. Keyed by account too, so one
-- account's claim never blocks another's; the nonce the claiming phone made is echoed in the push, so a
-- phone answers only its own claim's code. Server-only, like the caches.
create table public.push_claims (
  token text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  code_hash text not null,
  nonce_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts smallint not null default 0,
  primary key (token, user_id),
  constraint push_claims_code_hash_check check (code_hash ~ '^[0-9a-f]{64}$'),
  constraint push_claims_nonce_hash_check check (nonce_hash ~ '^[0-9a-f]{64}$'),
  constraint push_claims_attempts_check check (attempts between 0 and 5)
);

comment on table public.push_claims is
  'One reclaim per push token and account: the SHA-256 of the code pushed to the token and of the '
  'claiming phone''s nonce, 10 minutes and 5 attempts to type it back. No client grants; only '
  'push-claim (service role) uses it.';

create index push_claims_user_id_idx on public.push_claims (user_id);

-- Every claim start that sent a code, for the rate limits; kept an hour.
create table public.push_claim_starts (
  id bigint generated always as identity primary key,
  token text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  started_at timestamptz not null default now()
);

comment on table public.push_claim_starts is
  'Claim starts in the last hour, for push-claim''s limits (per token and account, per account, '
  'distinct accounts per token). Server-only; the daily cleanup drops older rows.';

create index push_claim_starts_user_id_started_at_idx on public.push_claim_starts (user_id, started_at);
create index push_claim_starts_token_started_at_idx on public.push_claim_starts (token, started_at);

alter table public.push_claims enable row level security;
alter table public.push_claim_starts enable row level security;

revoke all on public.push_claims from anon, authenticated;
revoke all on public.push_claim_starts from anon, authenticated;

-- Starts (or restarts) the caller's claim on a token another account holds (a token nobody holds simply
-- registers; the holder has nothing to claim, and that call isn't counted), sending a code at most: once
-- per token and account per 10 minutes, 5 times per account per hour, and for at most 6 distinct accounts
-- per token per hour.
-- NOTE: the per-token cap is a spam guard, so locking a token's claims for an hour takes the token plus 6 accounts (Auth rate-limits sign-ups); upgrade: a per-device quota, if it happens.
create function public.start_push_claim(p_user_id uuid, p_token text, p_code_hash text, p_nonce_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('push_tokens:' || p_token, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('push_claims_user:' || p_user_id::text, 0));
  if not exists (select 1 from public.push_tokens where token = p_token)
     or exists (select 1 from public.push_tokens where token = p_token and user_id = p_user_id) then
    return false;
  end if;
  if exists (
    select 1 from public.push_claim_starts
    where token = p_token and user_id = p_user_id and started_at > pg_catalog.now() - interval '10 minutes'
  )
  or (select count(*) from public.push_claim_starts where user_id = p_user_id and started_at > pg_catalog.now() - interval '1 hour') >= 5
  or (
    not exists (
      select 1 from public.push_claim_starts
      where token = p_token and user_id = p_user_id and started_at > pg_catalog.now() - interval '1 hour'
    )
    and (
      select count(distinct user_id) from public.push_claim_starts
      where token = p_token and started_at > pg_catalog.now() - interval '1 hour'
    ) >= 6
  )
  then
    return false;
  end if;
  insert into public.push_claims (token, user_id, code_hash, nonce_hash, created_at, expires_at)
  values (p_token, p_user_id, p_code_hash, p_nonce_hash, pg_catalog.now(), pg_catalog.now() + interval '10 minutes')
  on conflict (token, user_id) do update
    set code_hash = excluded.code_hash, nonce_hash = excluded.nonce_hash, created_at = excluded.created_at,
        expires_at = excluded.expires_at, attempts = 0;
  insert into public.push_claim_starts (token, user_id) values (p_token, p_user_id);
  return true;
end;
$$;

-- Spends one of the claimant's 5 attempts on their unexpired claim with this nonce and answers the code's
-- hash, which the function compares in constant time; null when there is nothing to attempt. No advisory
-- lock: finish_push_claim re-checks the claim under the token's lock.
create function public.push_claim_attempt(p_user_id uuid, p_token text, p_nonce_hash text)
returns text
language sql
security definer
set search_path = ''
as $$
  update public.push_claims
  set attempts = attempts + 1
  where token = p_token and user_id = p_user_id and nonce_hash = p_nonce_hash
    and expires_at > pg_catalog.now() and attempts < 5
  returning code_hash;
$$;

-- After a matching code, in one transaction: the caller's claim must still be open; then every claim on
-- the token and its other rows go, and the claimant's row takes the new secret's hash. False when the
-- caller's claim is gone or expired.
create function public.finish_push_claim(p_user_id uuid, p_token text, p_platform text, p_device_secret text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_platform is null or p_platform not in ('ios', 'android') or p_device_secret is null or p_device_secret !~ '^[0-9a-f]{32,128}$' then
    raise exception using errcode = '22023', message = 'finish_push_claim: bad platform or device secret';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('push_tokens:' || p_token, 0));
  delete from public.push_claims where token = p_token and user_id = p_user_id and expires_at > pg_catalog.now();
  if not found then
    return false;
  end if;
  -- The token is settled: every other open claim on it goes too.
  delete from public.push_claims where token = p_token;
  delete from public.push_tokens where token = p_token and user_id <> p_user_id;
  insert into public.push_tokens (user_id, token, platform, device_secret_hash)
  values (p_user_id, p_token, p_platform, pg_catalog.encode(extensions.digest(p_device_secret, 'sha256'), 'hex'))
  on conflict (user_id, token) do update
    set platform = excluded.platform,
        device_secret_hash = excluded.device_secret_hash;
  return true;
end;
$$;

revoke execute on function public.start_push_claim(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.push_claim_attempt(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.finish_push_claim(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.start_push_claim(uuid, text, text, text) to service_role;
grant execute on function public.push_claim_attempt(uuid, text, text) to service_role;
grant execute on function public.finish_push_claim(uuid, text, text, text) to service_role;

-- public.prune_expired_caches(): expired push claims -------------------------------------------

-- The first two deletes are unchanged from 20261129120100_weather_cache.sql.
create or replace function public.prune_expired_caches()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The functions read a forecast for 3 hours at most.
  delete from public.weather_cache
  where fetched_at < pg_catalog.now() - interval '2 days';

  -- pg_cron never deletes run history; Nimbo's jobs keep a week of it.
  delete from cron.job_run_details d
  using cron.job j
  where j.jobid = d.jobid
    and j.jobname in ('prune-expired-caches', 'monitor')
    and coalesce(d.end_time, d.start_time) < pg_catalog.now() - interval '7 days';

  delete from public.push_claims
  where expires_at < pg_catalog.now();

  -- push-claim's limits look back one hour.
  delete from public.push_claim_starts
  where started_at < pg_catalog.now() - interval '1 hour';
end;
$$;

comment on function public.prune_expired_caches() is
  'Deletes cache rows past their lifetime, expired push claims, claim starts over an hour old and a '
  'week-old run history of Nimbo''s jobs. Run daily by the pg_cron job prune-expired-caches; no client grants.';
