// What this phone registered for the signal pushes, per account in kv `push.<userId>`, plus the device-wide secret,
// the tokens a sign-out left to unregister and a reclaim in flight (docs/app.md#push-srcpush).
import { getRandomBytes } from 'expo-crypto';
import { useSyncExternalStore } from 'react';

import { kvGet, kvGetJson, kvRemove, kvSet } from '../lib/kv';

/** `token` is the Expo push token this phone registered, null when nothing is stored on the server. */
export type PushSettings = { token: string | null };

export const NO_PUSH: PushSettings = { token: null };

export function pushKey(userId: string): string {
  return `push.${userId}`;
}

function isSettings(value: unknown): value is PushSettings {
  if (typeof value !== 'object' || value === null) return false;
  const { token } = value as Record<string, unknown>;
  return token === null || typeof token === 'string';
}

export function readPush(userId: string): PushSettings {
  return kvGetJson(pushKey(userId), isSettings) ?? NO_PUSH;
}

export function writePush(userId: string, settings: PushSettings): void {
  kvSet(pushKey(userId), JSON.stringify(settings));
}

/** A token a sign-out still has to unregister, with the account it was registered for. */
export type PendingUnregister = { token: string; userId: string };

/**
 * Tokens a sign-out couldn't delete, kept device-wide (not `<name>.<id>`, so forgetting an account keeps them)
 * until `push-unregister` succeeds. Each names its account: the device secret alone would also match the row of the
 * account signed in after.
 */
export const PENDING_UNREGISTER_KEY = 'push.pendingUnregister';

function isPendingUnregister(value: unknown): value is PendingUnregister {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.token === 'string' && typeof entry.userId === 'string';
}

const isList = (value: unknown): value is unknown[] => Array.isArray(value);

/** The pending entries; one of another shape (an older build's bare token, with no account) is dropped. */
export function readPendingUnregister(): PendingUnregister[] {
  return (kvGetJson(PENDING_UNREGISTER_KEY, isList) ?? []).filter(isPendingUnregister).map(({ token, userId }) => ({ token, userId }));
}

const keyOf = (entry: PendingUnregister): string => `${entry.userId} ${entry.token}`;

export function writePendingUnregister(entries: readonly PendingUnregister[]): void {
  const unique = new Map(entries.map((entry) => [keyOf(entry), entry]));
  if (unique.size === 0) kvRemove(PENDING_UNREGISTER_KEY);
  else kvSet(PENDING_UNREGISTER_KEY, JSON.stringify([...unique.values()]));
}

export function samePending(a: PendingUnregister, b: PendingUnregister): boolean {
  return keyOf(a) === keyOf(b);
}

/** This phone's own secret, device-wide like the pending list: it proves the phone to the server. */
export const DEVICE_SECRET_KEY = 'push.deviceSecret';

const DEVICE_SECRET = /^[0-9a-f]{64}$/;

/** `bytes` random bytes as hex. */
export function randomHex(bytes: number): string {
  return Array.from(getRandomBytes(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 256 random bits as hex, made on first use and kept until the app's data is cleared. */
export function deviceSecret(): string {
  const stored = kvGet(DEVICE_SECRET_KEY);
  if (stored !== null && DEVICE_SECRET.test(stored)) return stored;
  const made = randomHex(32);
  kvSet(DEVICE_SECRET_KEY, made);
  return made;
}

/**
 * A reclaim this phone started: device-wide, one at a time. `nonce` is echoed in the code push, so only this claim's code
 * is confirmed; it stays the same for the claim's life, since the server may keep an earlier start. `startedAt` (ms) is
 * the last start this phone asked for.
 */
export type PendingClaim = { userId: string; token: string; platform: 'ios' | 'android'; nonce: string; startedAt: number };

export const PENDING_CLAIM_KEY = 'push.pendingClaim';

function isPendingClaim(value: unknown): value is PendingClaim {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.userId === 'string' &&
    typeof entry.token === 'string' &&
    (entry.platform === 'ios' || entry.platform === 'android') &&
    typeof entry.nonce === 'string' &&
    typeof entry.startedAt === 'number'
  );
}

export function readPendingClaim(): PendingClaim | null {
  return kvGetJson(PENDING_CLAIM_KEY, isPendingClaim);
}

export function writePendingClaim(claim: PendingClaim | null): void {
  if (claim === null) kvRemove(PENDING_CLAIM_KEY);
  else kvSet(PENDING_CLAIM_KEY, JSON.stringify(claim));
}

/**
 * `unavailable`: no token on this phone (no EAS project id, or FCM/APNs not set up for the build);
 * `verifying`: another account holds the token, so a claim is proving this phone receives it.
 */
export type PushOutcome = 'saved' | 'denied' | 'unavailable' | 'verifying' | 'failed';

// The last registration's outcome, in memory: Profile states "unavailable" without asking for a token again.
let lastOutcome: PushOutcome | null = null;
const listeners = new Set<() => void>();

export function writeLastOutcome(outcome: PushOutcome | null): void {
  lastOutcome = outcome;
  for (const listener of listeners) listener();
}

export function readLastOutcome(): PushOutcome | null {
  return lastOutcome;
}

export function useLastOutcome(): PushOutcome | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => lastOutcome,
  );
}
