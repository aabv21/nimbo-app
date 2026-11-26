# AGENTS.md

Guidance for anyone, human or AI, working in this repository.

## Project

Nimbo is a migraine companion for iPhone and Android, built as a portfolio demo with Expo (SDK 58) and Supabase. Locales are `en` (source), `es` and `pt`; themes are `day`, `dark` and `dim` (the profile stores `system`, `day`, `dark` or `dim`; crisis mode forces `dim`); tabs are `today`, `companion`, `history` and `profile`.
It is not a medical device: it never diagnoses or prescribes. Status: foundation, only the Expo scaffold exists. What it does: [`README.md`](README.md).

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch `https://docs.expo.dev/llms.txt` — an index of all Expo docs with corrections to common LLM misconceptions (append `.md` to a doc page's path to fetch it as Markdown).
   Follow its links to the specific page you need; never answer from memory.

Docs for agents: `https://docs.expo.dev/llms.txt`

## Commands

- `pnpm install`: install dependencies. `pnpm expo install <package>`: add a package with native code (SDK-compatible version); `pnpm add` only for pure-JS tooling.
- `pnpm start`: the dev server. `pnpm ios` / `pnpm android`: build the app with `expo run:*` and open it.
- `pnpm typecheck` (`tsc --noEmit`), `pnpm lint` (`eslint .`), `pnpm test` (the `app`, `scripts` and `functions` Jest projects): the gate.
- `pnpm test:int`: the `integration` Jest project (auth and the profile against the running local stack; start it with `pnpm db:start && pnpm env:local`, stop it after). Not part of the gate ([`docs/testing.md`](docs/testing.md)).
- `pnpm check:supply-chain`, `pnpm check:expo`: supply-chain checks ([`CONTRIBUTING.md`](CONTRIBUTING.md#supply-chain-hardening)).
- `pnpm db:start`, `pnpm db:stop`: the local Supabase stack (Docker must be running); `pnpm db:reset` rebuilds it from the migrations, `pnpm db:test` runs the pgTAP suite, `pnpm db:types` regenerates `src/lib/database.types.ts`, `pnpm env:local` writes `.env.local` ([`docs/local-stack.md`](docs/local-stack.md)).

## Where things live

- `src/app/`: Expo Router routes only. `src/__tests__/`: tests that span routes.
- `src/ui/`: the theme tokens, motion tokens and base components (`Screen`, `Button`, `TextField`, `Notice`, `TabBar`, `ChoiceGroup`, `SwitchRow`) and `usePressFeedback`; components read colours only from `useTheme()` and durations only from `useMotion()`.
- `src/auth/`, `src/profile/`: sign-in, the session and the cached profile. `src/lib/`: the Supabase client, kv store and request helpers. `src/test/`: shared test mocks. `integration/`: tests against the local stack.
- `scripts/`: repo tooling in TypeScript, run with Node's type stripping.
- `supabase/`: `config.toml`, `migrations/`, pgTAP `tests/`, the auth email `templates/` and the Edge Function code (`functions/`).
- `assets/images/`: the provisional icon and splash images.
- `.github/`: the pull request and issue templates.

## Guardrails

- Never create or edit `ios/` or `android/`: they are generated and gitignored. Configure native behavior in `app.json` and config plugins.
- Add a native dependency with `pnpm expo install`, then rebuild with `pnpm expo run:ios` / `pnpm expo run:android`. Prefer Expo modules over third-party libraries.
- pnpm only (never npm, yarn or bun), and never weaken `pnpm-workspace.yaml`'s supply-chain settings ([`CONTRIBUTING.md`](CONTRIBUTING.md#supply-chain-hardening)).
- Change `pnpm-lock.yaml` only through a local `pnpm install` or `pnpm update`, never by hand.
- `EXPO_PUBLIC_*` is inlined into the bundle, so no secrets: only the Supabase URL, the anon key and the Google OAuth client ids. The service-role key never goes in `src/`.
- A schema change is a new migration (never edit a merged one), then `pnpm db:types` and a pgTAP test. Follow the new-table checklist in [`docs/database.md`](docs/database.md#new-table-checklist): RLS, column grants, and `security definer` functions with `search_path = ''`.
- Consent columns change only through `accept_terms` and `set_ai_consent`; a client never writes them.
- `app.json` never gains `ios.buildNumber` or `android.versionCode`.
- No health text in logs.

## Conventions

- Everything in English, except the product translations `src/i18n/es.ts` and `src/i18n/pt.ts` and later Spanish and Portuguese product files.
- `pnpm` pinned to an exact 11.x in `packageManager`; Node `>=24`.
- TypeScript strict plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, with `noEmit`: no build step, no `.js`/`.mjs` sources.
- Lint: typescript-eslint `strictTypeChecked`, `eslint-plugin-security` and `eslint-plugin-react-hooks` (not `eslint-config-expo`; see [`CONTRIBUTING.md`](CONTRIBUTING.md#supply-chain-hardening)).
- Navigation is Expo Router: routes in `src/app/`, `Link`, `router` and `useLocalSearchParams` from `expo-router`.
- App identity: display name "Nimbo", slug `nimbo-app`, scheme `nimbo`, bundle id and package `com.aabv21.nimbo`.
- Appearance follows the profile's choice; Automatic (the default) follows the system (`userInterfaceStyle: "automatic"`) between Day and Dark. Controls are 48 pt tall minimum with 44 pt hit targets; no `#ffffff` in a theme; no decorative looping animation.
- Comments:
  1. Say why, not what.
  2. One home per fact: flows and decisions live in `docs/`, and code links to them in one line.
  3. File headers at most 2 lines, JSDoc at most 5.
  4. Cite only what is in the repo: no plan, spec or mockup ids.
  5. A `NOTE:` is one line naming its ceiling, upgrade path and trigger.
  6. Lint suppressions go in `eslint.config.ts` path overrides, not inline.

## What to run for what change

| Change | Run |
|---|---|
| Any change | `pnpm typecheck && pnpm lint && pnpm test` |
| A dependency | the gate, plus `pnpm check:supply-chain` |
| A migration or `supabase/config.toml` | the gate, plus `pnpm db:reset && pnpm db:test && pnpm db:types` |
| Auth, the Supabase client or a repository | the gate, plus `pnpm test:int` |
| A native config or plugin | `pnpm expo prebuild --clean` to check it, then a rebuild |

## Docs to update with each kind of change

| Change | Update |
|---|---|
| What the app does or its status | [`README.md`](README.md) |
| A command or guardrail | this file |
| A test suite, a mock or what CI runs | [`docs/testing.md`](docs/testing.md) |
| The schema, a policy, a grant or an RPC | [`docs/database.md`](docs/database.md) |
| A port, a stack command or auth email config | [`docs/local-stack.md`](docs/local-stack.md) |
| The pull request flow or supply-chain settings | [`CONTRIBUTING.md`](CONTRIBUTING.md) |

## Documentation map

| Document | Covers |
|---|---|
| [`README.md`](README.md) | What the app is, its status, the quick start, the commands |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | The pull request flow, supply-chain hardening |
| [`SECURITY.md`](SECURITY.md) | How to report a vulnerability |
| [`docs/database.md`](docs/database.md) | The profiles table, its RLS and grants, the consent RPCs, the new-table checklist |
| [`docs/local-stack.md`](docs/local-stack.md) | The local Supabase stack: commands, ports, auth email |
| [`docs/testing.md`](docs/testing.md) | Each test suite, how to run it, what CI runs |

## Branches and pull requests

- `main` holds released code and is the default branch; `develop` is the integration branch. Both take changes only through a pull request with CI green; direct pushes, force pushes and deletion are not allowed. The repository rulesets that enforce this are switched on when the repository becomes public (they need a paid plan while it is private), so until then the rule is kept by discipline.
- Work on a short-lived branch from `develop` (`feat/…`, `fix/…`, `docs/…`, `chore/…`) and open the pull request into `develop`, titled in Conventional Commits form. It's squash-merged, so the title becomes the commit.
- A release is a pull request from `develop` into `main` titled `release: vX.Y.Z`, merged with a merge commit.
- Commits use the GitHub `noreply` address, never a personal email: set `git config user.email` to it in this clone. No AI attribution or co-author trailers in commits or pull requests.

## Definition of done

- `pnpm typecheck && pnpm lint && pnpm test` all pass locally.
- No secrets anywhere in the diff.
- Commits follow Conventional Commits, on a descriptively named branch.
- The docs are updated per "Docs to update with each kind of change".
