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
- `expo-sqlite/kv-store`: an in-memory map behind the same synchronous API `src/lib/kv.ts` calls.
- `Dimensions`: `fontScale` 1, since React Native's preset reports 2 and would render every large-text layout.
- `react-native-reanimated`: `src/test/reanimatedMock.ts`, since Reanimated's own mock loads the worklets native module. Animations settle at once on their target; a shared value written with `.set()` reaches a style only through `useAnimatedStyle`, as on a device.
- `expo-glass-effect` and `expo-blur`: plain views; `isLiquidGlassAvailable` is a `jest.fn()` returning `false`, so a suite can reach the iOS 26 glass branch.

Tests use `@testing-library/react-native` v14, where `render`, `renderHook` and `fireEvent` are async.

What the suites cover:

- `src/i18n/__tests__/`: the catalogs have the same keys, and the locale resolves from the device and the stored preference.
- `src/lib/__tests__/`: `kv`; `fetchWithTimeout` (12 s by default, 45 s for a POST to an Edge Function, a caller's own abort still cancels); `storedSession` (the user id and email read from the persisted session, and no session without a refresh token); `supabase` (client options, the missing-variable errors, auto refresh only in the foreground); `useOnResume`; `requestResult` (which database errors are `network`, `invalid` or `unknown`).
- `src/auth/__tests__/`:
  - `authService`: each call against a fake client, with the Apple and Google ID-token sign-in mocked (this is the only coverage of ID-token sign-in; a live provider check is deferred). It covers the sign-up code (`verifyOtp` type `signup`) and its resend, the reset flow, and the "email not confirmed" sign-in as its own error kind.
  - `errors`: every Supabase auth error code and the native cancel codes map to a message key.
  - `nonce`: the Apple nonce is 32 random bytes and its hash is the SHA-256 of the raw value.
  - `signOutOffline`: against a real supabase-js client with a failing fetch, an expired stored session still signs out and leaves nothing in storage.
  - `useSignOut`: the pending state and a failure's message key.
  - `SocialButtons`: no Google button without both client ids, Apple only on iPhone, and nothing at all (not even the "or") on Android without Google.
  - `AuthProvider`: with a stored session and a cached profile the first render is signed in and never waits for the network; a failed read keeps the cached profile and one with no cache still settles; a different user never sees another's cached profile; sign-out clears memory but keeps the cache; a slow read for a signed-out user is dropped; a recovery session is not a sign-in; a read that a local change overtook is dropped (not shown or cached) and read again; the email and `patchProfile`.
- `src/ui/__tests__/`:
  - `theme`: every theme meets the contrast floor (text 4.5:1, marks 3:1), Dim stays under its luminance caps, Day and Dark have no pure white, Dark reads at 10:1 or more on a background that is not pure black, and `resolveTheme` maps each preference, phone scheme and crisis flag.
  - `motion`: the durations per level (Day and Dark full, Dim 1.5 times slower, reduced motion a 150 ms fade).
  - `ThemeProvider`: Automatic follows the phone, a fixed choice ignores it, signed out follows the phone, crisis mode forces Dim and gives the choice back, and the in-app or OS reduce-motion setting makes every motion a fade.
  - `Button`: 48 pt minimum, a label that wraps, the disabled state reported to assistive technology.
  - `TabScene`: the first tab appears without an entrance, a tab rises in each time it gains focus, and switching to Dim or Reduce motion while a tab is focused does not replay its entrance.
  - `TabBar`: the bar is opaque until the OS answers whether to reduce transparency, reduce transparency renders no glass or blur view, iOS 26 renders the system glass, otherwise a blur; tabs report their selected state.
- `src/profile/__tests__/`:
  - `profileRepository`: the snake_case to `Profile` mapping (a theme or language newer than the build reads as Automatic or the phone's language), the cache under `profile.<userId>` and `null` for another user, an update sending only the given columns, the consent RPC arguments, writes and the consent refetch never touching the cache (the provider caches what it shows), and a network failure leaving the cache untouched.
  - `tabs`: the companion tab exists only with the AI on.
  - `useProfileChange`: a change shows at once and a failure puts it back; an older write answering (or failing) after a newer one never undoes the newer value.
  - `profileCache`: the real provider, `useProfileChange` and repository with a faked client: an older write answering after a newer one leaves the screen and the cache on the newer value.
  - `useTimezoneSync`: a device zone that differs from the profile is saved once (on mount or resume), an equal one never, and a failed save is tried again.
- `src/__tests__/`: tests that span routes.
  - `smoke`: the root layout's gates; the loading view's Try again (busy while the read is out) and Sign out once signed in, and no actions while the session is unknown; and the tab shell: four tabs with the AI on, three without it, a deep link to the companion opening it with the AI on and, with the AI off, landing on Today without ever mounting it, and the Nimbo tab appearing when the AI is turned on.
  - `consent-gate`: the real consent screens under the root layout: a saved boundary moves on to the AI question and a saved AI answer opens the tabs through the gate alone, with no second profile read; a failed save keeps the user on the screen with the error.
  - `boundary`, `ai-consent`: each screen's checks and the consent fields it shows from the saved answer; a failed save shows the error and changes nothing.
  - `sign-in`, `confirm-email`: sign-in's Back only when there is a screen to return to and the unconfirmed-email path; the code screen arriving from sign-in (no code claimed sent, sending one first) and from sign-up (cooldown), and code entry.
  - `profile`: language, appearance (applied at once, put back on a failed save), reduce motion, the AI switch's confirmation and consent text, and sign-out.

`src/test/authMock.ts` stands in for `AuthProvider` in screen suites:
`jest.mock('../auth/AuthProvider', () => require('../test/authMock'))`. `resetAuth()` in
`beforeEach` signs in `user-1` (`user-1@example.com`) with a fully consented profile, and `setAuth` changes it;
its `patchProfile` merges into the current profile like the provider's.

## `scripts` and `functions`

Plain Node, no jest-expo: `scripts/**/*.test.ts` and `supabase/functions/**/*.test.ts`. Node's own
type stripping loads the files (`extensionsToTreatAsEsm` and `transform: {}`), so these files use
explicit `.ts` imports and no Deno or React Native API in anything a test imports.

## `integration`

`integration/*.int.test.ts` exercise `src/auth/emailAuth.ts` and `src/profile/profileRepository.ts`
against the real local stack, over HTTP, as an anon-key client like the app's. Plain Node again;
two module mappings replace what is native: `src/lib/supabase.ts` becomes a stub that throws if a
default client is ever used (each test passes its own), and `expo-sqlite/kv-store` becomes an
in-memory map.

```sh
pnpm db:start     # Docker must be running
pnpm env:local    # writes .env.local, which helpers.ts loads
pnpm test:int
pnpm db:stop      # leave the stack stopped
```

- `integration/helpers.ts`: loads `.env.local`, builds the anon and service-role clients, creates and deletes users through the admin API, and reads a 6-digit code from Mailpit (`http://127.0.0.1:54524`). The service-role key is read here only, never under `src/`.
- `auth.int.test.ts`: sign up, sign in before confirming (the "email not confirmed" kind), confirm with the Mailpit code, a wrong code, a resent code, a weak password, sign in and out, and the password reset with a good, wrong and reused code.
- `profile.int.test.ts`: a new profile has no consent; `acceptTerms` then `setAiConsent` round-trip through the RPCs; an update changes only the given columns; a rejected value is the `invalid` kind; user A cannot read or change B's profile and cannot write the consent columns; the cache keeps each user's own profile.

Every test uses a unique email and deletes its users afterwards, so runs repeat on one stack. The
tests run in band (`--runInBand`): they share one Auth service and its per-address email limits.

## pgTAP

`supabase/tests/*.test.sql`, run by `pnpm db:test` ([`database.md`](database.md#tests)): the
profile table's row-level security, column grants and the consent functions.
