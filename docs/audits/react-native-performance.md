# React Native performance audit

| | |
|---|---|
| Scope | The app under `src/` at `a00d4da` (branch `feat/hardening`): History's list and calendar and the chat list (virtualization, keys, row memoization); the local store's reads on render paths (`useLocalQuery`); context value fan-out from `AuthProvider`, `SyncProvider`, `I18nProvider` and `ThemeProvider`; the minute clock's re-renders on Today, History and the companion; Today's and Patterns' recompute cost; startup work before the first frame; images and assets. |
| Skill | `vercel-react-native-skills` (list performance, animation, state and rendering rules, fonts), applied directly. |
| Date | 2026-11-28 |
| Fixes | In the Task 8 checkpoint (`wip(task 8): accessibility, motion and React Native performance audits`), squashed later into the milestone commit `fix: apply the app audits and the parked fixes, and complete the docs for v1.0.0`. |
| Companion audits | [`accessibility.md`](accessibility.md), [`motion.md`](motion.md). |

**Statuses.** As in [`accessibility.md`](accessibility.md): `fixed` names its test, `accepted` gives the reason and the
cost, `deferred` needs a device or a native build.

**Method.** A read of each scope area against the skill's rules, with render counts in Jest where a re-render was in
question. No dependency was added: this wave adds only `expo-file-system` and `expo-sharing`, so a list library swap is
an upgrade path, not a fix.

## Findings

| ID | Severity | Location | Finding | Evidence | Fix or rationale | Test | Status |
|---|---|---|---|---|---|---|---|
| RNP-01 | medium | `src/history/HistoryList.tsx`, `EpisodeRow.tsx`, `HistoryCalendar.tsx`, `src/app/(tabs)/history.tsx` | Every minute tick re-rendered every mounted History row: the list rebuilt its items and an inline `renderItem` each render, the rows were not memoized, every row took the minute clock (only an open attack's row uses it), the open handler and the late-row entrance were new functions each render. | `list-performance-item-memo`, `-callbacks`, `-function-references`. A render count (the day title each row computes) showed both rows rendering again on a tick. | `EpisodeRow` is memoized; an ended attack's row gets `now = null`, so a tick re-renders only the open attack's row; items are memoized on the attacks and the language, `renderItem` is a `useCallback`, the open handler is module-level and the late-row entrance is memoized on the motion level. | `src/history/__tests__/HistoryList.test.tsx` "a minute tick re-renders only the open attack's row; an ended row is left alone" | fixed |
| RNP-02 | low | `HistoryList.tsx` | Virtualization of History. | A `FlatList` keyed by attack id and month, with the defaults' windowing; no `getItemLayout`, since a row's height varies with its tags line and the text size; no FlashList or LegendList in the app. | Accepted. Cost: a fast fling through hundreds of attacks on a low-end phone can show blank cells for a moment. Upgrade path: FlashList (or LegendList) with an estimated item size, a new native dependency. Trigger: the mid-range Android check shows dropped frames or blank cells. | `HistoryList.test.tsx` | accepted |
| RNP-03 | low | `src/companion/MessageList.tsx`, `src/app/(tabs)/companion.tsx` | The chat list. | An inverted `FlatList` keyed by message id and day; `MessageItem` is memoized; `renderItem` is a `useCallback`; the records the rows read are keyed on the day, not the minute, so the clock does not re-render the messages; only a new message gets an entrance. | Accepted as in place. | `src/companion/__tests__/MessageList.test.tsx`, `src/__tests__/companion.test.tsx` | accepted |
| RNP-04 | low | `src/lib/sync/SyncProvider.tsx` | The sync context's value changed on every outbox write, even one that left the counts alone (a retry time moving after a failed send), so every consumer (the sync notice on Today and Profile, the privacy actions) re-rendered. | `react-state-minimize`. The memo depended on the whole outbox snapshot, a new object per table version. | The value depends on `pending` and `failed` only. | `src/lib/sync/__tests__/SyncProvider.test.tsx` "an outbox change that leaves the counts as they were hands consumers the same value …" | fixed |
| RNP-05 | low | `AuthProvider`, `I18nProvider`, `ThemeProvider`, `useI18n`, `useTheme` | Context value fan-out. | Each provider's value is a `useMemo` over its state; `useI18n` memoizes `t` and `tp` on the locale; `useTheme` reads the static token objects for the theme's name. A profile change re-renders the auth consumers, as it should. | Accepted as in place. | `src/auth/__tests__/AuthProvider.test.tsx`, `src/ui/__tests__/ThemeProvider.test.tsx` | accepted |
| RNP-06 | low | `src/lib/local/useLocalQuery.ts`, the stores | SQLite reads on render paths. | `useLocalQuery` is a `useSyncExternalStore` that reads once per table version and per `read` function, and returns the cached value on any other render; every store hook passes a `useCallback` read keyed on primitive arguments, so a minute tick reads nothing from SQLite. | Accepted as in place. | `src/lib/local/__tests__/useLocalQuery.test.tsx` | accepted |
| RNP-07 | low | `src/app/(tabs)/today.tsx`, `src/signals/useTodaySignals.ts` | Today's recompute per minute tick. | The tick re-renders Today and recomputes `computeSignals` over the window `record_inputs` gives (up to a year of attacks, check-ins and doses, `INSIGHT_SINCE_DAYS`) plus the medication month; the records themselves are memoized and the date text is keyed on the day. That is one pass over at most a few hundred records a minute for a typical user. | Accepted. Cost: a few milliseconds of JS once a minute while Today is focused. Upgrade path: key the signal rules on the local hour, as Patterns does, if a device profile shows the tick. | `src/signals/__tests__/useTodaySignals.test.ts` | accepted |
| RNP-08 | low | `src/app/(tabs)/history.tsx` `Patterns`, `InsightCards.tsx` | Patterns' recompute. | `computeInsights` and `insightNeeds` run in a `useMemo` over data keyed on the hour, not the minute. | Accepted as in place. | `src/insights/__tests__/InsightCards.test.tsx` | accepted |
| RNP-09 | low | `src/app/(tabs)/history.tsx` | History's filter runs on each minute tick (its period, such as the last 30 days, is relative to now). | One pass over the attacks and doses; with RNP-01 the rows it hands the list no longer re-render unless they changed. | Accepted. Cost: one linear pass a minute. | `src/history/__tests__/filterEpisodes.test.ts` | accepted |
| RNP-10 | low | `src/app/_layout.tsx` | Startup: the six Literata and Atkinson Hyperlegible Next faces load at runtime with `useFonts`, and the splash stays until they do. | `fonts-config-plugin`; the SDK 58 `expo-font` docs recommend the config plugin, which embeds the fonts at build time and is "more efficient than `useFonts` or `loadAsync`". | Deferred: the plugin needs a prebuild and a native rebuild, which this repo's rules keep out of an agent task. Upgrade path: add `expo-font` to `app.json` `plugins` with the six font files, keep `useFonts` for nothing but a missing-font fallback, then measure the cold start. | — | deferred |
| RNP-11 | low | `src/lib/sync/SyncProvider.tsx`, `src/app/_layout.tsx` | Other startup work. | Before the first frame the root reads a few kv values synchronously (the intro flag, the language, the profile cache); the launch sweep of other accounts' rows and keys runs in an effect after the first render. | Accepted. Cost: the sweep's synchronous SQLite and kv scan runs right after the first frame; it is small for one or two accounts. | `SyncProvider.test.tsx` | accepted |
| RNP-12 | low | `assets/images/`, `src/**` | Images and asset sizes. | The only images are the icon and splash PNGs (13 KB at most); no image renders in a list; icons are `lucide-react-native` vectors. | Accepted as in place. | — | accepted |
| RNP-13 | low | The release build | Hermes bundle size and cold start on a device. | Needs an EAS build. | Deferred to the owner session. | — | deferred |

## Summary

| Severity | fixed | accepted | deferred | Total |
|---|---|---|---|---|
| high | 0 | 0 | 0 | 0 |
| medium | 1 | 0 | 0 | 1 |
| low | 1 | 9 | 2 | 12 |
| **Total** | **2** | **9** | **2** | **13** |

## Deferred live checks

- On a mid-range Android, release build: History scrolled fast through a year of attacks (blank cells, dropped frames), the chat with a long history, and Today left open across a minute tick (no visible hitch).
- Cold start to Today, before and after embedding the fonts with the `expo-font` config plugin (RNP-10), and the Hermes bundle size of the preview APK.
