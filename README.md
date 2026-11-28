# Nimbo

**Demo** · status: companion (the tracking core plus an AI companion that answers from your own records)

A migraine companion for iPhone and Android: log attacks, spot your patterns and get calm guidance, in English, Spanish or Portuguese. Built with Expo and Supabase as a portfolio demo.

Nimbo is not a medical device. It does not diagnose, prescribe or replace a clinician; it helps you keep a record to share with one.

## What works now

- Sign-up with an email code, sign-in with email, and Apple and Google sign-in (their live provider checks are pending).
- Two consent gates before the app: the adult and medical-boundary confirmation, then the AI question. Declining AI keeps the app complete and hides the Companion tab.
- A short intro, then five optional setup steps: known triggers, what matters most, medications, notifications and a rough area for weather.
- Today: the status line, the daily check-in in two taps, the month's medication days and Start an attack, ordered by what the user said matters most.
- Crisis mode: a dim, calm screen with 56 pt controls for intensity, symptoms, where it hurts and doses, with the countdown to the next dose. Every time stays editable, the start included.
- A medicine cabinet with a medication-overuse guard on the ICHD-3 limits, and private local reminders for preventive medications.
- History as a calendar, a searchable, filtered list and Patterns: counts from your own records (attacks per month, days without an attack, triggers, time of day, weekday, what helped and sleep the night before), never a percentage, and what is still needed below each minimum. The companion reads the same counts.
- Red flags: what the user writes is checked on the phone in all three languages, offline and with the AI off, and an attack open for 72 hours is flagged too; urgent care offers the official emergency number of the phone's region.
- Everything is logged offline first and synced when the network returns, exactly once.
- The companion: a chat that answers from your own records and shows where each number comes from, turns what you say into drafts you confirm, keeps short notes on how you like things ("What I know about you"), and asks a day-after debrief that builds your crisis plan. Every message and reply is screened for warning signs, dose advice, diagnosis and invented numbers; it never prescribes. The chat stays on the phone.
- Dictation: hold the mic in the Companion tab, or "Tell me" in crisis mode, with short replies you can have read aloud.
- Premium access the owner can grant; no feature is gated yet.
- Four tabs (Today, Companion, History, Profile) with a Liquid Glass tab bar; English, Spanish and Portuguese; three appearances (Day, Dark, Dim) plus Automatic.
- A local Supabase stack with row-level security on every table and RPC-only health writes, tested with pgTAP and integration suites, and Maestro flows for onboarding, crisis mode, a red flag and a companion draft.

Signals and push notifications are planned. How it works: [`docs/architecture.md`](docs/architecture.md).

## Quick start

Requirements: Node 24 or newer and pnpm 11 (see `packageManager` in `package.json`).

```bash
pnpm install
pnpm start
```

## Commands

| Command | What it does |
|---|---|
| `pnpm start` | The Expo dev server |
| `pnpm ios` / `pnpm android` | Build the app with `expo run:*` and open it |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` | `eslint .` |
| `pnpm test` | The Jest `app`, `scripts` and `functions` projects |
| `pnpm test:int` | The Jest `integration` project, against the running local stack (see `docs/testing.md`) |
| `pnpm check:expo` | Compare packages with the SDK's expected versions (informational) |
| `pnpm db:start` / `pnpm db:stop` | Start and stop the local Supabase stack (see `docs/local-stack.md`) |
| `pnpm db:reset` / `pnpm db:test` / `pnpm db:types` | Rebuild the database, run the pgTAP tests, regenerate the DB types |
| `pnpm e2e` | The Maestro flows on the Android emulator, against the local stack (see `docs/testing.md`) |
| `pnpm env:local` | Write `.env.local` from the running local stack |
| `pnpm catalog:sql` | Print `catalog_keys()` from the condition pack, for a new migration when a catalog changes |
| `pnpm premium grant\|revoke <email>` | The owner's premium switch (see `docs/owner-runbook.md`) |
| `pnpm calibrate eval` | The owner's guard calibration against the real AI services (see `docs/ai.md`) |
| `pnpm check:supply-chain` | Fail if `pnpm-workspace.yaml` loses its supply-chain settings |

## Documentation

- [`docs/architecture.md`](docs/architecture.md): where it runs, the gate flow, consent, offline logging and sync, crisis mode, red flags, the overuse guard, reminders, premium, security and the design decisions, with diagrams.
- [`docs/ai.md`](docs/ai.md): the companion's models, prompts, guards and costs. [`docs/red-team.md`](docs/red-team.md): the attacks the guards cover. [`docs/api.md`](docs/api.md): the `companion` function's request and statuses.
- [`docs/app.md`](docs/app.md): the modules under `src/`. [`docs/database.md`](docs/database.md): the schema. [`docs/local-stack.md`](docs/local-stack.md): the local stack.
- [`docs/testing.md`](docs/testing.md): the test suites. [`docs/native-config.md`](docs/native-config.md): native config. [`docs/owner-runbook.md`](docs/owner-runbook.md): the owner's steps.

See [`AGENTS.md`](AGENTS.md) for the guardrails and [`CONTRIBUTING.md`](CONTRIBUTING.md) for the pull request flow.

## License

[MIT](LICENSE)
