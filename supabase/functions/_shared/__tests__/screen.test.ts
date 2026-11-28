/** @jest-environment node */
// The two screens with a fake fetch: Jev answers built from the fixtures, then each fallback, then the
// offline floor. These prove the plumbing and thresholds, not Jev's judgment (docs/testing.md#calibration-fixtures).
import { readFileSync } from 'node:fs';

import { GUARD_KEYS, type GuardKey } from '../companion/contract.ts';
import { matchRedFlagsAnyLocale, packs, type Locale, type RedFlagKey } from '../condition/index.ts';
import type { ClaudeEnv, JevEnv } from '../env.ts';
import {
  GUARD_THRESHOLDS,
  INPUT_SCREEN_MS,
  INTENT_ACT_P,
  RED_FLAG_THRESHOLD,
  REPLY_SCREEN_MS,
  type ReplyContext,
  type ScreenDeps,
  screenInput,
  screenReply,
} from '../screen.ts';
import { jevAnswersWith } from '../../../../integration/mockServices.ts';
import { intentFixtures, locales, replyFixture, replyFixtures, type ReplyFixture } from './calibration.ts';
import { fakeFetch, hanging, json, type Call } from './fakeFetch.ts';

const pack = packs.migraine;
const ENV: JevEnv & ClaudeEnv = {
  typesafeApiKey: 'typesafe-key-test',
  typesafeBaseUrl: 'http://typesafe.test',
  anthropicApiKey: 'anthropic-key-test',
  anthropicBaseUrl: 'http://anthropic.test',
};

type Answer = (call: Call, init: RequestInit) => Response | Promise<Response>;
const down: Answer = () => json(500, { type: 'error' });
const isJev = (call: Call) => call.url.host === 'typesafe.test';

/** A fake fetch routing System One and Messages calls, with `leftMs` before the deadline. */
function setup(jev: Answer, haiku: Answer = down, leftMs = 20_000) {
  const { fetch, calls } = fakeFetch((call, init) => (isJev(call) ? jev(call, init) : haiku(call, init)));
  const deps: ScreenDeps = { env: ENV, fetch, pack, now: Date.now, deadline: Date.now() + leftMs, rand: Math.random };
  return { deps, jevCalls: () => calls.filter(isJev), haikuCalls: () => calls.filter((call) => !isJev(call)) };
}

const jevWith = (overrides: (request: unknown) => Record<string, number | string>): Answer => (call) => {
  const request: unknown = JSON.parse(call.body ?? 'null');
  return json(200, jevAnswersWith(request, overrides(request)));
};

const haikuSays = (output: unknown): Answer => () =>
  json(200, { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(output) }] });

function contextOf(fixture: ReplyFixture, locale: Locale): ReplyContext {
  return { toolResults: fixture.toolResults ?? [], userText: fixture.userText ?? '', earlierUserTexts: fixture.earlierUserTexts ?? [], redFlags: [], mode: 'chat', locale };
}

/** The fixture's verdict as Jev answers: its violated keys at 0.95, the rest at the mock's 0.02. */
const jevVerdict = (violated: readonly string[]) => jevWith(() => Object.fromEntries(violated.map((key) => [`g_${key}`, 0.95])));

test('the thresholds and budgets', () => {
  expect(RED_FLAG_THRESHOLD).toBe(0.3);
  expect(GUARD_THRESHOLDS).toEqual(Object.fromEntries(GUARD_KEYS.map((key) => [key, 0.35])));
  expect(INTENT_ACT_P).toBe(0.6);
  expect(INPUT_SCREEN_MS).toEqual({ jev: 4_000, claude: 4_000 });
});

describe('screenReply', () => {
  test.each(locales)('%s unsafe fixtures: zero misses through jev', async (locale) => {
    const misses: { id: string; violated: GuardKey[] }[] = [];
    for (const fixture of replyFixtures(locale).filter((item) => !item.expected.safe)) {
      const { deps } = setup(jevVerdict(fixture.expected.violated));
      const result = await screenReply(fixture.reply, contextOf(fixture, locale), deps);
      const caught = result.guard === 'replaced' && result.source === 'jev' && fixture.expected.violated.every((key) => result.violated.includes(key as GuardKey));
      if (!caught) misses.push({ id: fixture.id, violated: result.violated });
    }
    expect(misses).toEqual([]);
  });

  test.each(locales)('%s safe fixtures: no replacement', async (locale) => {
    const replaced: string[] = [];
    for (const fixture of replyFixtures(locale).filter((item) => item.expected.safe)) {
      const { deps } = setup(jevVerdict([]));
      const result = await screenReply(fixture.reply, contextOf(fixture, locale), deps);
      if (result.guard !== 'ok' || result.source !== 'jev') replaced.push(fixture.id);
    }
    expect(replaced).toEqual([]);
  });

  test('the Jev state carries the reply, the user message, the earlier user messages, the tool results, the flags, the mode and the ungrounded numbers', async () => {
    const fixture = replyFixture('en-num-01');
    const { deps, jevCalls } = setup(jevVerdict([]));
    await screenReply(fixture.reply, { ...contextOf(fixture, 'en'), userText: 'why?', earlierUserTexts: ['how many?'], redFlags: ['weakness'], mode: 'crisis' }, deps);
    const sent = JSON.parse(jevCalls()[0]?.body ?? '{}') as { state: unknown };
    expect(sent.state).toEqual({
      reply: fixture.reply,
      user_message: 'why?',
      earlier_user_messages: ['how many?'],
      tool_results: fixture.toolResults,
      red_flags_detected: ['weakness'],
      mode: 'crisis',
      numbers_not_in_tool_results: ['6'],
    });
  });

  test('a key at its threshold violates; just below does not', async () => {
    const at = setup(jevWith(() => ({ g_prediction: 0.35 })));
    expect(await screenReply('Rest now.', contextOf(replyFixture('en-safe-01'), 'en'), at.deps)).toEqual({ guard: 'replaced', violated: ['prediction'], source: 'jev' });
    const below = setup(jevWith(() => ({ g_prediction: 0.34 })));
    expect(await screenReply('Rest now.', contextOf(replyFixture('en-safe-01'), 'en'), below.deps)).toEqual({ guard: 'ok', violated: [], source: 'jev' });
  });

  test('the local keys join the model keys in guard order, whatever the source', async () => {
    const fixture = replyFixture('en-dose-01');
    const { deps } = setup(jevWith(() => ({ g_prediction: 0.9 })));
    expect(await screenReply(fixture.reply, contextOf(fixture, 'en'), deps)).toEqual({
      guard: 'replaced',
      violated: ['dose_advice', 'prediction'],
      source: 'jev',
    });
  });

  test("Jev 500 → Haiku answers → source 'claude' with Haiku's keys", async () => {
    const fixture = replyFixture('en-dx-01');
    const keys = Object.fromEntries(GUARD_KEYS.map((key) => [key, key === 'diagnosis']));
    const { deps, haikuCalls } = setup(down, haikuSays(keys));
    expect(await screenReply(fixture.reply, contextOf(fixture, 'en'), deps)).toEqual({ guard: 'replaced', violated: ['diagnosis'], source: 'claude' });
    expect(haikuCalls()).toHaveLength(1);
  });

  const missingKey: Answer = (call) => {
    const body = jevAnswersWith(JSON.parse(call.body ?? 'null'), {}) as { answers: Record<string, unknown> };
    const answers = Object.fromEntries(Object.entries(body.answers).filter(([id]) => id !== 'g_diagnosis'));
    return json(200, { ...body, answers });
  };
  test.each([
    ['a value that is not a number', () => json(200, { model: 'jev', answers: { g_dose_advice: { type: 'noul', noul: 'high' } } })],
    ['a missing key', missingKey],
    ['a body that is not JSON', () => new Response('<html>busy</html>', { status: 200 })],
  ] as [string, Answer][])('%s goes to Haiku, without a Jev retry', async (_label, jev) => {
    const keys = Object.fromEntries(GUARD_KEYS.map((key) => [key, false]));
    const { deps, jevCalls } = setup(jev, haikuSays(keys));
    expect((await screenReply('Rest now.', contextOf(replyFixture('en-safe-01'), 'en'), deps)).source).toBe('claude');
    expect(jevCalls()).toHaveLength(1);
  });

  describe('both fail', () => {
    test("en-dose-01 is replaced (dose_advice), with source 'none'", async () => {
      const fixture = replyFixture('en-dose-01');
      const { deps } = setup(down, down);
      // "You can take" is take advice, and its "400" is in no tool result either.
      expect(await screenReply(fixture.reply, contextOf(fixture, 'en'), deps)).toEqual({
        guard: 'replaced',
        violated: ['dose_advice', 'medication_change', 'ungrounded_number'],
        source: 'none',
      });
    });

    test("en-num-02 is replaced (ungrounded_number), with source 'none'", async () => {
      const fixture = replyFixture('en-num-02');
      const { deps } = setup(down, down);
      expect(await screenReply(fixture.reply, contextOf(fixture, 'en'), deps)).toEqual({
        guard: 'replaced',
        violated: ['ungrounded_number'],
        source: 'none',
      });
    });

    test("en-safe-01 comes back degraded, never ok, with source 'none'", async () => {
      const fixture = replyFixture('en-safe-01');
      const { deps } = setup(down, down);
      expect(await screenReply(fixture.reply, contextOf(fixture, 'en'), deps)).toEqual({ guard: 'degraded', violated: [], source: 'none' });
    });

    test.each(locales)('%s: with both down, no safe fixture is ever ok and no unsafe dose or take fixture passes', async (locale) => {
      for (const fixture of replyFixtures(locale)) {
        const { deps } = setup(down, down);
        const result = await screenReply(fixture.reply, contextOf(fixture, locale), deps);
        expect({ id: fixture.id, ok: result.guard === 'ok' }).toEqual({ id: fixture.id, ok: false });
        if (/-(dose-0[123]|quote-0[246]|med-05|multi-01|inj-0[1-4]|jb-0[12])$/.test(fixture.id)) {
          expect({ id: fixture.id, guard: result.guard }).toEqual({ id: fixture.id, guard: 'replaced' });
        }
      }
    });

    test.each([
      ['a quote plus "take one now"', 'In your cabinet you saved "50 mg, 1 tablet at onset", so take one now.', '50 mg, 1 tablet at onset', ['medication_change']],
      ['a saved amount with "take"', 'Take 50 mg of sumatriptan now.', '50 mg', ['medication_change']],
      ['a pt interval', 'Pode repetir de 6 em 6 horas.', '1 g', ['dose_advice', 'medication_change', 'ungrounded_number']],
      ['an interval range', 'You can repeat it every 4-6 hours.', '1 g', ['dose_advice', 'medication_change', 'ungrounded_number']],
    ])('%s is replaced', async (_label, reply, saved, violated) => {
      const toolResults = [{ tool: 'get_cabinet', result: { medications: [{ name: 'sumatriptan', dose_text: saved }] } }];
      const { deps } = setup(down, down);
      expect(await screenReply(reply, { toolResults, userText: '', redFlags: [], mode: 'chat', locale: 'en' }, deps)).toEqual({
        guard: 'replaced',
        violated,
        source: 'none',
      });
    });

    test('take advice decides only when both models are down', async () => {
      const toolResults = [{ tool: 'get_cabinet', result: { medications: [{ name: 'sumatriptan', dose_text: '50 mg' }] } }];
      const { deps } = setup(jevVerdict([]));
      const result = await screenReply('Take 50 mg of sumatriptan now.', { toolResults, userText: '', redFlags: [], mode: 'chat', locale: 'en' }, deps);
      expect(result).toEqual({ guard: 'ok', violated: [], source: 'jev' });
    });

    test('a refusal and a bad answer count as failures too', async () => {
      const fixture = replyFixture('en-num-02');
      const { deps } = setup(() => json(200, { model: 'jev', answers: {} }), () => json(200, { stop_reason: 'refusal', content: [] }));
      expect(await screenReply(fixture.reply, contextOf(fixture, 'en'), deps)).toEqual({ guard: 'replaced', violated: ['ungrounded_number'], source: 'none' });
    });
  });

  test('Jev 429 with 10 s left retries once', async () => {
    let jevCount = 0;
    const jev: Answer = (call, init) => (++jevCount === 1 ? json(429, { detail: 'rate limited' }) : jevVerdict([])(call, init));
    const { deps, jevCalls, haikuCalls } = setup(jev, down, 10_000);
    expect(await screenReply('Rest now.', contextOf(replyFixture('en-safe-01'), 'en'), deps)).toEqual({ guard: 'ok', violated: [], source: 'jev' });
    expect(jevCalls()).toHaveLength(2);
    expect(haikuCalls()).toHaveLength(0);
  });

  test('Jev 529 twice: one retry, then Haiku', async () => {
    const keys = Object.fromEntries(GUARD_KEYS.map((key) => [key, false]));
    const { deps, jevCalls } = setup(() => json(529, { detail: 'overloaded' }), haikuSays(keys), 10_000);
    expect((await screenReply('Rest now.', contextOf(replyFixture('en-safe-01'), 'en'), deps)).source).toBe('claude');
    expect(jevCalls()).toHaveLength(2);
  });

  test('the Jev retry never eats into Haiku\'s 4 s', async () => {
    const { jest } = import.meta;
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    try {
      let jevCount = 0;
      const jev: Answer = (call, init) => (++jevCount === 1 ? json(429, {}) : hanging(call, init));
      const keys = Object.fromEntries(GUARD_KEYS.map((key) => [key, false]));
      const { deps, jevCalls, haikuCalls } = setup(jev, haikuSays(keys), 6_000);
      const pending = screenReply('Rest now.', contextOf(replyFixture('en-safe-01'), 'en'), deps);
      // The retry gets only what is left beyond Haiku's 4 s, so Haiku starts with 4 s still to go.
      await jest.advanceTimersByTimeAsync(2_000);
      expect(jevCalls()).toHaveLength(2);
      expect(haikuCalls()).toHaveLength(1);
      expect(deps.deadline - deps.now()).toBeGreaterThanOrEqual(REPLY_SCREEN_MS.claude);
      expect((await pending).source).toBe('claude');
    } finally {
      jest.useRealTimers();
    }
  });

  test('Jev 429 with 5 s left goes straight to Haiku: a retry would leave Haiku too little', async () => {
    const keys = Object.fromEntries(GUARD_KEYS.map((key) => [key, false]));
    const { deps, jevCalls } = setup(() => json(429, {}), haikuSays(keys), 5_000);
    expect((await screenReply('Rest now.', contextOf(replyFixture('en-safe-01'), 'en'), deps)).source).toBe('claude');
    expect(jevCalls()).toHaveLength(1);
  });

  test('Jev 429 with 2 s left goes to Haiku', async () => {
    const keys = Object.fromEntries(GUARD_KEYS.map((key) => [key, false]));
    const { deps, jevCalls, haikuCalls } = setup(() => json(429, { detail: 'rate limited' }), haikuSays(keys), 2_000);
    expect((await screenReply('Rest now.', contextOf(replyFixture('en-safe-01'), 'en'), deps)).source).toBe('claude');
    expect(jevCalls()).toHaveLength(1);
    expect(haikuCalls()).toHaveLength(1);
  });

  test('a 500 is not retried', async () => {
    const { deps, jevCalls } = setup(down, down, 10_000);
    await screenReply('Rest now.', contextOf(replyFixture('en-safe-01'), 'en'), deps);
    expect(jevCalls()).toHaveLength(1);
  });

  test('past the deadline no model is called, and the local checks still decide', async () => {
    const fixture = replyFixture('en-dose-01');
    const { deps, jevCalls, haikuCalls } = setup(jevVerdict([]), haikuSays({}), -1);
    expect(await screenReply(fixture.reply, contextOf(fixture, 'en'), deps)).toEqual({
      guard: 'replaced',
      violated: ['dose_advice', 'medication_change', 'ungrounded_number'],
      source: 'none',
    });
    expect(jevCalls()).toHaveLength(0);
    expect(haikuCalls()).toHaveLength(0);
  });

  test('a Jev that hangs is cut at the deadline, and nothing is left for Haiku', async () => {
    const fixture = replyFixture('en-num-02');
    const { deps, haikuCalls } = setup(hanging, haikuSays({}), 50);
    expect(await screenReply(fixture.reply, contextOf(fixture, 'en'), deps)).toEqual({ guard: 'replaced', violated: ['ungrounded_number'], source: 'none' });
    expect(haikuCalls()).toHaveLength(0);
  });

  test('never throws, even when fetch itself throws', async () => {
    const thrower: Answer = () => {
      throw new TypeError('boom');
    };
    const { deps } = setup(thrower, thrower);
    const result = await screenReply('Rest now.', contextOf(replyFixture('en-safe-01'), 'en'), deps);
    expect(result.source).toBe('none');
  });
});

interface RedFlagFile {
  modelOnly: { text: string; expect: RedFlagKey[] }[];
}

const modelOnly = (locale: Locale): RedFlagFile['modelOnly'] =>
  (JSON.parse(readFileSync(new URL(`../../../../calibration/red-flags.${locale}.json`, import.meta.url), 'utf8')) as RedFlagFile).modelOnly;

describe('screenInput', () => {
  test.each(['worst headache of my life', 'pior dor da minha vida'])(
    "%s with every model failing gives ['thunderclap'] from the keywords",
    async (text) => {
      const { deps } = setup(down, down);
      expect(await screenInput(text, deps)).toEqual({ redFlags: ['thunderclap'], intent: 'other', intentP: 0, source: 'keywords' });
    },
  );

  test.each(locales)('%s model-only red flags: caught through jev', async (locale) => {
    for (const { text, expect: keys } of modelOnly(locale)) {
      expect(matchRedFlagsAnyLocale(text, pack)).toEqual([]);
      const { deps } = setup(jevWith(() => Object.fromEntries(keys.map((key) => [`rf_${key}`, 0.9]))));
      const result = await screenInput(text, deps);
      expect({ text, redFlags: result.redFlags, source: result.source }).toEqual({ text, redFlags: keys, source: 'jev' });
    }
  });

  test("a Jev rf_weakness of 0.31 with no keyword gives ['weakness'], and 0.29 gives []", async () => {
    const over = setup(jevWith(() => ({ rf_weakness: 0.31 })));
    expect((await screenInput('my hand feels odd', over.deps)).redFlags).toEqual(['weakness']);
    const under = setup(jevWith(() => ({ rf_weakness: 0.29 })));
    expect((await screenInput('my hand feels odd', under.deps)).redFlags).toEqual([]);
  });

  test('the keyword flags join the Jev flags in pack order', async () => {
    const { deps } = setup(jevWith(() => ({ rf_pregnancy: 0.8 })));
    expect((await screenInput('worst headache of my life', deps)).redFlags).toEqual(['thunderclap', 'pregnancy']);
  });

  test("intent log_dose at 0.7 gives { intent: 'log_dose', intentP: 0.7 }", async () => {
    const jev: Answer = (call) => {
      const body = jevAnswersWith(JSON.parse(call.body ?? 'null'), { intent: 'log_dose' }) as { answers: Record<string, Record<string, unknown>> };
      const probabilities = Object.fromEntries(Object.keys(body.answers.intent?.probabilities as object).map((option) => [option, option === 'log_dose' ? 0.7 : 0.05]));
      return json(200, { ...body, answers: { ...body.answers, intent: { ...body.answers.intent, confidence: 0.7, probabilities } } });
    };
    const { deps } = setup(jev);
    expect(await screenInput('took a naproxen', deps)).toEqual({ redFlags: [], intent: 'log_dose', intentP: 0.7, source: 'jev' });
  });

  test.each(locales)('%s intent fixtures route through the parser', async (locale) => {
    for (const { text, expected } of intentFixtures(locale)) {
      const { deps } = setup(jevWith(() => ({ intent: expected.intent })));
      const result = await screenInput(text, deps);
      expect({ text, intent: result.intent, source: result.source }).toEqual({ text, intent: expected.intent, source: 'jev' });
      expect(result.intentP).toBeCloseTo(0.9);
    }
  });

  test('one request: the message as the only state, the Nouls and the intent Choice', async () => {
    const { deps, jevCalls } = setup(jevWith(() => ({})));
    await screenInput('hello there', deps);
    expect(jevCalls()).toHaveLength(1);
    const sent = JSON.parse(jevCalls()[0]?.body ?? '{}') as { state: unknown; questions: Record<string, unknown> };
    expect(sent.state).toEqual({ message: 'hello there' });
    expect(Object.keys(sent.questions)).toHaveLength(8);
  });

  test("Jev down → Haiku's flags join the keywords, intent at probability 1", async () => {
    const flags = Object.fromEntries(pack.redFlags.map((flag) => [flag.key, flag.key === 'head_injury']));
    const { deps, jevCalls } = setup(() => json(429, {}), haikuSays({ ...flags, intent: 'log_episode' }));
    expect(await screenInput('worst headache of my life after I fell', deps)).toEqual({
      redFlags: ['thunderclap', 'head_injury'],
      intent: 'log_episode',
      intentP: 1,
      source: 'claude',
    });
    // No retry on the input screen: the next layer is the retry.
    expect(jevCalls()).toHaveLength(1);
  });

  test('Haiku answering out of schema falls to the keywords', async () => {
    const { deps } = setup(down, haikuSays({ intent: 'panic' }));
    expect((await screenInput('hello', deps)).source).toBe('keywords');
  });

  test('a Jev that hangs is cut at 4 s, and Haiku gets its own 4 s', async () => {
    const { jest } = import.meta;
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    try {
      const flags = Object.fromEntries(pack.redFlags.map((flag) => [flag.key, false]));
      const { deps, haikuCalls } = setup(hanging, haikuSays({ ...flags, intent: 'other' }));
      const pending = screenInput('hello', deps);
      await jest.advanceTimersByTimeAsync(INPUT_SCREEN_MS.jev);
      expect((await pending).source).toBe('claude');
      expect(haikuCalls()).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  test('never throws, even when fetch itself throws', async () => {
    const thrower: Answer = () => {
      throw new TypeError('boom');
    };
    const { deps } = setup(thrower, thrower);
    expect((await screenInput('worst headache of my life', deps)).redFlags).toEqual(['thunderclap']);
  });
});
