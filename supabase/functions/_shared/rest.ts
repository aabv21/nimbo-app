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
export function rpcClient(env: SupabaseEnv, fetchFn: FetchFn, auth: string): { rpc(name: string, args: Record<string, unknown>): Promise<RpcResult> } {
  return {
    async rpc(name, args) {
      if (!RPC_NAME.test(name)) return { data: null, error: { message: 'invalid rpc name' } };
      try {
        const response = await fetchWithDeadline(
          fetchFn,
          `${env.supabaseUrl}/rest/v1/rpc/${name}`,
          { method: 'POST', headers: { ...userHeaders(env, auth), 'content-type': 'application/json' }, body: JSON.stringify(args) },
          POSTGREST_TIMEOUT_MS,
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
export function premiumClient(env: SupabaseEnv, fetchFn: FetchFn, auth: string): PremiumClient {
  const client = rpcClient(env, fetchFn, auth);
  return {
    async rpc(name, args) {
      const { data, error } = await client.rpc(name, args);
      return { data: typeof data === 'boolean' ? data : null, error };
    },
  };
}
