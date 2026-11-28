/** @jest-environment node */
// supabase/functions/export-data/__tests__/handler.test.ts
import { readFileSync } from 'node:fs';

import { chunkedRequest } from '../../_shared/__tests__/fakeFetch.ts';
import type { SupabaseEnv } from '../../_shared/env.ts';
import { type DataExport, EXCLUDED_TABLES, EXPORTED_TABLES, handleExportData, MAX_BODY_BYTES, PAGE } from '../handler.ts';

const { jest } = import.meta;

const USER_ID = '8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OTHER_ID = '9b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';
const NOW = Date.parse('2026-12-02T12:00:00Z');

const ENV: SupabaseEnv = {
  supabaseUrl: 'http://supabase.test',
  anonKey: 'anon-key-test',
  serviceRoleKey: 'service-role-test',
};

const base64url = (text: string): string => Buffer.from(text, 'utf8').toString('base64url');
const token = (claims: unknown): string => `${base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${base64url(JSON.stringify(claims))}.signature`;
const AUTH = `Bearer ${token({ sub: USER_ID, role: 'authenticated' })}`;

type Row = Record<string, unknown>;
type Table = (typeof EXPORTED_TABLES)[number];

const idOf = (n: number): string => `10000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const PROFILE: Row = { user_id: USER_ID, language: 'es', timezone: 'America/Bogota', terms_version: '2026-12-01', ai_consent_version: null };
const ROWS: Record<Table, Row[]> = {
  profiles: [PROFILE],
  episodes: [{ id: idOf(1), user_id: USER_ID, started_at: '2026-12-01T10:00:00Z', ended_at: null, intensity: 7 }],
  medications: [{ id: idOf(2), user_id: USER_ID, name: 'Ibuprofen', kind: 'acute', class: 'simple_analgesic' }],
  doses: [{ id: idOf(3), user_id: USER_ID, medication_id: idOf(2), episode_id: idOf(1), taken_at: '2026-12-01T10:30:00Z' }],
  checkins: [{ user_id: USER_ID, local_date: '2026-12-01', sleep_band: '6_7' }],
  agent_notes: [{ id: idOf(4), user_id: USER_ID, text: 'Prefers short answers', created_at: '2026-12-01T09:00:00Z' }],
  entitlements: [{ user_id: USER_ID, granted: true, granted_until: null }],
  usage_counters: [{ user_id: USER_ID, day: '2026-12-01', kind: 'companion', count: 3 }],
  signals: [{ id: idOf(5), user_id: USER_ID, kind: 'long_attack', cause: 'attack', cause_key: 'long_attack:x', computed_at: '2026-12-01T11:00:00Z' }],
  // The stored row holds the token and the secret hash; the export must carry neither.
  push_tokens: [{ user_id: USER_ID, token: 'ExponentPushToken[secret]', platform: 'android', updated_at: '2026-12-01T08:00:00Z', device_secret_hash: 'f'.repeat(64) }],
  consent_events: [{ id: idOf(6), user_id: USER_ID, kind: 'terms', version: '2026-12-01', locale: 'es', granted: true, created_at: '2026-12-01T07:00:00Z' }],
};
const FOREIGN: Record<Table, Row> = {
  profiles: { user_id: OTHER_ID, language: 'pt' },
  episodes: { id: idOf(91), user_id: OTHER_ID, started_at: '2026-12-01T10:00:00Z' },
  medications: { id: idOf(92), user_id: OTHER_ID, name: 'Sumatriptan' },
  doses: { id: idOf(93), user_id: OTHER_ID, medication_id: idOf(92) },
  checkins: { user_id: OTHER_ID, local_date: '2026-12-01' },
  agent_notes: { id: idOf(94), user_id: OTHER_ID, text: 'Walks at night' },
  entitlements: { user_id: OTHER_ID, granted: false },
  usage_counters: { user_id: OTHER_ID, day: '2026-12-01', kind: 'dictation', count: 9 },
  signals: { id: idOf(95), user_id: OTHER_ID, kind: 'pressure' },
  push_tokens: { user_id: OTHER_ID, token: 'ExponentPushToken[other]', platform: 'ios', updated_at: '2026-12-01T08:00:00Z' },
  consent_events: { id: idOf(96), user_id: OTHER_ID, kind: 'ai', version: '2026-12-01', locale: 'pt', granted: true },
};
const AUTH_USER = {
  id: USER_ID,
  aud: 'authenticated',
  email: 'ana@example.com',
  created_at: '2026-11-30T09:00:00Z',
  last_sign_in_at: '2026-12-02T08:00:00Z',
  app_metadata: { provider: 'email', providers: ['email', 'google'] },
  user_metadata: { locale: 'es' },
};

type World = {
  tables: Record<Table, Row[]>;
  user: Response | (() => Response);
  failTable?: Table;
};

type Call = { url: URL; method: string; headers: Headers };

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function world(overrides: Partial<Record<Table, Row[]>> = {}, extra: Partial<Omit<World, 'tables'>> = {}): World {
  return { tables: { ...ROWS, ...overrides }, user: () => json(200, AUTH_USER), ...extra };
}

/** PostgREST's projection for a plain column list (`*` answers the row whole). */
function project(rows: Row[], select: string | null): Row[] {
  if (select === null || select === '*') return rows;
  const columns = select.split(',');
  return rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => columns.includes(key))));
}

const hrefOf = (input: RequestInfo | URL): string => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
const tableOf = (url: URL): Table | undefined => EXPORTED_TABLES.find((name) => url.pathname === `/rest/v1/${name}`);

function fakeFetch(state: World): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const respond = (input: RequestInfo | URL, init?: RequestInit): Response => {
    const url = new URL(hrefOf(input));
    const method = init?.method ?? 'GET';
    calls.push({ url, method, headers: new Headers(init?.headers) });
    if (url.origin === ENV.supabaseUrl && url.pathname === '/auth/v1/user' && method === 'GET') {
      return typeof state.user === 'function' ? state.user() : state.user;
    }
    const table = tableOf(url);
    if (url.origin === ENV.supabaseUrl && table !== undefined && method === 'GET') {
      if (state.failTable === table) return json(500, { message: 'boom' });
      const rows = state.tables[table];
      const limit = Number(url.searchParams.get('limit') ?? rows.length);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      return json(200, project(rows.slice(offset, offset + limit), url.searchParams.get('select')));
    }
    throw new Error(`unexpected request ${method} ${url.href}`);
  };
  const fetchFn = ((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(respond(input, init))) as typeof fetch;
  return { fetch: fetchFn, calls };
}

function request(init: { method?: string; auth?: string | null; body?: string } = {}): Request {
  const headers = new Headers();
  const header = init.auth === undefined ? AUTH : init.auth;
  if (header !== null) headers.set('authorization', header);
  const method = init.method ?? 'POST';
  return new Request('http://functions.test/export-data', { method, headers, ...(init.body === undefined ? {} : { body: init.body }) });
}

let infoSpy: jest.SpiedFunction<typeof console.info>;

beforeEach(() => {
  infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
});

afterEach(() => {
  infoSpy.mockRestore();
});

const run = async (state: World): Promise<{ response: Response; calls: Call[] }> => {
  const { fetch: fetchFn, calls } = fakeFetch(state);
  const response = await handleExportData(request(), { env: ENV, fetch: fetchFn, now: () => NOW });
  return { response, calls };
};

describe('export-data', () => {
  test('exports or excludes exactly the user tables account.test.sql pins, none in both', () => {
    // The pgTAP file pins the database's user tables to this list; reading it here ties both lists to one set.
    const sql = readFileSync(new URL('../../../tests/account.test.sql', import.meta.url), 'utf8');
    const pinned = /create temporary table pinned_user_tables[\s\S]*?array\[([\s\S]*?)\]/.exec(sql)?.[1] ?? '';
    const names = [...pinned.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect(names).toHaveLength(14);
    expect([...names].sort()).toEqual([...EXPORTED_TABLES, ...EXCLUDED_TABLES].sort());
    expect(new Set([...EXPORTED_TABLES, ...EXCLUDED_TABLES]).size).toBe(EXPORTED_TABLES.length + EXCLUDED_TABLES.length);
    expect(EXCLUDED_TABLES).toEqual(['push_claims', 'push_claim_starts', 'push_tickets']);
    expect(PAGE).toBe(1000);
  });

  test('answers every section, with the versions, the account and the phones without their token', async () => {
    const { response } = await run(world());

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = (await response.json()) as DataExport;
    expect(body).toEqual({
      schemaVersion: 1,
      exportedAt: '2026-12-02T12:00:00.000Z',
      termsVersion: '2026-12-01',
      aiConsentVersion: null,
      account: { email: 'ana@example.com', createdAt: '2026-11-30T09:00:00Z', lastSignInAt: '2026-12-02T08:00:00Z', providers: ['email', 'google'] },
      profile: PROFILE,
      episodes: ROWS.episodes,
      medications: ROWS.medications,
      doses: ROWS.doses,
      checkins: ROWS.checkins,
      agentNotes: ROWS.agent_notes,
      signals: ROWS.signals,
      entitlement: ROWS.entitlements[0],
      usageCounters: ROWS.usage_counters,
      consentEvents: ROWS.consent_events,
      pushDevices: [{ user_id: USER_ID, platform: 'android', updated_at: '2026-12-01T08:00:00Z' }],
    });
  });

  test('reads every exported table, starting each once, and nothing else', async () => {
    const { calls } = await run(world());

    const firstPages = calls.filter(({ url }) => url.pathname.startsWith('/rest/v1/') && url.searchParams.get('offset') === '0');
    expect(firstPages.map(({ url }) => url.pathname.replace('/rest/v1/', '')).sort()).toEqual([...EXPORTED_TABLES].sort());
    for (const excluded of EXCLUDED_TABLES) {
      expect(calls.some(({ url }) => url.pathname === `/rest/v1/${excluded}`)).toBe(false);
    }
    expect(calls.filter(({ url }) => url.pathname === '/auth/v1/user')).toHaveLength(1);
  });

  test('reads with the caller token, except usage_counters with the service key filtered by the JWT’s uid', async () => {
    const { calls } = await run(world());

    for (const call of calls.filter(({ url }) => url.pathname.startsWith('/rest/v1/'))) {
      expect(call.url.searchParams.get('user_id')).toBe(`eq.${USER_ID}`);
      if (call.url.pathname === '/rest/v1/usage_counters') {
        expect(call.headers.get('authorization')).toBe('Bearer service-role-test');
        expect(call.headers.get('apikey')).toBe('service-role-test');
      } else {
        expect(call.headers.get('authorization')).toBe(AUTH);
        expect(call.headers.get('apikey')).toBe('anon-key-test');
      }
    }
    const user = calls.find(({ url }) => url.pathname === '/auth/v1/user');
    expect(user?.headers.get('authorization')).toBe(AUTH);
    expect(user?.headers.get('apikey')).toBe('anon-key-test');
  });

  test('orders each table stably', async () => {
    const { calls } = await run(world());

    const orders = Object.fromEntries(
      calls.filter(({ url }) => url.searchParams.get('offset') === '0').map(({ url }) => [url.pathname.replace('/rest/v1/', ''), url.searchParams.get('order')]),
    );
    expect(orders).toMatchObject({
      episodes: 'started_at,id',
      medications: 'created_at,id',
      doses: 'taken_at,id',
      checkins: 'local_date',
      agent_notes: 'created_at,id',
      signals: 'computed_at,id',
      usage_counters: 'day,kind',
      consent_events: 'created_at,id',
      push_tokens: 'updated_at,platform,token',
    });
  });

  test('asks push_tokens for neither the token nor the secret hash, and the file carries neither', async () => {
    const { response, calls } = await run(world());

    const select = calls.find(({ url }) => url.pathname === '/rest/v1/push_tokens')?.url.searchParams.get('select') ?? '';
    expect(select).toBe('user_id,platform,updated_at');
    expect(select).not.toContain('token');
    expect(select).not.toContain('device_secret_hash');
    const body = (await response.json()) as DataExport;
    for (const device of body.pushDevices) {
      expect(device).not.toHaveProperty('token');
      expect(device).not.toHaveProperty('device_secret_hash');
    }
    expect(JSON.stringify(body)).not.toContain('ExponentPushToken');
  });

  test('drops any row of another user, even if a read returned one', async () => {
    const mixed = Object.fromEntries(EXPORTED_TABLES.map((table) => [table, [FOREIGN[table], ...ROWS[table]]])) as Record<Table, Row[]>;
    const { response } = await run(world(mixed));

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(OTHER_ID);
    const body = JSON.parse(text) as DataExport;
    expect(body.profile).toEqual(PROFILE);
    expect(body.episodes).toEqual(ROWS.episodes);
    expect(body.usageCounters).toEqual(ROWS.usage_counters);
    expect(body.entitlement).toEqual(ROWS.entitlements[0]);
  });

  test('pages through 1003 episodes in two full reads', async () => {
    const episodes = Array.from({ length: 1003 }, (_, n) => ({ id: idOf(1000 + n), user_id: USER_ID, started_at: '2026-12-01T10:00:00Z' }));
    const { response, calls } = await run(world({ episodes }));

    const body = (await response.json()) as DataExport;
    expect(body.episodes).toHaveLength(1003);
    expect(body.episodes.map((episode) => episode.id)).toEqual(episodes.map((episode) => episode.id));
    const pages = calls.filter(({ url }) => url.pathname === '/rest/v1/episodes').map(({ url }) => url.searchParams.get('offset'));
    // Reads until a page comes back empty, so a server cap under 1000 never ends the export early.
    expect(pages).toEqual(['0', '1000', '1003']);
  });

  test('answers a null profile, entitlement and versions for an account with no rows', async () => {
    const empty = Object.fromEntries(EXPORTED_TABLES.map((table) => [table, []])) as unknown as Record<Table, Row[]>;
    const { response } = await run(world(empty));

    const body = (await response.json()) as DataExport;
    expect(body.profile).toBeNull();
    expect(body.entitlement).toBeNull();
    expect(body.termsVersion).toBeNull();
    expect(body.episodes).toEqual([]);
  });

  test('takes the providers from app_metadata.providers, keeping only strings', async () => {
    const user = { ...AUTH_USER, app_metadata: { provider: 'google', providers: ['google', 7, null, 'apple'] } };
    const { response } = await run(world({}, { user: () => json(200, user) }));

    expect(((await response.json()) as DataExport).account.providers).toEqual(['google', 'apple']);
  });

  test.each(EXPORTED_TABLES.map((table) => [table]))('answers 500 with no detail when the %s read fails', async (table) => {
    const { response } = await run(world({}, { failTable: table }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal' });
  });

  test.each([
    ['Auth fails', () => json(500, { msg: 'boom' })],
    ['Auth answers another user', () => json(200, { ...AUTH_USER, id: OTHER_ID })],
    ['Auth answers no user', () => json(200, [])],
  ] as const)('answers 500 with no detail when %s', async (_label, user) => {
    const { response } = await run(world({}, { user }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'internal' });
  });

  test.each([
    ['a signed-out session', () => json(403, { code: 403, error_code: 'session_not_found', msg: 'Session from session_id claim in JWT does not exist' })],
    ['an expired session', () => json(403, { code: 403, error_code: 'session_expired', msg: 'Session expired' })],
    ['a token Auth refuses', () => json(401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' })],
  ] as const)('answers 401 with no detail when Auth refuses %s, whatever the table reads gave', async (_label, user) => {
    const { response } = await run(world({}, { user }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized' });
  });

  test('answers 405 to a GET and 401 without a user bearer, before any request', async () => {
    const { fetch: fetchFn, calls } = fakeFetch(world());

    expect((await handleExportData(request({ method: 'GET' }), { env: ENV, fetch: fetchFn })).status).toBe(405);
    expect((await handleExportData(request({ auth: null }), { env: ENV, fetch: fetchFn })).status).toBe(401);
    expect((await handleExportData(request({ auth: `Bearer ${token({ role: 'anon' })}` }), { env: ENV, fetch: fetchFn })).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  test(`refuses a body over ${String(MAX_BODY_BYTES)} bytes with 413, chunked too, and a broken stream with 400`, async () => {
    const { fetch: fetchFn, calls } = fakeFetch(world());

    expect((await handleExportData(request({ body: 'x'.repeat(MAX_BODY_BYTES + 1) }), { env: ENV, fetch: fetchFn })).status).toBe(413);
    const { request: chunked } = chunkedRequest(10, 64, 'http://functions.test/export-data', { authorization: AUTH });
    expect((await handleExportData(chunked, { env: ENV, fetch: fetchFn })).status).toBe(413);
    let sent = false;
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) {
          controller.error(new TypeError('connection reset'));
          return;
        }
        sent = true;
        controller.enqueue(new TextEncoder().encode('{'));
      },
    });
    const brokenRequest = new Request('http://functions.test/export-data', { method: 'POST', body: broken, headers: { authorization: AUTH }, duplex: 'half' } as RequestInit);
    const response = await handleExportData(brokenRequest, { env: ENV, fetch: fetchFn });
    expect([response.status, await response.json()]).toEqual([400, { error: 'invalid_body' }]);
    expect(calls).toHaveLength(0);
  });

  test('accepts the empty JSON object the phone may send', async () => {
    const { fetch: fetchFn } = fakeFetch(world());

    expect((await handleExportData(request({ body: '{}' }), { env: ENV, fetch: fetchFn, now: () => NOW })).status).toBe(200);
  });

  test('logs only the outcome word', async () => {
    await run(world());
    await run(world({}, { failTable: 'episodes' }));

    const logged = infoSpy.mock.calls.map((args) => args.map(String).join(' '));
    expect(logged).toEqual([JSON.stringify({ outcome: 'exported' }), JSON.stringify({ outcome: 'error' })]);
  });
});
