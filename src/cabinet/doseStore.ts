// Doses on the phone: the mirror rows the screens read, written together with their outbox operation.
import { randomUUID } from 'expo-crypto';
import { useCallback } from 'react';

import { localDb } from '../lib/local/db';
import { useLocalQuery } from '../lib/local/useLocalQuery';
import { enqueue } from '../lib/outbox/outbox';

export interface Dose {
  id: string;
  medicationId: string;
  episodeId: string | null;
  /** UTC ISO instant; the local day it falls on depends on the time zone. */
  takenAt: string;
  dirty: boolean;
}

interface DoseRow {
  id: string;
  medication_id: string;
  episode_id: string | null;
  taken_at: string;
  dirty: number;
}

/** Records a dose and returns its id. The id is made here so a send retried after a lost reply cannot log it twice. */
export function logDose(userId: string, input: { medicationId: string; takenAt: Date; episodeId: string | null }): string {
  const id = randomUUID();
  const takenAt = input.takenAt.toISOString();
  const db = localDb();
  db.withTransactionSync(() => {
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
  });
  return id;
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
        `SELECT id, medication_id, episode_id, taken_at, dirty FROM doses WHERE ${where.join(' AND ')} ORDER BY taken_at DESC, id;`,
        params,
      )
      .map((row) => ({
        id: row.id,
        medicationId: row.medication_id,
        episodeId: row.episode_id,
        takenAt: row.taken_at,
        dirty: row.dirty === 1,
      }));
  }, [userId, episodeId, medicationId]);
  return useLocalQuery(['doses'], read);
}
