// Runs push then pull for the signed-in user (sign-in, resume, reconnect, every enqueue) and exposes the
// outbox state to the sync banner. The flow: docs/app.md, "Local store, outbox and sync".
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { confirmPendingDeletion } from '../../account/deletionFlow';
import type { OutboxControl } from '../../account/deletionFlow';
import { deletionState } from '../../account/deletionMarker';
import { removeExports } from '../../account/deviceFiles';
import { orphanOwners, sweepOrphanKeys } from '../../account/forgetAccount';
import { useAuth } from '../../auth/AuthProvider';
import { useLocalQuery } from '../local/useLocalQuery';
import { purgeOtherUsers, purgeUser } from '../local/db';
import { removeDebriefsDone } from '../../companion/debriefDone';
import { removeCachedNotes } from '../../memory/agentNotesRepository';
import { removeCachedProfile } from '../../profile/profileRepository';
import { flushPendingUnregister, forgetPushTokenLater } from '../../push/pushRegistration';
import { removeCachedSignals } from '../../signals/signalRepository';
import { clearOutbox, onEnqueue, outboxState, resetFailed, wakeOffline } from '../outbox/outbox';
import { pauseOutbox, resumeOutbox, rpcSender, runOutbox } from '../outbox/runOutbox';
import type { OutboxDeps } from '../outbox/runOutbox';
import { readStoredSession, supabase } from '../supabase';
import { useOnResume } from '../useOnResume';
import { pullAll } from './pull';

/**
 * The agent's notes (the user's words about themselves, never queued), the debriefs marked done, today's pressure
 * row, this phone's push token, unregistered through `push-unregister` with the device secret since the session
 * is gone, and any export file (it holds health data).
 */
function forgetUserCaches(userId: string): void {
  removeCachedNotes(userId);
  removeCachedSignals(userId);
  removeDebriefsDone(userId);
  forgetPushTokenLater(userId);
  void flushPendingUnregister();
  try {
    removeExports();
  } catch {
    // The cache directory is the OS's to purge; the next export or deletion removes it.
  }
}

/** Something of `userId`'s is still to send, failed included: their data waits on the phone for them. */
function hasQueued(userId: string): boolean {
  const { pending, failed } = outboxState(userId);
  return pending + failed > 0;
}

/** The outbox controls a deletion uses; `run` asks for a sync after a resume. */
function outboxControl(userId: string, run: () => void): OutboxControl {
  return {
    pause: () => pauseOutbox(userId),
    clear: () => {
      clearOutbox(userId);
    },
    resume: (options) => {
      resumeOutbox(userId);
      if (options?.run !== false) run();
    },
  };
}

export interface SyncState {
  /** Operations not yet sent and not failed. */
  pending: number;
  failed: number;
  syncing: boolean;
  /** Puts failed operations back in line and syncs now. */
  retry: () => void;
  /** The pause, clear and resume an account deletion needs for `userId`'s outbox. */
  outboxFor: (userId: string) => OutboxControl;
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
          // An unconfirmed deletion: nothing is sent or pulled, only the account checked; a `kept` answer asks again.
          if (deletionState(user) !== null) {
            await confirmPendingDeletion(
              user,
              outboxControl(user, () => {
                again.current = true;
              }),
            );
            continue;
          }
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

  // At launch, rows and kv keys of anyone but the signed-in user are left from a sign-out made while the app was closed.
  const launchUser = useRef(userId);
  useEffect(() => {
    const keep = launchUser.current;
    // Their notes and finished debriefs go as at a sign-out, whatever the outbox holds; an account with only kv keys
    // left (no rows) too. Then every key of an account with nothing queued goes, its profile cache included.
    const forgotten = new Set([...purgeOtherUsers(keep), ...orphanOwners(keep, hasQueued)]);
    for (const user of forgotten) forgetUserCaches(user);
    sweepOrphanKeys(keep, hasQueued);
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

  const outboxFor = useCallback(
    (user: string) =>
      outboxControl(user, () => {
        void sync();
      }),
    [sync],
  );

  const value = useMemo(
    () => ({ pending: counts.pending, failed: counts.failed, syncing, retry, outboxFor }),
    [counts, syncing, retry, outboxFor],
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
