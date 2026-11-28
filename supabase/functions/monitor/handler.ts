// The hourly monitor, called by the pg_cron job through pg_net with the Vault secret (docs/api.md#monitor): reads
// Expo's receipts, then computes, stores and maybe pushes every target's signals. Logs carry only outcome words and counts.

import { localDateIn, packs } from '../_shared/condition/index.ts';
import type { MonitorSecretEnv, PushEnv, SupabaseEnv, WeatherEnv } from '../_shared/env.ts';
import { isRecord, UUID } from '../_shared/guards.ts';
import { fetchWithDeadline, reply, secretMatches } from '../_shared/http.ts';
import { deleteTokens, getReceipts, type PushMessage, sendPushes } from '../_shared/push.ts';
import { pushLanguageOf, signalPushCopy } from '../_shared/pushCopy.ts';
import { parseRecordInputs } from '../_shared/records.ts';
import { POSTGREST_TIMEOUT_MS, serviceHeaders, UpstreamError } from '../_shared/rest.ts';
import {
  computeSignals,
  decidePush,
  monitorSelects,
  type PushLogEntry,
  quietDaysOf,
  type Signal,
  type SignalUser,
  weatherApplies,
  withoutRepeatedQuiet,
} from '../_shared/signals.ts';
import { cellKey, type PressureForecast, pressureFor } from '../_shared/weather.ts';

/**
 * No user starts after this much of the run; the rest count as `skipped`. Each run starts one place further along the
 * list (by the hour), so the users a run leaves out are not the same ones every hour.
 */
// NOTE: ceiling a few hundred users per run; upgrade: page users across parallel invocations once `skipped` shows up in the counts.
export const MONITOR_START_CUTOFF_MS = 90_000;
/** No forecast is waited for after this much of the run, so a claim can still follow. */
export const FORECAST_WAIT_END_MS = 100_000;
/** No claim is made after this much of the run: one slow user cannot push the sends past the wall clock. */
export const MONITOR_BUDGET_MS = 110_000;
/** Expo may not have a receipt before then; `push_receipts_due()` applies it. */
export const RECEIPTS_MIN_AGE_MS = 15 * 60_000;
/**
 * A configured `MONITOR_SECRET` shorter than this refuses every caller: a short value could be guessed, so a weak setup
 * fails closed (logged `misconfigured`) instead of running with everyone's data. `openssl rand -hex 32` gives 64.
 */
export const MIN_MONITOR_SECRET_LENGTH = 32;
/** Cells whose forecast is looked up at once; one lookup can take about 21 s (cache read, provider, cache write). */
export const WEATHER_CONCURRENCY = 4;

export type MonitorEnv = SupabaseEnv & WeatherEnv & PushEnv & MonitorSecretEnv;
export type MonitorDeps = { env: MonitorEnv; fetch: typeof fetch; now?: () => number };

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

type Counts = {
  targets: number;
  evaluated: number;
  skipped: number;
  failed: number;
  signals: number;
  pushed: number;
  weather_fetches: number;
  receipts_checked: number;
  tokens_removed: number;
};

type Claimed = { signal_id: string; token: string; language: string | null };

/** PostgREST's `max_rows` (1000 here); paging by rows received still reads all under a smaller hosted cap. */
const PAGE = 1000;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const pack = packs.migraine;

const isNumberOrNull = (value: unknown): value is number | null => value === null || (typeof value === 'number' && Number.isFinite(value));
const isTexts = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string');

function isTarget(row: unknown): row is Target {
  return (
    isRecord(row) &&
    typeof row.user_id === 'string' &&
    UUID.test(row.user_id) &&
    typeof row.timezone === 'string' &&
    typeof row.notify_start === 'string' &&
    typeof row.notify_end === 'string' &&
    typeof row.notify_daily_cap === 'number' &&
    typeof row.lock_screen_detail === 'boolean' &&
    (row.language === null || typeof row.language === 'string') &&
    isNumberOrNull(row.coarse_lat) &&
    isNumberOrNull(row.coarse_lon) &&
    isTexts(row.known_triggers)
  );
}

const isClaimed = (row: unknown): row is Claimed =>
  isRecord(row) && typeof row.signal_id === 'string' && typeof row.token === 'string' && (row.language === null || typeof row.language === 'string');

function pushLogOf(rows: unknown): PushLogEntry[] {
  if (!Array.isArray(rows)) throw new UpstreamError('save_signals: unexpected rows');
  return rows.flatMap((row: unknown): PushLogEntry[] =>
    isRecord(row) && typeof row.cause_key === 'string' && typeof row.cause === 'string' && typeof row.pushed_at === 'string'
      ? [{ causeKey: row.cause_key, cause: row.cause, pushedAt: row.pushed_at }]
      : [],
  );
}

/** A service-role RPC (the monitor runs as no user); a void one answers null. Throws on any failure. */
async function rpc(deps: MonitorDeps, name: string, args: Record<string, unknown>, query = ''): Promise<unknown> {
  const response = await fetchWithDeadline(
    deps.fetch,
    `${deps.env.supabaseUrl}/rest/v1/rpc/${name}${query}`,
    { method: 'POST', headers: { ...serviceHeaders(deps.env), 'content-type': 'application/json' }, body: JSON.stringify(args) },
    POSTGREST_TIMEOUT_MS,
  );
  if (!response.ok) throw new UpstreamError(`${name}: HTTP ${String(response.status)}`);
  const text = await response.text();
  return text === '' ? null : (JSON.parse(text) as unknown);
}

/**
 * Every row `monitor_targets()` answers, page by page in user id order. A profile onboarded or deleted between pages
 * shifts the rest by one: a repeated user is harmless (`save_signals` and `claim_signal_push` are idempotent), a skipped one waits an hour.
 * NOTE: each page re-runs the function over every onboarded profile; page by key (a `p_after` user id) once reading the targets takes over a second.
 */
async function readTargets(deps: MonitorDeps): Promise<Target[]> {
  const targets: Target[] = [];
  for (let offset = 0; ; ) {
    const page = await rpc(deps, 'monitor_targets', {}, `?order=user_id&limit=${String(PAGE)}&offset=${String(offset)}`);
    if (!Array.isArray(page) || !page.every(isTarget)) throw new UpstreamError('monitor_targets: unexpected rows');
    if (page.length === 0) return targets;
    targets.push(...page);
    offset += page.length;
  }
}

/** Receipts of tickets 15 minutes to 24 hours old; deletes the tokens Expo says are gone and forgets the checked tickets. */
async function checkReceipts(deps: MonitorDeps): Promise<{ checked: number; removed: number }> {
  const due = await rpc(deps, 'push_receipts_due', { p_limit: 1000 });
  if (!Array.isArray(due)) throw new UpstreamError('push_receipts_due: unexpected rows');
  const tokenOf = new Map<string, string>();
  for (const row of due as unknown[]) {
    if (isRecord(row) && typeof row.ticket_id === 'string' && typeof row.token === 'string') tokenOf.set(row.ticket_id, row.token);
  }
  if (tokenOf.size === 0) return { checked: 0, removed: 0 };
  const { checked, dead } = await getReceipts(deps.env, deps.fetch, [...tokenOf.keys()]);
  const deadTokens = [...new Set(dead.flatMap((id) => tokenOf.get(id) ?? []))];
  if (deadTokens.length > 0) await deleteTokens(deps.env, deps.fetch, deadTokens);
  if (checked.length > 0) await rpc(deps, 'forget_push_tickets', { p_ids: checked });
  return { checked: checked.length, removed: deadTokens.length };
}

type Cell = { lat: number; lon: number };

/**
 * One forecast lookup per distinct cell for the whole run, `limit` at a time. A lookup a user is waiting for now
 * (`urgent`) goes ahead of the queued prefetches; a user waits for their cell only until `FORECAST_WAIT_END_MS`.
 */
export function forecastPool(lookup: (cell: Cell) => Promise<PressureForecast | null>, limit = WEATHER_CONCURRENCY) {
  const byCell = new Map<string, Promise<PressureForecast | null>>();
  const waiting: { key: string; start: () => void }[] = [];
  let active = 0;

  const startNext = (): void => {
    const next = waiting.shift();
    if (next !== undefined) next.start();
  };

  const schedule = (key: string, task: () => Promise<PressureForecast | null>, urgent: boolean): Promise<PressureForecast | null> =>
    new Promise((resolve) => {
      const start = (): void => {
        active += 1;
        void task()
          .catch(() => null)
          .then(resolve, () => undefined)
          .finally(() => {
            active -= 1;
            startNext();
          });
      };
      if (active < limit) start();
      else if (urgent) waiting.unshift({ key, start });
      else waiting.push({ key, start });
    });

  return {
    get(cell: Cell, urgent = false): Promise<PressureForecast | null> {
      const key = cellKey(cell.lat, cell.lon);
      const known = byCell.get(key);
      if (known !== undefined) {
        // A prefetch still queued moves to the front once a user waits for it.
        const queued = waiting.findIndex((entry) => entry.key === key);
        if (urgent && queued > 0) waiting.unshift(...waiting.splice(queued, 1));
        return known;
      }
      const forecast = schedule(key, () => lookup(cell), urgent);
      byCell.set(key, forecast);
      return forecast;
    },
  };
}

function untilDeadline<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  if (ms <= 0) return Promise.resolve(fallback);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      resolve(fallback);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

const cellOf = (target: Target): { lat: number; lon: number } | null =>
  target.coarse_lat === null || target.coarse_lon === null ? null : { lat: target.coarse_lat, lon: target.coarse_lon };

type Run = {
  deps: MonitorDeps;
  clock: () => number;
  start: number;
  forecasts: ReturnType<typeof forecastPool>;
  counts: Counts;
};

async function evaluate(target: Target, run: Run): Promise<void> {
  const { deps, clock, counts } = run;
  const now = new Date(clock());
  const timeZone = target.timezone;
  const since = new Date(now.getTime() - pack.insights.windowDays * DAY_MS).toISOString();
  const inputs = parseRecordInputs(await rpc(deps, 'record_inputs', { p_user_id: target.user_id, p_since: since }));
  if (inputs === null) throw new UpstreamError('record_inputs: unexpected shape');

  const cell = cellOf(target);
  const user: SignalUser = {
    ...inputs,
    timeZone,
    hasLocation: cell !== null,
    onboardedAt: inputs.onboardedAt ?? '',
    pressure: null,
  };
  const pressure =
    cell !== null && weatherApplies(user, now, pack)
      ? await untilDeadline(run.forecasts.get(cell, true), run.start + FORECAST_WAIT_END_MS - clock(), null)
      : null;

  const signals = computeSignals({ ...user, pressure }, now, pack);
  const pushLog = pushLogOf(
    await rpc(deps, 'save_signals', { p_user_id: target.user_id, p_local_date: localDateIn(now, timeZone), p_signals: signals }),
  );
  counts.signals += signals.length;

  const decision = decidePush(
    withoutRepeatedQuiet(signals, pushLog),
    { timeZone, notifyStart: target.notify_start, notifyEnd: target.notify_end, notifyDailyCap: target.notify_daily_cap, pushLog },
    now,
    pack,
  );
  const signal: Signal | undefined = signals.find((entry) => entry.causeKey === decision.causeKey);
  if (decision.reason !== 'send' || signal === undefined) return;
  // Too late in the run to claim: the signals are saved, and next hour decides again.
  if (clock() - run.start >= MONITOR_BUDGET_MS) return;

  // The claim re-checks the key, the cap and the cause rule under a per-user lock, so a retried or overlapping run sends nothing twice.
  // NOTE: a claim whose send then fails stays stamped, so that push is lost rather than doubled; upgrade: an unclaim RPC if failed sends show up.
  const claimed = await rpc(deps, 'claim_signal_push', {
    p_user_id: target.user_id,
    p_cause_key: signal.causeKey,
    p_time_zone: timeZone,
    p_cap: target.notify_daily_cap,
    p_same_cause_hours: pack.push.sameCauseHours,
  });
  if (!Array.isArray(claimed) || !claimed.every(isClaimed)) throw new UpstreamError('claim_signal_push: unexpected rows');
  if (claimed.length === 0) return;

  const quiet = quietDaysOf(signal, user, now, pack) ?? undefined;
  const messages: PushMessage[] = claimed.map((row) => ({
    to: row.token,
    ...signalPushCopy(signal, pushLanguageOf(row.language), target.lock_screen_detail, quiet),
    data: { url: '/today' },
  }));
  const result = await sendPushes(deps.env, deps.fetch, messages);
  counts.pushed += result.sent;
  if (result.tickets.length > 0) await rpc(deps, 'save_push_tickets', { p_user_id: target.user_id, p_tickets: result.tickets });
  if (result.dead.length > 0) {
    await deleteTokens(deps.env, deps.fetch, result.dead);
    counts.tokens_removed += result.dead.length;
  }
}

export async function handleMonitor(request: Request, deps: MonitorDeps): Promise<Response> {
  if (request.method !== 'POST') return reply('invalid', 405, { error: 'method_not_allowed' });
  if (deps.env.monitorSecret.length < MIN_MONITOR_SECRET_LENGTH) return reply('misconfigured', 401, { error: 'unauthorized' });
  if (!secretMatches(request.headers.get('x-webhook-secret'), deps.env.monitorSecret)) {
    return reply('unauthorized', 401, { error: 'unauthorized' });
  }

  const clock = deps.now ?? Date.now;
  const start = clock();
  const counts: Counts = {
    targets: 0,
    evaluated: 0,
    skipped: 0,
    failed: 0,
    signals: 0,
    pushed: 0,
    weather_fetches: 0,
    receipts_checked: 0,
    tokens_removed: 0,
  };

  try {
    const receipts = await checkReceipts(deps);
    counts.receipts_checked = receipts.checked;
    counts.tokens_removed += receipts.removed;
  } catch {
    // Unchecked tickets are asked for again next hour, until they are 24 hours old.
    console.warn(JSON.stringify({ outcome: 'receipts_failed' }));
  }

  let targets: Target[];
  try {
    targets = await readTargets(deps);
  } catch {
    return reply('error', 500, { error: 'internal' });
  }
  counts.targets = targets.length;

  // Counts the provider requests only, not the cache reads, by the URL `_shared/weather.ts` sends them to.
  const weatherFetch: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith(`${deps.env.openMeteoUrl}/`)) counts.weather_fetches += 1;
    return deps.fetch(input, init);
  };
  const maxAgeHours = pack.signals.pressure.maxForecastAgeHours;
  const forecasts = forecastPool((cell) => pressureFor(cell, maxAgeHours, { env: deps.env, fetch: weatherFetch, now: clock }));
  const run: Run = { deps, clock, start, forecasts, counts };

  // `monitor_targets` is in user id order: starting one place further each hour keeps a budget cut from always
  // falling on the same users.
  const offset = targets.length === 0 ? 0 : Math.floor(start / HOUR_MS) % targets.length;
  const visits = [...targets.slice(offset), ...targets.slice(0, offset)];

  // The users who chose weather need their cell whatever their records say, so those lookups start now, in visit order.
  for (const target of visits) {
    const cell = cellOf(target);
    if (cell !== null && target.known_triggers.includes('weather')) void forecasts.get(cell);
  }

  for (const [index, target] of visits.entries()) {
    if (clock() - start >= MONITOR_START_CUTOFF_MS) {
      counts.skipped += visits.length - index;
      break;
    }
    // A zone the database accepts but this runtime cannot place in a day is left for a runtime that can.
    if (!monitorSelects({ timeZone: target.timezone, onboardedAt: '' })) {
      counts.skipped += 1;
      continue;
    }
    try {
      await evaluate(target, run);
      counts.evaluated += 1;
    } catch {
      counts.failed += 1;
    }
  }

  const words = Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, String(value)]));
  return reply('done', 200, { outcome: 'done', ...counts }, words);
}
