// This phone's Expo push token in `push_tokens`: registered whenever the permission is granted, forgotten at
// sign-out through `push-unregister` with the device secret (docs/app.md#push-srcpush).
import type { SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { askNotificationPermission } from '../cabinet/reminders';
import type { Locale } from '../i18n';
import type { Database } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import {
  deviceSecret,
  randomHex,
  readPendingClaim,
  readPendingUnregister,
  readPush,
  samePending,
  writeLastOutcome,
  writePendingClaim,
  writePendingUnregister,
  writePush,
  type PendingClaim,
  type PendingUnregister,
  type PushOutcome,
} from './pushStore';
import { ensureSignalChannel } from './signalChannel';

export type { PushOutcome };

export type PushClient = SupabaseClient<Database>;

function projectId(): string | null {
  const extra: unknown = Constants.expoConfig?.extra;
  const eas = typeof extra === 'object' && extra !== null ? (extra as { eas?: { projectId?: unknown } }).eas : undefined;
  return typeof eas?.projectId === 'string' && eas.projectId !== '' ? eas.projectId : null;
}

async function deviceToken(): Promise<string | null> {
  const id = projectId();
  if (id === null) return null;
  try {
    return (await Notifications.getExpoPushTokenAsync({ projectId: id })).data;
  } catch {
    return null;
  }
}

async function deleteRow(client: PushClient, token: string): Promise<boolean> {
  const { error } = await client.from('push_tokens').delete().eq('token', token);
  return error === null;
}

/**
 * The token is this account's again: store it and take it off the unregister retries (registering took the token
 * over from any earlier account, so their entries have nothing left to delete).
 */
function saved(userId: string, token: string): void {
  writePush(userId, { token });
  writePendingUnregister(readPendingUnregister().filter((pending) => pending.token !== token));
}

/** The server sends one code per token and account per 10 minutes, keeping the earlier start's nonce meanwhile. */
export const CLAIM_RESTART_MS = 10 * 60_000;

/**
 * Starts the claim, or restarts it with the same nonce: a start the server refuses as too soon keeps the earlier
 * code and nonce, so a fresh nonce here would never match the code that arrives.
 */
async function startClaim(client: PushClient, claim: Omit<PendingClaim, 'nonce' | 'startedAt'>, nonce = randomHex(16)): Promise<void> {
  writePendingClaim({ ...claim, nonce, startedAt: Date.now() });
  await client.functions.invoke('push-claim', { body: { token: claim.token, step: 'start', nonce } }).catch(() => undefined);
}

// Registrations and claim resumes run one after another, so a launch's sync and onboarding's "Allow" can't both
// start a claim or overwrite each other's nonce.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

/** A session's end: a claim still in flight must not register the account again later. */
function dropClaimOf(userId: string): void {
  if (readPendingClaim()?.userId === userId) writePendingClaim(null);
}

/** A reinstall or restore can hand the phone a new token; the old row would only collect dead pushes. */
async function dropReplacedRow(client: PushClient, previous: string | null, current: string): Promise<void> {
  if (previous !== null && previous !== current) await deleteRow(client, previous).catch(() => false);
}

async function register(userId: string, locale: Locale, client: PushClient): Promise<PushOutcome> {
  try {
    // The channel first: Android 13 shows no permission prompt without one, and the token needs it too.
    await ensureSignalChannel(locale);
    if (!(await askNotificationPermission(locale))) return 'denied';
  } catch {
    return 'failed';
  }
  const pushToken = await deviceToken();
  if (pushToken === null) return 'unavailable';
  const previous = readPush(userId).token;
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  try {
    const { error } = await client.rpc('register_push_token', { p_token: pushToken, p_platform: platform, p_device_secret: deviceSecret() });
    if (error !== null) {
      // 42501: another account holds the token under another secret (this phone lost its secret, or someone
      // learned the token). Prove receipt instead: the code arrives as a push.
      if (error.code === '42501') {
        // A claim already in flight for this account and token is left to `resumePushClaim`.
        const pending = readPendingClaim();
        if (pending?.userId !== userId || pending.token !== pushToken) await startClaim(client, { userId, token: pushToken, platform });
        return 'verifying';
      }
      return 'failed';
    }
  } catch {
    return 'failed';
  }
  saved(userId, pushToken);
  await dropReplacedRow(client, previous, pushToken);
  return 'saved';
}

/** Ensures the channel, asks only while the system still can, then stores this phone's token. Never throws. */
export function registerPush(userId: string, locale: Locale, client: PushClient = supabase): Promise<PushOutcome> {
  return serial(async () => {
    const outcome = await register(userId, locale, client);
    writeLastOutcome(outcome);
    return outcome;
  });
}

/**
 * At launch or sign-in: asks again for this account's pending claim, with its nonce, once the server would send a new
 * code (`CLAIM_RESTART_MS` after the last start); a code from that start may still be on its way.
 */
export function resumePushClaim(userId: string, client: PushClient = supabase): Promise<void> {
  return serial(async () => {
    const claim = readPendingClaim();
    if (claim === null) return;
    // Another account's claim can't be confirmed with this session.
    if (claim.userId !== userId) {
      writePendingClaim(null);
      return;
    }
    // NOTE: the phone's clock against the server's 10 minutes: a phone behind can be refused once and restart a launch later; upgrade: read the server's next allowed start from the answer, if claims stall.
    if (Date.now() - claim.startedAt < CLAIM_RESTART_MS) return;
    await startClaim(client, claim, claim.nonce);
  });
}

/** How long sign-out and the flush wait for each call on a stalled network. */
export const FORGET_TIMEOUT_MS = 5_000;

/** `call`'s answer, or false once `FORGET_TIMEOUT_MS` passes or it fails. Never throws. */
async function within(call: () => PromiseLike<boolean>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => {
      resolve(false);
    }, FORGET_TIMEOUT_MS);
  });
  const done = await Promise.race([Promise.resolve().then(call).then(Boolean, () => false), stalled]);
  clearTimeout(timer);
  return done;
}

/**
 * A claim code push arrived: confirms this account's pending claim, only when the push carries that claim's nonce
 * (another account's claim on the token also pushes codes here, and confirming those would spend this claim's
 * attempts). True once the token is this phone's. Never throws.
 */
export async function confirmPushClaim(code: string, nonce: string, userId: string, client: PushClient = supabase): Promise<boolean> {
  const claim = readPendingClaim();
  if (claim?.userId !== userId || claim.nonce !== nonce) return false;
  const previous = readPush(userId).token;
  const ok = await within(() =>
    client.functions
      .invoke('push-claim', {
        body: { token: claim.token, step: 'confirm', code, nonce, device_secret: deviceSecret(), platform: claim.platform },
      })
      .then(({ error }) => error === null),
  );
  if (!ok) return false;
  writePendingClaim(null);
  saved(userId, claim.token);
  writeLastOutcome('saved');
  await dropReplacedRow(client, previous, claim.token);
  return true;
}

/**
 * Deletes this phone's own row while the session still can. A row it couldn't delete leaves the token in the
 * device's pending list for `push-unregister`. Never throws.
 */
export async function forgetPushToken(userId: string, client: PushClient = supabase): Promise<void> {
  dropClaimOf(userId);
  const stored = readPush(userId).token;
  if (stored === null) return;
  if (!(await within(() => deleteRow(client, stored)))) writePendingUnregister([...readPendingUnregister(), { token: stored, userId }]);
  writePush(userId, { token: null });
}

/**
 * A session that ended (sign-out, another phone's global sign-out, a revoked session): with no session left to
 * delete the row, the token joins the pending list for `push-unregister`, which pairs it with the account and this
 * phone's secret.
 */
export function forgetPushTokenLater(userId: string): void {
  dropClaimOf(userId);
  writeLastOutcome(null);
  const stored = readPush(userId).token;
  if (stored === null) return;
  writePendingUnregister([...readPendingUnregister(), { token: stored, userId }]);
  writePush(userId, { token: null });
}

/**
 * `push-unregister` with each pending token, its account and this phone's secret, which deletes only that account's
 * row this phone registered. Keeps each that fails again for the next launch. Never throws.
 */
export async function flushPendingUnregister(client: PushClient = supabase): Promise<void> {
  const pending = readPendingUnregister();
  if (pending.length === 0) return;
  let secret: string;
  try {
    secret = deviceSecret();
  } catch {
    return;
  }
  const failed: PendingUnregister[] = [];
  for (const entry of pending) {
    const ok = await within(() =>
      client.functions
        .invoke('push-unregister', { body: { token: entry.token, user_id: entry.userId, device_secret: secret } })
        .then(({ error }) => error === null),
    );
    if (!ok) failed.push(entry);
  }
  // A sign-out may have added a token meanwhile, or a registration taken one back.
  const now = readPendingUnregister();
  const isIn = (list: readonly PendingUnregister[]) => (entry: PendingUnregister) => list.some((other) => samePending(other, entry));
  writePendingUnregister([...failed.filter(isIn(now)), ...now.filter((entry) => !isIn(pending)(entry))]);
}
