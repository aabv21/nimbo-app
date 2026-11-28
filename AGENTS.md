# AGENTS.md

Guidance for anyone, human or AI, working in this repository.

## Project

Nimbo is a migraine companion for iPhone and Android, built as a portfolio demo with Expo (SDK 58) and Supabase. Locales are `en` (source), `es` and `pt`; themes are `day`, `dark` and `dim` (the profile stores `system`, `day`, `dark` or `dim`; crisis mode forces `dim`); tabs are `today`, `companion`, `history` and `profile`.
It is not a medical device: it never diagnoses or prescribes. Status: the tracking core is in place (sign-in, the consent gates and setup, Today, crisis mode, the cabinet and overuse guard, the check-in, History, red flags, offline sync and premium access), and so is the AI companion (the chat with drafts and evidence, dictation, the agent's notes and the day-after debrief, behind the `companion` Edge Function and its guards), and so are the insights (History's Patterns and the companion's `get_insights`, one shared module) and the signals (Today's rows and companion note, the companion's `get_signals`, push registration and the hourly `monitor` that stores signals and sends neutral pushes; push reaches a phone once the owner's EAS and Firebase setup exists), and so is the hardening for v1.0.0 (versioned consent with the health-data consent, the privacy policy in three languages, data export and account deletion, and eight audits with their fixes). It is a v1.0.0 release candidate for closed testing; the owner's live session ([`docs/owner-session.md`](docs/owner-session.md)) deploys it and ends in the release. What it does: [`README.md`](README.md); how it works: [`docs/architecture.md`](docs/architecture.md).

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
- `pnpm typecheck` (`tsc --noEmit`), `pnpm lint` (`eslint .`), `pnpm test` (the `app`, `scripts` and `functions` Jest projects): the gate. `typecheck` and `lint` first run `pnpm routes:types` (`expo customize tsconfig.json`, no server) to generate the gitignored `.expo/types`, so results match CI.
- `pnpm test:int`: the `integration` Jest project (auth, the profile, the outbox, the account client, premium, the agent's notes, the forecast cache, push registration, and the `companion`, `push-claim`, `push-unregister`, `monitor`, `export-data` and `delete-account` functions with their mocks, the API audit's gateway checks and the companion red team, against the running local stack; start it with `pnpm db:start && pnpm env:local`, stop it after). Not part of the gate ([`docs/testing.md`](docs/testing.md)).
- `pnpm e2e`: the Maestro flows on the Android emulator (`E2E_PLATFORM=ios` for the simulator), against the local stack with a dev build installed; it starts Metro if needed ([`docs/testing.md`](docs/testing.md#end-to-end-flows-maestro)). Not part of the gate.
- `pnpm catalog:sql`: prints `catalog_keys()` from the condition pack, for the new migration a catalog change needs ([`docs/database.md`](docs/database.md#catalog-helpers)).
- `pnpm dlx eas-cli@27 <command>`: the EAS CLI, which is not a dependency; `eas.json` holds the `development`, `preview` (an Android APK) and `production` profiles ([`docs/native-config.md`](docs/native-config.md#eas-build-profiles-easjson)). Builds run only from merged code, in the owner session.
- `pnpm policy:check`: checks the three privacy policies (`docs/privacy-policy.md`, `.es.md`, `.pt.md`) share the section anchors and every anchor `policyUrl` links to, and lists the owner placeholders left; it exits 1 until none is left, so it fails until the owner fills them ([`docs/owner-runbook.md`](docs/owner-runbook.md)).
- `pnpm premium grant|revoke <email>`: the owner's premium switch, which needs `SUPABASE_SERVICE_ROLE_KEY` ([`docs/owner-runbook.md`](docs/owner-runbook.md#granting-premium)).
- `pnpm calibrate eval [--locale en|es|pt|all] [--layer jev|claude]`: the guards against the real Jev or Haiku over `calibration/`, owner-only, with `TYPESAFE_API_KEY` and `ANTHROPIC_API_KEY` exported in the shell; it refuses the local mocks and CI ([`docs/ai.md`](docs/ai.md#calibration)).
- `pnpm check:supply-chain`, `pnpm check:expo`: supply-chain checks ([`CONTRIBUTING.md`](CONTRIBUTING.md#supply-chain-hardening)).
- `pnpm db:start`, `pnpm db:stop`: the local Supabase stack (Docker must be running); `pnpm db:reset` rebuilds it from the migrations, `pnpm db:test` runs the pgTAP suite, `pnpm db:lint` runs `supabase db lint` and fails on a warning, `pnpm db:types` regenerates `src/lib/database.types.ts`, `pnpm env:local` writes `.env.local` ([`docs/local-stack.md`](docs/local-stack.md)).

## Where things live

- `src/app/`: Expo Router routes only; the root layout gates the route groups with `nextRoute` and `Stack.Protected`. `src/__tests__/`: tests that span routes. Each module: [`docs/app.md`](docs/app.md).
- `src/ui/`: the theme tokens, motion tokens and base components (`Screen`, `DockedScreen`, `Button`, `TextField`, `Notice`, `TabBar`, `TabScene`, `ChoiceGroup`, `SwitchRow`), `usePressFeedback` and `useSheetMotion`; components read colours only from `useTheme()` and durations only from `useMotion()`.
- `src/auth/`, `src/profile/`: sign-in, the session, the gate (`gate.ts`) and the profile; `AuthProvider` is the only writer of the profile cache. `src/account/`: the consent text versions, the privacy policy's address and the re-consent checks, and the data rights on the phone: the export file and share sheet, the account deletion with its marker, the kv write guard and the launch sweep. `src/i18n/`: the `en`, `es` and `pt` catalogs. `src/condition/`: re-exports the condition pack in `supabase/functions/_shared/condition/`. `src/onboarding/`: the intro flag, the setup steps' frame and the coarse location. `src/today/`: Today's section order, status line and medication summary. `src/redflags/`: the red-flag check, the hand-off to the urgent-care screen and the emergency call button (`EmergencyCall.tsx`, shared by urgent care and the boundary screen's re-consent). `src/cabinet/`: medications, doses, the overuse notice and the preventive reminders. `src/episodes/`: attacks on the phone and the long-attack watch. `src/crisis/`: crisis mode's components ("Tell me" and "What helped before" included) and its countdown maths. `src/voice/`: press-and-hold dictation and spoken replies. `src/checkin/`: the daily check-in's store and Today card. `src/history/`: the History calendar and list, the filters and the episode editor's date field. `src/premium/`: `usePremium` and `PremiumGate`. `src/insights/`: re-exports the insights in `supabase/functions/_shared/insights.ts`, the mirror as their records, and the Patterns cards. `src/companion/`: the companion's shared vocabulary (`contract.ts`), the chat kept on the phone (`chatStore.ts`), its client, hook and UI. `src/memory/`: the agent's notes ("What I know about you"), read online and cached per user. `src/push/`: the push token (registration, the device secret, sign-out's unregister, a token reclaim), the `signals` channel and the push tap. `src/signals/`: re-exports the signal rules in `supabase/functions/_shared/signals.ts`, Today's rows computed on the phone, the stored pressure row read online and cached per user, the rows' words and the companion note. `src/lib/`: the Supabase client, kv store (with the post-deletion write guard and `kvKeys`), request helpers and `guards.ts` (the type guards shared with the functions); `src/lib/local/` the on-device database (`nimbo.db`) and its query hook, `src/lib/outbox/` the queue of RPC calls, `src/lib/sync/` the push-then-pull cycle. `src/test/`: shared test mocks. `integration/`: tests against the local stack.
- `scripts/`: repo tooling in TypeScript, run with Node's type stripping. `.maestro/`: the end-to-end flows and their config.
- `calibration/`: the fixtures per language: red flags the keyword matcher must pass with zero misses (and `modelOnly` ones the model screen must catch), companion replies the reply guard must judge, and intents ([`docs/testing.md`](docs/testing.md#calibration-fixtures)).
- `supabase/`: `config.toml`, `migrations/`, pgTAP `tests/`, the auth email `templates/` and the Edge Function code (`functions/`).
- `docs/`: the documentation map below; `docs/diagrams/`: the archify sources (`*.json`), pages (`*.html`) and images (`*.svg`); `docs/audits/`: the eight audits' findings, indexed in [`docs/audits/README.md`](docs/audits/README.md).
- `eas.json`: the EAS build profiles; no secret and no version number in it.
- `assets/images/`: the provisional icon and splash images.
- `.github/`: the pull request and issue templates, Dependabot, and the workflows: `ci.yml`, `codeql.yml`, `release.yml` and `keepalive.yml` (a daily `keep_alive()` call to the hosted project, a no-op until the repository variables `SUPABASE_URL` and `SUPABASE_ANON_KEY` exist).

## Guardrails

- Never create or edit `ios/` or `android/`: they are generated and gitignored. Configure native behavior in `app.json` and config plugins.
- Add a native dependency with `pnpm expo install`, then rebuild with `pnpm expo run:ios` / `pnpm expo run:android`. Prefer Expo modules over third-party libraries.
- pnpm only (never npm, yarn or bun), and never weaken `pnpm-workspace.yaml`'s supply-chain settings ([`CONTRIBUTING.md`](CONTRIBUTING.md#supply-chain-hardening)).
- Change `pnpm-lock.yaml` only through a local `pnpm install` or `pnpm update`, never by hand.
- `EXPO_PUBLIC_*` is inlined into the bundle, so no secrets: only the Supabase URL, the anon key and the Google OAuth client ids. The service-role key never goes in `src/`.
- A schema change is a new migration (never edit a merged one), then `pnpm db:types` and a pgTAP test. Follow the new-table checklist in [`docs/database.md`](docs/database.md#new-table-checklist): RLS, column grants, and `security definer` functions with `search_path = ''`. `supabase/tests/database_audit.test.sql` fails until those rules hold (an index on every foreign key, bounded text, no client sequence grant included), and `pnpm db:lint` must stay clean ([`docs/audits/database.md`](docs/audits/database.md)).
- Consent columns, consent versions and `consent_events` change only through `accept_terms` and `set_ai_consent`, with a version `consent_texts` lists; a client never writes them. A new consent text is a seeded `consent_texts` row plus its constant in `src/account/consent.ts`, never an edit of a published version's meaning ([`docs/database.md`](docs/database.md#consent-versions)).
- A screen the account state does not allow is never registered or rendered: account-state gates live in the layouts (`nextRoute` with `Stack.Protected`, and the tab list in `src/app/(tabs)/_layout.tsx`), not in a redirect inside a screen.
- Only `AuthProvider` writes the profile cache, and only the sign-out cleanup in `SyncProvider` (or `forgetAccountOnDevice` after a deletion, or the launch sweep of an account with nothing queued) removes it; a repository call never does either.
- A kv key that belongs to an account carries its user id as a dot segment (`<name>.<userId>[.<more>]`), so the post-deletion guard refuses it and the launch sweep finds it; a device-wide key carries no UUID segment. The export file lives only in the cache directory and is removed at sign-out and deletion ([`docs/app.md`](docs/app.md#account-deletion-on-the-phone)).
- An account is deleted on the phone only through `runDeletion` (`src/account/deletionFlow.ts`): the marker first, the outbox paused, then the server, then the purge; nothing else calls `delete-account` or purges an account's data for a deletion.
- `pnpm policy:check` passes (no owner placeholder left) before a policy is published, and the three policy files change together.
- App code imports the condition pack from `src/condition/`, never from `supabase/` directly.
- Add a user-facing string to `src/i18n/en.ts`, `es.ts` and `pt.ts` together.
- `app.json` never gains `ios.buildNumber` or `android.versionCode`.
- Health data is written only through the outbox and the RPCs: a screen writes the local mirror and queues the call in one transaction (the stores in `src/cabinet/`, `src/episodes/`, `src/checkin/`), never a direct table write.
- `PROFILE_COLUMNS` never holds the location: the coarse area is written, never read back.
- Red-flag matching (`useRedFlagCheck`) runs on every free text the user writes, in all three languages, with the AI off too; a new free-text field calls it.
- No health text in logs, route params or notification payloads: routes carry ids, a reminder's `data` stays empty, and a signal push's `data` is only `{ url: '/today' }`, with the neutral title unless the user opted in to the lock-screen detail.
- Every `public` table with a `user_id`, and every `public` foreign key to `auth.users`, cascades from `auth.users` and is on the list `supabase/tests/account.test.sql` pins (`pinned_user_tables`); `export-data`'s unit test reads that list and requires `EXPORTED_TABLES` plus `EXCLUDED_TABLES` to equal it. A new user table therefore fails pgTAP until it is pinned, and the unit test until it is exported or excluded on purpose ([`docs/database.md`](docs/database.md#account-deletion-and-export)). The export never selects a push token or `device_secret_hash`, and reads with the caller's token except `usage_counters`.
- Push tokens are written only through `register_push_token` with the phone's device secret, never by a direct table write; a function that touches a token without a session (`push-unregister`) checks that secret ([`docs/database.md`](docs/database.md#push-tokens)).
- `app.json`'s `android.googleServicesFile` is added only together with `google-services.json`, `expo-notifications`' `enableRemoteNotifications` stays `false` until the Apple account exists, and the FCM service-account key is never committed ([`docs/native-config.md`](docs/native-config.md#permissions)).
- Model calls run only in Edge Functions (`supabase/functions/`), with the keys as function secrets; the phone never holds a provider key.
- No request to Anthropic or TypeSafe carries the user's name, email, user id, location or any row id: tools return catalog keys, local times and short refs, and profile reads name their columns.
- A function that reads the caller with `callerOf` keeps `verify_jwt = true` in `supabase/config.toml`, since `callerOf` trusts the gateway's signature check; a function with `verify_jwt = false` says in a comment there what checks its caller instead. A new use of the service role is a reviewed addition to the list `logScan.test.ts` pins ([`docs/audits/security.md`](docs/audits/security.md)).
- A new client-executable function or grant is added to the lists `supabase/tests/api_audit.test.sql` pins, after review: a `jsonb` RPC calls `private.check_keys`, and a service-only RPC is revoked from `public, anon, authenticated` ([`docs/audits/api.md`](docs/audits/api.md)).
- `monitor` runs only from the `pg_cron` job, with the Vault's shared secret (never a user's call, at least 32 characters), and claims each push through `claim_signal_push` before sending it, so overlapping runs never send one twice ([`docs/api.md`](docs/api.md#monitor)).
- Every weather request goes through `supabase/functions/_shared/weather.ts` and carries only the one-decimal cell, never a user id, a name or a finer location.
- No model call in `monitor`: every signal, push decision and push text comes from code and fixed copy, and Today's note is template text, never model output.
- Insights and signals are counts with their pack minimums (`insights`, `signals` in the condition pack), never percentages; their copy never says causes, risk, likely or predict, and a test scans every `insight.*`, `signal.*`, `today.note.*` and `push.*` string for it.
- Every companion reply goes through `screenReply` before it is returned; a replaced reply is never sent to the phone.
- Drafts are written only by `applyDraft` when the user taps Confirm, through the stores and the outbox; a model or a tool never writes a health record (`save_note` writes only the agent's notes).
- Agent notes reach the prompt only inside the escaped `<notes>` block, as data, never as instructions; the user's own text in the prompt or a tool result (a note, a medication name, a `dose_text`) carries no zero-width, bidi or control character.
- A tool round runs at most `MAX_TOOL_CALLS_PER_ROUND` calls; the rest are answered `too_many_calls`, unrun. A reply reaches the phone with no link of any form, and the app renders it as plain text.
- A `testID` is a stable English id for the Maestro flows, never copy; rename one only together with the flows that use it.

## Conventions

- Everything in English, except the product translations `src/i18n/es.ts` and `src/i18n/pt.ts`, the privacy policies `docs/privacy-policy.es.md` and `.pt.md`, the Spanish and Portuguese branches of `supabase/templates/*.html` and the auth email subjects, and later Spanish and Portuguese product files.
- `pnpm` pinned to an exact 11.x in `packageManager`; Node `>=24`.
- TypeScript strict plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `verbatimModuleSyntax`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, with `noEmit`: no build step, no `.js`/`.mjs` sources.
- Lint: typescript-eslint `strictTypeChecked`, `eslint-plugin-security` and `eslint-plugin-react-hooks` (not `eslint-config-expo`; see [`CONTRIBUTING.md`](CONTRIBUTING.md#supply-chain-hardening)).
- Navigation is Expo Router: routes in `src/app/`, `Link`, `router` and `useLocalSearchParams` from `expo-router`.
- App identity: display name "Nimbo", slug `nimbo-app`, scheme `nimbo`, bundle id and package `com.aabv21.nimbo`.
- Appearance follows the profile's choice; Automatic (the default) follows the system (`userInterfaceStyle: "automatic"`) between Day and Dark. Controls are 48 pt tall minimum with 44 pt hit targets; no `#ffffff` in a theme; no decorative looping animation.
- Text scales with the OS (no `allowFontScaling={false}`, no `maxFontSizeMultiplier` under 1.5) and a label in a row wraps (`flexShrink: 1`) rather than truncating (tab labels shrink to fit one line instead); an error that appears after a press is a `Notice`, a `TextField` error or an `AlertText`, so VoiceOver speaks it too, and a standing status notice passes `announce={false}`; `a11yScan.test.ts`, `motionScan.test.ts` and `contrast.test.ts` pin these ([`docs/audits/accessibility.md`](docs/audits/accessibility.md)).
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
| A migration or `supabase/config.toml` | the gate, plus `pnpm db:reset && pnpm db:test && pnpm db:lint && pnpm db:types` |
| Auth, the Supabase client or a repository | the gate, plus `pnpm test:int` |
| A native config or plugin | `pnpm expo prebuild --clean` to check it, then a rebuild |
| A condition pack catalog | the gate, plus `pnpm catalog:sql` into a new migration, then the migration row above |
| A screen or `testID` a Maestro flow uses | the gate, plus `pnpm e2e` on the emulator when one is available |
| A guard, a screen question, the prompt, a tool or the `companion` function | the gate, plus `pnpm test:int`; `pnpm calibrate eval` in the owner's session with the real keys |
| A signal or insight rule, or its pack values | the gate, plus the fixtures (`fixtures.test.ts`, `insights.test.ts`, `signals.test.ts`); re-check the rule first, then the fixture ([`docs/testing.md`](docs/testing.md#insight-and-signal-fixtures)) |
| The `monitor`, `push-claim`, `push-unregister`, `export-data` or `delete-account` function | the gate, plus `pnpm test:int` |
| A privacy policy, or a `PolicySection` anchor in `src/account/consent.ts` | the gate (`scripts/__tests__/policy-check.test.ts`), plus `pnpm policy:check` |
| A consent text's meaning | a new seeded `consent_texts` version in a new migration, the matching `TERMS_VERSION` or `AI_CONSENT_VERSION`, the policy's version line in the three files, then the migration row above and `pnpm policy:check` |
| A doc or a link in one | the gate (`scripts/__tests__/docs-links.test.ts` checks every relative link and anchor) |
| A diagram source | `archify validate` and `deliver`, then re-export the SVG ([`docs/architecture.md`](docs/architecture.md#regenerating-the-diagrams)) |

## Docs to update with each kind of change

| Change | Update |
|---|---|
| What the app does or its status | [`README.md`](README.md) |
| A command or guardrail | this file |
| A test suite, a mock or what CI runs | [`docs/testing.md`](docs/testing.md) |
| The schema, a policy, a grant or an RPC | [`docs/database.md`](docs/database.md) and the data-model diagram source [`docs/diagrams/data-model.json`](docs/diagrams/data-model.json) |
| A port, a stack command or auth email config | [`docs/local-stack.md`](docs/local-stack.md) |
| The pull request flow or supply-chain settings | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| The gate, consent, offline start, the outbox or sync, crisis mode, reminders, premium, security or a design decision | [`docs/architecture.md`](docs/architecture.md), and the crisis-logging diagram source [`docs/diagrams/crisis-logging.json`](docs/diagrams/crisis-logging.json) when the sync path changes |
| A red-flag keyword or a missed message | a positive in `calibration/red-flags.<locale>.json` first, then the pack ([`docs/testing.md`](docs/testing.md#scripts-and-functions)) |
| An emergency number or its source | the pack's `emergency.ts` and the emergency table in [`docs/architecture.md`](docs/architecture.md#red-flags-and-urgent-care) |
| An overuse limit or class | the pack's `migraine.ts` and the limits table in [`docs/architecture.md`](docs/architecture.md#medication-overuse-guard) |
| A signal's or an insight's pack value | the pack's `migraine.ts`, then the signals table or the insights paragraph in [`docs/architecture.md`](docs/architecture.md#signals-and-the-monitor), and the fixtures' planning copy |
| The monitor's run (its steps, budget or receipts) | [`docs/api.md`](docs/api.md#monitor) and the monitor-run diagram source [`docs/diagrams/monitor-run.json`](docs/diagrams/monitor-run.json) |
| A Maestro flow or the runner | [`docs/testing.md`](docs/testing.md#end-to-end-flows-maestro) |
| A `src/` module added, moved or removed | [`docs/app.md`](docs/app.md) |
| A model, the prompt, a tool, a screen question, a threshold, a quota or the cost | [`docs/ai.md`](docs/ai.md) |
| A guard, an attack it covers, a calibration fixture or a known gap | [`docs/red-team.md`](docs/red-team.md) |
| An Edge Function's request, response or status | [`docs/api.md`](docs/api.md), and the companion-message diagram source [`docs/diagrams/companion-message.json`](docs/diagrams/companion-message.json) when its sequence changes |
| A permission, plugin or `app.json` setting | [`docs/native-config.md`](docs/native-config.md) |
| An owner step or its status | [`docs/owner-runbook.md`](docs/owner-runbook.md), and how to run it with its pass condition in [`docs/owner-session.md`](docs/owner-session.md) |
| A check that needs a live account, a device or a hosted project | its section of [`docs/owner-session.md`](docs/owner-session.md#5-live-checks) |
| An EAS profile | [`eas.json`](eas.json) and [`docs/native-config.md`](docs/native-config.md#eas-build-profiles-easjson) |
| A security, API, agent-guardrail or database finding, or a change to a control an audit row cites | [`docs/audits/security.md`](docs/audits/security.md), [`docs/audits/api.md`](docs/audits/api.md), [`docs/audits/agent-guardrails.md`](docs/audits/agent-guardrails.md) or [`docs/audits/database.md`](docs/audits/database.md), and the counts in [`docs/audits/README.md`](docs/audits/README.md) |
| An accessibility, motion or React Native performance finding, a theme colour or a new colour pair a component paints | [`docs/audits/accessibility.md`](docs/audits/accessibility.md), [`docs/audits/motion.md`](docs/audits/motion.md) or [`docs/audits/react-native-performance.md`](docs/audits/react-native-performance.md), and the pair in `src/ui/__tests__/contrast.test.ts` |
| Code an over-engineering finding names | [`docs/audits/over-engineering.md`](docs/audits/over-engineering.md) |
| What the app collects or sends, a processor, a retention period, a consent text or the account deletion path | the three privacy policies together, [`docs/privacy-policy.md`](docs/privacy-policy.md), [`.es.md`](docs/privacy-policy.es.md) and [`.pt.md`](docs/privacy-policy.pt.md), with a new version date and consent text when the change is material |
| A diagram's subject changes | its `docs/diagrams/*.json` source, then regenerate the page and image ([`docs/architecture.md`](docs/architecture.md#regenerating-the-diagrams)) |

## Documentation map

| Document | Covers |
|---|---|
| [`README.md`](README.md) | What the app is, its status, the quick start, the commands |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | The pull request flow, supply-chain hardening |
| [`SECURITY.md`](SECURITY.md) | The supported version, how to report a vulnerability |
| [`docs/architecture.md`](docs/architecture.md) | Where it runs, the components, the gate flow, consent, offline start, health data offline, crisis mode, red flags and the emergency numbers, the companion and its guards, the overuse guard, the insights, the signals and the hourly monitor, Today's companion note, the weather, push notifications, reminders, premium, privacy and data rights (consent, export, deletion, the kv guard, retention), security, design decisions, regenerating the diagrams |
| [`docs/ai.md`](docs/ai.md) | The companion's flow, model and request, system prompt, tools, Jev questions, Haiku schemas, failure ladder, local reply checks, quotas, cost, outcomes and calibration |
| [`docs/red-team.md`](docs/red-team.md) | Each attack on the companion, the push functions and the monitor, its defense and its test, the agent audit's red-team rows in three languages, the body caps, and the known gaps |
| [`docs/api.md`](docs/api.md) | The `companion`, `push-claim`, `push-unregister`, `export-data`, `delete-account` and `monitor` functions' requests, responses and statuses, and the scheduled jobs |
| [`docs/diagrams/system-context.html`](docs/diagrams/system-context.html) | The system context: phone, Supabase project with Auth, the Edge Functions (`export-data` and `delete-account` included), Postgres with pg_cron, pg_net and the Vault, and the `monitor` function; Anthropic, TypeSafe, Open-Meteo, Expo push (FCM and APNs behind it), Brevo's SMTP, the policy on GitHub Pages and the daily keep-alive workflow ([source](docs/diagrams/system-context.json), [image](docs/diagrams/system-context.svg)) |
| [`docs/diagrams/data-model.html`](docs/diagrams/data-model.html) | `auth.users`, `profiles` (its zone checked), `consent_texts` and `consent_events`, the tracking tables with the debrief columns, `entitlements`, `agent_notes`, `usage_counters`, `weather_cache`, `signals`, `push_tokens` with `push_claims` and `push_claim_starts`, `push_tickets`, the signup trigger and the RPCs (the consent RPCs with version and locale, `set_dose_helped`, `consume_quota`, `record_inputs`, the push token and monitor RPCs, the hourly `prune_expired_caches`), `export-data` and `delete-account`, and the `pg_cron` job that calls `monitor` ([source](docs/diagrams/data-model.json), [image](docs/diagrams/data-model.svg)) |
| [`docs/diagrams/gate-flow.html`](docs/diagrams/gate-flow.html) | The launch gate: loading, intro, sign-in, the consent screens (three boxes on the boundary), re-consent (the terms gate with its emergency call row, the AI paused with `/ai-consent`), the setup steps and Today ([source](docs/diagrams/gate-flow.json), [image](docs/diagrams/gate-flow.svg)) |
| [`docs/diagrams/crisis-logging.html`](docs/diagrams/crisis-logging.html) | Logging an attack: the local mirror and outbox, crisis mode, `runOutbox`, the RPC and the pull ([source](docs/diagrams/crisis-logging.json), [image](docs/diagrams/crisis-logging.svg)) |
| [`docs/diagrams/companion-message.html`](docs/diagrams/companion-message.html) | One companion message: the phone's keyword check, the input screen, the quota, the tool loop under the caller's JWT, the reply screen and Confirm into the outbox ([source](docs/diagrams/companion-message.json), [image](docs/diagrams/companion-message.svg)) |
| [`docs/diagrams/monitor-run.html`](docs/diagrams/monitor-run.html) | One hourly monitor run: the `pg_cron` call with the Vault secret, Expo's receipts, the targets in rotation, each user's records, cached forecast, signals, claim and neutral push under the time budget, and Today reading only the pressure row ([source](docs/diagrams/monitor-run.json), [image](docs/diagrams/monitor-run.svg)) |
| [`docs/app.md`](docs/app.md) | Each module under `src/` |
| [`docs/native-config.md`](docs/native-config.md) | Permissions and `app.json` settings |
| [`docs/owner-runbook.md`](docs/owner-runbook.md) | The owner's decisions, steps and their status, and granting premium |
| [`docs/owner-session.md`](docs/owner-session.md) | The live session for v1.0.0, in order: accounts and the pending answers, the policy's placeholders and publishing, the hosted project, EAS, every live check, calibration, Maestro, the mid-range Android check, Play Console, the items before the public listing and the release |
| [`docs/database.md`](docs/database.md) | The profiles table, the consent versions and history, the tracking tables, entitlements, the forecast cache and its prune job, the signals, the push tokens and claims, the hourly monitor's zone check, receipts queue, RPCs and job, their RLS and grants, the RPCs, account deletion and export (the cascade and the pinned user tables), the new-table checklist |
| [`docs/local-stack.md`](docs/local-stack.md) | The local Supabase stack: commands, ports, auth email, the provider mocks, the monitor's Vault secrets and a run by hand |
| [`docs/privacy-policy.md`](docs/privacy-policy.md), [`.es.md`](docs/privacy-policy.es.md), [`.pt.md`](docs/privacy-policy.pt.md) | The privacy policy in English, Spanish and Portuguese (draft with owner placeholders): what Nimbo collects and why, the health-data and AI consents, processors, transfers, retention, rights, account deletion |
| [`docs/audits/README.md`](docs/audits/README.md) | The index of the eight audits, with their counts of fixed, accepted and deferred findings |
| [`docs/audits/accessibility.md`](docs/audits/accessibility.md) | The accessibility audit: tab labels, large text, contrast in Day, Dark and Dim, targets, screen-reader names and announcements, the head map, reduce motion, the consent, export and delete screens, each finding fixed, accepted or deferred |
| [`docs/audits/motion.md`](docs/audits/motion.md) | The motion audit against the motion spec: UI-thread worklets, no layout animation, the minute clocks, reduced and Dim variants, crisis mode's fade, Today's stagger, each finding fixed, accepted or deferred |
| [`docs/audits/react-native-performance.md`](docs/audits/react-native-performance.md) | The React Native performance audit: History and chat lists, the local store reads, context fan-out, the minute tick on Today and History, startup and assets, each finding fixed, accepted or deferred |
| [`docs/audits/security.md`](docs/audits/security.md) | The security audit: the service role, the gateway's JWT check, the monitor's secret, the session on the phone, deep links, logs, `.gitignore`, the supply chain, the export file, Apple 5.1.3 and account deletion, each finding fixed, accepted or deferred |
| [`docs/audits/database.md`](docs/audits/database.md) | The database audit: RLS and policies, grants and sequences, functions (`search_path`, execute grants, volatility), foreign key indexes, text bounds and enum parity, the jobs and the Vault, the retention periods against the privacy policy, the zone check and `supabase db lint`, each finding fixed, accepted or deferred |
| [`docs/audits/api.md`](docs/audits/api.md) | The API audit: the OWASP API Top 10 (2023) over PostgREST and the six functions (BOLA, BOPLA, broken authentication, resource limits, BFLA, CORS and error bodies), each finding fixed, accepted or deferred |
| [`docs/audits/agent-guardrails.md`](docs/audits/agent-guardrails.md) | The agent guardrails and AI red team audit of the companion: the bounded loop and the calls per round, the tools' reach, drafts, both screens and their context, the `<notes>` block, the `dose_text` rule, AI-off and quotas, the spend cap, provider requests and logs, and the red-team rows (injection carriers, jailbreaks, red-flag evasion, cross-user probes, exfiltration, cost, unicode), each finding fixed, accepted or deferred |
| [`docs/audits/over-engineering.md`](docs/audits/over-engineering.md) | The over-engineering review: dead exports and SQL functions, the outbox and sync, the code the app and the functions share, the guards and the consent tables, each finding deleted or accepted with its reason |
| [`docs/testing.md`](docs/testing.md) | Each test suite (the docs-links check included), test timing (arguments, the clock, the per-test timeout, the flaky-test hunt), the calibration fixtures, the Maestro flows on the emulator and the simulator, how to run them, what CI runs |

## Branches and pull requests

- `main` holds released code and is the default branch; `develop` is the integration branch. Both take changes only through a pull request with CI green; direct pushes, force pushes and deletion are not allowed. Rulesets on `main`, `develop` and `v*` tags enforce this and require the Quality, Security, Actions, Database and Analyze checks; private vulnerability reporting is on ([`SECURITY.md`](SECURITY.md)).
- Work on a short-lived branch from `develop` (`feat/…`, `fix/…`, `docs/…`, `chore/…`) and open the pull request into `develop`, titled in Conventional Commits form. It's squash-merged, so the title becomes the commit.
- A release is a pull request into `main` from a `release/vX.Y.Z` branch cut from `develop`, titled `release: vX.Y.Z`, merged with a merge commit; `release.yml` tags it ([`docs/owner-session.md`](docs/owner-session.md#11-the-release)).
- Commits use the GitHub `noreply` address, never a personal email: set `git config user.email` to it in this clone. No AI attribution or co-author trailers in commits or pull requests.

## Definition of done

- `pnpm typecheck && pnpm lint && pnpm test` all pass locally.
- No secrets anywhere in the diff.
- Commits follow Conventional Commits, on a descriptively named branch.
- The docs are updated per "Docs to update with each kind of change".
