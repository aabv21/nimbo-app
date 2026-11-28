// The outbox and the pull against the running local stack: operations drain in order, a replayed call
// never duplicates a row, another account's record is a permanent failure, and the pull reads back what was sent.

import { randomUUID } from 'node:crypto';

import { signInWithEmail } from '../src/auth/emailAuth';
import { localDb } from '../src/lib/local/db';
import { enqueue, listOutbox } from '../src/lib/outbox/outbox';
import type { OutboxKind, OutboxArgs } from '../src/lib/outbox/outbox';
import { rpcSender, runOutbox } from '../src/lib/outbox/runOutbox';
import { pullAll } from '../src/lib/sync/pull';
import { clearLocalDb } from '../src/test/localDbTest';
import { anonClient, createUser, deleteUser, loadIntegrationEnv, uniqueEmail } from './helpers';

loadIntegrationEnv();

const PASSWORD = 'Password123!';

interface TestUser {
  id: string;
  client: ReturnType<typeof anonClient>;
}

const users: string[] = [];

async function signedInUser(label: string): Promise<TestUser> {
  const email = uniqueEmail(label);
  const id = await createUser(email, PASSWORD);
  users.push(id);
  const client = anonClient();
  expect(await signInWithEmail(email, PASSWORD, client)).toEqual({ ok: true });
  return { id, client };
}

/** Queues one call the way a repository does: the mirror write and the operation in one transaction. */
function queue<K extends OutboxKind>(userId: string, kind: K, args: OutboxArgs<K>, mirror?: () => void): void {
  localDb().withTransactionSync(() => {
    mirror?.();
    enqueue(userId, kind, args);
  });
}

/** Drains `user`'s outbox with the real RPCs, as `SyncProvider` does. */
function drain(user: TestUser, now = Date.now): ReturnType<typeof runOutbox> {
  return runOutbox(user.id, { send: rpcSender(user.client), sessionUserId: () => user.id, now });
}

/** A minute ago, so the server's clock check never sees a time from the future. */
function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

beforeEach(clearLocalDb);

afterAll(async () => {
  await Promise.all(users.map((id) => deleteUser(id)));
});

test('log, update, dose and end drain in order and the server row matches', async () => {
  const user = await signedInUser('outbox-drain');
  const episodeId = randomUUID();
  const medicationId = randomUUID();
  const doseId = randomUUID();
  const startedAt = minutesAgo(90);
  const takenAt = minutesAgo(60);
  const endedAt = minutesAgo(5);

  queue(user.id, 'log_episode', { p_id: episodeId, p_started_at: startedAt, p_fields: { intensity: 6 } }, () => {
    localDb().runSync('INSERT INTO episodes (id, user_id, started_at, intensity) VALUES (?, ?, ?, 6);', [
      episodeId,
      user.id,
      startedAt,
    ]);
  });
  queue(user.id, 'update_episode', { p_id: episodeId, p_fields: { intensity: 8, triggers: ['stress'] } });
  queue(user.id, 'save_medication', {
    p_id: medicationId,
    p_fields: { name: 'Sumatriptan', kind: 'acute', class: 'triptan' },
  });
  queue(user.id, 'log_dose', { p_id: doseId, p_medication_id: medicationId, p_taken_at: takenAt, p_episode_id: episodeId });
  queue(user.id, 'end_episode', { p_id: episodeId, p_ended_at: endedAt });

  expect(await drain(user)).toEqual({ sent: 5, failed: 0, waiting: 0 });
  expect(listOutbox(user.id)).toEqual([]);

  const { data: episode } = await user.client
    .from('episodes')
    .select('id, intensity, triggers, started_at, ended_at')
    .eq('id', episodeId)
    .single();
  expect(episode).toMatchObject({ id: episodeId, intensity: 8, triggers: ['stress'] });
  expect(new Date(episode?.started_at ?? '').toISOString()).toBe(startedAt);
  expect(new Date(episode?.ended_at ?? '').toISOString()).toBe(endedAt);
  const { data: dose } = await user.client.from('doses').select('id, medication_id, episode_id').eq('id', doseId).single();
  expect(dose).toEqual({ id: doseId, medication_id: medicationId, episode_id: episodeId });
  // The mirror row is clean once its last operation went out.
  expect(localDb().getFirstSync<{ dirty: number }>('SELECT dirty FROM episodes WHERE id = ?;', [episodeId])?.dirty).toBe(0);
});

test('a log_episode whose response was lost is sent again and leaves one server row', async () => {
  const user = await signedInUser('outbox-replay');
  const episodeId = randomUUID();
  queue(user.id, 'log_episode', { p_id: episodeId, p_started_at: minutesAgo(30), p_fields: { intensity: 5 } });

  // The RPC commits, then the connection drops before the answer arrives: the phone sees a network failure.
  const real = rpcSender(user.client);
  const lost = await runOutbox(user.id, {
    send: async (op) => {
      expect(await real(op)).toEqual({ ok: true });
      return { ok: false, permanent: false };
    },
    sessionUserId: () => user.id,
  });
  expect(lost).toEqual({ sent: 0, failed: 0, waiting: 1 });

  // The app is reopened online after the backoff: the same call goes out again.
  expect(await drain(user, () => Date.now() + 60_000)).toEqual({ sent: 1, failed: 0, waiting: 0 });

  const { data, error } = await user.client.from('episodes').select('id').eq('id', episodeId);
  expect(error).toBeNull();
  expect(data).toHaveLength(1);
});

test("B's update_episode on A's episode is a permanent failure and A's row is unchanged", async () => {
  const a = await signedInUser('outbox-owner');
  const b = await signedInUser('outbox-other');
  const episodeId = randomUUID();
  queue(a.id, 'log_episode', { p_id: episodeId, p_started_at: minutesAgo(30), p_fields: { intensity: 4 } });
  expect(await drain(a)).toMatchObject({ sent: 1 });

  queue(b.id, 'update_episode', { p_id: episodeId, p_fields: { intensity: 10 } });
  expect(await drain(b)).toEqual({ sent: 0, failed: 1, waiting: 0 });
  expect(listOutbox(b.id)).toEqual([expect.objectContaining({ kind: 'update_episode', failed: true, attempts: 1 })]);

  const { data } = await a.client.from('episodes').select('intensity').eq('id', episodeId).single();
  expect(data).toEqual({ intensity: 4 });
});

test('pullAll reads back exactly what was sent', async () => {
  const user = await signedInUser('outbox-pull');
  const episodeId = randomUUID();
  const medicationId = randomUUID();
  const startedAt = minutesAgo(45);
  queue(user.id, 'log_episode', {
    p_id: episodeId,
    p_started_at: startedAt,
    p_fields: { intensity: 7, pain_areas: ['temple_left', 'eye_left'], notes: 'n' },
  });
  queue(user.id, 'save_medication', {
    p_id: medicationId,
    p_fields: { name: 'Ibuprofen', kind: 'acute', class: 'simple_analgesic', dose_text: '400 mg' },
  });
  queue(user.id, 'save_checkin', { p_local_date: '2026-11-20', p_fields: { stress: 'high', low_water: true } });
  expect(await drain(user)).toMatchObject({ sent: 3, failed: 0 });
  clearLocalDb();

  expect(await pullAll(user.id, user.client)).toEqual({ ok: true, value: undefined });

  const episodes = localDb().getAllSync<Record<string, unknown>>(
    'SELECT id, user_id, intensity, pain_areas, notes, source, dirty FROM episodes;',
  );
  expect(episodes).toEqual([
    {
      id: episodeId,
      user_id: user.id,
      intensity: 7,
      pain_areas: '["temple_left","eye_left"]',
      notes: 'n',
      source: 'manual',
      dirty: 0,
    },
  ]);
  expect(localDb().getAllSync('SELECT id, name, kind, class, dose_text, form FROM medications;')).toEqual([
    { id: medicationId, name: 'Ibuprofen', kind: 'acute', class: 'simple_analgesic', dose_text: '400 mg', form: 'oral' },
  ]);
  expect(localDb().getAllSync('SELECT local_date, stress, low_water, alcohol FROM checkins;')).toEqual([
    { local_date: '2026-11-20', stress: 'high', low_water: 1, alcohol: 0 },
  ]);
  expect(localDb().getAllSync('SELECT id FROM doses;')).toEqual([]);
});

test('finishing onboarding sent twice through the outbox is fine, and the first stamp stands', async () => {
  const user = await signedInUser('outbox-onboarding');
  expect((await user.client.rpc('accept_terms', { p_adult: true, p_boundary: true, p_health: true, p_version: '2026-12-01', p_locale: 'en' })).error).toBeNull();
  expect((await user.client.rpc('set_ai_consent', { p_enabled: false, p_version: '2026-12-01', p_locale: 'en' })).error).toBeNull();
  const stamp = async (): Promise<string | null> => {
    const { data, error } = await user.client.from('profiles').select('onboarding_completed_at').single();
    expect(error).toBeNull();
    return data?.onboarding_completed_at ?? null;
  };

  // A replay after a lost reply looks like this: the same call queued again.
  queue(user.id, 'complete_onboarding', {});
  expect(await drain(user)).toEqual({ sent: 1, failed: 0, waiting: 0 });
  const first = await stamp();
  expect(first).not.toBeNull();

  queue(user.id, 'complete_onboarding', {});
  expect(await drain(user)).toEqual({ sent: 1, failed: 0, waiting: 0 });
  expect(await stamp()).toBe(first);
  expect(listOutbox(user.id)).toEqual([]);
});
