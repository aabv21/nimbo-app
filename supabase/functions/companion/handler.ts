// The companion: screens the message, spends the quota, runs a bounded Claude tool loop over the caller's
// own rows and screens the reply before the app sees it (docs/architecture.md#the-companion-function).

import { type ClientQuotaKind, type Draft, type Evidence, type Guard, parseCompanionRequest, type CompanionResponse } from '../_shared/companion/contract.ts';
import { clockNumbers, readNotes, readOpenEpisode, readOwnEpisode, readProfile, zoneOrUtc } from '../_shared/companion/data.ts';
import { buildCompanionRequest, COMPANION_EFFORT, COMPANION_MAX_TOKENS, type PromptContext, routingMessage } from '../_shared/companion/prompt.ts';
import { createRefs } from '../_shared/companion/refs.ts';
import { runTool, type ToolEnv, type ToolOutcome } from '../_shared/companion/tools.ts';
import { completeSentences, extractCitations, firstSentences, parseStep, sanitizeReply } from '../_shared/companion/turns.ts';
import { packs } from '../_shared/condition/index.ts';
import type { ClaudeEnv, JevEnv, SupabaseEnv } from '../_shared/env.ts';
import { bodyProblemReply, callerOf, readJsonCapped, reply } from '../_shared/http.ts';
import { FALLBACK_BETA, runClaude } from '../_shared/models.ts';
import { hasPremium } from '../_shared/premium.ts';
import { consumeQuota, DAILY_LIMITS } from '../_shared/quota.ts';
import type { ToolResultRecord } from '../_shared/replyChecks.ts';
import { premiumClient } from '../_shared/rest.ts';
import { type ScreenDeps, screenInput, screenReply } from '../_shared/screen.ts';

export { COMPANION_EFFORT, COMPANION_MAX_TOKENS };

/**
 * One deadline for the whole request, under the app's 45 s wait. Every stage gets the smaller of its own
 * cap and what the deadline leaves after the stages still to come; the database shrinks first, then the
 * loop, and the screens last (the reply screen falls back to its local checks, never to no screen).
 */
export const REQUEST_DEADLINE_MS = 40_000;
/** Each PostgREST call, cut further when the request's deadline is nearer. */
export const DB_TIMEOUT_MS = 3_000;
/** Each screen's own cap from its start: Jev's 4 s, then Haiku's 4 s, plus slack. */
export const SCREEN_DEADLINE_MS = 8_500;
/** What must still fit after the input screen: two quota units, a loop worth having and the reply screen. */
export const AFTER_INPUT_SCREEN_MS = 28_000;
/** The tool loop's own cap from its first call, cut to leave the reply screen its 8.5 s. */
export const COMPANION_DEADLINE_MS = 25_000;
/** Each loop call ends this long before the loop's deadline, so the tool round after it can still read. */
export const TOOL_ROUND_RESERVE_MS = DB_TIMEOUT_MS;
/** No model call starts with less than this left: it could not finish anyway. */
export const MIN_CALL_MS = 3_000;
/** With less than this left, the reply screen runs its local checks only (the reply is then at best `degraded`). */
export const REPLY_SCREEN_MIN_MS = 2_000;
export const MAX_TOOL_ROUNDS = 3;
/** The calls one round runs: every read tool plus a proposal. More come back as `too_many_calls` errors, unrun. */
export const MAX_TOOL_CALLS_PER_ROUND = 6;
/**
 * The largest body read. The contract allows 4,000 characters of turns; even every one escaped as `\uXXXX` (6 bytes)
 * with the other fields is about 26 KB, so 64 KiB leaves more than twice that.
 */
export const MAX_BODY_BYTES = 64 * 1024;

type Limits = Readonly<Record<ClientQuotaKind, number>>;

export type CompanionDeps = {
  env: SupabaseEnv & JevEnv & ClaudeEnv;
  fetch: typeof fetch;
  now?: () => number;
  rand?: () => number;
  /**
   * Per tier; both default to `DAILY_LIMITS` until the owner names premium limits. `screen` has one limit for
   * both, because it is spent beside the premium read, before the tier is known.
   */
  limits?: { free: Limits; premium: Limits; screen: number };
};

const pack = packs.migraine;

/** The phone's zone when the runtime knows it, else null: an unknown one is ignored, so older builds keep working. */
export function requestZone(timeZone: string | undefined): string | null {
  return timeZone !== undefined && zoneOrUtc(timeZone) === timeZone ? timeZone : null;
}

/** The numbers a reply may use to read a draft's times back on the person's clock. */
function draftClockNumbers(drafts: readonly Draft[], timeZone: string): string[] {
  const times = drafts.flatMap((draft) => {
    if (draft.kind === 'episode') return [draft.startedAt, draft.endedAt, ...draft.doses.map((dose) => dose.takenAt)];
    if (draft.kind === 'dose') return [draft.takenAt];
    return [];
  });
  return [...new Set(times.flatMap((time) => (time === null ? [] : clockNumbers(Date.parse(time), timeZone))))];
}

// Worst case, every stage at its cap: the profile and premium reads with the screening unit (3 s), the input screen with
// the context reads beside it (8.5 s), two quota units (6 s), the loop up to 8.5 s before the deadline, and
// the reply screen up to the deadline: 40 s. A typical message takes a few seconds.
export async function handleCompanion(request: Request, deps: CompanionDeps): Promise<Response> {
  const now = deps.now ?? Date.now;
  const requestDeadline = now() + REQUEST_DEADLINE_MS;
  const dbTimeout = (until = requestDeadline): number => Math.min(DB_TIMEOUT_MS, until - now());
  if (request.method !== 'POST') return reply('invalid', 405, { error: 'method_not_allowed' });
  const caller = callerOf(request);
  if (caller === null) return reply('invalid', 401, { error: 'unauthorized' });
  const body = await readJsonCapped(request, MAX_BODY_BYTES);
  if (!body.ok) return bodyProblemReply(body.reason, 'invalid_input');
  const input = parseCompanionRequest(body.value);
  if (input === null) return reply('invalid', 400, { error: 'invalid_input' });

  const { env, fetch: fetchFn } = deps;
  const reader = { supabase: env, fetch: fetchFn, auth: caller.auth, timeoutMs: () => dbTimeout() };
  let profile: Awaited<ReturnType<typeof readProfile>>;
  let premium: boolean;
  let screenAllowed: boolean;
  try {
    [profile, premium, screenAllowed] = await Promise.all([
      readProfile(reader, caller.userId),
      hasPremium(premiumClient(env, fetchFn, caller.auth, dbTimeout()), caller.userId),
      // Every message costs a screening unit, red flags included, so the paid screen is bounded before any
      // other unit is checked. Refused or failed, the screen runs on the keywords alone: never a 503 over it.
      consumeQuota(env, fetchFn, caller.userId, 'screen', deps.limits?.screen ?? DAILY_LIMITS.screen, input.localDate, dbTimeout()).catch(() => false),
    ]);
  } catch {
    return reply('unavailable', 503, { error: 'unavailable' }, { stage: 'profile' });
  }
  const screenWord = { screen_quota: screenAllowed ? 'ok' : 'out' };
  if (profile === null || !profile.aiEnabled) return reply('ai_off', 403, { error: 'ai_off' });
  // One zone for the whole request (prompt clock, tools, drafts): the phone's, so a stale profile zone cannot
  // move a "today" the phone already sees.
  const timeZone = requestZone(input.timeZone) ?? profile.timeZone;

  const userText = input.messages.at(-1)?.text ?? '';
  const earlierUserTexts = input.messages.slice(0, -1).flatMap((turn) => (turn.role === 'user' ? [turn.text] : []));
  const screenDeps = (deadline: number): ScreenDeps => ({ env, fetch: fetchFn, pack, now, deadline, ...(deps.rand === undefined ? {} : { rand: deps.rand }) });
  // Read-only and quota-free, so they run beside the input screen; a red-flag request never uses them.
  const refs = createRefs();
  const contextReads = Promise.all([
    readOpenEpisode(reader),
    input.episodeId === undefined ? Promise.resolve(null) : readOwnEpisode(reader, input.episodeId),
    readNotes(reader),
  ]).then(
    (values) => ({ ok: true as const, values }),
    () => ({ ok: false as const }),
  );
  // A deadline of now leaves the keywords alone: no model call, and their red flags still stand.
  const inputDeadline = screenAllowed ? Math.min(now() + SCREEN_DEADLINE_MS, requestDeadline - AFTER_INPUT_SCREEN_MS) : now();
  const screened = await screenInput(userText, screenDeps(inputDeadline));
  if (screened.redFlags.length > 0) {
    // No model reply and no further unit: nothing may contradict the urgent-care screen the app opens.
    const body: CompanionResponse = { reply: null, drafts: [], evidence: [], redFlags: screened.redFlags, intent: screened.intent, guard: 'ok', replaced: null };
    return reply('red_flag', 200, body, { input_source: screened.source, ...screenWord });
  }
  const loaded = await contextReads;
  // Before the companion unit, so a failed read costs the user nothing more.
  if (!loaded.ok) return reply('unavailable', 503, { error: 'unavailable' }, { stage: 'read', ...screenWord });
  const [openEpisode, own, saved] = loaded.values;
  // An episode id that is not the caller's reads as absent.
  const focus = own ?? openEpisode;
  const notes = saved.map((note) => ({ ref: refs.add('n', note.id), text: note.text }));

  try {
    const limits = (premium ? deps.limits?.premium : deps.limits?.free) ?? DAILY_LIMITS;
    // A voice message is a dictation and a message: both units, dictation first, stopping at the first refusal.
    const units: [ClientQuotaKind, number][] = [['companion', limits.companion]];
    if (input.input === 'voice') units.unshift(['dictation', limits.dictation]);
    for (const [kind, limit] of units) {
      if (!(await consumeQuota(env, fetchFn, caller.userId, kind, limit, input.localDate, dbTimeout()))) {
        return reply('over_quota', 429, { error: 'over_quota', quota: kind, limit }, { quota: kind, ...screenWord });
      }
    }
  } catch {
    // UpstreamError, AbortError (the timeout), a network TypeError or a SyntaxError from a body that isn't JSON.
    return reply('unavailable', 503, { error: 'unavailable' }, { stage: 'quota', ...screenWord });
  }

  const state: ToolEnv['state'] = { drafts: 0, spans: new Map() };
  for (const episode of [openEpisode, focus]) {
    if (episode !== null) state.spans.set(episode.id, { start: Date.parse(episode.startedAt), end: episode.endedAt === null ? null : Date.parse(episode.endedAt) });
  }
  const focusRef = focus === null ? null : refs.add('e', focus.id);
  const context: PromptContext = { locale: input.locale, mode: input.mode, now: now(), timeZone, localDate: input.localDate, notes, openEpisodeRef: focusRef };

  const messages: unknown[] = input.messages.map((turn) => ({ role: turn.role, content: turn.text }));
  const routing = routingMessage(screened.intent, screened.intentP, input.mode, focusRef);
  // A mid-conversation system message right after the last user turn: the operator's channel, after the cached prefix.
  if (routing !== null) messages.push({ role: 'system', content: routing });

  const toolResults: ToolResultRecord[] = [];
  const evidence = new Map<string, Evidence>();
  const drafts: Draft[] = [];
  let cacheRead = 0;
  const words = (extra: Record<string, string>, round: number): Record<string, string> => ({
    rounds: String(round),
    input_source: screened.source,
    ...screenWord,
    cache_read: String(cacheRead),
    ...extra,
  });
  const fail = (round: number, why: string): Response => reply('unavailable', 503, { error: 'unavailable' }, words({ stage: why }, round));

  const finish = async (text: string, cited: Evidence[], round: number): Promise<Response> => {
    const capped = Math.min(now() + SCREEN_DEADLINE_MS, requestDeadline);
    // Too little left for a model: a deadline of now leaves the local checks alone, so the reply is at best degraded.
    const deadline = capped - now() < REPLY_SCREEN_MIN_MS ? now() : capped;
    const verdict = await screenReply(
      text,
      { toolResults, userText, earlierUserTexts, redFlags: [], mode: input.mode, locale: input.locale, groundingNumbers: draftClockNumbers(drafts, timeZone) },
      screenDeps(deadline),
    );
    const base = { drafts, redFlags: [], intent: screened.intent };
    if (verdict.guard === 'replaced') {
      // The original text is neither returned nor kept; the app renders the template for the first key.
      const [key] = verdict.violated;
      const body: CompanionResponse = { ...base, reply: null, evidence: [], guard: 'replaced', replaced: key };
      return reply('replaced', 200, body, words({ key, guard_source: verdict.source }, round));
    }
    // Only keywords screened the message: the reply cannot be shown as fully screened either.
    const guard: Guard = verdict.guard === 'ok' && screened.source === 'keywords' ? 'degraded' : verdict.guard;
    const body: CompanionResponse = { ...base, reply: text, evidence: cited, guard, replaced: null };
    return reply(guard === 'degraded' ? 'degraded' : 'answered', 200, body, words({ guard_source: verdict.source }, round));
  };

  const loopDeadline = Math.min(now() + COMPANION_DEADLINE_MS, requestDeadline - SCREEN_DEADLINE_MS);
  const tools: ToolEnv = {
    ...reader,
    timeoutMs: () => dbTimeout(loopDeadline),
    userId: caller.userId,
    pack,
    refs,
    timeZone,
    localDate: input.localDate,
    now,
    openEpisode,
    state,
  };
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const left = loopDeadline - now() - TOOL_ROUND_RESERVE_MS;
    if (left < MIN_CALL_MS) return fail(round, 'deadline');
    const answer = await runClaude(env, fetchFn, buildCompanionRequest(context, messages, { final: round === MAX_TOOL_ROUNDS }), left, { betas: [FALLBACK_BETA] });
    if (answer === null) return fail(round, 'claude');
    const usage = (answer as { usage?: { cache_read_input_tokens?: unknown } }).usage;
    if (typeof usage?.cache_read_input_tokens === 'number') cacheRead += usage.cache_read_input_tokens;
    const step = parseStep(answer);
    if (step.kind === 'failed') return fail(round, 'unreadable');

    if (step.kind === 'refusal') {
      const body: CompanionResponse = { reply: null, drafts, evidence: [], redFlags: [], intent: screened.intent, guard: 'replaced', replaced: 'refusal' };
      return reply('replaced', 200, body, words({ key: 'refusal' }, round));
    }

    if (step.kind === 'reply') {
      let text = sanitizeReply(step.text);
      if (step.truncated) text = completeSentences(text);
      if (input.mode === 'crisis') text = firstSentences(text, 2);
      const cited = extractCitations(text, refs, (ref) => evidence.get(ref) ?? null);
      if (cited.text === '') return fail(round, step.truncated ? 'truncated' : 'empty');
      return finish(cited.text, cited.evidence, round);
    }

    // A tool call on the last call (which allows none) means the model will not answer.
    if (round === MAX_TOOL_ROUNDS) return fail(round, 'tool_on_last_call');
    // Every call gets a result, but only the first few run: a round of dozens of reads would multiply the cost.
    const unrun: ToolOutcome = { content: { error: 'too_many_calls' }, isError: true };
    const outcomes = await Promise.all(step.calls.map((call, index) => (index < MAX_TOOL_CALLS_PER_ROUND ? runTool(call, tools) : Promise.resolve(unrun))));
    for (const [index, call] of step.calls.entries()) {
      const outcome = outcomes.at(index);
      if (outcome === undefined) continue;
      toolResults.push({ tool: call.name, result: outcome.content });
      if (outcome.draft !== undefined) drafts.push(outcome.draft);
      for (const item of outcome.evidence ?? []) evidence.set(item.ref, item);
    }
    // The assistant content goes back unchanged (thinking blocks included), then every result in one user turn.
    messages.push({ role: 'assistant', content: step.content });
    messages.push({
      role: 'user',
      content: step.calls.map((call, index) => {
        const outcome = outcomes.at(index);
        return {
          type: 'tool_result',
          tool_use_id: call.id,
          ...(outcome?.isError === true ? { is_error: true } : {}),
          content: JSON.stringify(outcome?.content ?? null),
        };
      }),
    });
  }
  return fail(MAX_TOOL_ROUNDS, 'deadline');
}
