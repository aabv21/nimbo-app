// The companion's two screens: every message in, every reply out. Each layer that fails hands over to
// the next (Jev, then Haiku, then code alone), and none of them fails open (docs/architecture.md#the-companions-guards).

import { GUARD_KEYS, type GuardKey, type Intent, type Mode } from './companion/contract.ts';
import { type ConditionPack, type Locale, matchRedFlagsAnyLocale, type RedFlagKey } from './condition/index.ts';
import type { ClaudeEnv, JevEnv } from './env.ts';
import { runJev } from './models.ts';
import { localReplyChecks, type ToolResultRecord } from './replyChecks.ts';
import { fallbackInput, fallbackReply } from './screenFallback.ts';
import { buildInputRequest, buildReplyRequest, parseInputAnswers, parseReplyAnswers } from './screenQuestions.ts';

export interface ReplyContext {
  toolResults: readonly ToolResultRecord[];
  userText: string;
  /** The user's earlier turns of this request, oldest first: a reply that only says "yes" is judged against them. */
  earlierUserTexts?: readonly string[];
  redFlags: readonly RedFlagKey[];
  mode: Mode;
  locale: Locale;
  /** Numbers the reply may state besides those in the tool results and the user's message: a draft's local clock time. */
  groundingNumbers?: readonly string[];
}

/** `deadline` is an epoch-ms instant on the `now` clock; no model call starts after it or runs past it. */
export interface ScreenDeps {
  env: JevEnv & ClaudeEnv;
  fetch: typeof fetch;
  pack: ConditionPack;
  now: () => number;
  deadline: number;
  rand?: () => number;
}

// Starting points, low on purpose because a missed flag or violation costs more than a false one;
// a live calibration raises one only while every unsafe fixture is still caught (docs/testing.md#calibration-fixtures).
export const RED_FLAG_THRESHOLD = 0.3;
export const GUARD_THRESHOLDS: Readonly<Record<GuardKey, number>> = Object.freeze(
  Object.fromEntries(GUARD_KEYS.map((key) => [key, 0.35])) as Record<GuardKey, number>,
);
/** The companion acts on a draft intent only at or above this probability. */
export const INTENT_ACT_P = 0.6;
export const INPUT_SCREEN_MS = { jev: 4_000, claude: 4_000 } as const;
export const REPLY_SCREEN_MS = { jev: 4_000, claude: 4_000 } as const;
/** A rate-limited or overloaded Jev is retried once on the reply screen, only if this much time is left beyond Haiku's turn. */
export const JEV_RETRY_MIN_MS = 1_500;
const JEV_RETRY_STATUSES: ReadonlySet<number> = new Set([429, 529]);
const JEV_RETRY_PAUSE_MS = 250;

/** `cap`, cut to what is left before the deadline; null when nothing is. */
function budget(cap: number, deps: ScreenDeps): number | null {
  const left = Math.min(cap, deps.deadline - deps.now());
  return left > 0 ? left : null;
}

/** The pack's flags that the keywords or the model raised, in pack order. */
function unionOf(pack: ConditionPack, ...lists: readonly (readonly RedFlagKey[])[]): RedFlagKey[] {
  return pack.redFlags.map((flag) => flag.key).filter((key) => lists.some((list) => list.includes(key)));
}

/**
 * Red flags (the keywords of all three languages, plus Jev's or Haiku's) and the intent. With both
 * models down, the keyword flags stand alone with intent `other`. No retry: the next layer is the retry.
 */
export async function screenInput(
  text: string,
  deps: ScreenDeps,
): Promise<{ redFlags: RedFlagKey[]; intent: Intent; intentP: number; source: 'jev' | 'claude' | 'keywords' }> {
  const keywords = matchRedFlagsAnyLocale(text, deps.pack);
  try {
    const jevMs = budget(INPUT_SCREEN_MS.jev, deps);
    if (jevMs !== null) {
      const request = buildInputRequest(text, deps.pack, deps.rand ?? Math.random);
      const answers = parseInputAnswers(await runJev(deps.env, deps.fetch, request, jevMs), deps.pack);
      if (answers !== null) {
        const flagged = deps.pack.redFlags.filter((flag) => (answers.flags[flag.key] ?? 1) >= RED_FLAG_THRESHOLD).map((flag) => flag.key);
        // Ties keep the earlier intent, `other` last.
        const [intent, intentP] = Object.entries(answers.intent).reduce<[Intent, number]>(
          (best, [option, p]) => (p > best[1] ? [option as Intent, p] : best),
          ['other', -1],
        );
        return { redFlags: unionOf(deps.pack, keywords, flagged), intent, intentP, source: 'jev' };
      }
    }
    const claudeMs = budget(INPUT_SCREEN_MS.claude, deps);
    if (claudeMs !== null) {
      const fallback = await fallbackInput(text, deps.pack, deps, claudeMs);
      if (fallback !== null) return { redFlags: unionOf(deps.pack, keywords, fallback.flags), intent: fallback.intent, intentP: 1, source: 'claude' };
    }
  } catch {
    // A layer that throws counts as down; the keyword flags below still stand.
  }
  return { redFlags: keywords, intent: 'other', intentP: 0, source: 'keywords' };
}

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Jev's violated keys; null when it fails, after one retry on 429/529 that never cuts into Haiku's turn. */
async function jevReplyKeys(request: unknown, deps: ScreenDeps): Promise<GuardKey[] | null> {
  let ms = budget(REPLY_SCREEN_MS.jev, deps);
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    if (ms === null) return null;
    let status = 0;
    // `runJev` answers null for any failure; the status says whether this one is worth a retry.
    const recording: typeof fetch = async (input, init) => {
      const response = await deps.fetch(input, init);
      status = response.status;
      return response;
    };
    const nouls = parseReplyAnswers(await runJev(deps.env, recording, request, ms));
    if (nouls !== null) return GUARD_KEYS.filter((key) => (nouls[key] ?? 1) >= GUARD_THRESHOLDS[key]);
    if (attempt === 2 || !JEV_RETRY_STATUSES.has(status)) return null;
    await pause(JEV_RETRY_PAUSE_MS);
    const retryMs = Math.min(REPLY_SCREEN_MS.jev, deps.deadline - deps.now() - REPLY_SCREEN_MS.claude);
    ms = retryMs >= JEV_RETRY_MIN_MS ? retryMs : null;
  }
  return null;
}

/**
 * What the companion does with a reply, as its response's `guard`: shown (`ok`, only after a model screened
 * it), replaced (some key violated), or shown as unscreened (`degraded`, only when both models are down).
 */
export type ReplyScreen =
  | { guard: 'ok'; violated: []; source: 'jev' | 'claude' }
  | { guard: 'replaced'; violated: [GuardKey, ...GuardKey[]]; source: 'jev' | 'claude' | 'none' }
  | { guard: 'degraded'; violated: []; source: 'none' };

/**
 * `violated` is the union of the local keys and the model's, in guard order. With both models down the
 * local checks decide alone (dose amounts, ungrounded numbers, take advice), and a reply they pass is
 * `degraded`, never `ok`. Never throws.
 */
export async function screenReply(reply: string, context: ReplyContext, deps: ScreenDeps): Promise<ReplyScreen> {
  try {
    const local = localReplyChecks(reply, context);
    let source: 'jev' | 'claude' | 'none' = 'jev';
    let modelKeys = await jevReplyKeys(buildReplyRequest(reply, context, local.ungrounded), deps);
    if (modelKeys === null) {
      source = 'claude';
      const claudeMs = budget(REPLY_SCREEN_MS.claude, deps);
      modelKeys = claudeMs === null ? null : await fallbackReply(reply, context, local.ungrounded, deps, claudeMs);
    }
    if (modelKeys === null) {
      source = 'none';
      modelKeys = [];
      if (local.ungrounded.length > 0) modelKeys.push('ungrounded_number');
      if (local.takeAdvice) modelKeys.push('medication_change');
    }
    const found = new Set([...local.violated, ...modelKeys]);
    const [first, ...rest] = GUARD_KEYS.filter((key) => found.has(key));
    if (first !== undefined) return { guard: 'replaced', violated: [first, ...rest], source };
    return source === 'none' ? { guard: 'degraded', violated: [], source } : { guard: 'ok', violated: [], source };
  } catch {
    // Unscreenable is unsafe: every key stands, so the reply is replaced.
    return { guard: 'replaced', violated: [...GUARD_KEYS], source: 'none' };
  }
}
