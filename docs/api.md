# API: the Edge Functions

The app calls five Edge Functions: `companion`, `push-claim` and `push-unregister` for its push token, and `export-data`
and `delete-account` for the user's data rights; a sixth, `monitor`, is called only by the database's hourly job. Everything
else it reads and writes through PostgREST and the RPCs in [`database.md`](database.md). How the function works inside: [`ai.md`](ai.md) and
[`architecture.md`](architecture.md#the-companion-function).

Across all six: every error body is a fixed word, `{ "error": "<word>" }`, with no upstream status or detail; no function
sets a CORS header (the clients are the phone and `pg_net`; the gateway answers browsers with its platform-wide
`Access-Control-Allow-Origin: *`, never with credentials); and `verify_jwt` is on for every function that reads the
caller from the token. The audits behind these rules: [`audits/security.md`](audits/security.md) and
[`audits/api.md`](audits/api.md).

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

## `export-data`

`POST /functions/v1/export-data` with the user's session token; `verify_jwt` is on. It answers everything the server keeps
about the caller as one JSON document (`supabase/functions/export-data/handler.ts`; the privacy policy's "Export my data"
lists the same). The body is ignored; one over 256 bytes is refused unread.

Each table is read page by page (`limit=1000`, then the next `offset`, until a page comes back empty, so a hosted
`max_rows` under 1000 still reads every row) with `user_id=eq.<the JWT's sub>`, and a row whose `user_id` is anyone
else's is dropped even if a read returned it. Every read goes with the caller's token, so RLS applies, except
`usage_counters`, which no client may read: that one goes with the service role, filtered by the same verified uid. The
account comes from `GET /auth/v1/user` with the caller's token and must name the caller.

| Key | Content |
| --- | --- |
| `schemaVersion` | `1` |
| `exportedAt` | The server time, ISO 8601. |
| `termsVersion`, `aiConsentVersion` | The profile's accepted versions, or null. |
| `account` | `{ email, createdAt, lastSignInAt, providers }`; `providers` is Auth's `app_metadata.providers` (`email`, `google`, `apple`). |
| `profile`, `entitlement` | The `profiles` row (`*`, the coarse area included) and the `entitlements` row, or null. |
| `episodes`, `medications`, `doses`, `checkins`, `agentNotes`, `signals`, `consentEvents` | Every row (`*`, archived medications included), ordered by `started_at,id`; `created_at,id`; `taken_at,id`; `local_date`; `created_at,id`; `computed_at,id`; `created_at,id`. |
| `usageCounters` | Every `usage_counters` row still kept (30 days), ordered by `day,kind`. |
| `pushDevices` | `push_tokens` read as `user_id,platform,updated_at` only, ordered by `updated_at,platform,token` (the token orders the pages, unique per user, but is never selected): never the token or `device_secret_hash`, which never leave the database. |

`push_claims`, `push_claim_starts` and `push_tickets` are left out on purpose: transient security and delivery data,
kept an hour or two days. `EXPORTED_TABLES` and `EXCLUDED_TABLES` in the handler list them; the unit test requires them
to equal the list pgTAP pins as every `public` table with a `user_id` ([`database.md`](database.md#account-deletion-and-export)).
The 200 carries `cache-control: no-store`, since the file holds health data. The chat is not
in the file: it lives only on the phone.

Errors: `405 { "error": "method_not_allowed" }` for a method other than `POST`, `401 { "error": "unauthorized" }` without
a user token (the gateway answers a malformed or expired one first) or when Auth refuses the token's session (signed out,
`session_not_found`; `session_expired`; `bad_jwt`), logged `refused`, `413 { "error": "payload_too_large" }` for a body over
256 bytes (declared or counted while streaming), `400 { "error": "invalid_body" }` for one that broke off while streaming,
and `500 { "error": "internal" }`, with no detail, when Auth or any read fails: a partial file is never sent. The log line
is `{"outcome":"exported"}`, `{"outcome":"refused"}` or `{"outcome":"error"}`.

## `delete-account`

`POST /functions/v1/delete-account` with the user's session token; `verify_jwt` is on. It deletes the caller's account; the
database's `on delete cascade` foreign keys then remove every row of theirs in all 14 user tables at once
([`database.md`](database.md#account-deletion-and-export)). The uid is always the verified JWT's `sub`. The body is ignored;
one over 256 bytes is refused unread.

1. `GET /auth/v1/user` with the caller's token (10 s deadline, `AUTH_TIMEOUT_MS`). Only Auth's `error_code: "user_not_found"`
   means the account is already gone: `200 { "outcome": "deleted" }` (logged `already_deleted`), with no admin call. Any
   other failure, a bare 404 included (a misrouted gateway answers 404 too), or a body naming another id, is a `500`: the
   function never reports a deletion on an answer it can't trust.
2. `DELETE /auth/v1/admin/users/<uid>` with the service role (10 s deadline). A 404 means an earlier attempt deleted the
   user: `200 { "outcome": "deleted" }`. Any other non-2xx is `500 { "error": "internal" }`.
3. `200 { "outcome": "deleted" }`.

A retry is always safe: after a cut connection the phone calls again with the same token, and step 1 answers `deleted`.
Sign in with Apple has no revoke step while iOS is parked. A monitor run that read its targets before the deletion finds
nothing to save or claim for that user and sends nothing ([`database.md`](database.md#account-deletion-and-export)).
Auth's own `auth.audit_log_entries` are not linked to the user and keep the email after the deletion; the privacy policy
discloses them as sign-in security logs.

Errors: `405`, `401` (a refused session included, logged `refused`, with no admin call), `413` and `400` as for `export-data`, and `500 { "error": "internal" }` with no detail. The phone reads a `401` as "sign in again" unless Auth says the user is gone. The log line
is the outcome word only: `deleted`, `already_deleted`, `refused` or `error`.

## `monitor`

`POST /functions/v1/monitor`, called at :05 every hour by the pg_cron job `monitor` through pg_net
(`request_monitor()`, [`database.md`](database.md#the-hourly-monitor)), never by the app. `verify_jwt` is off, since the
job has no user; instead the header `x-webhook-secret` must equal the function secret `MONITOR_SECRET`, compared in time that
depends only on the expected secret's length (`secretMatches`), and the job reads the same value from the Vault secret
`monitor_secret`. While `MONITOR_SECRET` is shorter than 32 characters (`MIN_MONITOR_SECRET_LENGTH`) every call answers
`401 { "error": "unauthorized" }`, logged `misconfigured`, so a guessable secret fails closed. The body is ignored. Everything runs with the service role (`supabase/functions/monitor/handler.ts`):

1. **Receipts.** `push_receipts_due()` (tickets 15 minutes to 24 hours old), Expo's `getReceipts`, then the tokens whose
   receipt says `DeviceNotRegistered` are deleted and the checked tickets forgotten. A failure here logs
   `{"outcome":"receipts_failed"}` and the run goes on.
2. **Targets.** `monitor_targets()` page by page (1000 rows, `order=user_id` so `limit`/`offset` paging is stable). A failed read answers `500 { "error": "internal" }`.
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
   `data: { url: '/today' }`; then `save_push_tickets` and the deletion of the tokens Expo answered
   `DeviceNotRegistered`. An error inside one user counts as `failed` and never stops the next. A claim whose send then
   fails stays stamped: that push is lost, never doubled. A user whose account is deleted during the run is not a
   failure: `save_signals` answers nothing for them and `claim_signal_push` finds no token, so nothing is sent.
4. **Reply.** `200 { "outcome": "done", "targets", "evaluated", "skipped", "failed", "signals", "pushed",
   "weather_fetches", "receipts_checked", "tokens_removed" }`: `signals` is the signals computed, `pushed` the messages
   Expo accepted, `weather_fetches` the requests that reached the forecast provider (cache hits excluded).

Other answers: `405 { "error": "method_not_allowed" }` for a method other than `POST`, `401 { "error": "unauthorized" }`
for a missing or wrong secret, both before any call. The log line is the outcome word and the same counts, never a user
id, a token, a zone or a signal.

## Scheduled jobs

Two `pg_cron` jobs run in the database; neither is called by the app ([`database.md`](database.md#the-hourly-monitor)).

| Job | Schedule (UTC) | Runs |
| --- | --- | --- |
| `monitor` | `5 * * * *` | `select public.request_monitor()`: reads `monitor_url` and `monitor_secret` from the Vault and posts to `monitor` through `pg_net` with `x-webhook-secret`; without both secrets it does nothing. A missed run is skipped, not caught up: the next hour evaluates everyone again. |
| `prune-expired-caches` | `17 * * * *` | `select public.prune_expired_caches()`: deletes `signals` computed over 30 days ago (except each user's newest pushed quiet stretch, which keeps that stretch from being pushed again), `weather_cache` and `push_tickets` rows over 2 days old, expired push claims, claim starts over an hour old, `usage_counters` over 30 days old, and the run history of Nimbo's jobs over 7 days old. |
