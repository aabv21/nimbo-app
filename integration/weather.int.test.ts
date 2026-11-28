// `pressureFor` against the local stack's `weather_cache` and the mock Open-Meteo: the PostgREST filter on
// a cell key with a comma, the service-role write, and the cache answering the next call. Needs `pnpm db:start`.

import type { SupabaseEnv, WeatherEnv } from '../supabase/functions/_shared/env.ts';
import { cellKey, PRESSURE_HOURS, pressureFor } from '../supabase/functions/_shared/weather.ts';
import { loadIntegrationEnv, serviceClient } from './helpers';
import { type MockServices, startMockServices } from './mockServices';

loadIntegrationEnv();

const env = (): SupabaseEnv & WeatherEnv => {
  const values = new Map(Object.entries(process.env));
  return {
    supabaseUrl: values.get('EXPO_PUBLIC_SUPABASE_URL') ?? '',
    anonKey: values.get('EXPO_PUBLIC_SUPABASE_ANON_KEY') ?? '',
    serviceRoleKey: values.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    // The test runs on the host, so it reaches the mock directly, not through host.docker.internal.
    openMeteoUrl: 'http://127.0.0.1:54518',
    openMeteoApiKey: '',
  };
};

// A cell no other test uses, with a negative latitude to exercise the key's format.
const CELL = { lat: -23.5, lon: -46.6 };
const KEY = cellKey(CELL.lat, CELL.lon);

let mock: MockServices;

const HOUR_MS = 3_600_000;
const hourOf = (ms: number): number => ms - (ms % HOUR_MS);

const clearCell = async (): Promise<void> => {
  const { error } = await serviceClient().from('weather_cache').delete().eq('location_key', KEY);
  expect(error).toBeNull();
};

beforeAll(async () => {
  mock = await startMockServices();
});

afterAll(async () => {
  await clearCell();
  await mock.close();
});

beforeEach(clearCell);

test('two calls a minute apart make one forecast request and leave one weather_cache row', async () => {
  const start = Date.now();
  const first = await pressureFor(CELL, 3, { env: env(), fetch, now: () => start });
  const second = await pressureFor(CELL, 3, { env: env(), fetch, now: () => start + 60_000 });

  expect(first?.hours).toHaveLength(PRESSURE_HOURS);
  expect(first?.hPa.every((value) => value === 1013)).toBe(true);
  expect(second).toEqual(first);

  const requests = mock.forecastRequests();
  expect(requests).toHaveLength(1);
  expect(requests[0]?.searchParams.get('latitude')).toBe('-23.5');
  expect(requests[0]?.searchParams.get('longitude')).toBe('-46.6');

  const { data, error } = await serviceClient().from('weather_cache').select('location_key, fetched_at').eq('location_key', KEY);
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
  // Stamped with the hour in progress, so another run writing this hour hits the primary key.
  expect(Date.parse(data?.[0]?.fetched_at ?? '')).toBe(hourOf(start));
});

test('a forecast older than the limit is fetched again, adding a newer row', async () => {
  const start = Date.now();
  await pressureFor(CELL, 3, { env: env(), fetch, now: () => start - 4 * HOUR_MS });
  const before = mock.forecastRequests().length;
  const fresh = await pressureFor(CELL, 3, { env: env(), fetch, now: () => start });

  expect(fresh?.fetchedAt).toBe(new Date(hourOf(start)).toISOString());
  expect(mock.forecastRequests()).toHaveLength(before + 1);
  const { data } = await serviceClient().from('weather_cache').select('fetched_at').eq('location_key', KEY);
  expect(data).toHaveLength(2);
});
