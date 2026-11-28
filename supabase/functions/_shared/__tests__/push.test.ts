/** @jest-environment node */
// supabase/functions/_shared/__tests__/push.test.ts
import type { PushEnv, SupabaseEnv } from '../env.ts';
import { deleteTokens, EXPO_PUSH_BATCH, EXPO_PUSH_TIMEOUT_MS, EXPO_RECEIPT_BATCH, getReceipts, PUSH_CHANNEL_ID, sendPushes, type PushMessage } from '../push.ts';
import { fakeFetch, hanging, json } from './fakeFetch.ts';

const { jest } = import.meta;

const ENV: PushEnv & SupabaseEnv = {
  supabaseUrl: 'http://supabase.test',
  anonKey: 'anon-test',
  serviceRoleKey: 'service-role-test',
  expoPushUrl: 'http://expo.test/--/api/v2/push',
  expoAccessToken: '',
};

const message = (n: number): PushMessage => ({
  to: `ExponentPushToken[${String(n)}]`,
  title: 'You have a note from Nimbo',
  data: { url: '/today', signalId: `signal-${String(n)}` },
});

const bodyOf = (body: string | undefined): unknown[] => JSON.parse(body ?? '[]') as unknown[];

/** An `ok` ticket per message, with ids `ticket-<batch>-<index>`. */
function okTickets(batchIndex: number, body: string | undefined): Response {
  return json(200, { data: bodyOf(body).map((_, i) => ({ status: 'ok', id: `ticket-${String(batchIndex)}-${String(i)}` })) });
}

afterEach(() => {
  jest.useRealTimers();
});

describe('sendPushes', () => {
  test('posts to /send on the signals channel with the default sound and returns one ticket per ok message', async () => {
    const { fetch, calls } = fakeFetch((call) => okTickets(0, call.body));

    const result = await sendPushes(ENV, fetch, [message(1), message(2)]);

    expect(PUSH_CHANNEL_ID).toBe('signals');
    expect(result).toEqual({
      sent: 2,
      failed: 0,
      dead: [],
      tickets: [
        { token: 'ExponentPushToken[1]', id: 'ticket-0-0' },
        { token: 'ExponentPushToken[2]', id: 'ticket-0-1' },
      ],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.href).toBe(`${ENV.expoPushUrl}/send`);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.headers.get('content-type')).toBe('application/json');
    expect(calls[0]?.headers.has('authorization')).toBe(false);
    expect(bodyOf(calls[0]?.body)).toEqual([
      { ...message(1), channelId: 'signals', sound: 'default' },
      { ...message(2), channelId: 'signals', sound: 'default' },
    ]);
  });

  test('a data-only message (a claim code) goes without title, sound or channel, at high priority', async () => {
    const { fetch, calls } = fakeFetch((call) => okTickets(0, call.body));

    await sendPushes(ENV, fetch, [{ to: 'ExponentPushToken[1]', data: { type: 'push-claim', code: 'ABCD2345', nonce: 'ab'.repeat(16) } }]);

    expect(bodyOf(calls[0]?.body)).toEqual([
      { to: 'ExponentPushToken[1]', data: { type: 'push-claim', code: 'ABCD2345', nonce: 'ab'.repeat(16) }, priority: 'high', _contentAvailable: true },
    ]);
  });

  test('authorization is sent only when the access token is set', async () => {
    const { fetch, calls } = fakeFetch((call) => okTickets(0, call.body));
    await sendPushes({ ...ENV, expoAccessToken: 'expo-token' }, fetch, [message(1)]);
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer expo-token');
  });

  test('sends nothing for no messages', async () => {
    const { fetch, calls } = fakeFetch((call) => okTickets(0, call.body));
    expect(await sendPushes(ENV, fetch, [])).toEqual({ sent: 0, failed: 0, dead: [], tickets: [] });
    expect(calls).toHaveLength(0);
  });

  test(`batches at most ${String(EXPO_PUSH_BATCH)} messages per request`, async () => {
    let batch = 0;
    const { fetch, calls } = fakeFetch((call) => okTickets(batch++, call.body));

    const result = await sendPushes(ENV, fetch, Array.from({ length: 201 }, (_, n) => message(n)));

    expect(calls.map((call) => bodyOf(call.body).length)).toEqual([100, 100, 1]);
    expect(result.sent).toBe(201);
    expect(result.tickets).toHaveLength(201);
    expect(result.tickets.at(-1)).toEqual({ token: 'ExponentPushToken[200]', id: 'ticket-2-0' });
  });

  test('a DeviceNotRegistered ticket lands in dead; other errors only count as failed', async () => {
    const { fetch } = fakeFetch(() =>
      json(200, {
        data: [
          { status: 'ok', id: 't1' },
          { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } },
          { status: 'error', message: 'too big', details: { error: 'MessageTooBig' } },
        ],
      }),
    );

    expect(await sendPushes(ENV, fetch, [message(1), message(2), message(3)])).toEqual({
      sent: 1,
      failed: 2,
      dead: ['ExponentPushToken[2]'],
      tickets: [{ token: 'ExponentPushToken[1]', id: 't1' }],
    });
  });

  test.each([
    ['a 500', () => json(500, { errors: [{ code: 'INTERNAL' }] })],
    ['a body without tickets', () => json(200, { errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS' }] })],
    ['fewer tickets than messages', () => json(200, { data: [{ status: 'ok', id: 'x' }] })],
    ['a non-JSON body', () => new Response('<html>', { status: 200 })],
    ['a network error', () => Promise.reject(new TypeError('network'))],
  ])('%s counts that batch as failed, never throws, and the next batch still goes', async (_label, failure) => {
    let batch = 0;
    const { fetch, calls } = fakeFetch((call) => (batch++ === 0 ? failure() : okTickets(1, call.body)));

    const result = await sendPushes(ENV, fetch, Array.from({ length: 102 }, (_, n) => message(n)));

    expect(result).toEqual({ sent: 2, failed: 100, dead: [], tickets: [
      { token: 'ExponentPushToken[100]', id: 'ticket-1-0' },
      { token: 'ExponentPushToken[101]', id: 'ticket-1-1' },
    ] });
    expect(calls).toHaveLength(2);
  });

  test(`gives up on a batch after ${String(EXPO_PUSH_TIMEOUT_MS)} ms`, async () => {
    jest.useFakeTimers();
    const { fetch } = fakeFetch(hanging);

    const pending = sendPushes(ENV, fetch, [message(1)]);
    await jest.advanceTimersByTimeAsync(EXPO_PUSH_TIMEOUT_MS);

    expect(await pending).toEqual({ sent: 0, failed: 1, dead: [], tickets: [] });
  });
});

describe('getReceipts', () => {
  test('posts { ids } to /getReceipts and splits checked from dead', async () => {
    const { fetch, calls } = fakeFetch(() =>
      json(200, {
        data: {
          a: { status: 'ok' },
          b: { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
          c: { status: 'error', message: 'rate', details: { error: 'MessageRateExceeded' } },
        },
      }),
    );

    const result = await getReceipts(ENV, fetch, ['a', 'b', 'c', 'd']);

    expect(calls[0]?.url.href).toBe(`${ENV.expoPushUrl}/getReceipts`);
    expect(calls[0]?.method).toBe('POST');
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual({ ids: ['a', 'b', 'c', 'd'] });
    expect(calls[0]?.headers.has('authorization')).toBe(false);
    // `d` has no receipt yet: it stays unchecked, so the caller asks again later.
    expect(result).toEqual({ checked: ['a', 'b', 'c'], dead: ['b'] });
  });

  test('authorization is sent only when the access token is set', async () => {
    const { fetch, calls } = fakeFetch(() => json(200, { data: {} }));
    await getReceipts({ ...ENV, expoAccessToken: 'expo-token' }, fetch, ['a']);
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer expo-token');
  });

  test(`asks in chunks of ${String(EXPO_RECEIPT_BATCH)} ids`, async () => {
    const { fetch, calls } = fakeFetch(() => json(200, { data: {} }));
    await getReceipts(ENV, fetch, Array.from({ length: 2001 }, (_, n) => `id-${String(n)}`));
    expect(calls.map((call) => (JSON.parse(call.body ?? '') as { ids: string[] }).ids.length)).toEqual([1000, 1000, 1]);
  });

  test.each([
    ['a 500', () => json(500, {})],
    ['a body without data', () => json(200, { errors: [] })],
    ['a network error', () => Promise.reject(new TypeError('network'))],
  ])('%s checks nothing and never throws', async (_label, failure) => {
    const { fetch } = fakeFetch(failure);
    await expect(getReceipts(ENV, fetch, ['a'])).resolves.toEqual({ checked: [], dead: [] });
  });

  test('no ids: no call', async () => {
    const { fetch, calls } = fakeFetch(() => json(200, { data: {} }));
    expect(await getReceipts(ENV, fetch, [])).toEqual({ checked: [], dead: [] });
    expect(calls).toHaveLength(0);
  });
});

describe('deleteTokens', () => {
  test('deletes exactly those tokens with the service role', async () => {
    const { fetch, calls } = fakeFetch(() => json(200, [{ token: 'ExponentPushToken[a]' }]));

    await deleteTokens(ENV, fetch, ['ExponentPushToken[a]', 'ExponentPushToken[b"c]']);

    expect(calls).toHaveLength(1);
    expect(`${calls[0]?.url.origin ?? ''}${calls[0]?.url.pathname ?? ''}`).toBe(`${ENV.supabaseUrl}/rest/v1/push_tokens`);
    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.url.searchParams.get('token')).toBe('in.("ExponentPushToken[a]","ExponentPushToken[b\\"c]")');
    expect(calls[0]?.headers.get('authorization')).toBe(`Bearer ${ENV.serviceRoleKey}`);
  });

  test(`deletes in chunks of ${String(EXPO_PUSH_BATCH)}`, async () => {
    const { fetch, calls } = fakeFetch(() => json(200, []));
    await deleteTokens(ENV, fetch, Array.from({ length: 250 }, (_, n) => `ExponentPushToken[${String(n)}]`));
    expect(calls.map((call) => (call.url.searchParams.get('token')?.match(/ExponentPushToken/g) ?? []).length)).toEqual([100, 100, 50]);
  });

  test('does nothing for no tokens', async () => {
    const { fetch, calls } = fakeFetch(() => json(200, []));
    await deleteTokens(ENV, fetch, []);
    expect(calls).toHaveLength(0);
  });

  test('throws when the database refuses, so the caller can count it', async () => {
    const { fetch } = fakeFetch(() => json(500, {}));
    await expect(deleteTokens(ENV, fetch, ['ExponentPushToken[a]'])).rejects.toThrow();
  });
});
