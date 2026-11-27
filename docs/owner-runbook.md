# Owner runbook

The steps that need the owner's accounts or hardware, each with its status. Everything else in this
repo runs offline ([`testing.md`](testing.md)). Statuses are as of 2026-11-26; update a step's status
and date when it changes.

**Status words:** Done, Pending (not started or not finished), Blocked (waiting on someone else).

## Decisions on record

- **The app identity is final:** display name "Nimbo", slug `nimbo-app`, scheme `nimbo`, bundle id
  and Android package `com.aabv21.nimbo`.
- **Nothing is deployed before the owner merges:** migrations, functions and builds go to a hosted
  project only from merged code.

## Steps

| Step | Status | Notes |
|---|---|---|
| Make the repository public and turn on the rulesets | Done, 2026-11-26 | Rulesets on `main`, `develop` and `v*` tags require Quality, Security, Actions, Database and Analyze; private vulnerability reporting is on. |
| Create the Supabase project in an Americas region | Pending | The data is health-related, so pick the region before creating it; it cannot be moved later. Then link it, push the migrations after a merge and schedule the daily `keep_alive()` call. |
| Create the Google OAuth clients | Pending | One web client for Supabase and the native iOS and Android clients; put the client ids in `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` and the web client in Supabase Auth. Until both ids are set the sign-in screens show no Google button. |
| Add the Google Sign-In config plugin | Pending | After the OAuth clients exist: add `["@react-native-google-signin/google-signin", { "iosUrlScheme": "com.googleusercontent.apps.<ios-client-id>" }]` to `app.json`'s `plugins`, with Nimbo's iOS client id reversed as the URL scheme, then `pnpm expo prebuild --clean` and a rebuild ([`native-config.md`](native-config.md)). |
| Create the EAS project | Pending | Sets `owner` and `extra.eas.projectId` in `app.json`; builds are made only from merged code. |
| Enroll in the Apple Developer Program | Pending | Needed for Sign in with Apple on a device and for TestFlight. |
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

## Live checks deferred until those steps are done

Google sign-in and Apple sign-in on a device, real email delivery of the codes, and the first
hosted migration, and `pnpm premium grant` against the hosted project. The offline suites cover the logic around each ([`testing.md`](testing.md)).
