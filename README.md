# Nimbo

**Demo** · status: foundation

A migraine companion for iPhone and Android: log attacks, spot your patterns and get calm guidance, in English, Spanish or Portuguese. Built with Expo and Supabase as a portfolio demo.

Nimbo is not a medical device. It does not diagnose, prescribe or replace a clinician; it helps you keep a record to share with one.

## What works now

- Expo Router app (SDK 58) with strict TypeScript, lint and a smoke test.
- A root route that shows the app name. Everything else is planned.

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
| `pnpm test` | The Jest `app` project |
| `pnpm check:expo` | Compare packages with the SDK's expected versions (informational) |
| `pnpm check:supply-chain` | Fail if `pnpm-workspace.yaml` loses its supply-chain settings |

See [`AGENTS.md`](AGENTS.md) for the guardrails and [`CONTRIBUTING.md`](CONTRIBUTING.md) for the pull request flow.

## License

[MIT](LICENSE)
