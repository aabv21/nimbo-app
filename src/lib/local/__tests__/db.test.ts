import { clearLocalDb, insertEpisode } from '../../../test/localDbTest';
import { enqueue } from '../../outbox/outbox';
import { localDb, notifyChanged, purgeOtherUsers, purgeUser, subscribeTables } from '../db';

jest.mock('expo-sqlite', () => require('../../../test/sqliteNode'));

test('opens once, at schema version 1, with every mirror table and the outbox', () => {
  const db = localDb();
  expect(localDb()).toBe(db);
  expect(db.getFirstSync<{ user_version: number }>('PRAGMA user_version;')?.user_version).toBe(1);
  const tables = db
    .getAllSync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;")
    .map((row) => row.name);
  expect(tables).toEqual(['checkins', 'doses', 'episodes', 'medications', 'outbox']);
});

test('every mirror table has user_id and a 0/1 dirty flag', () => {
  for (const table of ['episodes', 'medications', 'doses', 'checkins']) {
    // `table` comes from the fixed list above.
    const columns = localDb().getAllSync<{ name: string }>(`PRAGMA table_info(${table});`).map((column) => column.name);
    expect(columns).toEqual(expect.arrayContaining(['user_id', 'dirty']));
  }
  expect(() => localDb().runSync("INSERT INTO episodes (id, user_id, started_at, dirty) VALUES ('e', 'u', 't', 2);")).toThrow();
});

test('a change notifies only the listeners of that table', () => {
  const onEpisodes = jest.fn();
  const onDoses = jest.fn();
  const stopEpisodes = subscribeTables(['episodes'], onEpisodes);
  const stopDoses = subscribeTables(['doses', 'outbox'], onDoses);

  notifyChanged(['episodes']);
  expect(onEpisodes).toHaveBeenCalledTimes(1);
  expect(onDoses).not.toHaveBeenCalled();

  notifyChanged(['doses', 'outbox']);
  expect(onDoses).toHaveBeenCalledTimes(1);

  stopEpisodes();
  stopDoses();
  notifyChanged(['episodes', 'doses']);
  expect(onEpisodes).toHaveBeenCalledTimes(1);
  expect(onDoses).toHaveBeenCalledTimes(1);
});

describe('purging a user', () => {
  beforeEach(clearLocalDb);

  function rowsOf(userId: string): number {
    const tables = ['episodes', 'medications', 'doses', 'checkins'];
    // Each name comes from the fixed list above.
    return tables.reduce(
      (sum, table) =>
        sum + (localDb().getFirstSync<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?;`, [userId])?.n ?? 0),
      0,
    );
  }

  function seed(userId: string): void {
    insertEpisode(userId, `${userId}-episode`);
    localDb().runSync(
      "INSERT INTO medications (id, user_id, name, kind, class) VALUES (?, ?, 'Ibuprofen', 'acute', 'simple_analgesic');",
      [`${userId}-medication`, userId],
    );
    localDb().runSync("INSERT INTO doses (id, user_id, medication_id, taken_at) VALUES (?, ?, ?, '2026-11-27T10:00:00Z');", [
      `${userId}-dose`,
      userId,
      `${userId}-medication`,
    ]);
    localDb().runSync("INSERT INTO checkins (user_id, local_date) VALUES (?, '2026-11-27');", [userId]);
  }

  test('removes every mirror row of a user with an empty outbox, and only theirs', () => {
    seed('user-a');
    seed('user-b');
    const listener = jest.fn();
    const stop = subscribeTables(['episodes'], listener);

    expect(purgeUser('user-a')).toBe(true);

    expect(rowsOf('user-a')).toBe(0);
    expect(rowsOf('user-b')).toBe(4);
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
  });

  test('keeps everything while the user has an unsent or failed operation', () => {
    seed('user-a');
    localDb().withTransactionSync(() => {
      enqueue('user-a', 'delete_dose', { p_id: 'user-a-dose' });
    });
    expect(purgeUser('user-a')).toBe(false);
    expect(rowsOf('user-a')).toBe(4);

    localDb().runSync('UPDATE outbox SET failed = 1;');
    expect(purgeUser('user-a')).toBe(false);
    expect(rowsOf('user-a')).toBe(4);
  });

  test('purgeOtherUsers keeps the signed-in user and anyone with queued operations', () => {
    seed('signed-in');
    seed('clean');
    seed('queued');
    localDb().withTransactionSync(() => {
      enqueue('queued', 'delete_episode', { p_id: 'queued-episode' });
    });

    purgeOtherUsers('signed-in');

    expect(rowsOf('signed-in')).toBe(4);
    expect(rowsOf('clean')).toBe(0);
    expect(rowsOf('queued')).toBe(4);
  });

  test('signed out, every clean user is purged', () => {
    seed('clean');
    purgeOtherUsers(null);
    expect(rowsOf('clean')).toBe(0);
  });
});
