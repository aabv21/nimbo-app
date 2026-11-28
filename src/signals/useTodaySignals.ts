// Today's signal rows, computed on the phone over the local mirror so they work offline and follow a check-in at
// once; only the pressure row comes from the server (docs/architecture.md#signals-and-the-monitor).
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';

import { currentUserId } from '../auth/currentUser';
import { localDateIn, packs } from '../condition';
import { useRecords } from '../insights/useRecords';
import { useOnResume } from '../lib/useOnResume';
import { computeSignals, todayRows, withStoredPressure } from './index';
import type { Signal, SignalUser } from './index';
import { fetchTodayPressure, readCachedPressure } from './signalRepository';

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

export function useTodaySignals(userId: string, now: Date): TodaySignals {
  const records = useRecords(userId);
  // `useRecords` hands over a zone the runtime can use, so the date maths never throws.
  const timeZone = records.timeZone ?? 'UTC';
  const today = localDateIn(now, timeZone);
  const [stored, setStored] = useState<Signal | null>(() => readCachedPressure(userId, today));

  const refresh = useCallback(() => {
    void fetchTodayPressure(userId, today).then((signal) => {
      if (currentUserId() === userId) setStored(signal);
    });
  }, [userId, today]);
  // Re-created when the date turns over, so a focused Today reads the new day's row.
  useFocusEffect(refresh);
  useOnResume(refresh);

  const onboardedAt = records.onboardedAt;
  return useMemo(() => {
    // Not yet onboarded reads as onboarded now, so a quiet tracker cannot fire.
    const user: SignalUser = { ...records, timeZone, onboardedAt: onboardedAt ?? now.toISOString(), pressure: null };
    // `withStoredPressure` drops a row from another day, so a stale cache never shows.
    const all = withStoredPressure(computeSignals(user, now, pack), stored, user, now, pack);
    const rows = todayRows(all, pack);
    const isNew = records.checkins.length < NEW_USER_CHECKINS && records.episodes.length === 0;
    return { rows, all, empty: rows.length > 0 ? null : isNew ? 'new' : 'none', timeZone };
  }, [records, timeZone, onboardedAt, now, stored]);
}
