// The kv marker `account.deleting.<userId>` (`<state>:<ms>`), written before the server call so a lost answer is never
// forgotten; what each state does: docs/app.md#account-deletion-on-the-phone.
import { kvGet, kvKeys, kvRemove, kvSet } from '../lib/kv';
import { DELETION_PREFIX, forgetAccountOnDevice } from './forgetAccount';

export type DeletionState = 'deleting' | 'reauth';

/**
 * How long an existing account counts as maybe still being deleted: the function may still be running after the
 * phone gave up waiting, up to the Edge Functions wall clock (150 s free, 400 s paid).
 */
export const DELETION_SETTLE_MS = 10 * 60 * 1000;

/** `markedAt` (ms) is null when the time is missing, malformed or past the settle window in the future. */
type Marker = { state: DeletionState; markedAt: number | null };

/**
 * A `deleting` or `reauth` state counts whatever its time, so a damaged value never lets the outbox run unchecked;
 * only another state reads as none.
 */
function parseMarker(value: string | null, now: number): Marker | null {
  if (value === null) return null;
  const separator = value.indexOf(':');
  const state = separator === -1 ? value : value.slice(0, separator);
  if (state !== 'deleting' && state !== 'reauth') return null;
  const at = separator === -1 ? '' : value.slice(separator + 1);
  const markedAt = /^\d+$/.test(at) ? Number(at) : Number.NaN;
  const trusted = Number.isSafeInteger(markedAt) && markedAt <= now + DELETION_SETTLE_MS;
  return { state, markedAt: trusted ? markedAt : null };
}

export function markDeletion(userId: string, state: DeletionState, now: number = Date.now()): void {
  kvSet(`${DELETION_PREFIX}${userId}`, `${state}:${String(now)}`);
}

export function deletionState(userId: string): DeletionState | null {
  return parseMarker(kvGet(`${DELETION_PREFIX}${userId}`), Date.now())?.state ?? null;
}

export function readDeletionMarker(userId: string, now: number = Date.now()): Marker | null {
  return parseMarker(kvGet(`${DELETION_PREFIX}${userId}`), now);
}

export function clearDeletionMarker(userId: string): void {
  kvRemove(`${DELETION_PREFIX}${userId}`);
}

/**
 * On each sign-out or account change: drops the phone's data of every other account still marked `deleting` (the
 * server may have finished). A `reauth` one keeps its data for that account's next sign-in.
 */
export function forgetInterruptedDeletions(activeUserId: string | null): void {
  for (const key of kvKeys()) {
    if (!key.startsWith(DELETION_PREFIX)) continue;
    const userId = key.slice(DELETION_PREFIX.length);
    if (userId !== activeUserId && parseMarker(kvGet(key), Date.now())?.state === 'deleting') {
      forgetAccountOnDevice(userId);
    }
  }
}
