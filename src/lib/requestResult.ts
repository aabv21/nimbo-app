/**
 * The outcome of a repository call the UI reports back to the user: the value, or one of three
 * failure kinds a screen can translate.
 */
export type RequestErrorKind = 'network' | 'invalid' | 'unknown';
export type RequestResult<T> = { ok: true; value: T } | { ok: false; kind: RequestErrorKind };

type ErrorWithCode = { code?: string; message?: string };

/**
 * Postgres error classes that mean "the values were rejected" rather than "the request failed":
 * 23514 check_violation, 23502 not_null_violation, 22P02 invalid enum/number text, 22003 numeric
 * out of range, 22001 string too long, 22023 invalid_parameter_value (a zone that is not an IANA name).
 */
const INVALID_VALUE_CODES: ReadonlySet<string> = new Set(['23514', '23502', '22P02', '22003', '22001', '22023']);

export function toRequestErrorKind(error: ErrorWithCode, status: number): RequestErrorKind {
  // postgrest-js reports a rejected `fetch` (offline, DNS, timeout) as status 0 with an empty code.
  if (status === 0) {
    return 'network';
  }
  if (error.code !== undefined && INVALID_VALUE_CODES.has(error.code)) {
    return 'invalid';
  }
  return 'unknown';
}

/** A fetch that threw instead of answering is a network failure; anything else is unknown. */
export function toThrownErrorKind(error: unknown): RequestErrorKind {
  return error instanceof TypeError ? 'network' : 'unknown';
}
