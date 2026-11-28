// Deletes the caller's account; every user table cascades from auth.users, and why a retry is safe: docs/api.md#delete-account.
// The uid is always the verified JWT's `sub`. Logs carry outcome words only.

// NOTE: no Apple token revoke while iOS is parked; upgrade: copy Dressing Room's `_shared/apple.ts` step when Sign in with Apple ships.

import type { SupabaseEnv } from '../_shared/env.ts';
import { isRecord } from '../_shared/guards.ts';
import { bodyProblemReply, callerOf, fetchWithDeadline, readBodyCapped, reply } from '../_shared/http.ts';
import { serviceHeaders, UpstreamError, userHeaders } from '../_shared/rest.ts';

export type DeleteAccountDeps = { env: SupabaseEnv; fetch: typeof fetch };

/** Each Auth call, the body included. */
export const AUTH_TIMEOUT_MS = 10_000;
/** The phone sends no body; anything past this is refused unread. */
export const MAX_BODY_BYTES = 256;

/**
 * False only on Auth's `user_not_found`. Throws on anything else, a bare 404 included (a misrouted gateway answers 404
 * too), so nothing is reported deleted on an answer that can't be trusted.
 */
async function callerExists(env: SupabaseEnv, fetchFn: typeof fetch, auth: string, userId: string): Promise<boolean> {
  const response = await fetchWithDeadline(fetchFn, `${env.supabaseUrl}/auth/v1/user`, { headers: userHeaders(env, auth) }, AUTH_TIMEOUT_MS);
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (isRecord(body) && body.error_code === 'user_not_found') return false;
  if (!response.ok) throw new UpstreamError(`auth user: HTTP ${String(response.status)}`);
  if (!isRecord(body) || typeof body.id !== 'string' || body.id.toLowerCase() !== userId) {
    throw new UpstreamError('auth user: not the caller');
  }
  return true;
}

/** Deletes the auth user: true when this call deleted it, false on a 404 (an earlier attempt did). */
async function deleteUser(env: SupabaseEnv, fetchFn: typeof fetch, userId: string): Promise<boolean> {
  const response = await fetchWithDeadline(
    fetchFn,
    `${env.supabaseUrl}/auth/v1/admin/users/${userId}`,
    { method: 'DELETE', headers: serviceHeaders(env) },
    AUTH_TIMEOUT_MS,
  );
  if (response.status === 404) return false;
  if (!response.ok) throw new UpstreamError(`admin delete: HTTP ${String(response.status)}`);
  return true;
}

export async function handleDeleteAccount(request: Request, deps: DeleteAccountDeps): Promise<Response> {
  if (request.method !== 'POST') return reply('invalid', 405, { error: 'method_not_allowed' });
  const caller = callerOf(request);
  if (caller === null) return reply('invalid', 401, { error: 'unauthorized' });
  const body = await readBodyCapped(request, MAX_BODY_BYTES);
  if (!body.ok) return bodyProblemReply(body.reason);
  const { auth, userId } = caller;

  const { env, fetch: fetchFn } = deps;
  try {
    if (!(await callerExists(env, fetchFn, auth, userId))) return reply('already_deleted', 200, { outcome: 'deleted' });
    if (!(await deleteUser(env, fetchFn, userId))) return reply('already_deleted', 200, { outcome: 'deleted' });
  } catch {
    return reply('error', 500, { error: 'internal' });
  }
  return reply('deleted', 200, { outcome: 'deleted' });
}
