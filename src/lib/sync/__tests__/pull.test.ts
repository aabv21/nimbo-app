import type { Client } from '../../../auth/emailAuth';
import { allowUserKeys, refuseUserKeys } from '../../kv';
import { localDb } from '../../local/db';
import { clearLocalDb, insertEpisode } from '../../../test/localDbTest';
import { enqueue } from '../../outbox/outbox';
import { PULL_COLUMNS, pullAll } from '../pull';

jest.mock('expo-sqlite', () => require('../../../test/sqliteNode'));
jest.mock('../../supabase', () => ({ supabase: {} }));

type Table = 'episodes' | 'medications' | 'doses' | 'checkins';
type ServerRow = Record<string, unknown>;

const A = 'user-a';
const B = 'user-b';
const E1 = '00000000-0000-4000-8000-000000000001';
const E2 = '00000000-0000-4000-8000-000000000002';
const E3 = '00000000-0000-4000-8000-000000000003';

function episode(id: string, userId: string, patch: ServerRow = {}): ServerRow {
  return {
    id,
    user_id: userId,
    condition: 'migraine',
    started_at: '2026-11-27T10:00:00+00:00',
    ended_at: null,
    intensity: 6,
    pain_areas: ['temple_left'],
    symptoms: [],
    triggers: ['stress'],
    reliefs: [],
    notes: null,
    source: 'manual',
    created_at: '2026-11-27T10:00:01+00:00',
    updated_at: '2026-11-27T10:00:01+00:00',
    ...patch,
  };
}

/** A fake PostgREST client: each table answers its rows, recording the select and filters. */
function fakeClient(rows: Partial<Record<Table, ServerRow[]>>, error: { code: string } | null = null) {
  const calls: { table: string; columns: string; filters: [string, unknown][] }[] = [];
  const client = {
    from(table: Table) {
      const call = { table, columns: '', filters: [] as [string, unknown][] };
      calls.push(call);
      const builder = {
        select(columns: string) {
          call.columns = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          call.filters.push([column, value]);
          return builder;
        },
        order() {
          return builder;
        },
        range(from: number, to: number) {
          const page = (new Map(Object.entries(rows)).get(table) ?? []).slice(from, to + 1);
          return Promise.resolve(error === null ? { data: page, error: null, status: 200 } : { data: null, error, status: 0 });
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as Client, calls };
}

function localEpisodes(): { id: string; user_id: string; intensity: number | null; pain_areas: string; dirty: number }[] {
  return localDb().getAllSync('SELECT id, user_id, intensity, pain_areas, dirty FROM episodes ORDER BY id;');
}

beforeEach(clearLocalDb);

test('replaces non-dirty rows with the server version', async () => {
  insertEpisode(A, E1);
  const { client } = fakeClient({ episodes: [episode(E1, A, { intensity: 8 }), episode(E2, A)] });

  expect(await pullAll(A, client)).toEqual({ ok: true, value: undefined });

  expect(localEpisodes()).toEqual([
    { id: E1, user_id: A, intensity: 8, pain_areas: '["temple_left"]', dirty: 0 },
    { id: E2, user_id: A, intensity: 6, pain_areas: '["temple_left"]', dirty: 0 },
  ]);
});

test('a pull that lands after the account was deleted on this phone writes nothing back', async () => {
  const { client } = fakeClient({ episodes: [episode(E1, A)] });
  refuseUserKeys(A);

  expect(await pullAll(A, client)).toEqual({ ok: true, value: undefined });

  expect(localEpisodes()).toEqual([]);
  allowUserKeys(A);
});

test("keeps a dirty row's local version", async () => {
  localDb().withTransactionSync(() => {
    localDb().runSync('INSERT INTO episodes (id, user_id, started_at, intensity) VALUES (?, ?, ?, 3);', [E1, A, '2026-11-27T10:00:00.000Z']);
    enqueue(A, 'update_episode', { p_id: E1, p_fields: { intensity: 3 } });
  });
  const { client } = fakeClient({ episodes: [episode(E1, A, { intensity: 8 })] });

  await pullAll(A, client);

  expect(localEpisodes()).toEqual([expect.objectContaining({ id: E1, intensity: 3, dirty: 1 })]);
});

test('deletes a non-dirty local row the server no longer has, but not one with an unsent operation', async () => {
  insertEpisode(A, E1);
  // Deleted on the phone, its delete not sent yet: the server still has it and the pull must not bring it back.
  localDb().withTransactionSync(() => {
    enqueue(A, 'delete_episode', { p_id: E3 });
  });
  const { client } = fakeClient({ episodes: [episode(E3, A)] });

  await pullAll(A, client);

  expect(localEpisodes()).toEqual([]);
});

test("writes only the signed-in user's rows and leaves other users' local rows alone", async () => {
  insertEpisode(B, E2);
  const { client, calls } = fakeClient({ episodes: [episode(E1, A), episode(E3, B)] });

  await pullAll(A, client);

  expect(localEpisodes().map((row) => [row.id, row.user_id])).toEqual([
    [E1, A],
    [E2, B],
  ]);
  for (const call of calls) expect(call.filters).toContainEqual(['user_id', A]);
});

test('each query uses an explicit column list', async () => {
  const { client, calls } = fakeClient({});

  await pullAll(A, client);

  expect(calls.map((call) => call.table).sort()).toEqual(['checkins', 'doses', 'episodes', 'medications']);
  for (const call of calls) {
    expect(call.columns).not.toContain('*');
    expect(call.columns).toBe(PULL_COLUMNS[call.table as Table]);
  }
});

test('booleans and arrays are stored as SQLite values', async () => {
  const { client } = fakeClient({
    checkins: [
      {
        user_id: A,
        local_date: '2026-11-27',
        sleep_band: '6_7',
        sleep_quality: 'ok',
        stress: 'high',
        low_water: true,
        extra_caffeine: false,
        alcohol: false,
        skipped_meal: true,
        screen_heavy: false,
        period_started: false,
        created_at: '2026-11-27T08:00:00+00:00',
        updated_at: '2026-11-27T08:00:00+00:00',
      },
    ],
  });

  await pullAll(A, client);

  expect(localDb().getFirstSync('SELECT stress, low_water, skipped_meal, dirty FROM checkins;')).toEqual({
    stress: 'high',
    low_water: 1,
    skipped_meal: 1,
    dirty: 0,
  });
});

test('reads every page past the API row limit', async () => {
  const many = Array.from({ length: 1_001 }, (_, index) =>
    episode(`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, A),
  );
  const { client } = fakeClient({ episodes: many });

  await pullAll(A, client);

  expect(localEpisodes()).toHaveLength(1_001);
});

test('a failed read changes nothing and reports the kind', async () => {
  insertEpisode(A, E1);
  const { client } = fakeClient({}, { code: '' });

  expect(await pullAll(A, client)).toEqual({ ok: false, kind: 'network' });
  expect(localEpisodes()).toHaveLength(1);
});

test('the debrief columns come down: episode helped, did_not_help and debriefed_at, and dose helped as 0, 1 or null', async () => {
  expect(PULL_COLUMNS.episodes.split(',')).toEqual(expect.arrayContaining(['helped', 'did_not_help', 'debriefed_at']));
  expect(PULL_COLUMNS.doses.split(',')).toContain('helped');
  const dose = (id: string, helped: boolean | null): ServerRow => ({
    id,
    user_id: A,
    medication_id: E3,
    episode_id: E1,
    taken_at: '2026-11-27T10:30:00+00:00',
    helped,
    created_at: '2026-11-27T10:30:01+00:00',
    updated_at: '2026-11-27T10:30:01+00:00',
  });
  const { client } = fakeClient({
    episodes: [episode(E1, A, { helped: ['dark_room'], did_not_help: ['caffeine'], debriefed_at: '2026-11-28T09:00:00+00:00' })],
    doses: [dose(E1, true), dose(E2, false), dose(E3, null)],
  });

  await pullAll(A, client);

  expect(localDb().getFirstSync('SELECT helped, did_not_help, debriefed_at FROM episodes WHERE id = ?;', [E1])).toEqual({
    helped: '["dark_room"]',
    did_not_help: '["caffeine"]',
    debriefed_at: '2026-11-28T09:00:00+00:00',
  });
  expect(localDb().getAllSync('SELECT helped FROM doses ORDER BY id;')).toEqual([{ helped: 1 }, { helped: 0 }, { helped: null }]);
});
