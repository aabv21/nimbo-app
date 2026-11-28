// The on-phone store: a mirror of the user's health rows, read by the screens, and the outbox of writes
// still to send. Every row carries its `user_id`, so two accounts on one phone never share a read.
import { openDatabaseSync } from 'expo-sqlite';
import type { SQLiteDatabase } from 'expo-sqlite';

export type LocalTable = 'episodes' | 'medications' | 'doses' | 'checkins' | 'outbox';

/** `PRAGMA user_version`: a later schema change migrates from it. */
const SCHEMA_VERSION = 1;

// Mirror columns are the server's (see supabase/migrations); arrays are JSON text, booleans 0 or 1.
// `dirty` is 1 while an outbox operation for the row is unsent, so a pull never overwrites it.
const SCHEMA_V1 = `
  CREATE TABLE episodes (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    condition TEXT NOT NULL DEFAULT 'migraine',
    started_at TEXT NOT NULL,
    ended_at TEXT,
    intensity INTEGER,
    pain_areas TEXT NOT NULL DEFAULT '[]',
    symptoms TEXT NOT NULL DEFAULT '[]',
    triggers TEXT NOT NULL DEFAULT '[]',
    reliefs TEXT NOT NULL DEFAULT '[]',
    notes TEXT,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT,
    updated_at TEXT,
    dirty INTEGER NOT NULL DEFAULT 0 CHECK (dirty IN (0, 1))
  );
  CREATE INDEX episodes_user_started_idx ON episodes (user_id, started_at);
  CREATE TABLE medications (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    form TEXT NOT NULL DEFAULT 'oral',
    class TEXT NOT NULL,
    dose_text TEXT,
    min_interval_minutes INTEGER,
    schedule TEXT,
    schedule_time TEXT,
    schedule_anchor TEXT,
    archived_at TEXT,
    created_at TEXT,
    updated_at TEXT,
    dirty INTEGER NOT NULL DEFAULT 0 CHECK (dirty IN (0, 1))
  );
  CREATE INDEX medications_user_idx ON medications (user_id);
  CREATE TABLE doses (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    medication_id TEXT NOT NULL,
    episode_id TEXT,
    taken_at TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT,
    dirty INTEGER NOT NULL DEFAULT 0 CHECK (dirty IN (0, 1))
  );
  CREATE INDEX doses_user_taken_idx ON doses (user_id, taken_at);
  CREATE TABLE checkins (
    user_id TEXT NOT NULL,
    local_date TEXT NOT NULL,
    sleep_band TEXT,
    sleep_quality TEXT,
    stress TEXT,
    low_water INTEGER NOT NULL DEFAULT 0 CHECK (low_water IN (0, 1)),
    extra_caffeine INTEGER NOT NULL DEFAULT 0 CHECK (extra_caffeine IN (0, 1)),
    alcohol INTEGER NOT NULL DEFAULT 0 CHECK (alcohol IN (0, 1)),
    skipped_meal INTEGER NOT NULL DEFAULT 0 CHECK (skipped_meal IN (0, 1)),
    screen_heavy INTEGER NOT NULL DEFAULT 0 CHECK (screen_heavy IN (0, 1)),
    period_started INTEGER NOT NULL DEFAULT 0 CHECK (period_started IN (0, 1)),
    created_at TEXT,
    updated_at TEXT,
    dirty INTEGER NOT NULL DEFAULT 0 CHECK (dirty IN (0, 1)),
    PRIMARY KEY (user_id, local_date)
  );
  CREATE TABLE outbox (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    args TEXT NOT NULL,
    record_key TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    no_responses INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    failed INTEGER NOT NULL DEFAULT 0 CHECK (failed IN (0, 1)),
    created_at INTEGER NOT NULL
  );
  CREATE INDEX outbox_user_idx ON outbox (user_id, seq);
`;

let db: SQLiteDatabase | null = null;

function migrate(database: SQLiteDatabase): void {
  const version = database.getFirstSync<{ user_version: number }>('PRAGMA user_version;')?.user_version ?? 0;
  if (version >= SCHEMA_VERSION) return;
  database.execSync("PRAGMA journal_mode = 'wal';");
  database.withTransactionSync(() => {
    database.execSync(SCHEMA_V1);
    database.execSync(`PRAGMA user_version = ${String(SCHEMA_VERSION)};`);
  });
}

/** `nimbo.db`, opened and migrated on first use rather than at import, so a screen that never syncs pays nothing. */
export function localDb(): SQLiteDatabase {
  if (db === null) {
    const opened = openDatabaseSync('nimbo.db');
    migrate(opened);
    db = opened;
  }
  return db;
}

const MIRROR_TABLES = ['episodes', 'medications', 'doses', 'checkins'] as const;

/**
 * Deletes `userId`'s mirror rows, for a sign-out or another account, except those still waiting to be sent: a row
 * marked dirty or with an operation queued (unsent or failed) stays until that user is back to send it, and the pull
 * brings the rest back then. Returns whether nothing of theirs is left queued.
 */
export function purgeUser(userId: string): boolean {
  const db = localDb();
  let queued = false;
  // Synchronous from the read of the queue to the deletes, so no write lands in between.
  db.withTransactionSync(() => {
    queued = db.getFirstSync('SELECT seq FROM outbox WHERE user_id = ? LIMIT 1;', [userId]) !== null;
    const waiting = 'SELECT record_key FROM outbox WHERE user_id = ?';
    // Each name comes from the fixed list above; a check-in's record key is `checkin:<local_date>`.
    for (const table of MIRROR_TABLES) {
      const key = table === 'checkins' ? "'checkin:' || local_date" : 'id';
      db.runSync(`DELETE FROM ${table} WHERE user_id = ? AND dirty = 0 AND ${key} NOT IN (${waiting});`, [userId, userId]);
    }
  });
  notifyChanged(MIRROR_TABLES);
  return !queued;
}

/** At launch: purges every user but `keepUserId`, which covers a sign-out made while the app was closed (or a row left by one). */
export function purgeOtherUsers(keepUserId: string | null): void {
  const users = localDb().getAllSync<{ user_id: string }>(
    'SELECT user_id FROM episodes UNION SELECT user_id FROM medications UNION SELECT user_id FROM doses UNION SELECT user_id FROM checkins;',
  );
  for (const { user_id: userId } of users) {
    if (userId !== keepUserId) purgeUser(userId);
  }
}

const listeners = new Map<LocalTable, Set<() => void>>();
const versions = new Map<LocalTable, number>();

/** Bumped by every `notifyChanged`, so a read can tell whether its tables changed since it ran. */
export function tableVersion(table: LocalTable): number {
  return versions.get(table) ?? 0;
}

/** Calls `listener` after any change to one of `tables`; returns the unsubscribe. */
export function subscribeTables(tables: readonly LocalTable[], listener: () => void): () => void {
  for (const table of tables) {
    let set = listeners.get(table);
    if (set === undefined) {
      set = new Set();
      listeners.set(table, set);
    }
    set.add(listener);
  }
  return () => {
    for (const table of tables) listeners.get(table)?.delete(listener);
  };
}

/** Call after a committed write, so every `useLocalQuery` over those tables reads again. */
export function notifyChanged(tables: readonly LocalTable[]): void {
  const due = new Set<() => void>();
  for (const table of tables) {
    versions.set(table, tableVersion(table) + 1);
    for (const listener of listeners.get(table) ?? []) due.add(listener);
  }
  for (const listener of due) listener();
}
