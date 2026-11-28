# Native configuration

`ios/` and `android/` are generated at prebuild (Continuous Native Generation) and gitignored: never
create or edit them by hand. Native behavior lives in `app.json` and its config plugins.

## Permissions

Nimbo uses the network, notifications for preventive reminders, and an optional approximate location for
weather. There is no camera, microphone or contacts access yet. A later wave that adds a permission must list it
here with the reason and the plugin that adds it.

- **Approximate location (`expo-location`):** asked once, on the last onboarding step and only when the user taps
  "Allow approximate area"; never at launch. The app reads one lowest-accuracy fix, rounds it to one decimal (about
  11 km) on the phone and saves only that ([`app.md`](app.md#onboarding-and-today-srconboarding-srctoday-srcapptabstodaytsx)).
  The plugin options keep it coarse on both platforms:
  - iOS: `locationWhenInUsePermission` is the only usage string ("Nimbo uses your approximate area, never your exact
    location, …"); `locationAlwaysAndWhenInUsePermission`, `locationAlwaysPermission`, `locationFullAccuracyPermission`
    and `motionUsagePermission` are `false`, so the Always, temporary full-accuracy and motion strings are left out of
    `Info.plist`; `isIosReducedAccuracyByDefault` sets `NSLocationDefaultAccuracyReduced`, so the prompt offers
    approximate location only.
  - Android: `android.blockedPermissions` lists `android.permission.ACCESS_FINE_LOCATION`, which the library's manifest
    would otherwise add, so the merged manifest keeps only `ACCESS_COARSE_LOCATION` (a `tools:node="remove"` entry).
  - No background location, no foreground service.
  - The iOS prompt string is English only: `app.json` has no `locales` yet, so Spanish and Portuguese users see the
    English text. Translating it through `locales` (`InfoPlist.strings` per language) is a later step.

- **Notifications (`expo-notifications`):** the reminders are local, scheduled on the phone with no server. On
  Android 13 and later the `expo-notifications` plugin adds `POST_NOTIFICATIONS`, and the library's own manifest adds
  `RECEIVE_BOOT_COMPLETED`, so reminders are set up again after a restart. The app asks only when a preventive
  schedule is saved (never at launch), through `askNotificationPermission`, and only while the system still allows the
  question. Android 12 and later need `SCHEDULE_EXACT_ALARM` for exact times and Android 14 denies it by default; Nimbo
  does not request it, so a reminder may arrive a few minutes late (a reminder is not an alarm). iOS asks for alert and
  sound, never a badge.
- **Keep awake (`expo-keep-awake`):** crisis mode keeps the screen on while it is open (`useKeepAwake`) and lets it
  sleep again when it closes. It needs no permission and no config plugin.
- **Date-time picker (`@react-native-community/datetimepicker`):** the attack editor's time fields. It needs no permission; its
  config plugin carries the library's native setup. iOS shows its picker inline; Android has no date-time mode, so the editor asks
  for the date and then the time.
- **Channel:** `preventive-reminders`, importance default, lock-screen visibility private, named "Reminders" in the
  user's language. The plugin's `defaultChannel` is the same id.
- **No push:** `enableRemoteNotifications` is `false`, so the iOS build has no APNs entitlement and Nimbo registers no
  push token; every notification is local.
- **Content:** the title is "Nimbo" and the body the neutral line, unless the user turned on the lock-screen detail in
  Profile; `data` carries nothing.

## What `app.json` sets

- **Identity:** display name "Nimbo", slug `nimbo-app`, scheme `nimbo`, iOS bundle identifier and
  Android package `com.aabv21.nimbo`. `app.json` never gains `ios.buildNumber` or
  `android.versionCode`.
- **Appearance:** `userInterfaceStyle: "automatic"`, so the system appearance reaches the app and
  Automatic can follow it ([`architecture.md`](architecture.md#design-decisions)).
- **Plugins:**
  - `expo-router` and `expo-splash-screen` (the splash image and its background color).
  - `expo-localization` with `supportedLocales` `en`, `es` and `pt`, so the OS offers the app those
    languages.
  - `expo-sqlite`, for the key-value store that holds the session and the cached profile, and for
    `nimbo.db`, the local store of health records and the outbox ([`app.md`](app.md)).
  - `expo-apple-authentication`, with `ios.usesAppleSignIn` true, for Sign in with Apple.
  - `expo-notifications`, with `defaultChannel` `preventive-reminders` and `enableRemoteNotifications` false, for the
    local preventive reminders.
  - `@react-native-community/datetimepicker`, for the attack editor's start and end times.
  - `expo-location`, with the coarse-only options above, for the onboarding location step.
- **Android permissions:** `blockedPermissions` removes `ACCESS_FINE_LOCATION`.
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
