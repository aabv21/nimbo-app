// The daily AI quotas, counted per user, kind and local day by `public.consume_quota` (service role
// only, so a client can neither spend nor read another user's counter).

import type { SupabaseEnv } from './env.ts';
import { POSTGREST_TIMEOUT_MS, restJson, serviceHeaders } from './rest.ts';

export type QuotaKind = 'companion' | 'dictation';

export const DAILY_LIMITS: Readonly<Record<QuotaKind, number>> = { companion: 40, dictation: 20 };

/**
 * Spends one unit of `kind` on `day`, the app's local day (the database counts on the UTC day when
 * it is over a day off). True only when the database answers exactly `true`; throws when the RPC fails
 * or `timeoutMs` passes.
 */
export async function consumeQuota(
  env: SupabaseEnv,
  fetchFn: typeof fetch,
  userId: string,
  kind: QuotaKind,
  limit: number,
  day: string,
  timeoutMs = POSTGREST_TIMEOUT_MS,
): Promise<boolean> {
  const allowed = await restJson(
    fetchFn,
    `${env.supabaseUrl}/rest/v1/rpc/consume_quota`,
    {
      method: 'POST',
      headers: { ...serviceHeaders(env), 'content-type': 'application/json' },
      body: JSON.stringify({ p_user_id: userId, p_kind: kind, p_limit: limit, p_day: day }),
    },
    timeoutMs,
  );
  return allowed === true;
}
