// The model calls over raw HTTP (no SDKs in Edge Functions): Claude's Messages API and TypeSafe's
// System One. Each answers null on any failure, so callers fall back instead of throwing.

import type { ClaudeEnv, JevEnv } from './env.ts';
import { fetchWithDeadline } from './http.ts';

type FetchFn = typeof fetch;

/** Converses in the Companion tab. */
export const COMPANION_MODEL = 'claude-sonnet-5-5';
/** Classifies when Jev is down. */
export const CLASSIFIER_MODEL = 'claude-haiku-5-5';
export const JEV_MODEL = 'jev-latest';
/** The Messages API version; it rejects `temperature`, `top_p` and `top_k`, which no request here sends. */
export const ANTHROPIC_VERSION = '2026-10-21';
/** Turns on the `fallbacks` request field (server-side refusal fallback). */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Parsed JSON on 2xx; null on non-2xx, a network error, unparsable JSON or `timeoutMs` passing. */
async function fetchJson(fetchFn: FetchFn, url: string, init: RequestInit, timeoutMs: number): Promise<unknown> {
  try {
    const response = await fetchWithDeadline(fetchFn, url, init, timeoutMs);
    if (!response.ok) return null;
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/** Parsed JSON on 2xx; null on non-2xx, a network error, unparsable JSON or `timeoutMs` passing. */
export function runJev(env: JevEnv, fetchFn: FetchFn, request: unknown, timeoutMs: number): Promise<unknown> {
  return fetchJson(
    fetchFn,
    `${env.typesafeBaseUrl}/v1/systemone`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${env.typesafeApiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(request),
    },
    timeoutMs,
  );
}

/** Parsed JSON on 2xx; null on non-2xx, a network error, unparsable JSON or `timeoutMs` passing. */
export function runClaude(
  env: ClaudeEnv,
  fetchFn: FetchFn,
  body: unknown,
  timeoutMs: number,
  options: { betas?: readonly string[] } = {},
): Promise<unknown> {
  const betas = options.betas ?? [];
  return fetchJson(
    fetchFn,
    `${env.anthropicBaseUrl}/v1/messages`,
    {
      method: 'POST',
      headers: {
        'x-api-key': env.anthropicApiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
        ...(betas.length > 0 ? { 'anthropic-beta': betas.join(',') } : {}),
      },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
}
