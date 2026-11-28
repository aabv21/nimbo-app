/** @jest-environment node */
// The hourly monitor against a fake PostgREST, Open-Meteo and Expo: the secret, one push per claim with the neutral
// copy or the opt-in, a forecast per cell, the provider down, receipts and dead tokens, the budget, and what never leaks.
import { readCases } from '../../_shared/__tests__/cases.ts';
import { type Call, fakeFetch, json } from '../../_shared/__tests__/fakeFetch.ts';
import {
  FORECAST_WAIT_END_MS,
  forecastPool,
  handleMonitor,
  MIN_MONITOR_SECRET_LENGTH,
  MONITOR_BUDGET_MS,
  MONITOR_START_CUTOFF_MS,
  type MonitorDeps,
  type MonitorEnv,
} from '../handler.ts';

const { jest } = import.meta;

// At least MIN_MONITOR_SECRET_LENGTH characters, as the owner runbook's `openssl rand -hex 32` gives.
const SECRET = 'monitor-secret-monitor-secret-monitor';

const ENV: MonitorEnv = {
  supabaseUrl: 'http://supabase.test',
  anonKey: 'anon-test',
  serviceRoleKey: 'service-role-test',
  openMeteoUrl: 'http://meteo.test',
  openMeteoApiKey: '',
  expoPushUrl: 'http://expo.test/--/api/v2/push',
  expoAccessToken: '',
  monitorSecret: SECRET,
};

const NOW = Date.parse('2026-11-27T13:05:00Z');
const USER_1 = '8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c41';
const USER_2 = '8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c42';
const USER_3 = '8a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c43';
const HOUR_MS = 3_600_000;
const SIGNAL_ID = '5e1a0000-0000-4000-8000-000000000001';
const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

// Fixture S01: Bogota at 08:05, weather a known trigger, a 6.5 hPa drop to the same hour tomorrow.
type S01 = { id: string; input: { user: { onboardedAt: string; checkins: unknown[]; pressure: { hours: string[]; hPa: number[] } } } };
const s01 = readCases<S01>('signals-cases.json').cases.find((entry) => entry.id.startsWith('S01'));
if (s01 === undefined) throw new Error('fixture S01 is missing');
const S01_USER = s01.input.user;

type Target = {
  user_id: string;
  timezone: string;
  notify_start: string;
  notify_end: string;
  notify_daily_cap: number;
  lock_screen_detail: boolean;
  language: string | null;
  coarse_lat: number | null;
  coarse_lon: number | null;
  known_triggers: string[];
};

const target = (userId: string, overrides: Partial<Target> = {}): Target => ({
  user_id: userId,
  timezone: 'America/Bogota',
  notify_start: '08:00:00',
  notify_end: '21:00:00',
  notify_daily_cap: 2,
  lock_screen_detail: false,
  language: null,
  coarse_lat: 4.6,
  coarse_lon: -74.1,
  known_triggers: ['weather'],
  ...overrides,
});

type Inputs = {
  timeZone: string;
  knownTriggers: string[];
  onboardedAt: string;
  hasLocation: boolean;
  episodes: unknown[];
  checkins: unknown[];
  doses: unknown[];
  medications: unknown[];
};

const s01Inputs = (overrides: Partial<Inputs> = {}): Inputs => ({
  timeZone: 'America/Bogota',
  knownTriggers: ['weather'],
  onboardedAt: S01_USER.onboardedAt,
  hasLocation: true,
  episodes: [],
  checkins: S01_USER.checkins,
  doses: [],
  medications: [],
  ...overrides,
});

const openMeteo = (): unknown => ({
  utc_offset_seconds: 0,
  hourly: { time: S01_USER.pressure.hours.map((hour) => hour.slice(0, 16)), pressure_msl: S01_USER.pressure.hPa },
});

type World = {
  targets: Target[];
  inputs: (userId: string) => Response;
  pushLog: unknown[];
  claim: (userId: string, causeKey: string) => unknown[];
  forecast: () => Response | Promise<Response>;
  send: (messages: { to: string }[]) => Response;
  receiptsDue: Response;
  receipts: (ids: string[]) => Response;
  onRpc: (name: string, body: Record<string, unknown>) => void;
};

const defaultWorld = (): World => ({
  targets: [target(USER_1)],
  inputs: () => json(200, s01Inputs()),
  pushLog: [],
  claim: () => [{ signal_id: SIGNAL_ID, token: 'ExponentPushToken[phone-1]', language: 'en' }],
  forecast: () => json(200, openMeteo()),
  send: (messages) => json(200, { data: messages.map((_, index) => ({ status: 'ok', id: `ticket-${String(index)}` })) }),
  receiptsDue: json(200, []),
  receipts: (ids) => json(200, { data: Object.fromEntries(ids.map((id) => [id, { status: 'ok' }])) }),
  onRpc: () => undefined,
});

const bodyOf = (call: Call): Record<string, unknown> => JSON.parse(call.body ?? '{}') as Record<string, unknown>;

function world(changes: Partial<World> = {}) {
  const w = { ...defaultWorld(), ...changes };
  const { fetch, calls } = fakeFetch((call) => {
    const { host, pathname, searchParams } = call.url;
    if (host === 'meteo.test') return w.forecast();
    if (host === 'expo.test' && pathname.endsWith('/send')) return w.send(JSON.parse(call.body ?? '[]') as { to: string }[]);
    if (host === 'expo.test' && pathname.endsWith('/getReceipts')) return w.receipts((bodyOf(call).ids as string[] | undefined) ?? []);
    if (pathname === '/rest/v1/weather_cache') return call.method === 'GET' ? json(200, []) : new Response(null, { status: 201 });
    if (pathname === '/rest/v1/push_tokens') return json(200, []);
    const name = pathname.replace('/rest/v1/rpc/', '');
    const body = bodyOf(call);
    w.onRpc(name, body);
    switch (name) {
      case 'push_receipts_due':
        return w.receiptsDue;
      case 'monitor_targets':
        return json(200, searchParams.get('offset') === '0' ? w.targets : []);
      case 'record_inputs':
        return w.inputs(String(body.p_user_id));
      case 'save_signals':
        return json(200, w.pushLog);
      case 'claim_signal_push':
        return json(200, w.claim(String(body.p_user_id), String(body.p_cause_key)));
      case 'save_push_tickets':
      case 'forget_push_tickets':
        return new Response(null, { status: 204 });
      default:
        return json(404, { message: 'no route' });
    }
  });
  return { fetch, calls };
}

const post = (secret: string | null = SECRET, method = 'POST'): Request =>
  new Request('http://functions.test/monitor', {
    method,
    headers: secret === null ? { 'content-type': 'application/json' } : { 'content-type': 'application/json', 'x-webhook-secret': secret },
    ...(method === 'POST' ? { body: '{}' } : {}),
  });

const deps = (fetchFn: typeof fetch, now: () => number = () => NOW): MonitorDeps => ({ env: ENV, fetch: fetchFn, now });

const rpcCalls = (calls: Call[], name: string): Call[] => calls.filter((call) => call.url.pathname === `/rest/v1/rpc/${name}`);
const sends = (calls: Call[]): { to: string; title: string; body?: string; data: unknown }[][] =>
  calls.filter((call) => call.url.pathname.endsWith('/send')).map((call) => JSON.parse(call.body ?? '[]') as { to: string; title: string; body?: string; data: unknown }[]);
const forecastCalls = (calls: Call[]): Call[] => calls.filter((call) => call.url.host === 'meteo.test');

let logged: string[];

beforeEach(() => {
  logged = [];
  const capture = (...args: unknown[]): void => {
    logged.push(args.map(String).join(' '));
  };
  jest.spyOn(console, 'info').mockImplementation(capture);
  jest.spyOn(console, 'warn').mockImplementation(capture);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('anything but POST is 405, and a wrong or missing secret is 401, before any call', async () => {
  const { fetch, calls } = world();
  expect((await handleMonitor(post(SECRET, 'GET'), deps(fetch))).status).toBe(405);
  expect((await handleMonitor(post('wrong-secret'), deps(fetch))).status).toBe(401);
  expect((await handleMonitor(post(null), deps(fetch))).status).toBe(401);
  expect(calls).toHaveLength(0);
});

test('a configured secret shorter than MIN_MONITOR_SECRET_LENGTH refuses every caller, even one sending it, before any call', async () => {
  const { fetch, calls } = world();
  const info = jest.spyOn(console, 'info').mockImplementation(() => undefined);
  const short = 'x'.repeat(MIN_MONITOR_SECRET_LENGTH - 1);
  const response = await handleMonitor(post(short), { env: { ...ENV, monitorSecret: short }, fetch, now: () => NOW });
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: 'unauthorized' });
  expect(info.mock.calls.map((call: unknown[]) => String(call[0]))).toEqual([JSON.stringify({ outcome: 'misconfigured' })]);
  expect(calls).toHaveLength(0);
  info.mockRestore();
  expect(SECRET.length).toBeGreaterThanOrEqual(MIN_MONITOR_SECRET_LENGTH);
});

test('fixture S01 sends exactly one message: the neutral title, no body, and data with only the url', async () => {
  const { fetch, calls } = world();

  const response = await handleMonitor(post(), deps(fetch));

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    outcome: 'done',
    targets: 1,
    evaluated: 1,
    skipped: 0,
    failed: 0,
    signals: 1,
    pushed: 1,
    weather_fetches: 1,
    receipts_checked: 0,
    tokens_removed: 0,
  });
  expect(sends(calls)).toEqual([[{ to: 'ExponentPushToken[phone-1]', title: 'You have a note from Nimbo', data: { url: '/today' }, channelId: 'signals', sound: 'default' }]]);

  const save = bodyOf(rpcCalls(calls, 'save_signals')[0] as Call);
  expect(save.p_user_id).toBe(USER_1);
  expect(save.p_local_date).toBe('2026-11-27');
  expect(save.p_signals).toEqual([
    { kind: 'pressure', cause: 'pressure', causeKey: 'pressure:2026-11-27', evidence: { nowHpa: 1012, laterHpa: 1006, laterAt: '2026-11-28T13:00:00Z', dropHpa: 6.5 } },
  ]);
  expect(bodyOf(rpcCalls(calls, 'claim_signal_push')[0] as Call)).toEqual({
    p_user_id: USER_1,
    p_cause_key: 'pressure:2026-11-27',
    p_time_zone: 'America/Bogota',
    p_cap: 2,
    p_same_cause_hours: 24,
  });
  expect(bodyOf(rpcCalls(calls, 'save_push_tickets')[0] as Call)).toEqual({ p_user_id: USER_1, p_tickets: [{ token: 'ExponentPushToken[phone-1]', id: 'ticket-0' }] });
  // record_inputs reads the records' 90-day window with the service role.
  const records = rpcCalls(calls, 'record_inputs')[0] as Call;
  expect(bodyOf(records)).toEqual({ p_user_id: USER_1, p_since: new Date(NOW - 90 * 86_400_000).toISOString() });
  expect(records.headers.get('authorization')).toBe('Bearer service-role-test');
});

test('with the lock-screen opt-in and Spanish, the title is the kind and the body says 6,5', async () => {
  const { fetch, calls } = world({
    targets: [target(USER_1, { lock_screen_detail: true, language: 'es' })],
    claim: () => [{ signal_id: SIGNAL_ID, token: 'ExponentPushToken[phone-1]', language: 'es' }],
  });

  await handleMonitor(post(), deps(fetch));

  const [message] = sends(calls)[0] ?? [];
  expect(message?.title).toBe('Cambio de presión');
  expect(message?.body).toContain('6,5');
  expect(message?.data).toEqual({ url: '/today' });
});

test('Open-Meteo answering 500 still saves and pushes a debrief for that user, and the run answers 200', async () => {
  const episode = {
    id: 'e-debrief',
    startedAt: '2026-11-26T15:00:00Z',
    endedAt: '2026-11-26T18:00:00Z',
    intensity: 6,
    triggers: [],
    helped: [],
    didNotHelp: [],
    debriefedAt: null,
  };
  const { fetch, calls } = world({ inputs: () => json(200, s01Inputs({ episodes: [episode] })), forecast: () => json(500, { error: true }) });

  const response = await handleMonitor(post(), deps(fetch));

  expect(response.status).toBe(200);
  expect(forecastCalls(calls)).toHaveLength(1);
  const saved = bodyOf(rpcCalls(calls, 'save_signals')[0] as Call).p_signals as { causeKey: string }[];
  expect(saved.map((signal) => signal.causeKey)).toEqual(['debrief:e-debrief']);
  expect(bodyOf(rpcCalls(calls, 'claim_signal_push')[0] as Call).p_cause_key).toBe('debrief:e-debrief');
  expect(sends(calls)).toHaveLength(1);
});

test('two targets in the same cell make one forecast request; a target with no coordinates makes none', async () => {
  const same = world({ targets: [target(USER_1), target(USER_2, { coarse_lat: 4.6, coarse_lon: -74.1 })] });
  const sameBody = (await (await handleMonitor(post(), deps(same.fetch))).json()) as Record<string, number>;
  expect(forecastCalls(same.calls)).toHaveLength(1);
  expect(sameBody.weather_fetches).toBe(1);
  expect(sameBody.evaluated).toBe(2);

  const none = world({ targets: [target(USER_1, { coarse_lat: null, coarse_lon: null })] });
  const noneBody = (await (await handleMonitor(post(), deps(none.fetch))).json()) as Record<string, number>;
  expect(forecastCalls(none.calls)).toHaveLength(0);
  expect(noneBody.evaluated).toBe(1);
});

test('a claim that answers no row sends nothing', async () => {
  const { fetch, calls } = world({ claim: () => [] });
  const body = (await (await handleMonitor(post(), deps(fetch))).json()) as Record<string, number>;
  expect(rpcCalls(calls, 'claim_signal_push')).toHaveLength(1);
  expect(sends(calls)).toHaveLength(0);
  expect(body.pushed).toBe(0);
  expect(body.evaluated).toBe(1);
});

test('a DeviceNotRegistered ticket and a dead receipt each delete their token, and the checked tickets are forgotten', async () => {
  const { fetch, calls } = world({
    receiptsDue: json(200, [
      { ticket_id: 'old-ok', token: 'ExponentPushToken[alive]' },
      { ticket_id: 'old-dead', token: 'ExponentPushToken[gone-by-receipt]' },
    ]),
    receipts: () => json(200, { data: { 'old-ok': { status: 'ok' }, 'old-dead': { status: 'error', details: { error: 'DeviceNotRegistered' } } } }),
    send: () => json(200, { data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }),
    claim: () => [{ signal_id: SIGNAL_ID, token: 'ExponentPushToken[gone-by-ticket]', language: 'en' }],
  });

  const body = (await (await handleMonitor(post(), deps(fetch))).json()) as Record<string, number>;

  const deleted = calls
    .filter((call) => call.url.pathname === '/rest/v1/push_tokens' && call.method === 'DELETE')
    .map((call) => call.url.searchParams.get('token'));
  expect(deleted).toEqual(['in.("ExponentPushToken[gone-by-receipt]")', 'in.("ExponentPushToken[gone-by-ticket]")']);
  expect(bodyOf(rpcCalls(calls, 'forget_push_tickets')[0] as Call)).toEqual({ p_ids: ['old-ok', 'old-dead'] });
  expect(rpcCalls(calls, 'save_push_tickets')).toHaveLength(0);
  expect(body).toMatchObject({ receipts_checked: 2, tokens_removed: 2, pushed: 0 });
});

test('a failed receipts read is logged and the run goes on', async () => {
  const { fetch, calls } = world({ receiptsDue: json(500, {}) });
  const response = await handleMonitor(post(), deps(fetch));
  expect(response.status).toBe(200);
  expect(logged).toContain(JSON.stringify({ outcome: 'receipts_failed' }));
  expect(sends(calls)).toHaveLength(1);
});

test('the targets are read page by page in user id order, so limit and offset paging is stable', async () => {
  const { fetch, calls } = world({ targets: [target(USER_1), target(USER_2)] });
  await handleMonitor(post(), deps(fetch));
  const pages = calls.filter((call) => call.url.pathname === '/rest/v1/rpc/monitor_targets').map((call) => call.url.search);
  expect(pages).toEqual(['?order=user_id&limit=1000&offset=0', '?order=user_id&limit=1000&offset=2']);
});

test('a failed targets read answers 500 internal', async () => {
  const { fetch } = fakeFetch((call) => (call.url.pathname.endsWith('/monitor_targets') ? json(500, {}) : json(200, [])));
  const response = await handleMonitor(post(), deps(fetch));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: 'internal' });
});

/** One run at `hourStart` in which the first user takes the run past the start cutoff; the user ids it evaluated. */
async function runPastCutoff(hourStart: number): Promise<{ body: Record<string, number>; evaluated: unknown[] }> {
  let time = hourStart;
  const { fetch, calls } = world({
    targets: [target(USER_1), target(USER_2), target(USER_3)],
    onRpc: (name) => {
      if (name === 'save_signals') time = hourStart + MONITOR_START_CUTOFF_MS;
    },
  });
  const body = (await (await handleMonitor(post(), deps(fetch, () => time))).json()) as Record<string, number>;
  return { body, evaluated: rpcCalls(calls, 'record_inputs').map((call) => bodyOf(call).p_user_id) };
}

test('past the start cutoff after the first user, the others are skipped, and the next hour starts with one of them', async () => {
  const runN = await runPastCutoff(NOW);
  expect(runN.body).toMatchObject({ targets: 3, evaluated: 1, skipped: 2, failed: 0 });
  // The first user still claims and sends: the cutoff stops new users, not one already under way.
  expect(runN.body.pushed).toBe(1);

  const runNext = await runPastCutoff(NOW + HOUR_MS);
  expect(runNext.evaluated).toHaveLength(1);
  expect(runNext.evaluated[0]).not.toBe(runN.evaluated[0]);
  expect([USER_1, USER_2, USER_3].filter((id) => id !== runN.evaluated[0])).toContain(runNext.evaluated[0]);

  // Over as many hours as there are targets, every user goes first once.
  const firsts = new Set<unknown>();
  for (let hour = 0; hour < 3; hour += 1) firsts.add((await runPastCutoff(NOW + hour * HOUR_MS)).evaluated[0]);
  expect(firsts).toEqual(new Set([USER_1, USER_2, USER_3]));
});

test('a user whose evaluation reaches the claim budget saves the signals but claims and sends nothing', async () => {
  let time = NOW;
  const { fetch, calls } = world({
    onRpc: (name) => {
      if (name === 'save_signals') time = NOW + MONITOR_BUDGET_MS;
    },
  });

  const body = (await (await handleMonitor(post(), deps(fetch, () => time))).json()) as Record<string, number>;

  expect(body).toMatchObject({ evaluated: 1, signals: 1, pushed: 0, failed: 0 });
  expect(rpcCalls(calls, 'save_signals')).toHaveLength(1);
  expect(rpcCalls(calls, 'claim_signal_push')).toHaveLength(0);
  expect(sends(calls)).toHaveLength(0);
});

test('a forecast still pending at the deadline is left out: the user is evaluated without the pressure signal', async () => {
  let time = NOW;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const { fetch, calls } = world({
    onRpc: (name) => {
      // Once the user has started, the records read lands 100 ms before forecasts stop being waited for.
      if (name === 'record_inputs') time = NOW + FORECAST_WAIT_END_MS - 100;
    },
    forecast: async () => {
      await gate;
      return json(200, openMeteo());
    },
  });

  const body = (await (await handleMonitor(post(), deps(fetch, () => time))).json()) as Record<string, number>;
  release();

  expect(body).toMatchObject({ evaluated: 1, failed: 0, signals: 0 });
  expect(bodyOf(rpcCalls(calls, 'save_signals')[0] as Call).p_signals).toEqual([]);
});

test('one user’s record_inputs failing counts as failed, and the next user is still evaluated', async () => {
  const { fetch, calls } = world({
    targets: [target(USER_1), target(USER_2)],
    inputs: (userId) => (userId === USER_1 ? json(500, {}) : json(200, s01Inputs())),
  });

  const body = (await (await handleMonitor(post(), deps(fetch))).json()) as Record<string, number>;

  expect(body).toMatchObject({ evaluated: 1, failed: 1 });
  expect(rpcCalls(calls, 'save_signals').map((call) => bodyOf(call).p_user_id)).toEqual([USER_2]);
});

test('quiet:never with no check-in in the window and onboarding long ago says "over 90 days", not the days since onboarding', async () => {
  const { fetch, calls } = world({
    targets: [target(USER_1, { lock_screen_detail: true, coarse_lat: null, coarse_lon: null, known_triggers: [] })],
    inputs: () => json(200, s01Inputs({ knownTriggers: [], hasLocation: false, onboardedAt: '2025-06-01T15:00:00Z', checkins: [] })),
  });

  await handleMonitor(post(), deps(fetch));

  expect(bodyOf(rpcCalls(calls, 'claim_signal_push')[0] as Call).p_cause_key).toBe('quiet:never');
  expect(sends(calls)[0]?.[0]).toMatchObject({ body: 'No check-in for over 90 days.' });
});

test('a quiet stretch with the opt-in states the real number of days since the last check-in', async () => {
  const { fetch, calls } = world({
    targets: [target(USER_1, { lock_screen_detail: true, coarse_lat: null, coarse_lon: null, known_triggers: [] })],
    inputs: () => json(200, s01Inputs({ knownTriggers: [], hasLocation: false, checkins: [{ localDate: '2026-11-18', sleepBand: '7_8', stress: 'low' }] })),
  });

  await handleMonitor(post(), deps(fetch));

  expect(bodyOf(rpcCalls(calls, 'claim_signal_push')[0] as Call).p_cause_key).toBe('quiet:2026-11-18');
  expect(sends(calls)[0]?.[0]).toMatchObject({ title: 'No check-in lately', body: 'No check-in for 9 days.' });
});

test('quiet:never after a pushed dated quiet stretch is not claimed', async () => {
  const { fetch, calls } = world({
    targets: [target(USER_1, { coarse_lat: null, coarse_lon: null, known_triggers: [] })],
    inputs: () => json(200, s01Inputs({ knownTriggers: [], hasLocation: false, checkins: [] })),
    pushLog: [{ cause_key: 'quiet:2026-08-20', cause: 'quiet_tracker', pushed_at: '2026-08-23T14:00:00Z' }],
  });

  await handleMonitor(post(), deps(fetch));

  expect((bodyOf(rpcCalls(calls, 'save_signals')[0] as Call).p_signals as { causeKey: string }[]).map((signal) => signal.causeKey)).toEqual(['quiet:never']);
  expect(rpcCalls(calls, 'claim_signal_push')).toHaveLength(0);
});

test('a zone this runtime cannot place is skipped, never evaluated', async () => {
  const { fetch, calls } = world({ targets: [target(USER_1, { timezone: 'Mars/Base' })] });
  const body = (await (await handleMonitor(post(), deps(fetch))).json()) as Record<string, number>;
  expect(body).toMatchObject({ targets: 1, evaluated: 0, skipped: 1, failed: 0 });
  expect(rpcCalls(calls, 'record_inputs')).toHaveLength(0);
});

describe('what never leaks', () => {
  const debrief = {
    id: 'e-debrief',
    startedAt: '2026-11-26T15:00:00Z',
    endedAt: '2026-11-26T18:00:00Z',
    intensity: 6,
    triggers: ['weather'],
    helped: [],
    didNotHelp: [],
    debriefedAt: null,
  };

  async function runPrivacy(lockScreenDetail: boolean): Promise<{ to: string; data: Record<string, unknown> }[]> {
    const { fetch, calls } = world({
      targets: [target(USER_1, { lock_screen_detail: lockScreenDetail }), target(USER_2, { lock_screen_detail: lockScreenDetail })],
      inputs: (userId) => (userId === USER_1 ? json(200, s01Inputs()) : json(200, s01Inputs({ episodes: [debrief] }))),
      claim: (userId) => [{ signal_id: SIGNAL_ID, token: `ExponentPushToken[${userId === USER_1 ? 'one' : 'two'}]`, language: 'en' }],
      send: (messages) => json(200, { data: messages.map(() => ({ status: 'error', details: { error: 'DeviceNotRegistered' } })) }),
    });
    await handleMonitor(post(), deps(fetch));
    return sends(calls).flat() as unknown as { to: string; data: Record<string, unknown> }[];
  }

  test('no logged word holds a UUID, evidence, hPa or a token', async () => {
    await runPrivacy(true);
    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) {
      expect(line).not.toMatch(UUID_ANYWHERE);
      expect(line).not.toMatch(/evidence|hPa|ExponentPushToken|America\/Bogota/);
    }
  });

  test.each([false, true])('an Expo body (opt-in %p) holds a token only in `to`, no UUID, and `data` only the url', async (lockScreenDetail) => {
    const messages = await runPrivacy(lockScreenDetail);
    expect(messages).toHaveLength(2);
    for (const message of messages) {
      expect(message.data).toEqual({ url: '/today' });
      const rest = JSON.stringify({ ...message, to: undefined });
      expect(rest).not.toMatch(UUID_ANYWHERE);
      expect(rest).not.toMatch(/evidence|ExponentPushToken|e-debrief/);
      if (!lockScreenDetail) expect(rest).not.toMatch(/hPa/);
    }
  });
});

describe('forecastPool', () => {
  test('one lookup per cell, at most `limit` at once, and a cell a user waits for goes ahead of queued prefetches', async () => {
    const started: string[] = [];
    const finish = new Map<string, () => void>();
    const pool = forecastPool((cell) => {
      const key = `${String(cell.lat)},${String(cell.lon)}`;
      started.push(key);
      return new Promise((resolve) => {
        finish.set(key, () => {
          resolve(null);
        });
      });
    }, 2);

    void pool.get({ lat: 1, lon: 1 });
    void pool.get({ lat: 2, lon: 2 });
    void pool.get({ lat: 3, lon: 3 });
    void pool.get({ lat: 4, lon: 4 });
    void pool.get({ lat: 1, lon: 1 });
    expect(started).toEqual(['1,1', '2,2']);

    // A user now waits for cell 4 (queued behind 3) and for a new cell 5.
    void pool.get({ lat: 4, lon: 4 }, true);
    void pool.get({ lat: 5, lon: 5 }, true);
    finish.get('1,1')?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    finish.get('2,2')?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual(['1,1', '2,2', '5,5', '4,4']);
    for (const done of finish.values()) done();
  });
});
