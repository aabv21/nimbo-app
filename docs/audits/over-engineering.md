# Over-engineering audit

| | |
|---|---|
| Scope | `src/`, `supabase/functions/`, `supabase/migrations/` and `scripts/` at `ac3c8ac` (branch `feat/hardening`), with the outbox and sync, the code the app and the functions share, the companion's guards and the consent tables in focus. |
| Skill | `ponytail:ponytail-review`: complexity only (dead code, hand-rolled standard library, speculative abstractions, layers with one caller); correctness, security and performance belong to the other audits. |
| Date | 2026-11-28 |
| Fixes | In the Task 9 checkpoint (`wip(task 9): …`), squashed later into the milestone commit `fix: apply the app audits and the parked fixes, and complete the docs for v1.0.0`. |
| Companion audits | [`security.md`](security.md), [`api.md`](api.md), [`agent-guardrails.md`](agent-guardrails.md), [`database.md`](database.md), [`react-native-performance.md`](react-native-performance.md). |

**Statuses.** `fixed`: deleted or shrunk, with the tests that prove the behaviour unchanged; `accepted`: kept, with the
reason and what deleting it would cost.

## Method

- **Exports nobody imports.** Every `export` under `src/` (routes aside), `supabase/functions/` and `scripts/` was
  counted against every other file: about 200 names have no caller outside their file. Nearly all are constants and types
  exported for their own tests; the ones with no production caller at all are OE-02, OE-03, OE-06, OE-07 and OE-10.
- **SQL functions nobody calls.** Every `create function` in the migrations against the app, the functions, the scripts
  and the integration tests: the nine without a code caller are trigger functions, `private` helpers called from SQL,
  the `pg_cron` prune and `keep_alive` (the owner's scheduled call that keeps a free project awake). None is dead.
- **Hand-rolled helpers twice.** A search for `isRecord`, `UUID`, `clamp`, `sleep`, `chunk` and the like across the app
  and the functions (OE-04).
- **Read in full:** the outbox (`outbox.ts`, `runOutbox.ts`), sync (`SyncProvider.tsx`, `pull.ts`), the re-export shims
  in `src/condition/`, `src/insights/`, `src/signals/` and `src/companion/contract.ts`, the functions' `env.ts` and
  `guards.ts`, the monitor's `forecastPool`, and the consent design.

## Findings

| ID | Location | Finding | Fix or rationale | Test | Status |
|---|---|---|---|---|---|
| OE-01 | `src/lib/outbox/runOutbox.ts` | `delete:` a second rerun loop (`rerunRequested`, `runPasses`): a call made during a pass set a flag and the pass swept again. Its only production caller, `SyncProvider`, already serializes cycles and runs one more cycle for anything queued meanwhile (`again`), so the loop never ran. | Deleted, 17 lines; a concurrent call still shares the running pass, which `pauseOutbox` waits for. | `SyncProvider.test.tsx` "an enqueue while a pass is still sending runs one more cycle once that pass ends" (new); `runOutbox.test.ts` "two concurrent calls share one pass" and the two pause tests | fixed |
| OE-02 | `src/insights/insightText.ts` | `delete:` `insightLines(insight, ctx)`, a one-line wrapper over `cardLines([insight], ctx)` that only tests called. | Deleted; the tests call `cardLines([insight], ctx)`. | `insightText.test.ts` (same assertions) | fixed |
| OE-03 | `supabase/functions/_shared/companion/contract.ts` | `delete:` the `CompanionErrorBody` interface: no file read it; the error bodies are documented in `docs/api.md`. | Deleted, 6 lines; `docs/api.md` and `docs/app.md` point at the error table instead. | `pnpm typecheck` | fixed |
| OE-04 | `src/profile/profileRepository.ts`, `src/lib/storedSession.ts`, `src/account/accountClient.ts`, `src/account/forgetAccount.ts` | `shrink:` three copies of `isRecord` and one of the UUID pattern, all already in the functions' `_shared/guards.ts`. | `src/lib/guards.ts` re-exports `isRecord` and `UUID`, as `src/condition/` re-exports the pack; four copies deleted. | `profileRepository.test.ts`, `storedSession.test.ts`, `accountClient.test.ts`, `forgetAccount.test.ts` | fixed |
| OE-05 | `src/lib/outbox/runOutbox.ts` `RunOutboxResult` | `yagni:` `runOutbox` returns `{ sent, failed, waiting }` and the app ignores it; the banner reads `outboxState`. | Accepted: it is the tests' view of what one pass did (14 unit and 2 integration assertions); deleting it means rebuilding those from `listOutbox` for about 12 lines. | — | accepted |
| OE-06 | `logEpisode` (`src/episodes/episodeStore.ts`), `setDoseHelped` (`src/cabinet/doseStore.ts`) | `yagni:` each wraps its `…Tx` twin in a transaction and only tests call it (the companion's Confirm uses the `Tx` forms). | Accepted: every store exposes the same pair (`x` opens the transaction, `xTx` joins the caller's), the unit and integration suites drive the stores through it, and `docs/app.md` documents it; 10 lines against a break in the pattern. | — | accepted |
| OE-07 | `src/premium/PremiumGate.tsx`, `usePremium.ts` | `yagni:` no screen renders `PremiumGate` yet. | Accepted: the spec builds the premium mechanism before any premium feature ("the mechanism comes first"), and the owner's `pnpm premium` switch already grants it; the monetization wave places the gate. About 70 lines with their tests. | `PremiumGate.test.tsx`, `usePremium.test.tsx` | accepted |
| OE-08 | `src/lib/sync/pull.ts` `columnsText` | `shrink:` an 11-line switch that returns `PULL_COLUMNS[table]`. | Accepted: the one-line index read trips `security/detect-object-injection`, and suppressions live only in `eslint.config.ts`; the switch is also exhaustive over the table union. | — | accepted |
| OE-09 | `supabase/functions/_shared/env.ts` | `yagni?` a capability map with an intersection type for six functions' environment. | Accepted: the six functions need different sets, and the map gives each a typed env and one `missing env: NAME` error without six hand-written readers. | `env.test.ts` | accepted |
| OE-10 | `src/push/pushStore.ts` `readLastOutcome` | `delete?` a 3-line accessor only tests call. | Accepted: the module keeps the outcome in memory for `useLastOutcome`; the accessor is the tests' only way to read it outside a render. | `pushRegistration.test.ts` | accepted |
| OE-11 | `consent_texts`, `consent_events`, `profiles.terms_version`, `ai_consent_version` | Is the consent history more than the evidence needs? | Accepted: under LGPD art. 8 §2 the controller proves consent, so the app keeps which text was accepted (`consent_texts`, one row per version), when and in which language (the append-only `consent_events`), and the current version on the profile for the gate; profile timestamps alone would not show which text a user saw. Three small tables and two RPCs. | `consent.test.sql` | accepted |
| OE-12 | The outbox's `attempts` and `noResponses` | Two counters for one queue. | Accepted: they keep different promises (an offline phone never fails an operation; a server that keeps refusing ends it at 8), each pinned. | `runOutbox.test.ts` offline and server-error tests | accepted |
| OE-13 | `supabase/functions/monitor/handler.ts` `forecastPool` | A hand-written queue with priority for one run. | Accepted: one lookup per cell for the run, `limit` at a time, with a waiting user's cell moved ahead of the prefetches; the functions take no third-party imports and the platform has no such pool. | `monitor/__tests__/handler.test.ts` | accepted |
| OE-14 | `src/lib/fetchWithTimeout.ts` | `native?` a hand-rolled deadline instead of `AbortSignal.timeout`/`any`. | Accepted: React Native does not reliably provide either (noted in the file). | `fetchWithTimeout.test.ts` | accepted |
| OE-15 | The rules the app and the functions share | Duplicated code between the phone and the functions. | Accepted as lean: the condition pack, the insights, the signal rules, the companion's contract and `localHourIn` exist once under `supabase/functions/_shared/` and the app re-exports them; OE-04 removed the last copies. | — | accepted |
| OE-16 | The companion's guards (`screen.ts`, `screenFallback.ts`, `replyChecks.ts`, the keyword matcher) | Four layers on one reply. | Accepted: each covers a failure the others don't (Jev down, Haiku down, a dose the models pass, the AI off), each with its red-team and calibration rows ([`agent-guardrails.md`](agent-guardrails.md)). | `screen.test.ts`, `redTeam.test.ts` | accepted |
| OE-17 | Every Edge Function's `handler.ts` plus `index.ts` | Two files per function. | Accepted: the handler is runtime-neutral and tested under Node; `index.ts` is the 4-line Deno entry. | each function's `__tests__` | accepted |

Net: 46 lines deleted and 9 added (OE-01 to OE-04), so 37 fewer, with the docs pointing at the remaining homes.

## Counts

| Status | Count |
|---|---|
| fixed | 4 |
| accepted | 13 |
| all | 17 |

## Deferred live checks

None: everything here runs offline.
