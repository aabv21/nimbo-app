import { File, Paths } from 'expo-file-system';

import { signOutLocally } from '../../auth/emailAuth';
import { allowUserKeys, kvGet, kvKeys, kvRemove, kvSet } from '../../lib/kv';
import { localDb } from '../../lib/local/db';
import { readStoredSession } from '../../lib/supabase';
import { cacheFiles, resetFiles } from '../../test/fileSystemMock';
import { clearLocalDb, insertEpisode } from '../../test/localDbTest';
import { deleteAccount, verifyAccount } from '../accountClient';
import { confirmPendingDeletion, deletionMessage, runDeletion } from '../deletionFlow';
import { DELETION_SETTLE_MS, deletionState, markDeletion } from '../deletionMarker';

jest.mock('expo-sqlite', () => require('../../test/sqliteNode'));
jest.mock('../accountClient', () => ({ deleteAccount: jest.fn(), verifyAccount: jest.fn() }));
jest.mock('../../auth/emailAuth', () => ({ signOutLocally: jest.fn(() => Promise.resolve()) }));
jest.mock('../../lib/supabase', () => ({ readStoredSession: jest.fn(() => null) }));

const mockedDelete = jest.mocked(deleteAccount);
const mockedVerify = jest.mocked(verifyAccount);
const mockedSignOut = jest.mocked(signOutLocally);
const mockedSession = jest.mocked(readStoredSession);

const U1 = '0b7f6d7e-1111-4c4c-9a9a-000000000001';
const MARKER = `account.deleting.${U1}`;

function fakeOutbox() {
  return { pause: jest.fn(() => Promise.resolve()), clear: jest.fn(), resume: jest.fn() };
}

function session(userId: string): ReturnType<typeof readStoredSession> {
  return { userId, email: null };
}

function rowsOf(userId: string): number {
  return localDb().getFirstSync<{ n: number }>('SELECT COUNT(*) AS n FROM episodes WHERE user_id = ?;', [userId])?.n ?? 0;
}

beforeEach(async () => {
  jest.clearAllMocks();
  clearLocalDb();
  resetFiles();
  for (const key of kvKeys()) kvRemove(key);
  mockedSession.mockReturnValue(session(U1));
  // A deletion refuses the user's later writes for the process; each test starts from a live account.
  allowUserKeys(U1);
  kvSet(`profile.${U1}`, 'x');
  kvSet(`memory.${U1}`, '[]');
  kvSet('locale-preference', 'es');
  insertEpisode(U1, 'mine');
  await new File(Paths.cache, 'nimbo-data-2026-11-27.json').write('{}');
});

test('success marks before pausing, clears the outbox, signs out, forgets the account and the export, and resumes without a run', async () => {
  const outbox = fakeOutbox();
  let markedAtPause: string | null = null;
  outbox.pause.mockImplementation(() => {
    markedAtPause = kvGet(MARKER);
    return Promise.resolve();
  });
  mockedDelete.mockResolvedValue({ ok: true });

  expect(await runDeletion(U1, outbox)).toBe('deleted');

  expect(markedAtPause).toMatch(/^deleting:\d+$/);
  expect(outbox.clear).toHaveBeenCalledTimes(1);
  expect(mockedSignOut).toHaveBeenCalledTimes(1);
  expect(kvKeys()).toEqual(['locale-preference']);
  expect(rowsOf(U1)).toBe(0);
  expect(cacheFiles()).toEqual([]);
  expect(outbox.resume).toHaveBeenCalledWith({ run: false });
});

test("after `deleted`, a late write to the user's keys stores nothing", async () => {
  mockedDelete.mockResolvedValue({ ok: true });

  expect(await runDeletion(U1, fakeOutbox())).toBe('deleted');
  // Late answers: the signals cache, a profile read, a quota.
  kvSet(`signals.${U1}`, 'late');
  kvSet(`profile.${U1}`, 'late');
  kvSet(`companion.quota.companion.${U1}.2026-12-01`, '1');

  expect(kvKeys()).toEqual(['locale-preference']);
});

test('a deletion that ends after another account signed in never signs that account out, and still forgets the deleted one', async () => {
  mockedSession.mockReturnValue(session('another-user'));
  mockedDelete.mockResolvedValue({ ok: true });

  expect(await runDeletion(U1, fakeOutbox())).toBe('deleted');

  expect(mockedSignOut).not.toHaveBeenCalled();
  expect(kvGet(`profile.${U1}`)).toBeNull();
});

test('a failing outbox clear still signs out and forgets the account', async () => {
  const outbox = fakeOutbox();
  outbox.clear.mockImplementation(() => {
    throw new Error('sqlite');
  });
  mockedDelete.mockResolvedValue({ ok: true });

  expect(await runDeletion(U1, outbox)).toBe('deleted');

  expect(mockedSignOut).toHaveBeenCalledTimes(1);
  expect(rowsOf(U1)).toBe(0);
  expect(outbox.resume).toHaveBeenCalledWith({ run: false });
});

test('a 401 is reauth: the marker says so, the data stays, the phone signs out, and the outbox resumes without a run', async () => {
  const outbox = fakeOutbox();
  mockedDelete.mockResolvedValue({ ok: false, error: 'reauth' });

  expect(await runDeletion(U1, outbox)).toBe('reauth');

  expect(deletionState(U1)).toBe('reauth');
  expect(outbox.clear).not.toHaveBeenCalled();
  expect(kvGet(`profile.${U1}`)).toBe('x');
  expect(mockedSignOut).toHaveBeenCalledTimes(1);
  expect(outbox.resume).toHaveBeenCalledWith({ run: false });
});

test.each(['network', 'unknown'] as const)(
  'a %s failure keeps the marker at deleting (the server may have finished), forgets nothing and resumes without a run',
  async (error) => {
    const outbox = fakeOutbox();
    mockedDelete.mockResolvedValue({ ok: false, error });

    expect(await runDeletion(U1, outbox)).toBe(error);

    expect(deletionState(U1)).toBe('deleting');
    expect(outbox.clear).not.toHaveBeenCalled();
    expect(mockedSignOut).not.toHaveBeenCalled();
    expect(kvGet(`profile.${U1}`)).toBe('x');
    expect(rowsOf(U1)).toBe(1);
    expect(cacheFiles()).toEqual(['nimbo-data-2026-11-27.json']);
    expect(outbox.resume).toHaveBeenCalledWith({ run: false });
  },
);

test('a second tap while one runs is busy and never calls the function twice', async () => {
  const outbox = fakeOutbox();
  let finish: (value: { ok: true }) => void = () => undefined;
  mockedDelete.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );

  const first = runDeletion(U1, outbox);
  expect(await runDeletion(U1, outbox)).toBe('busy');
  finish({ ok: true });

  expect(await first).toBe('deleted');
  expect(mockedDelete).toHaveBeenCalledTimes(1);
});

describe('confirmPendingDeletion (a launch, resume or reconnect with the marker present)', () => {
  const MARKED_AT = 1_700_000_000_000;
  const settled = (): number => MARKED_AT + DELETION_SETTLE_MS;

  beforeEach(() => {
    markDeletion(U1, 'deleting', MARKED_AT);
  });

  test('an account that is gone gets the cleanup and sign-out of a confirmed deletion, at once', async () => {
    const outbox = fakeOutbox();
    mockedVerify.mockResolvedValue('gone');

    expect(await confirmPendingDeletion(U1, outbox, () => MARKED_AT + 1)).toBe('deleted');

    expect(mockedVerify).toHaveBeenCalledWith(U1);
    expect(outbox.clear).toHaveBeenCalledTimes(1);
    expect(mockedSignOut).toHaveBeenCalledTimes(1);
    expect(kvKeys()).toEqual(['locale-preference']);
    expect(rowsOf(U1)).toBe(0);
    expect(outbox.resume).toHaveBeenCalledWith({ run: false });
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  test('an account that still exists past the settle window drops the marker and resumes the outbox with a run, deleting nothing', async () => {
    const outbox = fakeOutbox();
    mockedVerify.mockResolvedValue('exists');

    expect(await confirmPendingDeletion(U1, outbox, settled)).toBe('kept');

    expect(deletionState(U1)).toBeNull();
    expect(outbox.resume).toHaveBeenCalledWith();
    expect(outbox.clear).not.toHaveBeenCalled();
    expect(mockedSignOut).not.toHaveBeenCalled();
    expect(kvGet(`profile.${U1}`)).toBe('x');
  });

  test('within the settle window it stays pending (the server may still be deleting)', async () => {
    const outbox = fakeOutbox();
    mockedVerify.mockResolvedValue('exists');

    expect(await confirmPendingDeletion(U1, outbox, () => settled() - 1)).toBe('pending');

    expect(deletionState(U1)).toBe('deleting');
    expect(outbox.resume).not.toHaveBeenCalled();
  });

  test('a marker with an untrusted time is stamped now and stays pending, so the window starts over', async () => {
    const outbox = fakeOutbox();
    kvSet(MARKER, 'deleting:soon');
    mockedVerify.mockResolvedValue('exists');

    expect(await confirmPendingDeletion(U1, outbox, () => MARKED_AT)).toBe('pending');
    expect(kvGet(MARKER)).toBe(`deleting:${String(MARKED_AT)}`);

    expect(await confirmPendingDeletion(U1, outbox, settled)).toBe('kept');
  });

  test('a reauth marker for an account that exists is cleared at once and resumes the outbox: the server refused, so nothing settles', async () => {
    const outbox = fakeOutbox();
    markDeletion(U1, 'reauth', MARKED_AT);
    mockedVerify.mockResolvedValue('exists');

    expect(await confirmPendingDeletion(U1, outbox, () => MARKED_AT + 1)).toBe('kept');

    expect(deletionState(U1)).toBeNull();
    expect(outbox.resume).toHaveBeenCalledWith();
    expect(kvGet(`profile.${U1}`)).toBe('x');
  });

  test('an unknown answer keeps the marker and the blocked outbox for the next check', async () => {
    const outbox = fakeOutbox();
    mockedVerify.mockResolvedValue('unknown');

    expect(await confirmPendingDeletion(U1, outbox, settled)).toBe('pending');

    expect(deletionState(U1)).toBe('deleting');
    expect(outbox.resume).not.toHaveBeenCalled();
    expect(mockedSignOut).not.toHaveBeenCalled();
  });
});

test('maps each result to its message', () => {
  expect(deletionMessage('reauth')).toBe('delete.error.reauth');
  expect(deletionMessage('network')).toBe('delete.error.network');
  expect(deletionMessage('unknown')).toBe('delete.error.unknown');
  expect(deletionMessage('deleted')).toBeUndefined();
  expect(deletionMessage('busy')).toBeUndefined();
});
