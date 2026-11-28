// Expo push over raw HTTP: sends, reads receipts and deletes the tokens Expo says are gone
// (docs/database.md#push-tokens). Logs nothing: callers log outcome words, never a token.

import type { PushEnv, SupabaseEnv } from './env.ts';
import { isRecord } from './guards.ts';
import { fetchWithDeadline } from './http.ts';
import { restJson, serviceHeaders } from './rest.ts';

/** The Android channel the app creates before it asks for a token (`src/push/signalChannel.ts`). */
export const PUSH_CHANNEL_ID = 'signals';
/** Expo's limit per send request. */
export const EXPO_PUSH_BATCH = 100;
/** Expo's limit per receipts request. */
export const EXPO_RECEIPT_BATCH = 1000;
export const EXPO_PUSH_TIMEOUT_MS = 5_000;

/** A visible signal push: neutral copy unless the user opted in, and `data` never says more than where a tap goes. */
export type PushMessage = { to: string; title: string; body?: string; data: { url: '/today'; signalId: string } };
/** A data-only message the app reads silently: push-claim's code for the claiming phone. */
export type ClaimMessage = { to: string; data: { type: 'push-claim'; code: string; nonce: string } };

/** `dead`: tokens whose ticket said `DeviceNotRegistered`; `tickets`: one per accepted message, for the receipts. */
export type PushResult = { sent: number; failed: number; dead: string[]; tickets: { token: string; id: string }[] };

/** A signal push goes on the app's channel with the default sound; a data-only one at high priority, waking iOS. */
function wireFormat(message: PushMessage | ClaimMessage): Record<string, unknown> {
  return 'title' in message
    ? { ...message, channelId: PUSH_CHANNEL_ID, sound: 'default' }
    : { ...message, priority: 'high', _contentAvailable: true };
}

function expoHeaders(env: PushEnv): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json', 'content-type': 'application/json' };
  if (env.expoAccessToken !== '') headers.authorization = `Bearer ${env.expoAccessToken}`;
  return headers;
}

/** The answer's tickets when there is one per message, else null. */
function ticketsOf(value: unknown, length: number): unknown[] | null {
  return isRecord(value) && Array.isArray(value.data) && value.data.length === length ? (value.data as unknown[]) : null;
}

const isDeviceGone = (entry: unknown): boolean =>
  isRecord(entry) && isRecord(entry.details) && entry.details.error === 'DeviceNotRegistered';

async function sendBatch(env: PushEnv, fetchFn: typeof fetch, batch: readonly (PushMessage | ClaimMessage)[]): Promise<PushResult> {
  const failed: PushResult = { sent: 0, failed: batch.length, dead: [], tickets: [] };
  try {
    const body = JSON.stringify(batch.map(wireFormat));
    const response = await fetchWithDeadline(fetchFn, `${env.expoPushUrl}/send`, { method: 'POST', headers: expoHeaders(env), body }, EXPO_PUSH_TIMEOUT_MS);
    if (!response.ok) return failed;
    const tickets = ticketsOf((await response.json()) as unknown, batch.length);
    if (tickets === null) return failed;
    // Tickets come back in the order the messages were sent.
    const result: PushResult = { sent: 0, failed: 0, dead: [], tickets: [] };
    tickets.forEach((ticket, index) => {
      const token = batch.at(index)?.to;
      if (isRecord(ticket) && ticket.status === 'ok') {
        result.sent += 1;
        if (token !== undefined && typeof ticket.id === 'string') result.tickets.push({ token, id: ticket.id });
        return;
      }
      result.failed += 1;
      if (isDeviceGone(ticket) && token !== undefined) result.dead.push(token);
    });
    return result;
  } catch {
    return failed;
  }
}

/** Sends in batches of `EXPO_PUSH_BATCH`, one after another; a failed batch never stops the next. Never throws. */
export async function sendPushes(env: PushEnv, fetchFn: typeof fetch, messages: readonly (PushMessage | ClaimMessage)[]): Promise<PushResult> {
  const total: PushResult = { sent: 0, failed: 0, dead: [], tickets: [] };
  for (let start = 0; start < messages.length; start += EXPO_PUSH_BATCH) {
    const result = await sendBatch(env, fetchFn, messages.slice(start, start + EXPO_PUSH_BATCH));
    total.sent += result.sent;
    total.failed += result.failed;
    total.dead.push(...result.dead);
    total.tickets.push(...result.tickets);
  }
  return total;
}

/** Receipts in chunks of 1000 ids; `dead` = ids whose receipt says DeviceNotRegistered; `checked` = ids answered at all. Never throws. */
export async function getReceipts(env: PushEnv, fetchFn: typeof fetch, ids: readonly string[]): Promise<{ checked: string[]; dead: string[] }> {
  const checked: string[] = [];
  const dead: string[] = [];
  for (let start = 0; start < ids.length; start += EXPO_RECEIPT_BATCH) {
    const chunk = ids.slice(start, start + EXPO_RECEIPT_BATCH);
    try {
      const response = await fetchWithDeadline(
        fetchFn,
        `${env.expoPushUrl}/getReceipts`,
        { method: 'POST', headers: expoHeaders(env), body: JSON.stringify({ ids: chunk }) },
        EXPO_PUSH_TIMEOUT_MS,
      );
      if (!response.ok) continue;
      const body = (await response.json()) as unknown;
      if (!isRecord(body) || !isRecord(body.data)) continue;
      // A Map, so an id is looked up as data, never as an object key.
      const receipts = new Map(Object.entries(body.data));
      for (const id of chunk) {
        if (!receipts.has(id)) continue;
        checked.push(id);
        if (isDeviceGone(receipts.get(id))) dead.push(id);
      }
    } catch {
      // That chunk stays unchecked; the caller asks again next run.
    }
  }
  return { checked, dead };
}

const quoted = (token: string): string => `"${token.replace(/["\\]/g, '\\$&')}"`;

/**
 * Deletes every row holding one of `tokens`, whoever's: Expo said the phone no longer takes them. In
 * chunks of `EXPO_PUSH_BATCH`, so the filter stays a short URL. Throws on failure.
 */
export async function deleteTokens(env: Pick<SupabaseEnv, 'supabaseUrl' | 'serviceRoleKey'>, fetchFn: typeof fetch, tokens: readonly string[]): Promise<void> {
  for (let start = 0; start < tokens.length; start += EXPO_PUSH_BATCH) {
    const list = encodeURIComponent(`in.(${tokens.slice(start, start + EXPO_PUSH_BATCH).map(quoted).join(',')})`);
    await restJson(fetchFn, `${env.supabaseUrl}/rest/v1/push_tokens?token=${list}&select=token`, {
      method: 'DELETE',
      headers: { ...serviceHeaders(env), prefer: 'return=representation' },
    });
  }
}
