// Runs push then pull for the signed-in user (sign-in, resume, reconnect, every enqueue) and exposes the
// outbox state to the sync banner. The flow: docs/app.md, "Local store, outbox and sync".
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useAuth } from '../../auth/AuthProvider';
import { useLocalQuery } from '../local/useLocalQuery';
import { purgeOtherUsers, purgeUser } from '../local/db';
import { removeDebriefsDone } from '../../companion/debriefDone';
import { removeCachedNotes } from '../../memory/agentNotesRepository';
import { removeCachedProfile } from '../../profile/profileRepository';
import { flushPendingUnregister, forgetPushTokenLater } from '../../push/pushRegistration';
import { onEnqueue, outboxState, resetFailed, wakeOffline } from '../outbox/outbox';
import { pauseOutbox, resumeOutbox, rpcSender, runOutbox } from '../outbox/runOutbox';
import type { OutboxDeps } from '../outbox/runOutbox';
import { readStoredSession, supabase } from '../supabase';
import { useOnResume } from '../useOnResume';
import { pullAll } from './pull';

/**
 * The agent's notes (the user's words about themselves, never queued), the debriefs marked done, and this phone's
 * push token, unregistered through `push-unregister` with the device secret since the session is gone.
 */
function forgetUserCaches(userId: string): void {
  removeCachedNotes(userId);
  removeDebriefsDone(userId);
  forgetPushTokenLater(userId);
  void flushPendingUnregister();
}

export interface SyncState {
  /** Operations not yet sent and not failed. */
  pending: number;
  failed: number;
  syncing: boolean;
  /** Puts failed operations back in line and syncs now. */
  retry: () => void;
}

const SyncContext = createContext<SyncState | undefined>(undefined);

const NOTHING_QUEUED = { pending: 0, failed: 0, headDueAt: null };

// The persisted session is what the client sends with, so it is the account an operation would go out as.
const deps: OutboxDeps = {
  send: rpcSender(supabase),
  sessionUserId: () => readStoredSession()?.userId ?? null,
};

export function SyncProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { userId } = useAuth();
  const userRef = useRef(userId);
  const running = useRef(false);
  const again = useRef(false);
  const cycle = useRef<Promise<void>>(Promise.resolve());
  const [syncing, setSyncing] = useState(false);

  // One cycle at a time, so a pull never overlaps a send; a request made meanwhile runs one more cycle,
  // for whoever is signed in by then. Resolves when the running cycle ends.
  const sync = useCallback((): Promise<void> => {
    if (running.current) {
      again.current = true;
      return cycle.current;
    }
    running.current = true;
    setSyncing(true);
    const takeRequest = (): boolean => {
      const requested = again.current;
      again.current = false;
      return requested;
    };
    cycle.current = (async () => {
      try {
        do {
          const user = userRef.current;
          if (user === null) break;
          await runOutbox(user, deps);
          if (userRef.current !== user) continue;
          // A failed pull keeps the mirror as it is; the next trigger tries again.
          await pullAll(user);
        } while (takeRequest());
      } finally {
        running.current = false;
        setSyncing(false);
      }
    })();
    return cycle.current;
  }, []);

  // At launch, rows of anyone but the signed-in user are left from a sign-out made while the app was closed.
  const launchUser = useRef(userId);
  useEffect(() => {
    // Their notes and finished debriefs go as at a sign-out, whatever the outbox holds.
    for (const user of purgeOtherUsers(launchUser.current)) forgetUserCaches(user);
  }, []);

  useEffect(() => {
    userRef.current = userId;
    if (userId === null) return;
    resumeOutbox(userId);
    void sync();
    return () => {
      // Sign-out or another account: nothing of this user goes out until they are back, and their rows leave
      // the phone once no send or pull can still write them, all but those still waiting to be sent. The cached
      // profile goes too once nothing is queued; while something is, it lets them reopen offline to send it. The
      // agent's notes (the user's words about themselves, never queued) and the debriefs marked done go whatever the
      // outbox holds.
      const settled = Promise.all([pauseOutbox(userId), cycle.current.catch(() => undefined)]);
      void settled.then(() => {
        if (userRef.current === userId) return;
        forgetUserCaches(userId);
        if (purgeUser(userId)) removeCachedProfile(userId);
      });
    };
  }, [userId, sync]);

  useEffect(
    () =>
      onEnqueue(() => {
        void sync();
      }),
    [sync],
  );

  useOnResume((reason) => {
    // A send that got no answer waits out a backoff that only the lost connection caused.
    const user = userRef.current;
    if (reason === 'online' && user !== null) wakeOffline(user);
    void sync();
  });

  const readState = useCallback(() => (userId === null ? NOTHING_QUEUED : outboxState(userId)), [userId]);
  const counts = useLocalQuery(['outbox'], readState);

  // Nothing else wakes the queue when a backoff ends while the app stays open and online.
  const headDueAt = counts.headDueAt;
  useEffect(() => {
    const delay = headDueAt === null ? 0 : headDueAt - Date.now();
    if (delay <= 0) return;
    const timer = setTimeout(() => {
      void sync();
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  }, [headDueAt, sync]);

  const retry = useCallback(() => {
    if (userId === null) return;
    resetFailed(userId);
    void sync();
  }, [userId, sync]);

  const value = useMemo(
    () => ({ pending: counts.pending, failed: counts.failed, syncing, retry }),
    [counts, syncing, retry],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSyncState(): SyncState {
  const context = useContext(SyncContext);
  if (context === undefined) {
    throw new Error('useSyncState must be used within a SyncProvider');
  }
  return context;
}
