# The local stack

The backend runs locally as Supabase in Docker, driven only through the `supabase` devDependency
(the `db:*` scripts), never a global or Homebrew install. Docker must be running before
`pnpm db:start`. Nothing is deployed to a hosted project.

## Commands

- `pnpm db:start`: starts the stack (`supabase start`). The first run pulls images and can take minutes.
- `pnpm db:start:ci`: the lean stack CI starts, without Studio, Realtime, the vector service, logflare and the image proxy.
- `pnpm db:reset`: recreates the database from `supabase/migrations/` and `supabase/seed.sql`.
- `pnpm db:test`: the pgTAP suite under `supabase/tests/` ([`database.md`](database.md#tests)).
- `pnpm db:lint`: `supabase db lint` over the local database (plpgsql_check), failing on any warning ([`database.md`](database.md#database-audit)).
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
| Mock Jev and Open-Meteo (`integration/mockServices.ts`) | 54518 | `http://127.0.0.1:54518`, `http://host.docker.internal:54518` from the functions |
| Mock Claude (`integration/mockAnthropic.ts`) | 54519 | `http://127.0.0.1:54519`, `http://host.docker.internal:54519` from the functions |

Ports 54520 to 54529 form one block; CI reserves it so an outgoing connection cannot take a port
the stack needs. The mocks sit just below it, clear of Dressing Room's (54498 and 54499).

## Auth and email

- Email confirmation is on (`enable_confirmations = true`) with a 6-digit code (`otp_length = 6`). The code emails are `supabase/templates/confirmation.html` (sign-up) and `supabase/templates/recovery.html` (password reset); both print `{{ .Token }}` instead of a link.
- Both emails and their subjects come in English, Spanish or Portuguese. `signUpWithEmail` stores the app's language as `user_metadata.locale`, and the templates and the `subject` lines in `config.toml` branch on `.Data.locale` (`{{ if eq .Data.locale "es" }}…{{ else if eq .Data.locale "pt" }}…{{ else }}…{{ end }}`); every branch prints `{{ .Token }}`. An account without a locale (Google or Apple sign-in, or one made before this) gets English, and a password reset uses the language of the sign-up, not the app's current one. The hosted project needs the same templates and subjects pasted into its Auth settings ([`owner-runbook.md`](owner-runbook.md)).
- Mailpit catches local email instead of sending it; read the code there. The integration suite (`latestEmail`, `latestEmailCode`) and the Maestro sign-up flow read it through Mailpit's API (`/api/v1/messages`).
- `site_url` is the app scheme, `nimbo://`.
- `[auth.email].secure_password_change` is on: a session created more than 24 hours ago needs a nonce to change the password, while the recovery flow's fresh session does not; `minimum_password_length` is 8 with no character requirements. The hosted project's Auth settings must match ([`audits/security.md`](audits/security.md) SEC-16, SEC-17).
- `[auth.rate_limit].email_sent` is raised to 100 locally so sign-up and resend tests never hit the hourly cap (confirmation emails count against it); the hosted project keeps its own limit in its Auth settings.

## Mocks

Locally the Edge Functions never reach TypeSafe, Anthropic, Open-Meteo or Expo's push service. `[edge_runtime.secrets]` in
`supabase/config.toml` gives them dummy keys (`local-only-not-a-key`) and points the base URLs at two
mock servers on the host, which the Edge Runtime reaches from its container as `host.docker.internal`:

| Secret | Local value | Hosted default |
| --- | --- | --- |
| `TYPESAFE_API_KEY` | `local-only-not-a-key` | set by the owner |
| `TYPESAFE_BASE_URL` | `http://host.docker.internal:54518` | `https://api.typesafe.ai` |
| `ANTHROPIC_API_KEY` | `local-only-not-a-key` | set by the owner |
| `ANTHROPIC_BASE_URL` | `http://host.docker.internal:54519` | `https://api.anthropic.com` |
| `OPEN_METEO_URL` | `http://host.docker.internal:54518` | `https://api.open-meteo.com` |
| `OPEN_METEO_API_KEY` | unset | empty: the free API takes no key ([`owner-runbook.md`](owner-runbook.md)) |
| `EXPO_PUSH_URL` | `http://host.docker.internal:54518/--/api/v2/push` | `https://exp.host/--/api/v2/push` (`/send` and `/getReceipts` are appended) |
| `EXPO_ACCESS_TOKEN` | unset | empty unless the Expo project turns on push security |
| `MONITOR_SECRET` | `local-only-not-a-secret-local-only-not-a-secret` | set by the owner (`openssl rand -hex 32`; under 32 characters `monitor` refuses every call), equal to the Vault secret `monitor_secret` |

The stack reads these secrets, and the `[auth]` settings, only when it starts, and `supabase/seed.sql` writes the Vault
secret only on a reset. After a change to either (the longer `MONITOR_SECRET`, or `secure_password_change`), a running
stack needs `pnpm db:stop && pnpm db:start && pnpm db:reset && pnpm env:local`.

These values must never reach the hosted project: `supabase secrets set` run from this repo also pushes every
`[edge_runtime.secrets]` value, so hosted secrets are set from an empty directory
([`owner-session.md`](owner-session.md#3-after-the-merges-the-supabase-project)).

The mock on 54518 serves four routes. `POST /v1/systemone` is Jev. `GET /v1/forecast` is Open-Meteo's forecast:
by default every hour reads 1013.0 hPa, from the current UTC hour, for as many hours as `forecast_hours` asks
(28 when it is missing), in Open-Meteo's `timezone=GMT` shape. Like the real API it answers 400 with
`{ error: true, reason }` for a missing or out-of-range `latitude` or `longitude`, an `hourly` variable it does not
serve (only `pressure_msl`), `forecast_hours` over 384 or an unknown `timezone`. `POST /--/api/v2/push/send` is Expo's send: by default every message
gets an `ok` ticket with a fresh id, and `pushRequests()` returns each request's messages (`respondPush` changes the
answer, for a `DeviceNotRegistered` ticket or a 500). `POST /--/api/v2/push/getReceipts` answers `ok` for every id it is
asked about (`respondReceipts` changes it; `receiptRequests()` returns the ids).

`push-claim` keeps the gateway's JWT check (`[functions.push-claim] verify_jwt = true`); `push-unregister` turns it off
(`verify_jwt = false`), since a phone that signed out has no session and proves itself with its device secret.

The integration tests start the mock they need and close it ([`testing.md`](testing.md#mocks)). For a
manual check, `node integration/mockServices.ts --serve` keeps the mock Jev answering "nothing flagged"
(every Noul 0.02, every Choice `other`), the forecast flat at 1013.0 hPa and every push `ok` until Ctrl-C, and `node integration/mockAnthropic.ts --serve companion-checkin`
keeps the mock Claude answering every message with a check-in draft, the scenario the Maestro companion flow uses
([`testing.md`](testing.md#end-to-end-flows-maestro)). The mocks listen on every interface, since the
Edge Runtime calls from a container.

With no mock running, a call to either model, the forecast or the push service fails fast with a refused connection, and the
functions treat it like a provider outage: the guards fall back from Jev to Claude Haiku, then to their offline
rules, and mark the result degraded; a request that needs Claude itself answers 503; the forecast reads as
missing; a push counts as failed. Nothing is retried against the real APIs.

## The hourly monitor

The pg_cron job `monitor` runs `public.request_monitor()` at :05 every hour, which posts to the `monitor` function through
pg_net with two Vault secrets. `supabase/seed.sql` creates them on every `pnpm db:reset`:

| Vault secret | Local value |
| --- | --- |
| `monitor_secret` | `local-only-not-a-secret-local-only-not-a-secret`, the same as `MONITOR_SECRET` above |
| `monitor_url` | `http://supabase_kong_nimbo-app:8000/functions/v1/monitor`: Kong's container name on the stack's Docker network, since pg_net runs inside the database container, where `127.0.0.1` is the container itself |

`[functions.monitor] verify_jwt = false`: the job has no user, so the function checks the shared secret instead
([`api.md`](api.md#monitor)). The local job runs too, every hour the stack is up, against the mocks when they are running.
To trigger a run by hand, with the mock on 54518 serving the forecast and Expo (`node integration/mockServices.ts --serve`):

```sh
curl -s -X POST http://127.0.0.1:54521/functions/v1/monitor -H 'x-webhook-secret: local-only-not-a-secret-local-only-not-a-secret'
# or the job's own path, through pg_net and the Vault:
docker exec supabase_db_nimbo-app psql -U postgres -c 'select public.request_monitor()'
docker exec supabase_db_nimbo-app psql -U postgres -c 'select status_code, content from net._http_response order by id desc limit 1'
```

The Edge Runtime reads `[edge_runtime.secrets]` and the function list when the stack starts: after adding a function or a
secret, run `pnpm db:stop && pnpm db:start`.

## What is not here

`supabase/seed.sql` seeds only the monitor's two local Vault secrets: profiles are created by the signup trigger and the
app has no reference data in the database.
