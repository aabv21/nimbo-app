# The app: modules under `src/`

What each client module does and how the pieces fit. The flow and the reasons are in
[`architecture.md`](architecture.md); the schema the app calls is in [`database.md`](database.md);
the tests for each module are in [`testing.md`](testing.md).

## Routes (`src/app/`)

Expo Router routes: every file is a screen and `_layout.tsx` files define navigators. Non-route code
(components, hooks, helpers) stays outside `src/app/`.

- `_layout.tsx`: loads the fonts, nests `AuthProvider`, `I18nProvider` and `ThemeProvider`, and
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
the stored language preference (`system`, `en`, `es` or `pt`); `useI18n()` gives `t(key, params)`.

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
  `useOnResume.ts` (a retry hook for foreground and network return); `database.types.ts` is generated
  by `pnpm db:types`: do not edit it.

## Condition pack (`src/condition/`)

Re-exports `supabase/functions/_shared/condition/` (the migraine catalogs, medication classes and
limits). App code imports it from here, never from `supabase/` directly.

## Test helpers (`src/test/`)

`authMock.ts` stands in for `AuthProvider` in screen suites and `reanimatedMock.ts` replaces
Reanimated under Jest ([`testing.md`](testing.md)).
