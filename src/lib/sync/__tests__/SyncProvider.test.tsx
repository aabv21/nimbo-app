import { act, render } from '@testing-library/react-native';
import { useEffect } from 'react';

import { resetAuth, setAuth } from '../../../test/authMock';
import { clearLocalDb, insertEpisode } from '../../../test/localDbTest';
import { localDb } from '../../local/db';
import { enqueue, listOutbox } from '../../outbox/outbox';
import { pauseOutbox, resumeOutbox, runOutbox } from '../../outbox/runOutbox';
import { pullAll } from '../pull';
import { SyncProvider, useSyncState } from '../SyncProvider';

jest.mock('expo-sqlite', () => require('../../../test/sqliteNode'));
jest.mock('../../../auth/AuthProvider', () => require('../../../test/authMock'));
jest.mock('../../supabase', () => ({ supabase: { rpc: jest.fn() }, readStoredSession: jest.fn(() => null) }));
jest.mock('../pull', () => ({ pullAll: jest.fn(() => Promise.resolve({ ok: true, value: undefined })) }));
jest.mock('../../outbox/runOutbox', () => {
  const actual = jest.requireActual<typeof import('../../outbox/runOutbox')>('../../outbox/runOutbox');
  return {
    ...actual,
    runOutbox: jest.fn(() => Promise.resolve({ sent: 0, failed: 0, waiting: 0 })),
    pauseOutbox: jest.fn(() => Promise.resolve()),
    resumeOutbox: jest.fn(),
  };
});

let state: ReturnType<typeof useSyncState> | undefined;
function Probe(): null {
  const current = useSyncState();
  useEffect(() => {
    state = current;
  });
  return null;
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

beforeEach(() => {
  clearLocalDb();
  jest.clearAllMocks();
  resetAuth();
});

test('a signed-in user is resumed and synced: push, then pull', async () => {
  await render(
    <SyncProvider>
      <Probe />
    </SyncProvider>,
  );
  await flush();

  expect(resumeOutbox).toHaveBeenCalledWith('user-1');
  expect(runOutbox).toHaveBeenCalledWith('user-1', expect.anything());
  expect(typeof jest.mocked(runOutbox).mock.calls[0]?.[1].send).toBe('function');
  expect(pullAll).toHaveBeenCalledWith('user-1');
  const pushOrder = jest.mocked(runOutbox).mock.invocationCallOrder[0] ?? 0;
  expect(jest.mocked(pullAll).mock.invocationCallOrder[0]).toBeGreaterThan(pushOrder);
});

test("an enqueue syncs again, and the counts are the signed-in user's only", async () => {
  await render(
    <SyncProvider>
      <Probe />
    </SyncProvider>,
  );
  await flush();
  jest.mocked(runOutbox).mockClear();

  await act(() => {
    localDb().withTransactionSync(() => {
      insertEpisode('user-1', 'e1');
      enqueue('user-1', 'log_episode', { p_id: 'e1', p_started_at: '2026-11-27T10:00:00Z', p_fields: {} });
      enqueue('other', 'delete_episode', { p_id: 'e2' });
    });
  });
  await flush();

  expect(runOutbox).toHaveBeenCalledWith('user-1', expect.anything());
  expect(state?.pending).toBe(1);
  expect(listOutbox('other')).toHaveLength(1);
});

test("an account switch pauses the previous user's outbox and syncs the new one", async () => {
  await render(
    <SyncProvider>
      <Probe />
    </SyncProvider>,
  );
  await flush();

  await act(() => {
    setAuth({ userId: 'user-2' });
  });
  await flush();

  expect(pauseOutbox).toHaveBeenCalledWith('user-1');
  expect(resumeOutbox).toHaveBeenLastCalledWith('user-2');
  expect(runOutbox).toHaveBeenLastCalledWith('user-2', expect.anything());
});

test('sign-out pauses the outbox and syncs nothing', async () => {
  await render(
    <SyncProvider>
      <Probe />
    </SyncProvider>,
  );
  await flush();
  jest.mocked(runOutbox).mockClear();

  await act(() => {
    setAuth({ status: 'signedOut', userId: null });
  });
  await flush();

  expect(pauseOutbox).toHaveBeenCalledWith('user-1');
  expect(runOutbox).not.toHaveBeenCalled();
  expect(state).toMatchObject({ pending: 0, failed: 0 });
});

test('retry resets the failed operations and syncs', async () => {
  localDb().withTransactionSync(() => {
    enqueue('user-1', 'delete_episode', { p_id: 'e1' });
  });
  localDb().runSync('UPDATE outbox SET failed = 1, attempts = 3;');
  await render(
    <SyncProvider>
      <Probe />
    </SyncProvider>,
  );
  await flush();
  expect(state).toMatchObject({ pending: 0, failed: 1 });
  jest.mocked(runOutbox).mockClear();

  await act(() => {
    state?.retry();
  });
  await flush();

  expect(state).toMatchObject({ pending: 1, failed: 0 });
  expect(runOutbox).toHaveBeenCalledTimes(1);
});

function episodeCount(userId: string): number {
  return localDb().getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM episodes WHERE user_id = ?;', [userId])?.n ?? 0;
}

describe('rows left on the phone', () => {
  test("sign-out with an empty outbox purges the user's rows once the outbox is paused", async () => {
    insertEpisode('user-1', 'e1');
    let releasePause: () => void = () => undefined;
    jest.mocked(pauseOutbox).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releasePause = resolve;
        }),
    );
    await render(
      <SyncProvider>
        <Probe />
      </SyncProvider>,
    );
    await flush();

    await act(() => {
      setAuth({ status: 'signedOut', userId: null });
    });
    await flush();
    // A send still in flight could complete into these rows: nothing goes before the pause settles.
    expect(episodeCount('user-1')).toBe(1);

    releasePause();
    await flush();
    expect(episodeCount('user-1')).toBe(0);
  });

  test('sign-out with an unsent operation keeps the rows for when the user is back', async () => {
    localDb().withTransactionSync(() => {
      insertEpisode('user-1', 'e1');
      enqueue('user-1', 'log_episode', { p_id: 'e1', p_started_at: '2026-11-27T10:00:00Z', p_fields: {} });
    });
    await render(
      <SyncProvider>
        <Probe />
      </SyncProvider>,
    );
    await flush();

    await act(() => {
      setAuth({ status: 'signedOut', userId: null });
    });
    await flush();

    expect(episodeCount('user-1')).toBe(1);
  });

  test("an account switch purges the previous user's clean rows", async () => {
    insertEpisode('user-1', 'e1');
    await render(
      <SyncProvider>
        <Probe />
      </SyncProvider>,
    );
    await flush();

    await act(() => {
      setAuth({ userId: 'user-2' });
    });
    await flush();

    expect(episodeCount('user-1')).toBe(0);
  });

  test("startup purges another user's clean rows, left by a sign-out while the app was closed", async () => {
    insertEpisode('user-1', 'mine');
    insertEpisode('earlier', 'theirs');
    insertEpisode('queued', 'queued-episode');
    localDb().withTransactionSync(() => {
      enqueue('queued', 'delete_episode', { p_id: 'queued-episode' });
    });

    await render(
      <SyncProvider>
        <Probe />
      </SyncProvider>,
    );
    await flush();

    expect(episodeCount('user-1')).toBe(1);
    expect(episodeCount('earlier')).toBe(0);
    expect(episodeCount('queued')).toBe(1);
  });
});

describe('waking up for a backoff', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  test('a pass runs when the operation at the head of the queue is due, without another trigger', async () => {
    jest.useFakeTimers({ now: 1_000_000, doNotFake: ['queueMicrotask'] });
    localDb().withTransactionSync(() => {
      enqueue('user-1', 'delete_episode', { p_id: 'e1' });
    });
    localDb().runSync('UPDATE outbox SET next_attempt_at = ?;', [1_000_000 + 5_000]);
    await render(
      <SyncProvider>
        <Probe />
      </SyncProvider>,
    );
    await flush();
    const before = jest.mocked(runOutbox).mock.calls.length;

    await act(() => {
      jest.advanceTimersByTime(4_999);
    });
    await flush();
    expect(runOutbox).toHaveBeenCalledTimes(before);

    await act(() => {
      jest.advanceTimersByTime(1);
    });
    await flush();
    expect(runOutbox).toHaveBeenCalledTimes(before + 1);
    expect(runOutbox).toHaveBeenLastCalledWith('user-1', expect.anything());
  });

  test('an account switch clears the previous wake-up', async () => {
    jest.useFakeTimers({ now: 1_000_000, doNotFake: ['queueMicrotask'] });
    localDb().withTransactionSync(() => {
      enqueue('user-1', 'delete_episode', { p_id: 'e1' });
    });
    localDb().runSync('UPDATE outbox SET next_attempt_at = ?;', [1_000_000 + 5_000]);
    await render(
      <SyncProvider>
        <Probe />
      </SyncProvider>,
    );
    await flush();

    await act(() => {
      setAuth({ userId: 'user-2' });
    });
    await flush();
    jest.mocked(runOutbox).mockClear();

    await act(() => {
      jest.advanceTimersByTime(10_000);
    });
    await flush();
    expect(runOutbox).not.toHaveBeenCalledWith('user-1', expect.anything());
  });
});
