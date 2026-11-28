/** @jest-environment node */
// supabase/functions/delete-account/__tests__/handler.test.ts
import { chunkedRequest, hanging } from '../../_shared/__tests__/fakeFetch.ts';
import type { SupabaseEnv } from '../../_shared/env.ts';
import { AUTH_TIMEOUT_MS, handleDeleteAccount, MAX_BODY_BYTES } from '../handler.ts';

const { jest } = import.meta;

const USER_ID = '8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OTHER_ID = '9b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';

const ENV: SupabaseEnv = {
  supabaseUrl: 'http://supabase.test',
  anonKey: 'anon-key-test',
  serviceRoleKey: 'service-role-test',
};

const base64url = (text: string): string => Buffer.from(text, 'utf8').toString('base64url');
const token = (claims: unknown): string => `${base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${base64url(JSON.stringify(claims))}.signature`;
const AUTH = `Bearer ${token({ sub: USER_ID, role: 'authenticated' })}`;

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Step = { kind: 'whoami' | 'adminDelete'; url: URL; headers: Headers };

type World = {
  whoami?: (init: RequestInit) => Response | Promise<Response>;
  adminDelete?: (init: RequestInit) => Response | Promise<Response>;
};

const USER_NOT_FOUND = (): Response => json(403, { code: 403, error_code: 'user_not_found', msg: 'User from sub claim in JWT does not exist' });

function fakeFetch(state: World = {}): { fetch: typeof fetch; steps: Step[] } {
  const steps: Step[] = [];
  const fetchFn = ((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    if (url.origin === ENV.supabaseUrl && url.pathname === '/auth/v1/user' && method === 'GET') {
      steps.push({ kind: 'whoami', url, headers });
      return Promise.resolve(state.whoami === undefined ? json(200, { id: USER_ID, aud: 'authenticated' }) : state.whoami(init));
    }
    if (url.origin === ENV.supabaseUrl && url.pathname.startsWith('/auth/v1/admin/users/') && method === 'DELETE') {
      steps.push({ kind: 'adminDelete', url, headers });
      return Promise.resolve(state.adminDelete === undefined ? json(200, {}) : state.adminDelete(init));
    }
    return Promise.reject(new Error(`unexpected ${method} ${url.href}`));
  }) as typeof fetch;
  return { fetch: fetchFn, steps };
}

function request(init: { method?: string; auth?: string | null; body?: string } = {}): Request {
  const headers = new Headers();
  const header = init.auth === undefined ? AUTH : init.auth;
  if (header !== null) headers.set('authorization', header);
  return new Request('http://functions.test/delete-account', { method: init.method ?? 'POST', headers, ...(init.body === undefined ? {} : { body: init.body }) });
}

let infoSpy: jest.SpiedFunction<typeof console.info>;

beforeEach(() => {
  infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  infoSpy.mockRestore();
  jest.useRealTimers();
});

async function run(state: World = {}): Promise<{ status: number; body: unknown; steps: Step[] }> {
  const { fetch: fetchFn, steps } = fakeFetch(state);
  const response = await handleDeleteAccount(request(), { env: ENV, fetch: fetchFn });
  return { status: response.status, body: await response.json(), steps };
}

describe('delete-account', () => {
  test('confirms the caller with their own token, then deletes them exactly once with the service key', async () => {
    const { status, body, steps } = await run();

    expect([status, body]).toEqual([200, { outcome: 'deleted' }]);
    expect(steps.map(({ kind }) => kind)).toEqual(['whoami', 'adminDelete']);
    const [whoami, adminDelete] = steps;
    expect(whoami?.headers.get('authorization')).toBe(AUTH);
    expect(whoami?.headers.get('apikey')).toBe('anon-key-test');
    expect(adminDelete?.url.pathname).toBe(`/auth/v1/admin/users/${USER_ID}`);
    expect(adminDelete?.headers.get('authorization')).toBe('Bearer service-role-test');
    expect(adminDelete?.headers.get('apikey')).toBe('service-role-test');
  });

  test('answers deleted without an admin call when Auth says user_not_found (a retry after a cut connection)', async () => {
    const { status, body, steps } = await run({ whoami: USER_NOT_FOUND });

    expect([status, body]).toEqual([200, { outcome: 'deleted' }]);
    expect(steps.map(({ kind }) => kind)).toEqual(['whoami']);
  });

  test.each([
    ['a bare 404 (a misrouted gateway answers it too)', () => json(404, { message: 'not found' })],
    ['a 404 that is not JSON', () => new Response('Not Found', { status: 404 })],
    ['a 500', () => json(500, { msg: 'boom' })],
    ['a body for another user', () => json(200, { id: OTHER_ID })],
    ['a body without an id', () => json(200, {})],
  ] as const)('answers 500 and deletes nothing on %s from /auth/v1/user', async (_label, whoami) => {
    const { status, body, steps } = await run({ whoami });

    expect([status, body]).toEqual([500, { error: 'internal' }]);
    expect(steps.some(({ kind }) => kind === 'adminDelete')).toBe(false);
  });

  test('answers deleted when the admin delete says 404 (an earlier attempt deleted the user)', async () => {
    const { status, body } = await run({ adminDelete: () => json(404, { code: 404, error_code: 'user_not_found' }) });

    expect([status, body]).toEqual([200, { outcome: 'deleted' }]);
  });

  test('answers 500 with no detail when the admin delete fails', async () => {
    const { status, body } = await run({ adminDelete: () => json(500, { msg: 'database error deleting user' }) });

    expect([status, body]).toEqual([500, { error: 'internal' }]);
  });

  test(`answers 500 when Auth hangs past ${String(AUTH_TIMEOUT_MS)} ms`, async () => {
    jest.useFakeTimers();
    const { fetch: fetchFn } = fakeFetch({ adminDelete: (init) => hanging({ method: 'DELETE', url: new URL(ENV.supabaseUrl), headers: new Headers(), body: undefined }, init) });

    const pending = handleDeleteAccount(request(), { env: ENV, fetch: fetchFn });
    await jest.advanceTimersByTimeAsync(AUTH_TIMEOUT_MS);
    const response = await pending;

    expect(response.status).toBe(500);
  });

  test('answers 405 to a GET and 401 without a user bearer, before any request', async () => {
    const { fetch: fetchFn, steps } = fakeFetch();

    expect((await handleDeleteAccount(request({ method: 'GET' }), { env: ENV, fetch: fetchFn })).status).toBe(405);
    expect((await handleDeleteAccount(request({ auth: null }), { env: ENV, fetch: fetchFn })).status).toBe(401);
    expect((await handleDeleteAccount(request({ auth: `Bearer ${token({ role: 'service_role' })}` }), { env: ENV, fetch: fetchFn })).status).toBe(401);
    expect(steps).toHaveLength(0);
  });

  test(`refuses a body over ${String(MAX_BODY_BYTES)} bytes with 413, chunked too, before any request`, async () => {
    const { fetch: fetchFn, steps } = fakeFetch();

    expect((await handleDeleteAccount(request({ body: 'x'.repeat(MAX_BODY_BYTES + 1) }), { env: ENV, fetch: fetchFn })).status).toBe(413);
    const { request: chunked } = chunkedRequest(10, 64, 'http://functions.test/delete-account', { authorization: AUTH });
    expect((await handleDeleteAccount(chunked, { env: ENV, fetch: fetchFn })).status).toBe(413);
    expect(steps).toHaveLength(0);
  });

  test('logs only outcome words', async () => {
    await run();
    await run({ whoami: USER_NOT_FOUND });
    await run({ adminDelete: () => json(500, {}) });

    const logged = infoSpy.mock.calls.map((args) => args.map(String).join(' '));
    expect(logged).toEqual([
      JSON.stringify({ outcome: 'deleted' }),
      JSON.stringify({ outcome: 'already_deleted' }),
      JSON.stringify({ outcome: 'error' }),
    ]);
  });
});
