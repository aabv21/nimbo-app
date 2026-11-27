// The mock Messages API's replies, its 2026-10-21 validation and what it records; it needs no local stack, only its own port.

import { type MockAnthropic, startMockAnthropic } from './mockAnthropic';

const url = 'http://127.0.0.1:54519/v1/messages';
const BODY = { model: 'claude-haiku-5-5', max_tokens: 256, messages: [{ role: 'user', content: 'hi' }] };
const ANSWER = { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' };

let mock: MockAnthropic;

beforeAll(async () => {
  mock = await startMockAnthropic();
});

afterAll(async () => {
  await mock.close();
});

const post = (body: unknown, headers: Record<string, string> = {}): Promise<Response> =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('answers 500 until a reply is set, which the functions read as Claude being down', async () => {
  expect((await post(BODY)).status).toBe(500);
});

test('respondWithSequence answers in order, then falls back to respondWith', async () => {
  mock.respondWith({ status: 200, body: ANSWER });
  mock.respondWithSequence([{ status: 529, body: { type: 'error' } }]);
  expect((await post(BODY)).status).toBe(529);
  expect((await post(BODY)).status).toBe(200);
});

test.each(['temperature', 'top_p', 'top_k'])('a request with `%s` is a 400, as API version 2026-10-21 refuses it', async (field) => {
  mock.respondWith({ status: 200, body: ANSWER });
  mock.respondWithSequence([{ status: 200, body: { queued: true } }]);
  const response = await post({ ...BODY, [field]: 1 });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ type: 'error', error: { type: 'invalid_request_error', message: expect.stringContaining(field) as string } });
  // The refused call does not use up the queued reply.
  expect(await (await post(BODY)).json()).toEqual({ queued: true });
});

test('records each call body and its headers, in order, so a test can check anthropic-beta arrived', async () => {
  const before = mock.calls();
  await post(BODY, { 'x-api-key': 'local-only-not-a-key', 'anthropic-version': '2026-10-21', 'anthropic-beta': 'server-side-fallback-2026-07-01' });
  expect(mock.calls()).toBe(before + 1);
  expect(mock.requests()).toHaveLength(mock.calls());
  expect(mock.headers()).toHaveLength(mock.calls());
  expect(mock.requests().at(before)).toEqual(BODY);
  expect(mock.headers().at(before)).toMatchObject({
    'x-api-key': 'local-only-not-a-key',
    'anthropic-version': '2026-10-21',
    'anthropic-beta': 'server-side-fallback-2026-07-01',
  });
});
