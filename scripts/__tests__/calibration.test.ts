/** @jest-environment node */
// scripts/__tests__/calibration.test.ts: the maths and the CLI of `pnpm calibrate`, offline. The model
// answers come from fakes passed to `main`, never from the environment or a network.
import { readFileSync } from 'node:fs';

import { jevAnswersWith } from '../../integration/mockServices.ts';
import { type CalibrateDeps, main, targetProblem } from '../calibrate.ts';
import { falsePositiveRate, intentAccuracy, parseCalibrateArgs, UsageError, zeroMissThreshold } from '../calibration.ts';

const JEV_KEY = 'test-typesafe-key-never-printed';
const CLAUDE_KEY = 'test-anthropic-key-never-printed';

describe('the maths', () => {
  test('the zero-miss threshold is the lowest positive, and a negative above it is a false hit', () => {
    const scores = [
      { id: 'a', p: 0.4, positive: true },
      { id: 'b', p: 0.8, positive: true },
      { id: 'c', p: 0.5, positive: false },
    ];
    expect(zeroMissThreshold(scores)).toBe(0.4);
    expect(falsePositiveRate(scores, 0.4)).toBe(1);
    expect(falsePositiveRate(scores, 0.6)).toBe(0);
  });

  test('no positives give no threshold', () => {
    expect(zeroMissThreshold([{ id: 'c', p: 0.5, positive: false }])).toBeNull();
    expect(zeroMissThreshold([])).toBeNull();
  });

  test('a wrong intent counts as acted on only at or above actAt', () => {
    expect(intentAccuracy([{ expected: 'log_dose', got: 'other', p: 0.7 }], 0.6)).toEqual({ accuracy: 0, actedWrong: 1 });
    expect(intentAccuracy([{ expected: 'log_dose', got: 'other', p: 0.5 }], 0.6)).toEqual({ accuracy: 0, actedWrong: 0 });
    expect(
      intentAccuracy(
        [
          { expected: 'log_dose', got: 'log_dose', p: 0.9 },
          { expected: 'other', got: 'other', p: 0.4 },
        ],
        0.6,
      ),
    ).toEqual({ accuracy: 1, actedWrong: 0 });
  });
});

describe('the arguments', () => {
  test('eval defaults to every locale on Jev', () => {
    expect(parseCalibrateArgs(['eval'])).toEqual({ command: 'eval', locale: 'all', layer: 'jev' });
    expect(parseCalibrateArgs(['eval', '--locale', 'pt', '--layer', 'claude'])).toEqual({ command: 'eval', locale: 'pt', layer: 'claude' });
  });

  test.each([
    ['an unknown locale', ['eval', '--locale', 'fr']],
    ['an unknown layer', ['eval', '--layer', 'gpt']],
    ['an unknown flag', ['eval', '--write']],
    ['no command', []],
    ['another command', ['collect']],
    ['an extra word', ['eval', 'now']],
  ])('%s is a usage error', (_label, argv) => {
    expect(() => parseCalibrateArgs(argv)).toThrow(UsageError);
  });
});

describe('the hosted target', () => {
  test.each(['http://127.0.0.1:54518', 'http://localhost:54519', 'http://host.docker.internal:54518', 'http://0.0.0.0:1'])('%s is refused', (url) => {
    expect(targetProblem('TYPESAFE_BASE_URL', url)).toMatch(/local mock/);
  });

  test('a plain-http remote URL is refused and the hosted defaults pass', () => {
    expect(targetProblem('ANTHROPIC_BASE_URL', 'http://api.example.com')).toMatch(/https/);
    expect(targetProblem('TYPESAFE_BASE_URL', 'https://api.typesafe.ai')).toBeNull();
    expect(targetProblem('ANTHROPIC_BASE_URL', 'https://api.anthropic.com')).toBeNull();
  });
});

type Recorded = { url: string; headers: Headers; body: unknown };

function harness(env: Record<string, string>, answer: (url: URL, body: unknown) => unknown): { deps: CalibrateDeps; calls: Recorded[]; lines: string[] } {
  const calls: Recorded[] = [];
  const lines: string[] = [];
  const fakeFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : 'null') as unknown;
    calls.push({ url: url.href, headers: new Headers(init?.headers), body });
    return Promise.resolve(new Response(JSON.stringify(answer(url, body)), { status: 200, headers: { 'content-type': 'application/json' } }));
  }) as typeof fetch;
  const deps: CalibrateDeps = {
    env: (name) => env[name],
    fetch: fakeFetch,
    readFixture: (name) => JSON.parse(readFileSync(new URL(`../../calibration/${name}`, import.meta.url), 'utf8')) as unknown,
    log: (line) => lines.push(line),
    error: (line) => lines.push(line),
  };
  return { deps, calls, lines };
}

const KEYS = { TYPESAFE_API_KEY: JEV_KEY, ANTHROPIC_API_KEY: CLAUDE_KEY };
const unexpected = (): never => {
  throw new Error('no call expected');
};

describe('main', () => {
  test('with no keys it exits 1 before any call', async () => {
    const { deps, calls, lines } = harness({}, unexpected);
    await expect(main(['eval', '--locale', 'en'], deps)).resolves.toBe(1);
    expect(calls).toEqual([]);
    expect(lines.join('\n')).toMatch(/missing env: TYPESAFE_API_KEY/);
  });

  test('with one key missing it exits 1 before any call', async () => {
    const { deps, calls } = harness({ TYPESAFE_API_KEY: JEV_KEY }, unexpected);
    await expect(main(['eval'], deps)).resolves.toBe(1);
    expect(calls).toEqual([]);
  });

  test('a base URL at the local mocks is refused before any call', async () => {
    const { deps, calls, lines } = harness({ ...KEYS, ANTHROPIC_BASE_URL: 'http://127.0.0.1:54519' }, unexpected);
    await expect(main(['eval'], deps)).resolves.toBe(1);
    expect(calls).toEqual([]);
    expect(lines.join('\n')).toMatch(/ANTHROPIC_BASE_URL points at 127\.0\.0\.1:54519/);
  });

  test('it refuses to run in CI', async () => {
    const { deps, calls } = harness({ ...KEYS, CI: 'true' }, unexpected);
    await expect(main(['eval'], deps)).resolves.toBe(1);
    expect(calls).toEqual([]);
  });

  test('a usage error exits 2 before any call', async () => {
    const { deps, calls } = harness(KEYS, unexpected);
    await expect(main(['eval', '--locale', 'fr'], deps)).resolves.toBe(2);
    expect(calls).toEqual([]);
  });

  test('on Jev it asks the hosted API every question and reports each key, flag and the intents', async () => {
    // Every guard Noul 0.9 but dose_advice's 0.1, every red flag 0.02 (the mock's default), and intent `other`.
    const { deps, calls, lines } = harness(KEYS, (_url, body) => {
      const questions = (body as { questions: Record<string, unknown> }).questions;
      return jevAnswersWith(body, 'g_dose_advice' in questions ? { g_dose_advice: 0.1, g_medication_change: 0.9, g_diagnosis: 0.9 } : {});
    });
    await expect(main(['eval', '--locale', 'en'], deps)).resolves.toBe(0);
    const en = (name: string): number => (JSON.parse(readFileSync(new URL(`../../calibration/${name}`, import.meta.url), 'utf8')) as unknown[]).length;
    const redFlags = JSON.parse(readFileSync(new URL('../../calibration/red-flags.en.json', import.meta.url), 'utf8')) as Record<string, unknown[]>;
    const texts = Object.values(redFlags).reduce((sum, list) => sum + list.length, 0);
    expect(calls).toHaveLength(en('unsafe-replies.en.json') + texts + en('intents.en.json'));
    expect(new Set(calls.map((call) => call.url))).toEqual(new Set(['https://api.typesafe.ai/v1/systemone']));
    expect(calls.every((call) => call.headers.get('authorization') === `Bearer ${JEV_KEY}`)).toBe(true);
    // The reply request carries the local check's ungrounded numbers, as the function sends it.
    const numReply = calls.find((call) => JSON.stringify(call.body).includes('6 of your last 8 attacks'));
    expect((numReply?.body as { state: { numbers_not_in_tool_results: string[] } }).state.numbers_not_in_tool_results).toEqual(['6']);

    const output = lines.join('\n');
    expect(output).toMatch(/== en · jev ==/);
    expect(output).toMatch(/dose_advice\s+at 0\.35: \d+ missed · zero-miss 0\.10/);
    expect(output).toMatch(/diagnosis\s+at 0\.35: 0 missed · zero-miss 0\.90, false 100\.0% of \d+/);
    expect(output).toMatch(/thunderclap\s+at 0\.30: \d+ missed/);
    expect(output).toMatch(/missed en-rf-m1 "/);
    expect(output).toMatch(/intent: \d+\.\d% right of 26/);
    expect(output).not.toContain(JEV_KEY);
    expect(output).not.toContain(CLAUDE_KEY);
  });

  test('on Haiku it sends the fallback requests to the hosted Messages API', async () => {
    const { deps, calls, lines } = harness(KEYS, (_url, body) => {
      const schema = (body as { output_config: { format: { schema: { required: string[] } } } }).output_config.format.schema;
      const output = Object.fromEntries(schema.required.map((key) => [key, key === 'intent' ? 'other' : false]));
      return { type: 'message', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(output) }] };
    });
    await expect(main(['eval', '--locale', 'es', '--layer', 'claude'], deps)).resolves.toBe(0);
    expect(new Set(calls.map((call) => call.url))).toEqual(new Set(['https://api.anthropic.com/v1/messages']));
    expect(calls.every((call) => call.headers.get('x-api-key') === CLAUDE_KEY)).toBe(true);
    expect(calls.every((call) => (call.body as { model: string }).model === 'claude-haiku-5-5')).toBe(true);
    const output = lines.join('\n');
    expect(output).toMatch(/== es · claude ==/);
    expect(output).toMatch(/dose_advice\s+at 0\.50: \d+ missed · zero-miss 0\.00/);
    expect(output).not.toContain(CLAUDE_KEY);
  });

  test('a failed call is reported and exits 1', async () => {
    const { deps, lines } = harness(KEYS, () => ({ answers: {} }));
    await expect(main(['eval', '--locale', 'pt'], deps)).resolves.toBe(1);
    expect(lines.join('\n')).toMatch(/\d+ call\(s\) failed/);
  });
});
