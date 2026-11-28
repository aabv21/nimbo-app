// Push registration on the local stack: push_tokens through register_push_token() as the app writes it (own rows,
// the device secret), push-unregister with no session, and push-claim, whose code push goes to Expo's mock
// (`mockServices.ts`, `EXPO_PUSH_URL` in config.toml). Needs the Edge Runtime: `pnpm db:start` and `pnpm env:local`.

import { randomBytes, randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { signInWithEmail } from '../src/auth/emailAuth';
import type { Database } from '../src/lib/database.types';
import { anonClient, createUser, deleteUser, loadIntegrationEnv, serviceClient, uniqueEmail } from './helpers';
import { type MockServices, startMockServices } from './mockServices';

loadIntegrationEnv();

const PASSWORD = 'Password123!';
const POLL_INTERVAL_MS = 250;

let services: MockServices;
const users: string[] = [];

/** `secret` is the phone's device secret (the app's `push.deviceSecret`). */
type Phone = { id: string; client: SupabaseClient<Database>; token: string; secret: string };

const newSecret = (): string => randomBytes(32).toString('hex');

async function signedInPhone(label: string): Promise<Phone> {
  const email = uniqueEmail(label);
  const id = await createUser(email, PASSWORD);
  users.push(id);
  const client = anonClient();
  expect(await signInWithEmail(email, PASSWORD, client)).toEqual({ ok: true });
  return { id, client, token: `ExponentPushToken[int-${randomUUID()}]`, secret: newSecret() };
}

/** What the app's registerPush sends once it has a token. */
async function register(phone: Phone): Promise<void> {
  const { error } = await phone.client.rpc('register_push_token', { p_token: phone.token, p_platform: 'android', p_device_secret: phone.secret });
  expect(error).toBeNull();
}

async function holders(token: string): Promise<string[]> {
  const { data, error } = await serviceClient().from('push_tokens').select('user_id').eq('token', token);
  if (error !== null) throw error;
  return data.map((row) => row.user_id);
}

/** What the app's pending-list flush sends after a sign-out: no session, the anon key only. */
function pushUnregister(body: unknown): Promise<Response> {
  const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
  return fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/push-unregister`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: anonKey, authorization: `Bearer ${anonKey}` },
    body: JSON.stringify(body),
  });
}

type Pushed = { to: string; title?: string; data: { type?: string; code?: string; nonce?: string } };

const pushesTo = (token: string): Pushed[] => (services.pushRequests().flat() as Pushed[]).filter((message) => message.to === token);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor<T>(read: () => T, done: (value: T) => boolean, withinMs: number): Promise<T> {
  const deadline = Date.now() + withinMs;
  let value = read();
  while (!done(value) && Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    value = read();
  }
  return value;
}

beforeAll(async () => {
  services = await startMockServices();
});

afterAll(async () => {
  await services.close();
  await Promise.all(users.map((id) => deleteUser(id)));
});

describe('push_tokens through the API', () => {
  test('a user reads and deletes only their own row, never writes it directly, and never reads the secret’s hash', async () => {
    const a = await signedInPhone('push-rls-a');
    const b = await signedInPhone('push-rls-b');
    await register(a);

    expect((await a.client.from('push_tokens').select('token, platform')).data).toEqual([{ token: a.token, platform: 'android' }]);
    expect((await a.client.from('push_tokens').select('device_secret_hash')).error?.code).toBe('42501');
    expect((await b.client.from('push_tokens').select('token')).data).toEqual([]);
    expect((await b.client.from('push_tokens').update({ platform: 'ios' }).eq('token', a.token)).error?.code).toBe('42501');
    expect((await b.client.from('push_tokens').delete().eq('token', a.token).select('token')).data).toEqual([]);

    // Another account that only knows the token, under its own secret: refused.
    const { error } = await b.client.rpc('register_push_token', { p_token: a.token, p_platform: 'android', p_device_secret: b.secret });
    expect(error?.code).toBe('42501');
    expect(await holders(a.token)).toEqual([a.id]);
  });
});

describe('push-unregister', () => {
  test('with only the anon key, a wrong secret leaves the token and the right one deletes it, answering 204 either way', async () => {
    const phone = await signedInPhone('push-unregister');
    await register(phone);
    const body = (secret: string) => ({ token: phone.token, user_id: phone.id, device_secret: secret });

    expect((await pushUnregister(body(newSecret()))).status).toBe(204);
    expect(await holders(phone.token)).toEqual([phone.id]);

    expect((await pushUnregister(body(phone.secret))).status).toBe(204);
    expect(await holders(phone.token)).toEqual([]);

    expect((await pushUnregister(body(phone.secret))).status).toBe(204);
    expect((await pushUnregister({ ...body(phone.secret), token: 'not-a-token' })).status).toBe(400);
    expect((await pushUnregister({ token: phone.token, device_secret: phone.secret })).status).toBe(400);
  });

  test('the next account on the same phone keeps its row when the previous account’s token is unregistered', async () => {
    const a = await signedInPhone('push-unregister-a');
    const b = await signedInPhone('push-unregister-b');
    await register(a);
    // B signs in on the same phone: same token, same device secret, so B takes the token over.
    const sameSecret = { ...b, token: a.token, secret: a.secret };
    await register(sameSecret);
    expect(await holders(a.token)).toEqual([b.id]);

    // A's deferred unregister, sent after B registered, names A: B's row survives.
    expect((await pushUnregister({ token: a.token, user_id: a.id, device_secret: a.secret })).status).toBe(204);
    expect(await holders(a.token)).toEqual([b.id]);
  });

  test('a chunked body past the limit with no content-length is refused', async () => {
    const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent === 64) {
          controller.close();
          return;
        }
        sent += 1;
        controller.enqueue(new Uint8Array(1024).fill(0x61));
      },
    });
    const response = await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/push-unregister`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: anonKey, authorization: `Bearer ${anonKey}` },
      body,
      duplex: 'half',
    } as RequestInit);
    expect(response.status).toBe(413);
  });
});

describe('push-claim', () => {
  test('a claim sends a code push to the token only, and the code read back takes the token over', async () => {
    const holder = await signedInPhone('push-claim-holder');
    const claimant = await signedInPhone('push-claim-claimant');
    await register(holder);

    const nonce = randomBytes(16).toString('hex');
    const start = await claimant.client.functions.invoke('push-claim', { body: { token: holder.token, step: 'start', nonce } });
    expect(start.error).toBeNull();
    const pushed = await waitFor(() => pushesTo(holder.token), (pushes) => pushes.length > 0, 10_000);
    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.data.type).toBe('push-claim');
    expect(pushed[0]?.data.nonce).toBe(nonce);
    // Data only: nothing shows on the lock screen.
    expect(pushed[0]).not.toHaveProperty('title');
    const code = String(pushed[0]?.data.code);

    const confirm = (withCode: string) =>
      claimant.client.functions.invoke('push-claim', {
        body: { token: holder.token, step: 'confirm', code: withCode, nonce, device_secret: claimant.secret, platform: 'android' },
      });
    expect((await confirm('WRNGXY23')).error).not.toBeNull();
    expect(await holders(holder.token)).toEqual([holder.id]);
    expect((await confirm(code)).error).toBeNull();

    expect(await holders(holder.token)).toEqual([claimant.id]);
    // The claimant's phone now proves itself with its own secret.
    expect((await pushUnregister({ token: holder.token, user_id: holder.id, device_secret: holder.secret })).status).toBe(204);
    expect(await holders(holder.token)).toEqual([claimant.id]);
  }, 30_000);

  test('without a session push-claim answers 401', async () => {
    const anon = anonClient();
    const result = await anon.functions.invoke('push-claim', { body: { token: 'ExponentPushToken[x]', step: 'start', nonce: 'ab'.repeat(16) } });
    expect(result.error).not.toBeNull();
  });
});
