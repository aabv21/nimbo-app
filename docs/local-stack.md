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
- `pnpm env:local`: writes `.env.local` (gitignored) from `supabase status -o env`: the app's `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL` for scripts only, then `TYPESAFE_BASE_URL` and `ANTHROPIC_BASE_URL` as the host reaches the [mocks](#mocks). It writes only those six keys, in that order, and keeps every other line, so a hand-set Google client id or API key survives. It never writes an API key.
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
| Mock Jev (`integration/mockServices.ts`) | 54518 | `http://127.0.0.1:54518`, `http://host.docker.internal:54518` from the functions |
| Mock Claude (`integration/mockAnthropic.ts`) | 54519 | `http://127.0.0.1:54519`, `http://host.docker.internal:54519` from the functions |

Ports 54520 to 54529 form one block; CI reserves it so an outgoing connection cannot take a port
the stack needs. The mocks sit just below it, clear of Dressing Room's (54498 and 54499).

## Auth and email

- Email confirmation is on (`enable_confirmations = true`) with a 6-digit code (`otp_length = 6`). The code emails are `supabase/templates/confirmation.html` (sign-up) and `supabase/templates/recovery.html` (password reset); both print `{{ .Token }}` instead of a link.
- Mailpit catches local email instead of sending it; read the code there. The integration suite and the Maestro sign-up flow read it through Mailpit's API (`/api/v1/messages`).
- `site_url` is the app scheme, `nimbo://`.
- `[auth.rate_limit].email_sent` is raised to 100 locally so sign-up and resend tests never hit the hourly cap (confirmation emails count against it); the hosted project keeps its own limit in its Auth settings.

## Mocks

Locally the Edge Functions never reach TypeSafe or Anthropic. `[edge_runtime.secrets]` in
`supabase/config.toml` gives them dummy keys (`local-only-not-a-key`) and points the base URLs at two
mock servers on the host, which the Edge Runtime reaches from its container as `host.docker.internal`:

| Secret | Local value | Hosted default |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | `local-only-not-a-key` | set by the owner |
| `TYPESAFE_BASE_URL` | `http://host.docker.internal:54518` | `https://api.typesafe.ai` |
| `ANTHROPIC_API_KEY` | `local-only-not-a-key` | set by the owner |
| `ANTHROPIC_BASE_URL` | `http://host.docker.internal:54519` | `https://api.anthropic.com` |

The integration tests start the mock they need and close it ([`testing.md`](testing.md#mocks)). For a
manual check, `node integration/mockServices.ts --serve` keeps the mock Jev answering "nothing flagged"
(every Noul 0.02, every Choice `other`) until Ctrl-C, and `node integration/mockAnthropic.ts --serve companion-checkin`
keeps the mock Claude answering every message with a check-in draft, the scenario the Maestro companion flow uses
([`testing.md`](testing.md#end-to-end-flows-maestro)). The mocks listen on every interface, since the
Edge Runtime calls from a container.

With no mock running, a call to either model fails fast with a refused connection, and the functions
treat it like a provider outage: the guards fall back from Jev to Claude Haiku, then to their offline
rules, and mark the result degraded; a request that needs Claude itself answers 503. Nothing is retried
against the real APIs.

## What is not here

`supabase/seed.sql` seeds nothing, because profiles are created by the signup trigger and the app has
no reference data in the database.
