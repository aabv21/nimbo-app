// Deletes one account's push_tokens row for this phone, with no session needed: a phone that signed out sends the
// token, the account it held it for and its device secret (docs/api.md#push-unregister). Logs only an outcome word.

import type { SupabaseEnv } from '../_shared/env.ts';
import { isRecord, UUID } from '../_shared/guards.ts';
import { bodyProblemReply, readJsonCapped, reply } from '../_shared/http.ts';
import { restJson, serviceHeaders } from '../_shared/rest.ts';

export type PushUnregisterDeps = { env: Pick<SupabaseEnv, 'supabaseUrl' | 'serviceRoleKey'>; fetch: typeof fetch };

/** One token and secret's JSON is well under this; anything bigger is refused unread. */
export const MAX_BODY_BYTES = 1024;

// The same rules as push_tokens' token check and register_push_token()'s secret check.
const TOKEN = /^(ExponentPushToken|ExpoPushToken)\[.+\]$/;
const MAX_TOKEN_LENGTH = 255;
const DEVICE_SECRET = /^[0-9a-f]{32,128}$/;

type Body = { token: string; user_id: string; device_secret: string };

function isBody(value: unknown): value is Body {
  return (
    isRecord(value) &&
    typeof value.token === 'string' &&
    value.token.length <= MAX_TOKEN_LENGTH &&
    TOKEN.test(value.token) &&
    typeof value.user_id === 'string' &&
    UUID.test(value.user_id) &&
    typeof value.device_secret === 'string' &&
    DEVICE_SECRET.test(value.device_secret)
  );
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function handlePushUnregister(request: Request, deps: PushUnregisterDeps): Promise<Response> {
  if (request.method !== 'POST') return reply('invalid', 405, { error: 'method_not_allowed' });
  const read = await readJsonCapped(request, MAX_BODY_BYTES);
  if (!read.ok) return bodyProblemReply(read.reason);
  const body = read.value;
  if (!isBody(body)) return reply('invalid', 400, { error: 'invalid_body' });

  // Only the named account's row registered with this phone's secret matches: knowing the token alone deletes nothing,
  // and the device-wide secret can't reach the row of the account signed in after.
  const filter = [
    `token=eq.${encodeURIComponent(body.token)}`,
    `user_id=eq.${body.user_id.toLowerCase()}`,
    `device_secret_hash=eq.${await sha256Hex(body.device_secret)}`,
    'select=token',
  ].join('&');
  try {
    await restJson(deps.fetch, `${deps.env.supabaseUrl}/rest/v1/push_tokens?${filter}`, {
      method: 'DELETE',
      headers: { ...serviceHeaders(deps.env), prefer: 'return=representation' },
    });
  } catch {
    return reply('error', 500, { error: 'internal' });
  }
  // The same answer whether a row matched or not, so the call can't tell which tokens exist.
  console.info(JSON.stringify({ outcome: 'unregistered' }));
  return new Response(null, { status: 204 });
}
