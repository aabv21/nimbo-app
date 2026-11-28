# Motion audit

| | |
|---|---|
| Scope | Every animation in `src/` at `a00d4da` (branch `feat/hardening`) against Nimbo's motion spec (the three levels, the table of moments M1–M14 and the "never" list): where it runs, what it animates, its reduced and Dim variants, crisis mode's fade in and out, the minute clocks, and Today's signal rows. |
| Skills | `fixing-motion-performance` (written for CSS) mapped to Reanimated 4.7: compositor properties are `transform` and `opacity` in a `useAnimatedStyle` or a layout-animation worklet on the UI thread; layout properties (`width`, `height`, position, `margin`, `padding`, `flex`) are never animated; no frame loop. `animate` for timing and easing (exits no slower than entrances except crisis mode's close to Day, springs for interruptible moves). |
| Date | 2026-11-28 |
| Fixes | In the Task 8 checkpoint (`wip(task 8): accessibility, motion and React Native performance audits`), squashed later into the milestone commit `fix: apply the app audits and the parked fixes, and complete the docs for v1.0.0`. |
| Companion audits | [`accessibility.md`](accessibility.md), [`react-native-performance.md`](react-native-performance.md). |

**Statuses.** As in [`accessibility.md`](accessibility.md): `fixed` names its test, `accepted` gives the reason and the
cost, `deferred` needs a device.

**Method.** `src/__tests__/motionScan.test.ts` reads every source as text; then each animated style and entering
animation was read against its row of the spec.

| Animated style | Properties | Levels |
|---|---|---|
| `usePressFeedback` (M1) | `transform: scale` (full only), the pressed overlay's `opacity` | scale 0.98 only at full |
| `TabBar` pill (M2) | `translateX` (full, spring); each tab's pill `opacity` (Dim and reduced) | as the spec |
| `TabScene` (M2) | `opacity`, `translateY` (12 / 8 / 0) | as the spec |
| `useSheetMotion` (M9) | `translateY` (full), `opacity` with an 8 pt rise (Dim), `opacity` (reduced); the scrim's `opacity` | as the spec |
| Crisis mode and urgent care (M3, M4, M13) | the layer's `opacity` | as the spec |
| `SignalRow` (M8) | the chevron's `rotate` (full only), two chevrons' `opacity` (Dim and reduced) | no rotation in Dim |
| `IntensityScale` (M5) | each step's ring `opacity` | as the spec |
| Entering animations (`entrance`, `crossFade`, `FadeIn`, `FadeOut`) | `opacity` and `translateY` | rises of 8 / 4 / 0 pt |

## Findings

| ID | Severity | Location | Finding | Evidence | Fix or rationale | Test | Status |
|---|---|---|---|---|---|---|---|
| MOT-01 | low | `src/signals/SignalsSection.tsx` | Today's signal rows (M14: a short list staggers on its first render, once per session) kept the stagger switched on for the whole mount, so a row that arrived later (the pressure row from the server, a row an ended attack or a check-in adds) rose in with its stagger delay. Parked in Wave 4. | The section decided "stagger" once at mount and gave every row an `entering` animation while it held. | The section keeps the set of rows on screen at the session's first render; only those rise in, a row that arrives later takes its place at once (rows below still glide at full motion, M8), and a later visit shows every row in place. Cost, accepted: a first-render row that leaves and comes back in the same mount rises again. | `src/__tests__/today-stagger.test.tsx` "the signal rows rise in on the first render only; a row that arrives later shows in place" | fixed |
| MOT-02 | low | `src/**` | Everything runs on the UI thread: no `Animated` from React Native. | None found; every animation is Reanimated (`useAnimatedStyle`, layout-animation builders and worklets). | Pinned. | `src/__tests__/motionScan.test.ts` "no file imports React Native's own Animated" | fixed |
| MOT-03 | low | every `useAnimatedStyle` | No animated layout properties. | Every animated style (table above) returns `transform` or `opacity`. | Pinned: no animated style returns `width`, `height`, `top`, `left`, `right`, `bottom`, `margin*`, `padding*` or `flex*`. | `motionScan.test.ts` "no animated style returns a layout property …" | fixed |
| MOT-04 | low | `src/crisis/useMinuteClock.ts`, `DoseButton.tsx`, crisis mode's elapsed time | The crisis countdown and the elapsed time must not be a JS-thread interval or a frame loop (M7, "never a per-second tick"). | `useMinuteClock` is one `setTimeout` aligned to the next minute boundary, re-armed after each tick and caught up on resume; the figure cross-fades once a minute at `fast`. No `setInterval`, `requestAnimationFrame` or `withRepeat` anywhere in `src/`. | Pinned. | `motionScan.test.ts` "no frame loop or interval drives what is on screen …"; `crisis.test.tsx` (the countdown) | fixed |
| MOT-05 | low | `src/ui/motion.ts` and every call site | Reduced-motion variants. | `motionFor(_, true)` is the `fade` level (150 ms, linear, no movement, no delay); `entrance` returns a plain `FadeIn` there, Today's rows fade at once, Today's check-in scroll jumps, the sheet cross-fades. Every `withTiming`, `withSpring` and layout-animation builder passes `reduceMotion: ReduceMotion.Never`, because Reanimated's `System` mode would jump to the end and skip Nimbo's fade. | Pinned: a call or builder without its own `reduceMotion` fails the scan. | `src/ui/__tests__/motion.test.ts`; `motionScan.test.ts` "every animation brings its own reduced variant …" | fixed |
| MOT-06 | low | `src/app/crisis.tsx`, `src/ui/ThemeProvider.tsx` | The Dim transition (M3, M4). | Opening: the episode is written before the push, the app below is forced to Dim, the layer fades in at Dim `base` (330 ms, `calm`) and its content rises 8 pt 60 ms later. Closing: the app below turns back first, then the layer (Dim on its own context) fades out over `slow` (600 ms) when the screen below is Day, `base` otherwise, and leaves through `scheduleOnRN` when the fade finishes. Only `opacity` animates. | Accepted as built; the frame rate on a mid-range Android is a live check. | `crisis.test.tsx` "mounting forces Dim …", "Hide closes crisis mode …" | deferred |
| MOT-07 | low | `SignalsSection`, `HistoryList`, `MessageList`, `InsightCards` | Layout animation in lists ("nothing animates layout in a long list"). | Only Today's signal rows (three at most) glide with `LinearTransition`, and only at full motion (M8 allows it). History, the chat and Patterns give an `entering` fade or rise to new items only; Patterns wraps its cards in `LayoutAnimationConfig skipEntering`; no `itemLayoutAnimation`. | Accepted as in place. | `today-stagger.test.tsx`; `src/history/__tests__/HistoryList.test.tsx` | accepted |
| MOT-08 | low | `usePressFeedback`, `Button`, `SignalRow`, `TabBar` | Dim allows only opacity and moves of 8 pt or less: no scale, no rotation. | Press scale, the saved check's settle, the chevron's turn and the sliding tab pill run only at `full`; Dim and reduced cross-fade instead; every Dim rise is 4 or 8 pt. | Accepted as in place. | `TabBar.test.tsx`, `SignalRow.test.tsx`, `Button.test.tsx` | accepted |
| MOT-09 | low | Paint and blur | Paint-heavy animation on large surfaces. | Press fills are an overlay's `opacity`, not an animated colour; the tab bar's blur and glass are static; no animated gradient, shadow or blur; no looping animation (the typing line holds still). | Accepted as in place. | `motionScan.test.ts` (no `withRepeat`) | accepted |
| MOT-10 | low | The countdown, the Dim transition, History scrolling, the chat | Real frame rates. | Jest settles every animation at once; only a device shows dropped frames. | Deferred to the owner session's mid-range Android check. | — | deferred |

## Summary

| Severity | fixed | accepted | deferred | Total |
|---|---|---|---|---|
| high | 0 | 0 | 0 | 0 |
| medium | 0 | 0 | 0 | 0 |
| low | 5 | 3 | 2 | 10 |
| **Total** | **5** | **3** | **2** | **10** |

## Deferred live checks

- On a mid-range Android (release build, the performance overlay or `adb shell dumpsys gfxinfo`): crisis mode opening and closing over Day (the 600 ms fade), the countdown's minute cross-fade, History scrolled fast through a year of attacks, and the chat list, each without dropped frames.
- Reduce motion on: crisis mode cross-fades in 150 ms with no rise; Today's rows fade at once.
