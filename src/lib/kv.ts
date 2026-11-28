import Storage from 'expo-sqlite/kv-store';

/** The app's only `expo-sqlite/kv-store` caller: small on-device values go through these. */

export function kvGet(key: string): string | null {
  return Storage.getItemSync(key);
}

/** `raw` parsed as JSON when it passes `guard`; null when absent, unreadable or of another shape. */
export function parseJson<T>(raw: string | null, guard: (value: unknown) => value is T): T | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  return guard(value) ? value : null;
}

/** The value stored under `key`, read like `parseJson`. */
export function kvGetJson<T>(key: string, guard: (value: unknown) => value is T): T | null {
  return parseJson(kvGet(key), guard);
}

// Accounts whose data was dropped by a deletion: a key with their id as a dot segment is refused, so a request that
// resolves after the cleanup (a profile read, the signals cache, a quota) can't bring any of it back.
const refusedUsers = new Set<string>();

/** Stores `value`, unless a dot segment of `key` is an account `refuseUserKeys` named. */
export function kvSet(key: string, value: string): void {
  if (refusedUsers.size > 0 && key.split('.').some((segment) => refusedUsers.has(segment))) {
    return;
  }
  Storage.setItemSync(key, value);
}

/**
 * Refuses `<name>.<userId>[.<more>]` writes until `allowUserKeys`.
 * NOTE: in memory, so it lasts the process; enough, since a deleted account can't sign in again.
 */
export function refuseUserKeys(userId: string): void {
  refusedUsers.add(userId);
}

/** Lifts `refuseUserKeys`: that account signed in again, so it still exists. */
export function allowUserKeys(userId: string): void {
  refusedUsers.delete(userId);
}

export function kvUserRefused(userId: string): boolean {
  return refusedUsers.has(userId);
}

export function kvRemove(key: string): void {
  Storage.removeItemSync(key);
}

/** Every key in the store, for the sweeps that find a user's keys by their id segment. */
export function kvKeys(): string[] {
  return Storage.getAllKeysSync();
}
