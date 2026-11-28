# Owner session for v1.0.0

The live session that takes Nimbo from this repository to a closed-testing build and the `v1.0.0` release. Everything
here needs the owner's accounts, a hosted project, a device or a merge; everything else runs offline
([`testing.md`](testing.md)). [`owner-runbook.md`](owner-runbook.md) keeps the standing decisions and the status of each
owner step, and links here for how to do it.

Work through the sections in order: each one needs the one before it. Every step has its command or action, the
condition that makes it pass, and a status. **Status words:** Done (with the date), Pending, Blocked (waiting on
someone else), Skipped (with the reason). Statuses are as of 2026-11-28.

**Rules for the whole session:**

- Nothing is deployed, pushed or built from an unmerged branch: migrations, functions and builds use merged `develop`.
- No key, secret or password goes into the chat, the repo, a commit or `.env.local`. Type secrets in the terminal with
  `read -s` or paste them into the provider's dashboard. A leaked secret is revoked and replaced, not just removed.
- **Set hosted function secrets from an empty directory.** With `supabase/config.toml` in the working directory, the
  Supabase CLI also pushes every `[edge_runtime.secrets]` value: the local fake keys and the mock URLs on
  `host.docker.internal`, which would send every hosted model, forecast and push call nowhere. Always:

  ```sh
  REPO=$PWD       # run from the repo root
  read -s VALUE   # type the secret, then Enter
  (cd "$(mktemp -d)" && "$REPO/node_modules/.bin/supabase" secrets set --project-ref <ref> NAME="$VALUE")
  ```

  Afterwards `secrets list` (from the same kind of empty directory) must show no `TYPESAFE_BASE_URL`,
  `ANTHROPIC_BASE_URL`, `OPEN_METEO_URL` or `EXPO_PUSH_URL`: with them unset the functions call the real hosts.
- The EAS CLI is not a dependency: run it as `pnpm dlx eas-cli@27 <command>`.

## 1. Before the session: accounts and answers

### Accounts

Create these before the session (the step-by-step list, in Spanish, is the owner's accounts checklist kept with the
planning documents). Public contact for every sender and form: `hello.aabv21@gmail.com`.

| Account | What to create | Pass when | Status |
|---|---|---|---|
| Supabase | Project `nimbo` in **South America (São Paulo), `sa-east-1`** (the region cannot change later); free plan; database password in the password manager | The dashboard shows the project in `sa-east-1` | Pending |
| Brevo | Account and an SMTP key for Nimbo only (`smtp-relay.brevo.com`, port 587) | The key exists; the sender `hello.aabv21@gmail.com` is verified | Pending |
| Google Cloud | Project `Nimbo`, OAuth consent screen in Production (name "Nimbo", support and contact `hello.aabv21@gmail.com`), a Web client and an iOS client (`com.aabv21.nimbo`); the Android client waits for the EAS SHA-1 ([§4](#4-eas-and-the-preview-apk)) | Both client ids are noted; the web client's secret is only in Supabase | Pending |
| Anthropic | A key named `nimbo` and a **monthly spend limit** on its workspace (US$ 20 to start) | The limit shows on the spend-limits page; the key is in the password manager only | Pending |
| TypeSafe | A key named `nimbo` for Jev (`jev-latest`); then a billing cap if the TypeSafe dashboard offers one. If it offers none, record that in [`audits/agent-guardrails.md`](audits/agent-guardrails.md) AG-11 and check the usage by hand each month instead | The key exists; the cap is set, or AG-11 records that none exists | Pending |
| Expo / EAS | The existing Expo account; nothing new until [§4](#4-eas-and-the-preview-apk) | `pnpm dlx eas-cli@27 whoami` names it | Pending |
| Firebase | Project `Nimbo` with an Android app `com.aabv21.nimbo`; `google-services.json` downloaded; an FCM V1 service-account key kept outside the repo | Both files exist on the owner's machine | Pending |
| Open-Meteo | Nothing now: the free API serves development and closed testing. The commercial plan comes before the public listing ([§10](#10-before-the-public-listing-not-v100)) | Nothing to check now | Pending (later) |
| Apple Developer | Optional; iOS is parked. Unlocks Sign in with Apple on a device, TestFlight and APNs | Nothing until iOS unparks | Pending (parked) |

### Pending owner answers

The code never depends on these. Each default below is what the repo assumes today; an answer that differs changes
only what the last column names. Answers 1–6, 8, 9, 11, 13 and 14 fill the policy placeholders ([§2](#2-the-privacy-policy)).

| Q | Question | Default | What changes if the answer differs |
|---|---|---|---|
| 1 | Controller legal name, country, address | `{{CONTROLLER_NAME}}`, `{{CONTROLLER_COUNTRY}}`; no postal address line | Fill the placeholders; an address adds one line in each of the three policy files |
| 2 | Encarregado (DPO) | The owner, `{{DPO_NAME}}`, contact `hello.aabv21@gmail.com` | Another name, or the small-agent channel wording: one sentence per file |
| 3 | Supabase region | `sa-east-1`, `{{DB_REGION}}` = "São Paulo, Brazil" | Another region: the placeholder and the transfers section |
| 4 | Launch countries | Latin America with Brazil; EEA, UK and Switzerland excluded in Play; `{{LAUNCH_COUNTRIES}}` | The EU included: an EU representative (GDPR art. 27) and GDPR sections; a Play distribution change, no code |
| 5 | Anthropic zero data retention | Standard terms: 30 days, flagged content up to 2 years, no training; `{{ANTHROPIC_RETENTION}}` | ZDR obtained: one sentence; no code |
| 6 | TypeSafe DPA, retention, region | "As long as reasonably necessary to provide the service", US; `{{TYPESAFE_RETENTION}}` | A stated period or a DPA: one sentence |
| 7 | Open-Meteo | Confirmed: free until the public listing | A provider switch: `supabase/functions/_shared/weather.ts`, its mock and the processors row |
| 8 | Owner backups | None beyond the hosting provider's; `{{BACKUPS}}` | Nightly encrypted copies: a lifetime sentence and an owner step; no code |
| 9 | Inactive accounts | Kept until the user deletes them; `{{INACTIVE_ACCOUNTS}}` | A period (for example 24 months with a warning): a cron job and an email sender later, a policy sentence now |
| 10a | The phone's chat in the export | Not included (`export.body` says so) | Included: the chat merged into the file in `usePrivacyActions` and `export.body` changed |
| 10b | `agent_notes` when the AI is turned off | Kept, visible and deletable in Profile | Deleted on AI off: one RPC call in the AI switch |
| 11 | Email provider and its log retention | Brevo; `{{EMAIL_PROVIDER}}`, `{{EMAIL_LOG_RETENTION}}` | Another provider: the placeholder and the SMTP step |
| 12 | Brazilian lawyer review | Before the **public** listing, not before closed testing | Earlier or never: only the step's position |
| 13 | Policy URL | `https://aabv21.github.io/nimbo-privacy/` (`es/`, `pt/`; deletion anchor `#delete-your-account`); `POLICY_BASE_URL` in `src/account/consent.ts`; `{{POLICY_URL}}` | Another URL: the constant and the placeholder |
| 14 | Auth audit log on deletion | Not purged; disclosed as sign-in security logs; `{{AUTH_LOG_RETENTION}}` | Purged: a `security definer` service-role RPC deleting the uid's `auth.audit_log_entries`, called by `delete-account` before the admin delete, plus a pgTAP test |

## 2. The privacy policy

The source of truth stays in this repo: [`privacy-policy.md`](privacy-policy.md), [`.es.md`](privacy-policy.es.md) and
[`.pt.md`](privacy-policy.pt.md). The published site is a copy.

**Placeholders.** Fill each in all three files, the Spanish and Portuguese values in their language. `pnpm policy:check`
lists what is left and exits 1 until nothing is.

| Placeholder | Q | Default text if the default answer stands |
|---|---|---|
| `{{CONTROLLER_NAME}}` | 1 | The owner's legal name |
| `{{CONTROLLER_COUNTRY}}` | 1 | The owner's country |
| `{{DPO_NAME}}` | 2 | Same as `{{CONTROLLER_NAME}}` |
| `{{DB_REGION}}` | 3 | São Paulo, Brazil |
| `{{LAUNCH_COUNTRIES}}` | 4 | Latin American countries listed in the store, Brazil included |
| `{{ANTHROPIC_RETENTION}}` | 5 | deletes inputs and outputs within 30 days; content flagged by its safety systems may be kept up to 2 years |
| `{{TYPESAFE_RETENTION}}` | 6 | keeps inputs as long as reasonably necessary to provide the service |
| `{{BACKUPS}}` | 8 | Nimbo keeps no backup copies of its own |
| `{{INACTIVE_ACCOUNTS}}` | 9 | Your account stays until you delete it |
| `{{EMAIL_PROVIDER}}` | 11 | Brevo |
| `{{EMAIL_LOG_RETENTION}}` | 11 | Read from the Brevo account |
| `{{AUTH_LOG_RETENTION}}` | 14 | Read from the hosted project ([§5](#hosted-database-and-security)) |
| `{{POLICY_URL}}` | 13 | https://aabv21.github.io/nimbo-privacy/ |

| Step | Command or action | Pass when | Status |
|---|---|---|---|
| 2.1 | Fill the 13 placeholders in a pull request into `develop` | `pnpm policy:check` exits 0; the gate passes | Pending |
| 2.2 | Create the public repo `aabv21/nimbo-privacy` with GitHub Pages on its default branch | The Pages URL answers | Pending |
| 2.3 | Publish the three files at `/`, `/es/` and `/pt/`, plus a `history/` page for earlier versions, with language links between them | Each page opens and shows the "Version" date `2026-12-01` | Pending |
| 2.4 | Open `…/#delete-your-account`, `…/#ai` and `…/#transfers` in each language | Each anchor lands on its section | Pending |
| 2.5 | Run the `webapp-security-auditor` and `web-design-guidelines` skills on the published site | Findings fixed in the Pages repo or recorded as accepted | Pending |

After any later policy change merges, copy the three files to the Pages repo again.

## 3. After the merges: the Supabase project

Once PRs #1–#5 are merged into `develop`, from an up-to-date `develop` checkout.

| Step | Command or action | Pass when | Status |
|---|---|---|---|
| 3.1 | `pnpm exec supabase login`, then `pnpm exec supabase link --project-ref <ref>` | `supabase projects list` marks the project linked | Pending |
| 3.2 | `pnpm exec supabase db push` | Every migration in `supabase/migrations/` applied, no error | Pending |
| 3.3 | Function secrets, each from an empty directory (above): `ANTHROPIC_API_KEY`, `TYPESAFE_API_KEY`, `MONITOR_SECRET` (one value from `openssl rand -hex 32`, 64 characters; under 32 the monitor refuses every run) | `secrets list` shows the three and none of the `*_BASE_URL`, `OPEN_METEO_URL` or `EXPO_PUSH_URL` names | Pending |
| 3.4 | The Vault, in the SQL editor: `select vault.create_secret('<the same MONITOR_SECRET>', 'monitor_secret');` and `select vault.create_secret('https://<ref>.supabase.co/functions/v1/monitor', 'monitor_url');` | `select name from vault.decrypted_secrets` lists both | Pending |
| 3.5 | `pnpm exec supabase functions deploy companion`, then `push-claim`, `push-unregister`, `export-data`, `delete-account` and `monitor` (one command each; `config.toml` sets each `verify_jwt`) | The dashboard lists six functions; `verify_jwt` is on for `companion`, `push-claim`, `export-data` and `delete-account` and off for `push-unregister` and `monitor` | Pending |
| 3.6 | Auth → Providers → Email: confirmations on, OTP length **6**, "Secure password change" on, minimum password length **8** with no character rules | The settings match `supabase/config.toml` | Pending |
| 3.7 | Auth → URL Configuration: Site URL `nimbo://` | Saved | Pending |
| 3.8 | Auth → SMTP: Brevo (`smtp-relay.brevo.com`, 587, the Nimbo key), sender name "Nimbo", sender `hello.aabv21@gmail.com`; then Auth → Rate limits: emails up to 30 per hour | A test sign-up's code arrives from Brevo | Pending |
| 3.9 | Auth → Email templates: paste `supabase/templates/confirmation.html` and `recovery.html` and the two `subject` lines from `config.toml` as they are (they branch on `.Data.locale`); if the subject field refuses the conditional, use "Nimbo: your code · tu código · seu código" | Sign-ups in en, es and pt each get the email and subject in their language, with the 6-digit code | Pending |
| 3.10 | Auth → Providers → Google: the web client id and secret, and the client ids comma-separated, web first, then iOS and Android | Google sign-in works on the preview APK ([§5](#auth-and-email)) | Pending |
| 3.11 | The keep-alive (`.github/workflows/keepalive.yml`): `gh variable set SUPABASE_URL --body https://<ref>.supabase.co` and `gh variable set SUPABASE_ANON_KEY --body <anon key>`. The workflow and its daily cron start only once `keepalive.yml` is on `main` ([11.5](#11-the-release)) | Both variables are listed by `gh variable list` | Pending |
| 3.12 | `select jobname, schedule, username from cron.job;` | `prune-expired-caches` at `17 * * * *` and `monitor` at `5 * * * *`, both `postgres` | Pending |
| 3.13 | The Security and Performance Advisors in the dashboard | No error-level finding, or each one recorded in [`audits/database.md`](audits/database.md) or [`audits/security.md`](audits/security.md) | Pending |

## 4. EAS and the preview APK

[`native-config.md`](native-config.md#eas-build-profiles-easjson) describes the three profiles in `eas.json`.

| Step | Command or action | Pass when | Status |
|---|---|---|---|
| 4.1 | `pnpm dlx eas-cli@27 login`, then `pnpm dlx eas-cli@27 init` in the repo; keep only `owner` and `extra.eas.projectId` from what it writes to `app.json`, in a pull request | `app.json` has both keys and nothing else new | Pending |
| 4.2 | EAS environment variables, plaintext (they are public): `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` for `preview` and `production` (`pnpm dlx eas-cli@27 env:set --name … --value … --visibility plaintext --environment preview --environment production`); the `development` environment gets the local stack's values from `.env.local` | `pnpm dlx eas-cli@27 env:list --environment preview` shows the four | Pending |
| 4.3 | `pnpm dlx eas-cli@27 build -p android --profile preview` from merged `develop` | The build finishes and the APK installs from its link | Pending |
| 4.4 | `pnpm dlx eas-cli@27 credentials` → Android → the SHA-1; create the Google **Android** OAuth client (`com.aabv21.nimbo` with that SHA-1) and add its id in Supabase (3.10) | Google sign-in on the APK does not answer `DEVELOPER_ERROR` | Pending |
| 4.5 | A pull request adds `google-services.json` at the repo root and `"googleServicesFile": "./google-services.json"` under `android` in `app.json`, together; `pnpm expo prebuild --clean` passes on it | The PR merges with CI green | Pending |
| 4.6 | Upload the FCM V1 key: `pnpm dlx eas-cli@27 credentials` → Android → `preview` and `production` → Google Service Account → FCM V1 → upload; then delete the downloaded key | expo.dev shows the key for both | Pending |
| 4.7 | Optional, recommended before the public listing: Expo's enhanced push security, then the function secret `EXPO_ACCESS_TOKEN` (from an empty directory) | A signal push still arrives | Pending |
| 4.8 | Rebuild the preview APK (4.3) with Firebase in place | Profile's notification switch no longer says "not available" | Pending |

## 5. Live checks

Every check that earlier work left for a live account or a device, grouped by what it needs. Run them on the preview
APK against the hosted project unless the line says otherwise.

### Auth and email

| Check | Pass when | Status |
|---|---|---|
| Email sign-up, confirm with the code, sign-in, password reset | Each code arrives through Brevo within a minute, in the sign-up language | Pending |
| Google sign-in on the APK; Apple sign-in once the Apple account exists | Both reach the consent screens | Pending |
| A session older than 24 hours changes the password | Supabase asks for the emailed nonce | Pending |
| The hosted Auth rate limits (sign-up, sign-in, OTP, refresh) | Each limit is set and a burst past it is refused | Pending |
| `verify_jwt` on the deployed functions: an expired, a wrong-key and a signed-out JWT against each of the four | The gateway or the function answers 401, never 200 | Pending |
| The gateway's CORS answer for `/functions/v1/*` | No `access-control-allow-origin` for an unknown origin beyond Supabase's own default | Pending |

### Consent and the policy on the phone

| Check | Pass when | Status |
|---|---|---|
| The boundary and AI screens with TalkBack (VoiceOver once iOS unparks) | The health header and checkbox are read with their state, the links as links, the `info` notice politely | Pending |
| A re-consent pass on the local stack: bump `TERMS_VERSION`, seed a newer `consent_texts` row | Boundary → Today, with the emergency call row; then an AI bump: Today with the AI paused, `/ai-consent` → Today; reminders back | Pending |
| The boundary screen's policy link and the AI screen's `#ai` link, in each language, once the policy is published ([§2](#2-the-privacy-policy)) | The browser opens the right page and section | Pending |
| The onboarding flow on a small screen (the emulator's smallest phone profile) | Its two `scrollUntilVisible` steps reach the health-data box and Continue | Pending |

### Tracking, sync and the phone

| Check | Pass when | Status |
|---|---|---|
| Every tracking RPC, `complete_onboarding` and `has_premium` against the hosted project; `pnpm premium grant` against it | Each write appears in the table; a forbidden call answers 401 or 403 | Pending |
| A cold start in airplane mode, logging, then reconnecting (also after more than 11 minutes offline) | The outbox drains with no tap and the banner clears | Pending |
| Killing the app mid-send, then reopening online | The operation is sent once | Pending |
| Sign-out, then sign-in again | The records leave the screens, then come back | Pending |
| A phone with data from an earlier build upgrading to this build | Rows and queue intact; a debrief syncs | Pending |
| `tel:` with and without a number on a phone with a SIM; the region on a Brazilian and a Colombian phone | The dialer opens with the region's number | Pending |
| Keep-awake in crisis mode; haptics; `transparentModal` keeping Today visible; urgent care after a long attack on a cold start | Each behaves as on the emulator | Pending |
| A reminder on Android 14 with the phone locked, after a reboot and after a time-zone change | Neutral text (the name with the detail on), a few minutes late at most | Pending |
| The location prompt (approximate only on both platforms) and the Android 13 notification prompt from the setup step | As in [`native-config.md`](native-config.md#permissions) | Pending |
| The date-time picker on iOS; the filter sheet over the tab bar | Usable in Day, Dark and Dim | Pending |
| `pnpm expo prebuild --clean` (writes the gitignored `android/`, then delete it) | The manifest has `allowBackup="false"` and no `ACCESS_FINE_LOCATION` | Pending |

### Companion (Anthropic and TypeSafe)

| Check | Pass when | Status |
|---|---|---|
| A real Sonnet 5.5 conversation in en, es and pt, with an insight ref | Replies in the language, no percentage or cause; `cache_read_input_tokens` above 0 from round 2; the fallback header accepted; within the 45 s wait | Pending |
| A real Jev call and a real Haiku 5.5 fallback call | 2xx with the shapes the mocks reproduce; 400 tokens are enough for the booleans | Pending |
| `consume_quota` on the hosted project | The service role can execute it; `authenticated` and `anon` get 42501 | Pending |
| The 3 s database cap on a cold project | The function answers within its caps | Pending |
| Dictation: Android with and without the offline pack (es-CO, pt-BR, en-US), iOS on-device | A transcript appears; without the pack the audio goes to Google's recognizer as the policy says | Pending |
| "What I know about you" lists, deletes and (offline) shows the cached notes; after sign-out its kv key is gone | As described | Pending |
| The debrief the morning after an attack in another time zone | It appears once, on the right day | Pending |

### Forecast and the monitor (Open-Meteo, Expo push, Firebase)

| Check | Pass when | Status |
|---|---|---|
| One real Open-Meteo call for a Bogotá cell (`4.6,-74.1`) and a São Paulo cell (`-23.5,-46.6`) | 28 hours, `timezone: GMT`, the shape `parsePressure` accepts | Pending |
| One hosted run of the `monitor` job | A row in `cron.job_run_details` and a 200 in `net._http_response` | Pending |
| The run time on the real project, and the prune's run time in `cron.job_run_details` | Under the 110 s budget; the prune well under a minute | Pending |
| A real push inside the notification window, none outside it; receipts after 15 minutes | As described | Pending |
| A real Expo token on the APK, the `signals` channel before the Android 13 prompt, a `push-claim` round trip between two accounts, a tap from a cold start | A row in `push_tokens`; the tap opens Today | Pending |
| The lock screen with and without the detail opt-in | Neutral without it, detailed with it | Pending |
| The hosted profiles' zones after the monitor migration's cleanup | Every zone is one `is_time_zone` accepts | Pending |
| Open-Meteo's free-tier limits from Supabase's shared egress addresses | No 429 over a day of hourly runs | Pending |

### Export and deletion

| Check | Pass when | Status |
|---|---|---|
| Export a real account (email and Google) | Every section is present, no push token, `account.providers` right | Pending |
| The share sheet on Android with the real file (Drive, Gmail, Files), and on iOS (`public.json`) without the `expo-sharing` plugin | The file arrives whole in each target | Pending |
| Delete a test account | Auth shows it gone, the 14 user tables hold no row of it, a retry answers `deleted` | Pending |
| A deletion with the network cut after the request leaves, then a relaunch | The marker survives, nothing is sent, and the purge finishes (`gone`), or the marker clears 10 minutes later if the account still exists | Pending |
| The hosted `prune-expired-caches` | `usage_counters` rows over 30 days old are gone | Pending |

### Hosted database and security

| Check | Pass when | Status |
|---|---|---|
| Whether the hosted project writes `auth.audit_log_entries`, and its retention | The period is known and fills `{{AUTH_LOG_RETENTION}}` | Pending |
| The hosted PostgREST `max_rows` | Recorded (the export pages under any cap) | Pending |
| `pg_stat_user_indexes` after a week of traffic | No index on a hot path with zero scans that the audit expected used | Pending |
| CI green on three consecutive pushes | No timing failure on GitHub's runners | Pending |

### Accessibility and motion on devices

| Check | Pass when | Status |
|---|---|---|
| TalkBack (VoiceOver once iOS unparks) through onboarding, crisis mode, the companion, export and delete | Names, roles, states and reading order right (the head map included); errors spoken once; standing notices read in their turn | Pending |
| Font scale 200 % on those screens plus Today, History (list, calendar, Patterns) and Profile | Nothing truncated or clipped; chips wrap; tab labels shrink to one line; the last row scrolls clear of the tab bar | Pending |
| Reduce motion on (the OS setting, then the in-app switch) | Every change a 150 ms cross-fade; nothing moves or staggers | Pending |

## 6. Calibration

With both keys in this shell only (`read -s` then `export`), never in `.env.local`:

| Step | Command | Pass when | Status |
|---|---|---|---|
| 6.1 | `pnpm calibrate eval --locale all` (Jev) | Zero misses on the unsafe replies, the red-flag `positives` and the `modelOnly` texts, including the new jailbreak, injection and evasion cases and the reworded `dose_advice` and `medication_change` questions | Pending |
| 6.2 | `pnpm calibrate eval --locale all --layer claude` (the Haiku fallback) | The same | Pending |
| 6.3 | Apply the rule: a threshold goes up only while every positive is still caught; record the results and any threshold change in [`ai.md`](ai.md#calibration) in a pull request | The PR merges with the gate green | Pending |

## 7. Maestro

On the local stack, with the mocks serving ([`testing.md`](testing.md#end-to-end-flows-maestro)). The dev build must be
rebuilt first, since `expo-file-system` and `expo-sharing` are native.

| Step | Command | Pass when | Status |
|---|---|---|---|
| 7.1 | `pnpm db:start && pnpm env:local`, the two mocks in their terminals, `pnpm android` on the emulator, then `pnpm e2e` | All five flows pass: `onboarding`, `crisis`, `red-flag`, `companion-draft`, `privacy` | Pending |
| 7.2 | An iOS dev build on the simulator (`pnpm ios` on a Mac with Xcode, or the `development` profile's simulator build), then `E2E_PLATFORM=ios pnpm e2e` | The same five pass | Pending |

## 8. The mid-range Android check

On the preview APK, on a phone of the class 4 GB RAM with a Snapdragon 6-series or a Helio G8x. Turn on Developer
options → "Profile HWUI rendering" (or read `adb shell dumpsys gfxinfo com.aabv21.nimbo`) and the Perf Monitor.

| Check | Pass when | Status |
|---|---|---|
| The crisis countdown's minute cross-fade, crisis mode opening and closing over Day (the 600 ms fade), the Dim transition | No visible dropped frames | Pending |
| Today's first render and its row stagger, and Today across a minute tick | No visible dropped frames | Pending |
| History scrolled fast through more than 200 attacks; the chat list over 200 messages | No visible dropped frames, no blank rows | Pending |
| The same with reduce motion on and off, with TalkBack on, and at font scale 200 % | Still smooth; nothing clipped | Pending |
| Cold start to Today, and the APK's Hermes bundle size | Recorded in [`audits/react-native-performance.md`](audits/react-native-performance.md) | Pending |

## 9. Play Console

| Step | Action | Pass when | Status |
|---|---|---|---|
| 9.1 | Create the app (`com.aabv21.nimbo`); a Google service account key for `eas submit` uploaded to EAS, never committed | The app exists | Pending |
| 9.2 | Store listing: the description carries the line that Nimbo is not a medical device and does not diagnose or prescribe | Saved | Pending |
| 9.3 | Privacy policy URL `https://aabv21.github.io/nimbo-privacy/` | Saved | Pending |
| 9.4 | The Health apps declaration | Submitted | Pending |
| 9.5 | Data safety, answered from the policy's "What Nimbo collects" and "Who processes your data" sections (health data, the email address, the approximate area; encrypted in transit; deletion offered in the app and at the URL below) | Submitted | Pending |
| 9.6 | Account deletion URL `https://aabv21.github.io/nimbo-privacy/#delete-your-account` | Saved | Pending |
| 9.7 | `pnpm dlx eas-cli@27 build -p android --profile production`, then the first AAB uploaded by hand to the closed-testing track (later ones with `eas submit --profile production`, track `alpha`) | The release is in review | Pending |
| 9.8 | Countries: the launch countries of Q4; EEA, UK and Switzerland excluded | The country list matches the policy's `{{LAUNCH_COUNTRIES}}` | Pending |

## 10. Before the public listing (not v1.0.0)

| Item | Pass when | Status |
|---|---|---|
| A Brazilian data-protection lawyer reviews the Portuguese policy (legal bases, art. 20, art. 33 VIII, the encarregado) and whether Mexico needs the postal address (Q12) | Changes merged in all three files | Pending |
| Open-Meteo's commercial API Standard plan, then `OPEN_METEO_URL=https://customer-api.open-meteo.com` and `OPEN_METEO_API_KEY` as function secrets and a redeploy of `monitor`, or a provider switch | A forecast call with the key answers 200 | Pending |
| A captcha on sign-up and an overall spend budget for the AI beyond the per-user quotas | Both in place | Pending |
| The recent sign-in check before deletion ([`audits/security.md`](audits/security.md) SEC-13) | `delete-account` answers `reauth_required` for a session over 10 minutes old, and the app asks to sign in again | Pending |
| The password minimum decision (SEC-17) | Decided and, if raised, changed in the hosted setting, `config.toml` and the three catalogs | Pending |
| The emergency number for each launch country, and the notification texts review | As in [`owner-runbook.md`](owner-runbook.md#steps) | Pending |
| Embed the fonts with the `expo-font` config plugin ([`audits/react-native-performance.md`](audits/react-native-performance.md) RNP-10): add the plugin with the six faces to `app.json`, `pnpm expo prebuild --clean`, rebuild, and compare cold start to Today before and after on the mid-range phone ([§8](#8-the-mid-range-android-check)) | Cold start is no slower, and the fonts render without the runtime load; RNP-10 updated | Pending |
| **Before iOS:** the backup exclusion of `Documents/SQLite` (Apple 5.1.3, SEC-12) | A device backup no longer lists the databases ([`native-config.md`](native-config.md#ios-backup-apple-513)) | Blocked (iOS parked) |

## 11. The release

After every pull request of the waves (PRs #1–#5) has merged into `develop`. `main` takes changes only from a
`release/` branch; do not stack pull requests.

| Step | Command or action | Pass when | Status |
|---|---|---|---|
| 11.1 | `git fetch origin && git switch -c release/v1.0.0 origin/develop && git push -u origin release/v1.0.0` (`package.json` and `app.json` already say `1.0.0`) | The branch is on GitHub | Pending |
| 11.2 | `gh pr create --base main --head release/v1.0.0 --title "release: v1.0.0"`, with assignee `aabv21`, label `release`, the milestone, the Portfolio project and `Closes #…` for the wave issues | CI green on the PR | Pending |
| 11.3 | The owner merges it in the GitHub UI **with a merge commit** | `release.yml` runs | Pending |
| 11.4 | `gh release view v1.0.0` and `git ls-remote --tags origin v1.0.0` | The tag points at the merge commit and the release page has its notes | Pending |
| 11.5 | `gh workflow run keepalive.yml` (the daily ping starts with the release, once the workflow is on `main`), then `gh run list --workflow keepalive.yml --limit 1` | The run succeeds and calls `keep_alive()`, not the "aren't set" notice | Pending |
