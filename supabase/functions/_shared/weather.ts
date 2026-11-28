// The pressure forecast: the only module that talks to a weather provider (its URL, its response and the
// shared `weather_cache`), so a provider swap stays here (docs/architecture.md#weather).

import type { SupabaseEnv, WeatherEnv } from './env.ts';
import { isRecord } from './guards.ts';
import { fetchWithDeadline } from './http.ts';
import { POSTGREST_TIMEOUT_MS, restJson, serviceHeaders } from './rest.ts';

/** Covers now + 24 h from a forecast up to 3 h old, the hour in progress included. */
export const PRESSURE_HOURS = 28;
export const FORECAST_TIMEOUT_MS = 5_000;

/** Hourly sea-level pressure; an hour the provider left empty is missing from both lists. `fetchedAt` is the UTC hour of the fetch. */
export interface PressureForecast {
  fetchedAt: string;
  hours: readonly string[];
  hPa: readonly number[];
}

export type WeatherDeps = { env: SupabaseEnv & WeatherEnv; fetch: typeof fetch; now: () => number };

const HOUR_MS = 3_600_000;
const OPEN_METEO_HOUR = /^\d{4}-\d{2}-\d{2}T\d{2}:00$/;
const ISO_HOUR = /^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$/;

// One decimal is about 11 km: the coarse area the profile stores, and all a request ever carries.
function oneDecimal(value: number): string {
  const text = value.toFixed(1);
  return text === '-0.0' ? '0.0' : text;
}

export function cellKey(lat: number, lon: number): string {
  return `${oneDecimal(lat)},${oneDecimal(lon)}`;
}

export function pressureUrl(env: WeatherEnv, lat: number, lon: number): string {
  const params = new URLSearchParams({
    latitude: oneDecimal(lat),
    longitude: oneDecimal(lon),
    hourly: 'pressure_msl',
    forecast_hours: String(PRESSURE_HOURS),
    timezone: 'GMT',
  });
  if (env.openMeteoApiKey !== '') params.set('apikey', env.openMeteoApiKey);
  return `${env.openMeteoUrl}/v1/forecast?${params.toString()}`;
}

/** Open-Meteo hourly JSON (timezone=GMT) → ISO hours ending in Z; a null value drops that hour; null for any other shape. */
export function parsePressure(body: unknown, fetchedAt: string): PressureForecast | null {
  if (!isRecord(body) || !isRecord(body.hourly)) return null;
  if (body.utc_offset_seconds !== undefined && body.utc_offset_seconds !== 0) return null;
  const { time, pressure_msl: values } = body.hourly;
  if (!Array.isArray(time) || !Array.isArray(values) || time.length !== values.length) return null;
  const hours: string[] = [];
  const hPa: number[] = [];
  for (const [index, hour] of (time as unknown[]).entries()) {
    if (typeof hour !== 'string' || !OPEN_METEO_HOUR.test(hour)) return null;
    const value: unknown = (values as unknown[]).at(index);
    if (value === null) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    hours.push(`${hour}:00Z`);
    hPa.push(value);
  }
  return { fetchedAt, hours, hPa };
}

/** A cache row's forecast; null for a row that isn't one, which then reads as a miss. */
function cachedForecast(row: unknown): PressureForecast | null {
  if (!isRecord(row) || typeof row.fetched_at !== 'string' || !isRecord(row.payload)) return null;
  const fetchedAt = Date.parse(row.fetched_at);
  const { hours, hPa } = row.payload;
  if (Number.isNaN(fetchedAt) || !Array.isArray(hours) || !Array.isArray(hPa) || hours.length !== hPa.length) return null;
  const isHour = (value: unknown): value is string => typeof value === 'string' && ISO_HOUR.test(value);
  const isPressure = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
  const hourList: unknown[] = hours;
  const valueList: unknown[] = hPa;
  if (!hourList.every(isHour) || !valueList.every(isPressure)) return null;
  return { fetchedAt: new Date(fetchedAt).toISOString(), hours: hourList, hPa: valueList };
}

/** Whether the series reaches 24 h past `hour`, the hour in progress: the horizon the pressure signal compares against. */
function reachesDayAhead(forecast: PressureForecast, hour: number): boolean {
  const last = forecast.hours.at(-1);
  return last !== undefined && Date.parse(last) >= hour + 24 * HOUR_MS;
}

const validCell = ({ lat, lon }: { lat: number; lon: number }): boolean =>
  Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;

/** The newest row since `since`; a row that no longer reaches a day past `hour` (its tail hours were null) is a miss. */
async function readCache(key: string, since: number, hour: number, deps: WeatherDeps): Promise<PressureForecast | null> {
  const params = new URLSearchParams({
    select: 'fetched_at,payload',
    location_key: `eq.${key}`,
    fetched_at: `gte.${new Date(since).toISOString()}`,
    order: 'fetched_at.desc',
    limit: '1',
  });
  const rows = await restJson(deps.fetch, `${deps.env.supabaseUrl}/rest/v1/weather_cache?${params.toString()}`, {
    headers: serviceHeaders(deps.env),
  });
  const cached = Array.isArray(rows) ? cachedForecast((rows as unknown[]).at(0)) : null;
  return cached !== null && reachesDayAhead(cached, hour) ? cached : null;
}

/** The fetched forecast when it reaches 24 h past the hour in progress; null otherwise, so a short one is never cached. */
async function fetchForecast(cell: { lat: number; lon: number }, hour: number, deps: WeatherDeps): Promise<PressureForecast | null> {
  const response = await fetchWithDeadline(deps.fetch, pressureUrl(deps.env, cell.lat, cell.lon), { method: 'GET' }, FORECAST_TIMEOUT_MS);
  if (!response.ok) return null;
  const forecast = parsePressure((await response.json()) as unknown, new Date(hour).toISOString());
  return forecast !== null && reachesDayAhead(forecast, hour) ? forecast : null;
}

// `fetched_at` is the UTC hour, so a second write in the same hour hits the primary key and is ignored.
// NOTE: two runs that miss the cache at once both still fetch (one extra call per cell); upgrade: a per-cell lock if overlapping runs become common.
async function writeCache(key: string, forecast: PressureForecast, deps: WeatherDeps): Promise<void> {
  try {
    await fetchWithDeadline(
      deps.fetch,
      `${deps.env.supabaseUrl}/rest/v1/weather_cache`,
      {
        method: 'POST',
        headers: { ...serviceHeaders(deps.env), 'content-type': 'application/json', prefer: 'resolution=ignore-duplicates' },
        body: JSON.stringify({ location_key: key, fetched_at: forecast.fetchedAt, payload: { hours: forecast.hours, hPa: forecast.hPa } }),
      },
      POSTGREST_TIMEOUT_MS,
    );
  } catch {
    // The forecast is still good for this run; the next one fetches again.
  }
}

/**
 * The newest cached forecast for the cell no older than `maxAgeHours`, else one fetch stored in the cache;
 * null on any failure. Never throws. A cache that cannot be read is a failure too, so a database outage
 * never turns every user of a run into a provider call.
 */
export async function pressureFor(cell: { lat: number; lon: number }, maxAgeHours: number, deps: WeatherDeps): Promise<PressureForecast | null> {
  if (!validCell(cell)) return null;
  try {
    const key = cellKey(cell.lat, cell.lon);
    const now = deps.now();
    const hour = now - (now % HOUR_MS);
    const cached = await readCache(key, now - maxAgeHours * HOUR_MS, hour, deps);
    if (cached !== null) return cached;
    // Stamped with the hour in progress, the forecast's first hour, so its age counts from there; a series
    // with null tail hours can stop short of 28, which is why the read checks the horizon again.
    const forecast = await fetchForecast(cell, hour, deps);
    if (forecast !== null) await writeCache(key, forecast, deps);
    return forecast;
  } catch {
    return null;
  }
}
