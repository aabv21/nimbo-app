# Database

The backend is Supabase (Postgres 17), run locally through the `db:*` scripts ([`local-stack.md`](local-stack.md)).
This document covers what the migrations create: `public.profiles`, its policies and grants, the
signup trigger, the consent RPCs, and the tracking tables with their RPCs. Schema changes are new migration files in
`supabase/migrations/`; a merged migration is never edited. The diagram [`diagrams/data-model.svg`](diagrams/data-model.svg) shows how the pieces relate, and [`architecture.md`](architecture.md#the-consent-model) explains why consent is RPC-only.

## `public.profiles`

One row per `auth.users` row (`user_id` is the primary key, with `on delete cascade`), created by
the signup trigger. A client never inserts a row, so every client write is an update.

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | `uuid` | primary key, references `auth.users (id)` |
| `condition` | `text` | `not null default 'migraine'`; check allows only `migraine`; not client-writable |
| `language` | `app_language` | nullable (`en`, `es`, `pt`); null follows the device |
| `timezone` | `text` | nullable; 1 to 64 characters |
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
`doses (medication_id)`, `medications (user_id)`. The debrief columns arrive with the debrief itself.

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

## Tests

pgTAP files in `supabase/tests/`, run by `pnpm db:test`. `profiles.test.sql` (37 assertions), `tracking.test.sql` (106), `onboarding_profile.test.sql` (13) and `entitlements.test.sql` (29). `profiles.test.sql` covers
the signup row and its defaults, own-row visibility, the update grants and each refused column,
both RPCs including the repeat and withdrawal cases, the value checks, function privileges for
`anon` and `authenticated`, and the refused insert and delete. `tracking.test.sql` covers RLS and the refused direct writes on the four tables, each RPC's idempotency, patch semantics (including a moved start, a start after the end as `23514`, times ten minutes ahead stored as now, a clamped start stopping at the stored end, and times two days ahead as `22023`), ownership (`P0002`), catalog and range errors, and `anon` privileges. `onboarding_profile.test.sql` covers `complete_onboarding`, the trigger catalog check, the priorities and `track_period`. `entitlements.test.sql` covers own-row reads, the `updated_at` trigger, each refused write, the boundary at exactly now, `service_role`, the grant and purchase time cases (an expired purchase beside a grant and the reverse), the `42501` for another user, and `anon`.

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
