// export-data and delete-account on the local stack: two users with rows in every user table (tracking rows through the
// app's RPCs, the server-only ones through the service client), A's export, paging, the gateway's JWT check, and A's
// deletion cascading through all 14 tables. Needs `pnpm db:start` and `pnpm env:local`.

import { randomBytes, randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { signInWithEmail } from '../src/auth/emailAuth';
import type { Database } from '../src/lib/database.types';
import { EXCLUDED_TABLES, EXPORTED_TABLES } from '../supabase/functions/export-data/handler.ts';
import { anonClient, createUser, deleteUser, loadIntegrationEnv, serviceClient, uniqueEmail } from './helpers';

loadIntegrationEnv();

const PASSWORD = 'Password123!';
const USER_TABLES = [...EXPORTED_TABLES, ...EXCLUDED_TABLES];

type Seeded = { id: string; email: string; client: SupabaseClient<Database>; token: string; rowIds: string[]; pushToken: string };

const users: string[] = [];
let a: Seeded;
let b: Seeded;

function call(name: 'export-data' | 'delete-account', authorization: string): Promise<Response> {
  return fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''}/functions/v1/${name}`, {
    method: 'POST',
    headers: { authorization, apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '', 'content-type': 'application/json' },
    body: '{}',
  });
}

const minutesAgo = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();
const today = (): string => new Date().toISOString().slice(0, 10);

/** A signed-in user with a row in every one of the 14 user tables. */
async function seed(label: string): Promise<Seeded> {
  const email = uniqueEmail(label);
  const id = await createUser(email, PASSWORD);
  users.push(id);
  const client = anonClient();
  expect(await signInWithEmail(email, PASSWORD, client)).toEqual({ ok: true });
  const token = (await client.auth.getSession()).data.session?.access_token ?? '';
  expect(token).not.toBe('');

  const medicationId = randomUUID();
  const episodeId = randomUUID();
  const doseIds = [randomUUID(), randomUUID()];
  const pushToken = `ExponentPushToken[int-account-${randomUUID()}]`;
  const steps = [
    () => client.rpc('accept_terms', { p_adult: true, p_boundary: true, p_health: true, p_version: '2026-12-01', p_locale: 'en' }),
    () => client.rpc('set_ai_consent', { p_enabled: true, p_version: '2026-12-01', p_locale: 'en' }),
    () => client.rpc('save_medication', { p_id: medicationId, p_fields: { name: 'Ibuprofen', kind: 'acute', form: 'oral', class: 'simple_analgesic' } }),
    () => client.rpc('log_episode', { p_id: episodeId, p_started_at: minutesAgo(120), p_fields: { intensity: 6 } }),
    () => client.rpc('log_dose', { p_id: doseIds[0] ?? '', p_medication_id: medicationId, p_taken_at: minutesAgo(90), p_episode_id: episodeId }),
    () => client.rpc('log_dose', { p_id: doseIds[1] ?? '', p_medication_id: medicationId, p_taken_at: minutesAgo(30) }),
    () => client.rpc('save_checkin', { p_local_date: today(), p_fields: { sleep_band: '6_7' } }),
    () => client.rpc('save_agent_note', { p_text: 'Prefers short answers' }),
    () => client.rpc('register_push_token', { p_token: pushToken, p_platform: 'android', p_device_secret: randomBytes(32).toString('hex') }),
  ];
  for (const step of steps) expect((await step()).error).toBeNull();

  const service = serviceClient();
  const signalId = randomUUID();
  const writes = await Promise.all([
    service.from('signals').insert({ id: signalId, user_id: id, kind: 'long_attack', cause: 'attack', cause_key: `long_attack:${episodeId}`, local_date: today(), evidence: {} }),
    service.from('usage_counters').insert({ user_id: id, day: today(), kind: 'companion', count: 2 }),
    service.from('entitlements').upsert({ user_id: id, granted: true }),
    service.from('push_tickets').insert({ ticket_id: `int-account-${randomUUID()}`, token: pushToken, user_id: id }),
    service.from('push_claims').insert({
      token: `ExponentPushToken[int-claim-${randomUUID()}]`,
      user_id: id,
      code_hash: 'c'.repeat(64),
      nonce_hash: 'd'.repeat(64),
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    }),
    service.from('push_claim_starts').insert({ token: pushToken, user_id: id }),
  ]);
  for (const { error } of writes) expect(error).toBeNull();
  return { id, email, client, token, rowIds: [id, medicationId, episodeId, signalId, ...doseIds], pushToken };
}

async function rowCount(table: (typeof USER_TABLES)[number], userId: string): Promise<number> {
  const { count, error } = await serviceClient().from(table).select('*', { count: 'exact', head: true }).eq('user_id', userId);
  expect(error).toBeNull();
  return count ?? -1;
}

beforeAll(async () => {
  a = await seed('account-a');
  b = await seed('account-b');
}, 30_000);

afterAll(async () => {
  for (const id of users) await deleteUser(id);
});

type Exported = Record<string, unknown> & { schemaVersion: number; termsVersion: string | null; account: { email: string; providers: string[] }; episodes: unknown[] };

test('both users start with a row in each of the 14 user tables', async () => {
  for (const user of [a, b]) {
    for (const table of USER_TABLES) expect([table, await rowCount(table, user.id)]).not.toEqual([table, 0]);
  }
});

test('A’s export has every section filled, the versions and the account, and nothing of B', async () => {
  const response = await call('export-data', `Bearer ${a.token}`);
  expect(response.status).toBe(200);
  const text = await response.text();
  const body = JSON.parse(text) as Exported;

  expect(body.schemaVersion).toBe(1);
  expect(body.termsVersion).toBe('2026-12-01');
  expect(body.aiConsentVersion).toBe('2026-12-01');
  expect(body.account.email).toBe(a.email);
  expect(body.account.providers).toContain('email');
  const sections = new Map(Object.entries(body));
  for (const section of ['episodes', 'medications', 'doses', 'checkins', 'agentNotes', 'signals', 'usageCounters', 'consentEvents', 'pushDevices']) {
    const rows = sections.get(section);
    expect([section, Array.isArray(rows) && rows.length > 0]).toEqual([section, true]);
  }
  expect(body.profile).not.toBeNull();
  expect(body.entitlement).not.toBeNull();
  expect(body.doses).toHaveLength(2);
  expect(body.consentEvents).toHaveLength(2);
  for (const id of b.rowIds) expect(text).not.toContain(id);
  expect(text).not.toContain('ExponentPushToken');
  expect(text).not.toContain('device_secret_hash');
});

test('1001 episodes inserted for A export completely', async () => {
  const rows = Array.from({ length: 1001 }, (_, n) => ({ id: randomUUID(), user_id: a.id, started_at: minutesAgo(10_000 + n), ended_at: minutesAgo(9_000 + n) }));
  const { error } = await serviceClient().from('episodes').insert(rows);
  expect(error).toBeNull();

  const response = await call('export-data', `Bearer ${a.token}`);
  expect(response.status).toBe(200);
  const body = (await response.json()) as Exported;
  expect(body.episodes).toHaveLength(1002);
}, 20_000);

test('a garbage bearer gets 401 from both functions', async () => {
  for (const name of ['export-data', 'delete-account'] as const) {
    expect([name, (await call(name, 'Bearer not.a.jwt')).status]).toEqual([name, 401]);
  }
});

test('A’s delete removes the account and every row of A in the 14 tables, and leaves B alone', async () => {
  const response = await call('delete-account', `Bearer ${a.token}`);
  expect([response.status, await response.json()]).toEqual([200, { outcome: 'deleted' }]);

  for (const table of USER_TABLES) expect([table, await rowCount(table, a.id)]).toEqual([table, 0]);
  for (const table of USER_TABLES) expect([table, await rowCount(table, b.id)]).not.toEqual([table, 0]);
  expect((await serviceClient().auth.admin.getUserById(a.id)).error).not.toBeNull();
});

test('a second delete with A’s old token answers deleted', async () => {
  const response = await call('delete-account', `Bearer ${a.token}`);
  expect([response.status, await response.json()]).toEqual([200, { outcome: 'deleted' }]);
});
