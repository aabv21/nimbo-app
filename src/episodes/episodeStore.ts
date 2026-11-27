// Attacks on the phone: the mirror rows the screens read, written together with their outbox operation.
import { randomUUID } from 'expo-crypto';
import { useCallback } from 'react';

import type { Json } from '../lib/database.types';
import { localDb, notifyChanged } from '../lib/local/db';
import { useLocalQuery } from '../lib/local/useLocalQuery';
import { enqueue } from '../lib/outbox/outbox';

export type EpisodeId = string;

export interface Episode {
  id: EpisodeId;
  /** UTC ISO instants. */
  startedAt: string;
  endedAt: string | null;
  intensity: number | null;
  painAreas: readonly string[];
  symptoms: readonly string[];
  triggers: readonly string[];
  reliefs: readonly string[];
  notes: string | null;
  source: 'manual' | 'voice' | 'chat';
  /** An operation for this row is still unsent. */
  dirty: boolean;
}

/** The start can be moved (people log late), never cleared. */
export type EpisodePatch = Partial<Omit<Episode, 'id' | 'source' | 'dirty'>>;

interface EpisodeRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  intensity: number | null;
  pain_areas: string;
  symptoms: string;
  triggers: string;
  reliefs: string;
  notes: string | null;
  source: Episode['source'];
  dirty: number;
}

const COLUMNS = 'id, started_at, ended_at, intensity, pain_areas, symptoms, triggers, reliefs, notes, source, dirty';

function keys(text: string): readonly string[] {
  const value: unknown = JSON.parse(text);
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function toEpisode(row: EpisodeRow): Episode {
  return {
    id: row.id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    intensity: row.intensity,
    painAreas: keys(row.pain_areas),
    symptoms: keys(row.symptoms),
    triggers: keys(row.triggers),
    reliefs: keys(row.reliefs),
    notes: row.notes,
    source: row.source,
    dirty: row.dirty === 1,
  };
}

// The server's time check (`private.check_time`): an operation it would refuse fails here, before it is queued.
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const EARLIEST_MS = Date.UTC(2000, 0, 1);

/** The instant of `value`; a `RangeError` for anything the server would refuse with 22023. */
function checkedTime(value: string | Date): number {
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms) || ms < EARLIEST_MS || ms > Date.now() + CLOCK_SKEW_MS) throw new RangeError('The time is out of range.');
  return ms;
}

/** The user's open attack (the latest, should a sync ever bring two); null when none is open. */
export function readOpenEpisode(userId: string): Episode | null {
  const row = localDb().getFirstSync<EpisodeRow>(
    `SELECT ${COLUMNS} FROM episodes WHERE user_id = ? AND ended_at IS NULL ORDER BY started_at DESC, id LIMIT 1;`,
    [userId],
  );
  return row === null ? null : toEpisode(row);
}

/**
 * Synchronous: the mirror row and the `log_episode` operation are committed before it returns, so a kill
 * right after the tap loses nothing. An open attack is returned instead of starting a second one.
 */
export function startEpisode(userId: string, now: Date = new Date()): EpisodeId {
  const db = localDb();
  let id = '';
  db.withTransactionSync(() => {
    const open = readOpenEpisode(userId);
    if (open !== null) {
      id = open.id;
      return;
    }
    // Made here, so a send replayed after a lost reply hits `on conflict (id) do nothing`.
    id = randomUUID();
    const startedAt = now.toISOString();
    db.runSync('INSERT INTO episodes (id, user_id, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?);', [
      id,
      userId,
      startedAt,
      startedAt,
      startedAt,
    ]);
    enqueue(userId, 'log_episode', { p_id: id, p_started_at: startedAt, p_fields: { source: 'manual' } });
  });
  return id;
}

/**
 * Patches only the keys present, on the phone and in the queued `update_episode` (column names, as the RPC
 * takes them). A time out of range, or an end before the start, is a `RangeError` and nothing is written.
 */
export function updateEpisode(userId: string, id: EpisodeId, patch: EpisodePatch): void {
  const fields: Record<string, Json> = {};
  if (patch.startedAt !== undefined) fields.started_at = new Date(checkedTime(patch.startedAt)).toISOString();
  if (patch.endedAt !== undefined) fields.ended_at = patch.endedAt === null ? null : new Date(checkedTime(patch.endedAt)).toISOString();
  if (patch.intensity !== undefined) fields.intensity = patch.intensity;
  if (patch.painAreas !== undefined) fields.pain_areas = [...patch.painAreas];
  if (patch.symptoms !== undefined) fields.symptoms = [...patch.symptoms];
  if (patch.triggers !== undefined) fields.triggers = [...patch.triggers];
  if (patch.reliefs !== undefined) fields.reliefs = [...patch.reliefs];
  if (patch.notes !== undefined) fields.notes = patch.notes;
  const entries = Object.entries(fields);
  if (entries.length === 0) return;

  // Arrays are JSON text in the mirror; the column names are only the fixed ones above.
  const columns = entries.map(([column]) => column);
  const values = entries.map(([, value]) => (Array.isArray(value) ? JSON.stringify(value) : (value as string | number | null)));
  const db = localDb();
  db.withTransactionSync(() => {
    const row = db.getFirstSync<{ started_at: string; ended_at: string | null }>(
      'SELECT started_at, ended_at FROM episodes WHERE id = ? AND user_id = ?;',
      [id, userId],
    );
    if (row === null) return;
    // The pair as it would be after the patch, checked as the table's `ended_at >= started_at` does.
    const start = new Date(patch.startedAt ?? row.started_at).getTime();
    const end = patch.endedAt === undefined ? row.ended_at : patch.endedAt;
    if (end !== null && new Date(end).getTime() < start) throw new RangeError('An attack cannot end before it started.');
    db.runSync(
      `UPDATE episodes SET ${columns.map((column) => `${column} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?;`,
      [...values, new Date().toISOString(), id, userId],
    );
    enqueue(userId, 'update_episode', { p_id: id, p_fields: fields });
  });
}

/** Ends the attack. A time out of range or before the start is a `RangeError` here rather than a refusal on the server. */
export function endEpisode(userId: string, id: EpisodeId, endedAt: Date): void {
  checkedTime(endedAt);
  const db = localDb();
  db.withTransactionSync(() => {
    const row = db.getFirstSync<{ started_at: string }>('SELECT started_at FROM episodes WHERE id = ? AND user_id = ?;', [id, userId]);
    if (row === null) return;
    if (endedAt.getTime() < new Date(row.started_at).getTime()) throw new RangeError('An attack cannot end before it started.');
    const iso = endedAt.toISOString();
    db.runSync('UPDATE episodes SET ended_at = ?, updated_at = ? WHERE id = ? AND user_id = ?;', [iso, iso, id, userId]);
    enqueue(userId, 'end_episode', { p_id: id, p_ended_at: iso });
  });
}

/** Deletes the attack; its doses stay, unlinked, as the server's `on delete set null` leaves them. */
export function deleteEpisode(userId: string, id: EpisodeId): void {
  const db = localDb();
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM episodes WHERE id = ? AND user_id = ?;', [id, userId]);
    db.runSync('UPDATE doses SET episode_id = NULL WHERE episode_id = ? AND user_id = ?;', [id, userId]);
    enqueue(userId, 'delete_episode', { p_id: id });
  });
  notifyChanged(['doses']);
}

/** The user's attacks, newest first. */
export function useEpisodes(userId: string): readonly Episode[] {
  const read = useCallback(
    () =>
      localDb()
        .getAllSync<EpisodeRow>(`SELECT ${COLUMNS} FROM episodes WHERE user_id = ? ORDER BY started_at DESC, id;`, [userId])
        .map(toEpisode),
    [userId],
  );
  return useLocalQuery(['episodes'], read);
}

/** One of the user's attacks; null when it is not on this phone. */
export function useEpisode(userId: string, id: EpisodeId): Episode | null {
  const read = useCallback(() => {
    const row = localDb().getFirstSync<EpisodeRow>(`SELECT ${COLUMNS} FROM episodes WHERE id = ? AND user_id = ?;`, [id, userId]);
    return row === null ? null : toEpisode(row);
  }, [userId, id]);
  return useLocalQuery(['episodes'], read);
}

export function useOpenEpisode(userId: string): Episode | null {
  const read = useCallback(() => readOpenEpisode(userId), [userId]);
  return useLocalQuery(['episodes'], read);
}
