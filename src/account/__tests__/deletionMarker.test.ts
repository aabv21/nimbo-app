import { allowUserKeys, kvGet, kvKeys, kvRemove, kvSet } from '../../lib/kv';
import { localDb } from '../../lib/local/db';
import { clearLocalDb, insertEpisode } from '../../test/localDbTest';
import {
  clearDeletionMarker,
  DELETION_SETTLE_MS,
  deletionState,
  forgetInterruptedDeletions,
  markDeletion,
  readDeletionMarker,
} from '../deletionMarker';

jest.mock('expo-sqlite', () => require('../../test/sqliteNode'));

const NOW = 1_700_000_000_000;
const DELETING = '0b7f6d7e-1111-4c4c-9a9a-000000000001';
const REAUTH = '0b7f6d7e-2222-4c4c-9a9a-000000000002';
const ACTIVE = '0b7f6d7e-3333-4c4c-9a9a-000000000003';

function episodes(userId: string): number {
  return localDb().getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM episodes WHERE user_id = ?;', [userId])?.n ?? 0;
}

beforeEach(() => {
  clearLocalDb();
  for (const key of kvKeys()) kvRemove(key);
  for (const user of [DELETING, REAUTH, ACTIVE]) allowUserKeys(user);
});

test('marks, reads and clears a deletion under account.deleting.<id>', () => {
  expect(deletionState(DELETING)).toBeNull();

  markDeletion(DELETING, 'deleting', NOW);
  expect(kvGet(`account.deleting.${DELETING}`)).toBe(`deleting:${String(NOW)}`);
  expect(deletionState(DELETING)).toBe('deleting');
  expect(readDeletionMarker(DELETING, NOW)).toEqual({ state: 'deleting', markedAt: NOW });

  markDeletion(DELETING, 'reauth', NOW + 60_000);
  expect(readDeletionMarker(DELETING, NOW)).toEqual({ state: 'reauth', markedAt: NOW + 60_000 });

  clearDeletionMarker(DELETING);
  expect(deletionState(DELETING)).toBeNull();
});

test.each([
  ['a bare state', 'deleting'],
  ['an empty time', 'deleting:'],
  ['a time that is not a number', 'deleting:soon'],
  ['a negative time', 'deleting:-5'],
  ['a non-finite time', 'reauth:Infinity'],
  ['a time in the future', `reauth:${String(NOW + DELETION_SETTLE_MS + 1)}`],
])('a marker with %s still counts, with an untrusted time', (_name, value) => {
  kvSet(`account.deleting.${DELETING}`, value);

  expect(deletionState(DELETING)).toBe(value.startsWith('reauth') ? 'reauth' : 'deleting');
  expect(readDeletionMarker(DELETING, NOW)?.markedAt).toBeNull();
});

test('a value with another state counts as none', () => {
  kvSet(`account.deleting.${DELETING}`, 'maybe');
  kvSet(`account.deleting.${REAUTH}`, 'deletingX:1');

  expect(deletionState(DELETING)).toBeNull();
  expect(deletionState(REAUTH)).toBeNull();
});

test("a session that ended drops a deleting account's rows, keys and marker, and keeps a reauth one's", () => {
  markDeletion(DELETING, 'deleting');
  kvSet(`profile.${DELETING}`, 'x');
  insertEpisode(DELETING, 'theirs');
  markDeletion(REAUTH, 'reauth');
  kvSet(`profile.${REAUTH}`, 'x');

  forgetInterruptedDeletions(null);

  expect(deletionState(DELETING)).toBeNull();
  expect(kvGet(`profile.${DELETING}`)).toBeNull();
  expect(episodes(DELETING)).toBe(0);
  expect(deletionState(REAUTH)).toBe('reauth');
  expect(kvGet(`profile.${REAUTH}`)).toBe('x');
});

test("the signed-in user's own unfinished deletion is left for their session to check", () => {
  markDeletion(ACTIVE, 'deleting');
  kvSet(`profile.${ACTIVE}`, 'x');

  forgetInterruptedDeletions(ACTIVE);

  expect(deletionState(ACTIVE)).toBe('deleting');
  expect(kvGet(`profile.${ACTIVE}`)).toBe('x');
});
