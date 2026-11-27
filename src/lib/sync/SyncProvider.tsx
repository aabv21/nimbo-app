// Runs push then pull for the signed-in user (sign-in, resume, reconnect, every enqueue) and exposes the
// outbox state to the sync banner. The flow: docs/app.md, "Local store, outbox and sync".
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useAuth } from '../../auth/AuthProvider';
import { useLocalQuery } from '../local/useLocalQuery';
import { purgeOtherUsers, purgeUser } from '../local/db';
import { onEnqueue, outboxState, resetFailed } from '../outbox/outbox';
import { pauseOutbox, resumeOutbox, rpcSender, runOutbox } from '../outbox/runOutbox';
import type { OutboxDeps } from '../outbox/runOutbox';
import { readStoredSession, supabase } from '../supabase';
import { useOnResume } from '../useOnResume';
import { pullAll } from './pull';

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
    purgeOtherUsers(launchUser.current);
  }, []);

  useEffect(() => {
    userRef.current = userId;
    if (userId === null) return;
    resumeOutbox(userId);
    void sync();
    return () => {
      // Sign-out or another account: nothing of this user goes out until they are back, and their rows
      // leave the phone once no send or pull can still write them (and unless one is still queued).
      const settled = Promise.all([pauseOutbox(userId), cycle.current.catch(() => undefined)]);
      void settled.then(() => {
        if (userRef.current !== userId) purgeUser(userId);
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

  useOnResume(() => {
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
