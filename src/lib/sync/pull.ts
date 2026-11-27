// Refreshes the local mirror from the server: every row of the user, table by table, then one local write.
// NOTE: a full pull suits a few thousand rows per user; upgrade: incremental pull on `updated_at` plus tombstones once a pull takes seconds.
import type { Client } from '../../auth/emailAuth';
import { localDb, notifyChanged } from '../local/db';
import { unsentRecordKeys } from '../outbox/outbox';
import { toRequestErrorKind, toThrownErrorKind } from '../requestResult';
import type { RequestResult } from '../requestResult';
import { supabase } from '../supabase';

type PulledTable = 'episodes' | 'medications' | 'doses' | 'checkins';
type Row = Record<string, unknown>;

/** Explicit on purpose, never `*`: a column added on the server reaches the phone only once it is listed here. */
export const PULL_COLUMNS: Record<PulledTable, string> = {
  episodes:
    'id,user_id,condition,started_at,ended_at,intensity,pain_areas,symptoms,triggers,reliefs,notes,source,helped,did_not_help,debriefed_at,created_at,updated_at',
  medications:
    'id,user_id,name,kind,form,class,dose_text,min_interval_minutes,schedule,schedule_time,schedule_anchor,archived_at,created_at,updated_at',
  doses: 'id,user_id,medication_id,episode_id,taken_at,helped,created_at,updated_at',
  checkins:
    'user_id,local_date,sleep_band,sleep_quality,stress,low_water,extra_caffeine,alcohol,skipped_meal,screen_heavy,period_started,created_at,updated_at',
};

const TABLES: readonly PulledTable[] = ['episodes', 'medications', 'doses', 'checkins'];

/** The API's `max_rows` (supabase/config.toml): a shorter page is the last one. */
const PAGE_SIZE = 1000;

function columnsOf(table: PulledTable): string[] {
  return columnsText(table).split(',');
}

function columnsText(table: PulledTable): string {
  switch (table) {
    case 'episodes':
      return PULL_COLUMNS.episodes;
    case 'medications':
      return PULL_COLUMNS.medications;
    case 'doses':
      return PULL_COLUMNS.doses;
    case 'checkins':
      return PULL_COLUMNS.checkins;
  }
}

/** The outbox's record key for a row: its id, or `checkin:<local_date>`. */
function keyOf(table: PulledTable, row: Row): string {
  return table === 'checkins' ? `checkin:${String(row['local_date'])}` : String(row['id']);
}

/** A server value as SQLite stores it: arrays as JSON text, booleans as 0 or 1. */
function toLocal(value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' || typeof value === 'string') return value;
  return JSON.stringify(value);
}

async function fetchTable(client: Client, table: PulledTable, userId: string): Promise<RequestResult<Row[]>> {
  const rows: Row[] = [];
  // Ordered by the primary key so pages neither skip nor repeat a row.
  const order = table === 'checkins' ? 'local_date' : 'id';
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error, status } = await client
      .from(table)
      .select(columnsText(table))
      .eq('user_id', userId)
      .order(order)
      .range(from, from + PAGE_SIZE - 1);
    if (error !== null) return { ok: false, kind: toRequestErrorKind(error, status) };
    const page = data as unknown as Row[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return { ok: true, value: rows };
  }
}

/** Mirrors `serverRows` for `userId`, leaving alone every row with an unsent operation and other users' rows. */
function writeTable(table: PulledTable, userId: string, serverRows: readonly Row[], unsent: ReadonlySet<string>): void {
  const db = localDb();
  const keyColumn = table === 'checkins' ? 'local_date' : 'id';
  const serverKeys = new Set(serverRows.map((row) => keyOf(table, row)));

  // `table` and `keyColumn` come from the fixed lists above, never from input.
  const local = db.getAllSync<{ key: string; dirty: number }>(
    `SELECT ${keyColumn} AS key, dirty FROM ${table} WHERE user_id = ?;`,
    [userId],
  );
  const dirty = new Set<string>();
  for (const row of local) {
    const key = table === 'checkins' ? `checkin:${row.key}` : row.key;
    if (row.dirty === 1) {
      dirty.add(key);
    } else if (!unsent.has(key) && !serverKeys.has(key)) {
      db.runSync(`DELETE FROM ${table} WHERE user_id = ? AND ${keyColumn} = ?;`, [userId, row.key]);
    }
  }

  const columns = columnsOf(table);
  const insert = `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}, dirty) VALUES (${columns.map(() => '?').join(', ')}, 0);`;
  for (const row of serverRows) {
    const key = keyOf(table, row);
    if (row['user_id'] !== userId || dirty.has(key) || unsent.has(key)) continue;
    const values = new Map(Object.entries(row));
    db.runSync(
      insert,
      columns.map((column) => toLocal(values.get(column))),
    );
  }
}

/** Full pull per table with an explicit column list; replaces the user's non-dirty mirror rows. */
export async function pullAll(userId: string, client: Client = supabase): Promise<RequestResult<void>> {
  const fetched = new Map<PulledTable, Row[]>();
  try {
    for (const table of TABLES) {
      const result = await fetchTable(client, table, userId);
      if (!result.ok) return result;
      fetched.set(table, result.value);
    }
  } catch (error) {
    return { ok: false, kind: toThrownErrorKind(error) };
  }

  // Read after the fetch, in the same transaction as the write: an enqueue made while the pull was out is seen.
  localDb().withTransactionSync(() => {
    const unsent = unsentRecordKeys(userId);
    for (const table of TABLES) writeTable(table, userId, fetched.get(table) ?? [], unsent);
  });
  notifyChanged(TABLES);
  return { ok: true, value: undefined };
}
