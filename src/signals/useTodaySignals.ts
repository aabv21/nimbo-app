// Today's signal rows, computed on the phone over the local mirror so they work offline and follow a check-in at
// once; only the pressure row comes from the server (docs/architecture.md#signals-and-the-monitor).
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';

import { currentUserId } from '../auth/currentUser';
import { localDateIn, packs } from '../condition';
import { usableZone, useRecords } from '../insights/useRecords';
import { useOnResume } from '../lib/useOnResume';
import { computeSignals, todayRows, withStoredPressure } from './index';
import type { Signal, SignalUser } from './index';
import { fetchTodayPressure, freshPressure, readCachedPressure } from './signalRepository';

const pack = packs.migraine;
/** Below this many check-ins, with no attack yet, "nothing today" would mislead: the rules have nothing to read. */
const NEW_USER_CHECKINS = 3;

export interface TodaySignals {
  /** At most the pack's `maxOnToday`, highest priority first. */
  rows: readonly Signal[];
  all: readonly Signal[];
  /** Why there are no rows: `new` while there is too little to read, `none` when nothing fires; null with rows. */
  empty: 'new' | 'none' | null;
  /** The zone the rows were computed in: the device's when the runtime knows it, else UTC. */
  timeZone: string;
}

/**
 * `now` is the screen's minute clock: each tick re-reads the stored row's age, so a screen left open drops a pressure
 * row once its forecast is stale. `profileZone` is the zone the monitor dated the row in.
 */
export function useTodaySignals(userId: string, now: Date, profileZone: string | null = null): TodaySignals {
  const records = useRecords(userId);
  // `useRecords` hands over a zone the runtime can use, so the date maths never throws.
  const timeZone = records.timeZone ?? 'UTC';
  const today = localDateIn(now, timeZone);
  // A profile zone this runtime can't place in a day adds nothing: the monitor skips such a user too.
  const profileToday = profileZone === null || usableZone(profileZone) !== profileZone ? today : localDateIn(now, profileZone);
  const days = useMemo((): [string, ...string[]] => (profileToday === today ? [today] : [today, profileToday]), [today, profileToday]);
  const [storedRow, setStoredRow] = useState<unknown>(() => readCachedPressure(userId, today));

  const refresh = useCallback(() => {
    void fetchTodayPressure(userId, days).then((row) => {
      if (currentUserId() === userId) setStoredRow(row);
    });
  }, [userId, days]);
  // Re-created when the date turns over, so a focused Today reads the new day's row.
  useFocusEffect(refresh);
  useOnResume(refresh);

  const onboardedAt = records.onboardedAt;
  return useMemo(() => {
    // Not yet onboarded reads as onboarded now, so a quiet tracker cannot fire.
    const user: SignalUser = { ...records, timeZone, onboardedAt: onboardedAt ?? now.toISOString(), pressure: null };
    // `withStoredPressure` drops a row from a day not in `days`, so a stale cache never shows.
    const all = withStoredPressure(computeSignals(user, now, pack), freshPressure(storedRow, now), user, now, pack, days);
    const rows = todayRows(all, pack);
    const isNew = records.checkins.length < NEW_USER_CHECKINS && records.episodes.length === 0;
    return { rows, all, empty: rows.length > 0 ? null : isNew ? 'new' : 'none', timeZone };
  }, [records, timeZone, onboardedAt, now, storedRow, days]);
}
