// The repository against a real supabase-js client with a fake fetch, so the assertions are on the requests it sends.
jest.mock('../../lib/supabase', () => ({ supabase: {} }));

import { createClient } from '@supabase/supabase-js';

import type { Client } from '../../auth/emailAuth';
import { setCurrentUserId } from '../../auth/currentUser';
import type { Database } from '../../lib/database.types';
import { kvGet, kvRemove } from '../../lib/kv';
import { fetchTodayPressure, readCachedPressure, removeCachedSignals } from '../signalRepository';

const NOW = new Date('2026-11-27T17:00:00Z');
const ROW = {
  kind: 'pressure',
  cause: 'pressure',
  cause_key: 'pressure:2026-11-27',
  evidence: { nowHpa: 1012, laterHpa: 1005, laterAt: '2026-11-28T13:00:00Z', dropHpa: 7 },
  computed_at: '2026-11-27T16:05:00Z',
};
// Computed 3 h 1 min before NOW: past the pack's `maxForecastAgeHours`.
const STALE = { ...ROW, computed_at: '2026-11-27T13:59:00Z' };

function clientAnswering(status: number, body: unknown, settle: Promise<void> = Promise.resolve()): { client: Client; urls: URL[] } {
  const urls: URL[] = [];
  const fetch = async (input: RequestInfo | URL): Promise<Response> => {
    urls.push(new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url));
    await settle;
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  const client = createClient<Database, 'public'>('http://127.0.0.1:54521', 'anon-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch },
  });
  return { client, urls };
}

beforeEach(() => {
  kvRemove('signals.user-1');
  setCurrentUserId('user-1');
});

test('reads the day’s newest pressure row with named columns and keeps it for that day', async () => {
  const { client, urls } = clientAnswering(200, [ROW]);
  const signal = await fetchTodayPressure('user-1', '2026-11-27', client, NOW);

  expect(signal).toMatchObject({ kind: 'pressure', causeKey: 'pressure:2026-11-27', evidence: { dropHpa: 7 } });
  const [url] = urls;
  expect(url?.pathname).toBe('/rest/v1/signals');
  expect(Object.fromEntries(url?.searchParams ?? [])).toEqual({
    select: 'kind,cause,cause_key,evidence,computed_at',
    kind: 'eq.pressure',
    local_date: 'eq.2026-11-27',
    order: 'computed_at.desc',
    limit: '1',
  });
  expect(readCachedPressure('user-1', '2026-11-27', NOW)).toEqual(signal);
  expect(readCachedPressure('user-1', '2026-11-28', NOW)).toBeNull();
});

test('a failed read falls back to the kept row; an answer for a signed-out account is not kept', async () => {
  await fetchTodayPressure('user-1', '2026-11-27', clientAnswering(200, [ROW]).client, NOW);
  expect(await fetchTodayPressure('user-1', '2026-11-27', clientAnswering(500, { message: 'down' }).client, NOW)).toMatchObject({ kind: 'pressure' });

  removeCachedSignals('user-1');
  setCurrentUserId(null);
  await fetchTodayPressure('user-1', '2026-11-27', clientAnswering(200, [ROW]).client, NOW);
  expect(kvGet('signals.user-1')).toBeNull();
});

test('no row, or one that is not a pressure signal, reads as none', async () => {
  expect(await fetchTodayPressure('user-1', '2026-11-27', clientAnswering(200, []).client, NOW)).toBeNull();
  expect(await fetchTodayPressure('user-1', '2026-11-27', clientAnswering(200, [{ ...ROW, evidence: {} }]).client, NOW)).toBeNull();
});

test('a row computed more than 3 hours ago is a stale forecast: dropped online and from the kept copy', async () => {
  expect(await fetchTodayPressure('user-1', '2026-11-27', clientAnswering(200, [STALE]).client, NOW)).toBeNull();

  await fetchTodayPressure('user-1', '2026-11-27', clientAnswering(200, [ROW]).client, NOW);
  expect(readCachedPressure('user-1', '2026-11-27', new Date('2026-11-27T19:05:00Z'))).toMatchObject({ kind: 'pressure' });
  expect(readCachedPressure('user-1', '2026-11-27', new Date('2026-11-27T19:06:00Z'))).toBeNull();
  // Offline later the same day, the kept row has aged past the limit too.
  expect(await fetchTodayPressure('user-1', '2026-11-27', clientAnswering(500, { message: 'down' }).client, new Date('2026-11-27T19:06:00Z'))).toBeNull();
});

test('concurrent fetches for the same day all answer with the newest reply, and only it is kept', async () => {
  let release = (): void => undefined;
  const slow = clientAnswering(200, [ROW], new Promise<void>((resolve) => {
    release = resolve;
  })).client;
  const older = fetchTodayPressure('user-1', '2026-11-27', slow, NOW);
  const newer = fetchTodayPressure('user-1', '2026-11-27', clientAnswering(200, []).client, NOW);

  expect(await newer).toBeNull();
  release();
  expect(await older).toBeNull();
  expect(readCachedPressure('user-1', '2026-11-27', NOW)).toBeNull();
  expect(kvGet('signals.user-1')).toBe(JSON.stringify({ localDate: '2026-11-27', row: null }));
});
