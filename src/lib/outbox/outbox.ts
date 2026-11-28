// The persisted queue of health writes, one row per RPC call, sent in order by `runOutbox.ts`.
import type { Database } from '../database.types';
import { localDb, notifyChanged } from '../local/db';
import type { LocalTable } from '../local/db';

export type OutboxKind =
  | 'log_episode'
  | 'update_episode'
  | 'end_episode'
  | 'delete_episode'
  | 'save_medication'
  | 'log_dose'
  | 'delete_dose'
  | 'set_dose_helped'
  | 'save_checkin'
  // Idempotent on the server (`coalesce`), so a replay after a lost reply changes nothing.
  | 'complete_onboarding';

export type OutboxArgs<K extends OutboxKind> = Database['public']['Functions'][K]['Args'];

export interface OutboxOp {
  id: string;
  userId: string;
  kind: OutboxKind;
  args: unknown;
  /** The record the call writes: its `p_id`, `checkin:<local_date>`, or `profile:onboarding`. */
  recordKey: string;
  /** Sends the server answered with an error, or a kill interrupted; `MAX_ATTEMPTS` ends the operation. */
  attempts: number;
  /** Sends that got no answer (offline): they lengthen the backoff but never end the operation. */
  noResponses: number;
  nextAttemptAt: number;
  failed: boolean;
  createdAt: number;
}

interface OutboxRow {
  seq: number;
  user_id: string;
  kind: OutboxKind;
  args: string;
  record_key: string;
  attempts: number;
  no_responses: number;
  next_attempt_at: number;
  failed: number;
  created_at: number;
}

// The chat is never queued: it stays on the phone.
type MirrorTable = Exclude<LocalTable, 'outbox' | 'chat_messages'>;

const MIRROR_TABLES: readonly MirrorTable[] = ['episodes', 'medications', 'doses', 'checkins'];

const CHECKIN_PREFIX = 'checkin:';
const ONBOARDING_KEY = 'profile:onboarding';

/** The mirror table the call's row lives in; null for a profile call, which has no mirror row to mark. */
function mirrorTableOf(kind: OutboxKind): MirrorTable | null {
  switch (kind) {
    case 'log_episode':
    case 'update_episode':
    case 'end_episode':
    case 'delete_episode':
      return 'episodes';
    case 'save_medication':
      return 'medications';
    case 'log_dose':
    case 'delete_dose':
    case 'set_dose_helped':
      return 'doses';
    case 'save_checkin':
      return 'checkins';
    case 'complete_onboarding':
      return null;
  }
}

function recordKeyOf<K extends OutboxKind>(kind: K, args: OutboxArgs<K>): string {
  if ('p_local_date' in args) return `${CHECKIN_PREFIX}${args.p_local_date}`;
  if ('p_id' in args) return args.p_id;
  return ONBOARDING_KEY;
}

/** Changed tables to announce: the outbox, and the mirror table when the call has one. */
function changedTables(table: MirrorTable | null): LocalTable[] {
  return table === null ? ['outbox'] : ['outbox', table];
}

/** Sets the mirror row's `dirty` flag; a deleted row matches nothing, which is fine. */
function setDirty(userId: string, table: MirrorTable, recordKey: string, dirty: boolean): void {
  const flag = dirty ? 1 : 0;
  if (table === 'checkins') {
    localDb().runSync('UPDATE checkins SET dirty = ? WHERE user_id = ? AND local_date = ?;', [
      flag,
      userId,
      recordKey.slice(CHECKIN_PREFIX.length),
    ]);
    return;
  }
  // `table` is one of the three literals left, never input.
  localDb().runSync(`UPDATE ${table} SET dirty = ? WHERE user_id = ? AND id = ?;`, [flag, userId, recordKey]);
}

const enqueueListeners = new Set<() => void>();

/** Calls `listener` after each `enqueue`, once its transaction has committed; returns the unsubscribe. */
export function onEnqueue(listener: () => void): () => void {
  enqueueListeners.add(listener);
  return () => {
    enqueueListeners.delete(listener);
  };
}

/** Call inside the same transaction as the mirror write; marks the mirror row dirty. */
export function enqueue<K extends OutboxKind>(userId: string, kind: K, args: OutboxArgs<K>): OutboxOp {
  const recordKey = recordKeyOf(kind, args);
  const createdAt = Date.now();
  const { lastInsertRowId } = localDb().runSync(
    'INSERT INTO outbox (user_id, kind, args, record_key, created_at) VALUES (?, ?, ?, ?, ?);',
    [userId, kind, JSON.stringify(args), recordKey, createdAt],
  );
  const table = mirrorTableOf(kind);
  if (table !== null) setDirty(userId, table, recordKey, true);
  // The caller's transaction is synchronous, so a microtask runs after it commits (or rolls back).
  queueMicrotask(() => {
    notifyChanged(changedTables(table));
    for (const listener of enqueueListeners) listener();
  });
  return {
    id: String(lastInsertRowId),
    userId,
    kind,
    args,
    recordKey,
    attempts: 0,
    noResponses: 0,
    nextAttemptAt: 0,
    failed: false,
    createdAt,
  };
}

function toOp(row: OutboxRow): OutboxOp {
  return {
    id: String(row.seq),
    userId: row.user_id,
    kind: row.kind,
    args: JSON.parse(row.args) as unknown,
    recordKey: row.record_key,
    attempts: row.attempts,
    noResponses: row.no_responses,
    nextAttemptAt: row.next_attempt_at,
    failed: row.failed === 1,
    createdAt: row.created_at,
  };
}

/** `userId`'s operations in the order they were queued, failed ones included. */
export function listOutbox(userId: string): OutboxOp[] {
  return localDb()
    .getAllSync<OutboxRow>(
      'SELECT seq, user_id, kind, args, record_key, attempts, no_responses, next_attempt_at, failed, created_at FROM outbox WHERE user_id = ? ORDER BY seq;',
      [userId],
    )
    .map(toOp);
}

/** The sync banner's counts, and when the head of the queue is next due (null when nothing is pending). */
export function outboxState(userId: string): { pending: number; failed: number; headDueAt: number | null } {
  const db = localDb();
  const counts = db.getFirstSync<{ pending: number | null; failed: number | null }>(
    'SELECT SUM(failed = 0) AS pending, SUM(failed = 1) AS failed FROM outbox WHERE user_id = ?;',
    [userId],
  );
  // Sends go strictly in order, so only the first pending operation's time can unblock the queue.
  const head = db.getFirstSync<{ next_attempt_at: number }>(
    'SELECT next_attempt_at FROM outbox WHERE user_id = ? AND failed = 0 ORDER BY seq LIMIT 1;',
    [userId],
  );
  return { pending: counts?.pending ?? 0, failed: counts?.failed ?? 0, headDueAt: head?.next_attempt_at ?? null };
}

/** Record keys with an unsent operation (failed ones included): a pull must leave those rows alone. */
export function unsentRecordKeys(userId: string): Set<string> {
  const rows = localDb().getAllSync<{ record_key: string }>('SELECT DISTINCT record_key FROM outbox WHERE user_id = ?;', [
    userId,
  ]);
  return new Set(rows.map((row) => row.record_key));
}

/** When `userId`'s oldest operation of `kind` was queued, while it is unsent (failed ones included); null when none is. */
export function queuedAt(userId: string, kind: OutboxKind): number | null {
  const row = localDb().getFirstSync<{ created_at: number }>(
    'SELECT created_at FROM outbox WHERE user_id = ? AND kind = ? ORDER BY seq LIMIT 1;',
    [userId, kind],
  );
  return row?.created_at ?? null;
}

/** Saves an attempt: the claim before a send, or the outcome after it. */
export function saveAttempt(op: OutboxOp): void {
  localDb().runSync('UPDATE outbox SET attempts = ?, no_responses = ?, next_attempt_at = ?, failed = ? WHERE seq = ?;', [
    op.attempts,
    op.noResponses,
    op.nextAttemptAt,
    op.failed ? 1 : 0,
    Number(op.id),
  ]);
  notifyChanged(['outbox']);
}

/** Removes a sent operation; its row turns clean once no other operation for it is left. */
export function completeOp(op: OutboxOp): void {
  const table = mirrorTableOf(op.kind);
  const db = localDb();
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM outbox WHERE seq = ?;', [Number(op.id)]);
    const left = db.getFirstSync<{ seq: number }>('SELECT seq FROM outbox WHERE user_id = ? AND record_key = ? LIMIT 1;', [
      op.userId,
      op.recordKey,
    ]);
    if (left === null && table !== null) setDirty(op.userId, table, op.recordKey, false);
  });
  notifyChanged(changedTables(table));
}

/**
 * The network is back: an operation waiting only because its sends got no answer is due now. Its answered attempts
 * stay, and one held back by a server error keeps its backoff.
 */
export function wakeOffline(userId: string): void {
  localDb().runSync('UPDATE outbox SET next_attempt_at = 0 WHERE user_id = ? AND failed = 0 AND no_responses > 0;', [userId]);
  notifyChanged(['outbox']);
}

/**
 * Drops every operation of `userId`, failed or not, and marks their rows clean: only for an account the server deleted,
 * whose calls could never be sent.
 */
export function clearOutbox(userId: string): void {
  const db = localDb();
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM outbox WHERE user_id = ?;', [userId]);
    // Each name comes from the fixed list, never input.
    for (const table of MIRROR_TABLES) db.runSync(`UPDATE ${table} SET dirty = 0 WHERE user_id = ?;`, [userId]);
  });
  notifyChanged(['outbox', ...MIRROR_TABLES]);
}

/** "Try again": every operation of `userId`, failed or waiting out a backoff, is due now with fresh attempts. */
export function resetFailed(userId: string): void {
  localDb().runSync('UPDATE outbox SET failed = 0, attempts = 0, no_responses = 0, next_attempt_at = 0 WHERE user_id = ?;', [userId]);
  notifyChanged(['outbox']);
}
