# Owner runbook

The steps that need the owner's accounts or hardware, each with its status. Everything else in this
repo runs offline ([`testing.md`](testing.md)). Statuses are as of 2026-11-28; update a step's status
and date when it changes.

**Status words:** Done, Pending (not started or not finished), Blocked (waiting on someone else).

## Decisions on record

- **The app identity is final:** display name "Nimbo", slug `nimbo-app`, scheme `nimbo`, bundle id
  and Android package `com.aabv21.nimbo`.
- **Nothing is deployed before the owner merges:** migrations, functions and builds go to a hosted
  project only from merged code.
- **Open-Meteo's free API until the public release (2026-11-27):** the free, non-commercial API serves
  development and closed testing. Before the public store listing, buy the commercial API Standard plan or
  switch provider (the step below). The provider sits behind one module, `supabase/functions/_shared/weather.ts`
  ([`architecture.md`](architecture.md#weather)), and gets only coarse coordinates.

## Steps

| Step | Status | Notes |
|---|---|---|
| Make the repository public and turn on the rulesets | Done, 2026-11-26 | Rulesets on `main`, `develop` and `v*` tags require Quality, Security, Actions, Database and Analyze; private vulnerability reporting is on. |
| Create the Supabase project in an Americas region | Pending | The data is health-related, so pick the region before creating it; it cannot be moved later. Then link it, push the migrations after a merge and schedule the daily `keep_alive()` call. |
| Create the Google OAuth clients | Pending | One web client for Supabase and the native iOS and Android clients; put the client ids in `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` and the web client in Supabase Auth. Until both ids are set the sign-in screens show no Google button. |
| Add the Google Sign-In config plugin | Pending | After the OAuth clients exist: add `["@react-native-google-signin/google-signin", { "iosUrlScheme": "com.googleusercontent.apps.<ios-client-id>" }]` to `app.json`'s `plugins`, with Nimbo's iOS client id reversed as the URL scheme, then `pnpm expo prebuild --clean` and a rebuild ([`native-config.md`](native-config.md)). |
| Create the EAS project | Pending | Sets `owner` and `extra.eas.projectId` in `app.json`; builds are made only from merged code. |
| Enroll in the Apple Developer Program | Pending | Needed for Sign in with Apple on a device and for TestFlight. |
| Review the notification texts | Pending | Before the first build that ships reminders: the notifications setup step (`onb.notif.*`), the lock-screen choice (`notif.lock.*`), the reminder's neutral line (`push.neutral`) and detail line (`reminder.detail`) and the Android channel names (`reminder.channel`, `push.channel.name`), the notification settings (`notif.denied`, `notif.unavailable`, `notif.verifying`, `notif.hours.*`, `notif.cap.value.zero`), the signal rows and Today's note (`signal.*`, `today.note.*`, `today.signals.none`, the new keys listed in the signals pull request) in `src/i18n/en.ts`, `es.ts` and `pt.ts`, the push detail bodies in `supabase/functions/_shared/pushCopy.ts`, and the iOS location prompt in `app.json` (English only for now, [`native-config.md`](native-config.md#permissions)). |
| Spot-check the emergency number for each launch country | Pending | Before launching in a country, call up its source in the emergency table ([`architecture.md`](architecture.md#red-flags-and-urgent-care)) and confirm the number still stands; a country missing from the table gets "Call your local emergency number". Bolivia, Paraguay and Nicaragua are left out on purpose. |
| Create the Anthropic API key and set a spend limit | Pending | In the Anthropic Console, a key for Nimbo only, and a monthly spend limit on its workspace: the daily quotas bound each user, but only the spend limit bounds the total ([`ai.md`](ai.md#quotas-and-cost)). Keep the key out of the repo and out of `.env.local`. |
| Create the TypeSafe API key | Pending | A key for Jev (`jev-latest`), which screens every companion message and reply. |
| Set the function secrets and deploy `companion` | Pending | Only after the merge: `supabase secrets set ANTHROPIC_API_KEY=<key> TYPESAFE_API_KEY=<key>` on the hosted project, then deploy `companion`. Leave `ANTHROPIC_BASE_URL` and `TYPESAFE_BASE_URL` unset so the function uses the hosted APIs; the local stack points them at the mocks ([`local-stack.md`](local-stack.md#mocks)). |
| Calibrate the guards | Pending | In the live session, with both keys exported in the shell (never in `.env.local`): `pnpm calibrate eval`, then `--layer claude`. Raise a threshold only where every positive is still caught; the script changes nothing itself ([`ai.md`](ai.md#calibration)). |
| Name the processors of dictated audio in the privacy policy | Pending (Wave 5) | When the privacy policy is written: on Android without the offline language pack, dictation sends the audio to Google's speech recognizer, so Google is a processor of dictated audio; on iOS recognition stays on the device. Nimbo never stores or uploads audio itself, only the transcript as text ([`native-config.md`](native-config.md#permissions)). |
| Buy Open-Meteo's commercial API or switch the forecast provider | Pending (Wave 5, before the public store release) | The free API is non-commercial. With the API Standard plan: `supabase secrets set OPEN_METEO_URL=https://customer-api.open-meteo.com OPEN_METEO_API_KEY=<key>` on the hosted project, then redeploy the functions that read the forecast; `pressureUrl` adds the key to each request. Another provider means changing `supabase/functions/_shared/weather.ts` and its mock route only. Until then leave both unset (the free `https://api.open-meteo.com`, no key). |
| Set up Firebase and FCM for Android push | Pending (Wave 5) | After the EAS project exists: create the Firebase project for `com.aabv21.nimbo`, add `google-services.json` at the repo root and `"googleServicesFile": "./google-services.json"` under `android` in `app.json` in the same change (the file holds public identifiers and may be committed), then `pnpm expo prebuild --clean`. Upload the FCM V1 service-account key with `eas credentials` (Android → Google Service Account → FCM V1); never commit it (`.gitignore` ignores `*-firebase-adminsdk-*.json` and `service-account*.json`). Check a real token on a development build, the Android 13 prompt, and the lock screen with and without the detail opt-in ([`native-config.md`](native-config.md#permissions)). Deploy `push-claim` and `push-unregister` only after the merge. |
| Set the monitor's secrets and deploy `monitor` | Pending | Only after the merge: pick one random value, then `supabase secrets set MONITOR_SECRET=<value>` and, in the hosted project's SQL editor, `select vault.create_secret('<value>', 'monitor_secret')` and `select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/monitor', 'monitor_url')`; then `supabase functions deploy monitor`. Without the Vault secrets the hourly job does nothing ([`local-stack.md`](local-stack.md#the-hourly-monitor)). |
| Turn on Expo's enhanced push security (optional) | Pending | If enabled for the EAS project, Expo refuses pushes without an access token: create one in the Expo dashboard and `supabase secrets set EXPO_ACCESS_TOKEN=<token>` on the hosted project after the merge; `_shared/push.ts` then sends it as `authorization`. Never commit it. |
| Name Open-Meteo and Expo in the privacy policies | Pending (Wave 5) | Open-Meteo receives the coarse cell (one decimal, about 11 km) of users who share an area, and Expo's push service (with FCM and APNs behind it) receives each push token and the push's title, body and `{ url }`. Name both as processors when the privacy policy is written. |
| Include `signals` in `export-data` | Pending (Wave 5) | When the data export lands, it must include the user's `signals` rows (kind, cause key, local date, evidence, computed and pushed times). |
| Print `{{ .Token }}` in the hosted confirmation and recovery email templates | Pending | The app asks for a 6-digit code; the hosted project's templates must contain it, as `supabase/templates/confirmation.html` and `recovery.html` do locally ([`local-stack.md`](local-stack.md)). |

## Granting premium

No feature is premium yet; this is the mechanism. Run these on your machine against the project you mean to change.
The script needs the project's service-role key and URL in the shell (it refuses to run without the key, and never sends
a request in that case); without them it reads the local stack's values from `.env.local`.

```sh
export EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
pnpm premium grant person@example.com --note "beta tester" --until 2027-01-01
pnpm premium revoke person@example.com
```

`--note` and `--until` (a date, not in the past) are optional; without `--until` the grant has no end. `--until` ends at 23:59:59 UTC of that date: on UTC-3, `--until 2027-01-01` ends at 20:59 local time on 1 January. A grant without `--note` keeps the stored note; only the dashboard can clear it. The script prints the target host first, so check it before trusting the result. Each run prints the
entitlement row before and after as JSON. Revoking leaves any purchase untouched. The same change can be made by editing the
`granted` columns of the user's row in the dashboard's table editor.

The user can read their own entitlement row, `granted_note` included, so never put a private remark in the note.

## Live checks deferred until those steps are done

Google sign-in and Apple sign-in on a device, real email delivery of the codes, the first hosted
migration, every tracking RPC and `has_premium` against the hosted project, and `pnpm premium grant`
against it. For the companion: `pnpm calibrate eval` with the real keys, the deployed `companion` with its
secrets (the prompt cache with the fallback header, the 3 s database cap on a cold project), dictation on
a device (Android's Google recognizer, iOS on-device recognition), and the Maestro companion flow. For the forecast:
one real Open-Meteo call for a Bogotá and a São Paulo cell (the shape, 28 hours, GMT), the hosted `pg_cron` job
`prune-expired-caches` after the merge, the free tier's rate limits from Supabase's egress addresses, and the
commercial plan before the public listing. For the monitor: the hosted Vault secrets and `MONITOR_SECRET`, one
hosted run of the job in `cron.job_run_details` and its 200 in `net._http_response`, the run time on a real project, a real
push delivered inside the window and none outside it, receipts arriving after 15 minutes, and the hosted profiles' zones after
the migration's cleanup. The Maestro flows (`pnpm e2e`) run on the Android emulator against the local stack, and
on the iOS simulator once the iOS dev build exists; a preview build is made only after a merge. The
offline suites cover the logic around each ([`testing.md`](testing.md)).
