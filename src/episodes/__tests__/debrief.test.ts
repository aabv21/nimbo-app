import { renderHook } from '@testing-library/react-native';

import { logDose, logDoseTx, setDoseHelped, useDoses } from '../../cabinet/doseStore';
import { localDb } from '../../lib/local/db';
import { listOutbox } from '../../lib/outbox/outbox';
import { clearLocalDb } from '../../test/localDbTest';
import { logEpisode, logEpisodeTx, saveDebrief, startEpisode, updateEpisode, useEpisode } from '../episodeStore';

// `sqliteNode` fails a nested BEGIN as expo-sqlite does, so a writer that still opened its own transaction
// inside `saveDebrief` fails these tests.
jest.mock('expo-sqlite', () => require('../../test/sqliteNode'));
jest.mock('expo-crypto', () => ({ randomUUID: () => (require('node:crypto') as typeof import('node:crypto')).randomUUID() }));

const NOW = new Date('2026-11-27T18:00:00Z');
const MEDICATION = '00000000-0000-4000-8000-0000000000a1';

beforeEach(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime', 'performance'],
  });
  clearLocalDb();
});

afterEach(() => {
  jest.useRealTimers();
});

/** A finished attack with a trigger already logged and two doses taken during it. */
function finishedAttack(): { id: string; doses: [string, string] } {
  const id = startEpisode('user-a', new Date('2026-11-26T10:00:00Z'));
  updateEpisode('user-a', id, { triggers: ['stress'], endedAt: '2026-11-26T14:00:00Z' });
  const first = logDose('user-a', { medicationId: MEDICATION, takenAt: new Date('2026-11-26T10:30:00Z'), episodeId: id });
  const second = logDose('user-a', { medicationId: MEDICATION, takenAt: new Date('2026-11-26T12:30:00Z'), episodeId: id });
  return { id, doses: [first, second] };
}

function opsAfter(count: number): { kind: string; args: unknown }[] {
  return listOutbox('user-a')
    .slice(count)
    .map(({ kind, args }) => ({ kind, args }));
}

describe('saveDebrief', () => {
  test('queues one update_episode with the answers and merged triggers, and one set_dose_helped per dose, in one transaction', () => {
    const { id, doses } = finishedAttack();
    const before = listOutbox('user-a').length;
    const transaction = jest.spyOn(localDb(), 'withTransactionSync');

    saveDebrief('user-a', id, {
      helped: ['dark_room', 'sleep'],
      didNotHelp: ['caffeine'],
      triggers: ['short_sleep', 'stress'],
      doseHelped: { [doses[0]]: true, [doses[1]]: false },
    });

    expect(transaction).toHaveBeenCalledTimes(1);
    transaction.mockRestore();
    expect(opsAfter(before)).toEqual([
      {
        kind: 'update_episode',
        args: {
          p_id: id,
          p_fields: { triggers: ['stress', 'short_sleep'], helped: ['dark_room', 'sleep'], did_not_help: ['caffeine'], debriefed: true },
        },
      },
      { kind: 'set_dose_helped', args: { p_id: doses[0], p_helped: true } },
      { kind: 'set_dose_helped', args: { p_id: doses[1], p_helped: false } },
    ]);
  });

  test('the mirror shows the answers before any sync', async () => {
    const { id, doses } = finishedAttack();
    saveDebrief('user-a', id, { helped: ['dark_room'], didNotHelp: [], triggers: [], doseHelped: { [doses[0]]: true } });

    const episode = (await renderHook(() => useEpisode('user-a', id))).result.current;
    expect(episode).toEqual(
      expect.objectContaining({ helped: ['dark_room'], didNotHelp: [], triggers: ['stress'], debriefedAt: NOW.toISOString(), dirty: true }),
    );
    const helped = (await renderHook(() => useDoses('user-a', { episodeId: id }))).result.current.map((dose) => [dose.id, dose.helped]);
    expect(helped).toEqual(expect.arrayContaining([[doses[0], true], [doses[1], null]]));
  });

  test('a key outside the reliefs is a RangeError and nothing of the debrief is written', () => {
    const { id, doses } = finishedAttack();
    const before = listOutbox('user-a').length;

    expect(() => {
      saveDebrief('user-a', id, { helped: ['bogus'], didNotHelp: [], triggers: [], doseHelped: { [doses[0]]: true } });
    }).toThrow(RangeError);
    expect(() => {
      saveDebrief('user-a', id, { helped: [], didNotHelp: [], triggers: ['not_a_trigger'], doseHelped: { [doses[0]]: true } });
    }).toThrow(RangeError);

    expect(listOutbox('user-a')).toHaveLength(before);
    expect(localDb().getFirstSync('SELECT helped, debriefed_at FROM episodes WHERE id = ?;', [id])).toEqual({ helped: '[]', debriefed_at: null });
    expect(localDb().getAllSync('SELECT helped FROM doses WHERE helped IS NOT NULL;')).toEqual([]);
  });

  test('a repeated debrief keeps the first time, as the server does', () => {
    const { id } = finishedAttack();
    saveDebrief('user-a', id, { helped: ['sleep'], didNotHelp: [], triggers: [], doseHelped: {} });
    jest.setSystemTime(new Date('2026-11-27T19:00:00Z'));
    saveDebrief('user-a', id, { helped: ['water'], didNotHelp: [], triggers: [], doseHelped: {} });

    expect(localDb().getFirstSync('SELECT helped, debriefed_at FROM episodes WHERE id = ?;', [id])).toEqual({
      helped: '["water"]',
      debriefed_at: NOW.toISOString(),
    });
  });

  test('another user’s attack is a no-op', () => {
    const { id } = finishedAttack();
    saveDebrief('user-b', id, { helped: ['sleep'], didNotHelp: [], triggers: [], doseHelped: {} });
    expect(listOutbox('user-b')).toEqual([]);
  });
});

describe('logEpisode', () => {
  const ID = '00000000-0000-4000-8000-0000000000e9';

  test('a finished attack queues log_episode with the given id and source chat', async () => {
    logEpisode('user-a', ID, {
      startedAt: '2026-11-26T10:00:00.000Z',
      endedAt: '2026-11-26T14:00:00.000Z',
      source: 'chat',
      intensity: 6,
      symptoms: ['nausea'],
    });

    expect(opsAfter(0)).toEqual([
      {
        kind: 'log_episode',
        args: {
          p_id: ID,
          p_started_at: '2026-11-26T10:00:00.000Z',
          p_fields: { ended_at: '2026-11-26T14:00:00.000Z', intensity: 6, symptoms: ['nausea'], source: 'chat' },
        },
      },
    ]);
    const episode = (await renderHook(() => useEpisode('user-a', ID))).result.current;
    expect(episode).toEqual(expect.objectContaining({ id: ID, source: 'chat', intensity: 6, symptoms: ['nausea'], dirty: true }));
  });

  test('an open attack while one is already open is a RangeError and writes nothing', () => {
    const open = startEpisode('user-a', new Date('2026-11-27T17:00:00Z'));

    expect(() => {
      logEpisode('user-a', ID, { startedAt: '2026-11-27T17:30:00.000Z', endedAt: null, source: 'chat' });
    }).toThrow(RangeError);

    expect(localDb().getAllSync<{ id: string }>('SELECT id FROM episodes;').map((row) => row.id)).toEqual([open]);
    expect(listOutbox('user-a')).toHaveLength(1);
  });

  test('the Wave 2 rules hold: a time an hour ahead, an end before the start or a bad key is a RangeError', () => {
    expect(() => {
      logEpisode('user-a', ID, { startedAt: '2026-11-27T19:00:00.000Z', endedAt: null, source: 'voice' });
    }).toThrow(RangeError);
    expect(() => {
      logEpisode('user-a', ID, { startedAt: '2026-11-26T10:00:00.000Z', endedAt: '2026-11-26T09:00:00.000Z', source: 'chat' });
    }).toThrow(RangeError);
    expect(() => {
      logEpisode('user-a', ID, { startedAt: '2026-11-26T10:00:00.000Z', endedAt: null, source: 'chat', triggers: ['bogus'] });
    }).toThrow(RangeError);
    expect(listOutbox('user-a')).toEqual([]);
  });

  test('the same id twice is logged once, as the server’s `on conflict do nothing` does', () => {
    const input = { startedAt: '2026-11-26T10:00:00.000Z', endedAt: '2026-11-26T11:00:00.000Z', source: 'chat' } as const;
    logEpisode('user-a', ID, input);
    logEpisode('user-a', ID, input);
    expect(listOutbox('user-a')).toHaveLength(1);
  });
});

describe('the single writers', () => {
  test('updateEpisode with debriefed false clears debriefedAt and sends debriefed false', async () => {
    const { id } = finishedAttack();
    updateEpisode('user-a', id, { debriefed: true });
    expect((await renderHook(() => useEpisode('user-a', id))).result.current?.debriefedAt).toBe(NOW.toISOString());

    updateEpisode('user-a', id, { debriefed: false });

    expect((await renderHook(() => useEpisode('user-a', id))).result.current?.debriefedAt).toBeNull();
    expect(listOutbox('user-a').at(-1)?.args).toEqual({ p_id: id, p_fields: { debriefed: false } });
  });

  test('setDoseHelped with null queues set_dose_helped without p_helped', () => {
    const { doses } = finishedAttack();
    setDoseHelped('user-a', doses[0], true);
    setDoseHelped('user-a', doses[0], null);

    expect(listOutbox('user-a').slice(-2).map(({ kind, args }) => ({ kind, args }))).toEqual([
      { kind: 'set_dose_helped', args: { p_id: doses[0], p_helped: true } },
      { kind: 'set_dose_helped', args: { p_id: doses[0] } },
    ]);
    expect(localDb().getFirstSync('SELECT helped, dirty FROM doses WHERE id = ?;', [doses[0]])).toEqual({ helped: null, dirty: 1 });
  });

  test('setDoseHelped on a dose that is not the user’s is a no-op', () => {
    const { doses } = finishedAttack();
    setDoseHelped('user-b', doses[0], true);
    expect(listOutbox('user-b')).toEqual([]);
  });

  test('logDose with an id uses it, and the same id again logs nothing more', () => {
    const id = '00000000-0000-4000-8000-0000000000d7';
    const input = { id, medicationId: MEDICATION, takenAt: new Date('2026-11-27T17:00:00Z'), episodeId: null };
    expect(logDose('user-a', input)).toBe(id);
    expect(logDose('user-a', input)).toBe(id);

    expect(listOutbox('user-a')).toEqual([expect.objectContaining({ kind: 'log_dose', recordKey: id })]);
  });

  test('logDose an hour ahead is a RangeError, as in every phone store', () => {
    expect(() => {
      logDose('user-a', { medicationId: MEDICATION, takenAt: new Date('2026-11-27T19:00:00Z'), episodeId: null });
    }).toThrow(RangeError);
    expect(listOutbox('user-a')).toEqual([]);
  });

  test('a RangeError from a later writer rolls back an earlier one in the same transaction', () => {
    const id = '00000000-0000-4000-8000-0000000000e8';
    expect(() => {
      localDb().withTransactionSync(() => {
        logEpisodeTx('user-a', id, { startedAt: '2026-11-27T16:00:00.000Z', endedAt: '2026-11-27T17:00:00.000Z', source: 'chat' });
        logDoseTx('user-a', { medicationId: MEDICATION, takenAt: new Date('2026-11-27T19:00:00Z'), episodeId: id });
      });
    }).toThrow(RangeError);

    expect(localDb().getAllSync('SELECT id FROM episodes;')).toEqual([]);
    expect(localDb().getAllSync('SELECT id FROM doses;')).toEqual([]);
    expect(listOutbox('user-a')).toEqual([]);
  });
});
