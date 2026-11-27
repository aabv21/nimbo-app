/** @jest-environment node */
// supabase/functions/_shared/__tests__/models.test.ts
import type { ClaudeEnv, JevEnv } from '../env.ts';
import {
  ANTHROPIC_VERSION,
  CLASSIFIER_MODEL,
  COMPANION_MODEL,
  FALLBACK_BETA,
  JEV_MODEL,
  runClaude,
  runJev,
} from '../models.ts';
import { fakeFetch, hanging, json } from './fakeFetch.ts';

const { jest } = import.meta;

const ENV: JevEnv & ClaudeEnv = {
  typesafeApiKey: 'typesafe-key-test',
  typesafeBaseUrl: 'http://typesafe.test',
  anthropicApiKey: 'anthropic-key-test',
  anthropicBaseUrl: 'http://anthropic.test',
};

afterEach(() => {
  jest.useRealTimers();
});

/** Settles `pending` against fake time: still open at `ms - 1`, answered at `ms`. */
async function expectNullAfter(pending: Promise<unknown>, ms: number): Promise<void> {
  let settled = false;
  const tracked = pending.then((value) => {
    settled = true;
    return value;
  });
  await jest.advanceTimersByTimeAsync(ms - 1);
  expect(settled).toBe(false);
  await jest.advanceTimersByTimeAsync(1);
  expect(await tracked).toBeNull();
}

test('the model constants', () => {
  expect(COMPANION_MODEL).toBe('claude-sonnet-5-5');
  expect(CLASSIFIER_MODEL).toBe('claude-haiku-5-5');
  expect(JEV_MODEL).toBe('jev-latest');
  expect(ANTHROPIC_VERSION).toBe('2026-10-21');
  expect(FALLBACK_BETA).toBe('server-side-fallback-2026-07-01');
});

describe('runClaude', () => {
  test('posts to /v1/messages with the API key and version, no beta header, and returns the body', async () => {
    const { fetch, calls } = fakeFetch(() => json(200, { content: [] }));
    expect(await runClaude(ENV, fetch, { model: CLASSIFIER_MODEL }, 1_000)).toEqual({ content: [] });
    const [call] = calls;
    expect(call?.method).toBe('POST');
    expect(call?.url.href).toBe('http://anthropic.test/v1/messages');
    expect(call?.headers.get('x-api-key')).toBe(ENV.anthropicApiKey);
    expect(call?.headers.get('anthropic-version')).toBe('2026-10-21');
    expect(call?.headers.get('content-type')).toBe('application/json');
    expect(call?.headers.has('anthropic-beta')).toBe(false);
    expect(JSON.parse(call?.body ?? '')).toEqual({ model: CLASSIFIER_MODEL });
  });

  test('with betas, sends them in anthropic-beta', async () => {
    const { fetch, calls } = fakeFetch(() => json(200, { content: [] }));
    await runClaude(ENV, fetch, {}, 1_000, { betas: [FALLBACK_BETA] });
    expect(calls[0]?.headers.get('anthropic-beta')).toBe('server-side-fallback-2026-07-01');
  });

  test('an empty betas list sends no beta header', async () => {
    const { fetch, calls } = fakeFetch(() => json(200, { content: [] }));
    await runClaude(ENV, fetch, {}, 1_000, { betas: [] });
    expect(calls[0]?.headers.has('anthropic-beta')).toBe(false);
  });

  test('null on a 500, a body that is not JSON, or a network error', async () => {
    expect(await runClaude(ENV, fakeFetch(() => json(500, { type: 'error' })).fetch, {}, 1_000)).toBeNull();
    expect(await runClaude(ENV, fakeFetch(() => new Response('<html>busy</html>', { status: 200 })).fetch, {}, 1_000)).toBeNull();
    expect(await runClaude(ENV, fakeFetch(() => Promise.reject(new TypeError('fetch failed'))).fetch, {}, 1_000)).toBeNull();
  });

  test('null once a fetch outlives timeoutMs', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    await expectNullAfter(runClaude(ENV, fakeFetch(hanging).fetch, {}, 4_000), 4_000);
  });
});

describe('runJev', () => {
  test('posts to /v1/systemone with the bearer key and returns the body', async () => {
    const { fetch, calls } = fakeFetch(() => json(200, { answers: {} }));
    expect(await runJev(ENV, fetch, { model: JEV_MODEL }, 1_000)).toEqual({ answers: {} });
    const [call] = calls;
    expect(call?.method).toBe('POST');
    expect(call?.url.href).toBe('http://typesafe.test/v1/systemone');
    expect(call?.headers.get('authorization')).toBe(`Bearer ${ENV.typesafeApiKey}`);
    expect(call?.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(call?.body ?? '')).toEqual({ model: JEV_MODEL });
  });

  test('null on a non-2xx answer, a body that is not JSON, or a network error', async () => {
    expect(await runJev(ENV, fakeFetch(() => json(429, { detail: 'rate limited' })).fetch, {}, 1_000)).toBeNull();
    expect(await runJev(ENV, fakeFetch(() => new Response('nope', { status: 200 })).fetch, {}, 1_000)).toBeNull();
    expect(await runJev(ENV, fakeFetch(() => Promise.reject(new TypeError('fetch failed'))).fetch, {}, 1_000)).toBeNull();
  });

  test.each([2_500, 6_000])('honors the timeout given (%i ms)', async (timeoutMs) => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    await expectNullAfter(runJev(ENV, fakeFetch(hanging).fetch, {}, timeoutMs), timeoutMs);
  });
});
