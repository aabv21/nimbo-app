// PostgREST over fetch, as the caller (their token, so RLS applies) or with the service role, which
// bypasses RLS and is kept for writes no client may make.

import type { SupabaseEnv } from './env.ts';
import { isRecord } from './guards.ts';
import { fetchWithDeadline } from './http.ts';
import type { PremiumClient } from './premium.ts';

type FetchFn = typeof fetch;

/** Every PostgREST call; the database answers in milliseconds, so this only bounds a hung connection. */
export const POSTGREST_TIMEOUT_MS = 8_000;

export class UpstreamError extends Error {}

/** Auth's words for a token it will not honor: signed out, expired, or not a valid JWT. */
const REFUSED_SESSION = new Set(['session_not_found', 'session_expired', 'bad_jwt', 'no_authorization']);

/** Whether Auth's answer (`GET /auth/v1/user`) refuses the caller's own session, which the function answers 401. */
export function sessionRefused(status: number, body: unknown): boolean {
  return status === 401 || (status === 403 && isRecord(body) && typeof body.error_code === 'string' && REFUSED_SESSION.has(body.error_code));
}

/** Thrown when Auth refuses the caller's session: the request is answered 401, never 500. */
export class RefusedSession extends Error {}

/** Headers for a request made as the caller: RLS applies. */
export function userHeaders(env: SupabaseEnv, auth: string): Record<string, string> {
  return { apikey: env.anonKey, authorization: auth };
}

/** Headers for a request made with the service role, which bypasses RLS. */
export function serviceHeaders(env: Pick<SupabaseEnv, 'serviceRoleKey'>): Record<string, string> {
  return { apikey: env.serviceRoleKey, authorization: `Bearer ${env.serviceRoleKey}` };
}

/** One call's JSON answer, bounded by `timeoutMs` (a hung connection can't hold the function); throws on non-2xx. */
export async function restJson(fetchFn: FetchFn, url: string, init: RequestInit, timeoutMs = POSTGREST_TIMEOUT_MS): Promise<unknown> {
  const response = await fetchWithDeadline(fetchFn, url, init, timeoutMs);
  if (!response.ok) throw new UpstreamError(`HTTP ${String(response.status)}`);
  return (await response.json()) as unknown;
}

export type RpcResult = { data: unknown; error: unknown };

// The name goes into the URL path, so only a plain Postgres identifier is sent.
const RPC_NAME = /^[a-z_][a-z0-9_]*$/;

/**
 * Calls RPCs as the caller, shaped like supabase-js's `rpc`: never throws; a PostgREST error, a
 * network error, the timeout or a body that isn't JSON answers `data: null` and an `error`.
 */
export function rpcClient(
  env: SupabaseEnv,
  fetchFn: FetchFn,
  auth: string,
  timeoutMs = POSTGREST_TIMEOUT_MS,
): { rpc(name: string, args: Record<string, unknown>): Promise<RpcResult> } {
  return {
    async rpc(name, args) {
      if (!RPC_NAME.test(name)) return { data: null, error: { message: 'invalid rpc name' } };
      try {
        const response = await fetchWithDeadline(
          fetchFn,
          `${env.supabaseUrl}/rest/v1/rpc/${name}`,
          { method: 'POST', headers: { ...userHeaders(env, auth), 'content-type': 'application/json' }, body: JSON.stringify(args) },
          timeoutMs,
        );
        const text = await response.text();
        const body: unknown = text === '' ? null : JSON.parse(text);
        if (!response.ok) return { data: null, error: isRecord(body) ? body : { status: response.status } };
        return { data: body, error: null };
      } catch (error) {
        return { data: null, error: { message: error instanceof Error ? error.name : 'failed' } };
      }
    },
  };
}

/** `rpcClient` narrowed to Wave 2's `PremiumClient`: any `data` that is not a boolean reads as null. */
export function premiumClient(env: SupabaseEnv, fetchFn: FetchFn, auth: string, timeoutMs = POSTGREST_TIMEOUT_MS): PremiumClient {
  const client = rpcClient(env, fetchFn, auth, timeoutMs);
  return {
    async rpc(name, args) {
      const { data, error } = await client.rpc(name, args);
      return { data: typeof data === 'boolean' ? data : null, error };
    },
  };
}
