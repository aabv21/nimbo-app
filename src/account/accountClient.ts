// The account's data rights: thin wrappers over the `export-data` and `delete-account` functions (docs/api.md) that map
// every failure to a small error union the screens translate. Never throw.
import { FunctionsFetchError, FunctionsHttpError, isAuthApiError, isAuthRetryableFetchError } from '@supabase/supabase-js';

import type { Client } from '../auth/emailAuth';
import { localDate } from '../lib/localDate';
import { supabase } from '../lib/supabase';

export type AccountError = 'network' | 'unknown';

/**
 * `reauth`: this session can't make or confirm the deletion (no session, or a 401 Auth doesn't explain as a deleted
 * user), so the user signs in again and retries for a definite answer.
 */
export type DeleteFailure = { ok: false; error: AccountError | 'reauth' };

function errorFrom(error: unknown): AccountError {
  if (error instanceof FunctionsFetchError || error instanceof TypeError || isAuthRetryableFetchError(error)) {
    return 'network';
  }
  return 'unknown';
}

function statusOf(error: unknown): number | undefined {
  return error instanceof FunctionsHttpError && error.context instanceof Response ? error.context.status : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type SessionToken = { access_token: string; user: { id: string } };

/**
 * What Auth says about this very token (`GET /auth/v1/user`, no refresh): `gone` only for `user_not_found`, `exists`
 * for the session's own user, `network` when Auth can't be reached, `other` for anything else (an expired token, a
 * revoked session, another user).
 */
async function tokenUser(client: Client, session: SessionToken): Promise<'gone' | 'exists' | 'network' | 'other'> {
  const { data, error } = await client.auth.getUser(session.access_token);
  if (error === null) return data.user.id === session.user.id ? 'exists' : 'other';
  if (isAuthApiError(error) && error.code === 'user_not_found') return 'gone';
  return isAuthRetryableFetchError(error) ? 'network' : 'other';
}

/**
 * Which answers count as deleted: docs/app.md#account-deletion-on-the-phone. The token is read once and sent explicitly,
 * so a 401 and the Auth check are about the same token.
 */
export async function deleteAccount(client: Client = supabase): Promise<{ ok: true } | DeleteFailure> {
  try {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError !== null && isAuthRetryableFetchError(sessionError)) return { ok: false, error: 'network' };
    const { session } = sessionData;
    if (session === null) return { ok: false, error: 'reauth' };
    const response = await client.functions.invoke<unknown>('delete-account', {
      body: {},
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (response.error === null) {
      return isRecord(response.data) && response.data.outcome === 'deleted' ? { ok: true } : { ok: false, error: 'unknown' };
    }
    if (statusOf(response.error) !== 401) return { ok: false, error: errorFrom(response.error) };
    const status = await tokenUser(client, session);
    if (status === 'gone') return { ok: true };
    return { ok: false, error: status === 'network' ? 'network' : 'reauth' };
  } catch (error) {
    return { ok: false, error: errorFrom(error) };
  }
}

/**
 * Verify only, for a deletion whose answer never arrived: `gone` on `user_not_found`, `exists` for this same user,
 * `unknown` otherwise (no session, another user, Auth unreachable, an expired token).
 */
export async function verifyAccount(userId: string, client: Client = supabase): Promise<'gone' | 'exists' | 'unknown'> {
  try {
    const { session } = (await client.auth.getSession()).data;
    if (session === null || session.user.id !== userId) return 'unknown';
    const status = await tokenUser(client, session);
    return status === 'gone' || status === 'exists' ? status : 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * The signed-in account's server data as the file's text. Only a version 1 document is written: anything else (a newer
 * function's answer, an error body) is `unknown`, never a file.
 */
export async function exportData(client: Client = supabase): Promise<{ ok: true; json: string } | { ok: false; error: AccountError }> {
  try {
    const response = await client.functions.invoke<unknown>('export-data', { body: {} });
    if (response.error !== null) return { ok: false, error: errorFrom(response.error) };
    const body = response.data;
    if (!isRecord(body) || body.schemaVersion !== 1) return { ok: false, error: 'unknown' };
    // NOTE: the parsed body and its text are both in memory, fine up to a few MB of records; upgrade: write the response's raw text to the file (or stream it) once an export nears that.
    return { ok: true, json: JSON.stringify(body, null, 2) };
  } catch (error) {
    return { ok: false, error: errorFrom(error) };
  }
}

/** `nimbo-data-YYYY-MM-DD.json`, named after the device's local day. */
export function exportFileName(now: Date = new Date()): string {
  return `nimbo-data-${localDate(now)}.json`;
}
