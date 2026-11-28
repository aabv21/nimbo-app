/** @jest-environment node */
// The ten tools over a fake PostgREST: what each reads, what it hands the model (refs, never ids), the
// overuse as Today counts it, and the checks a proposal must pass before it becomes a draft.
import { doseDaysForMonth, MAX_AHEAD_MS, overuseStatus, packs } from '../../condition/index.ts';
import { json } from '../../__tests__/fakeFetch.ts';
import type { SupabaseEnv } from '../../env.ts';
import type { RecordEpisode, RecordInputs } from '../../records.ts';
import { createRefs } from '../refs.ts';
import { runTool, type ToolEnv, type ToolOutcome } from '../tools.ts';
import { fakePostgrest, type Row, SUPABASE_URL, type Tables, USER_AUTH } from './fakePostgrest.ts';

const pack = packs.migraine;
const TZ = 'America/Bogota';
// 12:00 in Bogotá on Friday 27 November 2026.
const NOW = Date.parse('2026-11-27T17:00:00.000Z');
const SUPABASE: SupabaseEnv = { supabaseUrl: SUPABASE_URL, anonKey: 'anon-key', serviceRoleKey: 'service-key' };
const USER_ID = '11111111-1111-4111-8111-111111111111';

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SUMATRIPTAN = id(101);
const NAPROXEN = id(102);
const OLD_TRIPTAN = id(103);
const PREVENTIVE = id(104);

function medication(medId: string, fields: Row): Row {
  return {
    id: medId,
    user_id: 'u',
    kind: 'acute',
    form: 'oral',
    class: 'triptan',
    dose_text: null,
    min_interval_minutes: null,
    archived_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...fields,
  };
}

const MEDICATIONS: Row[] = [
  medication(SUMATRIPTAN, { name: 'Sumatriptan', dose_text: '50 mg, 1 tablet at onset', min_interval_minutes: 120 }),
  medication(NAPROXEN, { name: 'Naproxen', class: 'simple_analgesic', dose_text: '550 mg every 12 h', created_at: '2026-01-02T00:00:00.000Z' }),
  medication(OLD_TRIPTAN, { name: 'Rizatriptan', archived_at: '2026-10-01T00:00:00.000Z', created_at: '2026-01-03T00:00:00.000Z' }),
  medication(PREVENTIVE, { name: 'Topiramate', kind: 'preventive', class: 'other', created_at: '2026-01-04T00:00:00.000Z' }),
];

let doseSeq = 500;
/** A dose at 15:00 local (20:00 UTC) on day `day` of November 2026. */
function dose(medicationId: string, day: number, episodeId: string | null = null): Row {
  doseSeq += 1;
  return { id: id(doseSeq), medication_id: medicationId, episode_id: episodeId, taken_at: `2026-11-${String(day).padStart(2, '0')}T20:00:00.000Z`, helped: null };
}

const OPEN_EPISODE = id(1);
function episode(epId: string, startedAt: string, fields: Row = {}): Row {
  return {
    id: epId,
    started_at: startedAt,
    ended_at: null,
    intensity: 6,
    pain_areas: ['temple_left'],
    symptoms: ['nausea'],
    triggers: [],
    reliefs: [],
    helped: [],
    did_not_help: [],
    notes: 'private note text',
    debriefed_at: null,
    ...fields,
  };
}

function setup(tables: Partial<Tables> = {}, options: { open?: boolean; notes?: Row[]; rpc?: Parameters<typeof fakePostgrest>[1] } = {}) {
  const all: Tables = {
    medications: MEDICATIONS,
    doses: [],
    episodes: [],
    agent_notes: options.notes ?? [],
    ...tables,
  };
  const { fetch, calls } = fakePostgrest(all, options.rpc ?? {});
  const refs = createRefs();
  const open = options.open === true ? { id: OPEN_EPISODE, startedAt: '2026-11-27T15:00:00.000Z', endedAt: null } : null;
  if (open !== null) refs.add('e', open.id);
  const env: ToolEnv = {
    supabase: SUPABASE,
    fetch,
    auth: USER_AUTH,
    timeoutMs: () => 3_000,
    userId: USER_ID,
    pack,
    refs,
    timeZone: TZ,
    localDate: '2026-11-27',
    now: () => NOW,
    openEpisode: open,
    state: { drafts: 0, spans: new Map(open === null ? [] : [[open.id, { start: Date.parse(open.startedAt), end: null }]]) },
  };
  let seq = 0;
  const run = (name: string, input: unknown): Promise<ToolOutcome> => {
    seq += 1;
    return runTool({ id: `toolu_${String(seq)}`, name, input }, env);
  };
  return { env, run, calls, refs };
}

const errorOf = (outcome: ToolOutcome): unknown => (outcome.content as { error?: unknown }).error;

describe('get_cabinet', () => {
  const doses = [
    ...[2, 4, 6, 8, 10].map((day) => dose(SUMATRIPTAN, day)),
    // The archived triptan's doses still count toward the month, as on Today.
    ...[12, 14, 16].map((day) => dose(OLD_TRIPTAN, day)),
    dose(PREVENTIVE, 3),
    // October, outside the month.
    { ...dose(SUMATRIPTAN, 1), taken_at: '2026-10-20T20:00:00.000Z' },
  ];

  test('lists the active medications with dose text and has_min_interval, never an id, the interval or archived_at', async () => {
    const { run } = setup({ doses });
    const outcome = await run('get_cabinet', {});
    expect(outcome.isError).toBe(false);
    const content = outcome.content as { medications: Row[] };
    expect(content.medications).toEqual([
      { ref: 'm1', name: 'Sumatriptan', kind: 'acute', class: 'triptan', form: 'oral', dose_text: '50 mg, 1 tablet at onset', has_min_interval: true },
      { ref: 'm2', name: 'Naproxen', kind: 'acute', class: 'simple_analgesic', form: 'oral', dose_text: '550 mg every 12 h', has_min_interval: false },
      { ref: 'm3', name: 'Topiramate', kind: 'preventive', class: 'other', form: 'oral', dose_text: null, has_min_interval: false },
    ]);
    const text = JSON.stringify(outcome.content);
    expect(text).not.toMatch(/min_interval_minutes|archived_at|Rizatriptan/);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  test('its overuse is what Today computes: 8 triptan days are a warning, archived doses included', async () => {
    const { run } = setup({ doses });
    const outcome = await run('get_cabinet', {});
    const expected = overuseStatus(
      doseDaysForMonth(
        doses.map((row) => ({ medicationId: String(row.medication_id), takenAt: String(row.taken_at) })),
        MEDICATIONS.map((row) => ({ id: String(row.id), kind: row.kind as 'acute' | 'preventive', medicationClass: row.class as 'triptan' })),
        new Date(NOW),
        TZ,
      ),
      pack,
    );
    const overuse = (outcome.content as { overuse: { by_class: Record<string, Row>; combined: Row } }).overuse;
    expect(overuse.by_class).toEqual({ triptan: { ref: 'o1', days: 8, limit: 10, level: 'warn' } });
    expect(overuse.by_class.triptan).toMatchObject(expected.byClass.triptan);
    expect(overuse.combined).toEqual({ ref: 'o2', ...expected.combined, classes: ['triptan'] });
    expect(overuse.combined.level).toBe('ok');
    const evidence = outcome.evidence ?? [];
    expect(evidence.find((item) => item.ref === 'o1')).toMatchObject({ source: 'overuse', count: 8, of: 10, episodeIds: [] });
    expect(evidence.find((item) => item.ref === 'o1')?.doseIds).toHaveLength(8);
  });

  test('5 triptan days and 4 other simple-analgesic days make a combined warning, classes in pack order', async () => {
    const mixed = [...[2, 4, 6, 8, 10].map((day) => dose(SUMATRIPTAN, day)), ...[3, 5, 7, 9].map((day) => dose(NAPROXEN, day))];
    const { run } = setup({ doses: mixed });
    const overuse = ((await run('get_cabinet', {})).content as { overuse: { by_class: Record<string, Row>; combined: Row } }).overuse;
    expect(Object.keys(overuse.by_class)).toEqual(['simple_analgesic', 'triptan']);
    expect(overuse.combined).toMatchObject({ days: 9, level: 'warn', classes: ['simple_analgesic', 'triptan'] });
  });
});

test('get_cabinet lists at most 30 medications and says when it cut the list', async () => {
  const many = Array.from({ length: 31 }, (_, i) =>
    medication(id(200 + i), { name: `Medication ${String(i)}`, created_at: `2026-02-01T00:00:${String(i).padStart(2, '0')}.000Z` }),
  );
  const { run } = setup({ medications: many });
  const content = (await run('get_cabinet', {})).content as { medications: unknown[]; truncated?: boolean };
  expect(content.medications).toHaveLength(30);
  expect(content.truncated).toBe(true);
  const { run: few } = setup();
  expect((await few('get_cabinet', {})).content).not.toHaveProperty('truncated');
});

describe('get_episodes', () => {
  const EPISODE = id(2);
  const tables = {
    episodes: [
      episode(EPISODE, '2026-11-20T13:30:00.000Z', { ended_at: '2026-11-20T18:00:00.000Z' }),
      episode(id(3), '2026-06-01T13:30:00.000Z', { ended_at: '2026-06-01T15:00:00.000Z' }),
    ],
    doses: [dose(SUMATRIPTAN, 20, EPISODE)],
  };

  test('the last 90 days by default, times in the profile zone, doses by ref, no notes', async () => {
    const { run, refs } = setup(tables);
    const outcome = await run('get_episodes', {});
    expect(outcome.isError).toBe(false);
    expect(outcome.content).toEqual({
      result_ref: 'r1',
      episodes: [
        {
          ref: 'e1',
          started_at: '2026-11-20T08:30:00-05:00',
          ended_at: '2026-11-20T13:00:00-05:00',
          intensity: 6,
          pain_areas: ['temple_left'],
          symptoms: ['nausea'],
          triggers: [],
          reliefs: [],
          helped: [],
          did_not_help: [],
          doses: [{ medication_ref: 'm1', taken_at: '2026-11-20T15:00:00-05:00' }],
        },
      ],
      total: 1,
    });
    expect(refs.idOf('e1')).toBe(EPISODE);
    expect(refs.idOf('m1')).toBe(SUMATRIPTAN);
    expect(outcome.evidence).toEqual([{ ref: 'r1', source: 'episodes', count: 1, of: null, episodeIds: [EPISODE], doseIds: [] }]);
    expect(JSON.stringify(outcome.content)).not.toContain('private note text');
  });

  test('at most 10 doses per attack, and the result says it was cut', async () => {
    const busy = { ...tables, doses: Array.from({ length: 12 }, (_, i) => dose(SUMATRIPTAN, 1 + (i % 20), EPISODE)) };
    const { run } = setup(busy);
    const content = (await run('get_episodes', {})).content as { episodes: { doses: unknown[] }[]; truncated?: boolean };
    expect(content.episodes[0]?.doses).toHaveLength(10);
    expect(content.truncated).toBe(true);
  });

  test('a window and a limit', async () => {
    const { run } = setup(tables);
    const outcome = await run('get_episodes', { from: '2026-05-01', to: '2026-06-30', limit: 1 });
    expect((outcome.content as { episodes: unknown[]; total: number }).total).toBe(1);
    expect((outcome.content as { episodes: Row[] }).episodes[0]?.started_at).toBe('2026-06-01T08:30:00-05:00');
  });

  test.each([
    ['limit 50', { limit: 50 }],
    ['limit 0', { limit: 0 }],
    ['a limit that is not an integer', { limit: 2.5 }],
    ['a date that is not real', { from: '2026-02-30' }],
    ['from after to', { from: '2026-11-20', to: '2026-11-01' }],
  ])('%s is an error and reads nothing', async (_label, input) => {
    const { run, calls } = setup(tables);
    const outcome = await run('get_episodes', input);
    expect(outcome.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe('get_crisis_plan', () => {
  test('at most five entries, medications by name, with evidence per entry', async () => {
    const debriefed = (epId: string, helped: string[], didNotHelp: string[] = []) =>
      episode(epId, '2026-11-10T13:00:00.000Z', { ended_at: '2026-11-10T15:00:00.000Z', helped, did_not_help: didNotHelp, debriefed_at: '2026-11-11T13:00:00.000Z' });
    const episodes = [
      debriefed(id(11), ['dark_room', 'cold_pack', 'sleep']),
      debriefed(id(12), ['dark_room', 'water', 'caffeine']),
      debriefed(id(13), ['massage'], ['dark_room']),
    ];
    const doses = [{ ...dose(SUMATRIPTAN, 10, id(11)), helped: true }, { ...dose(SUMATRIPTAN, 12, id(12)), helped: false }];
    const { run } = setup({ episodes, doses });
    const outcome = await run('get_crisis_plan', {});
    const plan = (outcome.content as { plan: Row[] }).plan;
    expect(plan).toHaveLength(5);
    expect(plan[0]).toEqual({ ref: 'p1', kind: 'relief', name: 'caffeine', helped: 1, of: 1 });
    expect(plan.find((entry) => entry.kind === 'medication')).toBeUndefined();
    expect(outcome.evidence?.[0]).toEqual({ ref: 'p1', source: 'crisis_plan', count: 1, of: 1, episodeIds: [id(12)], doseIds: [] });
  });

  test('a medication is named, not keyed by its id', async () => {
    const episodes = [episode(id(11), '2026-11-10T13:00:00.000Z', { ended_at: '2026-11-10T15:00:00.000Z', debriefed_at: '2026-11-11T13:00:00.000Z' })];
    const doses = [{ ...dose(SUMATRIPTAN, 10, id(11)), helped: true }];
    const { run } = setup({ episodes, doses });
    const plan = ((await run('get_crisis_plan', {})).content as { plan: Row[] }).plan;
    expect(plan).toEqual([{ ref: 'p1', kind: 'medication', name: 'Sumatriptan', helped: 1, of: 1 }]);
  });

  test('an archived medication is left out even when its doses helped, as What helped before does', async () => {
    const episodes = [episode(id(11), '2026-11-10T13:00:00.000Z', { ended_at: '2026-11-10T15:00:00.000Z', debriefed_at: '2026-11-11T13:00:00.000Z' })];
    const doses = [
      { ...dose(OLD_TRIPTAN, 10, id(11)), helped: true },
      { ...dose(OLD_TRIPTAN, 11, id(11)), helped: true },
      { ...dose(SUMATRIPTAN, 10, id(11)), helped: true },
    ];
    const { run, calls } = setup({ episodes, doses });
    const plan = ((await run('get_crisis_plan', {})).content as { plan: Row[] }).plan;
    expect(plan.map((entry) => entry.name)).toEqual(['Sumatriptan']);
    const read = calls.find((call) => call.url.pathname === '/rest/v1/medications');
    expect(read?.url.searchParams.get('archived_at')).toBe('is.null');
  });
});

test('the cabinet and crisis-plan reads each name an order and a bound, so a cut never drops rows at random', async () => {
  const { run, calls } = setup();
  await run('get_cabinet', {});
  await run('get_crisis_plan', {});
  const reads = calls.filter((call) => call.method === 'GET');
  expect(reads).toHaveLength(5);
  for (const read of reads) {
    expect(read.url.searchParams.get('order')).toMatch(/^[a-z_]+\.(?:asc|desc)$/);
    expect(Number(read.url.searchParams.get('limit'))).toBeGreaterThan(0);
  }
});

describe('get_signals', () => {
  const UUID_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const TODAY_CHECKIN = { localDate: '2026-11-27', sleepBand: '7_8' as const, stress: 'mid' as const };
  const inputsOf = (records: Partial<RecordInputs>): RecordInputs => ({
    timeZone: TZ,
    knownTriggers: [],
    onboardedAt: '2026-09-01T12:00:00.000Z',
    hasLocation: true,
    episodes: [],
    checkins: [TODAY_CHECKIN],
    doses: [],
    medications: MEDICATIONS.map((row) => ({ id: String(row.id), name: String(row.name), kind: row.kind as 'acute', class: row.class as 'triptan' })),
    ...records,
  });
  /** A triptan dose at 15:00 local on day `day` of November 2026. */
  const triptan = (n: number, day: number) => ({ id: id(800 + n), medicationId: SUMATRIPTAN, episodeId: null, takenAt: `2026-11-${String(day).padStart(2, '0')}T20:00:00.000Z`, helped: null });
  const PRESSURE_EVIDENCE = { nowHpa: 1012, laterHpa: 1006, laterAt: '2026-11-28T13:00:00Z', dropHpa: 6.5 };
  const pressureRow = (localDate: string): Row => ({
    id: id(990),
    user_id: USER_ID,
    kind: 'pressure',
    cause: 'pressure',
    cause_key: `pressure:${localDate}`,
    local_date: localDate,
    evidence: PRESSURE_EVIDENCE,
    computed_at: `${localDate}T13:05:00.000Z`,
  });
  // Yesterday's attack (09:00–13:00 local on the 26th), not debriefed.
  const YESTERDAY = id(610);
  const yesterday = { id: YESTERDAY, startedAt: '2026-11-26T14:00:00.000Z', endedAt: '2026-11-26T18:00:00.000Z', intensity: 6, triggers: [], helped: [], didNotHelp: [], debriefedAt: null };

  /** `signals` null leaves the table out, so its read answers 404. */
  function signalsSetup(records: Partial<RecordInputs>, signals: Row[] | null = [], answer?: () => Response) {
    const args: Record<string, unknown>[] = [];
    const rpc = {
      record_inputs: (body: Record<string, unknown>) => {
        args.push(body);
        return answer?.() ?? json(200, inputsOf(records));
      },
    };
    return { ...setup(signals === null ? {} : { signals }, { rpc }), args };
  }

  test('10 triptan days this month give an overuse_limit with a signal evidence item of 10 of 10', async () => {
    const doses = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19].map((day, n) => triptan(n, day));
    const { run, args, calls } = signalsSetup({ doses });
    const outcome = await run('get_signals', {});
    expect(outcome.isError).toBe(false);
    expect(outcome.content).toEqual({
      status: 'ok',
      signals: [{ ref: 's1', kind: 'overuse_limit', local_date: '2026-11-27', evidence: { scope: 'triptan', days: 10, limit: 10, level: 'limit' } }],
    });
    expect(outcome.evidence).toEqual([{ ref: 's1', source: 'signal', count: 10, of: 10, episodeIds: [], doseIds: doses.map((dose) => dose.id) }]);
    expect(args).toEqual([{ p_user_id: USER_ID, p_since: new Date(NOW - 90 * 86_400_000).toISOString() }]);
    for (const call of calls) expect(call.headers.get('authorization')).toBe(USER_AUTH);
  });

  test("today's stored pressure row is merged in priority order, read with the caller's token for today only", async () => {
    const { run, calls, refs } = signalsSetup({ episodes: [yesterday] }, [pressureRow('2026-11-26'), pressureRow('2026-11-27')]);
    const outcome = await run('get_signals', {});
    expect(outcome.content).toEqual({
      status: 'ok',
      signals: [
        { ref: 's1', kind: 'debrief_due', local_date: '2026-11-27', evidence: { episode_ref: 'e1', ended_at: '2026-11-26T13:00:00-05:00' } },
        {
          ref: 's2',
          kind: 'pressure',
          local_date: '2026-11-27',
          evidence: { now_hpa: 1012, later_hpa: 1006, later_at: '2026-11-28T08:00:00-05:00', drop_hpa: 6.5 },
        },
      ],
    });
    expect(refs.idOf('e1')).toBe(YESTERDAY);
    expect(outcome.evidence).toEqual([]);
    const read = calls.find((call) => call.url.pathname === '/rest/v1/signals');
    expect(read?.headers.get('authorization')).toBe(USER_AUTH);
    expect(Object.fromEntries(read?.url.searchParams ?? [])).toMatchObject({ kind: 'eq.pressure', local_date: 'eq.2026-11-27', select: 'kind,cause,cause_key,evidence' });
  });

  test('no UUID reaches the content: attacks by ref, never an id, a cause key or a row id', async () => {
    const open = { ...yesterday, id: id(611), startedAt: '2026-11-26T23:00:00.000Z', endedAt: null };
    const doses = [1, 3, 5, 7, 9, 11, 13, 15].map((day, n) => triptan(n, day));
    const { run } = signalsSetup({ episodes: [yesterday, open], doses }, [pressureRow('2026-11-27')]);
    const outcome = await run('get_signals', {});
    const kinds = (outcome.content as { signals: Row[] }).signals.map((signal) => signal.kind);
    // The open attack (18 h) is a long attack and hides today's pressure row.
    expect(kinds).toEqual(['long_attack', 'debrief_due', 'overuse_warn']);
    const text = JSON.stringify(outcome.content);
    expect(text).not.toMatch(UUID_TEXT);
    expect(text).not.toMatch(/cause|%/);
  });

  test('a failed pressure read leaves pressure out; a failed or malformed records read is unavailable', async () => {
    const { run, calls } = signalsSetup({ episodes: [yesterday] }, null);
    const outcome = await run('get_signals', {});
    expect((outcome.content as { signals: Row[] }).signals.map((signal) => signal.kind)).toEqual(['debrief_due']);
    expect(calls.some((call) => call.url.pathname === '/rest/v1/signals')).toBe(true);
    const failed = signalsSetup({}, [], () => json(500, { message: 'down' }));
    expect(await failed.run('get_signals', {})).toEqual({ isError: true, content: { error: 'unavailable' } });
    const malformed = signalsSetup({}, [], () => json(200, { episodes: 'none' }));
    expect(await malformed.run('get_signals', {})).toEqual({ isError: true, content: { error: 'unavailable' } });
  });

  test('an unknown zone reads as UTC instead of throwing', async () => {
    const world = signalsSetup({ checkins: [] });
    world.env.timeZone = 'Mars/Base';
    expect(((await world.run('get_signals', {})).content as { status: string }).status).toBe('ok');
  });
});

describe('get_insights', () => {
  const UUID_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  /** An attack at 15:00 local on day `day` of November 2026, two hours long. */
  const attack = (n: number, day: number, fields: Partial<RecordEpisode> = {}): RecordEpisode => ({
    id: id(600 + n),
    startedAt: `2026-11-${String(day).padStart(2, '0')}T20:00:00.000Z`,
    endedAt: `2026-11-${String(day).padStart(2, '0')}T22:00:00.000Z`,
    intensity: 5,
    triggers: [],
    helped: [],
    didNotHelp: [],
    debriefedAt: null,
    ...fields,
  });
  const inputsOf = (records: Partial<RecordInputs>): RecordInputs => ({
    timeZone: TZ,
    knownTriggers: [],
    onboardedAt: '2026-11-01T12:00:00.000Z',
    hasLocation: true,
    episodes: [],
    checkins: [],
    doses: [],
    medications: MEDICATIONS.map((row) => ({ id: String(row.id), name: String(row.name), kind: row.kind as 'acute', class: row.class as 'triptan' })),
    ...records,
  });
  function insightsSetup(records: Partial<RecordInputs>, options: { timeZone?: string; answer?: () => Response } = {}) {
    const args: Record<string, unknown>[] = [];
    const rpc = {
      record_inputs: (body: Record<string, unknown>) => {
        args.push(body);
        return options.answer?.() ?? json(200, inputsOf(records));
      },
    };
    const world = setup({}, { rpc });
    if (options.timeZone !== undefined) world.env.timeZone = options.timeZone;
    return { ...world, args };
  }
  const STRESSED = [1, 4, 8, 12, 16].map((day, i) => attack(i, day, { triggers: i < 3 ? ['stress'] : ['alcohol'].slice(0, i - 3) }));

  test('posts to rpc/record_inputs with the caller token, its own id and p_since 366 days back', async () => {
    const { run, calls, args } = insightsSetup({ episodes: STRESSED });
    await run('get_insights', {});
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.pathname).toBe('/rest/v1/rpc/record_inputs');
    expect(calls[0]?.headers.get('authorization')).toBe(USER_AUTH);
    expect(args).toEqual([{ p_user_id: USER_ID, p_since: new Date(NOW - 366 * 86_400_000).toISOString() }]);
  });

  test('5 attacks tagged stress 3 times give a trigger_frequency of 3 of 5 over 90 days, with one insight evidence item', async () => {
    const { run, refs } = insightsSetup({ episodes: STRESSED });
    const outcome = await run('get_insights', { kind: 'trigger_frequency' });
    expect(outcome.isError).toBe(false);
    expect(outcome.content).toEqual({
      status: 'ok',
      insights: [{ ref: 'i1', kind: 'trigger_frequency', key: 'stress', count: 3, of: 5, window_days: 90 }],
      needs: [],
    });
    expect(outcome.evidence).toEqual([{ ref: 'i1', source: 'insight', count: 3, of: 5, episodeIds: [id(600), id(601), id(602)], doseIds: [] }]);
    expect(refs.idOf('i1')).not.toBeNull();
  });

  test("kind 'weekday' keeps only the weekday entries", async () => {
    const { run } = insightsSetup({ episodes: STRESSED });
    const content = (await run('get_insights', { kind: 'weekday' })).content as { insights: Row[]; needs: Row[] };
    expect(content.insights).toEqual([]);
    expect(content.needs).toEqual([{ kind: 'weekday', unit: 'attacks', min: 12, have: 5 }]);
    const all = (await run('get_insights', {})).content as { insights: Row[]; needs: Row[] };
    expect(new Set(all.needs.map((need) => need.kind)).size).toBeGreaterThan(1);
  });

  test("kind 'timing' (the old enum) is an invalid_value error and reads nothing", async () => {
    const { run, calls } = insightsSetup({ episodes: STRESSED });
    const outcome = await run('get_insights', { kind: 'timing' });
    expect(outcome).toEqual({ isError: true, content: { error: 'invalid_value' } });
    expect(calls).toHaveLength(0);
  });

  test('a helped medication entry carries medication_ref and name, and no UUID reaches the model', async () => {
    const debriefed = { debriefedAt: '2026-11-20T12:00:00.000Z', helped: ['dark_room'] };
    const episodes = [attack(1, 3, debriefed), attack(2, 6, debriefed), attack(3, 9, { ...debriefed, didNotHelp: ['caffeine'], helped: [] })];
    const doses = episodes.map((episode, i) => ({ id: id(700 + i), medicationId: SUMATRIPTAN, episodeId: episode.id, takenAt: episode.startedAt, helped: i < 2 }));
    const { run, refs } = insightsSetup({ episodes, doses });
    const outcome = await run('get_insights', { kind: 'helped' });
    const content = outcome.content as { insights: Row[] };
    const medication = content.insights.find((entry) => entry.source === 'medication');
    expect(medication).toEqual({ ref: expect.stringMatching(/^i\d+$/) as unknown, kind: 'helped', source: 'medication', medication_ref: 'm1', name: 'Sumatriptan', count: 2, of: 3, window_days: 90 });
    expect(refs.idOf('m1')).toBe(SUMATRIPTAN);
    expect(content.insights.find((entry) => entry.source === 'relief')).toMatchObject({ key: 'dark_room', count: 2, of: 2 });
    expect(JSON.stringify(outcome.content)).not.toMatch(UUID_TEXT);
    expect(JSON.stringify(outcome.content)).not.toContain('chance');
  });

  test('an unknown zone reads as UTC instead of throwing', async () => {
    const { run } = insightsSetup({ episodes: STRESSED, timeZone: 'Mars/Base' });
    const outcome = await run('get_insights', {});
    expect(outcome.isError).toBe(false);
    expect((outcome.content as { status: string }).status).toBe('ok');
  });

  test('a failed or malformed read is unavailable', async () => {
    const failed = insightsSetup({}, { answer: () => json(500, { message: 'down' }) });
    expect(await failed.run('get_insights', {})).toEqual({ isError: true, content: { error: 'unavailable' } });
    const malformed = insightsSetup({}, { answer: () => json(200, { episodes: 'none' }) });
    expect(await malformed.run('get_insights', {})).toEqual({ isError: true, content: { error: 'unavailable' } });
  });
});

describe('propose_episode', () => {
  test('a new past attack becomes a draft with its doses mapped back, times echoed in the zone', async () => {
    const { run } = setup({}, {});
    await run('get_cabinet', {});
    const outcome = await run('propose_episode', {
      started_at: '2026-11-26T08:00:00-05:00',
      ended_at: '2026-11-26T11:30:00-05:00',
      intensity: 7,
      symptoms: ['nausea'],
      triggers: ['short_sleep'],
      doses: [{ medication_ref: 'm1', taken_at: '2026-11-26T08:30:00-05:00' }],
    });
    expect(outcome.isError).toBe(false);
    expect(outcome.draft).toEqual({
      kind: 'episode',
      ref: 'd1',
      episodeId: null,
      startedAt: '2026-11-26T13:00:00.000Z',
      endedAt: '2026-11-26T16:30:00.000Z',
      intensity: 7,
      painAreas: [],
      symptoms: ['nausea'],
      triggers: ['short_sleep'],
      reliefs: [],
      helped: [],
      didNotHelp: [],
      doses: [{ medicationId: SUMATRIPTAN, takenAt: '2026-11-26T13:30:00.000Z' }],
    });
    expect(outcome.content).toMatchObject({ draft_ref: 'd1', draft: { started_at: '2026-11-26T08:00:00-05:00', doses: [{ medication_ref: 'm1' }] } });
  });

  test('with an attack open, a new one needs an end, else open_attack names the open ref', async () => {
    const { run } = setup({}, { open: true });
    const outcome = await run('propose_episode', { started_at: '2026-11-27T11:00:00-05:00', intensity: 5 });
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toEqual({ error: 'open_attack', episode_ref: 'e1' });
    expect(outcome.draft).toBeUndefined();
  });

  test('the open attack, by its ref, can be ended and debriefed', async () => {
    const { run } = setup({}, { open: true });
    const outcome = await run('propose_episode', { episode_ref: 'e1', ended_at: '2026-11-27T11:45:00-05:00', helped: ['dark_room'] });
    expect(outcome.draft).toMatchObject({ kind: 'episode', episodeId: OPEN_EPISODE, startedAt: null, endedAt: '2026-11-27T16:45:00.000Z', helped: ['dark_room'] });
  });

  test.each([
    ['no episode_ref and no started_at', { intensity: 5 }, 'started_at_required'],
    ['an unknown symptom', { started_at: '2026-11-27T08:00:00-05:00', symptoms: ['bogus'] }, 'unknown_key'],
    ['a time an hour ahead', { started_at: '2026-11-27T13:00:00-05:00' }, 'time_in_future'],
    ['a time before 2000', { started_at: '1999-12-31T08:00:00-05:00', ended_at: '1999-12-31T09:00:00-05:00' }, 'time_too_early'],
    ['a time with no offset', { started_at: '2026-11-27T08:00:00' }, 'invalid_time'],
    ['an end before the start', { started_at: '2026-11-27T08:00:00-05:00', ended_at: '2026-11-27T07:00:00-05:00' }, 'end_before_start'],
    ['an end before the open attack began', { episode_ref: 'e1', ended_at: '2026-11-27T09:00:00-05:00' }, 'end_before_start'],
    ['an intensity of 11', { started_at: '2026-11-27T08:00:00-05:00', intensity: 11 }, 'invalid_intensity'],
    ['an unknown episode ref', { episode_ref: 'e7', intensity: 5 }, 'unknown_ref'],
    ['a medication ref given as the episode', { episode_ref: 'm1', intensity: 5 }, 'unknown_ref'],
    ['an unknown medication ref', { started_at: '2026-11-27T08:00:00-05:00', doses: [{ medication_ref: 'm9', taken_at: '2026-11-27T08:00:00-05:00' }] }, 'unknown_ref'],
    ['an existing attack with nothing to change', { episode_ref: 'e1' }, 'empty_draft'],
  ])('%s is an error and makes no draft', async (_label, input, reason) => {
    const { run } = setup({}, { open: true });
    await run('get_cabinet', {});
    const outcome = await run('propose_episode', input);
    expect(outcome.isError).toBe(true);
    expect(errorOf(outcome)).toBe(reason);
    expect(outcome.draft).toBeUndefined();
  });

  test('moving a start past the stored end is end_before_start', async () => {
    const ended = episode(id(2), '2026-11-20T13:30:00.000Z', { ended_at: '2026-11-20T18:00:00.000Z' });
    const { run } = setup({ episodes: [ended] });
    await run('get_episodes', {});
    // 14:00 local is 19:00 UTC, after the stored end at 18:00 UTC.
    const outcome = await run('propose_episode', { episode_ref: 'e1', started_at: '2026-11-20T14:00:00-05:00' });
    expect(errorOf(outcome)).toBe('end_before_start');
    expect((await run('propose_episode', { episode_ref: 'e1', started_at: '2026-11-20T08:00:00-05:00' })).isError).toBe(false);
  });

  test('a time up to 5 minutes ahead is accepted', async () => {
    const { run } = setup();
    expect((await run('propose_episode', { started_at: '2026-11-27T12:04:00-05:00' })).isError).toBe(false);
  });

  test('at most three drafts per request', async () => {
    const { run } = setup();
    const input = { started_at: '2026-11-20T08:00:00-05:00', ended_at: '2026-11-20T09:00:00-05:00' };
    for (let i = 0; i < 3; i += 1) expect((await run('propose_episode', input)).isError).toBe(false);
    const fourth = await run('propose_episode', input);
    expect(errorOf(fourth)).toBe('draft_limit');
  });
});

describe('propose_dose', () => {
  test('maps m1 back to the medication id', async () => {
    const { run } = setup({}, { open: true });
    await run('get_cabinet', {});
    const outcome = await run('propose_dose', { medication_ref: 'm1', taken_at: '2026-11-27T11:50:00-05:00', episode_ref: 'e1' });
    expect(outcome.draft).toEqual({ kind: 'dose', ref: 'd1', medicationId: SUMATRIPTAN, takenAt: '2026-11-27T16:50:00.000Z', episodeId: OPEN_EPISODE });
    expect(outcome.content).toEqual({ draft_ref: 'd1', draft: { medication_ref: 'm1', taken_at: '2026-11-27T11:50:00-05:00', episode_ref: 'e1' } });
  });

  test('an unknown medication or a missing time is an error', async () => {
    const { run } = setup();
    expect(errorOf(await run('propose_dose', { medication_ref: 'm1', taken_at: '2026-11-27T11:50:00-05:00' }))).toBe('unknown_ref');
    await run('get_cabinet', {});
    expect(errorOf(await run('propose_dose', { medication_ref: 'm1' }))).toBe('invalid_time');
  });
});

describe('propose_checkin', () => {
  test('a check-in for a day in the last week', async () => {
    const { run } = setup();
    const outcome = await run('propose_checkin', { local_date: '2026-11-21', sleep_band: 'lt5', stress: 'high', alcohol: true });
    expect(outcome.draft).toEqual({
      kind: 'checkin',
      ref: 'd1',
      localDate: '2026-11-21',
      sleepBand: 'lt5',
      sleepQuality: null,
      stress: 'high',
      lowWater: null,
      extraCaffeine: null,
      alcohol: true,
      skippedMeal: null,
      screenHeavy: null,
    });
  });

  test.each([
    ['8 days before localDate', { local_date: '2026-11-19' }, 'date_out_of_range'],
    ['a day after localDate', { local_date: '2026-11-28' }, 'date_out_of_range'],
    ['a date that is not real', { local_date: '2026-11-31' }, 'invalid_date'],
    ['an unknown sleep band', { local_date: '2026-11-27', sleep_band: 'lots' }, 'invalid_value'],
    ['a boolean that is a string', { local_date: '2026-11-27', alcohol: 'yes' }, 'invalid_value'],
  ])('%s is an error', async (_label, input, reason) => {
    const { run } = setup();
    const outcome = await run('propose_checkin', input);
    expect(errorOf(outcome)).toBe(reason);
    expect(outcome.draft).toBeUndefined();
  });
});

describe('notes', () => {
  function noteRpcs() {
    const notes: string[] = [];
    const rpc = {
      save_agent_note: (args: Record<string, unknown>) => {
        if (notes.length >= 20) return json(400, { code: '23514', message: 'at most 20 notes' });
        notes.push(String(args.p_text));
        return json(200, id(900 + notes.length));
      },
      delete_agent_note: () => new Response(null, { status: 204 }),
    };
    return { notes, rpc };
  }

  test('save_note saves the sanitized text with the caller token and returns a ref, never the id', async () => {
    const { notes, rpc } = noteRpcs();
    const { run, calls, refs } = setup({}, { rpc });
    const outcome = await run('save_note', { text: '  prefers\u0000 short\n answers ' });
    expect(outcome).toMatchObject({ isError: false, content: { saved: true, ref: 'n1' } });
    expect(notes).toEqual(['prefers short answers']);
    expect(refs.idOf('n1')).toBe(id(901));
    expect(calls[0]?.headers.get('authorization')).toBe(USER_AUTH);
  });

  test('a 250-character note is an error and is not sent', async () => {
    const { notes, rpc } = noteRpcs();
    const { run } = setup({}, { rpc });
    expect(errorOf(await run('save_note', { text: 'x'.repeat(250) }))).toBe('too_long');
    expect(errorOf(await run('save_note', { text: '   ' }))).toBe('empty');
    expect(notes).toEqual([]);
  });

  test('the 21st note is note_limit', async () => {
    const { rpc } = noteRpcs();
    const { run } = setup({}, { rpc });
    for (let i = 0; i < 20; i += 1) expect((await run('save_note', { text: `note ${String(i)}` })).isError).toBe(false);
    const outcome = await run('save_note', { text: 'one more' });
    expect(outcome).toEqual({ isError: true, content: { error: 'note_limit' } });
  });

  test('forget_note deletes the note behind a ref, and an unknown ref is an error', async () => {
    const { rpc } = noteRpcs();
    const { run, calls, refs } = setup({}, { rpc });
    refs.add('n', id(950));
    expect(await run('forget_note', { note_ref: 'n1' })).toEqual({ isError: false, content: { forgotten: true } });
    expect(JSON.parse(calls[0]?.body ?? '{}')).toEqual({ p_id: id(950) });
    expect(errorOf(await run('forget_note', { note_ref: 'n2' }))).toBe('unknown_ref');
  });
});

test('an unknown tool or an input that is not an object runs nothing', async () => {
  const { run, calls } = setup();
  expect(errorOf(await run('delete_everything', {}))).toBe('unknown_tool');
  expect(errorOf(await run('get_episodes', 'all'))).toBe('invalid_input');
  expect(calls).toHaveLength(0);
});

test('a failing read is an error result, not a throw', async () => {
  const { run } = setup({ medications: undefined as unknown as Row[] });
  const outcome = await run('get_cabinet', {});
  expect(outcome).toEqual({ isError: true, content: { error: 'unavailable' } });
});

test('every read names its columns, uses the caller token, and never asks for the email or the location', async () => {
  const { rpc } = { rpc: { save_agent_note: () => json(200, id(901)), delete_agent_note: () => new Response(null, { status: 204 }) } };
  const { run, calls } = setup({ episodes: [episode(id(2), '2026-11-20T13:30:00.000Z')] }, { rpc, open: true });
  await run('get_episodes', {});
  await run('get_cabinet', {});
  await run('get_crisis_plan', {});
  await run('save_note', { text: 'likes short answers' });
  await run('forget_note', { note_ref: 'n1' });
  expect(calls.length).toBeGreaterThanOrEqual(7);
  for (const call of calls) {
    expect(call.headers.get('authorization')).toBe(USER_AUTH);
    expect(call.headers.get('apikey')).toBe('anon-key');
    expect(call.url.href).not.toMatch(/email|coarse_|profiles/);
    if (call.method === 'GET') expect(call.url.searchParams.get('select')).not.toBe('*');
  }
});

test('a draft time may be as far ahead as the phone stores allow, and no further', async () => {
  const { run } = setup();
  await run('get_cabinet', {});
  const at = (ms: number): string => new Date(NOW + ms).toISOString();
  expect((await run('propose_dose', { medication_ref: 'm1', taken_at: at(MAX_AHEAD_MS) })).isError).toBe(false);
  expect(errorOf(await run('propose_dose', { medication_ref: 'm1', taken_at: at(MAX_AHEAD_MS + 1_000) }))).toBe('time_in_future');
});

test('a note loses its invisible characters as a reply does: controls, zero-width and bidi marks, line separators', async () => {
  const saved: unknown[] = [];
  const { run } = setup({}, { rpc: { save_agent_note: (args) => (saved.push(args.p_text), json(200, id(901))) } });
  await run('save_note', { text: 'likes\u200b short\u202e answers\u2028please' });
  expect(saved).toEqual(['likes short answers please']);
});
