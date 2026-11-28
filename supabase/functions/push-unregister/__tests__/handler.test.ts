/** @jest-environment node */
// supabase/functions/push-unregister/__tests__/handler.test.ts
import { createHash } from 'node:crypto';

import type { SupabaseEnv } from '../../_shared/env.ts';
import { chunkedRequest } from '../../_shared/__tests__/fakeFetch.ts';
import { handlePushUnregister, MAX_BODY_BYTES } from '../handler.ts';

const { jest } = import.meta;

const ENV: SupabaseEnv = { supabaseUrl: 'http://supabase.test', anonKey: 'anon-test', serviceRoleKey: 'service-role-test' };
const TOKEN = 'ExponentPushToken[phone-a]';
const SECRET = '1a'.repeat(32);
const USER_A = '8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const SECRET_HASH = createHash('sha256').update(SECRET).digest('hex');

type Call = { url: URL; method: string; headers: Headers };

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fakeFetch(answer: () => Response = () => json(200, [{ token: TOKEN }])) {
  const calls: Call[] = [];
  const fetchFn = ((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push({ url, method: init.method ?? 'GET', headers: new Headers(init.headers) });
    return Promise.resolve(answer());
  }) as typeof fetch;
  return { fetchFn, calls };
}

function request(body: unknown, { method = 'POST', raw }: { method?: string; raw?: string } = {}): Request {
  return new Request('http://functions.test/push-unregister', {
    method,
    headers: { 'content-type': 'application/json', apikey: 'anon-key' },
    ...(method === 'POST' ? { body: raw ?? JSON.stringify(body) } : {}),
  });
}

let infoSpy: jest.SpiedFunction<typeof console.info>;

beforeEach(() => {
  infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  infoSpy.mockRestore();
});

test('deletes only that account’s row holding that token under that device secret’s hash, and answers 204 with no body', async () => {
  const { fetchFn, calls } = fakeFetch();

  const response = await handlePushUnregister(request({ token: TOKEN, user_id: USER_A, device_secret: SECRET }), { env: ENV, fetch: fetchFn });

  expect(response.status).toBe(204);
  expect(await response.text()).toBe('');
  expect(calls).toHaveLength(1);
  expect(calls[0]?.method).toBe('DELETE');
  expect(calls[0]?.url.pathname).toBe('/rest/v1/push_tokens');
  expect(calls[0]?.url.searchParams.get('token')).toBe(`eq.${TOKEN}`);
  expect(calls[0]?.url.searchParams.get('user_id')).toBe(`eq.${USER_A}`);
  expect(calls[0]?.url.searchParams.get('device_secret_hash')).toBe(`eq.${SECRET_HASH}`);
  expect(calls[0]?.headers.get('authorization')).toBe(`Bearer ${ENV.serviceRoleKey}`);
});

test('a wrong secret deletes nothing (no row matches its hash) and answers the same 204', async () => {
  const { fetchFn, calls } = fakeFetch(() => json(200, []));
  const response = await handlePushUnregister(request({ token: TOKEN, user_id: USER_A, device_secret: '2b'.repeat(32) }), { env: ENV, fetch: fetchFn });
  expect(response.status).toBe(204);
  expect(calls[0]?.url.searchParams.get('device_secret_hash')).not.toBe(`eq.${SECRET_HASH}`);
});

test('a token no row holds answers the same 204, so it can’t probe which tokens exist', async () => {
  const { fetchFn } = fakeFetch(() => json(200, []));
  const response = await handlePushUnregister(request({ token: 'ExpoPushToken[nobody]', user_id: USER_A, device_secret: SECRET }), { env: ENV, fetch: fetchFn });
  expect(response.status).toBe(204);
});

test.each([
  ['a token in another format', { token: 'not-a-token', user_id: USER_A, device_secret: SECRET }],
  ['an empty bracket', { token: 'ExponentPushToken[]', user_id: USER_A, device_secret: SECRET }],
  ['a token over 255 characters', { token: `ExponentPushToken[${'a'.repeat(240)}]`, user_id: USER_A, device_secret: SECRET }],
  ['several tokens', { token: [TOKEN, TOKEN], user_id: USER_A, device_secret: SECRET }],
  ['a list body', [TOKEN]],
  ['no token', { user_id: USER_A, device_secret: SECRET }],
  ['no device secret', { token: TOKEN, user_id: USER_A }],
  ['no account (the old pending-list shape)', { token: TOKEN, device_secret: SECRET }],
  ['an account that isn’t a uuid', { token: TOKEN, user_id: 'user-1', device_secret: SECRET }],
  ['an account carrying a filter', { token: TOKEN, user_id: `${USER_A}&token=neq.x`, device_secret: SECRET }],
  ['a device secret under 128 bits', { token: TOKEN, user_id: USER_A, device_secret: 'abc123' }],
  ['a device secret that isn’t hex', { token: TOKEN, user_id: USER_A, device_secret: 'z'.repeat(64) }],
])('%s is refused with 400 before any fetch', async (_label, body) => {
  const { fetchFn, calls } = fakeFetch();
  const response = await handlePushUnregister(request(body), { env: ENV, fetch: fetchFn });
  expect(response.status).toBe(400);
  expect(calls).toHaveLength(0);
});

test('a body that isn’t JSON is refused with 400', async () => {
  const { fetchFn, calls } = fakeFetch();
  expect((await handlePushUnregister(request(null, { raw: '{token' }), { env: ENV, fetch: fetchFn })).status).toBe(400);
  expect(calls).toHaveLength(0);
});

test('a chunked body over the limit with no content-length is refused with 413, unread past the limit', async () => {
  const { fetchFn, calls } = fakeFetch();
  const { request: chunked, pulled } = chunkedRequest(1000, 512, 'http://functions.test/push-unregister');
  expect((await handlePushUnregister(chunked, { env: ENV, fetch: fetchFn })).status).toBe(413);
  expect(pulled()).toBeLessThan(10);
  expect(calls).toHaveLength(0);
});

test(`a body over ${String(MAX_BODY_BYTES)} bytes is refused with 413 before any fetch`, async () => {
  const { fetchFn, calls } = fakeFetch();
  const raw = JSON.stringify({ token: TOKEN, user_id: USER_A, device_secret: SECRET, padding: 'x'.repeat(MAX_BODY_BYTES) });
  expect((await handlePushUnregister(request(null, { raw }), { env: ENV, fetch: fetchFn })).status).toBe(413);
  expect(calls).toHaveLength(0);
});

test('a method other than POST is refused with 405', async () => {
  const { fetchFn, calls } = fakeFetch();
  expect((await handlePushUnregister(request(null, { method: 'GET' }), { env: ENV, fetch: fetchFn })).status).toBe(405);
  expect(calls).toHaveLength(0);
});

test('a database failure answers 500, so the phone keeps the token and tries again', async () => {
  const { fetchFn } = fakeFetch(() => json(500, { message: 'boom' }));
  expect((await handlePushUnregister(request({ token: TOKEN, user_id: USER_A, device_secret: SECRET }), { env: ENV, fetch: fetchFn })).status).toBe(500);
});

test('logs only an outcome word, never the token or the secret', async () => {
  const { fetchFn } = fakeFetch();
  await handlePushUnregister(request({ token: TOKEN, user_id: USER_A, device_secret: SECRET }), { env: ENV, fetch: fetchFn });
  expect(infoSpy.mock.calls).toEqual([[JSON.stringify({ outcome: 'unregistered' })]]);
});
