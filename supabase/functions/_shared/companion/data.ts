// The companion's reads, always as the caller (their token, so RLS applies) and with explicit columns,
// and the clock maths that shows times in the person's own zone.

import type { SupabaseEnv } from '../env.ts';
import { isRecord } from '../guards.ts';
import { fetchWithDeadline } from '../http.ts';
import { restJson, UpstreamError, userHeaders } from '../rest.ts';

export type Row = Record<string, unknown>;
/** Who reads: the caller's token, forwarded as given; `timeoutMs` is the next read's share of the request's budget. */
export type Caller = { supabase: SupabaseEnv; fetch: typeof fetch; auth: string; timeoutMs: () => number };

const urlOf = (caller: Caller, table: string, query: readonly (readonly [string, string])[]): string =>
  `${caller.supabase.supabaseUrl}/rest/v1/${table}?${new URLSearchParams(query.map(([key, value]) => [key, value])).toString()}`;

function rowsOf(body: unknown): Row[] {
  if (!Array.isArray(body) || !body.every(isRecord)) throw new UpstreamError('not rows');
  return body;
}

/** `table`'s rows for `query` (which names its columns in `select`); throws on any failure. */
export async function readRows(caller: Caller, table: string, query: readonly (readonly [string, string])[]): Promise<Row[]> {
  return rowsOf(await restJson(caller.fetch, urlOf(caller, table, query), { headers: userHeaders(caller.supabase, caller.auth) }, caller.timeoutMs()));
}

/** `readRows`, plus how many rows match before the `limit` (PostgREST's `Content-Range` total). */
export async function readCountedRows(caller: Caller, table: string, query: readonly (readonly [string, string])[]): Promise<{ rows: Row[]; total: number }> {
  const response = await fetchWithDeadline(
    caller.fetch,
    urlOf(caller, table, query),
    { headers: { ...userHeaders(caller.supabase, caller.auth), prefer: 'count=exact' } },
    caller.timeoutMs(),
  );
  if (!response.ok) throw new UpstreamError(`HTTP ${String(response.status)}`);
  const rows = rowsOf(await response.json());
  const total = Number(/\/(\d+)$/.exec(response.headers.get('content-range') ?? '')?.[1] ?? rows.length);
  return { rows, total };
}

export type Profile = { timeZone: string; aiEnabled: boolean };

/** The caller's `timezone` and `ai_enabled` only; null without a row. A missing or unknown zone reads as UTC. */
export async function readProfile(caller: Caller, userId: string): Promise<Profile | null> {
  const [row] = await readRows(caller, 'profiles', [
    ['select', 'timezone,ai_enabled'],
    ['user_id', `eq.${userId}`],
  ]);
  if (row === undefined) return null;
  return { timeZone: zoneOrUtc(typeof row.timezone === 'string' ? row.timezone : null), aiEnabled: row.ai_enabled === true };
}

/** The agent's notes, oldest first, at most 20 (the database's own cap). */
export async function readNotes(caller: Caller): Promise<{ id: string; text: string }[]> {
  const rows = await readRows(caller, 'agent_notes', [
    ['select', 'id,text'],
    ['order', 'created_at.asc'],
    ['limit', '20'],
  ]);
  return rows.flatMap((row) => (typeof row.id === 'string' && typeof row.text === 'string' ? [{ id: row.id, text: row.text }] : []));
}

/** An attack's stored start and end, so a draft that moves one past the other is refused. */
export type EpisodeSpan = { id: string; startedAt: string; endedAt: string | null };

const episodeSpan = (row: Row | undefined): EpisodeSpan | null =>
  row !== undefined && typeof row.id === 'string' && typeof row.started_at === 'string'
    ? { id: row.id, startedAt: row.started_at, endedAt: typeof row.ended_at === 'string' ? row.ended_at : null }
    : null;

/** The caller's attack still open (no end), the latest if several; null when none. */
export async function readOpenEpisode(caller: Caller): Promise<EpisodeSpan | null> {
  const rows = await readRows(caller, 'episodes', [
    ['select', 'id,started_at,ended_at'],
    ['ended_at', 'is.null'],
    ['order', 'started_at.desc'],
    ['limit', '1'],
  ]);
  return episodeSpan(rows[0]);
}

/** The episode when it is the caller's (RLS hides anyone else's); null otherwise. */
export async function readOwnEpisode(caller: Caller, id: string): Promise<EpisodeSpan | null> {
  const rows = await readRows(caller, 'episodes', [
    ['select', 'id,started_at,ended_at'],
    ['id', `eq.${id}`],
  ]);
  return episodeSpan(rows[0]);
}

// --- Time zones ---------------------------------------------------------------------------------

const formats = new Map<string, Intl.DateTimeFormat>();

function formatFor(timeZone: string): Intl.DateTimeFormat {
  let format = formats.get(timeZone);
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formats.set(timeZone, format);
  }
  return format;
}

/** `timeZone` when the runtime knows it, else UTC. */
export function zoneOrUtc(timeZone: string | null): string {
  if (timeZone === null || timeZone === '') return 'UTC';
  try {
    formatFor(timeZone);
    return timeZone;
  } catch {
    return 'UTC';
  }
}

/** How far `timeZone`'s wall clock is ahead of UTC at `instant`, in ms. */
function offsetMs(instant: number, timeZone: string): number {
  const parts = new Map(formatFor(timeZone).formatToParts(new Date(instant)).map((part) => [part.type, Number(part.value)]));
  const wall = Date.UTC(parts.get('year') ?? 0, (parts.get('month') ?? 1) - 1, parts.get('day') ?? 1, parts.get('hour') ?? 0, parts.get('minute') ?? 0, parts.get('second') ?? 0);
  return wall - Math.floor(instant / 1000) * 1000;
}

const pad = (value: number): string => String(value).padStart(2, '0');

/** `instant` as an ISO time on `timeZone`'s wall clock with its offset, to the second: `2026-11-20T08:30:00-05:00`. */
export function localIso(instant: number, timeZone: string): string {
  const offset = offsetMs(instant, timeZone);
  const wall = new Date(Math.floor(instant / 1000) * 1000 + offset).toISOString().slice(0, 19);
  const minutes = Math.round(Math.abs(offset) / 60_000);
  return `${wall}${offset < 0 ? '-' : '+'}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** The instant `localDate` begins in `timeZone`. */
export function zonedMidnight(localDate: string, timeZone: string): number {
  const wall = Date.parse(`${localDate}T00:00:00Z`);
  const first = wall - offsetMs(wall, timeZone);
  const second = wall - offsetMs(first, timeZone);
  return second;
}

/** `localDate` moved by `days` calendar days. */
export function addDays(localDate: string, days: number): string {
  return new Date(Date.parse(`${localDate}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export function weekdayOf(localDate: string): string {
  return WEEKDAYS[new Date(`${localDate}T00:00:00Z`).getUTCDay()] ?? 'Sunday';
}

/**
 * The numbers a reply may use to read a time back: the 24-hour hour, the 12-hour hour and the minute of
 * `instant` on `timeZone`'s clock ("15:00", "3 pm" and "8:30" are all grounded by the draft they confirm).
 */
export function clockNumbers(instant: number, timeZone: string): string[] {
  const [hour = 0, minute = 0] = localIso(instant, timeZone).slice(11, 16).split(':').map(Number);
  return [...new Set([String(hour), String(hour % 12 === 0 ? 12 : hour % 12), String(minute)])];
}

// RFC 3339 with an explicit offset, so a time is never read in the server's own zone; Date.parse checks the rest.
const STARTS_AS_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const ENDS_WITH_OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/i;

/** Epoch ms of a time the model wrote, or null unless it is a real time with an offset. */
export function parseZonedTime(value: unknown): number | null {
  if (typeof value !== 'string' || !STARTS_AS_TIME.test(value) || !ENDS_WITH_OFFSET.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}
