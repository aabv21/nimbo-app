# Nimbo

**Demo** · status: foundation (sign-in, consent and the app shell)

A migraine companion for iPhone and Android: log attacks, spot your patterns and get calm guidance, in English, Spanish or Portuguese. Built with Expo and Supabase as a portfolio demo.

Nimbo is not a medical device. It does not diagnose, prescribe or replace a clinician; it helps you keep a record to share with one.

## What works now

- Sign-up with an email code, sign-in with email, and Apple and Google sign-in (their live provider checks are pending).
- Two consent gates before the app: the adult and medical-boundary confirmation, then the AI question. Declining AI keeps the app complete and hides the Companion tab.
- Four tabs (Today, Companion, History, Profile) as a shell, with a Liquid Glass tab bar; Profile sets language, appearance and reduce motion.
- English, Spanish and Portuguese, and three appearances (Day, Dark, Dim) plus Automatic.
- It opens offline from the stored session and the cached profile.
- A local Supabase stack with the profiles table, row-level security and the consent functions, tested with pgTAP.

Logging attacks, insights and the AI companion are planned. How it works: [`docs/architecture.md`](docs/architecture.md).

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
| `pnpm check:supply-chain` | Fail if `pnpm-workspace.yaml` loses its supply-chain settings |

## Documentation

- [`docs/architecture.md`](docs/architecture.md): where it runs, the gate flow, consent, security and the design decisions, with diagrams.
- [`docs/app.md`](docs/app.md): the modules under `src/`. [`docs/database.md`](docs/database.md): the schema. [`docs/local-stack.md`](docs/local-stack.md): the local stack.
- [`docs/testing.md`](docs/testing.md): the test suites. [`docs/native-config.md`](docs/native-config.md): native config. [`docs/owner-runbook.md`](docs/owner-runbook.md): the owner's steps.

See [`AGENTS.md`](AGENTS.md) for the guardrails and [`CONTRIBUTING.md`](CONTRIBUTING.md) for the pull request flow.

## License

[MIT](LICENSE)
