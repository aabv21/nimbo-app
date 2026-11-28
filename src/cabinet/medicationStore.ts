// The medicine cabinet on the phone: mirror rows the screens read, written together with their outbox operation.
import { useCallback } from 'react';

import type { MedicationClass } from '../condition';
import { localDb } from '../lib/local/db';
import { useLocalQuery } from '../lib/local/useLocalQuery';
import { enqueue } from '../lib/outbox/outbox';

export interface Medication {
  id: string;
  name: string;
  kind: 'preventive' | 'acute';
  form: 'oral' | 'injection' | 'nasal' | 'other';
  medicationClass: MedicationClass;
  doseText: string | null;
  minIntervalMinutes: number | null;
  schedule: 'daily' | 'monthly' | 'quarterly' | null;
  /** `HH:MM:SS`, as the server returns a `time`. */
  scheduleTime: string | null;
  /** `YYYY-MM-DD`: the first day of a monthly or quarterly schedule. */
  scheduleAnchor: string | null;
  archived: boolean;
  /** An operation for this row is still unsent. */
  dirty: boolean;
}

/** What the form edits: the interval is in hours, as people read it on a leaflet. */
export interface MedicationInput {
  name: string;
  kind: Medication['kind'];
  form: Medication['form'];
  medicationClass: MedicationClass;
  doseText: string | null;
  minIntervalHours: number | null;
  schedule: Medication['schedule'];
  scheduleTime: string | null;
  scheduleAnchor: string | null;
  archived: boolean;
}

interface MedicationRow {
  id: string;
  name: string;
  kind: Medication['kind'];
  form: Medication['form'];
  class: MedicationClass;
  dose_text: string | null;
  min_interval_minutes: number | null;
  schedule: Medication['schedule'];
  schedule_time: string | null;
  schedule_anchor: string | null;
  archived_at: string | null;
  dirty: number;
}

const COLUMNS =
  'id, name, kind, form, class, dose_text, min_interval_minutes, schedule, schedule_time, schedule_anchor, archived_at, dirty';

function toMedication(row: MedicationRow): Medication {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    form: row.form,
    medicationClass: row.class,
    doseText: row.dose_text,
    minIntervalMinutes: row.min_interval_minutes,
    schedule: row.schedule,
    scheduleTime: row.schedule_time,
    scheduleAnchor: row.schedule_anchor,
    archived: row.archived_at !== null,
    dirty: row.dirty === 1,
  };
}

/** The server's limits on the two free-text columns. */
export const NAME_MAX_LENGTH = 80;
export const DOSE_MAX_LENGTH = 120;

/**
 * Creates or edits a medication: the mirror row and the `save_medication` call commit together. The name is trimmed;
 * an empty or overlong name, or an overlong dose, is a `RangeError` and nothing is written (the server would refuse it for good).
 */
export function saveMedication(userId: string, id: string, input: MedicationInput): void {
  const fields = { ...input, name: input.name.trim() };
  if (fields.name.length === 0 || fields.name.length > NAME_MAX_LENGTH) throw new RangeError('The name is empty or too long.');
  if (fields.doseText !== null && fields.doseText.length > DOSE_MAX_LENGTH) throw new RangeError('The dose is too long.');
  const minutes = fields.minIntervalHours === null ? null : Math.round(fields.minIntervalHours * 60);
  const db = localDb();
  db.withTransactionSync(() => {
    const now = new Date().toISOString();
    const existing = db.getFirstSync<{ archived_at: string | null }>(
      'SELECT archived_at FROM medications WHERE id = ? AND user_id = ?;',
      [id, userId],
    );
    // An earlier archive stamp stays, as on the server.
    const archivedAt = fields.archived ? (existing?.archived_at ?? now) : null;
    db.runSync(
      `INSERT INTO medications (id, user_id, name, kind, form, class, dose_text, min_interval_minutes, schedule, schedule_time, schedule_anchor, archived_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, kind = excluded.kind, form = excluded.form, class = excluded.class,
         dose_text = excluded.dose_text, min_interval_minutes = excluded.min_interval_minutes, schedule = excluded.schedule,
         schedule_time = excluded.schedule_time, schedule_anchor = excluded.schedule_anchor, archived_at = excluded.archived_at,
         updated_at = excluded.updated_at
       WHERE medications.user_id = excluded.user_id;`,
      [
        id,
        userId,
        fields.name,
        fields.kind,
        fields.form,
        fields.medicationClass,
        fields.doseText,
        minutes,
        fields.schedule,
        fields.scheduleTime,
        fields.scheduleAnchor,
        archivedAt,
        now,
        now,
      ],
    );
    enqueue(userId, 'save_medication', {
      p_id: id,
      p_fields: {
        name: fields.name,
        kind: fields.kind,
        form: fields.form,
        class: fields.medicationClass,
        dose_text: fields.doseText,
        min_interval_minutes: minutes,
        schedule: fields.schedule,
        schedule_time: fields.scheduleTime,
        schedule_anchor: fields.scheduleAnchor,
        archived: fields.archived,
      },
    });
  });
}

/** The user's medications by name; archived ones only when asked (they still own past doses). */
export function useMedications(userId: string, options: { includeArchived?: boolean } = {}): readonly Medication[] {
  const includeArchived = options.includeArchived === true;
  const read = useCallback(
    () =>
      localDb()
        .getAllSync<MedicationRow>(
          `SELECT ${COLUMNS} FROM medications WHERE user_id = ?${includeArchived ? '' : ' AND archived_at IS NULL'} ORDER BY name COLLATE NOCASE, id;`,
          [userId],
        )
        .map(toMedication),
    [userId, includeArchived],
  );
  return useLocalQuery(['medications'], read);
}

/** One of the user's medications, archived or not; undefined when it is not on this phone. */
export function useMedication(userId: string, id: string): Medication | undefined {
  const read = useCallback(() => {
    const row = localDb().getFirstSync<MedicationRow>(`SELECT ${COLUMNS} FROM medications WHERE user_id = ? AND id = ?;`, [userId, id]);
    return row === null ? undefined : toMedication(row);
  }, [userId, id]);
  return useLocalQuery(['medications'], read);
}
