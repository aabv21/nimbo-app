# Testing

Five suites: four Jest projects (`app`, `scripts`, `functions`, `integration`) and one pgTAP suite.
`pnpm test` runs the three that need no Docker. `pnpm test:int` and `pnpm db:test` need the local
Supabase stack ([`local-stack.md`](local-stack.md)). The modules under test are described in [`app.md`](app.md) and the flows in [`architecture.md`](architecture.md).

| Suite | Command | Needs the stack | CI |
| --- | --- | --- | --- |
| `app` | `pnpm test` | no | Quality job |
| `scripts` | `pnpm test` | no | Quality job |
| `functions` | `pnpm test` | no | Quality job |
| `integration` | `pnpm test:int` | yes | Database job |
| pgTAP | `pnpm db:test` | yes | Database job |

CI also runs `pnpm typecheck`, `pnpm lint` and `pnpm check:supply-chain` in the Quality job, and
checks that `src/lib/database.types.ts` matches the migrations in the Database job, which also runs `pnpm env:local && pnpm test:int` against that stack.

## `app`

Component, hook and unit tests under `src/**/*.test.[jt]sx?`, in `jest-expo`'s React Native
environment. `jest.setup.ts` mocks what has no native module under Jest:

- `react-native-safe-area-context`: the package's own Jest mock, so insets are deterministic.
- `expo-localization`: `getLocales()` answers a fixed `en-US` locale, so i18n tests do not depend on the host.
- `expo-network`: online and reachable; a suite that tests connectivity mocks the module itself.
- `expo-haptics`: resolved no-ops.
- `expo-notifications`: permission granted, nothing scheduled; `src/cabinet/__tests__/reminders.test.ts` replaces it with a stateful fake that holds what is scheduled.
- `expo-location`: permission denied and no position; a suite that needs a fix mocks the calls it makes.
- `expo-sqlite/kv-store`: an in-memory map behind the same synchronous API `src/lib/kv.ts` calls.
- `expo-sqlite` itself is not mocked globally: a suite that touches the local store runs it on
  `src/test/sqliteNode.ts` with `jest.mock('expo-sqlite', () => require('<path>/test/sqliteNode'))`. The
  adapter implements `openDatabaseSync`, `execSync`, `runSync`, `getFirstSync`, `getAllSync` and
  `withTransactionSync` over `node:sqlite`'s `DatabaseSync(':memory:')`, so the real SQL, constraints and
  transactions run. Each open is a new empty database, and a nested transaction fails as on a device.
  `src/test/localDbTest.ts` empties the store between tests and inserts mirror rows.
- `Dimensions`: `fontScale` 1, since React Native's preset reports 2 and would render every large-text layout.
- `react-native-reanimated`: `src/test/reanimatedMock.ts`, since Reanimated's own mock loads the worklets native module. Animations settle at once on their target, and `withTiming` calls its completion callback with `finished: true`; a shared value written with `.set()` reaches a style only through `useAnimatedStyle`, as on a device.
- `react-native-worklets`: `scheduleOnRN` calls its function at once, since the worklets runtime is native.
- `expo-glass-effect` and `expo-blur`: plain views; `isLiquidGlassAvailable` is a `jest.fn()` returning `false`, so a suite can reach the iOS 26 glass branch.

Tests use `@testing-library/react-native` v14, where `render`, `renderHook` and `fireEvent` are async.

What the suites cover:

- `src/i18n/__tests__/`: the catalogs have the same keys, every red flag's why line and every emergency region's name exist, and the locale resolves from the device and the stored preference. `plural`: one and other in all three languages, CLDR's pt `one` for 0 and `many` for whole millions in es and pt, and a missing `.many` falling back to `.other`. `format`: `formatDuration` (0, 45 min, hours, days), `formatClock` per locale, and `parseClock` accepting `22:10` and `7:05` and rejecting `25:00`, `2210` and the empty string.
- `src/lib/local/__tests__/`: `db` (schema version 1, the five tables, `user_id` and a 0/1 `dirty` on every mirror table, change listeners per table); `useLocalQuery` (re-reads only when a listed table changes or the read function is new); `purgeUser` and `purgeOtherUsers` (a user's rows go only with an empty outbox, never another user's, and a signed-out launch purges every clean user).
- `src/lib/outbox/__tests__/`:
  - `outbox`: `enqueue` in a transaction marks the row dirty, and a rolled-back one queues nothing. A check-in is keyed by its date. The row turns clean only when its last operation is sent. `listOutbox('B')` never returns A's operations, and `resetFailed` clears one user's failures, attempts and backoff.
  - `runOutbox`: the backoff values; creation order; a retryable failure holding back the operation after it, with `nextAttemptAt = now + 5 s`; a permanent failure marked while the pass goes on; a network throw retried without spending an attempt (any other throw spends one); the 8th failure marked failed. Offline: 10 passes with no answer leave the operation pending with a growing, capped wait, and it is sent once the network returns; a server that keeps answering with errors still ends at 8. For an app killed mid-send: the attempt is claimed before the send, the next launch sends it after the backoff, and 8 kills end it. With two accounts on one phone, A's operations are never sent while the session is B's (and spend no attempt), and a switch mid-pass stops before the next send. Concurrent calls share one pass, and a pause holds sends until resumed, waiting for the one in flight.
  - `errors`: each permanent code (at the status PostgREST gives it), no response flagged `noResponse`, and each other retryable case.
- `src/lib/sync/__tests__/`:
  - `pull`: against a fake client, the pull replaces clean rows, keeps a dirty row's local version, deletes a clean row the server lost but not one with an unsent delete, writes only the signed-in user's rows, uses an explicit column list for every table, stores booleans and arrays as SQLite values, reads past the 1000-row page, and changes nothing on a failed read.
  - `SyncProvider`: sign-in resumes and runs push then pull; an enqueue syncs again and the counts are the user's own; an account switch pauses the previous user; sign-out pauses and syncs nothing; `retry` resets the failures and syncs. Sign-out purges the user's rows only after the pause settles, keeps them while an operation is unsent, an account switch purges the previous user, and a launch purges another user's clean rows. A timer runs a pass when the head of the queue is due, and an account switch clears it.
  - `SyncNotice`: nothing while synced, the pending line only after 600 ms (never for work done sooner), and the failure notice whose Try again calls `retry`.
- `src/lib/__tests__/`: `localDate`; `kv`; `fetchWithTimeout` (12 s by default, 45 s for a POST to an Edge Function, a caller's own abort still cancels); `storedSession` (the user id and email read from the persisted session, and no session without a refresh token); `supabase` (client options, the missing-variable errors, auto refresh only in the foreground); `useOnResume`; `requestResult` (which database errors are `network`, `invalid` or `unknown`).
- `src/auth/__tests__/`:
  - `gate`: `nextRoute` for every account state once the intro was seen, the intro for a signed-out phone that never saw it (and only while signed out), the setup steps while `onboardingCompletedAt` is null, and a profile cached by the build before the setup steps routing to them rather than to the loading view.
  - `authService`: each call against a fake client, with the Apple and Google ID-token sign-in mocked (this is the only coverage of ID-token sign-in; a live provider check is deferred). It covers the sign-up code (`verifyOtp` type `signup`) and its resend, the reset flow, and the "email not confirmed" sign-in as its own error kind.
  - `errors`: every Supabase auth error code and the native cancel codes map to a message key.
  - `nonce`: the Apple nonce is 32 random bytes and its hash is the SHA-256 of the raw value.
  - `signOutOffline`: against a real supabase-js client with a failing fetch, an expired stored session still signs out and leaves nothing in storage.
  - `useSignOut`: the pending state and a failure's message key.
  - `SocialButtons`: no Google button without both client ids, Apple only on iPhone, and nothing at all (not even the "or") on Android without Google.
  - `AuthProvider`: with a stored session and a cached profile the first render is signed in and never waits for the network; a failed read keeps the cached profile and one with no cache still settles; a different user never sees another's cached profile; sign-out clears memory but keeps the cache; a slow read for a signed-out user is dropped; a recovery session is not a sign-in; sign-out and an account switch forget a pending urgent-care request; a read that a local change overtook is dropped (not shown or cached) and read again; the email and `patchProfile`; a fetched null `onboardingCompletedAt` keeps the phone's stamp (or the time the call was queued) while `complete_onboarding` is queued, also when the outbox sends it while that read is out, and once it is sent the server's stamp replaces it.
- `src/ui/__tests__/`:
  - `theme`: every theme meets the contrast floor (text 4.5:1, marks 3:1), Dim stays under its luminance caps, Day and Dark have no pure white, Dark reads at 10:1 or more on a background that is not pure black, and `resolveTheme` maps each preference, phone scheme and crisis flag.
  - `motion`: the durations per level (Day and Dark full, Dim 1.5 times slower, reduced motion a 150 ms fade).
  - `ThemeProvider`: Automatic follows the phone, a fixed choice ignores it, signed out follows the phone, crisis mode forces Dim and gives the choice back, and the in-app or OS reduce-motion setting makes every motion a fade.
  - `Button`: 48 pt minimum, a label that wraps, the disabled state reported to assistive technology.
  - `TabScene`: the first tab appears without an entrance, a tab rises in each time it gains focus, and switching to Dim or Reduce motion while a tab is focused does not replay its entrance.
  - `TabBar`: the bar is opaque until the OS answers whether to reduce transparency, reduce transparency renders no glass or blur view, iOS 26 renders the system glass, otherwise a blur; tabs report their selected state.
- `src/redflags/__tests__/useRedFlagCheck`: a hit opens urgent care once with the sentence that hit and returns true, an app in Spanish catches English, plain text returns false, it works with the AI off, and a long excerpt is cut to 160 characters.
- `src/cabinet/__tests__/` and `src/__tests__/cabinet.test.tsx`:
  - `doseDays`: one day per class however many doses, 23:59 on 30 November counts in November and 00:01 on 1 December in December (America/Bogota, where the UTC date differs), preventive doses and unknown medications are left out, archived acute ones still count, and the days left in the month.
  - `medicationStore` and `doseStore`: the mirror row and the queued call commit together (a failing enqueue leaves no row), 1.5 hours is 90 minutes, archived medications are hidden by default, another user's rows are never read, and `p_episode_id` is omitted rather than null.
  - `mostUrgent`: a class limit beats a combined limit and a class warn, a combined limit beats a class warn, and everything ok gives null.
  - `cabinet` (screens): the empty state, the grouped list with days per class, the warn notice at 8 of 10 and the limit notice with its action, the form's validation, Preventive swapping the interval for the schedule, archiving after a confirmation, and the Profile row.
- `src/onboarding/__tests__/coarseLocation`: one decimal (`4.71234, -74.07219` is `4.7, -74.1`; `-33.4569, -70.6483` is `-33.5, -70.6`); a denied permission resolves null without reading a position; a granted one asks for the lowest accuracy; an unreadable fix resolves null.
- `src/today/__tests__/todaySections`: the exact order for every priority, overuse level and check-in state the rules tell apart.
- `src/episodes/__tests__/`:
  - `episodeStore`: started with the network failing, the mirror row and the `log_episode` operation exist before `startEpisode` returns; after a simulated kill (every module loaded again over the same database) the attack is still open, and a lost reply followed by a replay reaches a fake server exactly once; a second start returns the open attack; `updateEpisode` queues only the given keys, a moved start included, and refuses (writing and queuing nothing) an end before the start, a start after the end, a time more than 5 minutes ahead, before 2000 or unreadable; `endEpisode` queues `end_episode` and refuses an end before the start or ahead of now; the suite pins the clock (only `Date` is faked); `deleteEpisode` unlinks the doses; the hooks read only the user's rows, newest first, and follow changes.
  - `useLongAttackWatch`: nothing at 71 hours; at 72 hours urgent care opens once with `long_attack`, and neither a resume nor a remount opens it again; it waits while another urgent-care screen is up and while the path is still `/`; ended attacks, other users and no user open nothing.
- `src/history/__tests__/`:
  - `monthGrid`: November 2026 (a Sunday start) has six leading blanks and six weeks, February 2027 (a Monday start) has none and four weeks, a leap February has 29 days, and every day appears once.
  - `filterEpisodes`: each filter alone (intensity 7 keeps 7 and 8 and drops 6 and unrated, trigger, doses with and without, period 30d, 90d and all from a fixed now), several together, the empty filter keeping everything in order, and a query that ignores accents and case in notes and in the translated label ("cafe" finds "Cafeína" in Spanish and not "Caffeine" in English).
- `src/crisis/__tests__/`:
  - `countdown`: 15:55 plus 480 minutes is 23:55; 30 seconds left counts as 1 minute and none is 0; "23:50" typed at 00:10 in São Paulo is the previous day and "0:05" is today; Tokyo's wall clock rather than UTC; a New York daylight-saving change.
  - `HeadMap`: seven front regions and four back ones, each a checkbox with its label and at least 48 pt; the side labels swap between views; a press toggles the area and the marked list removes one.
- `supabase/functions/_shared/condition/__tests__/overuse`: the warn and limit levels per class, no limit for a gepant, the combined count (ICHD-3 8.2.6: ergot, triptan, simple analgesic and opioid only, distinct dates, applies only with two or more of them; combination analgesics, gepants and others never count toward it).
- `src/profile/__tests__/`:
  - `profileRepository`: the snake_case to `Profile` mapping (a theme or language newer than the build reads as Automatic or the phone's language), the cache under `profile.<userId>` and `null` for another user, an update sending only the given columns, the consent RPC arguments, writes and the consent refetch never touching the cache (the provider caches what it shows), a network failure leaving the cache untouched, and `completeOnboarding` queuing `complete_onboarding` with no request.
  - `tabs`: the companion tab exists only with the AI on.
  - `useProfileChange`: a change shows at once and a failure puts it back; an older write answering (or failing) after a newer one never undoes the newer value.
  - `profileCache`: the real provider, `useProfileChange` and repository with a faked client: an older write answering after a newer one leaves the screen and the cache on the newer value.
  - `useTimezoneSync`: a device zone that differs from the profile is saved once (on mount or resume), an equal one never, and a failed save is tried again.
- `src/__tests__/`: tests that span routes.
  - `smoke`: the root layout's gates; the loading view's Try again (busy while the read is out) and Sign out once signed in, and no actions while the session is unknown; and the tab shell: four tabs with the AI on, three without it, a deep link to the companion opening it with the AI on and, with the AI off, landing on Today without ever mounting it (Today appearing still, as the tab the shell opened on), and the Nimbo tab appearing when the AI is turned on; a signed-out phone that never saw the intro opens on it.
  - `onboarding`: the intro under the root layout (Next through the three screens, Get started marking it seen and opening sign-up, Skip opening sign-in) and the setup steps: the AI answer landing on triggers, triggers saved in the order picked, a failed save keeping the step with the error, the overuse priority, Skip and Not now reaching the last step with nothing written, Add opening the cabinet form, a denied notification permission still moving on, the lock-screen choice saved, the hours and cap rows not being buttons, and the location step (offline, Not now finishes onboarding through the outbox and lands on Today; a denied permission does the same; an allowed one sends only the rounded area; a finish the local store refuses keeps the step with the error).
  - `today`: the first day; an open attack's running time, its card and Back to the attack; the 12-hour question ending the attack, "Not yet" hiding it until the next 12 hours (also after a remount), nothing before 12 hours; 8 triptan days putting the medication first with the warning ahead of the count; a pending check-in first; the overuse priority; the sync line after 600 ms; Start an attack writing the attack and opening crisis mode on it; the last end today, yesterday and days ago; the date turning over at midnight; the AI-off card. The suite runs the local store on `sqliteNode.ts` and stands in for `SyncProvider` with a settable state.
  - `consent-gate`: the real consent screens under the root layout: a saved boundary moves on to the AI question and a saved AI answer opens the tabs through the gate alone, with no second profile read; a failed save keeps the user on the screen with the error.
  - `boundary`, `ai-consent`: the consent screen shows the first of the six onboarding steps; each screen's checks and the consent fields it shows from the saved answer; a failed save shows the error and changes nothing.
  - `sign-in`, `confirm-email`: sign-in's Back only when there is a screen to return to and the unconfirmed-email path, a code sent from the notice opening the code screen in its sent state (and the next arrival there too); the code screen arriving from sign-in (no code claimed sent, sending one first) and from sign-up (cooldown), and code entry.
  - `urgent-care`: the hand-off pushes `/urgent-care` with no health text in the route; leaving the screen forgets the request, so opening it again shows no excerpt; a text hit shows the excerpt, the why and company lines and fires a warning haptic; a voice hit and several flags; region BR reads "Call 192" and dials `tel:192`; an unknown or missing region shows the local-number lines and opens an empty dialer; a duration hit shows the 72-hour line and "It already ended" opens the episode editor; "I'm safe, continue" goes back; the call button is the first focusable control after the title; and in Day, Dark and Dim its label is 4.5:1 on its fill and its fill 3:1 on the background.
  - `crisis`: Dim forced on mount and released on unmount, keep-awake on; the header; intensity unset until a tap, then `{ intensity: 7 }` queued; a symptom chip; one dose button for an acute medication and none for a preventive one; a dose tap shows "Taken at", the countdown, the next time and the interval, and the countdown turns on the minute; the countdown follows a dose from another attack; no interval says so; Cancel deletes a dose just logged and Change moves it (a bad time shows the error); "It's over" asks, ends the attack and shows the duration and doses, "Not yet" keeps it open, and an end before the start is refused, and so is a default end before a start set ahead, shown inline rather than thrown; the AI-off line shows only with the AI off; Hide leaves the attack open; the head map saves pain areas; "Tell me" and "What helped before" are absent.
  - `history`: the empty state with the next-month button disabled; the list newest first and grouped by month; a row opens the attack; the calendar's intensity (the highest of two attacks on a day) and check-in dot, and a month summary in its singular and plural forms; selecting a day and walking to the previous month; the filter sheet's apply label in the plural form of the live count and Clear filters; the search by notes; and `filter=doses` opening the list with only the attacks that have a dose in the last 30 days (the suite fakes only `Date`).
  - `episode`: the detail's times with the duration and every list as labels, its doses, no source line for a manual attack, Edit, and Delete confirming before it deletes and goes back; the editor sending only the intensity, or only the chips and start that changed, nothing when nothing changed, an end before the start disabling Save with the error, a time the store refuses shown inline, an open attack given an end, Android's date-then-time dialogs, Save confirming then going back after a second, and notes "worst headache of my life" saved first and then opening urgent care with that excerpt (with the AI on and off, and when the screen is left during the second), while an ordinary description opens nothing.
  - `profile`: language, appearance (applied at once, put back on a failed save), reduce motion, the AI switch's confirmation and consent text, and sign-out.

`src/test/syncMock.ts` stands in for `SyncProvider` in the suites that render the root layout (`smoke`,
`consent-gate`, `onboarding`): nothing syncs and the banner state is empty. Those suites also map `expo-sqlite` to
`sqliteNode.ts`, since the root layout's long-attack watch reads the local store.

`src/test/authMock.ts` stands in for `AuthProvider` in screen suites:
`jest.mock('../auth/AuthProvider', () => require('../test/authMock'))`. `resetAuth()` in
`beforeEach` signs in `user-1` (`user-1@example.com`) with a fully consented profile, and `setAuth` changes it;
its `patchProfile` merges into the current profile like the provider's.

## `scripts` and `functions`

Plain Node, no jest-expo: `scripts/**/*.test.ts` and `supabase/functions/**/*.test.ts`. Node's own
type stripping loads the files (`extensionsToTreatAsEsm` and `transform: {}`), so these files use
explicit `.ts` imports and no Deno or React Native API in anything a test imports.

- `supabase/functions/_shared/condition/__tests__/`:
  - `migraine`: the catalogs, the ICHD-3 overuse limits, the duration limits, and the seven red flags, frozen and in order, with `allOf` groups only on `fever_stiff_neck`.
  - `redFlags`: every positive in `calibration/red-flags.{en,es,pt}.json` returns at least its expected flags (zero misses) and no negative hits, both with its own locale and with `matchRedFlagsAnyLocale` (the union the app uses); an English message hits under the union but not under `es`; "worse than yesterday", "peor que ayer" and "pior que ontem" never hit; a stiff neck alone never hits, and with a fever term (in any language under the union) it does; each text flag has 4 or more positives and each locale 20 or more negatives; `normalizeText` folds case, accents and punctuation; a keyword inside another word does not hit; hits come in pack order once each; each flag but `long_attack` has 3 or more keywords per locale.
  - `emergency`: the numbers for US, MX, BR, CO, CL, AR, ES, PT, PR, HN, CU, VE and GT, a lower-case code, `null` for BO, PY, NI and an unknown or missing region, and every number digits only.
  - `premium` (functions): `hasPremium` is true only on `data === true`; an error, a null or a thrown call is false.
- `scripts/__tests__/premium.test.ts`: the argument parser (a grant with a note and an end date, open-ended grants, revoke, and a usage error for a past or invalid `--until`, an unknown flag, a missing email or value), and `main` exiting 1 without `SUPABASE_SERVICE_ROLE_KEY` before any client is created.

The fixtures are written the way people type: capitals, missing accents, typos and slang in Latin
American Spanish and Brazilian Portuguese, plus ordinary attack descriptions that must not hit. Add a
message that was missed as a positive before changing a keyword list.

## `integration`

`integration/*.int.test.ts` exercise `src/auth/emailAuth.ts`, `src/profile/profileRepository.ts` and
the outbox and pull against the real local stack, over HTTP, as an anon-key client like the app's.
Plain Node again; three module mappings replace what is native: `src/lib/supabase.ts` becomes a stub
that throws if a default client is ever used (each test passes its own), `expo-sqlite/kv-store`
becomes an in-memory map, and `expo-sqlite` becomes the `src/test/sqliteNode.ts` adapter.

```sh
pnpm db:start     # Docker must be running
pnpm env:local    # writes .env.local, which helpers.ts loads
pnpm test:int
pnpm db:stop      # leave the stack stopped
```

- `integration/helpers.ts`: loads `.env.local`, builds the anon and service-role clients, creates and deletes users through the admin API, and reads a 6-digit code from Mailpit (`http://127.0.0.1:54524`). The service-role key is read here only, never under `src/`.
- `auth.int.test.ts`: sign up, sign in before confirming (the "email not confirmed" kind), confirm with the Mailpit code, a wrong code, a resent code, a weak password, sign in and out, and the password reset with a good, wrong and reused code.
- `outbox.int.test.ts`: `log_episode`, `update_episode`, `save_medication`, `log_dose` and `end_episode` drain in order through the real RPCs and the server rows match. A `log_episode` whose response was lost after the commit is sent again and leaves one row. B's `update_episode` on A's episode is a permanent failure (`P0002`) and A's row is unchanged. `pullAll` into an empty store reads back exactly what was sent. `complete_onboarding` sent twice through the outbox succeeds both times and the first stamp stands.
- `premium.int.test.ts`: grant makes `has_premium` true for the user and revoke makes it false, with the before and after rows returned; a purchase set by the service role survives a revoke; a user cannot write an entitlement or ask about another user (`42501`); an unknown email is an error; the command prints both rows.
- `profile.int.test.ts`: a new profile has no consent; `acceptTerms` then `setAiConsent` round-trip through the RPCs; an update changes only the given columns; a rejected value is the `invalid` kind; user A cannot read or change B's profile and cannot write the consent columns; the cache keeps each user's own profile.

Every test uses a unique email and deletes its users afterwards, so runs repeat on one stack. The
tests run in band (`--runInBand`): they share one Auth service and its per-address email limits.

## pgTAP

`supabase/tests/*.test.sql`, run by `pnpm db:test` ([`database.md`](database.md#tests)): the
profile table's row-level security, column grants and the consent functions.
