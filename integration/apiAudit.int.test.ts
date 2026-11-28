// The API audit through the local gateway (docs/audits/api.md): bad and expired JWTs, a signed-out token, chunked bodies
// past the caps, CORS and error bodies. Needs `pnpm db:start` and `pnpm env:local`.

import { execFileSync } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';

import { signInWithEmail } from '../src/auth/emailAuth';
import { anonClient, createUser, deleteUser, loadIntegrationEnv, serviceClient, uniqueEmail } from './helpers';

loadIntegrationEnv();

const PASSWORD = 'Password123!';
const JWT_FUNCTIONS = ['companion', 'push-claim', 'export-data', 'delete-account'] as const;
const ALL_FUNCTIONS = [...JWT_FUNCTIONS, 'push-unregister', 'monitor'] as const;
type FunctionName = (typeof ALL_FUNCTIONS)[number];

const url = (name: FunctionName): string => `${process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/${name}`;
const anonKey = (): string => process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** The local stack's JWT secret, from the CLI (it is the stack's fixed development value, never a hosted one). */
function localJwtSecret(): string {
  const status = execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'env'], { encoding: 'utf8' });
  const line = status.split('\n').find((entry) => entry.startsWith('JWT_SECRET='));
  const secret = line?.slice('JWT_SECRET='.length).replace(/^"|"$/g, '') ?? '';
  if (secret.length === 0) throw new Error('supabase status did not print JWT_SECRET');
  return secret;
}

const base64url = (value: string | Buffer): string => Buffer.from(value).toString('base64url');

/** An HS256 user JWT signed with the local secret, as Auth issues them, with the given lifetime around now. */
function signedJwt(secret: string, userId: string, offsetsSeconds: { iat: number; exp: number }): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({ aud: 'authenticated', role: 'authenticated', sub: userId, iat: now + offsetsSeconds.iat, exp: now + offsetsSeconds.exp }),
  );
  const signature = createHmac('sha256', secret).update(`${header}.${claims}`).digest('base64url');
  return `${header}.${claims}.${signature}`;
}

function post(name: FunctionName, authorization: string, body: BodyInit = '{}', extra: RequestInit = {}): Promise<Response> {
  return fetch(url(name), {
    method: 'POST',
    headers: { authorization, apikey: anonKey(), 'content-type': 'application/json' },
    body,
    ...extra,
  });
}

/** A body sent in chunks with no content-length, `bytes` long in all. */
function chunked(bytes: number): ReadableStream<Uint8Array> {
  const chunk = new TextEncoder().encode('x'.repeat(1024));
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent >= bytes) {
        controller.close();
        return;
      }
      controller.enqueue(chunk);
      sent += chunk.byteLength;
    },
  });
}

const users: string[] = [];

async function signedIn(label: string): Promise<{ id: string; email: string; token: string; client: ReturnType<typeof anonClient>; signOut: () => Promise<void> }> {
  const email = uniqueEmail(label);
  const id = await createUser(email, PASSWORD);
  users.push(id);
  const client = anonClient();
  expect(await signInWithEmail(email, PASSWORD, client)).toEqual({ ok: true });
  const token = (await client.auth.getSession()).data.session?.access_token ?? '';
  expect(token).not.toBe('');
  return {
    id,
    email,
    token,
    client,
    signOut: async () => {
      expect((await client.auth.signOut()).error).toBeNull();
    },
  };
}

async function exists(userId: string): Promise<boolean> {
  const { data, error } = await serviceClient().auth.admin.getUserById(userId);
  if (error !== null && error.status !== 404) throw error;
  return data.user !== null;
}

afterAll(async () => {
  for (const id of users) await deleteUser(id);
});

describe('broken authentication (API2)', () => {
  test.each(JWT_FUNCTIONS)('%s answers 401 to a garbage bearer and to none', async (name) => {
    expect((await post(name, 'Bearer not.a.jwt')).status).toBe(401);
    expect((await post(name, 'Bearer ' + base64url(randomBytes(48)))).status).toBe(401);
    expect((await fetch(url(name), { method: 'POST', headers: { apikey: anonKey() }, body: '{}' })).status).toBe(401);
  });

  test.each(JWT_FUNCTIONS)('%s answers 401 to an expired JWT signed with the right key', async (name) => {
    const user = await signedIn(`audit-expired-${name}`);
    const expired = signedJwt(localJwtSecret(), user.id, { iat: -7200, exp: -60 });
    expect((await post(name, `Bearer ${expired}`)).status).toBe(401);
    expect(await exists(user.id)).toBe(true);
  });

  test('the same signing with a live expiry gets past the gateway, so the 401s above are the expiry', async () => {
    const user = await signedIn('audit-live-control');
    const live = signedJwt(localJwtSecret(), user.id, { iat: -60, exp: 600 });
    expect((await post('export-data', `Bearer ${live}`)).status).not.toBe(401);
  });

  test('a JWT signed with another key is 401', async () => {
    const user = await signedIn('audit-wrong-key');
    const forged = signedJwt(randomBytes(32).toString('hex'), user.id, { iat: -60, exp: 600 });
    for (const name of JWT_FUNCTIONS) expect([name, (await post(name, `Bearer ${forged}`)).status]).toEqual([name, 401]);
  });

  test('the anon key as a bearer reaches no user function: it has no user', async () => {
    for (const name of JWT_FUNCTIONS) expect([name, (await post(name, `Bearer ${anonKey()}`)).status]).toEqual([name, 401]);
  });

  test('after sign-out the old access token can neither export nor delete: both ask Auth about the session first, then answer 401', async () => {
    const user = await signedIn('audit-signed-out');
    await user.signOut();
    const exported = await post('export-data', `Bearer ${user.token}`);
    expect([exported.status, (await exported.json()) as unknown]).toEqual([401, { error: 'unauthorized' }]);
    const deleted = await post('delete-account', `Bearer ${user.token}`);
    expect([deleted.status, (await deleted.json()) as unknown]).toEqual([401, { error: 'unauthorized' }]);
    expect(await exists(user.id)).toBe(true);
  });
});

describe('secure password change (SEC-16)', () => {
  /** The `session_id` claim of an access token (Auth's own row in `auth.sessions`). */
  const sessionIdOf = (token: string): string => {
    const claims: unknown = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return typeof claims === 'object' && claims !== null && 'session_id' in claims && typeof claims.session_id === 'string' ? claims.session_id : '';
  };

  test('a session made today changes the password (the recovery flow relies on it); one older than 24 h needs a nonce', async () => {
    const fresh = await signedIn('audit-password-fresh');
    expect((await fresh.client.auth.updateUser({ password: 'Password456!' })).error).toBeNull();

    const aged = await signedIn('audit-password-aged');
    const sessionId = sessionIdOf(aged.token);
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
    // As a session signed in 25 hours ago, still refreshed and live: only the session's age changes.
    execFileSync('docker', ['exec', 'supabase_db_nimbo-app', 'psql', '-U', 'postgres', '-At', '-c', `update auth.sessions set created_at = now() - interval '25 hours' where id = '${sessionId}'`]);
    const { error } = await aged.client.auth.updateUser({ password: 'Password789!' });
    expect(error?.code).toBe('reauthentication_needed');
    expect(await signInWithEmail(aged.email, PASSWORD, anonClient())).toEqual({ ok: true });
  });
});

describe('resource limits (API4)', () => {
  test('companion: a chunked body past 64 KiB with no content-length is 413', async () => {
    const user = await signedIn('audit-cap-companion');
    const response = await post('companion', `Bearer ${user.token}`, chunked(64 * 1024 + 1024), { duplex: 'half' } as RequestInit);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'payload_too_large' });
  });

  test('push-claim: a chunked body past 2048 bytes with no content-length is 413', async () => {
    const user = await signedIn('audit-cap-claim');
    const response = await post('push-claim', `Bearer ${user.token}`, chunked(3 * 1024), { duplex: 'half' } as RequestInit);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'payload_too_large' });
  });

  test('push-unregister: a chunked body past 1024 bytes with no content-length is 413', async () => {
    const response = await post('push-unregister', `Bearer ${anonKey()}`, chunked(2 * 1024), { duplex: 'half' } as RequestInit);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: 'payload_too_large' });
  });
});

describe('misconfiguration (API8)', () => {
  // The gateway (not the function) answers a preflight with its platform-wide `*`; it never reflects the origin or allows
  // credentials, so a page elsewhere gains nothing it could not do without the user's token (docs/audits/api.md).
  test.each(ALL_FUNCTIONS)('%s: a browser preflight never reflects the origin or allows credentials', async (name) => {
    const origin = 'https://attacker.example';
    const preflight = await fetch(url(name), {
      method: 'OPTIONS',
      headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization' },
    });
    expect(preflight.headers.get('access-control-allow-origin')).not.toBe(origin);
    expect(preflight.headers.get('access-control-allow-credentials')).not.toBe('true');
    const answer = await fetch(url(name), { method: 'POST', headers: { origin, apikey: anonKey() }, body: '{}' });
    expect(answer.headers.get('access-control-allow-origin')).not.toBe(origin);
    expect(answer.headers.get('access-control-allow-credentials')).not.toBe('true');
  });

  test('an error answer is a fixed word with no detail', async () => {
    const user = await signedIn('audit-errors');
    const answers = [
      await fetch(url('export-data'), { method: 'GET', headers: { authorization: `Bearer ${user.token}`, apikey: anonKey() } }),
      await post('push-claim', `Bearer ${user.token}`, '{"token": "x\' or 1=1 --"}'),
      await post('push-unregister', `Bearer ${anonKey()}`, 'not json at all'),
      await post('monitor', `Bearer ${anonKey()}`),
    ];
    expect(await Promise.all(answers.map(async (response) => [response.status, (await response.json()) as unknown]))).toEqual([
      [405, { error: 'method_not_allowed' }],
      [400, { error: 'invalid_body' }],
      [400, { error: 'invalid_body' }],
      [401, { error: 'unauthorized' }],
    ]);
  });
});
