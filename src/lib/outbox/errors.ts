// Which failed RPC calls the outbox tries again: the codes are the ones docs/database.md lists for the RPCs.

/** `noResponse`: the server never answered (offline, timeout), so the attempt does not count toward the limit. */
export type SendResult = { ok: true } | { ok: false; permanent: boolean; noResponse?: true };

/**
 * Rejected values and records that are not the caller's never succeed on a retry: 22023 bad key or time,
 * 23514 check, 23502 not null, 22P02 bad text, 22001 too long, 22003 out of range, P0002 not the caller's
 * record, 42501 not allowed.
 */
const PERMANENT_CODES: ReadonlySet<string> = new Set(['22023', '23514', '23502', '22P02', '22001', '22003', 'P0002', '42501']);

export function classifyRpcError(error: { code?: string } | null, status: number): SendResult {
  if (error === null) return { ok: true };
  // postgrest-js reports a fetch that never got an answer as status 0.
  if (status === 0) return { ok: false, permanent: false, noResponse: true };
  // A call the server took as signed out (PostgREST answers 401, even with 42501, when the token was missing
  // or expired): the same call can pass once the session is back.
  if (status === 401) return { ok: false, permanent: false };
  // Checked before the status: PostgREST answers P0002 with a 500.
  if (error.code !== undefined && PERMANENT_CODES.has(error.code)) return { ok: false, permanent: true };
  // A server fault (5xx) or anything unknown is retried; MAX_ATTEMPTS still ends it.
  return { ok: false, permanent: false };
}
