// Attacks on the phone: the mirror rows the screens read, written together with their outbox operation.
import { randomUUID } from 'expo-crypto';
import { useCallback } from 'react';

import { setDoseHelpedTx } from '../cabinet/doseStore';
import { catalogKeys, packs } from '../condition';
import type { CatalogName } from '../condition';
import type { Json } from '../lib/database.types';
import { checkedTime } from '../lib/local/clientTime';
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
  /** Relief keys from the debrief. */
  helped: readonly string[];
  didNotHelp: readonly string[];
  /** When the user first finished the debrief; null until then. */
  debriefedAt: string | null;
  /** An operation for this row is still unsent. */
  dirty: boolean;
}

/**
 * The start can be moved (people log late), never cleared. `debriefed: true` stamps `debriefedAt` once (a repeat
 * keeps the first time) and `false` clears it, as the server does.
 */
export type EpisodePatch = Partial<Omit<Episode, 'id' | 'source' | 'dirty' | 'debriefedAt'>> & { debriefed?: boolean };

/** A whole attack told to the companion, logged at once with an id made beforehand. */
export type EpisodeInput = Omit<EpisodePatch, 'startedAt' | 'endedAt' | 'helped' | 'didNotHelp' | 'debriefed'> & {
  startedAt: string;
  endedAt: string | null;
  source: 'chat' | 'voice';
};

export interface DebriefAnswers {
  helped: readonly string[];
  didNotHelp: readonly string[];
  /** Added to the attack's triggers, never replacing them. */
  triggers: readonly string[];
  /** Dose id → whether it helped. */
  doseHelped: Readonly<Record<string, boolean>>;
}

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
  helped: string;
  did_not_help: string;
  debriefed_at: string | null;
  dirty: number;
}

const COLUMNS =
  'id, started_at, ended_at, intensity, pain_areas, symptoms, triggers, reliefs, notes, source, helped, did_not_help, debriefed_at, dirty';

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
    helped: keys(row.helped),
    didNotHelp: keys(row.did_not_help),
    debriefedAt: row.debriefed_at,
    dirty: row.dirty === 1,
  };
}

/** The server's `char_length(notes) <= 2000`; UTF-16 units count at least as many, so this never lets a refused note through. */
export const NOTES_MAX_LENGTH = 2000;


/** The server's `is_catalog_subset`: a key outside the pack or a repeated one is a `RangeError`. */
function checkedKeys(values: readonly string[], catalog: CatalogName): string[] {
  const allowed = new Set(catalogKeys(packs.migraine, catalog));
  if (new Set(values).size !== values.length || values.some((value) => !allowed.has(value))) {
    throw new RangeError(`A ${catalog} key is not in the pack.`);
  }
  return [...values];
}

/**
 * The patch as the RPC takes it (column names; `debriefed` as is), checked as the server would: a time out of range,
 * notes over `NOTES_MAX_LENGTH`, an intensity outside 0–10 or a key outside the pack is a `RangeError`.
 */
function fieldsOf(patch: EpisodePatch): Record<string, Json> {
  if (typeof patch.notes === 'string' && patch.notes.length > NOTES_MAX_LENGTH) throw new RangeError('The notes are too long.');
  const { intensity } = patch;
  if (intensity != null && !(Number.isInteger(intensity) && intensity >= 0 && intensity <= 10)) {
    throw new RangeError('The intensity is out of range.');
  }
  const fields: Record<string, Json> = {};
  if (patch.startedAt !== undefined) fields.started_at = new Date(checkedTime(patch.startedAt)).toISOString();
  if (patch.endedAt !== undefined) fields.ended_at = patch.endedAt === null ? null : new Date(checkedTime(patch.endedAt)).toISOString();
  if (intensity !== undefined) fields.intensity = intensity;
  if (patch.painAreas !== undefined) fields.pain_areas = checkedKeys(patch.painAreas, 'painAreas');
  if (patch.symptoms !== undefined) fields.symptoms = checkedKeys(patch.symptoms, 'symptoms');
  if (patch.triggers !== undefined) fields.triggers = checkedKeys(patch.triggers, 'triggers');
  if (patch.reliefs !== undefined) fields.reliefs = checkedKeys(patch.reliefs, 'reliefs');
  if (patch.notes !== undefined) fields.notes = patch.notes;
  if (patch.helped !== undefined) fields.helped = checkedKeys(patch.helped, 'reliefs');
  if (patch.didNotHelp !== undefined) fields.did_not_help = checkedKeys(patch.didNotHelp, 'reliefs');
  if (patch.debriefed !== undefined) fields.debriefed = patch.debriefed;
  return fields;
}

/** A value as the mirror stores it: arrays as JSON text. */
function toMirror(value: Json): string | number | null {
  return Array.isArray(value) ? JSON.stringify(value) : (value as string | number | null);
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
 * takes them). A value `fieldsOf` refuses or an end before the start is a `RangeError` and nothing is written:
 * the server would refuse the whole patch for good. Assumes an open transaction; a missing or foreign id is a no-op.
 */
export function updateEpisodeTx(userId: string, id: EpisodeId, patch: EpisodePatch): void {
  const fields = fieldsOf(patch);
  if (Object.keys(fields).length === 0) return;
  const db = localDb();
  const row = db.getFirstSync<{ started_at: string; ended_at: string | null; debriefed_at: string | null }>(
    'SELECT started_at, ended_at, debriefed_at FROM episodes WHERE id = ? AND user_id = ?;',
    [id, userId],
  );
  if (row === null) return;
  // The pair as it would be after the patch, checked as the table's `ended_at >= started_at` does.
  const start = new Date(patch.startedAt ?? row.started_at).getTime();
  const end = patch.endedAt === undefined ? row.ended_at : patch.endedAt;
  if (end !== null && new Date(end).getTime() < start) throw new RangeError('An attack cannot end before it started.');

  const now = new Date().toISOString();
  // The column names are only the fixed ones `fieldsOf` writes; `debriefed` lands in `debriefed_at`.
  const mirror = Object.entries(fields).map(([column, value]): [string, string | number | null] =>
    column === 'debriefed' ? ['debriefed_at', value === true ? (row.debriefed_at ?? now) : null] : [column, toMirror(value)],
  );
  db.runSync(
    `UPDATE episodes SET ${mirror.map(([column]) => `${column} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND user_id = ?;`,
    [...mirror.map(([, value]) => value), now, id, userId],
  );
  enqueue(userId, 'update_episode', { p_id: id, p_fields: fields });
}

export function updateEpisode(userId: string, id: EpisodeId, patch: EpisodePatch): void {
  localDb().withTransactionSync(() => {
    updateEpisodeTx(userId, id, patch);
  });
}

/**
 * Ends the attack. A time out of range or before the start is a `RangeError` here rather than a refusal on the server.
 * Assumes an open transaction.
 */
export function endEpisodeTx(userId: string, id: EpisodeId, endedAt: Date): void {
  checkedTime(endedAt);
  const db = localDb();
  const row = db.getFirstSync<{ started_at: string }>('SELECT started_at FROM episodes WHERE id = ? AND user_id = ?;', [id, userId]);
  if (row === null) return;
  if (endedAt.getTime() < new Date(row.started_at).getTime()) throw new RangeError('An attack cannot end before it started.');
  const iso = endedAt.toISOString();
  db.runSync('UPDATE episodes SET ended_at = ?, updated_at = ? WHERE id = ? AND user_id = ?;', [iso, iso, id, userId]);
  enqueue(userId, 'end_episode', { p_id: id, p_ended_at: iso });
}

export function endEpisode(userId: string, id: EpisodeId, endedAt: Date): void {
  localDb().withTransactionSync(() => {
    endEpisodeTx(userId, id, endedAt);
  });
}

/**
 * Mirror + `log_episode` with the given id, so a Confirm tapped twice or replayed logs once (an id already on the
 * phone is a no-op, as the server's `on conflict (id) do nothing` is). `fieldsOf`'s `RangeError`s apply, plus an end
 * before the start and an open attack (`endedAt` null) while another is open. Assumes an open transaction.
 */
export function logEpisodeTx(userId: string, id: EpisodeId, input: EpisodeInput): void {
  const { startedAt, endedAt, source, ...rest } = input;
  const start = checkedTime(startedAt);
  if (endedAt !== null && checkedTime(endedAt) < start) throw new RangeError('An attack cannot end before it started.');
  const fields = fieldsOf(rest);
  const db = localDb();
  if (db.getFirstSync('SELECT id FROM episodes WHERE id = ? AND user_id = ?;', [id, userId]) !== null) return;
  if (endedAt === null && readOpenEpisode(userId) !== null) throw new RangeError('An attack is already open.');

  const startIso = new Date(start).toISOString();
  const endIso = endedAt === null ? null : new Date(endedAt).toISOString();
  const now = new Date().toISOString();
  const entries = Object.entries(fields);
  // The column names are only the fixed ones `fieldsOf` writes.
  db.runSync(
    `INSERT INTO episodes (id, user_id, started_at, ended_at, source, ${entries.map(([column]) => `${column}, `).join('')}created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ${entries.map(() => '?, ').join('')}?, ?);`,
    [id, userId, startIso, endIso, source, ...entries.map(([, value]) => toMirror(value)), now, now],
  );
  enqueue(userId, 'log_episode', {
    p_id: id,
    p_started_at: startIso,
    p_fields: { ...(endIso === null ? {} : { ended_at: endIso }), ...fields, source },
  });
}

export function logEpisode(userId: string, id: EpisodeId, input: EpisodeInput): void {
  localDb().withTransactionSync(() => {
    logEpisodeTx(userId, id, input);
  });
}

/**
 * The day-after answers: the reliefs, the triggers added to those already logged, `debriefed: true` and whether each
 * dose helped, all or nothing. Assumes an open transaction; another user's attack is a no-op.
 */
export function saveDebriefTx(userId: string, episodeId: EpisodeId, answers: DebriefAnswers): void {
  const added = checkedKeys([...new Set(answers.triggers)], 'triggers');
  const row = localDb().getFirstSync<{ triggers: string }>('SELECT triggers FROM episodes WHERE id = ? AND user_id = ?;', [
    episodeId,
    userId,
  ]);
  if (row === null) return;
  updateEpisodeTx(userId, episodeId, {
    helped: answers.helped,
    didNotHelp: answers.didNotHelp,
    triggers: [...new Set([...keys(row.triggers), ...added])],
    debriefed: true,
  });
  for (const [doseId, helped] of Object.entries(answers.doseHelped)) setDoseHelpedTx(userId, doseId, helped);
}

export function saveDebrief(userId: string, episodeId: EpisodeId, answers: DebriefAnswers): void {
  localDb().withTransactionSync(() => {
    saveDebriefTx(userId, episodeId, answers);
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
