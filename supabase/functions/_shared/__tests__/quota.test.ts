/** @jest-environment node */
// supabase/functions/_shared/__tests__/quota.test.ts
import type { SupabaseEnv } from '../env.ts';
import { consumeQuota, DAILY_LIMITS } from '../quota.ts';
import { fakeFetch, hanging, json } from './fakeFetch.ts';

const ENV: SupabaseEnv = { supabaseUrl: 'http://supabase.test', anonKey: 'anon-key-test', serviceRoleKey: 'service-role-test' };
const USER_ID = '8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

test('the daily limits', () => {
  expect(DAILY_LIMITS).toEqual({ companion: 40, dictation: 20, screen: 200 });
});

test('posts the rpc args with the service-role headers', async () => {
  const { fetch, calls } = fakeFetch(() => json(200, true));
  expect(await consumeQuota(ENV, fetch, USER_ID, 'dictation', DAILY_LIMITS.dictation, '2026-11-28')).toBe(true);
  const [call] = calls;
  expect(call?.method).toBe('POST');
  expect(call?.url.href).toBe('http://supabase.test/rest/v1/rpc/consume_quota');
  expect(call?.headers.get('apikey')).toBe('service-role-test');
  expect(call?.headers.get('authorization')).toBe('Bearer service-role-test');
  expect(call?.headers.get('content-type')).toBe('application/json');
  expect(JSON.parse(call?.body ?? '')).toEqual({ p_user_id: USER_ID, p_kind: 'dictation', p_limit: 20, p_day: '2026-11-28' });
});

test('false when the database refuses', async () => {
  expect(await consumeQuota(ENV, fakeFetch(() => json(200, false)).fetch, USER_ID, 'companion', 40, '2026-11-28')).toBe(false);
});

test.each([
  ['the string "true"', 'true'],
  ['1', 1],
  ['null', null],
  ['[true]', [true]],
  ['{}', {}],
])('true only for a JSON true, not %s', async (_label, body) => {
  expect(await consumeQuota(ENV, fakeFetch(() => json(200, body)).fetch, USER_ID, 'companion', 40, '2026-11-28')).toBe(false);
});

test('throws when the rpc fails, so the caller can answer 503', async () => {
  await expect(consumeQuota(ENV, fakeFetch(() => json(500, { message: 'boom' })).fetch, USER_ID, 'companion', 40, '2026-11-28')).rejects.toThrow();
});

test('a hung rpc is cut at the timeout the caller gives', async () => {
  const started = Date.now();
  await expect(consumeQuota(ENV, fakeFetch(hanging).fetch, USER_ID, 'companion', 40, '2026-11-28', 50)).rejects.toThrow(/abort/i);
  expect(Date.now() - started).toBeLessThan(2_000);
});
