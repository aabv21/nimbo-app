# Native configuration

`ios/` and `android/` are generated at prebuild (Continuous Native Generation) and gitignored: never
create or edit them by hand. Native behavior lives in `app.json` and its config plugins.

## Permissions

Nimbo uses the network, notifications for preventive reminders, an optional approximate location for weather, and
the microphone with speech recognition for dictation. There is no camera or contacts access. A later wave that adds a
permission must list it here with the reason and the plugin that adds it.

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

- **Notifications (`expo-notifications`):** the preventive reminders are local, scheduled on the phone with no server;
  the signal pushes come from the server through Expo's push service. On Android 13 and later the `expo-notifications`
  plugin adds `POST_NOTIFICATIONS`, and the library's own manifest adds `RECEIVE_BOOT_COMPLETED`, so reminders are set up
  again after a restart. The app asks only when a preventive schedule is saved, when the user taps "Allow notifications"
  (the onboarding step, or Profile → Notifications while the permission isn't granted), never at launch, through
  `askNotificationPermission`, and only while the system still allows the question; once only Settings can change it,
  Profile's button opens Settings. Android 12 and later need `SCHEDULE_EXACT_ALARM` for exact times and Android 14 denies it by default; Nimbo
  does not request it, so a reminder may arrive a few minutes late (a reminder is not an alarm). iOS asks for alert and
  sound, never a badge.
- **Microphone and speech recognition (`expo-speech-recognition`):** dictation to Nimbo, in the Companion tab's mic
  and crisis mode's "Tell me" ([`app.md`](app.md#voice-srcvoice)). Both are hold-to-talk: the app asks on the first
  press (never at launch), and the microphone is open only while the finger is down. The plugin adds:
  - iOS: `NSMicrophoneUsageDescription` ("Nimbo uses the microphone only while you hold the mic, to dictate a message
    to Nimbo or tell it about an attack.") and `NSSpeechRecognitionUsageDescription` ("Nimbo turns what you dictate
    into text, on this phone, so you can send it to Nimbo or save it in an attack's notes."). Recognition always runs
    on the device (`requiresOnDeviceRecognition: true`), so the audio never leaves the phone; a phone that cannot
    recognize on the device (`supportsOnDeviceRecognition()` false) shows no mic at all.
  - Android: `RECORD_AUDIO`, and a `<queries>` entry for Google's recognition service
    (`com.google.android.googlequicksearchbox`) so the app can reach it. Android uses the phone's default recognizer,
    offline when the language pack for the dictation language is installed (`getSupportedLocales`), otherwise the
    recognizer's own online service. Without the offline pack, Android sends the dictated audio to Google's speech
    recognizer, so Google is a processor of dictated audio and must be named in the privacy policy
    ([`owner-runbook.md`](owner-runbook.md)).
  - On both platforms Nimbo never stores or uploads audio itself: no recording is persisted
    (`recordingOptions: { persist: false }`, set explicitly on every start), and only the transcript, as text, reaches the app.
  - Both prompt strings are English only, like the location one.
  - With the AI off, the mic and "Tell me" are hidden, so the prompt never appears.
- **Text to speech (`expo-speech`):** "Read aloud" on a crisis-mode reply. It needs no permission and no config
  plugin. On iOS, recognition switches the app's audio session to `playAndRecord`, and `expo-speech` speaks through
  the app's session (`useApplicationAudioSession` defaults to true), so after a dictation "Read aloud" may play even
  while the ring switch is on silent; before any dictation it follows the switch. This is on the device-check list;
  the user turns the volume down or does not tap the button.
- **Keep awake (`expo-keep-awake`):** crisis mode keeps the screen on while it is open (`useKeepAwake`) and lets it
  sleep again when it closes. It needs no permission and no config plugin.
- **Date-time picker (`@react-native-community/datetimepicker`):** the attack editor's time fields. It needs no permission; its
  config plugin carries the library's native setup. iOS shows its picker inline; Android has no date-time mode, so the editor asks
  for the date and then the time.
- **Channels:**
  - `preventive-reminders`: importance default, lock-screen visibility private, named "Reminders" in the user's language.
    The plugin's `defaultChannel` is the same id.
  - `signals`: the signal pushes (the server's `PUSH_CHANNEL_ID`), importance default, lock-screen visibility left at the
    system default, named "Notes from Nimbo" in the user's language (`src/push/signalChannel.ts`). A channel's importance
    and visibility can't change once it exists on a phone, so these are fixed before the first APK that carries it. The
    copy carries the privacy: without the opt-in a push says only "You have a note from Nimbo", and a private channel
    would hide even the details a user opted in to on a secure lock screen. Android 13 shows the permission prompt only
    once a channel exists, so `registerPush` creates it before asking and before the token request.
- **Push token:** `registerPush` asks for an Expo push token with the EAS project id from `expo.extra.eas.projectId`
  (none yet, so the build reads "unavailable") and stores it with `register_push_token`. It runs at launch when the
  permission is already granted, and after "Allow notifications". Push does not work in Expo Go on Android: a
  development build is needed.
- **FCM (Android):** `getExpoPushTokenAsync` needs Firebase on Android. `google-services.json` (public identifiers, which
  Expo's FCM guide allows committing) and `app.json`'s `android.googleServicesFile` arrive together in the owner session
  once the Firebase project exists ([`owner-runbook.md`](owner-runbook.md)): a `googleServicesFile` without its file
  breaks prebuild, and the file alone does nothing. Until then the token request fails and Profile says notifications
  aren't available on this build. The FCM V1 service-account key goes to EAS credentials, never to the repo:
  `.gitignore` ignores `*-firebase-adminsdk-*.json` and `service-account*.json`.
- **iOS remote push is off:** `enableRemoteNotifications` stays `false` until the Apple account exists, so the iOS build
  has no APNs entitlement and gets no token; its reminders still work.
- **Content:** a reminder's title is "Nimbo" and its body the neutral line, unless the user turned on the lock-screen
  detail in Profile; its `data` carries nothing. A signal push's title is "You have a note from Nimbo" with no body,
  unless the same opt-in is on; its `data` is only `{ url: '/today' }`, and a tap opens Today.

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
    local preventive reminders and, on Android, the signal pushes.
  - `@react-native-community/datetimepicker`, for the attack editor's start and end times.
  - `expo-location`, with the coarse-only options above, for the onboarding location step.
  - `expo-speech-recognition`, with the microphone and speech-recognition usage strings above, for dictation.
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
`pnpm ios` or `pnpm android`. Add a native dependency with `pnpm expo install`. To check what the plugins write without
generating `ios/` and `android/`, `pnpm expo config --type introspect` prints the resulting `Info.plist` and manifest.
