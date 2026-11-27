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
- `(auth)/`: `sign-in`, `sign-up`, `confirm-email` (the 6-digit code, with resend) and `reset`.
- `welcome/`: `boundary` (adult confirmation and the not-a-medical-device boundary, `accept_terms`) and
  `ai-consent` (`set_ai_consent`), each registered only while it is the one due; no back gesture.
- `(tabs)/`: `today`, `companion`, `history`, `profile` behind a headless tab shell with the floating
  bar. The tab list comes from `visibleTabs`, so Companion has no trigger when the AI is off, and the
  shell renders nothing for a route without a trigger.
  `profile` holds language, appearance, reduce motion, the AI switch and sign-out.
- `urgent-care.tsx`: the urgent-care screen for a red-flag hit ([Red flags](#red-flags)), registered with
  the tabs as a full-screen modal with no animation and no swipe to dismiss.
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
  queues the call for one of the eight tracking RPCs and marks the row dirty. The row stays dirty while
  any operation with its record key (the `p_id`, or `checkin:<local_date>`) is unsent, failed ones
  included. `listOutbox(userId)` returns that user's operations in order, and `resetFailed(userId)` puts
  them all back in line, due now, with fresh attempts.
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

## Test helpers (`src/test/`)

`authMock.ts` stands in for `AuthProvider` in screen suites, `syncMock.ts` for `SyncProvider` in suites
that render the root layout, and `reanimatedMock.ts` replaces Reanimated under Jest. `sqliteNode.ts` is
expo-sqlite's synchronous API over `node:sqlite`, and `localDbTest.ts` empties the local store and
inserts mirror rows ([`testing.md`](testing.md)).
