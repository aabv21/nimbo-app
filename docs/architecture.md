# How Nimbo works

This page covers where Nimbo runs, what each part does, how the app decides which screen to show,
how consent is recorded, how it starts offline, the security model, the reasons behind this wave's
design choices, and how to regenerate the diagrams. Parts that later waves add are drawn as planned
and marked that way.

![System context: the Expo app talks to the Supabase project's Auth and REST API with the user's token and to Apple and Google for native sign-in; Postgres holds the profiles table; Edge Functions, the email relay, the AI and data APIs and a GitHub Actions keep-alive call are planned](diagrams/system-context.svg)

System context: [interactive page](diagrams/system-context.html) · [source](diagrams/system-context.json)

The diagram tool [archify](https://github.com/tt-a1i/archify) generates the three diagrams on this
page from their JSON sources; [Regenerating the diagrams](#regenerating-the-diagrams) shows how.
Each interactive page adds search, focus and both color themes; open it in a browser.

## What the system does and where it runs

Nimbo is a migraine companion: log attacks, spot patterns and get calm guidance in English, Spanish
or Portuguese. It is not a medical device and never diagnoses or prescribes.

- **The phone.** An Expo SDK 58 app (React Native, strict TypeScript, Expo Router) for iOS and
  Android. It keeps the session and the last profile in an on-device key-value store, so it opens
  offline.
- **One Supabase project.** Auth, Postgres 17 with row-level security, and later Edge Functions.
  Today only the local stack in Docker exists (`pnpm db:start`, [`local-stack.md`](local-stack.md)); no
  hosted project is set up yet ([`owner-runbook.md`](owner-runbook.md)). The phone holds only the project
  URL and the anon key, both public by design; every request carries the user's session token.
- **Planned services.** Edge Functions, an email relay for the hosted project, the AI and data APIs
  they call, and a daily GitHub Actions call to `keep_alive()` so a free project is not paused. None
  exists yet. Model calls will run only in Edge Functions, never on the phone.

## What each component does

| Component | Runs | What it does |
|---|---|---|
| Expo app | Phone | Routes in `src/app/`, gated by account state; the three themes; the tab shell ([`app.md`](app.md)). |
| Auth | Supabase | Email and password with a 6-digit email code to confirm and to reset, and Sign in with Apple and Google through native ID tokens. |
| Postgres 17 | Supabase | The `profiles` table with RLS and column grants, the signup trigger, and the consent RPCs ([`database.md`](database.md)). |
| `accept_terms`, `set_ai_consent` | Postgres | The only writers of the consent columns; they stamp the server clock. |
| `keep_alive` | Postgres | A no-op the anon key may call. |
| Condition pack | Shared code | The migraine catalogs and limits, in `supabase/functions/_shared/condition/`, imported by the app and later by the functions. |
| Edge Functions, email relay, AI and data APIs, keep-alive workflow | Planned | Not built yet. |

## Data model

![Data model: the signup trigger inserts a profiles row for each auth.users row; the app selects and updates twelve settings columns directly and records consent only through the accept_terms and set_ai_consent functions, which stamp the server time](diagrams/data-model.svg)

Data model: [interactive page](diagrams/data-model.html) · [source](diagrams/data-model.json)

One `profiles` row per auth user, created by the `handle_new_user()` trigger and deleted with the
user. The columns, policies, grants and RPC contracts are in [`database.md`](database.md).

## Sign-in and the gate

![Gate flow: on launch the stored session and cached profile feed nextRoute, which sends the app to the loading view when the profile is unknown, to the sign-in group when signed out, to the boundary screen when the terms are missing and then to the AI consent screen, and to the tabs once both are answered](diagrams/gate-flow.svg)

Gate flow: [interactive page](diagrams/gate-flow.html) · [source](diagrams/gate-flow.json)

`nextRoute(auth)` in `src/auth/gate.ts` is a pure function of the auth status and the profile. It
returns one of five routes:

| Account state | Route |
|---|---|
| Status `loading`, or signed in with no readable profile | `/loading` |
| Signed out | `/sign-in` |
| `adultConfirmedAt` or `boundaryAcceptedAt` is null | `/welcome/boundary` |
| `aiConsentAnsweredAt` is null | `/welcome/ai-consent` |
| Everything answered | `/today` |

The root layout calls it and registers only the allowed screens with `Stack.Protected`, so a deep
link to a screen the user may not reach never mounts it; `src/app/index.tsx` forwards the landing
route to the allowed one. While the answer is `/loading` the layout shows a loading view instead of
the stack; once signed in it offers Try again and Sign out, so a profile that can never be read
(no row, or a row this build cannot parse) is not a dead end. `src/app/welcome/_layout.tsx` repeats the guard for
its two screens and turns off the back gesture: the two steps are answered, not skipped.

An unreadable profile is not an unanswered consent, so a signed-in user whose profile cannot be
read stays on loading and never sees the consent screens.

The sign-up path: sign up, then the code screen (`confirm-email`). Signing in with an unconfirmed
address leads to the same screen, which then says no code is on its way yet and leads with sending one. A password reset uses the `reset` screen
with its own code.

## The consent model

Three answers are recorded on the profile: the adult confirmation and the boundary acceptance
(both required, stamped together by `accept_terms`), and the AI answer (`set_ai_consent`), which
stores the answer apart from the question having been asked, so a "no" is remembered and not asked
again. Declining AI leaves the app complete: `visibleTabs` in `src/profile/tabs.ts` drops the
Companion tab, and the Profile switch can turn it on later.

Consent is RPC-only because a column the client can update is a column a hand-made request can set:
a user could stamp their own timestamps, skip the gate or claim consent they never gave. The
consent columns have no `update` grant, the two functions are `security definer` with an empty
`search_path`, and they use the server clock. The pgTAP suite and the integration suite both try
the forbidden writes ([`testing.md`](testing.md)).

## Offline start

`AuthProvider` builds its first state synchronously from the stored session and the cached profile
(`readStoredSession`, `readCachedProfileSync`), so a launch with no network, or a slow one, reaches
the tabs without waiting for Supabase's own session check. Offline with an expired token, supabase-js
reports a null session at `INITIAL_SESSION` while keeping it; the provider reads the stored session
instead and stays signed in until a real `SIGNED_OUT`. A failed profile read keeps the cached
profile, and with none the status still leaves `loading` (the view shows a retry button). A failed
launch read is retried when the app resumes or the network returns (`useOnResume`). Every request
has a timeout (`fetchWithTimeout`), so a dead connection does not hold a spinner.

## Security

- **Row-level security on every table**, with `select` and `update` limited to the caller's row.
  Column grants narrow the update to twelve settings columns; there is no insert or delete policy,
  so the signup trigger is the only creator of rows.
- **No secrets in the bundle.** `EXPO_PUBLIC_*` holds only the Supabase URL, the anon key and the
  Google OAuth client ids. The service-role key is read by `integration/helpers.ts` and scripts
  only, never under `src/`.
- **Sign-in tokens.** Apple and Google sign-in exchange native ID tokens with Supabase Auth. Apple's
  carries a nonce; Google's does not, because the Google Sign-In library cannot send one Supabase
  Auth would match, so a Google ID token has no replay protection beyond its short lifetime
  (`src/auth/socialAuth.ts`).
- **No health text in logs.**
- **Repository.** Rulesets on `main`, `develop` and release tags require the CI checks; private
  vulnerability reporting is on ([`SECURITY.md`](../SECURITY.md)). CI also scans for secrets, audits
  dependencies, lints the workflows and runs CodeQL ([`CONTRIBUTING.md`](../CONTRIBUTING.md)).

## Design decisions of this wave

- **Three appearances plus Automatic.** Day, Dark and Dim are real themes with tokens of their own
  (`src/ui/theme.ts`); the profile stores `system` (default), `day`, `dark` or `dim`. Automatic follows
  the phone between Day and Dark and is Day when the phone reports nothing. Dim is also what crisis
  mode forces, so it has to be a first-class theme and not a dark variant.
- **A Liquid Glass tab bar with a reduce-transparency fallback.** `src/ui/TabBar.tsx` uses the iOS 26
  glass where the API exists and a blur otherwise. It stays opaque until the OS answers the
  reduce-transparency question, so a user who asked for none never sees a first glass frame, and it
  stays opaque when the setting is on.
- **Consent is written only through server-stamped RPCs** (above), so the timestamps cannot be
  forged by a client.
- **Gates are enforced at route registration.** A redirect inside a screen runs after the screen
  mounts; `Stack.Protected` keeps unreachable routes out of the navigator, so a deep link cannot show
  one. The tab shell does the same for Companion: with the AI off it has no trigger, and the shell
  renders nothing for a route without one while the headless tabs fall back to Today.
- **The profile cache is written only by the provider.** `AuthProvider` writes the cache from what
  it shows; the repository's reads and writes never do. Two writers would let a slow read, or an older
  write answering late, overwrite a newer value in the cache and the screen, and the next offline
  start would open on stale data. The provider also drops a read that began before a local change and
  reads again.
- **One condition pack shared by the app and the functions.** The catalogs, medication classes and
  limits live once in `supabase/functions/_shared/condition/`, with no runtime imports so Deno and the
  app can both load it; `src/condition/index.ts` re-exports it. A test checks every catalog item has
  a label in every language catalog.
- **Commits by milestone.** The branch history has one commit per milestone (repo and toolchain,
  domain and languages, backend and auth, app shell, docs), each reviewed before it is kept, so the
  history reads as the build order.

## Regenerating the diagrams

Each diagram's source is a JSON file in `docs/diagrams/`. archify renders the `*.html` page from it,
and the `*.svg` image is that page's own export. Edit only the JSON, then regenerate the other two.

The tool is [archify](https://github.com/tt-a1i/archify), a Node.js command-line tool that needs no
install. Keep it outside this repo, so `pnpm lint` does not scan its files, and set `ARCHIFY` to its
`bin/archify.mjs`.

| Diagram | Type |
|---|---|
| `system-context.json` | `architecture` |
| `data-model.json` | `architecture` |
| `gate-flow.json` | `workflow` |

Run the commands from the repo root, because each source's `meta.output` path is relative to it.
For one diagram, with its type and name:

1. `node "$ARCHIFY" validate <type> docs/diagrams/<name>.json --quality showcase --json`, after
   every edit, until all 9 artifact checks pass with 0 composition errors and 0 warnings.
2. `node "$ARCHIFY" deliver <type> docs/diagrams/<name>.json docs/diagrams/<name>.html --quality showcase --json`
   writes the page.
3. Open the page in a browser, choose **Export**, then **SVG**, and save the download over
   `docs/diagrams/<name>.svg`, which this page embeds.
4. `node "$ARCHIFY" visual-check <copy>.html --json` checks a copy of the page in a real browser; it
   writes PNG screenshots next to the page, so run it on a copy outside the repo.

Update the diagrams when the schema, the gate rules or a planned service becomes real, and keep the
alt text above in step with them.
