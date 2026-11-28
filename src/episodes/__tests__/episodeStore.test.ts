import { act, renderHook } from '@testing-library/react-native';

import { logDose } from '../../cabinet/doseStore';
import { localDb } from '../../lib/local/db';
import { listOutbox } from '../../lib/outbox/outbox';
import type { OutboxOp } from '../../lib/outbox/outbox';
import type { SendResult } from '../../lib/outbox/runOutbox';
import { clearLocalDb } from '../../test/localDbTest';
import { deleteEpisode, endEpisode, readOpenEpisode, startEpisode, updateEpisode, useEpisode, useEpisodes, useOpenEpisode } from '../episodeStore';

// One database for the whole suite, shared by every module registry: a module loaded again after a
// "kill" opens the same file, as the app does on its next launch.
jest.mock('expo-sqlite', () => {
  const sqlite = require('../../test/sqliteNode') as typeof import('../../test/sqliteNode');
  const holder = globalThis as { nimboDisk?: unknown };
  holder.nimboDisk ??= sqlite.openDatabaseSync();
  return { ...sqlite, openDatabaseSync: () => holder.nimboDisk };
});
jest.mock('expo-crypto', () => ({ randomUUID: () => (require('node:crypto') as typeof import('node:crypto')).randomUUID() }));

const STARTED = new Date('2026-11-27T15:40:00Z');
const MEDICATION = '00000000-0000-4000-8000-0000000000a1';

const NOW = new Date('2026-11-27T18:00:00Z');

beforeEach(() => {
  // Only the clock is fixed, so "later than now" means the same thing whatever day the suite runs.
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime', 'performance'],
  });
  clearLocalDb();
});

afterEach(() => {
  jest.useRealTimers();
});

function episodeRow(id: string): { user_id: string; started_at: string; ended_at: string | null; intensity: number | null; dirty: number } | null {
  return localDb().getFirstSync('SELECT user_id, started_at, ended_at, intensity, dirty FROM episodes WHERE id = ?;', [id]);
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('startEpisode', () => {
  test('offline, the mirror row and the log_episode operation exist before it returns, and nothing touches the network', () => {
    const offline = jest.fn(() => Promise.reject(new TypeError('Network request failed')));
    const realFetch = globalThis.fetch;
    globalThis.fetch = offline;
    try {
      const id = startEpisode('user-a', STARTED);

      // No await between the call and these reads: a kill right after it returns loses nothing.
      expect(episodeRow(id)).toEqual({ user_id: 'user-a', started_at: '2026-11-27T15:40:00.000Z', ended_at: null, intensity: null, dirty: 1 });
      expect(listOutbox('user-a')).toEqual([
        expect.objectContaining({
          kind: 'log_episode',
          recordKey: id,
          args: { p_id: id, p_started_at: '2026-11-27T15:40:00.000Z', p_fields: { source: 'manual' } },
        }),
      ]);
      expect(offline).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('a second start while one is open returns the same id and queues nothing', () => {
    const first = startEpisode('user-a', STARTED);
    const second = startEpisode('user-a', new Date('2026-11-27T16:00:00Z'));

    expect(second).toBe(first);
    expect(listOutbox('user-a')).toHaveLength(1);
    expect(localDb().getAllSync('SELECT id FROM episodes;')).toHaveLength(1);
  });

  test('another user’s open attack does not count', () => {
    const mine = startEpisode('user-a', STARTED);
    const theirs = startEpisode('user-b', STARTED);
    expect(theirs).not.toBe(mine);
  });

  test('started offline and killed before the sync, it is still open on relaunch and reaches the server exactly once', async () => {
    const id = startEpisode('user-a', STARTED);

    // The kill: every module loads again; only the database is left.
    let relaunched!: {
      store: typeof import('../episodeStore');
      outbox: typeof import('../../lib/outbox/outbox');
      runner: typeof import('../../lib/outbox/runOutbox');
    };
    jest.isolateModules(() => {
      relaunched = {
        store: require('../episodeStore') as typeof import('../episodeStore'),
        outbox: require('../../lib/outbox/outbox') as typeof import('../../lib/outbox/outbox'),
        runner: require('../../lib/outbox/runOutbox') as typeof import('../../lib/outbox/runOutbox'),
      };
    });

    expect(relaunched.store.readOpenEpisode('user-a')).toEqual(expect.objectContaining({ id, endedAt: null, dirty: true }));
    expect(relaunched.store.startEpisode('user-a')).toBe(id);

    // Online again. The server commits the first call but its reply is lost, so the call is replayed.
    const server = new Set<string>();
    let loseReply = true;
    const send = jest.fn((op: OutboxOp): Promise<SendResult> => {
      if (op.kind === 'log_episode') server.add((op.args as { p_id: string }).p_id); // `on conflict (id) do nothing`
      if (loseReply) {
        loseReply = false;
        return Promise.resolve({ ok: false, permanent: false, noResponse: true });
      }
      return Promise.resolve({ ok: true });
    });

    await relaunched.runner.runOutbox('user-a', { send, sessionUserId: () => 'user-a', now: () => 0 });
    await relaunched.runner.runOutbox('user-a', { send, sessionUserId: () => 'user-a', now: () => 60 * 60 * 1000 });

    expect(send.mock.calls.map(([op]) => op.recordKey)).toEqual([id, id]);
    expect([...server]).toEqual([id]);
    expect(relaunched.outbox.listOutbox('user-a')).toEqual([]);
    expect(episodeRow(id)?.dirty).toBe(0);
  });
});

describe('updateEpisode', () => {
  test('an intensity of 7 queues update_episode with that key only', () => {
    const id = startEpisode('user-a', STARTED);
    updateEpisode('user-a', id, { intensity: 7 });

    expect(episodeRow(id)?.intensity).toBe(7);
    expect(listOutbox('user-a')[1]).toEqual(
      expect.objectContaining({ kind: 'update_episode', recordKey: id, args: { p_id: id, p_fields: { intensity: 7 } } }),
    );
  });

  test('lists are stored as JSON and sent under their column names', () => {
    const id = startEpisode('user-a', STARTED);
    updateEpisode('user-a', id, { painAreas: ['temple_left', 'eye_left'], symptoms: ['nausea'] });

    expect(readOpenEpisode('user-a')).toEqual(expect.objectContaining({ painAreas: ['temple_left', 'eye_left'], symptoms: ['nausea'] }));
    expect(listOutbox('user-a')[1]?.args).toEqual({ p_id: id, p_fields: { pain_areas: ['temple_left', 'eye_left'], symptoms: ['nausea'] } });
  });

  test('a start moved earlier queues update_episode with started_at', () => {
    const id = startEpisode('user-a', STARTED);
    updateEpisode('user-a', id, { startedAt: '2026-11-27T14:10:00.000Z' });

    expect(episodeRow(id)?.started_at).toBe('2026-11-27T14:10:00.000Z');
    expect(listOutbox('user-a')[1]?.args).toEqual({ p_id: id, p_fields: { started_at: '2026-11-27T14:10:00.000Z' } });
  });

  // The clock is pinned at 18:00; the attack runs 15:40 to 17:05.
  test.each([
    ['an end before the start', { endedAt: '2026-11-27T15:00:00.000Z' }],
    ['a start after the end', { startedAt: '2026-11-27T18:00:00.000Z' }],
    ['a start more than 5 minutes ahead', { startedAt: '2026-11-27T18:10:00.000Z' }],
    ['an end more than 5 minutes ahead', { endedAt: '2026-11-27T18:10:00.000Z' }],
    ['a start before 2000', { startedAt: '1999-12-31T23:00:00.000Z' }],
    ['a start that is not a time', { startedAt: 'yesterday' }],
    ['notes over 2,000 characters', { notes: 'a'.repeat(2001), intensity: 5 }],
  ])('%s throws RangeError and writes nothing', (_name, patch) => {
    const id = startEpisode('user-a', STARTED);
    endEpisode('user-a', id, new Date('2026-11-27T17:05:00Z'));
    const before = episodeRow(id);

    expect(() => {
      updateEpisode('user-a', id, patch);
    }).toThrow(RangeError);
    expect(episodeRow(id)).toEqual(before);
    expect(listOutbox('user-a').map((op) => op.kind)).toEqual(['log_episode', 'end_episode']);
  });

  test('notes of exactly 2,000 characters are saved and queued', () => {
    const id = startEpisode('user-a', STARTED);
    updateEpisode('user-a', id, { notes: 'a'.repeat(2000) });
    expect(readOpenEpisode('user-a')?.notes).toHaveLength(2000);
    expect(listOutbox('user-a')[1]?.args).toEqual({ p_id: id, p_fields: { notes: 'a'.repeat(2000) } });
  });

  test('another user’s episode is left alone and nothing is queued', () => {
    const id = startEpisode('user-a', STARTED);
    updateEpisode('user-b', id, { intensity: 3 });
    expect(episodeRow(id)?.intensity).toBeNull();
    expect(listOutbox('user-b')).toEqual([]);
  });
});

describe('endEpisode', () => {
  test('it sets the end and queues end_episode', () => {
    const id = startEpisode('user-a', STARTED);
    endEpisode('user-a', id, new Date('2026-11-27T17:05:00Z'));

    expect(episodeRow(id)?.ended_at).toBe('2026-11-27T17:05:00.000Z');
    expect(listOutbox('user-a')[1]).toEqual(
      expect.objectContaining({ kind: 'end_episode', args: { p_id: id, p_ended_at: '2026-11-27T17:05:00.000Z' } }),
    );
    expect(readOpenEpisode('user-a')).toBeNull();
  });

  test('an end more than 5 minutes ahead is refused before anything is written', () => {
    const id = startEpisode('user-a', STARTED);
    expect(() => {
      endEpisode('user-a', id, new Date(Date.now() + 10 * 60 * 1000));
    }).toThrow(RangeError);
    expect(episodeRow(id)?.ended_at).toBeNull();
    expect(listOutbox('user-a')).toHaveLength(1);
  });

  test('an end before the start is refused before anything is written', () => {
    const id = startEpisode('user-a', STARTED);
    expect(() => {
      endEpisode('user-a', id, new Date('2026-11-27T15:39:00Z'));
    }).toThrow(RangeError);
    expect(episodeRow(id)?.ended_at).toBeNull();
    expect(listOutbox('user-a')).toHaveLength(1);
  });
});

describe('deleteEpisode', () => {
  test('it removes the mirror row, unlinks its doses and queues delete_episode', () => {
    const id = startEpisode('user-a', STARTED);
    const dose = logDose('user-a', { medicationId: MEDICATION, takenAt: STARTED, episodeId: id });
    deleteEpisode('user-a', id);

    expect(episodeRow(id)).toBeNull();
    expect(localDb().getFirstSync('SELECT episode_id FROM doses WHERE id = ?;', [dose])).toEqual({ episode_id: null });
    expect(listOutbox('user-a').map((op) => op.kind)).toEqual(['log_episode', 'log_dose', 'delete_episode']);
  });
});

describe('the hooks', () => {
  test('useEpisodes is newest first and only the user’s; useEpisode and useOpenEpisode follow changes', async () => {
    const older = startEpisode('user-a', new Date('2026-11-20T10:00:00Z'));
    endEpisode('user-a', older, new Date('2026-11-20T12:00:00Z'));
    const newer = startEpisode('user-a', STARTED);
    startEpisode('user-b', STARTED);

    const list = await renderHook(() => useEpisodes('user-a'));
    expect(list.result.current.map((episode) => episode.id)).toEqual([newer, older]);
    expect(list.result.current[1]).toEqual({
      id: older,
      startedAt: '2026-11-20T10:00:00.000Z',
      endedAt: '2026-11-20T12:00:00.000Z',
      intensity: null,
      painAreas: [],
      symptoms: [],
      triggers: [],
      reliefs: [],
      notes: null,
      source: 'manual',
      dirty: true,
    });

    const one = await renderHook(() => useEpisode('user-a', newer));
    const open = await renderHook(() => useOpenEpisode('user-a'));
    expect(open.result.current?.id).toBe(newer);
    expect(await renderHook(() => useEpisode('user-b', newer)).then((hook) => hook.result.current)).toBeNull();

    updateEpisode('user-a', newer, { intensity: 4 });
    await flushMicrotasks();
    expect(one.result.current?.intensity).toBe(4);

    endEpisode('user-a', newer, new Date('2026-11-27T16:00:00Z'));
    await flushMicrotasks();
    expect(open.result.current).toBeNull();
  });
});
