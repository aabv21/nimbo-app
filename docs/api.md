# API: the Edge Functions

The app calls one Edge Function, `companion`. Everything else it reads and writes through PostgREST and
the RPCs in [`database.md`](database.md). How the function works inside: [`ai.md`](ai.md) and
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
  "episodeId": "3f0c1d9e-7a2b-4c55-9b1e-2d4f6a8c0e11"
}
```

| Field | Rule |
| --- | --- |
| `mode` | `chat` (the Companion tab), `crisis` ("Tell me" in crisis mode) or `debrief` (the day-after debrief). |
| `locale` | `en`, `es` or `pt`: the language on screen. The reply comes in it; the function never reads `profiles.language`. |
| `localDate` | The phone's day, a real `YYYY-MM-DD` from 2000 on. It is the quota's day and the tools' day (`get_episodes`' default end, the check-in window); the prompt's "today" and "now" come from the server's clock on the profile's zone, the clock the tools' times use. |
| `input` | `text` (typed) or `voice` (dictated). A voice message spends a dictation unit and a companion unit. |
| `messages` | 1 to 12 turns, the first and last from the user. Each `text` is 1 to 500 characters after trimming, 4,000 in all. The app sends the last turns of the chat it keeps on the phone. |
| `episodeId` | Optional: the attack the conversation is about. An id that is not the caller's reads as absent. Null is the same as leaving it out. |

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
| 400 | `{ "error": "invalid_input" }` | The body is not JSON or breaks a rule above. Nothing is spent. |
| 401 | `{ "error": "unauthorized" }` | No bearer token with a user id (the anon or service-role key alone). The gateway answers a missing or invalid token itself. |
| 403 | `{ "error": "ai_off" }` | The caller's `ai_enabled` is false, or their profile is missing. |
| 405 | `{ "error": "method_not_allowed" }` | Any method but `POST`. |
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
