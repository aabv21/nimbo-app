// `pnpm calibrate eval [--locale en|es|pt|all] [--layer jev|claude]`: runs the guards' model layer on the
// real hosted APIs over `calibration/` and prints what each threshold catches. Owner-only (docs/ai.md#calibration).

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { GUARD_KEYS, type GuardKey, INTENTS, type Intent } from '../supabase/functions/_shared/companion/contract.ts';
import { type Locale, packs, type RedFlagKey } from '../supabase/functions/_shared/condition/index.ts';
import { type ClaudeEnv, type JevEnv, readEnv } from '../supabase/functions/_shared/env.ts';
import { runJev } from '../supabase/functions/_shared/models.ts';
import { localReplyChecks, type ToolResultRecord } from '../supabase/functions/_shared/replyChecks.ts';
import { GUARD_THRESHOLDS, INTENT_ACT_P, RED_FLAG_THRESHOLD, type ReplyContext, type ScreenDeps } from '../supabase/functions/_shared/screen.ts';
import { fallbackInput, fallbackReply } from '../supabase/functions/_shared/screenFallback.ts';
import { buildInputRequest, buildReplyRequest, parseInputAnswers, parseReplyAnswers } from '../supabase/functions/_shared/screenQuestions.ts';
import {
  type CalibrateArgs,
  falsePositiveRate,
  intentAccuracy,
  missesAt,
  parseCalibrateArgs,
  type Scored,
  UsageError,
  zeroMissThreshold,
} from './calibration.ts';

const pack = packs.migraine;
const LOCALES: readonly Locale[] = ['en', 'es', 'pt'];
/** Generous next to the function's 4 s: this measures judgment, not latency. */
const CALL_TIMEOUT_MS = 15_000;
const CONCURRENCY = 4;
/** Haiku answers booleans: true is 1 and false 0, so any threshold in between reads them the same. */
const BOOLEAN_THRESHOLD = 0.5;
// The mocks' hosts: `.env.local` and `supabase/config.toml` point the base URLs here for the local stack.
const LOCAL_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]', 'host.docker.internal']);

type ReplyFixture = { id: string; reply: string; toolResults?: ToolResultRecord[]; expected: { violated: string[] } };
type IntentFixture = { id: string; text: string; expected: { intent: Intent } };
type RedFlagFixtures = { positives: { text: string; expect: RedFlagKey[] }[]; negatives: { text: string }[]; modelOnly: { text: string; expect: RedFlagKey[] }[] };

export interface CalibrateDeps {
  /** Reads one environment variable: the shell's, never `.env.local`, whose base URLs point at the mocks. */
  env: (name: string) => string | undefined;
  fetch: typeof fetch;
  /** Reads a file of `calibration/` by name. */
  readFixture: (name: string) => unknown;
  log: (line: string) => void;
  error: (line: string) => void;
}

/** The input screen's answer for one text: each flag's probability and the top intent with its probability. */
type InputScore = { flags: Partial<Record<RedFlagKey, number>>; intent: Intent; intentP: number };

interface Layer {
  input(text: string): Promise<InputScore | null>;
  reply(fixture: ReplyFixture, locale: Locale): Promise<Partial<Record<GuardKey, number>> | null>;
  redFlagThreshold: number;
  guardThreshold(key: GuardKey): number;
}

function replyContext(fixture: ReplyFixture, locale: Locale): ReplyContext {
  return { toolResults: fixture.toolResults ?? [], userText: '', redFlags: [], mode: 'chat', locale };
}

function jevLayer(env: JevEnv, fetchFn: typeof fetch): Layer {
  return {
    async input(text) {
      const answers = parseInputAnswers(await runJev(env, fetchFn, buildInputRequest(text, pack, Math.random), CALL_TIMEOUT_MS), pack);
      if (answers === null) return null;
      const [intent, intentP] = INTENTS.reduce<[Intent, number]>((best, option) => {
        const p = answers.intent[option] ?? 0;
        return p > best[1] ? [option, p] : best;
      }, ['other', -1]);
      return { flags: answers.flags, intent, intentP };
    },
    async reply(fixture, locale) {
      const context = replyContext(fixture, locale);
      // The same request the function sends, with the numbers the local check found ungrounded.
      const request = buildReplyRequest(fixture.reply, context, localReplyChecks(fixture.reply, context).ungrounded);
      return parseReplyAnswers(await runJev(env, fetchFn, request, CALL_TIMEOUT_MS));
    },
    redFlagThreshold: RED_FLAG_THRESHOLD,
    guardThreshold: (key) => GUARD_THRESHOLDS[key],
  };
}

function claudeLayer(env: JevEnv & ClaudeEnv, fetchFn: typeof fetch): Layer {
  const deps: ScreenDeps = { env, fetch: fetchFn, pack, now: Date.now, deadline: Number.POSITIVE_INFINITY };
  return {
    async input(text) {
      const answer = await fallbackInput(text, pack, deps, CALL_TIMEOUT_MS);
      if (answer === null) return null;
      return { flags: Object.fromEntries(pack.redFlags.map((flag) => [flag.key, answer.flags.includes(flag.key) ? 1 : 0])), intent: answer.intent, intentP: 1 };
    },
    async reply(fixture, locale) {
      const context = replyContext(fixture, locale);
      const keys = await fallbackReply(fixture.reply, context, localReplyChecks(fixture.reply, context).ungrounded, deps, CALL_TIMEOUT_MS);
      return keys === null ? null : Object.fromEntries(GUARD_KEYS.map((key) => [key, keys.includes(key) ? 1 : 0]));
    },
    redFlagThreshold: BOOLEAN_THRESHOLD,
    guardThreshold: () => BOOLEAN_THRESHOLD,
  };
}

async function mapLimit<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await run(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Null for a hosted https URL; otherwise why calibrate refuses it. */
export function targetProblem(name: string, url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `${name} is not a URL.`;
  }
  if (LOCAL_HOSTS.has(parsed.hostname) || parsed.hostname.endsWith('.localhost') || parsed.hostname.startsWith('127.')) {
    return `${name} points at ${parsed.host}, a local mock. Unset it so calibrate reaches the hosted API.`;
  }
  if (parsed.protocol !== 'https:') return `${name} must be an https URL.`;
  return null;
}

const percent = (value: number): string => `${(value * 100).toFixed(1)}%`;
const fixed = (value: number): string => value.toFixed(2);

/** One key's line: the misses at the current threshold, the zero-miss threshold and the false hits there. */
function keyReport(log: (line: string) => void, key: string, scores: readonly Scored[], threshold: number, describe: (id: string) => string): void {
  const negatives = scores.filter((score) => !score.positive).length;
  const missed = missesAt(scores, threshold);
  const zero = zeroMissThreshold(scores);
  const atZero = zero === null ? 'no positives' : `zero-miss ${fixed(zero)}, false ${percent(falsePositiveRate(scores, zero))} of ${String(negatives)}`;
  log(`  ${key.padEnd(20)} at ${fixed(threshold)}: ${String(missed.length)} missed · ${atZero}`);
  for (const miss of missed) log(`    missed ${describe(miss.id)} (p ${fixed(miss.p)})`);
}

async function evalLocale(locale: Locale, layer: Layer, deps: CalibrateDeps): Promise<number> {
  let failed = 0;
  const { log } = deps;

  const replies = deps.readFixture(`unsafe-replies.${locale}.json`) as ReplyFixture[];
  const replyScores = await mapLimit(replies, CONCURRENCY, (fixture) => layer.reply(fixture, locale));
  log('reply guard');
  for (const key of GUARD_KEYS) {
    const scores = replies.flatMap((fixture, index): Scored[] => {
      const p = replyScores[index]?.[key];
      return p === undefined ? [] : [{ id: fixture.id, p, positive: fixture.expected.violated.includes(key) }];
    });
    keyReport(log, key, scores, layer.guardThreshold(key), (id) => id);
  }
  failed += replyScores.filter((score) => score === null).length;

  const redFlags = deps.readFixture(`red-flags.${locale}.json`) as RedFlagFixtures;
  // `positives` and `modelOnly` are positives for the flags they expect; `negatives` are negatives for every flag.
  const texts = [
    ...redFlags.positives.map((item, index) => ({ id: `${locale}-rf-p${String(index + 1)}`, text: item.text, expect: item.expect })),
    ...redFlags.modelOnly.map((item, index) => ({ id: `${locale}-rf-m${String(index + 1)}`, text: item.text, expect: item.expect })),
    ...redFlags.negatives.map((item, index) => ({ id: `${locale}-rf-n${String(index + 1)}`, text: item.text, expect: [] as RedFlagKey[] })),
  ];
  const textOf = new Map(texts.map((item) => [item.id, item.text]));
  const flagScores = await mapLimit(texts, CONCURRENCY, (item) => layer.input(item.text));
  log('red flags');
  for (const flag of pack.redFlags) {
    const scores = texts.flatMap((item, index): Scored[] => {
      const p = flagScores[index]?.flags[flag.key];
      if (p === undefined) return [];
      const positive = item.expect.includes(flag.key);
      // A positive for another flag says nothing about this one.
      return positive || item.expect.length === 0 ? [{ id: item.id, p, positive }] : [];
    });
    keyReport(log, flag.key, scores, layer.redFlagThreshold, (id) => `${id} "${textOf.get(id) ?? ''}"`);
  }
  failed += flagScores.filter((score) => score === null).length;

  const intents = deps.readFixture(`intents.${locale}.json`) as IntentFixture[];
  const intentScores = await mapLimit(intents, CONCURRENCY, (fixture) => layer.input(fixture.text));
  const rows = intents.flatMap((fixture, index) => {
    const score = intentScores[index];
    return score === null || score === undefined ? [] : [{ id: fixture.id, expected: fixture.expected.intent, got: score.intent, p: score.intentP }];
  });
  const { accuracy, actedWrong } = intentAccuracy(rows, INTENT_ACT_P);
  log(`intent: ${percent(accuracy)} right of ${String(rows.length)}, ${String(actedWrong)} wrong at p ≥ ${fixed(INTENT_ACT_P)} (acted on in crisis mode)`);
  for (const row of rows) {
    if (row.got !== row.expected) log(`    ${row.id}: ${row.expected} read as ${row.got} (p ${fixed(row.p)})`);
  }
  failed += intentScores.filter((score) => score === null).length;
  return failed;
}

/** Runs the command and returns the exit code: 0 done, 1 refused or a call failed, 2 usage. Never prints a key. */
export async function main(argv: readonly string[], deps: CalibrateDeps): Promise<number> {
  let args: CalibrateArgs;
  try {
    args = parseCalibrateArgs(argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    deps.error(error.message);
    return 2;
  }
  const ci = deps.env('CI');
  if (ci !== undefined && ci !== '' && ci !== 'false') {
    deps.error('calibrate calls the paid APIs with the owner’s keys, so it never runs in CI.');
    return 1;
  }
  let env: JevEnv & ClaudeEnv;
  try {
    env = readEnv(deps.env, ['jev', 'claude']);
  } catch (error) {
    // `missing env: NAME`: the name only, never a value.
    deps.error(`${error instanceof Error ? error.message : String(error)}. Export TYPESAFE_API_KEY and ANTHROPIC_API_KEY in this shell.`);
    return 1;
  }
  const problems = [targetProblem('TYPESAFE_BASE_URL', env.typesafeBaseUrl), targetProblem('ANTHROPIC_BASE_URL', env.anthropicBaseUrl)].filter(
    (problem) => problem !== null,
  );
  if (problems.length > 0) {
    for (const problem of problems) deps.error(problem);
    return 1;
  }

  const layer = args.layer === 'jev' ? jevLayer(env, deps.fetch) : claudeLayer(env, deps.fetch);
  let failed = 0;
  for (const locale of args.locale === 'all' ? LOCALES : [args.locale]) {
    deps.log(`== ${locale} · ${args.layer} ==`);
    failed += await evalLocale(locale, layer, deps);
  }
  if (failed > 0) {
    deps.error(`${String(failed)} call(s) failed and are left out of the numbers above.`);
    return 1;
  }
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2), {
    env: (name) => process.env[name],
    fetch,
    readFixture: (name) => JSON.parse(readFileSync(new URL(`../calibration/${name}`, import.meta.url), 'utf8')) as unknown,
    log: (line) => {
      console.log(line);
    },
    error: (line) => {
      console.error(line);
    },
  });
}
