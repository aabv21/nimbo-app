# Native configuration

`ios/` and `android/` are generated at prebuild (Continuous Native Generation) and gitignored: never
create or edit them by hand. Native behavior lives in `app.json` and its config plugins.

## Permissions

Nimbo uses no permission beyond the network. There is no camera, microphone, location, notification
or contacts access yet, so `app.json` declares no usage strings and no `ios.infoPlist` entries.
Later waves that add one (coarse location for weather, notifications) must list it here with the
reason and the plugin that adds it.

## What `app.json` sets

- **Identity:** display name "Nimbo", slug `nimbo-app`, scheme `nimbo`, iOS bundle identifier and
  Android package `com.aabv21.nimbo`. `app.json` never gains `ios.buildNumber` or
  `android.versionCode`.
- **Appearance:** `userInterfaceStyle: "automatic"`, so the system appearance reaches the app and
  Automatic can follow it ([`architecture.md`](architecture.md#design-decisions-of-this-wave)).
- **Plugins:**
  - `expo-router` and `expo-splash-screen` (the splash image and its background color).
  - `expo-localization` with `supportedLocales` `en`, `es` and `pt`, so the OS offers the app those
    languages.
  - `expo-sqlite`, for the key-value store that holds the session and the cached profile, and for
    `nimbo.db`, the local store of health records and the outbox ([`app.md`](app.md)).
  - `expo-apple-authentication`, with `ios.usesAppleSignIn` true, for Sign in with Apple.
- **Experiments:** `typedRoutes` and `reactCompiler`.
- **Android:** a monochrome adaptive icon, `predictiveBackGestureEnabled: false`, and
  `allowBackup: false`, so Android's cloud and device-transfer backup never copies `nimbo.db` (health
  records) or the stored session off the phone.
- **iOS backup (known gap):** expo-sqlite keeps its databases in `Documents/SQLite`, which iCloud
  backup includes, and the SDK 58 docs offer no supported way to exclude a database file; a later
  security audit should decide on a native exclusion or an encrypted store.

Google sign-in is not configured yet: the sign-in screens hide its button until the build has
`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`. Once the OAuth clients
exist, add the `@react-native-google-signin/google-signin` config plugin with Nimbo's iOS URL scheme
(the iOS client id reversed, `com.googleusercontent.apps.<ios-client-id>`) and rebuild; the step is
in [`owner-runbook.md`](owner-runbook.md).

## Changing native config

Edit `app.json` or add a plugin, run `pnpm expo prebuild --clean` to check it, then rebuild with
`pnpm ios` or `pnpm android`. Add a native dependency with `pnpm expo install`.
