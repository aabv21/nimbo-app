# API: the Edge Functions

The app calls three Edge Functions: `companion`, and `push-claim` and `push-unregister` for its push token; a fourth,
`monitor`, is called only by the database's hourly job. Everything
else it reads and writes through PostgREST and the RPCs in [`database.md`](database.md). How the function works inside: [`ai.md`](ai.md) and
[`architecture.md`](architecture.md#the-companion-function).

## `companion`

`POST /functions/v1/companion` with the user's session token (`Authorization: Bearer <access token>`)
and the anon key (`apikey`). `verify_jwt` is on, so the gateway refuses a missing or invalid token
with its own 401 before the function runs. The app waits at most 45 s; the function answers within 40 s.

The types are in `supabase/functions/_shared/companion/contract.ts` (`CompanionRequest`,
`CompanionResponse`, `CompanionErrorBody`), which the app re-exports from `src/companion/contract.ts`.

### Request

```json
{
  "mode": "chat",
  "locale": "en",
  "localDate": "2026-11-27",
  "input": "text",
  "messages": [
    { "role": "user", "text": "How many attacks did I have this month?" }
  ],
  "episodeId": "3f0c1d9e-7a2b-4c55-9b1e-2d4f6a8c0e11",
  "timeZone": "America/Bogota"
}
```

| Field | Rule |
| --- | --- |
| `mode` | `chat` (the Companion tab), `crisis` ("Tell me" in crisis mode) or `debrief` (the day-after debrief). |
| `locale` | `en`, `es` or `pt`: the language on screen. The reply comes in it; the function never reads `profiles.language`. |
| `localDate` | The phone's day, a real `YYYY-MM-DD` from 2000 on. It is the quota's day, the tools' day (`get_episodes`' default end, the check-in window) and the prompt's "today". |
| `input` | `text` (typed) or `voice` (dictated). A voice message spends a dictation unit and a companion unit. |
| `messages` | 1 to 12 turns, the first and last from the user. Each `text` is 1 to 500 characters after trimming, 4,000 in all. The app sends the last turns of the chat it keeps on the phone. |
| `episodeId` | Optional: the attack the conversation is about. An id that is not the caller's reads as absent. Null is the same as leaving it out. |
| `timeZone` | Optional: the phone's IANA zone, a string of 1 to 64 characters (longer, empty or not a string is `400`). When the runtime knows it, the whole request uses it (the prompt's "now", the tools' times, the drafts); an unknown zone (`Mars/Base`) is ignored, not refused, and the profile's zone is used, so older builds keep working. Null is the same as leaving it out. |

### Response (200)

```json
{
  "reply": "You logged 3 attacks since 1 November.",
  "drafts": [],
  "evidence": [
    { "ref": "r1", "source": "episodes", "count": 3, "of": null, "episodeIds": ["…", "…", "…"], "doseIds": [] }
  ],
  "redFlags": [],
  "intent": "data_question",
  "guard": "ok",
  "replaced": null
}
```

| Field | Meaning |
| --- | --- |
| `reply` | Plain text, at most 500 characters (two sentences in crisis mode), with no ids, links or Markdown. Null when a red flag stopped the request or the guard replaced the reply; the app then shows its own text. |
| `drafts` | Up to 3 records the model proposed: `episode`, `dose` or `checkin`, with real ids for an existing attack or medication. Nothing is saved until the user taps Confirm. |
| `evidence` | What each number in the reply rests on: `count` of `of` (null for a plain count) and the attacks or doses behind it. The app shows them as chips. |
| `redFlags` | The warning signs the input screen found. When it is not empty, `reply` is null and the app opens urgent care. |
| `intent` | What the message was doing: `log_episode`, `end_episode`, `log_dose`, `log_checkin`, `data_question`, `general_question` or `other`. |
| `guard` | `ok` (a model screened the message and the reply), `replaced` (the reply broke a rule) or `degraded` (no model could screen it; the app adds the urgent-care footer). |
| `replaced` | When `guard` is `replaced`: the first guard key the reply broke, or `refusal` when Claude declined. Null otherwise. |

The 200 cases, each with its body:

**Answered.** As above. `guard` is `ok`, or `degraded` when both classifiers were down for the reply or
only the keywords screened the message (also when the day's 200 screening units are used up, which is never
a 429 of its own):

```json
{ "reply": "A dark, quiet room helped you before.", "drafts": [], "evidence": [], "redFlags": [], "intent": "general_question", "guard": "degraded", "replaced": null }
```

**A draft.** The reply says a draft is ready; the drafts carry what Confirm will save:

```json
{
  "reply": "A check-in draft is ready for you to check.",
  "drafts": [
    { "kind": "checkin", "ref": "d1", "localDate": "2026-11-27", "sleepBand": "5_6", "sleepQuality": null, "stress": "high",
      "lowWater": null, "extraCaffeine": null, "alcohol": null, "skippedMeal": null, "screenHeavy": null }
  ],
  "evidence": [],
  "redFlags": [],
  "intent": "log_checkin",
  "guard": "ok",
  "replaced": null
}
```

**Replaced.** The reply broke a rule. The original is neither returned nor kept; the drafts stay, the
evidence goes:

```json
{ "reply": null, "drafts": [], "evidence": [], "redFlags": [], "intent": "general_question", "guard": "replaced", "replaced": "dose_advice" }
```

**Refused.** Claude declined to answer:

```json
{ "reply": null, "drafts": [], "evidence": [], "redFlags": [], "intent": "other", "guard": "replaced", "replaced": "refusal" }
```

**Red flag.** No model reply and no companion quota (the message's screening unit is spent):

```json
{ "reply": null, "drafts": [], "evidence": [], "redFlags": ["fever_stiff_neck"], "intent": "log_episode", "guard": "ok", "replaced": null }
```

### Errors

Every other answer has a JSON body `{ "error": … }`, and a 429 also names the quota.

| Status | Body | When |
| --- | --- | --- |
| 400 | `{ "error": "invalid_input" }` | The body is not JSON, breaks a rule above, or broke off while streaming (the client went away). Nothing is spent. |
| 401 | `{ "error": "unauthorized" }` | No bearer token with a user id (the anon or service-role key alone). The gateway answers a missing or invalid token itself. |
| 403 | `{ "error": "ai_off" }` | The caller's `ai_enabled` is false, or their profile is missing. |
| 405 | `{ "error": "method_not_allowed" }` | Any method but `POST`. |
| 413 | `{ "error": "payload_too_large" }` | A body over 64 KiB (`MAX_BODY_BYTES`), whether declared by `content-length` or counted as a chunked body streams in; the rest is not read. The contract's 4,000 characters of turns, even all escaped as `\uXXXX`, come to about 26 KB. |
| 429 | `{ "error": "over_quota", "quota": "companion", "limit": 40 }` | Today's units of that kind are used up. `quota` is `dictation` (limit 20) when a voice message was refused first; then no companion unit was spent and typing still works. |
| 503 | `{ "error": "unavailable" }` | The profile, context or quota read failed or timed out, Claude failed or kept asking for tools, the reply came back empty, or the request ran out of time. Units already spent stay spent. |

Examples:

```http
HTTP/1.1 400
{"error":"invalid_input"}

HTTP/1.1 401
{"error":"unauthorized"}

HTTP/1.1 403
{"error":"ai_off"}

HTTP/1.1 405
{"error":"method_not_allowed"}

HTTP/1.1 429
{"error":"over_quota","quota":"dictation","limit":20}

HTTP/1.1 503
{"error":"unavailable"}
```

An error the handler does not catch is the runtime's own 500. The app reads 403 as the AI being off, 429
as that quota used up, any 5xx as unavailable, and any other 4xx, or a 200 body that fails
`isCompanionResponse`, as unknown, except that a body with a non-empty `redFlags` list of strings still opens
urgent care with the keys the app knows, so a newer server's flag is never lost ([`app.md`](app.md#companion-srccompanion)).

## `push-claim`

`POST /functions/v1/push-claim` with the user's session token; `verify_jwt` is on. It reclaims a push token another
account holds under another device secret, by proving this phone receives the token's pushes
(`supabase/functions/push-claim/handler.ts`; the tables and limits in [`database.md`](database.md#push-tokens)).
The app calls it when `register_push_token` answers `42501` and no claim for that account and token is pending, and again
at a launch at least 10 minutes after the last start, always with the claim's own nonce: a start the server refuses as too
soon keeps the earlier code and nonce.

| Step | Body | Answer |
| --- | --- | --- |
| Start | `{ "token": "ExponentPushToken[…]", "step": "start", "nonce": "<32–128 hex>" }` | `202 { "outcome": "accepted" }` whether or not a code went out (a token nobody holds, the caller's own, a limit reached). When `start_push_claim` allows it, a data-only push `{ type: 'push-claim', code, nonce }` goes to that token only: an 8-character code from `A–Z` and `2–9` without `O`, `I`, `0` or `1`, valid for 10 minutes. |
| Confirm | `{ "token", "step": "confirm", "code", "nonce", "device_secret": "<32–128 hex>", "platform": "ios" \| "android" }` | `200 { "outcome": "claimed" }` when the code matches the claim with that nonce (compared in constant time after the attempt is spent); the caller then holds the token under the new secret. A wrong code, a 6th attempt, an expired or missing claim: `403 { "error": "invalid_code" }`. |

Errors: `400 { "error": "invalid_body" }` for any other body or one that broke off while streaming, `401 { "error": "unauthorized" }` without a user token,
`413 { "error": "payload_too_large" }` for a body over 2048 bytes (declared or counted while streaming), `405` for a method other than `POST`, `500 { "error": "internal" }` when the database fails. Logs carry outcome words
only, never the token, code or secret.

## `push-unregister`

`POST /functions/v1/push-unregister` with only the anon key: `verify_jwt` is off, because the phone calls it after a
sign-out, when it has no session. Body `{ "token": "ExponentPushToken[…]", "user_id": "<uuid>", "device_secret": "<32–128 hex>" }`,
at most 1024 bytes. It deletes, with the service role, the named account's row holding that token under that secret's
SHA-256: knowing a token alone deletes nothing, and since the secret is device-wide, the account named keeps it from
reaching the row of the account signed in after on the same phone. It answers `204` with no body whether or not a row
matched, so it can't tell which tokens exist. `400 { "error": "invalid_body" }` for another body, one without a uuid
`user_id`, one that isn't JSON or one that broke off while streaming; `413 { "error": "payload_too_large" }` over the limit, declared or counted while a
chunked body streams; `405` for another method, `500 { "error": "internal" }` when the database fails (the phone keeps the
token and tries again at the next launch). The log line is `{"outcome":"unregistered"}`.

## `monitor`

`POST /functions/v1/monitor`, called at :05 every hour by the pg_cron job `monitor` through pg_net
(`request_monitor()`, [`database.md`](database.md#the-hourly-monitor)), never by the app. `verify_jwt` is off, since the
job has no user; instead the header `x-webhook-secret` must equal the function secret `MONITOR_SECRET`, compared in time that
depends only on the expected secret's length (`secretMatches`), and the job reads the same value from the Vault secret
`monitor_secret`. The body is ignored. Everything runs with the service role (`supabase/functions/monitor/handler.ts`):

1. **Receipts.** `push_receipts_due()` (tickets 15 minutes to 24 hours old), Expo's `getReceipts`, then the tokens whose
   receipt says `DeviceNotRegistered` are deleted and the checked tickets forgotten. A failure here logs
   `{"outcome":"receipts_failed"}` and the run goes on.
2. **Targets.** `monitor_targets()` page by page (1000 rows). A failed read answers `500 { "error": "internal" }`.
   The visit order starts one place further each hour (the hours since the epoch, modulo the number of targets) and
   wraps round, so a budget cut never falls on the same users every hour. Forecast lookups start at once, in that order,
   one per distinct cell, 4 at a time, for the users who chose `weather`; a lookup a user is waiting for goes ahead of the
   queued ones.
3. **Each target, one after another.** No user starts after `MONITOR_START_CUTOFF_MS` (90 s); the rest count as
   `skipped`. A zone this runtime cannot place in a day is skipped too. For each: `record_inputs` over the pack's
   90-day window; the cell's forecast when the user has coordinates and weather applies (chosen, or tagged on 3 attacks),
   waited for only until `FORECAST_WAIT_END_MS` (100 s), else no pressure signal; `computeSignals`; `save_signals`, which answers the
   push log; `decidePush` (with `quiet:never` dropped after a pushed dated stretch); on `send`, unless `MONITOR_BUDGET_MS`
   (110 s) has passed (then the signals stay saved and the next hour decides again), `claim_signal_push`, and
   with rows one message per token, `signalPushCopy` (the neutral title unless `lock_screen_detail`) with
   `data: { url: '/today', signalId }`; then `save_push_tickets` and the deletion of the tokens Expo answered
   `DeviceNotRegistered`. An error inside one user counts as `failed` and never stops the next. A claim whose send then
   fails stays stamped: that push is lost, never doubled.
4. **Reply.** `200 { "outcome": "done", "targets", "evaluated", "skipped", "failed", "signals", "pushed",
   "weather_fetches", "receipts_checked", "tokens_removed" }`: `signals` is the signals computed, `pushed` the messages
   Expo accepted, `weather_fetches` the requests that reached the forecast provider (cache hits excluded).

Other answers: `405 { "error": "method_not_allowed" }` for a method other than `POST`, `401 { "error": "unauthorized" }`
for a missing or wrong secret, both before any call. The log line is the outcome word and the same counts, never a user
id, a token, a zone or a signal.
