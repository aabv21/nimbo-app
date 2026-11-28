# Database

The backend is Supabase (Postgres 17), run locally through the `db:*` scripts ([`local-stack.md`](local-stack.md)).
This document covers what the migrations create: `public.profiles`, its policies and grants, the
signup trigger, the consent RPCs, the tracking tables with their RPCs, entitlements, the AI quotas, the companion's data (the debrief columns, `set_dose_helped` and `agent_notes`) `record_inputs`, the read the insights and signals run on, the pressure forecast cache, the stored signals, the push tokens, and the hourly monitor's RPCs, receipts queue and job. Schema changes are new migration files in
`supabase/migrations/`; a merged migration is never edited. The diagram [`diagrams/data-model.svg`](diagrams/data-model.svg) shows how the pieces relate, and [`architecture.md`](architecture.md#the-consent-model) explains why consent is RPC-only.

## `public.profiles`

One row per `auth.users` row (`user_id` is the primary key, with `on delete cascade`), created by
the signup trigger. A client never inserts a row, so every client write is an update.

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | `uuid` | primary key, references `auth.users (id)` |
| `condition` | `text` | `not null default 'migraine'`; check allows only `migraine`; not client-writable |
| `language` | `app_language` | nullable (`en`, `es`, `pt`); null follows the device |
| `timezone` | `text` | nullable; 1 to 64 characters; an IANA zone name, else `22023` from the `profiles_check_timezone` trigger ([the hourly monitor](#the-hourly-monitor)) |
| `theme` | `app_theme` | `not null default 'system'` (`system`, `day`, `dark`, `dim`); `system` follows the phone between `day` and `dark` |
| `reduce_motion` | `boolean` | `not null default false` |
| `notify_start`, `notify_end` | `time` | `not null`, default `08:00` and `21:00` |
| `notify_daily_cap` | `smallint` | `not null default 2`; check 0 to 2 |
| `lock_screen_detail` | `boolean` | `not null default false` |
| `coarse_lat`, `coarse_lon` | `numeric(4,1)` | nullable; checks -90 to 90 and -180 to 180; one decimal, so a stored location is coarse by construction |
| `known_triggers` | `text[]` | `not null default '{}'`; every value must be a key of the triggers catalog, none repeated (`is_catalog_subset`) |
| `track_period` | `boolean` | `not null default false`; client-writable |
| `priority` | `text` | nullable; one of `fewer`, `triggers`, `overuse`, `logging` (narrowed by the onboarding_profile migration) |
| `adult_confirmed_at`, `boundary_accepted_at` | `timestamptz` | nullable; set only by `accept_terms` |
| `ai_consent_answered_at` | `timestamptz` | nullable; set by `set_ai_consent`, kept when the answer is no |
| `ai_enabled` | `boolean` | `not null default false`; set only by `set_ai_consent` |
| `ai_consent_at` | `timestamptz` | nullable; set when consent is given, cleared when it is withdrawn |
| `onboarding_completed_at` | `timestamptz` | nullable; not client-writable |
| `created_at`, `updated_at` | `timestamptz` | `not null default now()`; `updated_at` is set by a trigger |

## Row level security and grants

RLS is enabled. The migration revokes every default privilege on the table from `anon` and
`authenticated`, then grants back only what is needed:

| Role | Select | Insert | Update | Delete |
| --- | --- | --- | --- | --- |
| `anon` | no | no | no | no |
| `authenticated` | own row (`profiles_select_own`) | no | own row (`profiles_update_own`), the columns below | no |

`profiles_update_own` has both `using` and `with check` on `user_id = (select auth.uid())`, so a row
cannot be moved to another user. Update is granted on these columns only: `language`, `timezone`,
`theme`, `reduce_motion`, `notify_start`, `notify_end`, `notify_daily_cap`, `lock_screen_detail`,
`coarse_lat`, `coarse_lon`, `known_triggers`, `priority`, `track_period`. Updating any other column (every consent
column, `condition`, `onboarding_completed_at`, `user_id`) fails with `42501`. Insert and delete are
revoked outright, so they also fail with `42501` rather than silently matching no rows.

## Signup and update triggers

- `on_auth_user_created` runs `handle_new_user()` after an insert on `auth.users` and inserts the profile row with every default.
- `profiles_set_updated_at` runs `set_updated_at()` before each update.

Both functions are revoked from `public`, `anon` and `authenticated`: a trigger still fires, only a direct call is blocked.

## Functions

Every `security definer` function sets `search_path = ''`, qualifies every name, is revoked from
`public` and `anon`, and is granted to `authenticated` only.

| Function | Contract |
| --- | --- |
| `accept_terms(p_adult boolean, p_boundary boolean) returns void` | Raises `22023` unless both arguments are true. Sets `adult_confirmed_at` and `boundary_accepted_at` to the server time where they are null, so a repeat call keeps the first timestamps. |
| `set_ai_consent(p_enabled boolean) returns void` | Raises `22023` on null. Sets `ai_consent_answered_at` to the server time, `ai_enabled` to the answer, and `ai_consent_at` to the server time when true and null when false. |
| `complete_onboarding() returns void` | Raises `22023` until `boundary_accepted_at` and `ai_consent_answered_at` are both set, then sets `onboarding_completed_at = coalesce(onboarding_completed_at, now())`, so a repeat keeps the first time. |
| `keep_alive() returns timestamptz` | `security invoker`, reads no table, answers the server time. The only function `anon` may execute; it lets a scheduled call keep a free hosted project from pausing. |

Both consent functions raise `42501` when there is no signed-in user. The client never writes a
consent timestamp, so a timestamp cannot be forged or back-dated.

## Tracking tables

Added by `20261127120000_tracking.sql`. Every table has `user_id uuid not null references auth.users on delete cascade`,
`created_at`, and `updated_at` kept by `set_updated_at`. RLS is on, each has one read-own `select`
policy `to authenticated`, and `anon` and `authenticated` hold nothing but `select`: every write is an
RPC (a direct insert, update or delete fails with `42501`).

| Table | Key and columns |
| --- | --- |
| `episodes` | `id uuid` pk; `condition` (`migraine`); `started_at`; `ended_at` (check `>= started_at`); `intensity` 0 to 10; `pain_areas`, `symptoms`, `triggers`, `reliefs` (`text[]`, each checked against its catalog); `notes` (at most 2000 characters); `source` |
| `medications` | `id uuid` pk; `name` (1 to 80 characters, trimmed); `kind`; `form` (default `oral`); `class`; `dose_text` (at most 120); `min_interval_minutes` 15 to 4320; `schedule`, `schedule_time`, `schedule_anchor`; `archived_at`. Checks: a schedule only on a preventive, a schedule needs a time, monthly and quarterly need an anchor |
| `doses` | `id uuid` pk; `medication_id` references `medications`; `episode_id` references `episodes` with `on delete set null`; `taken_at` |
| `checkins` | primary key `(user_id, local_date)`; `sleep_band`, `sleep_quality`, `stress`; booleans `low_water`, `extra_caffeine`, `alcohol`, `skipped_meal`, `screen_heavy`, `period_started` (default false) |

Indexes: `episodes (user_id, started_at desc)`, `doses (user_id, taken_at desc)`, `doses (episode_id)`,
`doses (medication_id)`, `medications (user_id)`. The debrief columns are added by `20261128120100_companion_data.sql` (see [Companion data](#companion-data)).

Enums: `episode_source` (`manual`, `voice`, `chat`), `medication_kind` (`preventive`, `acute`),
`medication_form` (`oral`, `injection`, `nasal`, `other`), `medication_class` (the condition pack's seven
classes), `medication_schedule` (`daily`, `monthly`, `quarterly`), `sleep_band` (`lt5`, `5_6`, `6_7`, `7_8`, `gt8`),
`sleep_quality` (`bad`, `ok`, `good`), `stress_level` (`low`, `mid`, `high`).

### Catalog helpers

- `catalog_keys(p_catalog text) returns text[]`: the keys of `painAreas`, `symptoms`, `triggers` or `reliefs`; null for any other name. Its body is generated from the TypeScript condition pack.
- `is_catalog_subset(p_values text[], p_catalog text) returns boolean`: true when the array has no null, no duplicate and only catalog keys.

Both are `immutable`, `security invoker`, and granted to `authenticated` (revoked from `public` and `anon`),
because a check constraint runs as the role that writes: `profiles.known_triggers` is still updated
directly by the client. `scripts/__tests__/catalog-sql.test.ts` fails when the newest migration's `catalog_keys` differs from the pack.

To change a catalog: edit the pack in `supabase/functions/_shared/condition/migraine.ts`, run
`pnpm catalog:sql`, and put its output in a new migration. Never edit a merged one.

NOTE: removing a catalog key does not recheck existing rows, so a later `update_episode` on such a row fails with 23514; migrate the rows first.

### Tracking RPCs

All are `security definer`, set `search_path = ''`, filter by the caller themselves (the owner role skips RLS),
and are granted to `authenticated` only. Errors: no signed-in user `42501`; an unknown `p_fields` key or a
non-object `22023`; a record that is not the caller's `P0002`; a value outside a catalog, a duplicate or an
out-of-range number `23514`; a missing required column `23502`; text that is not a valid enum value, number, date, time or boolean `22P02` (raised by the cast); a number too large for its column `22003`. A client time up to 24 hours ahead of the server's clock is
stored as now (`least(time, now())`), because a phone clock running fast would otherwise fail the write for good and
every later write to that record with `P0002`; a time more than 24 hours ahead, or before 2000-01-01, raises `22023`.
Clamping keeps the order of a start and an end sent together; a start clamped by `update_episode` stops at an end
stored earlier. `p_fields` keys are column names.

| Function | Contract |
| --- | --- |
| `log_episode(p_id, p_started_at, p_fields)` | Inserts, `on conflict (id) do nothing`, so a retry keeps the first fields. Keys: `ended_at, intensity, pain_areas, symptoms, triggers, reliefs, notes, source`. |
| `update_episode(p_id, p_fields)` | Patches only the keys present; a json null clears the column (an array becomes empty). Keys: `started_at` (people log late; it gets the same time check as `log_episode`'s start and cannot be cleared), then the `log_episode` keys. A start after the end, or an end before the start, is `23514`. `P0002` when the episode is not the caller's. |
| `end_episode(p_id, p_ended_at)` | Sets `ended_at`; before the start is `23514`; a repeat with the same value succeeds. |
| `delete_episode(p_id)` | Deletes; a missing or foreign row is not an error. Its doses keep existing with a null `episode_id`. |
| `save_medication(p_id, p_fields)` | Patches the caller's row, else inserts it. Keys: `name, kind, form, class, dose_text, min_interval_minutes, schedule, schedule_time, schedule_anchor, archived`; `archived: true` stamps `archived_at` (keeping an earlier stamp) and `false` clears it. An id that belongs to someone else is `P0002`. |
| `log_dose(p_id, p_medication_id, p_taken_at, p_episode_id)` | Inserts, idempotent on the id. `P0002` when the medication, or the episode when given, is not the caller's. |
| `delete_dose(p_id)` | Deletes; a missing or foreign row is not an error. |
| `save_checkin(p_local_date, p_fields)` | Upserts on `(user_id, local_date)`, merging only the keys present. A date later than the UTC date in 24 hours plus one day (a local day ahead of UTC, on a clock up to a day fast), or before 2000, is `22023`. Keys: `sleep_band, sleep_quality, stress, low_water, extra_caffeine, alcohol, skipped_meal, screen_heavy, period_started`. |

The key check, the time clamp (`client_time`) and the json-to-array conversion are functions in a `private` schema that
the API does not expose and no API role can use.

## Profile changes for onboarding

`20261127120100_onboarding_profile.sql` narrows the `priority` check to the four approved values, adds `track_period`, adds the
`known_triggers` catalog check and adds `complete_onboarding()` (see Functions). It is a separate migration
because the profiles migration was already merged.

## Premium access

`20261127120200_entitlements.sql` adds `public.entitlements`, one row per user, created lazily: no row means not premium.
The grant (`granted`, `granted_until`, `granted_note`) and the purchase (`purchase_active`, `purchase_expires_at`,
`purchase_source`) are independent, so a lapsed purchase never removes a grant and a revoked grant never removes a purchase.
RLS lets a user read only their own row; `anon` and `authenticated` have no write grant and there is no write policy, so only the
service role (the `pnpm premium` script) or an edit in the dashboard changes a row. The `set_updated_at` trigger stamps
`updated_at` on every change, as on the other tables.

`has_premium(p_user uuid) returns boolean` is `stable`, `security definer` with `search_path = ''`, and true when
`granted and (granted_until is null or granted_until > now())` or `purchase_active and (purchase_expires_at is null or purchase_expires_at > now())`.
An authenticated caller asking about another user gets `42501`; the service role may ask about anyone. It is granted to
`authenticated` and `service_role`, not `anon`. Edge Functions call it through `supabase/functions/_shared/premium.ts`.

## AI quotas

`20261128120000_quota.sql` adds the daily limits on the AI calls. `public.usage_counters(user_id, day, kind, count)` holds one
counter per user, day and `public.quota_kind` (`companion`, `dictation`, and `screen`, added alone by
`20261128120200_screen_quota.sql` since a new enum value cannot be used in the transaction that adds it), with primary key `(user_id, day, kind)`, `count >= 0`
and `on delete cascade` from `auth.users`. RLS is on with no policy, and every privilege is revoked from `anon` and
`authenticated`, so a client can neither read nor write a counter.

`consume_quota(p_user_id uuid, p_kind public.quota_kind, p_limit integer, p_day date) returns boolean` is `security definer`
with `search_path = ''`, revoked from `public`, `anon` and `authenticated` and granted to `service_role` only: the Edge
Functions call it through `supabase/functions/_shared/quota.ts` (40 `companion`, 20 `dictation` and 200 `screen` a day). It adds one to the
counter and returns true while the count is below `p_limit`, else false without counting; a null or zero limit is false.
`p_day` is the app's local day: it is counted as given when within one day of the UTC date (every time zone is), and on the
UTC day otherwise or when null, so the quota resets at the user's midnight. The day is a counter key, not a stored time, so
it takes this rule rather than `private.client_time`.

## Companion data

`20261128120100_companion_data.sql` adds what the companion and the day-after debrief store.

| Change | Contract |
| --- | --- |
| `episodes.helped`, `episodes.did_not_help` | `text[] not null default '{}'`, each checked against the `reliefs` catalog (`23514` outside it or for a duplicate). |
| `episodes.debriefed_at` | `timestamptz`, null until the debrief; stamped by the server clock only through `update_episode`. |
| `doses.helped` | `boolean`, null when not asked or cleared. |
| `update_episode(p_id, p_fields)` | Redefined with the Wave 2 body unchanged (the clamped start included), plus three keys: `helped`, `did_not_help` (arrays, like the other lists) and `debriefed`. `debriefed: true` stamps `debriefed_at` with `now()` once and keeps it on a repeat, so a replay after a lost reply does not move it; `false` clears it; any other json value is `22023`. The grants are kept. |
| `set_dose_helped(p_id uuid, p_helped boolean default null)` | Sets the caller's dose's `helped`; leaving `p_helped` out clears it (the generated type is `p_helped?: boolean`, so a client never sends a null). A repeat succeeds. `P0002` when the dose is not the caller's. |
| `public.agent_notes` | `id uuid` pk (`gen_random_uuid()`), `user_id` (cascade from `auth.users`), `text` (1 to 200 characters), `created_at`. Index `(user_id, created_at)`. RLS read-own `select`; `anon` and `authenticated` hold only `select`, so a direct write is `42501`. |
| `save_agent_note(p_text text) returns uuid` | Trims the text and inserts it under the caller. A null or a control character (which could fake a line or a tag in the prompt the notes are quoted in) is `22023`; empty after the trim or over 200 characters is `23514`; a 21st note is `23514`. The count check locks the caller's `profiles` row first, so two saves at once cannot make a 21st. Not idempotent: it is called online, never queued. |
| `delete_agent_note(p_id uuid)` | Deletes the caller's note; a missing or foreign id is a no-op. |

All three new RPCs are `security definer` with `search_path = ''`, `42501` when signed out, revoked from `public` and `anon`
and granted to `authenticated`.

## Records for the insights

`20261129120000_record_inputs.sql` adds one read of everything the insights (`supabase/functions/_shared/insights.ts`) need, in the
shape `parseRecordInputs` (`_shared/records.ts`) takes, so the companion's `get_insights` reads it in one call.

`record_inputs(p_user_id uuid, p_since timestamptz) returns jsonb` is `language sql stable security invoker` with `search_path = ''`.
It returns `{ timeZone, knownTriggers, onboardedAt, hasLocation, episodes, checkins, doses, medications }`:

| Field | Rows |
| --- | --- |
| `timeZone`, `knownTriggers`, `onboardedAt` | The profile's `timezone`, `known_triggers` (`[]` without a row) and `onboarding_completed_at`. |
| `hasLocation` | `coarse_lat is not null`; the coordinates themselves never leave. |
| `episodes` | `{ id, startedAt, endedAt, intensity, triggers, helped, didNotHelp, debriefedAt }`, oldest first: started at or after `p_since`, or still open. |
| `checkins` | `{ localDate, sleepBand, stress }`, oldest first, from the day before `p_since`'s UTC date, so a zone behind UTC keeps its first day. |
| `doses` | `{ id, medicationId, episodeId, takenAt, helped }`, taken at or after `p_since`. |
| `medications` | `{ id, name, kind, class }`, every one, archived included (their past doses still name them). |

Every list is filtered by `user_id = p_user_id`, and as a security invoker it reads through RLS: a signed-in caller who passes another
user's id gets four empty lists, a null `timeZone` and `onboardedAt`, and `hasLocation` false. The service role reads anyone (the
hourly monitor will). Revoked from `public` and `anon`, granted to `authenticated` and `service_role`. The window
(`INSIGHT_SINCE_DAYS`, 366 days) covers six months of monthly counts and the year-long attack-free stretch.

## Pressure forecast cache

`20261129120100_weather_cache.sql` adds the shared cache of pressure forecasts, the daily prune of the server-only
caches, and the `pg_cron` extension (created in `pg_catalog`; its objects live in the `cron` schema, and its schedules
are in GMT).

| Object | Contract |
| --- | --- |
| `public.weather_cache` | `location_key text` (the one-decimal cell, `'4.6,-74.1'`; a check on `^-?[0-9]{1,2}\.[0-9],-?[0-9]{1,3}\.[0-9]$` refuses anything else with `23514`), `fetched_at timestamptz` default `now()` (the functions write the UTC hour of the fetch, the forecast's first hour), `payload jsonb` (`{ hours, hPa }`, the forecast `_shared/weather.ts` parsed). Primary key `(location_key, fetched_at)`, which the read's filter on the cell uses. No user id: one row serves everyone in the cell. RLS is on with no policy and every privilege is revoked from `anon` and `authenticated`, so only the service role reads or writes it. |
| `prune_expired_caches() returns void` | `security definer`, `search_path = ''`, owned by `postgres`, revoked from `public`, `anon` and `authenticated`. Deletes `weather_cache` rows over 2 days old (the functions read a forecast for 3 hours at most) and the `cron.job_run_details` of the jobs `prune-expired-caches` and `monitor` over 7 days old (pg_cron never deletes its run history). A later migration that adds a cache redefines it with its own delete. |
| Job `prune-expired-caches` | `cron.schedule('prune-expired-caches', '17 3 * * *', 'select public.prune_expired_caches()')`: daily at 03:17 GMT. Scheduling under the same name again replaces the job. |

Edge Functions reach the cache only through `pressureFor` (`supabase/functions/_shared/weather.ts`): it reads the newest
row for the cell no older than the age it is given (`weather_cache?location_key=eq.<cell>&fetched_at=gte.<cutoff>&order=fetched_at.desc&limit=1`),
else fetches the forecast once and inserts it with `Prefer: resolution=ignore-duplicates`. Since `fetched_at` is the UTC
hour, a second write for the cell in the same hour hits the primary key and is ignored, leaving one row. It cannot stop two
runs that miss the cache at the same moment from both calling the provider: overlapping runs can cost one extra call per cell. A forecast that
is empty or ends before 24 hours past the hour in progress is neither returned nor stored, and a cached row that no longer
reaches that far (null tail hours shorten a series) is read as a miss and fetched again.

## Signals

`20261129120200_signals.sql` adds the signals the hourly monitor computes (`computeSignals` in
`supabase/functions/_shared/signals.ts`), one row per cause key.

| Column | Contract |
| --- | --- |
| `id` | `uuid` pk, `gen_random_uuid()`. |
| `user_id` | `uuid not null`, cascade from `auth.users`, so deleting the account deletes its signals. |
| `kind` | `text`, one of `long_attack`, `overuse_limit`, `debrief_due`, `overuse_warn`, `short_sleep`, `pressure`, `quiet_tracker` (`23514` otherwise). |
| `cause` | `text`, 1 to 120 characters: what the 24-hour rule compares (`pressure`, `overuse:triptan`, `debrief:<episode id>`, …). |
| `cause_key` | `text`, 1 to 160 characters: one occurrence of a cause (`pressure:<local date>`, `overuse:<scope>:<level>:<YYYY-MM>`, `long_attack:<episode id>:<stage>`, `quiet:<last check-in date>`, …). `unique (user_id, cause_key)` (`23505` on a second row), so a key is stored, and pushed, at most once. |
| `local_date` | `date not null`: the user's local day it was computed for. |
| `evidence` | `jsonb not null`, an object (`23514` otherwise): the signal's evidence as `signals.ts` types it, in camelCase, which `signalFromRow` reads back. |
| `computed_at` | `timestamptz not null default now()`. |
| `pushed_at` | `timestamptz`, null until the signal is pushed. |

Indexes: the unique `(user_id, cause_key)`, a partial `(user_id, pushed_at) where pushed_at is not null` (the push cap and
the 24-hour cause rule read a user's pushed rows) and `(user_id, local_date)` (Today and `get_signals` read one day). RLS
read-own `select` (`signals_select_own`, `user_id = (select auth.uid())`); every privilege is revoked from `anon` and
`authenticated`, then `select` granted back to `authenticated`, so a client insert, update or delete is `42501`. Only the
service role writes it, through the monitor's RPCs ([the hourly monitor](#the-hourly-monitor)).

## Push tokens

`20261129120300_push_tokens.sql` adds the phone's Expo push token, written only through `register_push_token` with the
phone's device secret, and the server-only reclaim tables `push-claim` uses (pattern: Dressing Room's push migration, without
its per-notice preferences: a row means "this phone gets the signal pushes", and the daily cap is the opt-out).

| Object | Contract |
| --- | --- |
| `public.push_tokens` | `user_id uuid` (default `auth.uid()`, cascade from `auth.users`), `token text` (`^(ExponentPushToken\|ExpoPushToken)\[.+\]$`, at most 255 characters), `platform text` (`ios` or `android`), `updated_at timestamptz` (stamped with `clock_timestamp()` by the `push_tokens_stamp` trigger on insert and on a change of token, platform or secret), `device_secret_hash text` (SHA-256 hex of the phone's own random secret, `^[0-9a-f]{64}$`). Primary key `(user_id, token)`, plus an index on `token` (the server deletes a dead token, takes a token over and claims it by the token alone). RLS: read-own `select` and delete-own `delete`, both on `(select auth.uid())`. `anon` has nothing; `authenticated` has `select` on every column but `device_secret_hash`, and `delete`; a direct insert or update is `42501`. |
| `register_push_token(p_token text, p_platform text, p_device_secret text) returns void` | `security definer`, `search_path = ''`, granted to `authenticated` only. `42501` without a session; `22023` for a bad token, platform, or a secret that is not 32 to 128 hex characters. Under a per-token advisory lock: another account's row for the token under a different secret is `42501` (someone who only knows the token); the same secret (that phone, a new account) deletes the other accounts' rows and takes the token over; the caller's own row may change secret. |
| `public.push_claims` | One reclaim per `(token, user_id)`: `code_hash` and `nonce_hash` (SHA-256 hex), `expires_at` (10 minutes), `attempts` 0–5. RLS on, every privilege revoked from `anon` and `authenticated`. |
| `public.push_claim_starts` | Every claim start that sent a code (`token`, `user_id`, `started_at`), for the limits; indexes on `(user_id, started_at)` and `(token, started_at)`. RLS on, no client privilege. |
| `start_push_claim(p_user_id, p_token, p_code_hash, p_nonce_hash) returns boolean` | Service role only. False for a token nobody holds or the caller's own (not counted), and past the limits: one start per token and account per 10 minutes, 5 per account per hour, 6 distinct accounts per token per hour. Else stores the hashes and answers true. |
| `push_claim_attempt(p_user_id, p_token, p_nonce_hash) returns text` | Service role only. Spends one attempt on the caller's unexpired claim with that nonce and answers the code's hash for a constant-time compare in the function; null when there is nothing to attempt. |
| `finish_push_claim(p_user_id, p_token, p_platform, p_device_secret) returns boolean` | Service role only. `22023` for a bad platform or secret. Under the token's lock: false when the caller's claim is gone or expired; else deletes every claim on the token and every other account's row for it, and stores the claimant's row with the new secret's hash. |
| `prune_expired_caches()` | Redefined with the weather and run-history deletes unchanged, plus expired `push_claims` and `push_claim_starts` older than 1 hour. |

The device secret, the pending unregister list and a pending claim live on the phone in kv (`docs/app.md#push-srcpush`).
`push-unregister` deletes the named account's row by token and the secret's hash with the service role: knowing a
token alone deletes nothing, and the device-wide secret can't reach the next account's row on the same phone. Expo's tickets and receipts, and the hourly sends, are the monitor's ([the hourly monitor](#the-hourly-monitor)).

## The hourly monitor

`20261129120400_monitor.sql` adds what the `monitor` Edge Function needs (the function itself: [`api.md`](api.md#monitor)):
the zone check it relies on before any `AT TIME ZONE`, the receipts queue, its service-role RPCs, the `pg_net`
extension (in `extensions`; its objects live in the `net` schema) and the hourly job.

| Object | Contract |
| --- | --- |
| `private.is_time_zone(p text) returns boolean` | `stable`, `search_path = ''`, no client execute. True for `UTC`, `GMT` and an `Area/Location` name that `pg_timezone_names` lists, except its `posix/` and `right/` copies. Abbreviations and POSIX rules (`EST`, `EST5EDT`, `UTC+3`) are listed or parse in `AT TIME ZONE` but name no place, so they are false. Not a `CHECK`: the list changes with tzdata. |
| Trigger `profiles_check_timezone` | `before insert or update of timezone` on `profiles`, through `profiles_check_timezone()` (`security definer`, since clients have no usage on `private`): a zone that is not null and fails `is_time_zone` raises `22023` `timezone: not an IANA zone name`. The migration first sets every stored zone that fails the check to null, so the phone sends its zone again. The app reads `22023` as `invalid` and does not resend a refused zone until the device zone changes ([`app.md`](app.md#profile-srcprofile)). |
| `public.push_tickets` | `ticket_id text` primary key (1 to 100 characters), `token text`, `user_id uuid` (cascade from `auth.users`), `created_at timestamptz default now()`; indexes on `created_at` (the receipts read) and `user_id` (the cascade). RLS on with no policy and every privilege revoked from `anon` and `authenticated`: only the service role touches it. |
| `monitor_targets()` | Every profile with a zone and `onboarding_completed_at`, ordered by `user_id` (the function pages it with `order=user_id`, `limit` and `offset`), whatever the time: the window only decides whether to push. Columns `user_id, timezone, notify_start, notify_end, notify_daily_cap, lock_screen_detail, language, coarse_lat, coarse_lon, known_triggers`; `known_triggers` lets a run start the forecasts its users need before it reaches them. |
| `save_signals(p_user_id, p_local_date, p_signals jsonb)` | `p_signals` is `computeSignals`' list (`[{ kind, cause, causeKey, evidence }]`; not an array is `22023`). Under the user's advisory lock: upserts on `(user_id, cause_key)` setting `kind`, `cause`, `local_date`, `evidence` and `computed_at = now()` and keeping `pushed_at`, deletes the user's unpushed rows whose key is not in the set, and answers the push log `(cause_key, cause, pushed_at)`: pushed rows from the last 48 hours (the cap and the 24-hour rule), pushed rows whose key is in the set (a key is pushed once ever), and pushed quiet stretches. |
| `claim_signal_push(p_user_id, p_cause_key, p_time_zone, p_cap, p_same_cause_hours)` | Under `pg_advisory_xact_lock(hashtextextended('signals:' \|\| user_id, 0))`, so overlapping or retried runs wait for each other, one update stamps `pushed_at = now()` only when: the zone passes `is_time_zone`, the user holds a token (as its newest holder), the key's row exists unpushed, fewer than `p_cap` rows were pushed since local midnight in `p_time_zone`, no row with the same `cause` was pushed within `p_same_cause_hours`, and, for `quiet:never`, no dated quiet stretch was pushed. Answers `(signal_id, token, language)` per token, the profile's language; no row means send nothing and nothing was stamped. |
| `save_push_tickets(p_user_id, p_tickets jsonb)` | `[{ id, token }]` from Expo's tickets; a ticket already stored is ignored; not an array is `22023`. |
| `push_receipts_due(p_limit default 1000)` | Tickets 15 minutes to 24 hours old (Expo may not have a receipt sooner and keeps none longer), oldest first, at most 1000. |
| `forget_push_tickets(p_ids text[])` | Deletes the tickets whose receipts were read. |
| `request_monitor()` | Shaped like Dressing Room's weekly-summary job: reads `monitor_url` and `monitor_secret` from `vault.decrypted_secrets` and, with both, `net.http_post`s `{}` with the header `x-webhook-secret` and a 30 s timeout; without them it does nothing. A failure is a warning carrying only the SQLSTATE. `security definer`, owned by `postgres`, no client execute. |
| Job `monitor` | `cron.schedule('monitor', '5 * * * *', 'select public.request_monitor()')`: at :05 every hour (GMT), run as `postgres`. |
| `prune_expired_caches()` | Redefined with the earlier deletes unchanged, plus `signals` whose `computed_at` is over 30 days old, except each user's newest pushed quiet stretch, and `push_tickets` over 2 days old. |

Each RPC above is `security definer` with `search_path = ''`, revoked from `public`, `anon` and `authenticated` and
granted to `service_role` only.

**Why the prune keeps one pushed quiet stretch.** A signal that still holds is recomputed every hour, so a row 30 days
stale is a key that cannot come back: its date, month, attack or stage has passed. The quiet tracker is the exception. Its
key is `quiet:<last check-in>`, and once that check-in leaves the 90-day records window the same stretch reads as
`quiet:never`. The monitor drops `quiet:never` when the push log holds a pushed dated quiet stretch (`withoutRepeatedQuiet`),
and `claim_signal_push` checks the same, so the newest such row must outlive the prune. Keeping only the newest bounds it to
one row per user. The cost: a stretch whose dated key was never pushed (a cap of 0 for months) and that follows an older
pushed one is not pushed as `quiet:never` either, which errs on the side of fewer pushes.

## Tests

pgTAP files in `supabase/tests/`, run by `pnpm db:test`. `profiles.test.sql` (37 assertions), `tracking.test.sql` (106), `onboarding_profile.test.sql` (13), `entitlements.test.sql` (29), `quota.test.sql` (20), `companion_data.test.sql` (55), `record_inputs.test.sql` (22), `weather_cache.test.sql` (25), `signals.test.sql` (20), `push_tokens.test.sql` (53) and `monitor.test.sql` (53). `profiles.test.sql` covers
the signup row and its defaults, own-row visibility, the update grants and each refused column,
both RPCs including the repeat and withdrawal cases, the value checks, function privileges for
`anon` and `authenticated`, and the refused insert and delete. `tracking.test.sql` covers RLS and the refused direct writes on the four tables, each RPC's idempotency, patch semantics (including a moved start, a start after the end as `23514`, times ten minutes ahead stored as now, a clamped start stopping at the stored end, and times two days ahead as `22023`), ownership (`P0002`), catalog and range errors, and `anon` privileges. `onboarding_profile.test.sql` covers `complete_onboarding`, the trigger catalog check, the priorities and `track_period`. `entitlements.test.sql` covers own-row reads, the `updated_at` trigger, each refused write, the boundary at exactly now, `service_role`, the grant and purchase time cases (an expired purchase beside a grant and the reverse), the `42501` for another user, and `anon`. `quota.test.sql` covers the 41st `companion` call refused, `dictation` counted apart, another user's own budget, the day rule (a day three days off and a null day count on the UTC day, one day ahead gets its own counter), a zero or null limit, RLS with no policy, and no execute or select for `anon` or `authenticated`. `companion_data.test.sql` covers the relief checks on `helped` and `did_not_help`, `debriefed` stamping once (a repeat keeps an earlier stamp) and `false` clearing it, a non-boolean `debriefed` as `22023`, a replayed debrief, `set_dose_helped` set, repeated, cleared by omitting `p_helped` and refused on another user's dose, `agent_notes` read-own and its refused direct writes, the 200-character, blank and control-character notes, the 21st note, `delete_agent_note` leaving another user's note, the signed-out `42501`s and `anon`. `record_inputs.test.sql` covers the caller's own episodes, check-ins, doses and medications
(archived included), `hasLocation` turning true once an area is saved, another user's id giving empty lists and a null zone, the
`p_since` cut (an ended attack before it dropped, an open one kept, an older dose dropped, the check-in day before kept), no
`coarse_lat` or `coarse_lon` key or value in the output, `anon` refused and `service_role` granted. `weather_cache.test.sql` covers
RLS on with no policy, the primary key, `anon` and `authenticated` refused a select, insert or delete (and `authenticated` an
update) while the service role reads and writes, the key check (`'4.62,-74.1'`, `'4,-74'` and a prefixed key are `23514`; the
widest cells fit), the prune (a forecast 3 days old goes, one 1 day old stays; run history over 7 days old goes for
`prune-expired-caches` and `monitor` but not another job), the one job at `17 3 * * *`, and the function's definer,
`search_path` and refused execute for `public`, `anon` and `authenticated`. `signals.test.sql` covers RLS on with only the
read-own policy, both indexes, user A reading only A's rows (B's not even by its id), refused inserts, updates and deletes
for `authenticated` and refused selects and inserts for `anon`, the service role inserting and stamping a push, a second
`(user_id, cause_key)` as `23505` (the same key for another user is fine), `kind = 'storm'`, an array evidence, an empty
cause and a 161-character key as `23514`, and the cascade from `auth.users`. `push_tokens.test.sql` covers RLS with only the read-own and
delete-own policies, the token index, no preference columns, no client insert or update and no read of `device_secret_hash`,
`anon` refused, `register_push_token` (definer, empty `search_path`, granted to `authenticated` only; both token forms; a bad
token, platform or short secret as `22023`), another account's token under a different secret as `42501` with the holder's row
untouched, the same secret taking the token over, the stored hash, the claim RPCs refused to `anon` and `authenticated` and
granted to the service role, each claim rule (nobody's token, the holder's own, the 10-minute and hourly limits, another claim's
nonce, the 6th attempt, an expired claim, a bad platform, a finish that removes every other claim and row), `prune_expired_caches()`
removing an expired claim and old starts, and the cascade from `auth.users`. `monitor.test.sql` covers the zone trigger as
the signed-in owner writes it (`EST`, `UTC+3`, `Mars/Base` and a `posix/` name are `22023`; `America/Santiago`, `UTC` and null
are saved), `monitor_targets` leaving out a user with no zone and one not onboarded while keeping one outside an empty window,
`save_signals` keeping `pushed_at` on an upsert, deleting an unpushed row missing from the new set, keeping a pushed one and
answering the push log (the push an hour ago, and one 3 days ago only while its key is in the set), `claim_signal_push`
answering the token and the language once and nothing the second time, nothing for a key already pushed or with no row,
the cap (a push at 08:00 local today blocks a cap of 1, one at 23:30 local yesterday does not), the same cause pushed 22 hours
ago blocking 24 hours but not 20, `quiet:never` after a pushed dated stretch, a user with no token (no row, `pushed_at` still
null) and a zone that is not an IANA name, the tickets (stored once, `22023` for a non-array, receipts due for a ticket 20
minutes old but not 5 minutes or 25 hours, forgotten once checked), `push_tickets`' RLS with no policy and its index, every
monitor function refused to `anon` and `authenticated`, granted to the service role and a definer with an empty
`search_path`, `request_monitor()` owned by `postgres`, without the Vault secrets doing nothing and with them posting once with the header and the
30 s timeout, the job at `5 * * * *`, and the prune (signals 30 days stale go, pushed or not, but the newest pushed quiet
stretch stays; tickets over 2 days old go).

## New table checklist

Supabase's default privileges grant `anon`, `authenticated` and `service_role` every privilege on
each new table in `public`, and `execute` on each new function, so a new table starts open to the
API until these close it:

- `alter table … enable row level security`.
- Policies `to authenticated` that compare against `(select auth.uid())`, not a bare `auth.uid()`. An `update` policy has both `using` and `with check`.
- No policy the app does not need: a missing policy is a denial.
- `revoke all on <table> from anon, authenticated`, then grant back the exact privileges and columns the client needs.
- `revoke execute on function <fn> from public, anon, authenticated` for every new function, including trigger functions; grant `execute` back only to the role that calls it.
- `security definer` functions set `search_path = ''` and qualify every name.
- An index on the column that per-user queries filter by, unless it is already the primary key or leads another index.
- A pgTAP test for the policies, grants and constraints, including that user A cannot read or change user B's rows.
- `pnpm db:types`, and commit the generated types (CI fails on drift).
