# The app: modules under `src/`

What each client module does and how the pieces fit. The flow and the reasons are in
[`architecture.md`](architecture.md); the schema the app calls is in [`database.md`](database.md);
the tests for each module are in [`testing.md`](testing.md).

## Routes (`src/app/`)

Expo Router routes: every file is a screen and `_layout.tsx` files define navigators. Non-route code
(components, hooks, helpers) stays outside `src/app/`.

- `_layout.tsx`: loads the fonts, nests `AuthProvider`, `SyncProvider`, `I18nProvider` and `ThemeProvider`, and
  registers the route groups with `Stack.Protected` from `nextRoute`; while the answer is `/loading` it
  shows a loading view instead (Try again and Sign out once signed in). `index.tsx` forwards the landing route to the allowed screen.
- `(auth)/`: `sign-in`, `sign-up`, `confirm-email` (the 6-digit code, with resend) and `reset`.
- `welcome/`: `boundary` (adult confirmation and the not-a-medical-device boundary, `accept_terms`) and
  `ai-consent` (`set_ai_consent`), each registered only while it is the one due; no back gesture.
- `(tabs)/`: `today`, `companion`, `history`, `profile` behind a headless tab shell with the floating
  bar. The tab list comes from `visibleTabs`, so Companion has no trigger when the AI is off, and the
  shell renders nothing for a route without a trigger.
  `profile` holds language, appearance, reduce motion, the AI switch and sign-out.
- `src/__tests__/` holds the tests that span routes.

## Auth (`src/auth/`)

- `AuthProvider.tsx`: the session status, user id, email and the profile. Starts from the stored
  session and cached profile, listens to Supabase auth events, reads the profile, and is the only
  writer of the profile cache. `useAuth()` exposes `refreshProfile` and `patchProfile`.
- `gate.ts`: `nextRoute`, the pure gate.
- `authService.ts` re-exports the whole auth surface; `emailAuth.ts` (sign up, sign in, code confirm,
  resend, reset, sign out) has no native imports so the integration tests can load it;
  `socialAuth.ts` (Apple and Google ID-token sign-in, with `nonce.ts`) is the native part.
- `errors.ts` maps Supabase auth errors to message keys; `validation.ts` checks input before a
  request; `useSignOut.ts` signs out even when offline; `SocialButtons.tsx` is the provider buttons: Google
  only when the build has its client ids, Apple only on iPhone.

## Profile (`src/profile/`)

- `profileRepository.ts`: reads and updates the profile (snake_case to `Profile`, with a theme or
  language newer than the build read as Automatic or the phone's language) and calls the two consent
  RPCs; it never touches the cache itself. It also defines the cache format, `readCachedProfileSync`
  and `writeCachedProfile` (key `profile.<userId>`), which only `AuthProvider` calls. Calls return a
  `RequestResult`.
- `useProfileChange.ts`: applies a preference at once, saves it, and puts it back on failure; an older
  answer never undoes a newer value.
- `useTimezoneSync.ts`: keeps the profile's time zone on the phone's.
- `tabs.ts`: `visibleTabs`.

## Languages (`src/i18n/`)

`en.ts` is the source catalog; `es.ts` and `pt.ts` must have the same keys. `resolveLocale` takes the
first supported primary language (`pt-PT` counts as `pt`) and falls back to `en`. `I18nProvider` keeps
the stored language preference (`system`, `en`, `es` or `pt`); `useI18n()` gives `t(key, params)` and
`tp(key, count, params)`. `translate.ts` holds the catalogs and the lookup. `plural.ts` picks a counted
message's `.one`, `.many` or `.other` form by CLDR's rules for the three languages (written out, as
Hermes has no `Intl.PluralRules`), falling back to `.other`, and fills `{n}` with the count.
`format.ts` gives `formatClock` (12-hour in English, 24-hour otherwise), `formatDuration` ("5 h 20 min",
"3 d 2 h") and `parseClock` for typed times.

## Shared UI (`src/ui/`)

- `theme.ts`: the Day, Dark and Dim tokens (colours, type, space, radii) and the tones derived from
  them; `resolveTheme.ts`: preference, phone scheme and crisis mode to a theme; `ThemeProvider.tsx` and
  `themeContext.ts` provide it (`useTheme`, `useTones`); `color.ts` and `contrast.ts` are the colour
  maths and WCAG contrast the theme tests use.
- `motion.ts`: motion tokens per theme and reduce-motion setting, `useMotion()`, easings and springs;
  `usePressFeedback.ts`: press feedback; `useAccessibilityFlag.ts`: reduce motion and reduce transparency.
- Components: `Screen`, `Button`, `TextField`, `TextLink`, `Notice`, `ChoiceGroup`, `SwitchRow`,
  `CheckRow`, `CodeBoxes`, `BackButton`, `TabBar` (the floating Liquid Glass bar) and `TabScene` (a
  tab's entrance when it gains focus). Components read
  colours only from `useTheme()` and durations only from `useMotion()`.

## Library (`src/lib/`)

- `supabase.ts`: the one client, with a SQLite-backed session store, a request timeout, and
  foreground-only token refresh; `readStoredSession` and `clearPersistedAuth` read and clear it.
- `kv.ts`: the only caller of the on-device key-value store; `storedSession.ts` parses the persisted
  session; `fetchWithTimeout.ts`; `requestResult.ts` (the `network`, `invalid` and `unknown` kinds);
  `useOnResume.ts` (a retry hook for foreground and network return); `localDate.ts` (the phone's
  calendar day, a check-in's `local_date`); `database.types.ts` is generated by `pnpm db:types`: do not edit it.

### Local store, outbox and sync (`src/lib/local/`, `src/lib/outbox/`, `src/lib/sync/`)

Health data is local-first: a screen writes the phone's copy and queues the RPC call in one SQLite
transaction, shows the change at once, and the outbox sends it when it can.

- `local/db.ts`: `localDb()` opens `nimbo.db` on first use (`PRAGMA user_version = 1`). It holds the
  mirror tables `episodes`, `medications`, `doses` and `checkins`, with the server's columns (arrays as
  JSON text, booleans as 0 or 1), each row with its `user_id` and a `dirty` flag, and the `outbox`.
  `notifyChanged(tables)` tells readers a committed write changed those tables. `purgeUser(userId)`
  deletes a user's mirror rows unless an operation of theirs is still queued, so rows with an unsent
  or failed operation survive until that user signs back in and sends them. `purgeOtherUsers` runs
  it at launch for everyone but the signed-in user.
- `local/useLocalQuery.ts`: `useLocalQuery(tables, read)` re-reads only when one of `tables` changes (or
  `read` is a new function). Every read filters by the user id, so two accounts on one phone never see
  each other's rows.
- `outbox/outbox.ts`: `enqueue(userId, kind, args)` is called inside the mirror write's transaction. It
  queues the call for one of the eight tracking RPCs and marks the row dirty. The row stays dirty while
  any operation with its record key (the `p_id`, or `checkin:<local_date>`) is unsent, failed ones
  included. `listOutbox(userId)` returns that user's operations in order, and `resetFailed(userId)` puts
  them all back in line, due now, with fresh attempts.
- `outbox/runOutbox.ts`: `runOutbox(userId, deps)` sends one operation at a time, in order. The attempt is
  claimed (`attempts + 1` and the next backoff, `min(5 s · 2^(n − 1), 10 min)` over every send so far)
  before the send, so a kill mid-send still counts. A send with no answer (offline, a timeout) gives
  the attempt back and only lengthens the wait, so time offline never fails an operation. A retryable
  failure stops the pass, so nothing overtakes it. A permanent one, or the 8th answered attempt,
  marks the operation failed and the pass goes on. An operation is never sent
  while the session belongs to another account (`deps.sessionUserId()`). Concurrent calls share one pass,
  and `pauseOutbox` / `resumeOutbox` hold a user's queue. Each create RPC is idempotent on its id, so a
  call replayed after a lost response never duplicates a row. `rpcSender(client)` is the real `send`.
- `outbox/errors.ts`: `classifyRpcError`. No response (status 0, flagged `noResponse`) and 401 are retryable. The codes
  `22023`, `23514`, `23502`, `22P02`, `22001`, `22003`, `P0002` and `42501` are permanent, checked before
  the status because PostgREST answers `P0002` with a 500. Any other error is retried.
- `sync/pull.ts`: `pullAll(userId)` reads every row of the user, table by table, with an explicit column
  list, paged at the API's 1000-row limit. It then writes them in one transaction, skipping dirty rows
  and rows with an unsent operation (so a local delete is not undone), deleting clean rows the server
  no longer has, and never touching another user's rows.
- `sync/SyncProvider.tsx`: mounted inside `AuthProvider`. It runs a cycle, push then pull, on sign-in,
  on resume, on reconnect and after every `enqueue`. Cycles never overlap, and a request made during
  one runs one more. A timer wakes it when the head of the queue's backoff ends. On sign-out or an
  account switch it pauses the previous user's outbox and, once that and any running cycle have
  settled, purges their rows; at launch it purges every other user's.
  `useSyncState()` gives `pending`, `failed`, `syncing` and `retry()`.
- `sync/SyncNotice.tsx`: the sync banner. It shows nothing while synced. After 600 ms of pending work it
  shows one muted line ("Saved on this phone, syncing · 2 records to upload"). With failures it shows a
  notice that asks for a tap on Try again (a failed operation is only sent again from there). Each state cross-fades at the theme's `base` duration.

## Condition pack (`src/condition/`)

Re-exports `supabase/functions/_shared/condition/` (the migraine catalogs, medication classes and
limits). App code imports it from here, never from `supabase/` directly.

## Test helpers (`src/test/`)

`authMock.ts` stands in for `AuthProvider` in screen suites, `syncMock.ts` for `SyncProvider` in suites
that render the root layout, and `reanimatedMock.ts` replaces Reanimated under Jest. `sqliteNode.ts` is
expo-sqlite's synchronous API over `node:sqlite`, and `localDbTest.ts` empties the local store and
inserts mirror rows ([`testing.md`](testing.md)).
