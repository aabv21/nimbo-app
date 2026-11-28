// The daily check-in on the phone: one mirror row per local date, written together with its outbox operation.
import { useCallback } from 'react';

import type { Json } from '../lib/database.types';
import { localDb } from '../lib/local/db';
import { useLocalQuery } from '../lib/local/useLocalQuery';
import { enqueue } from '../lib/outbox/outbox';

export type SleepBand = 'lt5' | '5_6' | '6_7' | '7_8' | 'gt8';

export interface Checkin {
  localDate: string;
  sleepBand: SleepBand | null;
  sleepQuality: 'bad' | 'ok' | 'good' | null;
  stress: 'low' | 'mid' | 'high' | null;
  lowWater: boolean;
  extraCaffeine: boolean;
  alcohol: boolean;
  skippedMeal: boolean;
  screenHeavy: boolean;
  periodStarted: boolean;
  /** An operation for this row is still unsent. */
  dirty: boolean;
}

export type CheckinFields = Partial<Omit<Checkin, 'localDate' | 'dirty'>>;

interface CheckinRow {
  local_date: string;
  sleep_band: SleepBand | null;
  sleep_quality: Checkin['sleepQuality'];
  stress: Checkin['stress'];
  low_water: number;
  extra_caffeine: number;
  alcohol: number;
  skipped_meal: number;
  screen_heavy: number;
  period_started: number;
  dirty: number;
}

const COLUMNS =
  'local_date, sleep_band, sleep_quality, stress, low_water, extra_caffeine, alcohol, skipped_meal, screen_heavy, period_started, dirty';

/** The column (and RPC key) of each field; the only names that ever reach the SQL text. */
const COLUMN_OF: Readonly<Record<keyof CheckinFields, string>> = {
  sleepBand: 'sleep_band',
  sleepQuality: 'sleep_quality',
  stress: 'stress',
  lowWater: 'low_water',
  extraCaffeine: 'extra_caffeine',
  alcohol: 'alcohol',
  skippedMeal: 'skipped_meal',
  screenHeavy: 'screen_heavy',
  periodStarted: 'period_started',
};

const FIELD_NAMES = Object.keys(COLUMN_OF) as (keyof CheckinFields)[];

function toCheckin(row: CheckinRow): Checkin {
  return {
    localDate: row.local_date,
    sleepBand: row.sleep_band,
    sleepQuality: row.sleep_quality,
    stress: row.stress,
    lowWater: row.low_water === 1,
    extraCaffeine: row.extra_caffeine === 1,
    alcohol: row.alcohol === 1,
    skippedMeal: row.skipped_meal === 1,
    screenHeavy: row.screen_heavy === 1,
    periodStarted: row.period_started === 1,
    dirty: row.dirty === 1,
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const EARLIEST_MS = Date.UTC(2000, 0, 1);

/** The server's date check (`save_checkin`): a date it would refuse with 22023 fails here, before it is queued. */
function checkedDate(value: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const [year, month, day] = [Number(match?.[1]), Number(match?.[2]), Number(match?.[3])];
  const at = Date.UTC(year, month - 1, day);
  const real = match !== null && new Date(at).getUTCDate() === day && new Date(at).getUTCMonth() === month - 1;
  // One day past the UTC date, so a phone ahead of UTC can save its own today.
  if (!real || at < EARLIEST_MS || at > Date.now() + DAY_MS) throw new RangeError('The date is out of range.');
}

/**
 * Merges only the keys present into the day's row and queues one `save_checkin` with those keys. A date the server
 * would refuse is a `RangeError` and nothing is written. Assumes an open transaction.
 */
export function saveCheckinTx(userId: string, localDate: string, fields: CheckinFields): void {
  checkedDate(localDate);
  const db = localDb();
  const values: [string, string | number | null][] = [];
  const rpcFields: Record<string, Json> = {};
  for (const name of FIELD_NAMES) {
    const value = fields[name];
    if (value === undefined) continue;
    const column = COLUMN_OF[name];
    values.push([column, typeof value === 'boolean' ? (value ? 1 : 0) : value]);
    rpcFields[column] = value;
  }
  if (values.length === 0) return;
  const now = new Date().toISOString();
  const names = values.map(([column]) => column);
  db.runSync(
    `INSERT INTO checkins (user_id, local_date, ${names.join(', ')}, created_at, updated_at)
     VALUES (?, ?, ${names.map(() => '?').join(', ')}, ?, ?)
     ON CONFLICT (user_id, local_date) DO UPDATE SET ${names.map((column) => `${column} = excluded.${column}`).join(', ')}, updated_at = excluded.updated_at;`,
    [userId, localDate, ...values.map(([, stored]) => stored), now, now],
  );
  enqueue(userId, 'save_checkin', { p_local_date: localDate, p_fields: rpcFields });
}

/** Synchronous: the mirror row and the operation are committed together before it returns. */
export function saveCheckin(userId: string, localDate: string, fields: CheckinFields): void {
  localDb().withTransactionSync(() => {
    saveCheckinTx(userId, localDate, fields);
  });
}

/** The user's check-in for `localDate`; null when none is on this phone. */
export function useCheckin(userId: string, localDate: string): Checkin | null {
  const read = useCallback(() => {
    const row = localDb().getFirstSync<CheckinRow>(`SELECT ${COLUMNS} FROM checkins WHERE user_id = ? AND local_date = ?;`, [userId, localDate]);
    return row === null ? null : toCheckin(row);
  }, [userId, localDate]);
  return useLocalQuery(['checkins'], read);
}

/** What counts as the day's check-in: the two required answers. */
export function isCheckinDone(checkin: Checkin | null): boolean {
  return checkin !== null && checkin.sleepBand !== null && checkin.stress !== null;
}

/** The local dates with a check-in, from `fromDate` to `toDate` inclusive. */
export function useCheckinDates(userId: string, fromDate: string, toDate: string): ReadonlySet<string> {
  const read = useCallback(
    () =>
      new Set(
        localDb()
          .getAllSync<{ local_date: string }>(
            'SELECT local_date FROM checkins WHERE user_id = ? AND local_date >= ? AND local_date <= ? ORDER BY local_date;',
            [userId, fromDate, toDate],
          )
          .map((row) => row.local_date),
      ),
    [userId, fromDate, toDate],
  );
  return useLocalQuery(['checkins'], read);
}
