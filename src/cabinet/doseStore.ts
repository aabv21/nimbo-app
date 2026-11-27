// Doses on the phone: the mirror rows the screens read, written together with their outbox operation.
import { randomUUID } from 'expo-crypto';
import { useCallback } from 'react';

import { checkedTime } from '../lib/local/clientTime';
import { localDb } from '../lib/local/db';
import { useLocalQuery } from '../lib/local/useLocalQuery';
import { enqueue } from '../lib/outbox/outbox';

export interface Dose {
  id: string;
  medicationId: string;
  episodeId: string | null;
  /** UTC ISO instant; the local day it falls on depends on the time zone. */
  takenAt: string;
  /** The debrief's answer; null when not asked or cleared. */
  helped: boolean | null;
  dirty: boolean;
}

interface DoseRow {
  id: string;
  medication_id: string;
  episode_id: string | null;
  taken_at: string;
  helped: number | null;
  dirty: number;
}


/**
 * Records a dose and returns its id. The id is made here unless given (a confirmed draft brings its own), so a send
 * retried after a lost reply, or a second Confirm, cannot log it twice: an id already on the phone is a no-op.
 * A time unreadable, before 2000 or more than 5 minutes ahead is a `RangeError`. Assumes an open transaction.
 */
export function logDoseTx(userId: string, input: { id?: string; medicationId: string; takenAt: Date; episodeId: string | null }): string {
  checkedTime(input.takenAt);
  const id = input.id ?? randomUUID();
  const takenAt = input.takenAt.toISOString();
  const db = localDb();
  if (db.getFirstSync('SELECT id FROM doses WHERE id = ? AND user_id = ?;', [id, userId]) !== null) return id;
  db.runSync(
    'INSERT INTO doses (id, user_id, medication_id, episode_id, taken_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?);',
    [id, userId, input.medicationId, input.episodeId, takenAt, takenAt, takenAt],
  );
  // The server's `p_episode_id` is optional, never null.
  enqueue(userId, 'log_dose', {
    p_id: id,
    p_medication_id: input.medicationId,
    p_taken_at: takenAt,
    ...(input.episodeId === null ? {} : { p_episode_id: input.episodeId }),
  });
  return id;
}

export function logDose(userId: string, input: { id?: string; medicationId: string; takenAt: Date; episodeId: string | null }): string {
  let id = '';
  localDb().withTransactionSync(() => {
    id = logDoseTx(userId, input);
  });
  return id;
}

/** Whether the dose helped; null clears the answer, sent by leaving `p_helped` out. Assumes an open transaction. */
export function setDoseHelpedTx(userId: string, doseId: string, helped: boolean | null): void {
  const db = localDb();
  const { changes } = db.runSync('UPDATE doses SET helped = ?, updated_at = ? WHERE id = ? AND user_id = ?;', [
    helped === null ? null : Number(helped),
    new Date().toISOString(),
    doseId,
    userId,
  ]);
  // Another user's or a missing dose: the server would answer P0002 for good, so nothing is queued.
  if (changes === 0) return;
  enqueue(userId, 'set_dose_helped', { p_id: doseId, ...(helped === null ? {} : { p_helped: helped }) });
}

export function setDoseHelped(userId: string, doseId: string, helped: boolean | null): void {
  localDb().withTransactionSync(() => {
    setDoseHelpedTx(userId, doseId, helped);
  });
}

export function deleteDose(userId: string, id: string): void {
  const db = localDb();
  db.withTransactionSync(() => {
    db.runSync('DELETE FROM doses WHERE id = ? AND user_id = ?;', [id, userId]);
    enqueue(userId, 'delete_dose', { p_id: id });
  });
}

/** The user's doses, newest first, optionally of one episode or one medication. */
export function useDoses(userId: string, filter: { episodeId?: string; medicationId?: string } = {}): readonly Dose[] {
  const { episodeId, medicationId } = filter;
  const read = useCallback(() => {
    const where = ['user_id = ?'];
    const params = [userId];
    if (episodeId !== undefined) {
      where.push('episode_id = ?');
      params.push(episodeId);
    }
    if (medicationId !== undefined) {
      where.push('medication_id = ?');
      params.push(medicationId);
    }
    return localDb()
      .getAllSync<DoseRow>(
        `SELECT id, medication_id, episode_id, taken_at, helped, dirty FROM doses WHERE ${where.join(' AND ')} ORDER BY taken_at DESC, id;`,
        params,
      )
      .map((row) => ({
        id: row.id,
        medicationId: row.medication_id,
        episodeId: row.episode_id,
        takenAt: row.taken_at,
        helped: row.helped === null ? null : row.helped === 1,
        dirty: row.dirty === 1,
      }));
  }, [userId, episodeId, medicationId]);
  return useLocalQuery(['doses'], read);
}
