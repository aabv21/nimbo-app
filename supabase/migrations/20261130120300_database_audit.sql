-- The database audit's fixes (docs/audits/database.md): a covering index, a sequence closed to the API roles, bounded
-- push token copies, a typed empty array for supabase db lint, and the prune run hourly so the policy's periods hold.

-- DB-1. A delete or key update on consent_texts checks consent_events by (kind, version).
create index consent_events_kind_version_idx on public.consent_events (kind, version);

-- DB-2. Supabase's default privileges granted the identity sequence to the API roles; no client touches the table.
revoke all on sequence public.push_claim_starts_id_seq from anon, authenticated;

-- DB-3. Server-only copies of a push token: bounded like push_tokens.token, which every one of them comes from.
alter table public.push_claims
  add constraint push_claims_token_check check (char_length(token) between 1 and 255);
alter table public.push_claim_starts
  add constraint push_claim_starts_token_check check (char_length(token) between 1 and 255);
alter table public.push_tickets
  add constraint push_tickets_token_check check (char_length(token) between 1 and 255);

-- DB-4. Unchanged from 20261127120000_tracking.sql but for the typed '{}' (plpgsql_check: no assignment cast from text).
create or replace function private.to_text_array(p_value jsonb)
returns text[]
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value is null or pg_catalog.jsonb_typeof(p_value) = 'null' then
    return '{}'::text[];
  end if;
  if pg_catalog.jsonb_typeof(p_value) <> 'array' then
    raise exception 'an array is required' using errcode = '22023';
  end if;
  return array(select pg_catalog.jsonb_array_elements_text(p_value));
end;
$$;

-- DB-5. Hourly instead of daily: a claim start must live an hour for push-claim's limits, so with an hourly run it is gone
-- within two, which is what the privacy policy states; the other periods hold to the hour instead of the day.
select cron.schedule('prune-expired-caches', '17 * * * *', 'select public.prune_expired_caches()');

comment on function public.prune_expired_caches() is
  'Deletes cache rows past their lifetime, expired push claims, claim starts over an hour old, signals 30 days stale '
  '(but each user''s newest pushed quiet stretch), push tickets over 2 days old, usage counters over 30 days old and a '
  'week-old run history of Nimbo''s jobs. Run hourly by the pg_cron job prune-expired-caches; no client grants.';

comment on table public.push_claim_starts is
  'Claim starts in the last hour, for push-claim''s limits (per token and account, per account, '
  'distinct accounts per token). Server-only; the hourly prune drops older rows.';
