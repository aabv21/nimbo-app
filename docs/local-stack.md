# The local stack

The backend runs locally as Supabase in Docker, driven only through the `supabase` devDependency
(the `db:*` scripts), never a global or Homebrew install. Docker must be running before
`pnpm db:start`. Nothing is deployed to a hosted project.

## Commands

- `pnpm db:start`: starts the stack (`supabase start`). The first run pulls images and can take minutes.
- `pnpm db:start:ci`: the lean stack CI starts, without Studio, Realtime, the vector service, logflare and the image proxy.
- `pnpm db:reset`: recreates the database from `supabase/migrations/` and `supabase/seed.sql`.
- `pnpm db:test`: the pgTAP suite under `supabase/tests/` ([`database.md`](database.md#tests)).
- `pnpm db:types`: regenerates `src/lib/database.types.ts`; commit it with the migration that changed it. CI fails when it differs from the migrations.
- `pnpm env:local`: writes `.env.local` (gitignored) from `supabase status -o env`: the app's `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL` for scripts only. It writes only those four keys, in that order, and keeps every other line, so a hand-set Google client id survives.
- `pnpm db:stop`: stops the stack. Leave it stopped when you are done.

## Ports

`supabase/config.toml` uses `project_id = "nimbo-app"` and every port sits in the 54520–54529
range, clear of the Supabase CLI defaults (54320–54329), so it can run beside another local stack:

| Service | Port | Address |
| --- | --- | --- |
| API gateway (REST, Auth, Storage, functions) | 54521 | `http://127.0.0.1:54521` |
| Postgres | 54522 | `127.0.0.1:54522` (user and password `postgres`) |
| Shadow database (migration diffs) | 54520 | internal |
| Studio | 54523 | `http://127.0.0.1:54523` |
| Mailpit (local email) | 54524 | `http://127.0.0.1:54524` |
| Analytics | 54527 | internal |
| Connection pooler (disabled) | 54529 | reserved |
| Edge Runtime inspector | 8283 | internal |

Ports 54520 to 54529 form one block; CI reserves it so an outgoing connection cannot take a port
the stack needs.

## Auth and email

- Email confirmation is on (`enable_confirmations = true`) with a 6-digit code (`otp_length = 6`). The code emails are `supabase/templates/confirmation.html` (sign-up) and `supabase/templates/recovery.html` (password reset); both print `{{ .Token }}` instead of a link.
- Mailpit catches local email instead of sending it; read the code there. The integration suite and the Maestro sign-up flow read it through Mailpit's API (`/api/v1/messages`).
- `site_url` is the app scheme, `nimbo://`.
- `[auth.rate_limit].email_sent` is raised to 100 locally so sign-up and resend tests never hit the hourly cap (confirmation emails count against it); the hosted project keeps its own limit in its Auth settings.

## What is not here

No mock servers and no Edge Function secrets yet: `supabase/functions/` holds only shared code, the
condition pack and the premium check. `supabase/seed.sql` seeds nothing, because profiles are created by the signup
trigger and the app has no reference data in the database.
