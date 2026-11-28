import { allowUserKeys, kvGet, kvKeys, kvRemove, kvSet } from '../../lib/kv';
import { localDb } from '../../lib/local/db';
import { enqueue } from '../../lib/outbox/outbox';
import { readPendingClaim, writePendingClaim } from '../../push/pushStore';
import { clearLocalDb, insertEpisode } from '../../test/localDbTest';
import { forgetAccountOnDevice, orphanOwners, sweepOrphanKeys } from '../forgetAccount';

jest.mock('expo-sqlite', () => require('../../test/sqliteNode'));

const U1 = '0b7f6d7e-1111-4c4c-9a9a-000000000001';
const U2 = '0b7f6d7e-2222-4c4c-9a9a-000000000002';
const E1 = '0b7f6d7e-eeee-4c4c-9a9a-0000000000e1';
const E9 = '0b7f6d7e-eeee-4c4c-9a9a-0000000000e9';

const DEVICE_WIDE = ['locale-preference', 'intro.seen', 'push.deviceSecret', 'push.pendingUnregister'];

function rowsOf(userId: string): number {
  const tables = ['episodes', 'medications', 'doses', 'checkins', 'chat_messages', 'outbox'];
  // Each name comes from the fixed list above.
  return tables.reduce(
    (sum, table) => sum + (localDb().getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?;`, [userId])?.n ?? 0),
    0,
  );
}

beforeEach(() => {
  clearLocalDb();
  for (const key of kvKeys()) kvRemove(key);
  allowUserKeys(U1);
  allowUserKeys(U2);
});

describe('forgetAccountOnDevice', () => {
  test("removes every kv key with the user's id as a segment and keeps another user's and the device-wide ones", () => {
    const mine = [`profile.${U1}`, `redflag.long.${U1}.${E1}`, `today.over.${U1}.${E1}`, `memory.${U1}`, `push.${U1}`, `account.deleting.${U1}`];
    for (const key of [...mine, `profile.${U2}`, ...DEVICE_WIDE]) kvSet(key, 'x');

    forgetAccountOnDevice(U1);

    expect(kvKeys().sort()).toEqual([`profile.${U2}`, ...DEVICE_WIDE].sort());
  });

  test("refuses the user's later writes, and only that user's", () => {
    forgetAccountOnDevice(U1);

    kvSet(`signals.${U1}`, 'late');
    kvSet(`signals.${U2}`, 'fine');

    expect(kvGet(`signals.${U1}`)).toBeNull();
    expect(kvGet(`signals.${U2}`)).toBe('fine');
  });

  test("deletes the user's mirror, chat and outbox rows, queued or not, and keeps another user's", () => {
    insertEpisode(U1, 'clean');
    insertEpisode(U1, 'queued');
    insertEpisode(U2, 'theirs');
    localDb().withTransactionSync(() => {
      enqueue(U1, 'delete_episode', { p_id: 'queued' });
    });
    localDb().runSync(
      "INSERT INTO chat_messages (user_id, role, text, created_at, status, mode) VALUES (?, 'user', 'hi', 1, 'sent', 'chat');",
      [U1],
    );

    forgetAccountOnDevice(U1);

    expect(rowsOf(U1)).toBe(0);
    expect(rowsOf(U2)).toBe(1);
  });
});

test("drops this phone's token reclaim when it is the deleted account's, and keeps another account's", () => {
  const claim = { token: 'ExponentPushToken[x]', platform: 'android' as const, nonce: 'n', startedAt: 1 };
  writePendingClaim({ ...claim, userId: U2 });
  forgetAccountOnDevice(U1);
  expect(readPendingClaim()?.userId).toBe(U2);

  writePendingClaim({ ...claim, userId: U1 });
  forgetAccountOnDevice(U1);
  expect(readPendingClaim()).toBeNull();
});

describe('sweepOrphanKeys (at launch)', () => {
  test('an attack id from a legacy key is no account: never an owner to forget, but its keys still go', () => {
    kvSet(`redflag.long.${E9}`, 'x');
    kvSet(`today.over.${E9}`, '1');
    kvSet(`profile.${U1}`, 'x');

    expect(orphanOwners(U2, () => false)).toEqual([U1]);
    sweepOrphanKeys(U2, () => true);

    expect(kvKeys()).toEqual([`profile.${U1}`]);
  });

  test("removes another account's keys and a key from before kv keys carried the user id, keeping the signed-in one's", () => {
    for (const key of [`profile.${U1}`, `premium.${U1}`, `companion.quota.companion.${U1}.2026-12-01`, `redflag.long.${E9}`, `profile.${U2}`, ...DEVICE_WIDE]) {
      kvSet(key, 'x');
    }

    sweepOrphanKeys(U2, () => false);

    expect(kvKeys().sort()).toEqual([`profile.${U2}`, ...DEVICE_WIDE].sort());
  });

  test('keeps the keys of an account with something still queued', () => {
    kvSet(`profile.${U1}`, 'x');
    kvSet(`redflag.long.${E9}`, 'x');

    sweepOrphanKeys(U2, (userId) => userId === U1);

    expect(kvGet(`profile.${U1}`)).toBe('x');
    expect(kvGet(`redflag.long.${E9}`)).toBeNull();
  });

  test('signed out, it sweeps every account, and leaves deletion markers to their own sweep', () => {
    kvSet(`profile.${U1}`, 'x');
    kvSet(`account.deleting.${U2}`, 'reauth:1');

    expect(orphanOwners(null, () => false)).toEqual([U1]);
    sweepOrphanKeys(null, () => false);

    expect(kvKeys()).toEqual([`account.deleting.${U2}`]);
  });
});
