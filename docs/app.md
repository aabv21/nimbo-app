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
  `profile` holds language, appearance, reduce motion, the period question's opt-in (`trackPeriod`), the
  lock-screen detail, the medicine cabinet row, the AI switch, the "What I know about you" row and sign-out, which asks first while
  `useSyncState()` counts records not uploaded (pending or failed) and says they stay on this phone.
- `urgent-care.tsx`: the urgent-care screen for a red-flag hit ([Red flags](#red-flags-srcredflags-srcappurgent-caretsx)), registered with
  the tabs as a full-screen modal with no animation and no swipe to dismiss.
- `crisis.tsx`: crisis mode for the attack in `?id=` ([Attacks and crisis mode](#attacks-and-crisis-mode-srcepisodes-srccrisis-srcappcrisistsx)),
  registered with the tabs as a transparent modal with no native animation. The root layout also mounts
  the long-attack watch while the tabs are the allowed target.
- `memory.tsx`: "What I know about you", the agent's notes ([Agent notes](#agent-notes-srcmemory-srcappmemorytsx)),
  registered with the tabs. The root layout also mounts the language sync (`useLanguageSync`) while the tabs are the
  allowed target, keyed by account.
- `checkin.tsx`: the full daily check-in, a transparent modal that draws its own sheet; `cabinet/`: the medicine
  cabinet list and form, also registered during the medications setup step; `episode/`: an attack's detail and
  its editor. Each is described in its section below.
- `src/__tests__/` holds the tests that span routes.

## Auth (`src/auth/`)

- `AuthProvider.tsx`: the session status, user id, email and the profile. Starts from the stored
  session and cached profile, listens to Supabase auth events, reads the profile, and is the only
  writer of the profile cache. `useAuth()` exposes `refreshProfile` and `patchProfile`.
- `currentUser.ts`: `currentUserId()`, the account `AuthProvider` last reported, for work that settles after its screen
  has gone (a late companion answer checks it is still for the signed-in user). It is seeded from the stored session
  when the provider mounts, so a cold start does not read null until the first auth event.
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
- `useLanguageSync.ts`: keeps `profile.language` on the language the phone shows, on mount and on resume, with one save
  in flight at a time; on a device with no stored language preference it first adopts the profile's language, once
  ([Design decisions](architecture.md#design-decisions)).
- `tabs.ts`: `visibleTabs`.

## Languages (`src/i18n/`)

`en.ts` is the source catalog; `es.ts` and `pt.ts` must have the same keys. `resolveLocale` takes the
first supported primary language (`pt-PT` counts as `pt`) and falls back to `en`. `I18nProvider` keeps
the stored language preference (`system`, `en`, `es` or `pt`, kv `locale-preference`, device-wide), and
`hasStoredPreference()` says whether this device has one yet; `deviceLocale()` is the phone's language as resolved; `useI18n()` gives `t(key, params)` and
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
- Components: `Screen`, `DockedScreen` (a scrolling screen with its actions docked at the bottom, outside the
  scroll, so they stay in the thumb zone at every text size; Today and the onboarding steps use it), `Button`,
  `TextField`, `TextLink`, `Notice`, `ChoiceGroup`, `SwitchRow`, `CheckRow`, `CodeBoxes`, `BackButton`, `TabBar`
  (the floating Liquid Glass bar) and `TabScene` (a tab's entrance when it gains focus). Components read
  colours only from `useTheme()` and durations only from `useMotion()`. `Button` and `SwitchRow` pass an optional
  `testID` through for the Maestro flows.
- `useSheetMotion.ts`: the motion of a bottom sheet that draws its own scrim (the check-in and History's filters):
  a spring slide in Day, a fade with an 8 pt rise in Dim, a cross-fade with reduced motion.
- `Button`, `TextLink`, `CheckRow`, `CodeBoxes` and `BackButton` take an optional `testID`: a stable English id
  for the Maestro flows, never copy ([`testing.md`](testing.md#end-to-end-flows-maestro)).

## Library (`src/lib/`)

- `supabase.ts`: the one client, with a SQLite-backed session store, a request timeout, and
  foreground-only token refresh; `readStoredSession` and `clearPersistedAuth` read and clear it.
- `kv.ts`: the only caller of the on-device key-value store; `storedSession.ts` parses the persisted
  session; `fetchWithTimeout.ts`; `requestResult.ts` (the `network`, `invalid` and `unknown` kinds);
  `useOnResume.ts` (a retry hook for foreground and network return, told which it is); `useOncePerFocus.ts` (a press
  that opens another screen runs once until this screen is focused again, so a double tap never pushes twice, used by
  Today's dock and the check-in card); `localDate.ts` (the phone's
  calendar day, a check-in's `local_date`, and `deviceTimeZone()`, the one place the app reads the device's zone); `database.types.ts` is generated by `pnpm db:types`: do not edit it.

### Local store, outbox and sync (`src/lib/local/`, `src/lib/outbox/`, `src/lib/sync/`)

Health data is local-first: a screen writes the phone's copy and queues the RPC call in one SQLite
transaction, shows the change at once, and the outbox sends it when it can.

- `local/db.ts`: `localDb()` opens `nimbo.db` on first use and migrates it by `PRAGMA user_version`, now 3: version 1
  (`SCHEMA_V1`) creates the mirror tables `episodes`, `medications`, `doses` and `checkins`, with the server's columns
  (arrays as JSON text, booleans as 0 or 1), each row with its `user_id` and a `dirty` flag, and the `outbox`; version 2
  (`SCHEMA_V2`) adds the debrief columns (`episodes.helped`, `did_not_help` as JSON text defaulting to `'[]'`,
  `debriefed_at`, and `doses.helped` as 0, 1 or null) and the `chat_messages` table; version 3 adds
  `chat_messages.input` (`text` or `voice`, `text` for older rows). Every step a phone is missing runs in
  one transaction, so a version 1 phone keeps its rows and its unsent outbox. A shipped step is frozen; a change is a new one.
  `notifyChanged(tables)` tells readers a committed write changed those tables. `purgeUser(userId)`
  deletes a user's mirror rows except those still waiting to be sent (dirty, or with an unsent or failed
  operation), which survive until that user signs back in and sends them, and deletes all of their chat rows whatever is
  queued; it returns whether nothing of theirs is left queued. `purgeOtherUsers` runs it at launch for everyone but the
  signed-in user, chat-only users included, and returns them, so `SyncProvider` drops their cached notes and finished
  debriefs as a sign-out does.
- `local/useLocalQuery.ts`: `useLocalQuery(tables, read)` re-reads only when one of `tables` changes (or
  `read` is a new function). Every read filters by the user id, so two accounts on one phone never see
  each other's rows.
- `outbox/outbox.ts`: `enqueue(userId, kind, args)` is called inside the mirror write's transaction. It
  queues the call for one of the nine tracking RPCs (`log_episode`, `update_episode`, `end_episode`,
  `delete_episode`, `save_medication`, `log_dose`, `delete_dose`, `set_dose_helped`, `save_checkin`) and marks the row
  dirty (`set_dose_helped` marks the dose). The chat is never queued. The
  row stays dirty while any operation with its record key (the `p_id`, or `checkin:<local_date>`) is unsent,
  failed ones included. `listOutbox(userId)` returns that user's operations in order, and `resetFailed(userId)`
  puts them all back in line, due now, with fresh attempts.
- The tenth kind, `complete_onboarding` (args `{}`, record key `profile:onboarding`, no mirror row), finishes
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
  and `pauseOutbox` / `resumeOutbox` hold a user's queue. `outbox.ts`'s `wakeOffline(userId)` makes an
  operation that waits only because its sends got no answer (`no_responses > 0`) due now, keeping its
  answered attempts; `resetFailed` is the banner's "Try again". Each create RPC is idempotent on its id, so a
  call replayed after a lost response never duplicates a row. `rpcSender(client)` is the real `send`.
- `outbox/errors.ts`: `classifyRpcError`. No response (status 0, flagged `noResponse`) and 401 are retryable. The codes
  `22023`, `23514`, `23502`, `22P02`, `22001`, `22003`, `P0002` and `42501` are permanent, checked before
  the status because PostgREST answers `P0002` with a 500. Any other error is retried.
- `sync/pull.ts`: `pullAll(userId)` reads every row of the user, table by table, with an explicit column
  list (`PULL_COLUMNS`, the debrief columns included), paged at the API's 1000-row limit. It then writes them in one transaction, skipping dirty rows
  and rows with an unsent operation (so a local delete is not undone), deleting clean rows the server
  no longer has, and never touching another user's rows.
- `sync/SyncProvider.tsx`: mounted inside `AuthProvider`. It runs a cycle, push then pull, on sign-in,
  on resume, on reconnect (after `wakeOffline`) and after every `enqueue`. Cycles never overlap, and a
  request made during one runs one more. A timer wakes it when the head of the queue's backoff ends. On
  sign-out or an account switch it pauses the previous user's outbox and, once that and any running
  cycle have settled, purges their rows and, when nothing of theirs is left queued, their cached
  profile (`removeCachedProfile`); at launch it purges every other user's.
  `useSyncState()` gives `pending`, `failed`, `syncing` and `retry()`.
- `sync/SyncNotice.tsx`: the sync banner. It shows nothing while synced. After 600 ms of pending work it
  shows one muted line ("Saved on this phone, syncing · 2 records to upload"). With failures it shows a
  notice that asks for a tap on Try again (a failed operation is only sent again from there). Each state cross-fades at the theme's `base` duration.

## Condition pack (`src/condition/`)

Re-exports `supabase/functions/_shared/condition/` (the migraine catalogs, medication classes,
limits and red flags, `matchRedFlags`, `matchRedFlagsAnyLocale`, `normalizeText`, `emergencyNumber`, the dose-day maths
`doseDaysForMonth`, `localDateIn` and `daysLeftInMonth`, and `crisisPlan`). App code imports it from
here, never from `supabase/` directly. `crisisPlan(episodes, doses)` is pure: per relief key, the debriefed attacks it
helped in out of those it was tried in (in `helped` or `didNotHelp`); per medication, its doses that helped out of those
answered; only entries that helped at least once, ordered by ratio, then by how often they helped, then by key, each with
the attacks behind it (`episodeIds`) as evidence.

## Companion (`src/companion/`)

- `contract.ts`: re-exports `supabase/functions/_shared/companion/contract.ts`, the vocabulary the companion function and
  the app share: `MODES`, `GUARD_KEYS`, `INTENTS`, the drafts (`EpisodeDraft`, `DoseDraft`, `CheckinDraft`), `Evidence`,
  `Guard` and `ReplacedReason`; the request the app sends (`CompanionRequest`, at most `MAX_TURNS` turns of
  `TURN_MAX_CHARS`, `TOTAL_MAX_CHARS` in all, checked by `parseCompanionRequest`), the 200 body (`CompanionResponse`,
  checked by `isCompanionResponse`), the error body (`CompanionErrorBody`) and `QuotaKind`. `reply` is null when a red
  flag stopped the request or the guard replaced the reply; `guard: 'degraded'` means no model screened the reply.
- `chatStore.ts`: the chat on this phone only (`chat_messages`), never queued or synced, and removed by the sign-out purge.
  `appendMessage(userId, message)` stores a message in one statement, and the table's `chat_messages_keep` trigger keeps the user's last `CHAT_KEEP` (200); `updateMessage` changes a
  message's `status` or `payload` (drafts, evidence, the guard result and the record ids made on Confirm); `useChat`
  reads the last 200, oldest first (`readChat` and `readMessage` read the same without a hook, inside a transaction too).
  Assistant lines the app writes itself are stored as a `template` key with empty text, so they follow the UI language.
  Each message stores its `input` (`text` or `voice`, a column since local schema version 3); an answer carries its
  question's, so Retry after a restart still sends a dictated message as voice and its drafts are saved with the voice
  source. Its writes open no transaction of their own, so a store transaction can include them.
- `companionClient.ts`: `historyForRequest(chat)` sends back only answered turns (never a red-flag, unsent or replaced
  exchange, nor a template line), the newest 12 within 4,000 characters, each cut to 500, starting with a user turn.
  `askCompanion(request)` calls the `companion` function (45 s deadline from `fetchWithTimeout`) and never throws: a body
  that fails `isCompanionResponse` is `unknown` unless it holds a non-empty `redFlags` list of strings (a newer server's
  draft, intent or flag key): that answer is kept as a red flag, with the keys this version knows (`unchecked`), and
  urgent care opens even with none known. The body carries `timeZone: deviceTimeZone()`, so the server's "today", tool
  times and drafts follow the phone rather than a stale profile zone. 429 is `over_quota` with the `quota` and `limit` its body names, 403
  `ai_off`, any 5xx or a relay error `unavailable`, another 4xx `unknown`, and a failed or aborted fetch `network`.
- `useCompanion.ts`: `useCompanion(mode, { episodeId? })` runs a conversation. `send(text, input)` returns the stored
  message's id (null for a red flag or empty text) and runs
  `useRedFlagCheck` first, whatever else is going on: a hit stores the message as `red_flag` and sends nothing. One
  request is in flight app-wide, so a message sent meanwhile, or while the companion quota is used up, is stored as
  `unsent` with Retry rather than dropped. Otherwise the message is stored as `sent` and asked with the device's day
  (`companionDay()`) and the UI locale. A server red flag opens urgent care with the same excerpt a phone hit shows
  (`excerptOf`) and stores the `redflag_after` line; a replaced reply is stored with empty text, its reason and any
  drafts, and the question is marked `replaced` too so neither goes back to the model. A failure marks the message
  `unsent` with Retry, which resends a dictated message as voice (as text once dictation is used up today, since the
  words are already text) and is disabled over the quota; `unavailable` shows the down state until the app returns to the
  foreground or the network comes back (`useOnResume`), `ai_off` refetches the profile (the tab then disappears), and a
  429 stores the limit under kv `companion.quota.<kind>.<userId>.<day>`: `companion` closes the input for the day
  (`overQuotaToday`), `dictation` only turns the mic off (`dictationOver`). A message left `sent` by a killed app shows
  as unsent on the next mount, and an answer that arrives once another account is signed in (`currentUserId()` from
  `src/auth/currentUser.ts`) or after a sign-out purged the chat is dropped, urgent care included. `confirm(messageId, ref)` makes the record id (and the
  dose ids) on the first tap, with the `voice` source when the message was dictated (`chat` otherwise), and, in one `withTransactionSync`, stamps `payload.confirmed[ref]` and runs `applyDraft`, so a
  second tap, a remount or a kill can never leave the stamp without its records or the reverse; a store `RangeError`
  rolls both back and returns `'invalid'`. `replaceDraft` saves the Edit sheet's changes to an unconfirmed draft.
- `applyDraft.ts`: the only path from a draft to records, inside the caller's transaction. A new attack is
  `logEpisodeTx` with the record id, then what helped or did not, then `logDoseTx` per dose;
  a change to an attack adds the named tags to those already logged (a draft never erases) and moves the start, sets the
  end and the intensity in one `updateEpisodeTx` patch (so the pair is checked together), then merges what helped. What
  helped is stamped as debriefed (`saveDebriefTx`) only when the attack has ended or the draft ends it; on an attack
  still open only the lists are patched, so the day-after debrief is still asked. A dose is `logDoseTx` with the record
  id, refused with a `RangeError` (so `draft.error`) when its attack is no longer on the phone; a check-in is
  `saveCheckinTx` with only the answers said.
- `debrief.ts`: the day-after debrief's rules, pure. `debriefDue(episodes, now, timeZone, skipped)` picks the attack that
  ended last on a local day before today (yesterday's only from `DEBRIEF_FROM_HOUR`, 05:00, so "Good morning" holds)
  and at most `DEBRIEF_MAX_AGE_DAYS` (3) ago, not debriefed and not marked done on this phone. `debriefChips(step, …)` gives each question's chips: what
  helped offers the attack's reliefs, then its medications (one chip per medication, keyed by its id, labelled with its
  name), then the pack's other reliefs; what did not help offers the same less the first answer; the third question
  offers the pack's triggers. `debriefGreetingKey` greets "yesterday" or names the date.
- `debriefDone.ts`: the attacks whose debrief was finished on this phone, as one JSON list of ids (the last 20) under
  kv `debrief.done.<userId>`: `markDebriefDone`, `readDebriefsDone`, and `removeDebriefsDone`, which the sign-out
  cleanup in `SyncProvider` calls next to the cached notes.
- `DebriefCard.tsx`: the debrief in the chat, after the newest message. Each question shows "Question n of 3", its chips
  (plus "Nothing" on the first two) and Skip and Send; the answer then shows as the user's bubble and the next question
  rises in. The greeting's duration and date come from the attack. After the third answer (or its skip) one
  `saveDebrief` writes the reliefs, the added triggers, the stamp, and each dose of a picked medication as helped (first
  question) or not (second); skipping all three still stamps the attack with empty answers. The attack is then marked
  done (`markDebriefDone`), so a stamp the server refused cannot bring the question back; a kv failure there is caught
  and the debrief still ends. Send turns into a check and "Done" for a second, then the
  card leaves and the `debrief_done` line goes into the chat (also if the tab is left during that second). A store
  refusal shows `boundary.error` and keeps the last question to try again.
- `safeFacts.ts`: the facts a replaced dose answer may still show: the latest acute dose of the 24 h before the reply
  whose medication has an interval, with that interval in hours.
- The tab (`src/app/(tabs)/companion.tsx`) has Today's start (or return to) an attack in its top bar, a due debrief
  (`DebriefCard`; while it asks its questions, typed words go in `debrief` mode with the attack's id, after the same
  red-flag check; during its saved confirmation they go in `chat` mode),
  and its parts: `MessageList` (an inverted `FlatList` with day dividers; new
  items rise in and nothing else moves, and the typing line mounts only after 300 ms), `EvidenceChips` and
  `EvidenceSheet` (the attacks behind a number from the local mirror, an insight's included (an insight resting on no attack gets no chip), each opening `/episode/<id>`, or the doses behind
  an overuse count), `DraftCard` (the draft field by field, "You didn't say" for a missing core field, the cabinet's dose
  text with its attribution, and `draft.error` when Confirm was refused), `DraftEditor` (a sheet that edits the draft,
  never a record), `Composer` (grows with its text, 500 characters, with the hold-to-dictate mic: a transcript fills the
  field and waits for Send, which then spends a dictation unit and a companion unit; a transcript holding a red flag is
  sent at once, so urgent care opens and nothing reaches the companion; with `dictationOver` only the mic is disabled,
  with `voice.quota` as its hint and as a visible line under the row; a dictation problem shows above the field) and `CompanionStates` (the suggestions, and the
  offline, unavailable and over-quota notes with the manual dose and check-in). A replaced reply renders the safe
  template for its reason, and a degraded one carries the urgent-care footer.

## Agent notes (`src/memory/`, `src/app/memory.tsx`)

The companion's notes about how the user likes things (`agent_notes`), the agent's only long-term memory. Only the
`companion` function writes them, so the phone reads them online and has no outbox for them.

- `agentNotesRepository.ts`: `fetchAgentNotes()` reads `id,text,created_at` newest first (row-level security scopes it to
  the signed-in user) and `deleteAgentNote(id)` calls `delete_agent_note`; both return a `RequestResult` and never touch
  the cache. The cache is kv `memory.<userId>` (`readCachedNotes`, `writeCachedNotes`); only the sign-out cleanup in
  `SyncProvider` calls `removeCachedNotes`, whatever the outbox holds, since the notes are the user's words about
  themselves.
- `useAgentNotes.ts`: `useAgentNotes(userId)` shows the cached copy at once and reads the server's on every focus and
  resume; a live list is written back to the cache. A delete removes the note at once and puts it back in place, with
  `deleteFailed`, if the RPC fails; deletes are possible only while this visit's read succeeded (`live`). Callers key it
  by account, and an answer that settles once another account is signed in (`currentUserId()`) is dropped, never shown
  or cached.
- `src/app/memory.tsx`: the lede and the notes, each with a 48 pt delete button (labelled `memory.delete`, the note
  as its hint), or `memory.empty`; offline, the cached list with deletes disabled under the network notice; and the
  `memory.only` line. Profile's row (`profile.memory` with the plural `profile.memory.count`) shows with the AI on or
  off and opens it through `useOncePerFocus`.

## Voice (`src/voice/`)

Dictation and spoken replies, copied from the Dressing Room demo's pattern and changed to press-and-hold.

- `dictation.ts`: `useDictation(onHeard)` over `expo-speech-recognition`, with `start` (press in), `finish` (release:
  the recognizer's final segments, joined, go to `onHeard`) and `cancel` (aborted; `onHeard` never runs). One
  module-level session owns the recognizer, and an aborted session's late `end` is counted and ignored. The microphone
  permission is asked on the first press. iOS always recognizes on the device (`requiresOnDeviceRecognition: true`);
  Android uses the phone's default recognizer, offline when `getSupportedLocales` lists the language as installed (else
  the audio goes to Google's recognizer). `dictationAvailable()` is false with no recognizer, or on iOS without
  on-device recognition, and then no mic shows anywhere.
  Recognition is `continuous`, so a pause never ends it before the finger lifts. `recognitionLanguage(locale, tags)`
  picks the device's own regional variant of the app language (`es-CO`), else `en-US`, `es-MX` or `pt-BR`. A refused
  permission is `denied`, a recognizer error `failed`, and a session that heard nothing, or a tap released before the
  recognizer started, `noMatch` (`voice.denied`, `voice.failed`, `voice.no_match`).
- `HoldToTalk.tsx`: the held mic, on the responder system: press in starts, release finishes, and a slide up of 48 pt
  (`CANCEL_DISTANCE`) or a lost touch cancels. `size` `crisis` is the 56 pt dock button with its hint under the label,
  and while held it reads `crisis.listening.held` with `crisis.listening.cancel` above it; `regular` is the 48 pt mic in
  the Companion input row. A screen reader's activate starts it, and a second one finishes. Nothing renders on a phone
  with no recognizer.
- `speech.ts`: `pickVoice(voices, locale)` prefers `en-US`, Latin American Spanish (`es-MX`, `es-US`, `es-419`) and
  `pt-BR`, an enhanced voice first; `useSpeaker(text, { autoPlay })` reads one utterance at a time app-wide and stops on
  blur or unmount; `autoPlay` never speaks while a mic listens (`setMicListening`), and dictation calls `stopSpeaking`
  so the recognizer never hears the app. `ListenButton.tsx` is the `crisis.read_aloud` toggle, hidden when the phone has
  no voice in the app language; `size` `crisis` makes it 56 pt.

## Red flags (`src/redflags/`, `src/app/urgent-care.tsx`)

The pack lists seven red flags (`redFlags`): `thunderclap`, `weakness`, `fever_stiff_neck`,
`head_injury`, `pregnancy`, `long_aura` and `long_attack`. Each has the message key of its "why"
line, a yes/no question for a model screen, and whole-phrase keywords per language; `long_attack` has
none, because it is raised from an open episode's length. A flag can also list `allOf` term groups
that raise it only together: `fever_stiff_neck` needs a fever term and a neck-stiffness or
severe-headache term, because either alone is common in an ordinary attack. `matchRedFlags(text, locale, pack)`
normalizes the text and each keyword the same way (lower case, accents folded, anything but letters
and digits as one space) and returns the hits in pack order. `matchRedFlagsAnyLocale(text, pack)` does
the same over the en, es and pt lists at once (an `allOf` group counts with a phrase from any language). The fixtures in `calibration/` are the messages it must
catch, and the ordinary attack descriptions it must not, under each locale and under the union.

- `src/redflags/useRedFlagCheck.ts`: `useRedFlagCheck()` gives `(text, source) => boolean`. It matches all
  three languages whatever the app's language, since people write in the language they think in and a
  miss costs more than a rare false hit. On a hit it opens urgent care with the sentence that hit (160
  characters at most); `excerptOf` is exported so a red flag the companion function finds shows the same excerpt.
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
medical emergency number, or `null`; the numbers, their official sources and the regions left out are in
[`architecture.md`](architecture.md#red-flags-and-urgent-care).

## Medicine cabinet and overuse guard (`src/cabinet/`, `src/app/cabinet/`)

Medications and doses live in the local mirrors and reach the server through the outbox.

- `medicationStore.ts`: `saveMedication(userId, id, fields)` upserts the mirror row and queues `save_medication` in one
  transaction (the form's interval in hours is stored as whole minutes, the name trimmed). An empty name, or one over
  `NAME_MAX_LENGTH` (80), or a dose over `DOSE_MAX_LENGTH` (120) is a `RangeError` before anything is written, as the
  server would refuse it for good; the form uses the same limits. `useMedications` hides archived ones unless
  asked; `useMedication` reads one.
- `doseStore.ts`: `logDose` makes the id on the phone unless one is given (a confirmed draft brings its own; an id already
  on the phone is a no-op), so a retried send cannot log twice, leaves `p_episode_id` out for a dose with no episode, and
  refuses with a `RangeError` a time before 2000 or more than 5 minutes ahead, the same `checkedTime` (`src/lib/local/clientTime.ts`) the episode store uses.
  `setDoseHelped(userId, doseId, helped)` queues `set_dose_helped`, leaving `p_helped` out for null; a dose that is not the
  user's is a no-op. Both have `…Tx` twins (`logDoseTx`, `setDoseHelpedTx`); `deleteDose` removes the row and queues `delete_dose`; `useDoses` filters by episode or medication.
- `doseDays.ts`: re-exports the pack's dose-day maths, so the companion counts overuse as Today does. `doseDaysForMonth` lists the distinct local dates with an acute dose per class in the calendar month of a
  date, read in a given time zone, so 23:59 on 30 November is November. Archived medications count; preventive ones do not.
  `daysLeftInMonth` is the whole days after today.
- `OveruseNotice.tsx`: `mostUrgent` picks one notice (a limit over a warning, a class over the combined count) and the
  component shows it; its action opens `/history?filter=doses`.
- The guard itself is `overuseStatus` in the condition pack: the per-class ICHD-3 limits of 8.2.1 to 8.2.5 plus the combined
  limit of 8.2.6 ([`architecture.md`](architecture.md#medication-overuse-guard)).
- `src/app/cabinet/index.tsx` lists acute and preventive medications with each class's days; `[id].tsx` adds (`new`) or
  edits one and archives it after a confirmation. Profile has a row that opens the cabinet.

## Attacks and crisis mode (`src/episodes/`, `src/crisis/`, `src/app/crisis.tsx`)

- `episodes/episodeStore.ts`: every writer the companion composes has a `…Tx` twin (`updateEpisodeTx`, `endEpisodeTx`,
  `logEpisodeTx`, `saveDebriefTx`) that validates, then writes, inside a transaction the caller opened; the public name is
  that twin in its own transaction, because expo-sqlite's `withTransactionSync` does not nest. `startEpisode(userId, now?)` writes the mirror row and queues `log_episode` in one
  synchronous transaction before it returns, with the id made on the phone, so a kill after the tap loses nothing and a
  replayed send cannot log twice; an open attack is returned instead of a second one. `updateEpisode` patches only the
  keys given, the start included (people log late). It and `endEpisode` refuse, with a `RangeError` before anything is
  written or queued, a time later than now plus 5 minutes (the server stores one up to a day ahead as now, for a phone
  clock running fast) or before 2000, an end before the start, or notes over `NOTES_MAX_LENGTH` (2,000, the server's
  limit, which would refuse the whole patch for good), an intensity outside 0–10, or a key outside the pack or repeated.
  The patch also takes the debrief: `helped`, `didNotHelp` and `debriefed` (`true` stamps `debriefedAt` once, as the server
  does, and `false` clears it). `logEpisode(userId, id, input)` logs a whole attack told to the companion with an id made
  beforehand (an id already on the phone is a no-op); an open attack while another is open is a `RangeError`.
  `readEpisode(userId, id)` reads one attack without a hook, inside a transaction too.
  `saveDebrief(userId, episodeId, answers)` writes the reliefs, adds the answered triggers to those logged, sets
  `debriefed` and whether each dose helped, all in one transaction. `deleteEpisode`
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
  Android's back button (`BackHandler`) runs the same close, after first closing the head map or the end question;
  the fade's end leaves once (a ref guards it), with `router.back()`, or `router.replace('/today')` when there is
  nothing to go back to.
  Confirming an end never throws: a refused time, the default "now" included, shows the sheet's inline error. With the
  AI off, a line under the symptoms says everything is logged with taps, "Tell me" is absent, and the ended view leaves
  out `crisis.ended.debrief`.
- `crisis/TellMe.tsx`: "Tell me", the held mic in the dock beside "It's over" (`useTellMe`, `TellMePanel` under the
  timer, `TellMeDock`). A transcript goes through `useRedFlagCheck` first: a hit opens urgent care once and nothing is
  sent or saved. Then, when the companion can answer, it is sent in `crisis` mode as `voice` with the attack's id, and
  the reply shows with `ListenButton`; the reply's first unconfirmed draft takes the screen and the dock (Edit and
  Confirm, through `DraftEditor` and `useCompanion`'s `confirm`) until it is confirmed or put aside ("Not now", or
  Android's back), and stays in the Companion tab unconfirmed. Offline, unavailable, over either quota, or refused on
  the way, the transcript is appended to the attack's notes through `updateEpisode` instead (`appendToNotes`: the notes,
  a newline, then the transcript, cut to `NOTES_MAX_LENGTH` and never through an emoji). The line says what happened:
  `crisis.tell.saved_note`, `crisis.tell.saved_cut` when only the start fit, `crisis.tell.notes_full` with no room
  (nothing written), `crisis.tell.gone` when the attack is no longer on the phone, or `error.generic` for any other
  store refusal. A message refused on the way is then marked `noted` in the chat, so the Companion tab shows
  `companion.in_notes` and no Retry. While held, the line under "Listening" is `crisis.listening.release` on the
  companion's path and `crisis.listening.release_notes` on the notes path. "Read aloud" and "Not now" are 56 pt.
  "Tell me" shows only with the AI on and `dictationAvailable()`; otherwise "It's over" has the whole dock.
- `crisis/WhatHelped.tsx`: "What helped before", the top three `crisisPlan` entries from the phone's debriefed attacks
  and doses (archived medications left out), with "Helped n of m times". A relief's "Doing it now" toggles the key in
  the attack's `reliefs`; a medication's action is its `DoseButton`, with the Maestro ids `dose-helped-log` and
  `dose-helped-change` (`inPlan`) so it never shares `dose-log` with the Doses section. Hidden when the plan is empty; it is code over
  local data, so it shows with the AI off and offline.

## Daily check-in and preventive reminders (`src/checkin/`, `src/cabinet/reminders.ts`, `src/app/checkin.tsx`)

- `checkin/checkinStore.ts`: `saveCheckin(userId, localDate, fields)` merges only the keys given into the day's mirror row
  and queues one `save_checkin` with those keys, in one transaction (`saveCheckinTx` is the same inside a caller's). A date the server would refuse (before 2000, more than
  a day past the UTC date, not a real day) is a `RangeError` before anything is written. `useCheckin`, `isCheckinDone` (sleep
  band and stress both set) and `useCheckinDates` (local dates with a check-in, inclusive) feed Today and History;
  `useCheckins(userId, from, to)` (the rows, oldest first, inclusive) feeds the insights.
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
  granted (the first schedule is saved before the answer); unmounting, as a sign-out does, cancels everything, and
  `clearReminders` also dismisses the delivered ones (identifiers starting `preventive-reminder:`) from the tray. The root
  layout also cancels them at any launch whose gate target is not Today, for a sign-out made while the app was closed.
  `cabinet/nextPreventive.ts` gives the preventive dose still due today, for Today's medication card.

## Onboarding and Today (`src/onboarding/`, `src/today/`, `src/app/(tabs)/today.tsx`)

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

## History and the episode screens (`src/history/`, `src/app/(tabs)/history.tsx`, `src/app/episode/`)

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
- The History tab switches between Calendar, List and Patterns (`history-view-insights`, the insights below). `?filter=doses`
  (the overuse notice's action) opens the list with doses and the last 30 days. Patterns recomputes when a record changes
  or the hour turns.

## Insights (`src/insights/`)

- `index.ts` re-exports `supabase/functions/_shared/insights.ts` (`computeInsights`, `insightNeeds`, `INSIGHT_KINDS`) and
  `_shared/records.ts` (`Records`, `RecordInputs`, `parseRecordInputs`, `trackingSinceOf`), so the phone and the companion's
  `get_insights` count with the same code.
- `useRecords.ts`: `useRecords(userId)` turns the local mirror into `RecordInputs`, cut to the window `record_inputs` gives
  the server (366 days, open attacks kept), archived medications included, with the profile's known triggers and onboarding
  time. Its zone is the device's (`deviceTimeZone()`), or UTC when the runtime does not know it (`usableZone`), since the
  insights' date maths throws on an unknown zone; it is read on every render, so Patterns follows a trip. `hasLocation` is false: the phone never reads its saved area back.
- `insightText.ts` chooses every word of a card, pure, so it is tested without rendering: `cardLines(insights, ctx)` gives a
  kind's title, labelled bars, rows to read aloud, the pattern sentence (only when `pattern` is true), the caution under
  triggers and sleep, and the basis line; `insightLines(insight, ctx)` is the same for one insight and `needLine(need, t)`
  says what a kind still needs (with the plural helper, the noun following its own count). Months come from `Intl`, hours from the pack's buckets, averages in the locale's decimal
  separator, counts through the plural helper; never a percentage.
- `InsightCards.tsx` renders the kinds in `INSIGHT_KINDS` order, each as its counts (months, parts of the day and weekdays
  as labelled columns, the rest as labelled meters) or as `NeedCard.tsx` (its title and what it needs, no number of its
  own), with `insight.need.hint` once under the needs, or `insight.empty` when there is neither (a guard: real records
  always give the monthly card or its need). The streak's large figure is hidden from screen readers, as its sentence says
  the number; column labels may take two lines. Sections present on mount snap in; one that appears later rises
  once (`LayoutAnimationConfig skipEntering`), with no looping motion.
- `app/episode/[id].tsx` shows every field of an attack, its doses and Edit and Delete (an `Alert` first), with the
  debrief's rows: "Helped, from your debrief" and "Didn't help", each with the reliefs and then the medications whose
  doses were marked. `app/episode/[id]/edit.tsx` edits the times (`history/DateTimeField.tsx`: the native picker
  inline on iOS, the date then the time dialogs on Android), the intensity (`crisis/IntensityScale.tsx`), the four chip lists,
  what helped and what did not (the pack's reliefs; a relief picked in one list leaves the other) and the notes. With the
  AI off these two lists are the debrief: a change to either is saved whole, with `debriefed: true`, in the same patch as
  the other edits, so the screen's `RangeError` handling covers it. An end before the start shows an error and disables Save; a time the store refuses (`RangeError`) is shown
  inline, never thrown from the press. Save sends only the fields that changed. When the notes changed, Save confirms for a
  second, goes back, and then runs the red-flag check on the saved notes; it still runs if the screen is left during that
  second. Urgent care's "It already ended" and crisis mode's "Fill in now" open this editor.

## Premium (`src/premium/`)

`usePremium()` asks `has_premium` for the signed-in user and keeps the last answer in the kv store under `premium.<userId>`, so an
offline launch shows the last answer; another user's cache is never read. `PremiumGate` renders its children for a premium user and a
quiet invitation (`premium.title`, `premium.body`, no price) for everyone else, and nothing while a first answer is out with no cache. The hook caches the last answer per user and refreshes only on mount or a user change; the server check is the authority. No feature is gated yet.

## Test helpers (`src/test/`)

`authMock.ts` stands in for `AuthProvider` in screen suites, `syncMock.ts` for `SyncProvider` in suites
that render the root layout, and `reanimatedMock.ts` replaces Reanimated under Jest. `sqliteNode.ts` is
expo-sqlite's synchronous API over `node:sqlite`, and `localDbTest.ts` empties the local store and
inserts mirror rows ([`testing.md`](testing.md)). `datetimepickerMock.ts` stands in for the native date-time picker (a view that
keeps its props, so a test can call `onValueChange`), `episodeSeed.ts` makes attacks through the episode store, and
`dictation.ts` drives the mocked speech recognizer (its events, a heard transcript, a press that settles).
