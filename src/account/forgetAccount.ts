// Drops an account's data from the phone: after a deletion (every row and kv key, writes refused after), and at launch
// for kv keys left by accounts that are gone from the phone. The flows: docs/app.md#account-deletion-on-the-phone.
import { UUID } from '../lib/guards';
import { forgetUserRows } from '../lib/local/db';
import { kvKeys, kvRemove, refuseUserKeys } from '../lib/kv';
import { readPendingClaim, writePendingClaim } from '../push/pushStore';

/**
 * Refuses the account's later kv writes first, so a request still in flight can't restore anything, then removes its
 * rows (mirror, chat and outbox, queued or not) and every `<name>.<userId>[.<more>]` key, the profile cache, push
 * settings, agent notes and the deletion marker included. Device-wide keys stay.
 */
export function forgetAccountOnDevice(userId: string): void {
  refuseUserKeys(userId);
  forgetUserRows(userId);
  for (const key of kvKeys()) {
    if (key.split('.').includes(userId)) kvRemove(key);
  }
  // A token reclaim is device-wide, keyed by no account: dropped only when it is this account's.
  if (readPendingClaim()?.userId === userId) writePendingClaim(null);
}

/** The deletion marker's key prefix (`deletionMarker.ts`), here so that module can depend on this one. */
export const DELETION_PREFIX = 'account.deleting.';

// Keys from before kv keys carried the user id: their only id is an attack's, so they name no account and just go.
const LEGACY_EPISODE_KEY = /^(redflag\.long|today\.over)\.[^.]+$/;

/** A key's account: its first UUID-shaped segment; null for a device-wide key, which has none. */
function ownerOf(key: string): string | null {
  return key.split('.').find((segment) => UUID.test(segment)) ?? null;
}

/** The accounts whose keys `sweepOrphanKeys` would remove; an attack id from a legacy key is not one. */
export function orphanOwners(activeUserId: string | null, hasQueued: (userId: string) => boolean): string[] {
  const owners = new Set<string>();
  for (const key of kvKeys()) {
    if (key.startsWith(DELETION_PREFIX) || LEGACY_EPISODE_KEY.test(key)) continue;
    const owner = ownerOf(key);
    if (owner !== null && owner !== activeUserId) owners.add(owner);
  }
  return [...owners].filter((owner) => !hasQueued(owner));
}

/**
 * At launch: removes the kv keys of every account but the signed-in one that has nothing left to send, so an account
 * with no rows on the phone (only caches) leaves nothing behind either, and every legacy episode-keyed key.
 * `account.deleting.*` is left to `forgetInterruptedDeletions`.
 */
export function sweepOrphanKeys(activeUserId: string | null, hasQueued: (userId: string) => boolean): void {
  const owners = new Set(orphanOwners(activeUserId, hasQueued));
  for (const key of kvKeys()) {
    if (key.startsWith(DELETION_PREFIX)) continue;
    const owner = ownerOf(key);
    if (LEGACY_EPISODE_KEY.test(key) || (owner !== null && owners.has(owner))) kvRemove(key);
  }
}
