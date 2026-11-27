import { localDb } from '../../local/db';
import { clearLocalDb, dirtyOf, insertEpisode } from '../../../test/localDbTest';
import { enqueue, listOutbox, resetFailed } from '../outbox';
import { runOutbox } from '../runOutbox';
import type { SendResult } from '../errors';

jest.mock('expo-sqlite', () => require('../../../test/sqliteNode'));

const EPISODE = '00000000-0000-4000-8000-000000000001';
const STARTED = '2026-11-27T10:00:00.000Z';

beforeEach(clearLocalDb);

function logEpisode(userId: string, id = EPISODE): void {
  localDb().withTransactionSync(() => {
    insertEpisode(userId, id);
    enqueue(userId, 'log_episode', { p_id: id, p_started_at: STARTED, p_fields: { intensity: 6 } });
  });
}

test('enqueue inside a transaction marks the mirror row dirty and queues the operation', () => {
  logEpisode('user-a');

  expect(dirtyOf('episodes', EPISODE)).toBe(1);
  expect(listOutbox('user-a')).toEqual([
    expect.objectContaining({
      userId: 'user-a',
      kind: 'log_episode',
      args: { p_id: EPISODE, p_started_at: STARTED, p_fields: { intensity: 6 } },
      recordKey: EPISODE,
      attempts: 0,
      noResponses: 0,
      nextAttemptAt: 0,
      failed: false,
    }),
  ]);
});

test('a rolled-back transaction queues nothing', () => {
  expect(() => {
    localDb().withTransactionSync(() => {
      insertEpisode('user-a', EPISODE);
      enqueue('user-a', 'log_episode', { p_id: EPISODE, p_started_at: STARTED, p_fields: {} });
      throw new Error('the mirror write failed');
    });
  }).toThrow('the mirror write failed');
  expect(listOutbox('user-a')).toEqual([]);
  expect(dirtyOf('episodes', EPISODE)).toBeUndefined();
});

test('a check-in is keyed by its local date', () => {
  localDb().withTransactionSync(() => {
    localDb().runSync("INSERT INTO checkins (user_id, local_date) VALUES ('user-a', '2026-11-27');");
    enqueue('user-a', 'save_checkin', { p_local_date: '2026-11-27', p_fields: { stress: 'high' } });
  });
  expect(listOutbox('user-a')[0]?.recordKey).toBe('checkin:2026-11-27');
  expect(dirtyOf('checkins', '2026-11-27')).toBe(1);
});

test('the row becomes clean when the last operation with its key is sent, not before', async () => {
  logEpisode('user-a');
  localDb().withTransactionSync(() => {
    enqueue('user-a', 'update_episode', { p_id: EPISODE, p_fields: { intensity: 7 } });
  });
  const send = jest
    .fn<Promise<SendResult>, []>()
    .mockResolvedValueOnce({ ok: true })
    .mockResolvedValueOnce({ ok: false, permanent: false })
    .mockResolvedValueOnce({ ok: true });
  const deps = { send, sessionUserId: () => 'user-a' };

  await runOutbox('user-a', { ...deps, now: () => 0 });
  expect(listOutbox('user-a')).toHaveLength(1);
  expect(dirtyOf('episodes', EPISODE)).toBe(1);

  await runOutbox('user-a', { ...deps, now: () => 60_000 });
  expect(listOutbox('user-a')).toEqual([]);
  expect(dirtyOf('episodes', EPISODE)).toBe(0);
});

test("listOutbox('B') never returns A's operations", () => {
  logEpisode('user-a');
  expect(listOutbox('user-b')).toEqual([]);
  expect(listOutbox('user-a')).toHaveLength(1);
});

test('resetFailed clears failed, the attempts and the backoff of that user only', async () => {
  logEpisode('user-a');
  logEpisode('user-b', '00000000-0000-4000-8000-000000000002');
  const send = jest.fn((): Promise<SendResult> => Promise.resolve({ ok: false, permanent: true }));
  await runOutbox('user-a', { send, sessionUserId: () => 'user-a', now: () => 1_000 });
  await runOutbox('user-b', { send, sessionUserId: () => 'user-b', now: () => 1_000 });
  expect(listOutbox('user-a')[0]).toMatchObject({ failed: true, attempts: 1, nextAttemptAt: 6_000 });

  localDb().runSync("UPDATE outbox SET no_responses = 3 WHERE user_id = 'user-a';");
  resetFailed('user-a');

  expect(listOutbox('user-a')[0]).toMatchObject({ failed: false, attempts: 0, noResponses: 0, nextAttemptAt: 0 });
  expect(listOutbox('user-b')[0]).toMatchObject({ failed: true, attempts: 1 });
});
