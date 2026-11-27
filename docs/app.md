# The app: modules under `src/`

What each client module does and how the pieces fit. The flow and the reasons are in
[`architecture.md`](architecture.md); the schema the app calls is in [`database.md`](database.md);
the tests for each module are in [`testing.md`](testing.md).

## Routes (`src/app/`)

Expo Router routes: every file is a screen and `_layout.tsx` files define navigators. Non-route code
(components, hooks, helpers) stays outside `src/app/`.

- `_layout.tsx`: loads the fonts, nests `AuthProvider`, `SyncProvider`, `I18nProvider` and `ThemeProvider`, and
  registers the route groups with `Stack.Protected` from `nextRoute`; while the answer is `/loading` it
  shows a loading view instead (Try again and Sign out once signed in). `index.tsx` forwards the landing route to the allowed screen.
- `(auth)/`: `intro` (the three value screens a signed-out phone opens on once; every way out marks it seen),
  `sign-in`, `sign-up`, `confirm-email` (the 6-digit code, with resend) and `reset`.
- `welcome/`: `boundary` (adult confirmation and the not-a-medical-device boundary, `accept_terms`) and
  `ai-consent` (`set_ai_consent`), each registered only while it is the one due, then the five setup steps together:
  `triggers` (pack trigger chips, `knownTriggers` in the order picked), `priority` (one of four, orders Today),
  `medications` (rows and Add, through the cabinet form), `notifications` (the lock-screen choice, the permission, and the
  hours and daily cap shown read-only) and `location` (an optional rough area; both buttons finish onboarding through the outbox's `complete_onboarding`). No
  back gesture; a failed save keeps the user on the step with the error.
- `(tabs)/`: `today`, `companion`, `history`, `profile` behind a headless tab shell with the floating
  bar. The tab list comes from `visibleTabs`, so Companion has no trigger when the AI is off, and the
  shell renders nothing for a route without a trigger.
  `profile` holds language, appearance, reduce motion, the AI switch and sign-out.
- `urgent-care.tsx`: the urgent-care screen for a red-flag hit ([Red flags](#red-flags)), registered with
  the tabs as a full-screen modal with no animation and no swipe to dismiss.
- `crisis.tsx`: crisis mode for the attack in `?id=` ([Attacks and crisis mode](#attacks-and-crisis-mode)),
  registered with the tabs as a transparent modal with no native animation. The root layout also mounts
  the long-attack watch while the tabs are the allowed target.
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
the stored language preference (`system`, `en`, `es` or `pt`); `useI18n()` gives `t(key, params)` and
`tp(key, count, params)`. `translate.ts` holds the catalogs and the lookup. `plural.ts` picks a counted
message's `.one`, `.many` or `.other` form by CLDR's rules for the three languages (written out, as
Hermes has no `Intl.PluralRules`), falling back to `.other`, and fills `{n}` with the count.
`format.ts` gives `formatClock` (12-hour in English, 24-hour otherwise), `formatDuration` ("5 h 20 min",
"3 d 2 h") and `parseClock` for typed times.

## Shared UI (`src/ui/`)

- `theme.ts`: the Day, Dark and Dim tokens (colours, type, space, radii) and the tones derived from
  them; `resolveTheme.ts`: preference, phone scheme and crisis mode to a theme; `ThemeProvider.tsx` and
  `themeContext.ts` provide it (`useTheme`, `useTones`); `color.ts` and `contrast.ts` are the colour
  maths and WCAG contrast the theme tests use.
- `motion.ts`: motion tokens per theme and reduce-motion setting, `useMotion()`, easings and springs,
  `entrance(motion, dy, delay)` (a rise, or the reduced fade) and `crossFade(motion)` (a value changing in place);
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
  `useOnResume.ts` (a retry hook for foreground and network return); `localDate.ts` (the phone's
  calendar day, a check-in's `local_date`); `database.types.ts` is generated by `pnpm db:types`: do not edit it.

### Local store, outbox and sync (`src/lib/local/`, `src/lib/outbox/`, `src/lib/sync/`)

Health data is local-first: a screen writes the phone's copy and queues the RPC call in one SQLite
transaction, shows the change at once, and the outbox sends it when it can.

- `local/db.ts`: `localDb()` opens `nimbo.db` on first use (`PRAGMA user_version = 1`). It holds the
  mirror tables `episodes`, `medications`, `doses` and `checkins`, with the server's columns (arrays as
  JSON text, booleans as 0 or 1), each row with its `user_id` and a `dirty` flag, and the `outbox`.
  `notifyChanged(tables)` tells readers a committed write changed those tables. `purgeUser(userId)`
  deletes a user's mirror rows unless an operation of theirs is still queued, so rows with an unsent
  or failed operation survive until that user signs back in and sends them. `purgeOtherUsers` runs
  it at launch for everyone but the signed-in user.
- `local/useLocalQuery.ts`: `useLocalQuery(tables, read)` re-reads only when one of `tables` changes (or
  `read` is a new function). Every read filters by the user id, so two accounts on one phone never see
  each other's rows.
- `outbox/outbox.ts`: `enqueue(userId, kind, args)` is called inside the mirror write's transaction. It
  queues the call for one of the eight tracking RPCs (`log_episode`, `update_episode`, `end_episode`,
  `delete_episode`, `save_medication`, `log_dose`, `delete_dose`, `save_checkin`) and marks the row dirty. The
  row stays dirty while any operation with its record key (the `p_id`, or `checkin:<local_date>`) is unsent,
  failed ones included. `listOutbox(userId)` returns that user's operations in order, and `resetFailed(userId)`
  puts them all back in line, due now, with fresh attempts.
- The ninth kind, `complete_onboarding` (args `{}`, record key `profile:onboarding`, no mirror row), finishes
  onboarding. It is queued rather than called so that a user who left setup unfinished can still reach Today, and
  crisis mode, offline: `completeOnboarding(userId)` queues it and returns the stamp the screen shows through
  `patchProfile`, and the gate opens Today at once. The RPC is idempotent (`coalesce`), so a replay is harmless.
  Until it is sent the server still reads null, so `AuthProvider` keeps the phone's stamp on a fetched profile
  when `queuedAt(userId, 'complete_onboarding')` found the call unsent or failed as the read began (the outbox may send it
  while the read is out) or still does as it resolves.
- `outbox/runOutbox.ts`: `runOutbox(userId, deps)` sends one operation at a time, in order. The attempt is
  claimed (`attempts + 1` and the next backoff, `min(5 s · 2^(n − 1), 10 min)` over every send so far)
  before the send, so a kill mid-send still counts. A send with no answer (offline, a timeout) gives
  the attempt back and only lengthens the wait, so time offline never fails an operation. A retryable
  failure stops the pass, so nothing overtakes it. A permanent one, or the 8th answered attempt,
  marks the operation failed and the pass goes on. An operation is never sent
  while the session belongs to another account (`deps.sessionUserId()`). Concurrent calls share one pass,
  and `pauseOutbox` / `resumeOutbox` hold a user's queue. Each create RPC is idempotent on its id, so a
  call replayed after a lost response never duplicates a row. `rpcSender(client)` is the real `send`.
- `outbox/errors.ts`: `classifyRpcError`. No response (status 0, flagged `noResponse`) and 401 are retryable. The codes
  `22023`, `23514`, `23502`, `22P02`, `22001`, `22003`, `P0002` and `42501` are permanent, checked before
  the status because PostgREST answers `P0002` with a 500. Any other error is retried.
- `sync/pull.ts`: `pullAll(userId)` reads every row of the user, table by table, with an explicit column
  list, paged at the API's 1000-row limit. It then writes them in one transaction, skipping dirty rows
  and rows with an unsent operation (so a local delete is not undone), deleting clean rows the server
  no longer has, and never touching another user's rows.
- `sync/SyncProvider.tsx`: mounted inside `AuthProvider`. It runs a cycle, push then pull, on sign-in,
  on resume, on reconnect and after every `enqueue`. Cycles never overlap, and a request made during
  one runs one more. A timer wakes it when the head of the queue's backoff ends. On sign-out or an
  account switch it pauses the previous user's outbox and, once that and any running cycle have
  settled, purges their rows; at launch it purges every other user's.
  `useSyncState()` gives `pending`, `failed`, `syncing` and `retry()`.
- `sync/SyncNotice.tsx`: the sync banner. It shows nothing while synced. After 600 ms of pending work it
  shows one muted line ("Saved on this phone, syncing · 2 records to upload"). With failures it shows a
  notice that asks for a tap on Try again (a failed operation is only sent again from there). Each state cross-fades at the theme's `base` duration.

## Condition pack (`src/condition/`)

Re-exports `supabase/functions/_shared/condition/` (the migraine catalogs, medication classes,
limits and red flags, `matchRedFlags`, `matchRedFlagsAnyLocale`, `normalizeText` and `emergencyNumber`). App code imports it from
here, never from `supabase/` directly.

## Red flags

The pack lists seven red flags (`redFlags`): `thunderclap`, `weakness`, `fever_stiff_neck`,
`head_injury`, `pregnancy`, `long_aura` and `long_attack`. Each has the message key of its "why"
line, a yes/no question for a model screen, and whole-phrase keywords per language; `long_attack` has
none, because it is raised from an open episode's length. A flag can also list `allOf` term groups
that raise it only together: `fever_stiff_neck` needs a fever term and a neck-stiffness term, because a
stiff neck alone is common in an ordinary attack. `matchRedFlags(text, locale, pack)`
normalizes the text and each keyword the same way (lower case, accents folded, anything but letters
and digits as one space) and returns the hits in pack order. `matchRedFlagsAnyLocale(text, pack)` does
the same over the en, es and pt lists at once (an `allOf` group counts with a phrase from any language). The fixtures in `calibration/` are the messages it must
catch, and the ordinary attack descriptions it must not, under each locale and under the union.

- `src/redflags/useRedFlagCheck.ts`: `useRedFlagCheck()` gives `(text, source) => boolean`. It matches all
  three languages whatever the app's language, since people write in the language they think in and a
  miss costs more than a rare false hit. On a hit it opens urgent care with the sentence that hit (160
  characters at most).
- `src/redflags/urgentCare.ts`: `showUrgentCare(request)` keeps the request in memory and pushes
  `/urgent-care`, so no health text travels in a route param; `currentUrgentCare()` reads it back and
  `clearUrgentCare()` drops it. The screen reads it once and clears it when it unmounts, and
  `AuthProvider` clears it on sign-out and on an account switch, so a message never outlives the
  screen or the session.
- `src/app/urgent-care.tsx`: what was found (or the 72-hour line for a duration hit), the why lines,
  "ask someone to stay with you", then one filled 56 pt call button (`tel:<number>`) with the region
  under it. A region with no number gets "call your local emergency number" and a button that opens
  the dialer empty. A duration hit also offers "It already ended: fix the time" (the episode editor).
  "I'm safe, continue" fades out and goes back. It fades in over 150 ms in every theme, with a warning
  haptic; the call button never pulses.

`emergencyNumber(region)` takes the phone's region (`getLocales()[0].regionCode`) and returns the
medical emergency number, or `null`. Each number was checked against a government or health-ministry
source (2026-11-27):

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
Cruz Roja Nicaragüense's line, dissolved in 2023, with no official replacement found. Any region not in the table
returns `null` too, and the screen says to call the local emergency number. A region's name for the
call button is the catalog key `region.<code>`.


### Medicine cabinet and overuse guard (`src/cabinet/`, `src/app/cabinet/`)

Medications and doses live in the local mirrors and reach the server through the outbox.

- `medicationStore.ts`: `saveMedication(userId, id, fields)` upserts the mirror row and queues `save_medication` in one
  transaction (the form's interval in hours is stored as whole minutes). `useMedications` hides archived ones unless
  asked; `useMedication` reads one.
- `doseStore.ts`: `logDose` makes the id on the phone (a retried send cannot log twice) and leaves `p_episode_id` out for a
  dose with no episode; `deleteDose` removes the row and queues `delete_dose`; `useDoses` filters by episode or medication.
- `doseDays.ts`: `doseDaysForMonth` lists the distinct local dates with an acute dose per class in the calendar month of a
  date, read in a given time zone, so 23:59 on 30 November is November. Archived medications count; preventive ones do not.
  `daysLeftInMonth` is the whole days after today.
- `OveruseNotice.tsx`: `mostUrgent` picks one notice (a limit over a warning, a class over the combined count) and the
  component shows it; its action opens `/history?filter=doses`.
- The guard itself is `overuseStatus` in the condition pack: per-class ICHD-3 limits plus the combined limit of 8.2.6 (combination analgesics are 8.2.5, with their own limit).
- `src/app/cabinet/index.tsx` lists acute and preventive medications with each class's days; `[id].tsx` adds (`new`) or
  edits one and archives it after a confirmation. Profile has a row that opens the cabinet.

### Attacks and crisis mode (`src/episodes/`, `src/crisis/`, `src/app/crisis.tsx`)

- `episodes/episodeStore.ts`: `startEpisode(userId, now?)` writes the mirror row and queues `log_episode` in one
  synchronous transaction before it returns, with the id made on the phone, so a kill after the tap loses nothing and a
  replayed send cannot log twice; an open attack is returned instead of a second one. `updateEpisode` patches only the
  keys given, the start included (people log late). It and `endEpisode` refuse, with a `RangeError` before anything is
  written or queued, what the server would refuse: a time later than now plus 5 minutes or before 2000, or an end
  before the start. `deleteEpisode`
  unlinks the attack's doses as the server's `on delete set null` does. `useEpisodes` (newest first), `useEpisode`,
  `useOpenEpisode`, and `readOpenEpisode` for code outside a render.
- `episodes/useLongAttackWatch.ts`: on mount and on every resume, an attack open for the pack's `statusHours` (72)
  opens urgent care with `long_attack`, then sets kv `redflag.long.<episodeId>`, so it opens once per attack. It waits
  while another urgent-care screen is up and while the landing route `/` is still redirecting.
- `crisis/countdown.ts`: pure. `nextDoseAt` from the latest dose and the interval the user entered, `minutesLeft`
  (a part minute counts, never below 0), and `resolveDoseTime`, which places a typed clock time on today's date in a
  time zone, or yesterday's when it is later than now ("23:50" typed at 00:10).
- `crisis/useMinuteClock.ts`: the time, refreshed on each minute boundary and on resume; nothing ticks per second.
- `crisis/IntensityScale.tsx` (eleven 56 pt steps, unset until the first tap, a selection haptic per step),
  `crisis/HeadMap.tsx` (front and back views of the pack's pain areas, each region a 48 pt or larger checkbox, sides
  named from the user's point of view), `crisis/DoseButton.tsx` (one per acute medication: log now with a success
  haptic, then "Taken at", the countdown from that medication's latest dose in any attack, and Change or Cancel on a
  dose just logged) and `crisis/EndAttack.tsx` (the "It's over" sheet and the summary after it).
- `app/crisis.tsx` forces Dim on mount and releases it when it closes, keeps the screen awake (`expo-keep-awake`), and
  wraps its own subtree in Dim so it stays Dim while the app below turns back. Closing (Hide, or Close after the end)
  fades the layer out over `slow` when the screen below is Day and `base` otherwise. Hide leaves the attack open.
  Confirming an end never throws: a refused time, the default "now" included, shows the sheet's inline error. With the
  AI off, a line under the symptoms says everything is logged with taps.
  "Tell me", "What helped before" and the debrief line need the companion and are not built yet.

### Daily check-in and preventive reminders (`src/checkin/`, `src/cabinet/reminders.ts`, `src/app/checkin.tsx`)

- `checkin/checkinStore.ts`: `saveCheckin(userId, localDate, fields)` merges only the keys given into the day's mirror row
  and queues one `save_checkin` with those keys, in one transaction. A date the server would refuse (before 2000, more than
  a day past the UTC date, not a real day) is a `RangeError` before anything is written. `useCheckin`, `isCheckinDone` (sleep
  band and stress both set) and `useCheckinDates` (local dates with a check-in, inclusive) feed Today and History.
- `checkin/CheckinCard.tsx`: Today's two questions. The sleep tap saves nothing; the second answer, in either order, saves
  both with a success haptic and the card turns into the done line, with Change (reopens the questions with the saved answers
  marked) and More details (opens `/checkin`). `checkin/Chip.tsx` is the 48 pt answer chip.
- `app/checkin.tsx`: the full check-in (sleep, its quality, stress, five optional facts, and the period question only when
  `profile.trackPeriod`). It is a transparent modal that draws its own scrim and bottom sheet with a grip: in Day the sheet
  slides up on a spring, in Dim and reduced motion it fades (Dim with an 8 pt rise). Tapping the scrim closes it. Save sends
  only the fields changed since it opened; the button cross-fades to Done with a check (settling from 0.9 in Day), held for
  a second, then the sheet closes.
- `cabinet/reminders.ts`: `syncReminders` cancels every reminder of the app and schedules again: a `DAILY` trigger for a
  daily medication, `DATE` triggers for the next three monthly or quarterly doses (`nextOccurrences`; a monthly anchor on the
  31st falls on the last day of a shorter month, and the wall clock is read in the device zone). The title is "Nimbo", the body
  the neutral line, or the medication's name only with the lock-screen detail on; `data` is empty. The Android channel is
  default importance with private lock-screen visibility. With no permission nothing is scheduled. `askNotificationPermission`
  asks only when the system still can; saving a schedule in the cabinet asks.
- `cabinet/ReminderSync.tsx` (mounted with Today's tree in `_layout.tsx`) syncs on mount, on each resume, and on any change to
  the medications, the lock-screen setting or the language, and when `askNotificationPermission` finds the permission
  granted (the first schedule is saved before the answer); unmounting, as a sign-out does, cancels everything. The root
  layout also cancels them at any launch whose gate target is not Today, for a sign-out made while the app was closed.
  `cabinet/nextPreventive.ts` gives the preventive dose still due today, for Today's medication card.

### Onboarding and Today (`src/onboarding/`, `src/today/`, `src/app/(tabs)/today.tsx`)

- `onboarding/introSeen.ts`: the device-wide `intro.seen` flag the gate reads. `onboarding/coarseLocation.ts`: `toCoarse`
  rounds to one decimal (about 11 km) and `captureCoarseLocation` asks for the foreground permission and reads the lowest
  accuracy fix, null when denied or unreadable; the area is written through `updateProfile` and never read back.
  `onboarding/OnboardingStep.tsx` is the frame the intro and the setup steps share (progress bars, Skip, title, docked actions).
- `today/todaySections.ts`: the section order. The priority sets the base (`fewer` and `triggers`: signals, check-in,
  medication; `overuse`: medication first; `logging` and none: signals, medication, check-in), a pending check-in moves up
  first, and medication above `ok` moves above everything. The new order snaps, with no layout animation.
- `today/StatusLine.tsx`: the status sentence (first day, an attack in progress with its running time, or no attack with when
  the last one ended), the open attack's card, and from 12 hours the "is it over?" question (`Not yet` waits for the next
  12-hour multiple, kept per attack in kv). `today/MedicationSummary.tsx`: the month's dose days per class against its limit,
  the most urgent overuse notice and the next preventive dose due today.
- `(tabs)/today.tsx` puts them together with the sync line and the AI-off card, and docks Start an attack (or Back to the
  attack) above the tab bar; starting writes the attack before opening crisis mode. The date follows a minute clock, so it
  turns over at midnight and on every return to the app.

### History and the episode screens (`src/history/`, `src/app/(tabs)/history.tsx`, `src/app/episode/`)

- `history/monthGrid.ts` is the calendar's grid: weeks of seven cells, Monday first, `null` outside the month (the month is
  0-based, as `Date`'s). A month can take six rows, as November 2026 does (30 November is a Monday).
- `history/filterEpisodes.ts` is the filter and the search, pure. The query is matched, accents and case folded with the
  pack's `normalizeText`, against the notes and the translated labels of the pain areas, symptoms and triggers, so "cafe"
  finds "Cafeína" in Spanish. The intensity, trigger, doses (linked by `episodeId`) and period (counted back from now)
  filters keep the order they are given.
- `history/HistoryCalendar.tsx` shows one month: an attack day carries its highest intensity as a number (the day's label
  says it too, so colour is never the only signal), a check-in day a dot, today a ring and later days are dimmed. The next
  month is disabled at the current one. Tapping an attack day lists its attacks below. The summary counts the attacks and the
  days with a dose in the month, each in its own plural form.
- `history/HistoryList.tsx` is a `FlatList` of month headings and rows, newest first, under the search field and the Filters
  button. Rows already there at first render do not animate; one that arrives later rises in. There is no layout animation.
  `history/EpisodeRow.tsx` is the row (date, times and intensity, main tags).
- `history/FilterSheet.tsx` edits a copy of the filter and names how many attacks it leaves on its Apply button. It draws its
  own scrim and bottom sheet inside a transparent `Modal` (no native sheet) with `ui/useSheetMotion.ts`, which
  `app/checkin.tsx` shares: the sheet slides in Day and Dark, and fades in Dim and with reduced motion. Only triggers the
  user has logged are offered.
- The History tab switches between Calendar and List. `?filter=doses` (the overuse notice's action) opens the list with
  doses and the last 30 days. "Patterns" joins the switch with the insights.
- `app/episode/[id].tsx` shows every field of an attack, its doses and Edit and Delete (an `Alert` first); the debrief rows
  wait for the debrief itself. `app/episode/[id]/edit.tsx` edits the times (`history/DateTimeField.tsx`: the native picker
  inline on iOS, the date then the time dialogs on Android), the intensity (`crisis/IntensityScale.tsx`), the four chip lists
  and the notes. An end before the start shows an error and disables Save; a time the store refuses (`RangeError`) is shown
  inline, never thrown from the press. Save sends only the fields that changed. When the notes changed, Save confirms for a
  second, goes back, and then runs the red-flag check on the saved notes; it still runs if the screen is left during that
  second. Urgent care's "It already ended" and crisis mode's "Fill in now" open this editor.

### Premium (`src/premium/`)

`usePremium()` asks `has_premium` for the signed-in user and keeps the last answer in the kv store under `premium.<userId>`, so an
offline launch shows the last answer; another user's cache is never read. `PremiumGate` renders its children for a premium user and a
quiet invitation (`premium.title`, `premium.body`, no price) for everyone else, and nothing while a first answer is out with no cache. The hook caches the last answer per user and refreshes only on mount or a user change; the server check is the authority. No feature is gated yet.

## Test helpers (`src/test/`)

`authMock.ts` stands in for `AuthProvider` in screen suites, `syncMock.ts` for `SyncProvider` in suites
that render the root layout, and `reanimatedMock.ts` replaces Reanimated under Jest. `sqliteNode.ts` is
expo-sqlite's synchronous API over `node:sqlite`, and `localDbTest.ts` empties the local store and
inserts mirror rows ([`testing.md`](testing.md)). `datetimepickerMock.ts` stands in for the native date-time picker (a view that
keeps its props, so a test can call `onValueChange`), and `episodeSeed.ts` makes attacks through the episode store.
