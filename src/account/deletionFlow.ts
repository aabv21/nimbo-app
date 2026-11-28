// The phone's side of an account deletion and its launch check while one is unconfirmed; each outcome:
// docs/app.md#account-deletion-on-the-phone.
import { signOutLocally } from '../auth/emailAuth';
import type { MessageKey } from '../i18n';
import { readStoredSession } from '../lib/supabase';
import { deleteAccount, verifyAccount } from './accountClient';
import type { AccountError } from './accountClient';
import { clearDeletionMarker, DELETION_SETTLE_MS, deletionState, markDeletion, readDeletionMarker } from './deletionMarker';
import { forgetDeviceFiles } from './deviceFiles';
import { forgetAccountOnDevice } from './forgetAccount';

/** The outbox controls a deletion needs (`SyncProvider`'s `outboxControl`). */
export type OutboxControl = {
  pause: () => Promise<void>;
  clear: () => void;
  resume: (options?: { run?: boolean }) => void;
};

/** `busy`: a deletion or launch check for this user is already running (a double tap, say). */
export type DeletionResult = 'deleted' | 'reauth' | AccountError | 'busy';

const running = new Set<string>();

/** The stored session is still `userId`'s, or none: a late answer must never sign out or speak to a newer account. */
export function sessionStillFor(userId: string): boolean {
  try {
    const current = readStoredSession()?.userId ?? null;
    return current === null || current === userId;
  } catch {
    // Unreadable storage: assume another account, so nobody is signed out by mistake.
    return false;
  }
}

async function signOutIfStill(userId: string): Promise<void> {
  if (sessionStillFor(userId)) await signOutLocally();
}

/** The phone's side of a confirmed deletion; each step runs on its own, so a failing one never skips the rest. */
async function finishLocally(userId: string, outbox: OutboxControl): Promise<void> {
  try {
    outbox.clear();
  } catch {
    // The rows stay but never run: the marker blocks the outbox until the cleanup below removes them.
  }
  await signOutIfStill(userId);
  try {
    forgetAccountOnDevice(userId);
  } catch {
    // AuthProvider's sign-out handling drops a still-marked account's data as well.
  }
  await forgetDeviceFiles();
  outbox.resume({ run: false });
}

/** Only ever started by the user's tap. The outbox is unpaused in every case, never with a run. */
export async function runDeletion(userId: string, outbox: OutboxControl): Promise<DeletionResult> {
  if (running.has(userId)) return 'busy';
  running.add(userId);
  try {
    try {
      markDeletion(userId, 'deleting');
    } catch {
      return 'unknown';
    }
    let outcome: Awaited<ReturnType<typeof deleteAccount>>;
    try {
      await outbox.pause();
      outcome = await deleteAccount();
    } catch {
      outcome = { ok: false, error: 'unknown' };
    }
    if (outcome.ok) {
      await finishLocally(userId, outbox);
      return 'deleted';
    }
    if (outcome.error === 'reauth') {
      try {
        // Unless supabase-js's own sign-out (a refused refresh) already dropped the data, marker included.
        if (deletionState(userId) !== null) markDeletion(userId, 'reauth');
      } catch {
        // Left as `deleting`: the sign-out below then drops the phone's data instead.
      }
      await signOutIfStill(userId);
      outbox.resume({ run: false });
      return 'reauth';
    }
    // The server may have finished: the marker stays `deleting`, which keeps the outbox from sending.
    outbox.resume({ run: false });
    return outcome.error;
  } finally {
    running.delete(userId);
  }
}

/**
 * The verify-only check while a deletion is marked. A marker time that can't be trusted is stamped now, so the settle
 * window starts over instead of being skipped.
 */
export async function confirmPendingDeletion(
  userId: string,
  outbox: OutboxControl,
  now: () => number = Date.now,
): Promise<'deleted' | 'kept' | 'pending' | 'busy'> {
  if (running.has(userId)) return 'busy';
  running.add(userId);
  try {
    const status = await verifyAccount(userId);
    if (status === 'gone') {
      await finishLocally(userId, outbox);
      return 'deleted';
    }
    const marker = readDeletionMarker(userId, now());
    // The server refused that request (a `reauth` answer), so no deletion can still be running: no window to wait out.
    if (status === 'exists' && marker?.state === 'reauth') {
      try {
        clearDeletionMarker(userId);
      } catch {
        return 'pending';
      }
      outbox.resume();
      return 'kept';
    }
    if (status === 'exists' && marker !== null && marker.markedAt === null) {
      try {
        markDeletion(userId, marker.state, now());
      } catch {
        // The marker stays as it was; the next check tries to stamp it again.
      }
      return 'pending';
    }
    if (status === 'exists' && marker !== null && marker.markedAt !== null && now() - marker.markedAt >= DELETION_SETTLE_MS) {
      try {
        clearDeletionMarker(userId);
      } catch {
        return 'pending';
      }
      outbox.resume();
      return 'kept';
    }
    return 'pending';
  } finally {
    running.delete(userId);
  }
}

/** The message for a deletion that didn't end on the signed-out screens, if any. */
export function deletionMessage(result: DeletionResult): MessageKey | undefined {
  switch (result) {
    case 'reauth':
      return 'delete.error.reauth';
    case 'network':
      return 'delete.error.network';
    case 'unknown':
      return 'delete.error.unknown';
    case 'deleted':
    case 'busy':
      return undefined;
  }
}
