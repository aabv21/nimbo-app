/** @jest-environment node */
// supabase/functions/_shared/__tests__/rest.test.ts
import type { SupabaseEnv } from '../env.ts';
import { hasPremium } from '../premium.ts';
import { POSTGREST_TIMEOUT_MS, premiumClient, restJson, rpcClient, serviceHeaders, UpstreamError, userHeaders } from '../rest.ts';
import { fakeFetch, hanging, json } from './fakeFetch.ts';

const { jest } = import.meta;

const ENV: SupabaseEnv = { supabaseUrl: 'http://supabase.test', anonKey: 'anon-key-test', serviceRoleKey: 'service-role-test' };
const AUTH = 'Bearer caller.jwt.token';
const USER_ID = '8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

afterEach(() => {
  jest.useRealTimers();
});

describe('headers', () => {
  test('userHeaders sends the anon key and forwards the caller token, so RLS applies', () => {
    expect(userHeaders(ENV, AUTH)).toEqual({ apikey: 'anon-key-test', authorization: AUTH });
  });

  test('serviceHeaders sends the service role on both headers', () => {
    expect(serviceHeaders(ENV)).toEqual({ apikey: 'service-role-test', authorization: 'Bearer service-role-test' });
  });
});

describe('restJson', () => {
  test('the parsed body on 2xx', async () => {
    const { fetch, calls } = fakeFetch(() => json(200, [{ a: 1 }]));
    expect(await restJson(fetch, 'http://supabase.test/rest/v1/x', { headers: { apikey: 'k' } })).toEqual([{ a: 1 }]);
    expect(calls[0]?.headers.get('apikey')).toBe('k');
  });

  test('throws UpstreamError on non-2xx', async () => {
    const { fetch } = fakeFetch(() => json(503, { message: 'unavailable' }));
    await expect(restJson(fetch, 'http://supabase.test/rest/v1/x', {})).rejects.toBeInstanceOf(UpstreamError);
  });

  test('a call that never answers rejects after POSTGREST_TIMEOUT_MS', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    let settled = false;
    const pending = restJson(fakeFetch(hanging).fetch, 'http://supabase.test/rest/v1/x', {}).then(
      () => 'resolved',
      () => 'rejected',
    );
    void pending.then(() => {
      settled = true;
    });
    await jest.advanceTimersByTimeAsync(POSTGREST_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(await pending).toBe('rejected');
  });
});

describe('rpcClient', () => {
  test('posts the args to /rest/v1/rpc/<name> as the caller and answers the data', async () => {
    const { fetch, calls } = fakeFetch(() => json(200, { ok: true }));
    expect(await rpcClient(ENV, fetch, AUTH).rpc('some_rpc', { p_x: 1 })).toEqual({ data: { ok: true }, error: null });
    const [call] = calls;
    expect(call?.method).toBe('POST');
    expect(call?.url.href).toBe('http://supabase.test/rest/v1/rpc/some_rpc');
    expect(call?.headers.get('apikey')).toBe('anon-key-test');
    expect(call?.headers.get('authorization')).toBe(AUTH);
    expect(call?.headers.get('content-type')).toBe('application/json');
    expect(JSON.parse(call?.body ?? '')).toEqual({ p_x: 1 });
  });

  test('a void RPC (204, no body) answers null data and no error', async () => {
    const { fetch } = fakeFetch(() => new Response(null, { status: 204 }));
    expect(await rpcClient(ENV, fetch, AUTH).rpc('void_rpc', {})).toEqual({ data: null, error: null });
  });

  test('a PostgREST error answers null data and the error body, never throwing', async () => {
    const { fetch } = fakeFetch(() => json(403, { code: '42501', message: 'not allowed' }));
    expect(await rpcClient(ENV, fetch, AUTH).rpc('has_premium', { p_user: USER_ID })).toEqual({
      data: null,
      error: { code: '42501', message: 'not allowed' },
    });
  });

  test('a network error or a body that is not JSON answers an error, never throwing', async () => {
    const offline = await rpcClient(ENV, fakeFetch(() => Promise.reject(new TypeError('fetch failed'))).fetch, AUTH).rpc('x', {});
    expect(offline.data).toBeNull();
    expect(offline.error).not.toBeNull();
    const garbled = await rpcClient(ENV, fakeFetch(() => new Response('<html>', { status: 200 })).fetch, AUTH).rpc('x', {});
    expect(garbled.data).toBeNull();
    expect(garbled.error).not.toBeNull();
  });

  test('a name that is not a plain identifier is refused without a call', async () => {
    const { fetch, calls } = fakeFetch(() => json(200, true));
    const result = await rpcClient(ENV, fetch, AUTH).rpc('../profiles', {});
    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('premiumClient', () => {
  test('passes a boolean through', async () => {
    const { fetch, calls } = fakeFetch(() => json(200, true));
    expect(await premiumClient(ENV, fetch, AUTH).rpc('has_premium', { p_user: USER_ID })).toEqual({ data: true, error: null });
    expect(calls[0]?.url.pathname).toBe('/rest/v1/rpc/has_premium');
  });

  test('any data that is not a boolean reads as null', async () => {
    const { fetch } = fakeFetch(() => json(200, 'yes'));
    expect(await premiumClient(ENV, fetch, AUTH).rpc('has_premium', { p_user: USER_ID })).toEqual({ data: null, error: null });
  });

  test('hasPremium runs on it with the caller token (and type-checks)', async () => {
    expect(await hasPremium(premiumClient(ENV, fakeFetch(() => json(200, true)).fetch, AUTH), USER_ID)).toBe(true);
    expect(await hasPremium(premiumClient(ENV, fakeFetch(() => json(200, 'yes')).fetch, AUTH), USER_ID)).toBe(false);
    expect(await hasPremium(premiumClient(ENV, fakeFetch(() => json(403, { code: '42501' })).fetch, AUTH), USER_ID)).toBe(false);
  });
});
