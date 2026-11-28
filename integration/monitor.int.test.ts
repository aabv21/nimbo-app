// The hourly monitor on the local stack: a user seeded through the app's RPCs, the forecast and Expo mocks
// (`mockServices.ts`), one push and its claim, no second push in the same hour, one cached forecast, and the pg_cron
// path (`request_monitor()` through pg_net with the seeded Vault secrets). Needs `pnpm db:start` and `pnpm env:local`.

import { execFile } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { signInWithEmail } from '../src/auth/emailAuth';
import { cellKey } from '../supabase/functions/_shared/weather.ts';
import { anonClient, createUser, deleteUser, loadIntegrationEnv, serviceClient, uniqueEmail } from './helpers';
import { type MockServices, pressureForecast, startMockServices } from './mockServices';

loadIntegrationEnv();

const run = promisify(execFile);

const PASSWORD = 'Password123!';
// Must match MONITOR_SECRET in supabase/config.toml and the Vault secret supabase/seed.sql creates.
const LOCAL_SECRET = 'local-only-not-a-secret';
// The local stack's database container (`project_id` in supabase/config.toml).
const DB_CONTAINER = 'supabase_db_nimbo-app';
const ZONE = 'America/Bogota';
// A cell no other test uses.
const CELL = { lat: 12.3, lon: -45.6 };
const KEY = cellKey(CELL.lat, CELL.lon);
const POLL_INTERVAL_MS = 250;

let services: MockServices;
const users: string[] = [];
const token = `ExponentPushToken[int-monitor-${randomUUID()}]`;

type Pushed = { to: string; title?: string; body?: string; data?: unknown };

const pushesTo = (to: string): Pushed[] => (services.pushRequests().flat() as Pushed[]).filter((message) => message.to === to);
const pushesToUser = (): Pushed[] => pushesTo(token);
const forecastsForCell = (): URL[] =>
  services.forecastRequests().filter((url) => url.searchParams.get('latitude') === '12.3' && url.searchParams.get('longitude') === '-45.6');

function postMonitor(): Promise<Response> {
  return fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/monitor`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-secret': LOCAL_SECRET },
    body: '{}',
  });
}

/** One SQL statement as `postgres` inside the database container; the first column of the first row. */
async function sql(statement: string): Promise<string> {
  const { stdout } = await run('docker', ['exec', DB_CONTAINER, 'psql', '-U', 'postgres', '-At', '-c', statement]);
  return stdout.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** A window around Bogota's current hour, so the push is inside it whenever the test runs. */
function windowAroundNow(): { notify_start: string; notify_end: string } {
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  const clock = (h: number): string => `${String((h + 24) % 24).padStart(2, '0')}:00`;
  return { notify_start: clock(hour - 1), notify_end: clock(hour + 2) };
}

const clearCell = async (): Promise<void> => {
  const { error } = await serviceClient().from('weather_cache').delete().eq('location_key', KEY);
  expect(error).toBeNull();
};

beforeAll(async () => {
  services = await startMockServices();
  // 1012.4 hPa this hour, 1005.9 hPa the same hour tomorrow: a 6.5 hPa drop.
  services.respondForecast({ status: 200, body: pressureForecast(Array.from({ length: 28 }, (_, index) => (index < 24 ? 1012.4 : 1005.9))) });
  await clearCell();
  await seedUser(token);
});

afterAll(async () => {
  await clearCell();
  for (const id of users) await deleteUser(id);
  await services.close();
});

/** An onboarded user in Bogotá who chose weather, in the test's cell, inside their window, with `pushToken` registered. */
async function seedUser(pushToken: string): Promise<string> {
  const email = uniqueEmail('monitor');
  const id = await createUser(email, PASSWORD);
  users.push(id);
  const client = anonClient();
  expect(await signInWithEmail(email, PASSWORD, client)).toEqual({ ok: true });
  expect((await client.rpc('accept_terms', { p_adult: true, p_boundary: true })).error).toBeNull();
  expect((await client.rpc('set_ai_consent', { p_enabled: false })).error).toBeNull();
  expect((await client.rpc('complete_onboarding')).error).toBeNull();
  const { error } = await client
    .from('profiles')
    .update({ timezone: ZONE, known_triggers: ['weather'], coarse_lat: CELL.lat, coarse_lon: CELL.lon, ...windowAroundNow() })
    .eq('user_id', id);
  expect(error).toBeNull();
  const registered = await client.rpc('register_push_token', { p_token: pushToken, p_platform: 'android', p_device_secret: randomBytes(32).toString('hex') });
  expect(registered.error).toBeNull();
  return id;
}

const userId = (): string => users[0] ?? '';

test('a POST with the local secret sends one neutral push and stamps the signal', async () => {
  const response = await postMonitor();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ outcome: 'done', failed: 0 });

  const pushes = pushesToUser();
  expect(pushes).toHaveLength(1);
  expect(pushes[0]?.title).toBe('You have a note from Nimbo');
  expect(pushes[0]?.body).toBeUndefined();

  const { data, error } = await serviceClient().from('signals').select('id, cause_key, pushed_at').eq('user_id', userId());
  expect(error).toBeNull();
  const pressure = data?.find((row) => row.cause_key.startsWith('pressure:'));
  expect(pressure?.pushed_at).not.toBeNull();
  expect(pushes[0]?.data).toEqual({ url: '/today', signalId: pressure?.id });
});

test('a second POST in the same hour sends no second push', async () => {
  const response = await postMonitor();
  expect(response.status).toBe(200);
  expect(pushesToUser()).toHaveLength(1);
});

test('the cell has one cached forecast, fetched once', async () => {
  const { data, error } = await serviceClient().from('weather_cache').select('fetched_at').eq('location_key', KEY);
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  expect(forecastsForCell()).toHaveLength(1);
});

test('two runs at once push a fresh signal exactly once (the claim’s per-user lock)', async () => {
  const freshToken = `ExponentPushToken[int-monitor-${randomUUID()}]`;
  const fresh = await seedUser(freshToken);

  const [first, second] = await Promise.all([postMonitor(), postMonitor()]);

  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(pushesTo(freshToken)).toHaveLength(1);
  const { data } = await serviceClient().from('signals').select('pushed_at').eq('user_id', fresh).not('pushed_at', 'is', null);
  expect(data).toHaveLength(1);
  // The cell was already cached, so neither run asked the provider again.
  expect(forecastsForCell()).toHaveLength(1);
});

test('a wrong secret is refused', async () => {
  const response = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/monitor`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webhook-secret': 'not-the-secret' },
    body: '{}',
  });
  expect(response.status).toBe(401);
});

test('request_monitor() with the seeded Vault secrets reaches the function, which answers 200 within 10 s', async () => {
  const before = Number(await sql('select coalesce(max(id), 0) from net._http_response'));
  await sql('select public.request_monitor()');

  const deadline = Date.now() + 10_000;
  let status = '';
  while (status === '' && Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    status = await sql(`select status_code from net._http_response where id > ${String(before)} and status_code is not null order by id limit 1`);
  }
  expect(status).toBe('200');
  // That run, too, found the push already claimed.
  expect(pushesToUser()).toHaveLength(1);
}, 20_000);
