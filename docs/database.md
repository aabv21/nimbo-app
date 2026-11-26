# Database

The backend is Supabase (Postgres 17), run locally through the `db:*` scripts ([`local-stack.md`](local-stack.md)).
This document covers what the migrations create: `public.profiles`, its policies and grants, the
signup trigger, and the consent RPCs. Schema changes are new migration files in
`supabase/migrations/`; a merged migration is never edited.

## `public.profiles`

One row per `auth.users` row (`user_id` is the primary key, with `on delete cascade`), created by
the signup trigger. A client never inserts a row, so every client write is an update.

| Column | Type | Notes |
| --- | --- | --- |
| `user_id` | `uuid` | primary key, references `auth.users (id)` |
| `condition` | `text` | `not null default 'migraine'`; check allows only `migraine`; not client-writable |
| `language` | `app_language` | nullable (`en`, `es`, `pt`); null follows the device |
| `timezone` | `text` | nullable; 1 to 64 characters |
| `theme` | `app_theme` | `not null default 'day'` (`day`, `dim`) |
| `reduce_motion` | `boolean` | `not null default false` |
| `notify_start`, `notify_end` | `time` | `not null`, default `08:00` and `21:00` |
| `notify_daily_cap` | `smallint` | `not null default 2`; check 0 to 2 |
| `lock_screen_detail` | `boolean` | `not null default false` |
| `coarse_lat`, `coarse_lon` | `numeric(4,1)` | nullable; checks -90 to 90 and -180 to 180; one decimal, so a stored location is coarse by construction |
| `known_triggers` | `text[]` | `not null default '{}'` |
| `priority` | `text` | nullable; one of `triggers`, `doctor`, `medication`, `patterns` |
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
`coarse_lat`, `coarse_lon`, `known_triggers`, `priority`. Updating any other column (every consent
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
| `keep_alive() returns timestamptz` | `security invoker`, reads no table, answers the server time. The only function `anon` may execute; it lets a scheduled call keep a free hosted project from pausing. |

Both consent functions raise `42501` when there is no signed-in user. The client never writes a
consent timestamp, so a timestamp cannot be forged or back-dated.

## Tests

pgTAP files in `supabase/tests/`, run by `pnpm db:test`. `profiles.test.sql` (37 assertions) covers
the signup row and its defaults, own-row visibility, the update grants and each refused column,
both RPCs including the repeat and withdrawal cases, the value checks, function privileges for
`anon` and `authenticated`, and the refused insert and delete.

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
