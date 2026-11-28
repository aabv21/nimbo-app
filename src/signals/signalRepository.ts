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

/** The last online answer for `localDate`; null for another day, none, a stale forecast or a row that no longer reads as a signal. */
export function readCachedPressure(userId: string, localDate: string, now: Date = new Date()): Signal | null {
  const cached = kvGetJson(cacheKey(userId), isCached);
  return cached === null || cached.localDate !== localDate ? null : freshPressureFromRow(cached.row, now, pack);
}

/** Only the sign-out cleanup in `SyncProvider` calls this. */
export function removeCachedSignals(userId: string): void {
  kvRemove(cacheKey(userId));
}

let requests = 0;
// The newest fetch per user and day: an older reply that settles later never overwrites its answer or its cache.
// NOTE: one small entry per user and day for the app's lifetime; drop past days' keys if sessions ever last weeks.
const latest = new Map<string, { id: number; answer: Promise<Signal | null> }>();

async function readPressure(userId: string, localDate: string, client: Client, now: Date, isLatest: () => boolean): Promise<Signal | null> {
  try {
    const { data, error } = await client
      .from('signals')
      .select(COLUMNS)
      .eq('kind', 'pressure')
      .eq('local_date', localDate)
      .order('computed_at', { ascending: false })
      .limit(1);
    if (error !== null) return readCachedPressure(userId, localDate, now);
    const row: unknown = data[0] ?? null;
    if (isLatest() && currentUserId() === userId) kvSet(cacheKey(userId), JSON.stringify({ localDate, row } satisfies Cached));
    return freshPressureFromRow(row, now, pack);
  } catch {
    return readCachedPressure(userId, localDate, now);
  }
}

/**
 * The stored pressure signal for the local date while its forecast is fresh, or null. A failed read falls back to the
 * cached answer; an answer that settles after the account changed is never cached, and concurrent fetches for the same
 * day all answer with the newest one's reply.
 */
export async function fetchTodayPressure(userId: string, localDate: string, client: Client = supabase, now: Date = new Date()): Promise<Signal | null> {
  const key = `${userId}/${localDate}`;
  requests += 1;
  const id = requests;
  const answer = readPressure(userId, localDate, client, now, () => latest.get(key)?.id === id);
  latest.set(key, { id, answer });
  let signal = await answer;
  for (let mine = id, newest = latest.get(key); newest !== undefined && newest.id !== mine; newest = latest.get(key)) {
    mine = newest.id;
    signal = await newest.answer;
  }
  return signal;
}
