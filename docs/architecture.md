# How Nimbo works

This page covers where Nimbo runs, what each part does, how the app decides which screen to show,
how consent is recorded, how it starts offline, how health data is kept and synced offline, crisis mode,
the red-flag paths, the companion and its guards, the overuse guard, the insights, the signals and the hourly monitor,
Today's companion note, the weather, push notifications, reminders, premium, the security model, the reasons behind the design choices, and how to regenerate the diagrams. Parts that later waves
add are drawn as planned and marked that way.

![System context: the Expo app keeps nimbo.db, the outbox and the chat on the phone, and talks to the Supabase project's Auth, its REST API and its Edge Functions (companion, push-claim, push-unregister) with the user's token, and to Apple and Google for native sign-in; companion reads the caller's rows with the caller's JWT and calls Anthropic for the tool loop and the fallback screen and TypeSafe's Jev for the screens; Postgres runs pg_cron, pg_net and the Vault, and its hourly job calls the monitor function with a Vault secret; monitor reads the pressure forecast for a coarse cell from Open-Meteo and sends neutral pushes through Expo push, which delivers them to the app over FCM and APNs; the email relay and a GitHub Actions keep-alive call are planned](diagrams/system-context.svg)

System context: [interactive page](diagrams/system-context.html) · [source](diagrams/system-context.json)

The diagram tool [archify](https://github.com/tt-a1i/archify) generates the six diagrams on this
page from their JSON sources; [Regenerating the diagrams](#regenerating-the-diagrams) shows how.
Each interactive page adds search, focus and both color themes; open it in a browser.

## What the system does and where it runs

Nimbo is a migraine companion: log attacks, spot patterns and get calm guidance in English, Spanish
or Portuguese. It is not a medical device and never diagnoses or prescribes.

- **The phone.** An Expo SDK 58 app (React Native, strict TypeScript, Expo Router) for iOS and
  Android. It keeps the session and the last profile in an on-device key-value store, and the user's
  health records in a local SQLite database, so it opens and logs offline.
- **One Supabase project.** Auth, Postgres 17 with row-level security, and the `companion` Edge Function.
  Today only the local stack in Docker exists (`pnpm db:start`, [`local-stack.md`](local-stack.md)); no
  hosted project is set up yet ([`owner-runbook.md`](owner-runbook.md)). The phone holds only the project
  URL and the anon key, both public by design; every request carries the user's session token.
- **The model providers.** Anthropic (Claude Sonnet 5.5 converses, Claude Haiku 5.5 is the fallback
  classifier) and TypeSafe (Jev screens every message and reply), called only from the `companion`
  function, never from the phone. Locally they are mocks on the host ([`local-stack.md`](local-stack.md#mocks)).
- **The forecast provider.** Open-Meteo's forecast API gives the hourly sea-level pressure for a coarse
  cell, fetched by the `monitor` function only and cached in `weather_cache` ([Weather](#weather)). Locally it is a
  mock on the host.
- **The push service.** Expo's push service sends the monitor's pushes on to FCM (Android) and APNs (iOS)
  ([Push notifications](#push-notifications)). Locally it is a mock on the host.
- **Planned services.** An email relay for the hosted project and a daily GitHub Actions call to
  `keep_alive()` so a free project is not paused.

## What each component does

| Component | Runs | What it does |
|---|---|---|
| Expo app | Phone | Routes in `src/app/`, gated by account state; the three themes; the tab shell, crisis mode, the cabinet, the check-in, History and the Companion tab ([`app.md`](app.md)). |
| Local store and outbox | Phone | `nimbo.db`: mirrors of the four tracking tables, which every screen reads, the queue of RPC calls that carries each change to the server, and the companion chat, kept only on this phone ([Health data offline](#health-data-offline)). |
| Local reminders | Phone | Preventive medication reminders scheduled on the phone, with no server ([Reminders and lock-screen privacy](#reminders-and-lock-screen-privacy)). |
| Auth | Supabase | Email and password with a 6-digit email code to confirm and to reset, and Sign in with Apple and Google through native ID tokens. |
| Postgres 17 | Supabase | The `profiles` table with RLS and column grants, the signup trigger, the consent RPCs with `consent_texts` and `consent_events`, the tracking tables `episodes`, `medications`, `doses` and `checkins` (with the debrief columns), `entitlements`, `agent_notes` and `usage_counters` ([`database.md`](database.md)). |
| `accept_terms`, `set_ai_consent`, `complete_onboarding` | Postgres | The only writers of the consent columns, the consent versions and history, and the onboarding stamp; they stamp the server clock. |
| Tracking RPCs | Postgres | The nine `security definer` writers of the tracking tables (`set_dose_helped` included), called only through the outbox; a create ignores an id it already has ([`database.md`](database.md#tracking-rpcs)). |
| `save_agent_note`, `delete_agent_note` | Postgres | The only writers of the agent's notes, at most 20 per user ([`database.md`](database.md#companion-data)). |
| `consume_quota` | Postgres | Spends one AI unit per user, local day and kind; only the service role may call it ([`database.md`](database.md#ai-quotas)). |
| `has_premium` | Postgres | Whether the caller has premium, from their own `entitlements` row ([Premium](#premium)). |
| `keep_alive` | Postgres | A no-op the anon key may call. |
| Condition pack | Shared code | The migraine catalogs, medication classes, overuse limits, red flags, emergency numbers, dose days and the crisis plan, in `supabase/functions/_shared/condition/`, imported by the app and the functions. |
| `companion` | Edge Function | One chat message: the input screen, the quota, a bounded Claude tool loop over the caller's own rows and the reply screen ([The companion](#the-companion)). |
| `push-claim`, `push-unregister` | Edge Functions | Reclaim a push token another account holds, by a code pushed to it; forget a token after a sign-out, with the device secret ([Push notifications](#push-notifications)). |
| `export-data`, `delete-account` | Edge Functions | Answer everything the server keeps about the caller as one JSON file, read with their token (the service role only for `usage_counters`); delete the caller's auth user, whose cascade removes every row of theirs ([`api.md`](api.md#export-data), [`database.md`](database.md#account-deletion-and-export)). |
| `monitor` | Edge Function | Every hour, from `pg_cron`: Expo's receipts, then each user's signals computed, stored and at most one neutral push sent ([Signals and the monitor](#signals-and-the-monitor)). |
| Insights and signal rules | Shared code | `_shared/insights.ts` and `_shared/signals.ts`, pure, run on the phone over the mirror and on the server over `record_inputs` ([Insights](#insights)). |
| Open-Meteo, Expo push | External | The pressure forecast and the push relay to FCM and APNs, called only by `monitor` (and `push-claim` for its code push). |
| Anthropic, TypeSafe | External | Claude Sonnet 5.5 and Haiku 5.5, and Jev, called only by `companion` with the function's secrets ([`ai.md`](ai.md)). |
| Email relay, keep-alive workflow | Planned | Not built yet. |

## Data model

![Data model: the signup trigger inserts a profiles row for each auth.users row, whose zone a trigger checks; the app updates thirteen settings columns of profiles directly and records consent and the end of onboarding only through the profile RPCs, which stamp the server time; it writes episodes, doses, medications and checkins only through the nine tracking RPCs that the outbox calls, set_dose_helped included, where a dose references its medication and loses its episode when the episode is deleted; has_premium reads the caller's own entitlements row; the note RPCs write agent_notes; the companion function spends AI units through consume_quota, the only writer of usage_counters; the push token RPCs write push_tokens and its claims (push_claims, push_claim_starts); pg_cron calls monitor with the Vault secret, and monitor reads weather_cache by cell and the records through record_inputs, and through the monitor RPCs upserts and claims signals and queues push_tickets; prune_expired_caches deletes old tickets, signals and cached forecasts daily](diagrams/data-model.svg)

Data model: [interactive page](diagrams/data-model.html) · [source](diagrams/data-model.json)

One `profiles` row per auth user, created by the `handle_new_user()` trigger and deleted with the
user. The client updates its settings columns directly: the language, appearance and notification
settings, `known_triggers` (keys of the triggers catalog), `priority` (one of `fewer`, `triggers`,
`overuse` and `logging`), `track_period` (the period question in the check-in, off by default) and a
coarse area, `coarse_lat` and `coarse_lon` at one decimal (about 11 km). The app writes the area and never
reads it back. The tracking tables `episodes`, `medications`, `doses` and `checkins` and the
`entitlements` table have a read-own policy and no client write grant: every health row is written by a
tracking RPC, and only the service role writes an entitlement. The debrief lives on the tracking tables:
`episodes.helped` and `did_not_help` (relief keys), `debriefed_at` (stamped by `update_episode`'s `debriefed`
key), and `doses.helped` (set by `set_dose_helped`). `agent_notes` holds the agent's short notes about how the
user likes things, written only by `save_agent_note` and `delete_agent_note`. `usage_counters` holds the daily
AI units; it has no policy and no grant, so only `consume_quota`, called by the function's service role, touches
it. This wave adds `signals` (one row per user and cause key, read by its owner, written only by the monitor),
`push_tokens` (written only through `register_push_token` with the device secret, with `push_claims` and
`push_claim_starts` behind `push-claim`), and the server-only `weather_cache` and `push_tickets`. `record_inputs`
reads a user's records for the rules, and `profiles_check_timezone` refuses a zone `private.is_time_zone` does not
know. The columns, policies, grants and RPC contracts are in [`database.md`](database.md).

## Sign-in and the gate

![Gate flow: on launch the stored session and cached profile feed nextRoute, which sends the app to the loading view (retry or sign out) when the profile is unknown, to the intro on a phone that never showed it and then to the sign-in group, to the boundary and AI consent screens while either is unanswered, then through the setup steps, whose last step queues complete_onboarding in the outbox and stamps the profile on the phone, and to Today once everything is answered](diagrams/gate-flow.svg)

Gate flow: [interactive page](diagrams/gate-flow.html) · [source](diagrams/gate-flow.json)

`nextRoute(auth, device)` in `src/auth/gate.ts` is a pure function of the auth status, the profile and
whether this phone has shown the intro (`intro.seen` in the kv store, `src/onboarding/introSeen.ts`). It
returns one of seven routes:

| Account state | Route |
|---|---|
| Status `loading`, or signed in with no readable profile | `/loading` |
| Signed out on a phone that never showed the intro | `/intro` |
| Signed out | `/sign-in` |
| `adultConfirmedAt` or `boundaryAcceptedAt` is null, or `termsVersion` is null or older than `TERMS_VERSION` | `/welcome/boundary` |
| `aiConsentAnsweredAt` is null, or before onboarding ends the AI is on and `aiConsentVersion` is null or older than `AI_CONSENT_VERSION` | `/welcome/ai-consent` |
| `onboardingCompletedAt` is null (the setup steps) | `/welcome/triggers` |
| Everything answered | `/today` |

The five setup steps (triggers, priority, medications, notifications, location) are registered together
under `/welcome/triggers`, with the cabinet form for the medications step; the last step calls
`completeOnboarding`, which stamps the profile on the phone and queues `complete_onboarding` in the outbox, so the
user moves to Today even offline (`app.md`, local store and outbox). A profile cached by a build from
before the setup steps (both gates answered, no `onboardingCompletedAt`) runs them once; it never lands on
the loading view.

The root layout calls it and registers only the allowed screens with `Stack.Protected`, so a deep
link to a screen the user may not reach never mounts it; `src/app/index.tsx` forwards the landing
route to the allowed one. While the answer is `/loading` the layout shows a loading view instead of
the stack; once signed in it offers Try again and Sign out, so a profile that can never be read
(no row, or a row this build cannot parse) is not a dead end. `src/app/welcome/_layout.tsx` repeats the guard for
its screens, sends a screen that stops being due to the one that is, and turns off the back gesture: the two gates are
answered, not skipped, and each setup step moves on with its own buttons.

An unreadable profile is not an unanswered consent, so a signed-in user whose profile cannot be
read stays on loading and never sees the consent screens.

Versions are dates and compare as text (`needsTermsConsent` and `needsAiReconsent` in `src/account/consent.ts`); a
stored version newer than the build's (accepted on a newer build) is never asked again, and the server refuses to
record an older one. The two kinds are asked again differently:

- **Terms** stay a gate for everyone, onboarded or not: a newer terms text sends the user to the boundary screen
  before anything else. Accepting needs the network, so the first launch after a terms bump needs a connection once;
  until then no other screen is registered, urgent care and the free-text fields that lead to it included, so the
  boundary screen itself shows an emergency call row (the region's number, as urgent care dials it) while it asks
  again. A first-time boundary does not: no access the user had is behind it.
- **AI**, once onboarding is done, is never a gate, so it cannot lock anyone out offline. While a newer AI text awaits
  an answer the AI is off on the phone (`aiActive`): Today, crisis mode and dictation behave as with the AI off; the
  Companion tab, Today's AI card and Profile say it is paused and open the same consent screen at `/ai-consent`, a
  route registered only while that answer is due. Profile's switch keeps showing the stored answer, so a withdrawal
  works at any time, and the server always accepts one, even under an older text. A user with the
  AI off answers no new AI text: nothing is shared with the AI providers.

The `companion` function checks only `ai_enabled`; the version is enforced in the app, which sends nothing to it while
an AI re-consent is pending.

The sign-up path: sign up, then the code screen (`confirm-email`). Signing in with an unconfirmed
address leads to the same screen, which then says no code is on its way yet and leads with sending one. A password reset uses the `reset` screen
with its own code.

## The consent model

Two consents are recorded on the profile. The boundary screen's terms consent has three required boxes: 18 or
older, not a medical device, and storing health data. The health-data box sits apart under its own header, because
health data is sensitive data that needs specific, highlighted consent (LGPD art. 11), and the screen links to the
privacy policy (`policyUrl(locale)`, opened in the browser). `accept_terms` stamps the answer. The AI consent
(`set_ai_consent`) stores the answer apart from the question having been asked, so a "no" is remembered and not asked
again; its screen names the processors and the transfer to the United States and links to the policy's AI section, and
the notifications step says that a push goes through Expo and Google in the United States.

Each answer carries the version of the text the user read and the app's language. The server refuses a version it has
not published (`consent_texts`), keeps the version on the profile (`terms_version`, `ai_consent_version`), sets the
terms stamps again when the version changes, and appends every answer, the Profile switch's included, to
`consent_events`: the profile keeps only the latest answer, the history proves each one (LGPD art. 8). The version
strings live in `src/account/consent.ts`; the tables and contracts are in [`database.md`](database.md#consent-versions).
The policy itself is [`privacy-policy.md`](privacy-policy.md) (with [`.es.md`](privacy-policy.es.md) and
[`.pt.md`](privacy-policy.pt.md)); its "Version" date is `TERMS_VERSION`, and its section anchors include every
`PolicySection` the app links to, which `scripts/__tests__/policy-check.test.ts` and `pnpm policy:check` check.
A boundary screen opened for a newer text says so above the boxes (`boundary.updated`). Declining AI leaves the app complete: `visibleTabs` in `src/profile/tabs.ts` drops the
Companion tab, and the Profile switch can turn it on later.

Consent is RPC-only because a column the client can update is a column a hand-made request can set:
a user could stamp their own timestamps, skip the gate or claim consent they never gave. The
consent columns have no `update` grant, the two functions are `security definer` with an empty
`search_path`, and they use the server clock. The pgTAP suite and the integration suite both try
the forbidden writes ([`testing.md`](testing.md)).

## Offline start

`AuthProvider` builds its first state synchronously from the stored session and the cached profile
(`readStoredSession`, `readCachedProfileSync`), so a launch with no network, or a slow one, reaches
the tabs without waiting for Supabase's own session check. Offline with an expired token, supabase-js
reports a null session at `INITIAL_SESSION` while keeping it; the provider reads the stored session
instead and stays signed in until a real `SIGNED_OUT`. A failed profile read keeps the cached
profile, and with none the status still leaves `loading` (the view offers Try again and Sign out). A
profile cached by an older build, without `knownTriggers`, `priority` or `trackPeriod`, reads them as
their defaults, so an upgraded phone opened offline still reaches its screen. One cached without the consent versions
reads them as null, so it reaches the boundary screen to accept the versioned terms (online) instead of the loading view. A failed launch read is
retried when the app resumes or the network returns (`useOnResume`). Every request has a timeout
(`fetchWithTimeout`), so a dead connection does not hold a spinner. Health records open offline from
the local store ([Health data offline](#health-data-offline)).

## Health data offline

![Crisis logging: tapping Start an attack writes the episode row and its log_episode call to nimbo.db in one transaction, and crisis mode opens with only the id; intensity and doses are written the same way. The enqueue wakes SyncProvider, which claims the next call, sends it to log_episode (an insert that ignores an id it already has) and marks the row clean once it succeeds, then reads the user's rows a thousand at a time and replaces only the clean local ones](diagrams/crisis-logging.svg)

Crisis logging: [interactive page](diagrams/crisis-logging.html) · [source](diagrams/crisis-logging.json)

Health data is local first, so an attack can be logged with no signal and a kill right after the tap
loses nothing. The modules are in [`app.md`](app.md#local-store-outbox-and-sync-srcliblocal-srcliboutbox-srclibsync).

- **Mirrors.** `nimbo.db` holds `episodes`, `medications`, `doses` and `checkins` with the server's
  columns, each row with its `user_id` and a `dirty` flag. Every screen reads from here, filtered by the
  signed-in user, never from the network. The schema is versioned (`PRAGMA user_version`, now 3); an update
  runs the steps a phone is missing in one transaction, keeping its rows and its unsent calls.
- **The companion chat.** `chat_messages` holds the conversation as health text kept only on this phone: it
  is never queued or synced, and only its last 200 messages per user are kept.
- **One transaction per change.** A screen writes the mirror row and queues the RPC call that makes the
  same change on the server in one SQLite transaction, so the two never disagree. A change that spans
  stores (a debrief, a confirmed draft) uses each store's `…Tx` writer inside one transaction, since
  expo-sqlite's transactions do not nest. A store refuses with a `RangeError`, before writing, any value the
  server would refuse for good, so a queued call never fails for its content. The ids are made on the
  phone and every create RPC ignores an id it already has, so a call replayed after a lost response
  never makes a second row.
- **The outbox.** It has ten kinds: the nine tracking RPCs (`log_episode`, `update_episode`,
  `end_episode`, `delete_episode`, `save_medication`, `log_dose`, `delete_dose`, `set_dose_helped`,
  `save_checkin`) and `complete_onboarding`. Calls go out one at a time, in the order they were made. A retryable failure
  stops the pass, so nothing overtakes it; a permanent one, or the 8th answered attempt, marks the call
  failed and the pass goes on. A send with no answer gives the attempt back, so time offline never
  fails a call. The wait between attempts doubles from 5 s up to 10 min. A failed call is sent again
  only when the user taps Try again on the sync notice. A call is never sent while the session belongs
  to another account.
- **Dirty rows.** A row stays dirty while any call for it is unsent or failed, and the pull never
  overwrites it, so a local change is never undone by an older server copy.
- **The full pull.** After each push, `pullAll` reads every row of the user, table by table, a thousand
  rows a page, and writes them in one transaction: it replaces clean rows, keeps dirty rows and rows
  with an unsent delete, and deletes clean rows the server no longer has. Reading everything is simple
  and always converges. Its ceiling is a few thousand rows per user; past that, the upgrade is an
  incremental pull on `updated_at` with tombstones.
- **When it syncs.** On sign-in, on resume, when the network returns, after every queued call, and when
  the head of the queue's wait ends. Cycles never overlap. When the network returns, an operation that is
  waiting only because its sends got no answer is due at once, so a reconnect never waits out a backoff
  the lost connection caused; one held back by a server error keeps its wait.
- **Two accounts on one phone.** On sign-out or an account switch the previous user's queue is paused
  and, once no send or pull can still write them, their rows are deleted except those still waiting to be
  sent (dirty, or with an unsent or failed call), which stay until that user signs back in; the pull
  brings the rest back then. Their chat, the cached agent notes (kv `memory.<userId>`) and the debriefs marked done (kv `debrief.done.<userId>`) are deleted in full whatever is queued, since nothing waits on them. The cached profile goes with them once nothing of theirs is queued. Signing
  out from Profile with records not uploaded asks first, saying how many stay on this phone. At launch the kv keys of
  any account but the signed-in one with nothing queued are swept too: every key an account owns carries its id.
- **An account deletion cut in half.** The phone marks the deletion before calling `delete-account` and sends or
  pulls nothing while the marker is there, so a lost answer is checked at the next launch, resume or reconnect, never
  forgotten; once the account is gone it drops every row, kv key and export file of it and refuses later kv writes and
  pulls for that id for the rest of the process, so a late answer can't bring anything back
  ([`app.md`](app.md#account-deletion-on-the-phone)).
- **Onboarding offline.** The last setup step queues `complete_onboarding` and stamps the profile on
  the phone, so the gate opens Today at once; the server stamp arrives with the next sync.

## Crisis mode

Today's Start an attack writes the attack before crisis mode opens, and the route carries only its id.
Crisis mode is a transparent modal over the screen it came from. It forces the Dim theme while it is
open, keeps the screen awake, and uses 56 pt controls. It logs the intensity (0 to 10, unset until the
first tap), symptoms, pain areas on a head map, and a dose per acute medication, with the countdown to
the next one from the interval the user entered. "It's over" asks for the end, which defaults to now
and can be typed; the ended view shows what was recorded. Hide leaves the attack open. Android's back
button runs the same fade as Hide (closing the head map or the end question first), so leaving never cuts
straight to bright; opened with nothing below it, crisis mode closes to Today. A double tap on Today's
start button, or on the check-in's "More details", opens its screen once.

People log late, so every time stays editable: the end in crisis mode, and the start and end in the
attack editor. A time later than now plus 5 minutes, before 2000, or an end before the start is
refused on the phone before anything is written. The server is looser on purpose: it stores a time up to
24 hours ahead as now, so a phone clock running fast never turns a write into a permanent failure (and every
later write to that record into `P0002`); it refuses only a time further ahead or before 2000. With the AI off,
crisis mode is complete: everything is logged with taps.

With the AI on, "Tell me" is a mic held in the dock. Recognition runs on the phone on iOS (and on Android when the
language pack is installed). When the offline pack is not installed, Android sends the audio to Google's speech
recognizer, so Google is a processor of dictated audio, which the privacy policy names; Nimbo itself never stores
or uploads audio, only the transcript as text. The transcript passes the phone's red-flag check before anything else. The companion
then answers in crisis mode with at most two sentences, which can be read aloud, and a draft that Confirm saves. When
the companion cannot answer (offline, down, or today's dictation or message quota used up), the words are appended to
the attack's notes instead, within the 2,000-character limit, and the screen says whether they were saved whole, cut to
fit, or not at all (notes full, or the attack gone); a message refused on the way is marked as saved in the notes, so the
Companion tab offers no Retry that would repeat it. "What helped
before" ranks the user's own debriefed reliefs and medications in code over the phone's records, so it works with the
AI off and offline too.

## Red flags and urgent care

Two paths open the urgent-care screen. Both run on the phone, offline, with or without the AI, and
neither involves a model.

- **Text.** Every free text the user writes is matched before anything else: an attack's notes, checked
  after they are saved, every chat message and dictation, and every debrief answer. `matchRedFlagsAnyLocale` matches the pack's keywords in
  English, Spanish and Portuguese at once, whatever the app's language, with case, accents and
  punctuation folded, in every reading of the text: as written, with zero-width and other format characters dropped
  instead of splitting a word, and with letters spelled out one by one joined ("w o r s t"). A fever raises `fever_stiff_neck` only together with a stiff neck or a severe
  headache, because either alone is common in an ordinary attack. "Can't feel" counts only with a body
  part after it ("my left arm", "the left side"), so "I can't feel the pain anymore" is relief, not
  numbness. The fixtures in `calibration/` must hit with zero misses
  ([`testing.md`](testing.md#scripts-and-functions)).
- **Duration.** An attack still open after 72 hours opens urgent care with `long_attack`, once per
  attack, on launch and on each return to the app.

The request travels in memory, not in the route, and is forgotten when the screen closes and on
sign-out. The screen shows what was found, why it matters, and one call button. The number comes
from the phone's region, not the language, and a region without a confirmed official number gets
"Call your local emergency number" and a button that opens the dialer empty. "I'm safe, continue"
goes back.

`emergencyNumber(region)` in the condition pack returns the medical emergency number. Each number was
checked against a government or health-ministry source (2026-11-27):

| Region | Number | Source |
| --- | --- | --- |
| AR | 107 (SAME) | https://www.argentina.gob.ar/tema/emergencias |
| BR | 192 (SAMU) | https://www.gov.br/saude/pt-br/composicao/saes/samu-192 |
| CA | 911 | https://www.alberta.ca/what-to-expect-when-calling-911, https://www.quebec.ca/en/health/health-system-and-services/pre-hospital-emergency-services/what-to-do-emergency-requiring-ambulance |
| CL | 131 (SAMU) | https://www.minsal.cl/samu-instala-base-en-alto-hospicio-y-llama-a-utilizar-responsablemente-el-131/ |
| CO | 123 | https://bogota.gov.co/mi-ciudad/salud/cuando-llamar-una-ambulancia-en-bogota-y-que-linea-solicitarla, https://www.cali.gov.co/salud/publicaciones/169064/red-de-salud-publica-lidera-las-solicitudes-para-atender-emergencias-medicas/ |
| CR | 911 | https://www.ministeriodesalud.go.cr/index.php/biblioteca-de-archivos-left/documentos-ministerio-de-salud/vigilancia-de-la-salud/normas-protocolos-guias-y-lineamientos/protocolo-de-atencion-de-emergencias/10014-protocolo-de-atencion-de-emergencias-desde-zonas-de-dificil-acceso/file |
| CU | 104 (SIUM, MINSAP) | https://instituciones.sld.cu/siumlahabana/, https://revcmpinar.sld.cu/index.php/publicaciones/article/download/3460/pdf |
| DO | 911 | https://memorias.minpre.gob.do/api/documents/4309/download/ (Ley 140-13, the 9-1-1 system and its ambulances) |
| EC | 911 | https://www.gob.ec/ecu-911/tramites/solicitud-atencion-emergencia-traves-diferentes-mecanismos-alerta |
| ES | 112 | https://administracion.gob.es/pag_Home/Tu-espacio-europeo/derechos-obligaciones/ciudadanos/asistencia-sanitaria/numeros-urgencia.html |
| GB | 999 | https://www.nhs.uk/nhs-services/urgent-and-emergency-care-services/when-to-call-999/ |
| GT | 122 (Bomberos Voluntarios, national ambulance) | https://bomberosvoluntarios.org.gt/en-services/medical-emergencies |
| HN | 911 (SNE 911, UREM ambulances) | https://portalunico.iaip.gob.hn/ver_archivo/MjAwNDI1NQ== |
| MX | 911 | https://www.gob.mx/cms/uploads/attachment/file/911650/Llamadas_de_emergencia_9-1-1_202401.pdf |
| PA | 911 (SUME) | Ley 44 de 2007, which creates the SUME 9-1-1: https://docs.panama.justia.com/federales/leyes/44-de-2007-nov-1-2007.pdf |
| PE | 106 (SAMU) | https://www.gob.pe/institucion/minsa/noticias/1436318-ministerio-de-salud-mas-de-diez-mil-emergencias-por-accidentes-de-transito-atendio-el-samu-en-lo-que-va-del-2026 |
| PR | 911 | Ley 144-1994, Negociado de Sistemas de Emergencias 9-1-1: https://docs.pr.gov/files/911/Documentos/Formularios/INFORMACI%C3%93N%20GENERAL%20PARA%20COMPA%C3%91%C3%8DAS%20TELEF%C3%93NICAS.pdf, https://hacienda.pr.gov/sites/default/files/negociado_de_sistemas_de_emergencias_de_pr_911.pdf |
| PT | 112 | https://www.gov.pt/guias/contactos-de-emergencia-em-portugal |
| SV | 132 (SEM) | https://transparencia.gob.sv/institutions/minsal/documents/558170/download |
| US | 911 | https://www.911.gov/calling-911 |
| UY | 911 | https://www.gub.uy/ministerio-salud-publica/comunicacion/noticias/same-105-se-integro-centro-comando-unificado-para-fortalecer-atencion |
| VE | 911 (VEN 911) | Gaceta Oficial 41.711 (6 September 2019), which orders the 9-1-1 single emergency number displayed; Conatel's 171 comes from Resolution 220 of 18 March 2003 (https://conatel.gob.ve/wp-content/uploads/2024/08/reforma-parcial-del-plan-de-numeracion-para-los-servicios-de-telefonia-y-servicios-de-radiocomunicaciones-movil-terrestre.pdf) |

Bolivia, Paraguay and Nicaragua return `null`: Bolivia's 168 (a 2017 ministry norm) is not confirmed
as operating, Paraguay's SEME 141 was reported out of service in 2026, and Nicaragua's 128 was the
Cruz Roja Nicaragüense's line, dissolved in 2023, with no official replacement found. Any region not in
the table returns `null` too. A region's name on the call button is the catalog key `region.<code>`.
Before each launch country, spot-check its number ([`owner-runbook.md`](owner-runbook.md)).

## The companion

![Companion message: the Companion tab runs the red-flag keywords on the phone, then posts the turns to companion, which reads the profile, notes and the attack and runs the input screen (keywords, Jev, else Haiku); a red flag returns at once. Otherwise consume_quota spends the units, Claude Sonnet 5.5 runs at most 3 tool rounds whose reads go through PostgREST with the caller's JWT and come back as short refs, the reply passes the local checks and the reply screen (ok, replaced or degraded), and the app shows the reply or its template with the drafts; Confirm writes the records and their outbox calls in one transaction](diagrams/companion-message.svg)

Companion message: [interactive page](diagrams/companion-message.html) · [source](diagrams/companion-message.json)

The Companion tab, "Tell me" in crisis mode and the day-after debrief all talk to one function,
`companion`. The models, prompts, questions and costs are in [`ai.md`](ai.md), the request and statuses in
[`api.md`](api.md), and the attacks the guards cover in [`red-team.md`](red-team.md).

- **The chat stays on the phone.** `chat_messages` in `nimbo.db` holds the conversation; each request sends
  the last answered turns, and nothing of the chat is stored on the server.
- **Drafts, never writes.** The model proposes attacks, doses and check-ins as drafts. A draft is saved only
  when the user taps Confirm, through the same stores and outbox as a tap, in one SQLite transaction with the
  record ids written into the chat message, so a second tap or a replay changes nothing.
- **Evidence.** Every number in a reply carries a ref to the tool result behind it, which the app shows as a
  chip with the attacks or doses it counts.
- **Quotas.** 40 companion messages and 20 dictations a day, per user and local day. A voice message spends a
  dictation unit and a companion unit, since both reach Claude. Every message also spends a screening unit
  (200 a day) for its input screen, a red flag included; past it the screen uses the keywords alone.
- **Agent notes.** "What I know about you" lists the short notes the agent saved (how the user likes things,
  never health details), which the user can delete. They reach the prompt only inside an untrusted `<notes>`
  block, escaped so a note cannot close it.
- **The day-after debrief.** An attack that ended on an earlier local day, up to 3 days ago and not debriefed,
  gets three questions in the Companion tab (what helped, what did not, what may have set it off). Yesterday's
  attack is offered from 05:00 local time, so "Good morning" holds. Chip answers save directly; typed answers
  become a draft. The answers feed the crisis plan ("What helped before").
- **When a reply is not fully screened.** A reply that no model could screen comes back `degraded`, and the
  app adds the footer "Nimbo’s safety check is limited right now. If you notice a sudden severe headache,
  weakness, trouble speaking, a fever with a stiff neck or a severe headache, or vision loss, seek urgent care."

### The companion's guards

`supabase/functions/_shared/screen.ts` holds the two screens every companion message and reply pass
through. Each layer that fails hands over to the next, and none fails open.

- **Input** (`screenInput`). The keywords of all three languages always run. Jev then gets one request
  with a Noul per red flag (the pack's question, `long_attack` included) and a Choice over the seven
  intents, within 4 s; if it fails, Claude Haiku answers the same questions as booleans under a strict
  JSON schema, within 4 s. The red flags are the union of the keywords and the model (a Noul at 0.3 or
  more). With both models down, the keyword flags stand alone and the intent is `other`. There is no
  retry: the next layer is the retry.
- **Reply** (`screenReply`). Code checks every reply first: a dose amount or dosing interval (digits or
  number words, ranges such as "every 4-6 hours", "de 6 em 6 horas", decimals kept whole) is
  `dose_advice` unless it sits inside a verbatim quote of the user's own `get_cabinet` name or
  `dose_text` from this request; and every number that no tool result states is listed (dates and
  times in the results ground nothing). Jev then judges seven Nouls, one per guard key (a hit at 0.35
  or more), with one retry on 429 or 529 only when it leaves Haiku its full 4 s; then Haiku. The
  violated keys are the union of the code's and the model's. With both models down, code decides alone:
  the dose check, `ungrounded_number` for any unlisted number, and `medication_change` for a sentence
  that pairs a take imperative ("take", "tómate", "pode tomar") with a medicine, an amount or a count.
  The result is the response's `guard`: `ok` only after a model screened the reply, `replaced` when
  any key is violated, and `degraded` when both models were down and code found nothing, so an
  unscreened reply is never shown as screened. An unexpected error marks every key.

The thresholds are starting points, set low because a miss costs more than a false replacement; the
fixtures and the live calibration behind them are in [`testing.md`](testing.md#calibration-fixtures).

### The companion function

`supabase/functions/companion/handler.ts` answers one chat message (`verify_jwt` on, so the gateway
checks the caller first). The prompt, tools, refs and reply parsing are in `_shared/companion/`.

1. The request (`parseCompanionRequest`): the last 12 turns at most, each up to 500 characters and
   4,000 in all, the first and last the user's, plus the mode, the locale, the app's local day and
   whether it was typed or dictated. The profile is read with the caller's token, `timezone` and
   `ai_enabled` only, beside the premium check and the message's screening unit (`screen`, 200 a
   day): the AI off answers 403, a failed read 503, and a missing zone reads as UTC. A refused or
   failed screening unit is never an error of its own.
2. The input screen runs next, with up to 8.5 s, while the notes and the attacks are read beside it;
   without a screening unit it runs on the keywords alone, with no model call. A red flag answers at
   once with `redFlags`, no model reply and no unit spent beyond the screening one, so nothing can
   contradict the urgent-care screen.
3. The quota (`consume_quota`) on the request's day: a typed message spends a `companion` unit (40 a
   day), a dictated one a `dictation` unit (20 a day) and then a `companion` unit; the first refused
   answers 429 with its kind and limit. Premium and free callers get their own limits (equal for now). Any failure of the
   quota call answers 503.
4. A bounded loop with Claude Sonnet 5.5: at most 3 tool rounds (4 calls, the last with
   `tool_choice: none`), within 25 s of the first call and at least 8.5 s before the request's
   deadline; each call ends 3 s before the loop's deadline, so the tool round after it can still read,
   and none starts with under 3 s left. A round's calls run together and their results go back in one user
   turn; the assistant content goes back unchanged. Effort `low`, adaptive thinking (the default),
   no sampling settings, the server-side refusal fallback, and two cache breakpoints: the fixed
   prompt with the tools (shared by every user) and the per-request block (the language, mode, day,
   the notes inside an escaped `<notes>` block, and the attack's ref), plus top-level automatic caching
   on every call but the last, so each round rereads the turns and tool results before it. In crisis mode a confident
   logging intent adds a mid-conversation system message asking for the draft first.
5. The tools read the caller's rows with their token and hand the model short refs (`e1`, `m1`, `r1`),
   never ids; only the server maps them back, for the drafts and the evidence. A result is bounded (at
   most 20 attacks with 10 doses each, 30 medications, 5 plan entries; a cut result says
   `truncated: true`). Proposals write nothing: they come back as drafts (at most 3) that the app saves
   on Confirm.
6. The reply is cleaned (no ids, links or Markdown, 500 characters), cut to its complete sentences
   when truncated and to two sentences in crisis mode, and its `[ref]` markers become evidence. The
   reply screen then runs with up to 8.5 s, with each draft's clock time as a grounded number, so
   "logged at 3 pm" is not an ungrounded number. With under 2 s left it runs its local checks only,
   so the reply is at best `degraded`. A replaced reply comes back as `reply: null` with
   the first violated key (the app renders a template); a refusal as `replaced: 'refusal'`.

No request to Anthropic or TypeSafe carries the user's name, email, id, location or any row id, and
the logs hold outcome words only (`answered`, `replaced`, `degraded`, `red_flag`, `over_quota`,
`unavailable`, with `rounds`, `input_source`, `guard_source`, `key` and `cache_read`).

Every request answers within 40 s, under the app's 45 s wait. Each stage gets the smaller of its own
cap and what that deadline leaves after the stages still to come: every database call at most 3 s,
the input screen at most 8.5 s and only while 28 s remain for the rest, the loop until 8.5 s before
the deadline, and the reply screen until the deadline. The database shrinks first, then the loop; the
screens shrink last and never below their local checks. A typical message takes a few seconds.

## Medication overuse guard

`overuseStatus` in the condition pack counts, per medication class, the distinct days in the calendar
month with an acute dose, read in the phone's time zone (23:59 on 30 November counts for November).
The limits follow ICHD-3's medication-overuse headache criteria:

| ICHD-3 | Class | Days a month |
| --- | --- | --- |
| 8.2.1 | Ergot | 10 |
| 8.2.2 | Triptan | 10 |
| 8.2.3 | Simple analgesic | 15 |
| 8.2.4 | Opioid | 10 |
| 8.2.5 | Combination analgesic | 10 |
| 8.2.6 | Ergot, triptan, simple analgesic and opioid together, none over its own limit | 10, only with two or more of them |

A class warns at 80% of its limit. Gepants and other medications have no limit. Preventive doses do
not count; an archived acute medication's doses still do. Today and the cabinet show the most urgent
notice (a class limit before a combined one, a limit before a warning). The guard informs and never
blocks a dose.

## Insights

History's Patterns and the companion's `get_insights` run one module, `supabase/functions/_shared/insights.ts`: pure
code over the records (`_shared/records.ts`), fed on the phone by the local mirror (`src/insights/useRecords.ts`) and on
the server by `record_inputs`. There are seven kinds (`INSIGHT_KINDS`): attacks per month, the attack-free streak, the
triggers the user tagged, the part of the day, the weekday, what helped and sleep before an attack. Each insight carries
`count`, `of`, `windowDays` (90) and the attacks behind it, and is a count, never a percentage. A kind shows only past
its minimum in the condition pack (`insights`: 60 tracked days for the monthly chart, 14 for the streak, 5 attacks for
triggers, 8 for the part of the day, 12 for the weekday, 3 debriefs for what helped, 14 check-ins with 5 short and 5
other nights for sleep); below it the card says what is still needed, never a number. A time-of-day or weekday
spread gets a sentence only when an even spread would give a top count that high at most one time in ten
(`patternChanceMax`);
otherwise it shows the bars and no sentence. Wording never says "causes", "risk", "likely" or "predict"; the triggers
and sleep cards add that showing up together does not prove one causes the other.

## Signals and the monitor

![Monitor run: at :05 pg_cron calls monitor through pg_net with the Vault secret; monitor first reads the due push receipts, asks Expo push for them, deletes the tokens Expo reports gone and forgets the checked tickets; it then reads monitor_targets, the users with a valid zone who finished onboarding, starting one place further each hour; for each user while under the time budget it reads record_inputs for 90 days, the forecast for the user's cell from weather_cache, or on a miss from Open-Meteo, saves the signals with save_signals, claims one push with claim_signal_push when decidePush sends, sends the neutral push through Expo push and saves its tickets; it answers 200 with counts. Separately, Today on the phone reads only today's pressure row and computes its other rows itself](diagrams/monitor-run.svg)

Monitor run: [interactive page](diagrams/monitor-run.html) · [source](diagrams/monitor-run.json)

A signal is a short reason to take care today, computed by code from the user's own records and never by a model.
`supabase/functions/_shared/signals.ts` holds the six rules and the push decision, pure, so the phone, the companion's
`get_signals` and the monitor compute the same rows. The values live in the condition pack (`signals`, `push`):

| Signal | Fires when | Pack value |
| --- | --- | --- |
| Long attack | An open attack reaches 12 hours, then 72 | `longAttackHours` [12, 72] |
| Medication days (warn, limit) | A class, or the combined count, reaches 80 % of its monthly limit, or the limit (the overuse guard's counts) | `overuseWarnRatio` 0.8, the limits table above |
| Debrief | An attack ended yesterday (local date) and has no debrief | none |
| Short night | Today's check-in band is under the average of the nights before an attack, with at least 5 such nights in 90 days and other nights longer by 0.5 h or more | `shortSleep` { `minAttackNights`: 5, `minGapHours`: 0.5 } |
| Pressure change | Sea-level pressure drops 6 hPa or more from this hour to the same hour tomorrow, for a user who chose `weather` or tagged it on 3 attacks in 90 days, from a forecast at most 3 hours old | `pressure` { `dropHpa`: 6, `horizonHours`: 24, `minTaggedEpisodes`: 3, `maxForecastAgeHours`: 3 } |
| No check-in lately | No check-in for 3 days, once the user has been onboarded that long | `quietTrackerDays` 3 |

Signals are ranked long attack, medication limit, debrief, medication warning, short night, pressure, no check-in
(`priority`). During an open attack, pressure, short night and no check-in are held back (`suppressDuringAttack`).
Today shows at most three (`maxOnToday`). Each signal has a `cause_key` (for example `short_sleep:2026-11-27`), so a
reason is stored and pushed once.

- **Who is evaluated.** Every onboarded user with a valid zone, every hour, whatever the hour: Today needs the pressure
  row at any time, and the window decides only whether to push.
- **The push rules** (`decidePush`). A push goes out only inside the user's hours `[notify_start, notify_end)` on their
  clock; a start after the end crosses midnight, and equal hours are an empty window. At most `notify_daily_cap` (0 to 2)
  a local day, never the same cause twice in 24 hours (`sameCauseHours`), never the same `cause_key` twice, and one push
  per user per run, the highest-ranked signal left.
- **The claim.** Before sending, `claim_signal_push` takes a per-user advisory lock and re-checks the key, the cap since
  local midnight and the 24-hour rule in one transaction, and claims nothing for a user with no token, so overlapping or
  retried runs never send one twice; a claim whose send fails is lost rather than doubled.
- **Receipts.** Each push's tickets go into `push_tickets`. Each run first asks Expo for the receipts of tickets 15
  minutes to 24 hours old, deletes the tokens Expo reports `DeviceNotRegistered` and forgets the checked tickets.
- **The run.** A `pg_cron` job calls `monitor` at :05 every hour through `pg_net`, with a shared secret kept in the Vault
  ([`api.md`](api.md#monitor)). Forecasts are looked up once per distinct cell, a few at a time, and a cell not answered by
  100 s leaves that user without the pressure signal. No user starts after 90 s and no push is claimed after 110 s; each
  run starts one place further along the user list, so the users a run leaves out change every hour
  ([`database.md`](database.md#the-hourly-monitor)). `profiles.timezone` accepts only IANA names, checked before any
  `AT TIME ZONE`.
- **Today on the phone.** Today runs `computeSignals` over the local mirror itself, without the forecast, so its rows
  work offline and follow a check-in at once. It reads only today's stored pressure row from `signals` (with the user's
  token, kept in kv `signals.<userId>` for an offline view) and merges it by rank; a row from another day, one computed
  more than `maxForecastAgeHours` (3 h) ago, online or kept, or one while an attack is open, is left out. A row whose
  drop still holds is re-saved every hour, so only a forecast nobody re-checked ages out. Of two reads in flight for
  the same day, only the newest reply is shown and kept. Only the server pushes.

### Today's companion note

The note at the top of Today is template text chosen by code (`src/signals/companionNote.ts`), never a model call.
In order: an open attack gives "I'm here…"; otherwise Today's top signal gives its own note (a short night names the
check-in's band, with the count of attack nights under it as plain text); a brand-new user with no records gets the
first-day note; anyone else gets no card. Its header reads "this morning" before 12:00 and "just now" after. "Reply"
opens the Companion tab and is hidden with the AI off. Evidence chips stay in the chat.

## Weather

The pressure signal needs the only input the phone does not have: the forecast. Everything about the provider
lives in `supabase/functions/_shared/weather.ts` (the URL, the parameters and the parsing), so changing provider
or plan touches one module and its mock.

- **The request.** `GET /v1/forecast` with `hourly=pressure_msl`, `forecast_hours=28` and `timezone=GMT`, for the
  profile's coarse cell at one decimal (about 11 km). It carries no user id, name or finer location; the cell is
  read on the server and never sent back to the phone. 28 hours cover the next 24 from a forecast up to 3 hours old.
- **The cache.** `weather_cache` holds one row per cell and fetch, shared by everyone in the cell and readable only
  by the service role. `pressureFor` answers from a row newer than the age it is given, else fetches once (5 s
  deadline) and stores the result stamped with the UTC hour, so writers in the same hour keep one row; an hourly `pg_cron` job prunes rows over 2 days old ([`database.md`](database.md#pressure-forecast-cache)).
- **Failure.** A slow, refused, rate-limited or malformed answer, one that ends before 24 hours past the hour in
  progress, or a cache that cannot be read, gives no forecast (and nothing is cached), and the pressure signal is
  skipped for that run; an hour the provider leaves empty is dropped. No
  stale forecast is used past the age asked for, nor a cached one that no longer reaches 24 hours ahead.
- **Attribution.** The pressure row's detail ends with "Weather data by Open-Meteo.com", linked to
  `https://open-meteo.com/`, as the provider's terms ask.
- **The plan.** Open-Meteo's free API is non-commercial, so it serves development and closed testing only.
  Before the public store release the owner buys the commercial API Standard plan (`OPEN_METEO_URL` set to the
  customer endpoint and `OPEN_METEO_API_KEY` to its key, which `pressureUrl` then sends) or switches provider
  ([`owner-runbook.md`](owner-runbook.md)).

## Push notifications

- **Registration.** A `push_tokens` row means "this phone gets signal pushes"; there are no per-kind switches, and the
  daily cap (0 to 2) with the system permission is the opt-out. The phone registers on launch and after "Allow
  notifications" whenever the permission is granted, through `register_push_token` with its device secret (256 random
  bits made once per install; the server keeps only its SHA-256), never by a table write ([`app.md`](app.md#push-srcpush)).
- **The device secret.** It proves the phone where there is no session: at sign-out `push-unregister` deletes the named
  account's row holding that token under that secret, and a token another account holds can move only through
  `push-claim`, by a code pushed to that token ([`api.md`](api.md#push-claim)).
- **Neutral copy.** A signal push's title is "You have a note from Nimbo" in the profile's language, with no body. The
  kind's title and a short body appear only with the lock-screen opt-in (`lock_screen_detail`), and even then never a
  medication's name. Its `data` is only `{ url: '/today' }`; a tap opens Today.
- **The Android channel** `signals` is created before the token request, with the system's lock-screen visibility, so
  the copy carries the privacy ([`native-config.md`](native-config.md#permissions)).
- **Not live yet.** Tokens need the owner's EAS project and Firebase (FCM) setup, and iOS remote push waits for the
  Apple account; until then registration reads `unavailable`, which Profile states ([`owner-runbook.md`](owner-runbook.md)).

## Reminders and lock-screen privacy

Preventive medications with a schedule (daily, monthly or quarterly) get local reminders, scheduled on
the phone with no server and no push. Each one reads "Nimbo" and a neutral line; the medication's name
appears only when the user turns on the lock-screen detail in Profile, and the notification's `data`
is empty. The Android channel has private lock-screen visibility. The permission is asked when a
schedule is saved, never at launch. Reminders are cancelled, and any already delivered are taken out of
the tray, on sign-out and at any launch that does not land on Today, so another account never gets them ([`native-config.md`](native-config.md#permissions)).

## Premium

`entitlements` holds one row per user, created when first needed: an owner grant and a store purchase,
independent of each other. `has_premium` answers for the caller only. The owner grants or revokes
premium with `pnpm premium` (the service role, from `scripts/` only) or in the dashboard
([`owner-runbook.md`](owner-runbook.md#granting-premium)). The app keeps the last answer per user, so an
offline launch shows it, and `PremiumGate` shows a quiet invitation without a price to everyone else.
No feature is gated yet; the server check is the authority.

## Security

- **Row-level security on every table**, with `select` limited to the caller's rows. On `profiles`,
  column grants narrow the update to thirteen settings columns and there is no insert or delete
  policy, so the signup trigger is the only creator of rows.
- **Health writes only through RPCs.** The tracking tables grant the client `select` and nothing else;
  every write is a `security definer` RPC that checks the caller, the catalogs and the time range, called
  through the outbox. Consent and the onboarding stamp are RPC-only too, and only the service role
  writes `entitlements`.
- **Coarse location only.** The phone rounds a fix to one decimal before saving it, the columns hold
  nothing finer, and the app never reads the area back (`PROFILE_COLUMNS` leaves it out). The forecast
  request carries that cell and nothing else ([Weather](#weather)).
- **No secrets in the bundle.** `EXPO_PUBLIC_*` holds only the Supabase URL, the anon key and the
  Google OAuth client ids. The service-role key is read by `integration/helpers.ts` and scripts
  only, never under `src/`.
- **AI behind the server.** The Anthropic and TypeSafe keys are function secrets; the phone holds none.
  `companion` reads only the caller's rows with the caller's token, sends providers no name, email, id or
  location, and screens every message and reply ([`red-team.md`](red-team.md)).
- **Sign-in tokens.** Apple and Google sign-in exchange native ID tokens with Supabase Auth. Apple's
  carries a nonce; Google's does not, because the Google Sign-In library cannot send one Supabase
  Auth would match, so a Google ID token has no replay protection beyond its short lifetime
  (`src/auth/socialAuth.ts`).
- **No health text in logs, route params or notification payloads.** Routes carry ids only (Today's debrief row
  opens the Companion tab with `debrief=<episode id>`); the urgent-care request stays in memory; a reminder's `data`
  is empty and a signal push's is `{ url: '/today' }`, and both are neutral unless the user turns on the
  lock-screen detail.
- **The gateway checks every user's token.** `companion`, `push-claim`, `export-data` and `delete-account` run with
  `verify_jwt = true`, so the gateway verifies the JWT's signature and expiry before the function reads its `sub`
  (`callerOf`, which does not verify it again); a test fails if a function that calls `callerOf` loses the flag.
  `export-data` and `delete-account` also ask Auth about the token first, so a signed-out session can neither export
  nor delete (`401`). `push-unregister` (the device secret) and `monitor` (the Vault secret) run without a JWT.
- **The session on the phone.** The Supabase session lives in expo-sqlite's `localStorage` inside the app sandbox, not
  the Keychain or Keystore: accepted, with an encrypted adapter as the upgrade path ([`audits/security.md`](audits/security.md) SEC-05).
  Deleting the account needs a live session and the confirm step, not a fresh sign-in (SEC-13, a recent sign-in check is
  planned before the public release). Changing the password from a session older than 24 hours needs an emailed nonce
  (`secure_password_change`, SEC-16), so a stolen token cannot also take the account over.
- **The monitor and the push functions.** `monitor` is the only code that uses the service role for a whole request,
  runs only from the `pg_cron` job with the Vault's secret (refused while `MONITOR_SECRET` is shorter than 32 characters),
  and makes no model call. Every function that takes a body
  caps it (64 KiB, 2048 bytes and 1024 bytes; `monitor` reads none) ([`red-team.md`](red-team.md#request-bodies-push-and-the-monitor)).
- **Health records on the phone.** `nimbo.db` keeps the user's records for offline use. On sign-out
  or an account switch the previous user's rows are deleted, and a launch deletes any other user's
  rows left by a sign-out made while the app was closed. Only rows still waiting to be sent (dirty, or
  with an unsent or failed operation) stay until that user signs back in, and the cached profile stays
  only while something of theirs is queued. A deletion drops all of them, queued or not, with the chat, the kv keys,
  the reminders and the export file, which lives only in the cache directory and also goes at every sign-out. Android backup is off
  (`allowBackup: false`); on iOS, iCloud backup still includes `nimbo.db` and the kv store, so excluding them is a blocker
  before the first iOS submission (Apple 5.1.3, [`native-config.md`](native-config.md#ios-backup-apple-513)).
- **Repository.** Rulesets on `main`, `develop` and release tags require the CI checks; private
  vulnerability reporting is on ([`SECURITY.md`](../SECURITY.md)). CI also scans for secrets, audits
  dependencies, lints the workflows and runs CodeQL ([`CONTRIBUTING.md`](../CONTRIBUTING.md)).
- **Audits.** The security audit ([`audits/security.md`](audits/security.md)), the API audit
  ([`audits/api.md`](audits/api.md), the OWASP API Top 10 over PostgREST and the functions) and the database audit
  ([`audits/database.md`](audits/database.md): RLS, policies, grants, functions, indexes, constraints, jobs and retention)
  list every finding with its fix or the reason it is accepted. Their pins run in the gate and CI: `src/__tests__/securityScan.test.ts`,
  `supabase/functions/_shared/__tests__/logScan.test.ts`, `scripts/__tests__/schema-parity.test.ts`, `supabase/tests/api_audit.test.sql`,
  `supabase/tests/database_audit.test.sql`, `pnpm db:lint` and `integration/apiAudit.int.test.ts` ([`testing.md`](testing.md)).

## Design decisions

- **Three appearances plus Automatic.** Day, Dark and Dim are real themes with tokens of their own
  (`src/ui/theme.ts`); the profile stores `system` (default), `day`, `dark` or `dim`. Automatic follows
  the phone between Day and Dark and is Day when the phone reports nothing. Dim is also what crisis
  mode forces, so it has to be a first-class theme and not a dark variant.
- **A Liquid Glass tab bar with a reduce-transparency fallback.** `src/ui/TabBar.tsx` uses the iOS 26
  glass where the API exists and a blur otherwise. It stays opaque until the OS answers the
  reduce-transparency question, so a user who asked for none never sees a first glass frame, and it
  stays opaque when the setting is on.
- **Consent is written only through server-stamped RPCs** (above), so the timestamps cannot be
  forged by a client.
- **Gates are enforced at route registration.** A redirect inside a screen runs after the screen
  mounts; `Stack.Protected` keeps unreachable routes out of the navigator, so a deep link cannot show
  one. The tab shell does the same for Companion: with the AI off it has no trigger, and the shell
  renders nothing for a route without one while the headless tabs fall back to Today.
- **The profile cache is written only by the provider.** `AuthProvider` writes the cache from what
  it shows; the repository's reads and writes never do. Two writers would let a slow read, or an older
  write answering late, overwrite a newer value in the cache and the screen, and the next offline
  start would open on stale data. The provider also drops a read that began before a local change and
  reads again.
- **One condition pack shared by the app and the functions.** The catalogs, medication classes and
  limits live once in `supabase/functions/_shared/condition/`, with no runtime imports so Deno and the
  app can both load it; `src/condition/index.ts` re-exports it. A test checks every catalog item has
  a label in every language catalog.
- **Red flags are matched on the phone, every time.** Every free text goes through `matchRedFlagsAnyLocale`
  (the pack's whole-phrase keywords in all three languages, whatever the app's, with case, accents and
  punctuation folded) before anything else, offline and with the AI off. Negation is not parsed: a false
  hit costs one "I'm safe, continue", a miss could cost far more. The calibration fixtures
  (`calibration/red-flags.*.json`) must hit with zero misses. The emergency number comes from the
  phone's region, not the language, and a region without a clear official number gets "call your local
  emergency number" rather than a guess.
- **Local first, with an ordered outbox.** A health write never waits for the network: the mirror row
  and its RPC call commit together, and the outbox sends the calls in order. Ordering keeps an edit from
  reaching the server before the row it edits, and ids made on the phone make every replay harmless
  ([Health data offline](#health-data-offline)).
- **A full pull instead of a change feed.** Reading every row of the user on each sync needs no
  tombstones or clocks and always converges; dirty rows are skipped, so it never undoes a local change.
  It is sized for a few thousand rows per user.
- **Code computes every number.** Overuse days, countdowns, durations and counts come from tested pure
  functions (`overuseStatus`, `countdown.ts`, `formatDuration`), never from a model.
- **Modals that draw their own motion.** Crisis mode and the check-in are transparent modals with no
  native animation: each draws its own scrim and fade or sheet, so Dim and reduced motion get their own
  variants and the screen below stays visible.
- **Premium is a server answer, cached.** `has_premium` decides; the phone keeps the last answer per
  user only so an offline launch does not flash the invitation.
- **Language: the phone decides, the profile follows.** The UI language is a device-wide preference (`system`,
  `en`, `es` or `pt`), and `useLanguageSync` keeps `profiles.language` on the language the phone resolves, on mount
  and on resume, one save at a time, so the server knows it for what it sends later. On a fresh install (no stored
  preference) the first check adopts the profile's language when it differs from the phone's, so a reinstall opens in
  the language the user had; that check always stores a choice (the adopted language, or `system`), so it runs once
  and a later change of the phone's language is never pulled back by the profile's synced copy. The companion
  function never reads `profiles.language`: it answers in the request's `locale`, the language on screen.
  On a shared phone the device language overwrites the next user's `profiles.language`; that is by design,
  since the language is chosen once per device and `companion` uses the request's locale.
- **The model proposes, the user confirms.** No model call writes a health record: tools read with the caller's
  token and return drafts, and only Confirm on the phone writes, through the stores and the outbox. A
  reply the guards replace never reaches the phone; the app renders a fixed template instead.
- **Two classifiers, then code.** Jev screens first because it is fast and returns probabilities the
  thresholds act on; Haiku answers the same questions as booleans when Jev fails; the local checks run on
  every reply and decide alone when both are down. A reply is `ok` only after a model screened it, so an
  unscreened reply is always marked.
- **Recall first for red flags.** The keywords match the union of the three languages and the models add
  to them, never subtract; a false hit costs one "I'm safe, continue".
- **Signals on the phone, pushes from the server.** Today computes its rows over the local mirror with the same rules
  as the monitor and fetches only the pressure row, so rows work offline and follow a check-in at once; a server-only
  read would lag up to an hour. The monitor evaluates everyone hourly and the window gates only the push.
- **Sleep in bands, not minutes.** Check-ins store a band, so signals and pushes name the band ("You slept under 5 h")
  and averages are band midpoints in hours with one decimal in the locale's separator, never minutes.
- **"Weather in your history" means tags.** The pressure signal applies to a user who chose `weather` or tagged it on
  3 attacks in 90 days; there is no per-user statistical test, and only drops count.
- **Two sleep insights.** Trigger frequency counts the user's own tags; sleep before an attack reads check-in nights
  against the other nights. One is what the user suspects, the other what they logged.
- **No `weather` endpoint.** The forecast is a shared module and a cache read only by `monitor`; an endpoint comes only
  when a screen needs live weather.
- **Equal notification hours are an empty window.** No push goes out, and no constraint refuses the save; Profile says so
  under equal hours.
- **The neutral push says "You have a note from Nimbo".** The approved copy, the same line the reminders use.
- **Commits by milestone.** Each wave's branch history has one commit per milestone, each reviewed
  before it is kept, so the history reads as the build order.

## Regenerating the diagrams

Each diagram's source is a JSON file in `docs/diagrams/`. archify renders the `*.html` page from it,
and the `*.svg` image is that page's own export. Edit only the JSON, then regenerate the other two.

The tool is [archify](https://github.com/tt-a1i/archify), a Node.js command-line tool that needs no
install. Keep it outside this repo, so `pnpm lint` does not scan its files, and set `ARCHIFY` to its
`bin/archify.mjs`.

| Diagram | Type |
|---|---|
| `system-context.json` | `architecture` |
| `data-model.json` | `architecture` |
| `gate-flow.json` | `workflow` |
| `crisis-logging.json` | `sequence` |
| `companion-message.json` | `sequence` |
| `monitor-run.json` | `sequence` |

Run the commands from the repo root, because each source's `meta.output` path is relative to it.
For one diagram, with its type and name:

1. `node "$ARCHIFY" validate <type> docs/diagrams/<name>.json --quality showcase --json`, after
   every edit, until all 9 artifact checks pass with 0 composition errors and 0 warnings.
2. `node "$ARCHIFY" deliver <type> docs/diagrams/<name>.json docs/diagrams/<name>.html --quality showcase --json`
   writes the page.
3. Open the page in a browser, choose **Export**, then **SVG**, and save the download over
   `docs/diagrams/<name>.svg`, which this page embeds.
4. `node "$ARCHIFY" visual-check <copy>.html --json` checks a copy of the page in a real browser; it
   writes PNG screenshots next to the page, so run it on a copy outside the repo.

Update the diagrams when the schema, the gate rules, the sync path, the companion's request, the monitor's run or a planned service changes, and
keep the alt text above in step with them.
