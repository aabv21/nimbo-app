/** @jest-environment node */
// supabase/functions/_shared/__tests__/weather.test.ts
import type { SupabaseEnv, WeatherEnv } from '../env.ts';
import { cellKey, FORECAST_TIMEOUT_MS, parsePressure, PRESSURE_HOURS, pressureFor, pressureUrl, type WeatherDeps } from '../weather.ts';
import { type Call, fakeFetch, hanging, json } from './fakeFetch.ts';

const { jest } = import.meta;

const ENV: SupabaseEnv & WeatherEnv = {
  supabaseUrl: 'http://supabase.test',
  anonKey: 'anon-key-test',
  serviceRoleKey: 'service-role-test',
  openMeteoUrl: 'http://weather.test',
  openMeteoApiKey: '',
};
const NOW = Date.parse('2026-11-27T13:05:00Z');
const HOUR_MS = 3_600_000;
const BOGOTA = { lat: 4.6, lon: -74.1 };

afterEach(() => {
  jest.useRealTimers();
});

/** `count` ISO hours from 13:00Z on the 27th. */
const hoursFrom13 = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => new Date(Date.parse('2026-11-27T13:00:00Z') + index * HOUR_MS).toISOString().replace('.000Z', 'Z'));

/** An Open-Meteo hourly answer from 13:00Z, as it comes back for `timezone=GMT`. */
function openMeteo(values: readonly unknown[]): unknown {
  return {
    latitude: 4.625,
    longitude: -74.125,
    generationtime_ms: 0.04,
    utc_offset_seconds: 0,
    timezone: 'GMT',
    timezone_abbreviation: 'GMT',
    elevation: 2582,
    hourly_units: { time: 'iso8601', pressure_msl: 'hPa' },
    hourly: { time: hoursFrom13(values.length).map((hour) => hour.slice(0, 16)), pressure_msl: values },
  };
}

describe('pressureUrl', () => {
  test('asks for the hourly sea-level pressure of one cell, 28 hours in GMT, with no key on the free API', () => {
    expect(PRESSURE_HOURS).toBe(28);
    expect(pressureUrl(ENV, 4.6, -74.1)).toBe(
      'http://weather.test/v1/forecast?latitude=4.6&longitude=-74.1&hourly=pressure_msl&forecast_hours=28&timezone=GMT',
    );
  });

  test('adds the commercial key only when one is set', () => {
    expect(pressureUrl({ ...ENV, openMeteoApiKey: 'k' }, 4.6, -74.1)).toMatch(/&apikey=k$/);
  });

  test('sends one decimal whatever it is given', () => {
    const url = new URL(pressureUrl(ENV, 4.6234, -74.0817));
    expect(url.searchParams.get('latitude')).toBe('4.6');
    expect(url.searchParams.get('longitude')).toBe('-74.1');
  });
});

describe('cellKey', () => {
  test('one decimal per coordinate, and never a negative zero', () => {
    expect(cellKey(4.6, -74.1)).toBe('4.6,-74.1');
    expect(cellKey(-0.04, 0)).toBe('0.0,0.0');
    expect(cellKey(-23.55, -46.63)).toMatch(/^-23\.[56],-46\.6$/);
  });
});

describe('parsePressure', () => {
  const FETCHED = '2026-11-27T13:05:00.000Z';

  test('Open-Meteo GMT hours become ISO hours ending in Z', () => {
    expect(parsePressure(openMeteo([1012.4, 1011.9]), FETCHED)).toEqual({
      fetchedAt: FETCHED,
      hours: ['2026-11-27T13:00:00Z', '2026-11-27T14:00:00Z'],
      hPa: [1012.4, 1011.9],
    });
  });

  test('a null value drops that hour only', () => {
    expect(parsePressure(openMeteo([1012.4, null, 1011.0]), FETCHED)).toEqual({
      fetchedAt: FETCHED,
      hours: ['2026-11-27T13:00:00Z', '2026-11-27T15:00:00Z'],
      hPa: [1012.4, 1011.0],
    });
  });

  test.each([
    ['mismatched lengths', { hourly: { time: ['2026-11-27T13:00', '2026-11-27T14:00'], pressure_msl: [1012] } }],
    ['a string value', openMeteo([1012.4, '1011.9'])],
    ['a missing hourly', { latitude: 4.6, longitude: -74.1 }],
    ['a missing pressure_msl', { hourly: { time: ['2026-11-27T13:00'] } }],
    ['a time that is not an hour', { hourly: { time: ['2026-11-27 13:00'], pressure_msl: [1012] } }],
    ['another time zone', { ...(openMeteo([1012]) as object), utc_offset_seconds: -18_000 }],
    ['an array', [1012]],
    ['null', null],
  ])('null for %s', (_label, body) => {
    expect(parsePressure(body, FETCHED)).toBeNull();
  });
});

describe('pressureFor', () => {
  type Row = { location_key: string; fetched_at: string; payload: unknown };

  /** A cache read as PostgREST answers it (the `gte` filter applied); undefined for any other call. */
  function answerCache(rows: readonly Row[], call: Call): Response | undefined {
    if (call.url.host === 'weather.test' || call.method !== 'GET') return undefined;
    const key = call.url.searchParams.get('location_key')?.replace(/^eq\./, '');
    const since = Date.parse(call.url.searchParams.get('fetched_at')?.replace(/^gte\./, '') ?? '');
    const hits = rows.filter((row) => row.location_key === key && Date.parse(row.fetched_at) >= since);
    return json(200, [...hits].sort((a, b) => Date.parse(b.fetched_at) - Date.parse(a.fetched_at)).slice(0, 1));
  }

  /** The cache as PostgREST serves it and the forecast API behind `forecast`. */
  function world(rows: Row[], forecast: (call: Call, init: RequestInit) => Response | Promise<Response>, insert = () => new Response(null, { status: 201 })) {
    const fake = fakeFetch((call, init) => {
      if (call.url.host === 'weather.test') return forecast(call, init);
      if (call.method === 'POST') return insert();
      return answerCache(rows, call) ?? json(404, {});
    });
    const deps: WeatherDeps = { env: ENV, fetch: fake.fetch, now: () => NOW };
    const forecastCalls = () => fake.calls.filter((call) => call.url.host === 'weather.test');
    const inserts = () => fake.calls.filter((call) => call.method === 'POST');
    return { deps, calls: fake.calls, forecastCalls, inserts };
  }

  const ago = (hours: number): string => new Date(NOW - hours * HOUR_MS).toISOString().replace('Z', '+00:00');
  // 28 hours from 11:00Z, so it still reaches 13:00Z tomorrow.
  const CACHED = {
    hours: Array.from({ length: PRESSURE_HOURS }, (_, index) => new Date(Date.parse('2026-11-27T11:00:00Z') + index * HOUR_MS).toISOString().replace('.000Z', 'Z')),
    hPa: Array.from({ length: PRESSURE_HOURS }, () => 1013.2),
  };
  // A full answer: 28 hours from the hour in progress, the first two 1012.4 and 1011.9.
  const FULL = [1012.4, 1011.9, ...Array.from({ length: PRESSURE_HOURS - 2 }, () => 1011.5)];
  const fine = () => json(200, openMeteo(FULL));

  test('a cache row 2 h old answers with no Open-Meteo call, read with the service role', async () => {
    const { deps, calls, forecastCalls } = world([{ location_key: '4.6,-74.1', fetched_at: ago(2), payload: CACHED }], fine);
    expect(await pressureFor(BOGOTA, 3, deps)).toEqual({ fetchedAt: '2026-11-27T11:05:00.000Z', ...CACHED });
    expect(forecastCalls()).toHaveLength(0);
    const [read] = calls;
    expect(read?.url.pathname).toBe('/rest/v1/weather_cache');
    expect(read?.url.searchParams.get('location_key')).toBe('eq.4.6,-74.1');
    expect(read?.url.searchParams.get('fetched_at')).toBe('gte.2026-11-27T10:05:00.000Z');
    expect(read?.url.searchParams.get('order')).toBe('fetched_at.desc');
    expect(read?.url.searchParams.get('limit')).toBe('1');
    expect(read?.headers.get('apikey')).toBe('service-role-test');
    expect(read?.headers.get('authorization')).toBe('Bearer service-role-test');
  });

  test('a row 4 h old fetches once and posts one insert of the fetched forecast', async () => {
    const { deps, forecastCalls, inserts } = world([{ location_key: '4.6,-74.1', fetched_at: ago(4), payload: CACHED }], fine);
    const expected = { fetchedAt: '2026-11-27T13:00:00.000Z', hours: hoursFrom13(PRESSURE_HOURS), hPa: FULL };
    expect(await pressureFor(BOGOTA, 3, deps)).toEqual(expected);
    expect(forecastCalls()).toHaveLength(1);
    expect(forecastCalls()[0]?.url.href).toBe(pressureUrl(ENV, 4.6, -74.1));
    const [insert] = inserts();
    expect(inserts()).toHaveLength(1);
    expect(insert?.url.href).toBe('http://supabase.test/rest/v1/weather_cache');
    expect(insert?.headers.get('prefer')).toBe('resolution=ignore-duplicates');
    expect(insert?.headers.get('apikey')).toBe('service-role-test');
    expect(JSON.parse(insert?.body ?? '')).toEqual({
      location_key: '4.6,-74.1',
      fetched_at: '2026-11-27T13:00:00.000Z',
      payload: { hours: expected.hours, hPa: expected.hPa },
    });
  });

  test('a cached payload that is no forecast is a miss, not an answer', async () => {
    const { deps, forecastCalls } = world([{ location_key: '4.6,-74.1', fetched_at: ago(1), payload: { hours: ['x'], hPa: [1] } }], fine);
    expect((await pressureFor(BOGOTA, 3, deps))?.fetchedAt).toBe('2026-11-27T13:00:00.000Z');
    expect(forecastCalls()).toHaveLength(1);
  });

  test.each([
    ['a 500', () => json(500, { error: true, reason: 'internal' })],
    ['a garbage body', () => new Response('<html>busy</html>', { status: 200 })],
    ['a 429', () => json(429, { error: true, reason: 'Daily API request limit exceeded' })],
    ['a shape that is no forecast', () => json(200, { hourly: { time: ['2026-11-27T13:00'] } })],
    ['a network error', () => Promise.reject(new TypeError('fetch failed'))],
    ['an empty forecast', () => json(200, openMeteo([]))],
    ['every hour null', () => json(200, openMeteo(FULL.map(() => null)))],
    ['a forecast ending before now + 24 h', () => json(200, openMeteo(FULL.slice(0, 24)))],
  ])('%s gives null and no insert', async (_label, answer) => {
    const { deps, inserts } = world([], answer);
    expect(await pressureFor(BOGOTA, 3, deps)).toBeNull();
    expect(inserts()).toHaveLength(0);
  });

  test('a fetch outliving FORECAST_TIMEOUT_MS gives null and no insert', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    const { deps, forecastCalls, inserts } = world([], hanging);
    let settled = false;
    const pending = pressureFor(BOGOTA, 3, deps).then((value) => {
      settled = true;
      return value;
    });
    // The cache read answers first; the deadline starts with the forecast call.
    for (let turn = 0; turn < 50 && forecastCalls().length === 0; turn += 1) await jest.advanceTimersByTimeAsync(0);
    expect(forecastCalls()).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(FORECAST_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    expect(await pending).toBeNull();
    expect(inserts()).toHaveLength(0);
  });

  test('a failed insert still returns the forecast', async () => {
    const { deps, inserts } = world([], fine, () => json(500, { message: 'boom' }));
    expect((await pressureFor(BOGOTA, 3, deps))?.hPa).toEqual(FULL);
    expect(inserts()).toHaveLength(1);
  });

  test('a forecast whose last hours are null counts while it reaches now + 24 h, and is refetched once it does not', async () => {
    const rows: Row[] = [];
    let fetches = 0;
    const store = (call: Call) => {
      const { location_key, fetched_at, payload } = JSON.parse(call.body ?? '') as Row;
      rows.push({ location_key, fetched_at, payload });
      return new Response(null, { status: 201 });
    };
    const fake = fakeFetch((call) => {
      if (call.method === 'POST') return store(call);
      const cached = answerCache(rows, call);
      if (cached !== undefined) return cached;
      // The first answer has a null tail; the next one runs a full day past 14:00Z.
      fetches += 1;
      return json(200, openMeteo(fetches === 1 ? [...FULL.slice(0, 25), null, null, null] : [1013, ...FULL]));
    });
    const deps: WeatherDeps = { env: ENV, fetch: fake.fetch, now: () => NOW };
    const forecastCalls = () => fake.calls.filter((call) => call.url.host === 'weather.test').length;

    expect((await pressureFor(BOGOTA, 3, deps))?.hours.at(-1)).toBe('2026-11-28T13:00:00Z');
    expect(rows).toHaveLength(1);
    // Later in the same hour the stored row still reaches 13:00Z tomorrow: served, no fetch.
    expect((await pressureFor(BOGOTA, 3, { ...deps, now: () => NOW + 50 * 60_000 }))?.fetchedAt).toBe('2026-11-27T13:00:00.000Z');
    expect(forecastCalls()).toBe(1);
    // An hour on it ends before 14:00Z tomorrow: a miss, so it fetches again.
    expect((await pressureFor(BOGOTA, 3, { ...deps, now: () => NOW + HOUR_MS }))?.fetchedAt).toBe('2026-11-27T14:00:00.000Z');
    expect(forecastCalls()).toBe(2);
  });

  test('a cached row stamped S that ends at S + 24 h is served at S and is a miss at S + 1 h', async () => {
    const row = { location_key: '4.6,-74.1', fetched_at: '2026-11-27T13:00:00+00:00', payload: { hours: hoursFrom13(25), hPa: FULL.slice(0, 25) } };
    const atS = world([row], fine);
    expect((await pressureFor(BOGOTA, 3, atS.deps))?.hours).toEqual(hoursFrom13(25));
    expect(atS.forecastCalls()).toHaveLength(0);
    const later = world([row], fine);
    const fresh = await pressureFor(BOGOTA, 3, { ...later.deps, now: () => Date.parse('2026-11-27T14:00:00Z') });
    expect(later.forecastCalls()).toHaveLength(1);
    expect(fresh?.fetchedAt).toBe('2026-11-27T14:00:00.000Z');
  });

  test('two writes in the same UTC hour send the same fetched_at, so the primary key keeps one row', async () => {
    const { deps, inserts } = world([], fine);
    await pressureFor(BOGOTA, 3, deps);
    await pressureFor(BOGOTA, 3, { ...deps, now: () => Date.parse('2026-11-27T13:59:59Z') });
    await pressureFor(BOGOTA, 3, { ...deps, now: () => Date.parse('2026-11-27T14:00:00Z') });
    const stamps = inserts().map((call) => (JSON.parse(call.body ?? '') as { fetched_at: string }).fetched_at);
    expect(stamps).toEqual(['2026-11-27T13:00:00.000Z', '2026-11-27T13:00:00.000Z', '2026-11-27T14:00:00.000Z']);
  });

  test('a cache that cannot be read gives null without asking Open-Meteo', async () => {
    const fake = fakeFetch((call) => (call.url.host === 'weather.test' ? fine() : json(503, { message: 'down' })));
    expect(await pressureFor(BOGOTA, 3, { env: ENV, fetch: fake.fetch, now: () => NOW })).toBeNull();
    expect(fake.calls.filter((call) => call.url.host === 'weather.test')).toHaveLength(0);
  });

  test.each([
    ['a latitude past the pole', { lat: 91, lon: 0 }],
    ['a longitude past the antimeridian', { lat: 0, lon: 181 }],
    ['NaN', { lat: Number.NaN, lon: 0 }],
  ])('%s gives null with no request at all', async (_label, cell) => {
    const { deps, calls } = world([], fine);
    expect(await pressureFor(cell, 3, deps)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test('no request holds more than one decimal of either coordinate', async () => {
    const { deps, calls } = world([], fine);
    await pressureFor({ lat: 4.6234, lon: -74.0817 }, 3, deps);
    expect(calls).toHaveLength(3);
    const coordinates = calls.flatMap((call) => [
      ...['latitude', 'longitude', 'location_key'].flatMap((name) => call.url.searchParams.get(name) ?? []),
      ...(call.body === undefined ? [] : [(JSON.parse(call.body) as { location_key: string }).location_key]),
    ]);
    expect(coordinates).toEqual(['eq.4.6,-74.1', '4.6', '-74.1', '4.6,-74.1']);
    for (const call of calls) expect(`${call.url.href} ${call.body ?? ''}`).not.toMatch(/4\.62|74\.08/);
  });
});
