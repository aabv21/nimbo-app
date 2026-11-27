import { act, renderHook } from '@testing-library/react-native';

import { localDb } from '../../lib/local/db';
import { listOutbox } from '../../lib/outbox/outbox';
import { clearLocalDb } from '../../test/localDbTest';
import { deleteDose, logDose, useDoses } from '../doseStore';

jest.mock('expo-sqlite', () => require('../../test/sqliteNode'));
jest.mock('expo-crypto', () => ({ randomUUID: () => (require('node:crypto') as typeof import('node:crypto')).randomUUID() }));

const MEDICATION = '00000000-0000-4000-8000-0000000000a1';
const EPISODE = '00000000-0000-4000-8000-0000000000e1';
const TAKEN = new Date('2026-11-27T15:30:00Z');
// Only `Date` is pinned, after TAKEN: `logDose` refuses a time more than 5 minutes ahead.
const NOW = new Date('2026-11-27T18:00:00Z');

beforeEach(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'],
  });
  clearLocalDb();
});

afterEach(() => {
  jest.useRealTimers();
});

function doseRows(): { id: string; medication_id: string; episode_id: string | null; taken_at: string; user_id: string; dirty: number }[] {
  return localDb().getAllSync('SELECT id, medication_id, episode_id, taken_at, user_id, dirty FROM doses;');
}

test('logDose returns a new id, writes the mirror row and queues log_dose', () => {
  const first = logDose('user-a', { medicationId: MEDICATION, takenAt: TAKEN, episodeId: EPISODE });
  const second = logDose('user-a', { medicationId: MEDICATION, takenAt: TAKEN, episodeId: null });

  expect(first).not.toBe(second);
  expect(doseRows()).toEqual([
    { id: first, medication_id: MEDICATION, episode_id: EPISODE, taken_at: '2026-11-27T15:30:00.000Z', user_id: 'user-a', dirty: 1 },
    { id: second, medication_id: MEDICATION, episode_id: null, taken_at: '2026-11-27T15:30:00.000Z', user_id: 'user-a', dirty: 1 },
  ]);
  const [one, two] = listOutbox('user-a');
  expect(one).toEqual(
    expect.objectContaining({
      kind: 'log_dose',
      recordKey: first,
      args: { p_id: first, p_medication_id: MEDICATION, p_taken_at: '2026-11-27T15:30:00.000Z', p_episode_id: EPISODE },
    }),
  );
  // No episode means the key is left out, never sent as null.
  expect(two?.args).toEqual({ p_id: second, p_medication_id: MEDICATION, p_taken_at: '2026-11-27T15:30:00.000Z' });
});

test('deleteDose removes the mirror row and queues delete_dose', () => {
  const id = logDose('user-a', { medicationId: MEDICATION, takenAt: TAKEN, episodeId: null });
  deleteDose('user-a', id);

  expect(doseRows()).toEqual([]);
  expect(listOutbox('user-a').map((op) => op.kind)).toEqual(['log_dose', 'delete_dose']);
  expect(listOutbox('user-a')[1]).toEqual(expect.objectContaining({ args: { p_id: id }, recordKey: id }));
});

test('deleteDose leaves another user’s row alone', () => {
  const id = logDose('user-a', { medicationId: MEDICATION, takenAt: TAKEN, episodeId: null });
  deleteDose('user-b', id);
  expect(doseRows()).toHaveLength(1);
});

test('useDoses reads only the user’s doses, newest first, filtered by episode or medication', async () => {
  const early = logDose('user-a', { medicationId: MEDICATION, takenAt: new Date('2026-11-01T10:00:00Z'), episodeId: null });
  const late = logDose('user-a', { medicationId: MEDICATION, takenAt: TAKEN, episodeId: EPISODE });
  logDose('user-a', { medicationId: 'other-medication', takenAt: TAKEN, episodeId: null });
  logDose('user-b', { medicationId: MEDICATION, takenAt: TAKEN, episodeId: null });

  const all = await renderHook(() => useDoses('user-a'));
  expect(all.result.current).toHaveLength(3);
  expect(all.result.current[0]).toEqual(expect.objectContaining({ takenAt: '2026-11-27T15:30:00.000Z' }));

  const byEpisode = await renderHook(() => useDoses('user-a', { episodeId: EPISODE }));
  expect(byEpisode.result.current.map((dose) => dose.id)).toEqual([late]);

  const byMedication = await renderHook(() => useDoses('user-a', { medicationId: MEDICATION }));
  expect(byMedication.result.current.map((dose) => dose.id).sort()).toEqual([early, late].sort());

  await act(async () => {
    deleteDose('user-a', late);
    await Promise.resolve();
  });
  expect(byEpisode.result.current).toEqual([]);
});
