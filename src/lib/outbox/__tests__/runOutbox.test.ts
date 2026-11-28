import { localDb } from '../../local/db';
import { clearLocalDb, dirtyOf, insertEpisode } from '../../../test/localDbTest';
import { enqueue, listOutbox } from '../outbox';
import type { OutboxOp } from '../outbox';
import { MAX_ATTEMPTS, backoffMs, pauseOutbox, resumeOutbox, runOutbox } from '../runOutbox';
import type { SendResult } from '../errors';

jest.mock('expo-sqlite', () => require('../../../test/sqliteNode'));

const STARTED = '2026-11-27T10:00:00.000Z';
const ids = ['00000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000c'];

beforeEach(clearLocalDb);

/** Logs one episode per id for `userId`, in order. */
function logEpisodes(userId: string, episodeIds: readonly string[] = ids): void {
  for (const id of episodeIds) {
    localDb().withTransactionSync(() => {
      insertEpisode(userId, id);
      enqueue(userId, 'log_episode', { p_id: id, p_started_at: STARTED, p_fields: {} });
    });
  }
}

function sendWith(...results: SendResult[]): jest.Mock<Promise<SendResult>, [OutboxOp]> {
  const send = jest.fn<Promise<SendResult>, [OutboxOp]>(() => Promise.resolve({ ok: true }));
  for (const result of results) send.mockResolvedValueOnce(result);
  return send;
}

function sentIds(send: jest.Mock<Promise<SendResult>, [OutboxOp]>): string[] {
  return send.mock.calls.map(([op]) => op.recordKey);
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

const RETRY: SendResult = { ok: false, permanent: false };
const PERMANENT: SendResult = { ok: false, permanent: true };

test('backoff doubles from 5 s and stops at 10 min', () => {
  expect(backoffMs(1)).toBe(5_000);
  expect(backoffMs(2)).toBe(10_000);
  expect(backoffMs(9)).toBe(600_000);
  expect(MAX_ATTEMPTS).toBe(8);
});

test('three operations are sent in creation order', async () => {
  logEpisodes('user-a');
  const send = sendWith();

  const result = await runOutbox('user-a', { send, sessionUserId: () => 'user-a', now: () => 0 });

  expect(result).toEqual({ sent: 3, failed: 0, waiting: 0 });
  expect(sentIds(send)).toEqual(ids);
  expect(listOutbox('user-a')).toEqual([]);
});

test('a retryable failure stops the pass: the next operation never overtakes it', async () => {
  logEpisodes('user-a', ids.slice(0, 2));
  const send = sendWith(RETRY);

  const result = await runOutbox('user-a', { send, sessionUserId: () => 'user-a', now: () => 1_000 });

  expect(result).toEqual({ sent: 0, failed: 0, waiting: 2 });
  expect(sentIds(send)).toEqual([ids[0]]);
  const [first, second] = listOutbox('user-a');
  expect(first).toMatchObject({ attempts: 1, nextAttemptAt: 6_000, failed: false });
  expect(second).toMatchObject({ attempts: 0, failed: false });

  // Still inside the backoff: the first waits and so does everything after it.
  const early = await runOutbox('user-a', { send, sessionUserId: () => 'user-a', now: () => 5_999 });
  expect(early).toEqual({ sent: 0, failed: 0, waiting: 2 });
  expect(send).toHaveBeenCalledTimes(1);

  const due = await runOutbox('user-a', { send, sessionUserId: () => 'user-a', now: () => 6_000 });
  expect(due).toEqual({ sent: 2, failed: 0, waiting: 0 });
  expect(sentIds(send)).toEqual([ids[0], ids[0], ids[1]]);
});

test('a permanent failure marks the operation failed and the pass goes on', async () => {
  logEpisodes('user-a', ids.slice(0, 2));
  const send = sendWith(PERMANENT);

  const result = await runOutbox('user-a', { send, sessionUserId: () => 'user-a', now: () => 0 });

  expect(result).toEqual({ sent: 1, failed: 1, waiting: 0 });
  expect(sentIds(send)).toEqual(ids.slice(0, 2));
  expect(listOutbox('user-a')).toEqual([expect.objectContaining({ recordKey: ids[0], failed: true })]);
  // An unsent operation keeps its row dirty, so a pull never overwrites the local version.
  expect(dirtyOf('episodes', ids[0] ?? '')).toBe(1);
  expect(dirtyOf('episodes', ids[1] ?? '')).toBe(0);

  // A failed operation is skipped by later passes until it is reset.
  await runOutbox('user-a', { send, sessionUserId: () => 'user-a', now: () => 600_000 });
  expect(send).toHaveBeenCalledTimes(2);
});

test('a send that throws a network error is retried without spending an attempt; any other throw spends one', async () => {
  logEpisodes('user-a', ids.slice(0, 1));
  const send = jest
    .fn<Promise<SendResult>, [OutboxOp]>()
    .mockRejectedValueOnce(new TypeError('Network request failed'))
    .mockRejectedValueOnce(new Error('unexpected'));

  expect(await runOutbox('user-a', { send, sessionUserId: () => 'user-a', now: () => 0 })).toEqual({
    sent: 0,
    failed: 0,
    waiting: 1,
  });
  expect(listOutbox('user-a')[0]).toMatchObject({ attempts: 0, noResponses: 1, failed: false });

  await runOutbox('user-a', { send, sessionUserId: () => 'user-a', now: () => 60_000 });
  expect(listOutbox('user-a')[0]).toMatchObject({ attempts: 1, noResponses: 1, failed: false });
});

describe('offline', () => {
  const OFFLINE: SendResult = { ok: false, permanent: false, noResponse: true };

  test('10 passes with no response leave the operation pending, then it is sent when the network returns', async () => {
    logEpisodes('user-a', ids.slice(0, 2));
    const send = jest.fn<Promise<SendResult>, [OutboxOp]>(() => Promise.resolve(OFFLINE));
    let clock = 0;
    const waits: number[] = [];

    for (let pass = 0; pass < 10; pass += 1) {
      const result = await runOutbox('user-a', { send, sessionUserId: () => 'user-a', now: () => clock });
      expect(result).toEqual({ sent: 0, failed: 0, waiting: 2 });
      const [head] = listOutbox('user-a');
      expect(head).toMatchObject({ attempts: 0, failed: false, noResponses: pass + 1 });
      waits.push((head?.nextAttemptAt ?? 0) - clock);
      clock = head?.nextAttemptAt ?? clock;
    }
    // The wait still backs off, capped at 10 min, although no attempt is spent.
    expect(waits.slice(0, 3)).toEqual([5_000, 10_000, 20_000]);
    expect(waits.at(-1)).toBe(600_000);
    expect(send).toHaveBeenCalledTimes(10);

    send.mockResolvedValue({ ok: true });
    expect(await runOutbox('user-a', { send, sessionUserId: () => 'user-a', now: () => clock })).toEqual({
      sent: 2,
      failed: 0,
      waiting: 0,
    });
  });

  test('a server that keeps answering with errors still ends at 8 attempts', async () => {
    logEpisodes('user-a', ids.slice(0, 1));
    localDb().runSync('UPDATE outbox SET no_responses = 20, attempts = 7;');
    const send = sendWith(RETRY);

    await runOutbox('user-a', { send, sessionUserId: () => 'user-a', now: () => 0 });

    expect(listOutbox('user-a')[0]).toMatchObject({ attempts: 8, failed: true });
  });
});

test('the 8th failure marks the operation failed', async () => {
  logEpisodes('user-a', ids.slice(0, 1));
  localDb().runSync('UPDATE outbox SET attempts = 7;');
  const send = sendWith(RETRY);

  const result = await runOutbox('user-a', { send, sessionUserId: () => 'user-a', now: () => 0 });

  expect(result).toEqual({ sent: 0, failed: 1, waiting: 0 });
  expect(listOutbox('user-a')[0]).toMatchObject({ attempts: 8, failed: true });
});

// A kill mid-send never reaches a `catch`: the claim written before the send is what the next launch reads.
describe('an app killed while an operation is out', () => {
  test('the attempt is claimed before the send', async () => {
    logEpisodes('killed', ids.slice(0, 1));
    const send = jest.fn<Promise<SendResult>, [OutboxOp]>(() => new Promise(() => undefined));

    void runOutbox('killed', { send, sessionUserId: () => 'killed', now: () => 1_000 });
    await flushMicrotasks();

    expect(send).toHaveBeenCalledTimes(1);
    expect(listOutbox('killed')[0]).toMatchObject({ attempts: 1, nextAttemptAt: 6_000, failed: false });
    expect(dirtyOf('episodes', ids[0] ?? '')).toBe(1);
  });

  test('the next launch sends the claimed operation once its backoff is over', async () => {
    logEpisodes('user-a', ids.slice(0, 1));
    localDb().runSync('UPDATE outbox SET attempts = 1, next_attempt_at = 6000;');
    const send = sendWith();

    const result = await runOutbox('user-a', { send, sessionUserId: () => 'user-a', now: () => 6_000 });

    expect(result).toEqual({ sent: 1, failed: 0, waiting: 0 });
    expect(dirtyOf('episodes', ids[0] ?? '')).toBe(0);
  });

  test('an operation that crashed 8 times is marked failed without another send', async () => {
    logEpisodes('user-a', ids.slice(0, 1));
    localDb().runSync('UPDATE outbox SET attempts = 8, next_attempt_at = 0;');
    const send = sendWith();

    const result = await runOutbox('user-a', { send, sessionUserId: () => 'user-a', now: () => 0 });

    expect(result).toEqual({ sent: 0, failed: 1, waiting: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('two accounts on one phone', () => {
  test("A's operations are never sent while the session is B's, and stay queued", async () => {
    logEpisodes('user-a', ids.slice(0, 2));
    const send = sendWith();

    const result = await runOutbox('user-a', { send, sessionUserId: () => 'user-b', now: () => 0 });

    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({ sent: 0, failed: 0, waiting: 2 });
    // No attempt is spent either: A's operations are as they were when A signs back in.
    expect(listOutbox('user-a')).toEqual([
      expect.objectContaining({ attempts: 0, failed: false }),
      expect.objectContaining({ attempts: 0, failed: false }),
    ]);
  });

  test('a switch to B in the middle of a pass stops it before the next send', async () => {
    logEpisodes('user-a', ids.slice(0, 2));
    let session = 'user-a';
    const send = jest.fn((): Promise<SendResult> => {
      session = 'user-b';
      return Promise.resolve({ ok: true });
    });

    const result = await runOutbox('user-a', { send, sessionUserId: () => session, now: () => 0 });

    expect(send).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ sent: 1, failed: 0, waiting: 1 });
    expect(listOutbox('user-a')).toEqual([expect.objectContaining({ recordKey: ids[1], attempts: 0 })]);
  });
});

test('two concurrent calls share one pass', async () => {
  logEpisodes('user-a', ids.slice(0, 1));
  let release: (result: SendResult) => void = () => undefined;
  const send = jest.fn(
    () =>
      new Promise<SendResult>((resolve) => {
        release = resolve;
      }),
  );
  const deps = { send, sessionUserId: () => 'user-a', now: () => 0 };

  const first = runOutbox('user-a', deps);
  const second = runOutbox('user-a', deps);
  await flushMicrotasks();
  release({ ok: true });

  expect(await second).toBe(await first);
  expect(send).toHaveBeenCalledTimes(1);
});

test('after pauseOutbox nothing is sent until resumeOutbox', async () => {
  logEpisodes('user-a', ids.slice(0, 1));
  const send = sendWith();
  const deps = { send, sessionUserId: () => 'user-a', now: () => 0 };

  await pauseOutbox('user-a');
  expect(await runOutbox('user-a', deps)).toEqual({ sent: 0, failed: 0, waiting: 1 });
  expect(send).not.toHaveBeenCalled();

  resumeOutbox('user-a');
  expect(await runOutbox('user-a', deps)).toEqual({ sent: 1, failed: 0, waiting: 0 });
});

test('pauseOutbox waits for the operation in flight and stops the pass after it', async () => {
  logEpisodes('user-a', ids.slice(0, 2));
  let release: (result: SendResult) => void = () => undefined;
  const send = jest.fn(
    () =>
      new Promise<SendResult>((resolve) => {
        release = resolve;
      }),
  );

  const pass = runOutbox('user-a', { send, sessionUserId: () => 'user-a', now: () => 0 });
  await flushMicrotasks();
  const paused = pauseOutbox('user-a');
  release({ ok: true });
  await paused;

  expect(await pass).toEqual({ sent: 1, failed: 0, waiting: 1 });
  expect(send).toHaveBeenCalledTimes(1);
  resumeOutbox('user-a');
});
