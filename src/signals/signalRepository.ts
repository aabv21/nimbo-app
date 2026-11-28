// Today's pressure row, the only signal the phone cannot compute (the forecast stays on the server). Read online and
// kept per user for an offline view; the sign-out cleanup in `SyncProvider` removes the copy.
import type { Client } from '../auth/emailAuth';
import { currentUserId } from '../auth/currentUser';
import { packs } from '../condition';
import { kvGetJson, kvRemove, kvSet } from '../lib/kv';
import { supabase } from '../lib/supabase';
import { freshPressureFromRow } from './index';
import type { Signal } from './index';

// Row-level security scopes the read to the signed-in user's own rows.
const COLUMNS = 'kind,cause,cause_key,evidence,computed_at';
const pack = packs.migraine;

interface Cached {
  localDate: string;
  row: unknown;
}

function cacheKey(userId: string): string {
  return `signals.${userId}`;
}

function isCached(value: unknown): value is Cached {
  return typeof value === 'object' && value !== null && typeof (value as Record<string, unknown>)['localDate'] === 'string' && 'row' in value;
}

/**
 * The last online answer for `localDate`, as stored: null for another day or none. Today reads it with `freshPressure`
 * on every minute tick, so a row whose forecast ages past the limit leaves the screen without a refetch.
 */
export function readCachedPressure(userId: string, localDate: string): unknown {
  const cached = kvGetJson(cacheKey(userId), isCached);
  return cached === null || cached.localDate !== localDate ? null : cached.row;
}

/** The stored row as a pressure signal while its forecast is fresh at `now`; null otherwise. */
export function freshPressure(row: unknown, now: Date): Signal | null {
  return freshPressureFromRow(row, now, pack);
}

/** Only the sign-out cleanup in `SyncProvider` calls this. */
export function removeCachedSignals(userId: string): void {
  kvRemove(cacheKey(userId));
}

let requests = 0;
// The newest fetch per user and day: an older reply that settles later never overwrites its answer or its cache.
// NOTE: one small entry per user and day for the app's lifetime; drop past days' keys if sessions ever last weeks.
const latest = new Map<string, { id: number; answer: Promise<unknown> }>();

async function readPressure(userId: string, days: readonly [string, ...string[]], client: Client, isLatest: () => boolean): Promise<unknown> {
  const [localDate] = days;
  try {
    const { data, error } = await client
      .from('signals')
      .select(COLUMNS)
      .eq('kind', 'pressure')
      .in('local_date', [...days])
      .order('computed_at', { ascending: false });
    if (error !== null) return readCachedPressure(userId, localDate);
    // Newest first: the latest forecast of either date, so a stale row for one never hides a fresh one for the other.
    const row: unknown = data[0] ?? null;
    if (isLatest() && currentUserId() === userId) kvSet(cacheKey(userId), JSON.stringify({ localDate, row } satisfies Cached));
    return row;
  } catch {
    return readCachedPressure(userId, localDate);
  }
}

/**
 * Today's stored pressure row: the newest for the device zone's date or the profile zone's (the monitor dates rows in
 * the profile's zone, which lags when the zone sync fails), or null. A failed read falls back to the cached answer; an
 * answer that settles after the account changed is never cached, and concurrent fetches for the same days all answer
 * with the newest one's reply. Read it with `freshPressure`.
 */
export async function fetchTodayPressure(userId: string, days: readonly [string, ...string[]], client: Client = supabase): Promise<unknown> {
  const key = `${userId}/${days.join('/')}`;
  requests += 1;
  const id = requests;
  const answer = readPressure(userId, days, client, () => latest.get(key)?.id === id);
  latest.set(key, { id, answer });
  let row = await answer;
  for (let mine = id, newest = latest.get(key); newest !== undefined && newest.id !== mine; newest = latest.get(key)) {
    mine = newest.id;
    row = await newest.answer;
  }
  return row;
}
