# How Nimbo works

This page covers where Nimbo runs, what each part does, how the app decides which screen to show,
how consent is recorded, how it starts offline, how health data is kept and synced offline, crisis mode,
the red-flag paths, the overuse guard, reminders, premium, the security model, the reasons behind the
design choices, and how to regenerate the diagrams. Parts that later waves add are drawn as planned
and marked that way.

![System context: the Expo app keeps nimbo.db, the outbox and local notifications on the phone, and talks to the Supabase project's Auth and REST API with the user's token and to Apple and Google for native sign-in; Postgres holds the profiles, the tracking tables and entitlements; Edge Functions, the email relay, the AI and data APIs and a GitHub Actions keep-alive call are planned](diagrams/system-context.svg)

System context: [interactive page](diagrams/system-context.html) · [source](diagrams/system-context.json)

The diagram tool [archify](https://github.com/tt-a1i/archify) generates the four diagrams on this
page from their JSON sources; [Regenerating the diagrams](#regenerating-the-diagrams) shows how.
Each interactive page adds search, focus and both color themes; open it in a browser.

## What the system does and where it runs

Nimbo is a migraine companion: log attacks, spot patterns and get calm guidance in English, Spanish
or Portuguese. It is not a medical device and never diagnoses or prescribes.

- **The phone.** An Expo SDK 58 app (React Native, strict TypeScript, Expo Router) for iOS and
  Android. It keeps the session and the last profile in an on-device key-value store, and the user's
  health records in a local SQLite database, so it opens and logs offline.
- **One Supabase project.** Auth, Postgres 17 with row-level security, and later Edge Functions.
  Today only the local stack in Docker exists (`pnpm db:start`, [`local-stack.md`](local-stack.md)); no
  hosted project is set up yet ([`owner-runbook.md`](owner-runbook.md)). The phone holds only the project
  URL and the anon key, both public by design; every request carries the user's session token.
- **Planned services.** Edge Functions, an email relay for the hosted project, the AI and data APIs
  they call, and a daily GitHub Actions call to `keep_alive()` so a free project is not paused. None
  exists yet. Model calls will run only in Edge Functions, never on the phone.

## What each component does

| Component | Runs | What it does |
|---|---|---|
| Expo app | Phone | Routes in `src/app/`, gated by account state; the three themes; the tab shell, crisis mode, the cabinet, the check-in and History ([`app.md`](app.md)). |
| Local store and outbox | Phone | `nimbo.db`: mirrors of the four tracking tables, which every screen reads, and the queue of RPC calls that carries each change to the server ([Health data offline](#health-data-offline)). |
| Local reminders | Phone | Preventive medication reminders scheduled on the phone, with no server ([Reminders and lock-screen privacy](#reminders-and-lock-screen-privacy)). |
| Auth | Supabase | Email and password with a 6-digit email code to confirm and to reset, and Sign in with Apple and Google through native ID tokens. |
| Postgres 17 | Supabase | The `profiles` table with RLS and column grants, the signup trigger, the consent RPCs, the tracking tables `episodes`, `medications`, `doses` and `checkins`, and `entitlements` ([`database.md`](database.md)). |
| `accept_terms`, `set_ai_consent`, `complete_onboarding` | Postgres | The only writers of the consent columns and the onboarding stamp; they stamp the server clock. |
| Tracking RPCs | Postgres | The eight `security definer` writers of the tracking tables, called only through the outbox; a create ignores an id it already has ([`database.md`](database.md#tracking-rpcs)). |
| `has_premium` | Postgres | Whether the caller has premium, from their own `entitlements` row ([Premium](#premium)). |
| `keep_alive` | Postgres | A no-op the anon key may call. |
| Condition pack | Shared code | The migraine catalogs, medication classes, overuse limits, red flags and emergency numbers, in `supabase/functions/_shared/condition/`, imported by the app and later by the functions. |
| Edge Functions, email relay, AI and data APIs, keep-alive workflow | Planned | Not built yet. |

## Data model

![Data model: the signup trigger inserts a profiles row for each auth.users row; the app updates thirteen settings columns of profiles directly and records consent and the end of onboarding only through the profile RPCs, which stamp the server time; it writes episodes, doses, medications and checkins only through the eight tracking RPCs that the outbox calls, where a dose references its medication and loses its episode when the episode is deleted; has_premium reads the caller's own entitlements row](diagrams/data-model.svg)

Data model: [interactive page](diagrams/data-model.html) · [source](diagrams/data-model.json)

One `profiles` row per auth user, created by the `handle_new_user()` trigger and deleted with the
user. The client updates its settings columns directly: the language, appearance and notification
settings, `known_triggers` (keys of the triggers catalog), `priority` (one of `fewer`, `triggers`,
`overuse` and `logging`), `track_period` (the period question in the check-in, off by default) and a
coarse area, `coarse_lat` and `coarse_lon` at one decimal (about 11 km). The app writes the area and never
reads it back. The tracking tables `episodes`, `medications`, `doses` and `checkins` and the
`entitlements` table have a read-own policy and no client write grant: every health row is written by a
tracking RPC, and only the service role writes an entitlement. The columns, policies, grants and RPC
contracts are in [`database.md`](database.md).

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
| `adultConfirmedAt` or `boundaryAcceptedAt` is null | `/welcome/boundary` |
| `aiConsentAnsweredAt` is null | `/welcome/ai-consent` |
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

The sign-up path: sign up, then the code screen (`confirm-email`). Signing in with an unconfirmed
address leads to the same screen, which then says no code is on its way yet and leads with sending one. A password reset uses the `reset` screen
with its own code.

## The consent model

Three answers are recorded on the profile: the adult confirmation and the boundary acceptance
(both required, stamped together by `accept_terms`), and the AI answer (`set_ai_consent`), which
stores the answer apart from the question having been asked, so a "no" is remembered and not asked
again. Declining AI leaves the app complete: `visibleTabs` in `src/profile/tabs.ts` drops the
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
their defaults, so an upgraded phone opened offline still reaches its screen. A failed launch read is
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
  signed-in user, never from the network. The schema is versioned (`PRAGMA user_version`, now 2); an update
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
  brings the rest back then. Their chat is deleted in full whatever is queued, since nothing waits on it. The cached profile goes with them once nothing of theirs is queued. Signing
  out from Profile with records not uploaded asks first, saying how many stay on this phone.
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

## Red flags and urgent care

Two paths open the urgent-care screen. Both run on the phone, offline, with or without the AI, and
neither involves a model.

- **Text.** Every free text the user writes is matched before anything else; in this wave that is an
  attack's notes, checked after they are saved. `matchRedFlagsAnyLocale` matches the pack's keywords in
  English, Spanish and Portuguese at once, whatever the app's language, with case, accents and
  punctuation folded. Fever and a stiff neck raise `fever_stiff_neck` only together, because a stiff
  neck alone is common in an ordinary attack. The fixtures in `calibration/` must hit with zero misses
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
  nothing finer, and the app never reads the area back (`PROFILE_COLUMNS` leaves it out).
- **No secrets in the bundle.** `EXPO_PUBLIC_*` holds only the Supabase URL, the anon key and the
  Google OAuth client ids. The service-role key is read by `integration/helpers.ts` and scripts
  only, never under `src/`.
- **Sign-in tokens.** Apple and Google sign-in exchange native ID tokens with Supabase Auth. Apple's
  carries a nonce; Google's does not, because the Google Sign-In library cannot send one Supabase
  Auth would match, so a Google ID token has no replay protection beyond its short lifetime
  (`src/auth/socialAuth.ts`).
- **No health text in logs, route params or notification payloads.** Routes carry ids only; the
  urgent-care request stays in memory; a reminder's `data` is empty and its body is neutral unless the
  user turns on the lock-screen detail.
- **Health records on the phone.** `nimbo.db` keeps the user's records for offline use. On sign-out
  or an account switch the previous user's rows are deleted, and a launch deletes any other user's
  rows left by a sign-out made while the app was closed. Only rows still waiting to be sent (dirty, or
  with an unsent or failed operation) stay until that user signs back in, and the cached profile stays
  only while something of theirs is queued. Android backup is off
  (`allowBackup: false`); iOS iCloud backup still includes the file, an open gap
  ([`native-config.md`](native-config.md#what-appjson-sets)).
- **Repository.** Rulesets on `main`, `develop` and release tags require the CI checks; private
  vulnerability reporting is on ([`SECURITY.md`](../SECURITY.md)). CI also scans for secrets, audits
  dependencies, lints the workflows and runs CodeQL ([`CONTRIBUTING.md`](../CONTRIBUTING.md)).

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

Update the diagrams when the schema, the gate rules, the sync path or a planned service changes, and
keep the alt text above in step with them.
