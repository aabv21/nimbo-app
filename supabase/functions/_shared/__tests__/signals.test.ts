/** @jest-environment node */
// The signal rules and the push decision against the 17 fixture cases, run on the pack itself, plus the edges
// the cases leave out: the window's clock formats, stored rows read back, and the forecast's age limit.
import { packs } from '../condition/index.ts';
import {
  computeSignals,
  decidePush,
  insideWindow,
  monitorSelects,
  quietDaysOf,
  type PushDecision,
  type PushLogEntry,
  type Signal,
  type SignalUser,
  signalFromRow,
  todayRows,
  withoutRepeatedQuiet,
  withStoredPressure,
} from '../signals.ts';
import { readCases } from './cases.ts';

const pack = packs.migraine;

interface SignalCase {
  id: string;
  input: {
    now: string;
    user: Omit<SignalUser, 'timeZone'> & { timeZone: string | null };
    notify: { notifyStart: string; notifyEnd: string; notifyDailyCap: number; lockScreenDetail: boolean };
    pushLog: PushLogEntry[];
  };
  expected: { selected: boolean; signals: Signal[]; today?: string[]; push: PushDecision };
}

const { cases } = readCases<SignalCase>('signals-cases.json');

test.each(cases)('$id', ({ input, expected }) => {
  const now = new Date(input.now);
  const { notifyStart, notifyEnd, notifyDailyCap } = input.notify;
  const notify = { notifyStart, notifyEnd, notifyDailyCap, pushLog: input.pushLog };
  const { timeZone } = input.user;
  if (!expected.selected) {
    expect(monitorSelects(input.user)).toBe(false);
    expect(decidePush([], { ...notify, timeZone: null }, now, pack)).toEqual(expected.push);
    return;
  }
  if (timeZone === null) throw new Error('a selected case needs a zone');
  const user: SignalUser = { ...input.user, timeZone };
  expect(monitorSelects(user)).toBe(true);
  const signals = computeSignals(user, now, pack);
  expect(signals).toEqual(expected.signals);
  expect(todayRows(signals, pack).map((signal) => signal.causeKey)).toEqual(expected.today);
  expect(decidePush(signals, { ...notify, timeZone }, now, pack)).toEqual(expected.push);
});

const caseOf = (prefix: string): SignalCase => {
  const found = cases.find((item) => item.id.startsWith(prefix));
  if (found === undefined) throw new Error(`no case ${prefix}`);
  return found;
};

describe('insideWindow', () => {
  test.each([
    ['07:59', '08:00', '21:00', false],
    ['08:00', '08:00', '21:00', true],
    ['21:00', '08:00', '21:00', false],
    ['01:30', '22:00', '07:00', true],
    ['07:00', '22:00', '07:00', false],
    ['12:00', '09:00', '09:00', false],
  ])('%s in [%s, %s) is %s', (clock, start, end, inside) => {
    expect(insideWindow(clock, start, end)).toBe(inside);
  });

  test("accepts Postgres's 'HH:MM:SS' and treats '08:00' and '08:00:00' as the same empty window", () => {
    expect(insideWindow('08:00:00', '08:00:00', '21:00:00')).toBe(true);
    expect(insideWindow('20:59:59', '08:00', '21:00:00')).toBe(true);
    expect(insideWindow('10:00', '08:00', '08:00:00')).toBe(false);
  });

  test('a clock it cannot read is outside', () => {
    expect(insideWindow('25:00', '08:00', '21:00')).toBe(false);
    expect(insideWindow('10:00', '8am', '21:00')).toBe(false);
  });
});

test('monitorSelects refuses a zone the runtime does not know and a user not yet onboarded', () => {
  expect(monitorSelects({ timeZone: 'Mars/Base', onboardedAt: '2026-09-01T15:00:00Z' })).toBe(false);
  expect(monitorSelects({ timeZone: 'America/Bogota', onboardedAt: null })).toBe(false);
  expect(decidePush([], { timeZone: 'Mars/Base', notifyStart: '08:00', notifyEnd: '21:00', notifyDailyCap: 2, pushLog: [] }, new Date(), pack)).toEqual({
    causeKey: null,
    reason: 'no_timezone',
  });
});

describe('signalFromRow', () => {
  const pressureRow = {
    kind: 'pressure',
    cause: 'pressure',
    cause_key: 'pressure:2026-11-27',
    evidence: { nowHpa: 1012, laterHpa: 1006, laterAt: '2026-11-28T13:00:00Z', dropHpa: 6.5 },
  };

  test('reads a stored row back', () => {
    expect(signalFromRow(pressureRow)).toEqual({ kind: 'pressure', cause: 'pressure', causeKey: 'pressure:2026-11-27', evidence: pressureRow.evidence });
    const overuse = { kind: 'overuse_limit', cause: 'overuse:triptan', cause_key: 'overuse:triptan:limit:2026-11', evidence: { scope: 'triptan', days: 10, limit: 10, level: 'limit' } };
    expect(signalFromRow(overuse)).toMatchObject({ kind: 'overuse_limit', causeKey: 'overuse:triptan:limit:2026-11' });
  });

  test.each([
    ['an unknown kind', { ...pressureRow, kind: 'storm' }],
    ['an evidence that is not an object', { ...pressureRow, evidence: '[1012, 1006]' }],
    ['an evidence that is an array', { ...pressureRow, evidence: [1012, 1006] }],
    ['a missing number', { ...pressureRow, evidence: { ...pressureRow.evidence, dropHpa: null } }],
    ['a cause that is not its kind', { ...pressureRow, cause: 'short_sleep' }],
    ['an empty key', { ...pressureRow, cause_key: '' }],
    ['a level that disagrees with its kind', { kind: 'overuse_limit', cause: 'overuse:triptan', cause_key: 'k', evidence: { scope: 'triptan', days: 8, limit: 10, level: 'warn' } }],
    ['an unknown scope', { kind: 'overuse_warn', cause: 'overuse:aspirin', cause_key: 'k', evidence: { scope: 'aspirin', days: 8, limit: 10, level: 'warn' } }],
    ['not a row', null],
  ])('refuses %s', (_label, row) => {
    expect(signalFromRow(row)).toBeNull();
  });
});

describe('withStoredPressure', () => {
  const s09 = caseOf('S09');
  const user = { ...s09.input.user, timeZone: 'America/Bogota' };
  const now = new Date(s09.input.now);
  const computed = computeSignals(user, now, pack);
  const stored = (date: string): Signal => ({
    kind: 'pressure',
    cause: 'pressure',
    causeKey: `pressure:${date}`,
    evidence: { nowHpa: 1012, laterHpa: 1006, laterAt: '2026-11-28T13:00:00Z', dropHpa: 6.5 },
  });

  test("places today's stored pressure signal by priority", () => {
    const merged = withStoredPressure(computed, stored('2026-11-27'), user, now, pack);
    expect(merged.map((signal) => signal.kind)).toEqual(['overuse_limit', 'debrief_due', 'pressure']);
    const quiet: Signal = { kind: 'quiet_tracker', cause: 'quiet_tracker', causeKey: 'quiet:2026-11-20', evidence: { lastCheckinDate: '2026-11-20' } };
    expect(withStoredPressure([quiet, ...computed], stored('2026-11-27'), user, now, pack).map((signal) => signal.kind)).toEqual([
      'overuse_limit',
      'debrief_due',
      'pressure',
      'quiet_tracker',
    ]);
  });

  test("drops a stored row from another day, and today's while an attack is open", () => {
    expect(withStoredPressure(computed, stored('2026-11-26'), user, now, pack)).toEqual(computed);
    expect(withStoredPressure(computed, null, user, now, pack)).toEqual(computed);
    const open = { ...user, episodes: [{ ...user.episodes[0], id: 'o1', startedAt: '2026-11-27T12:00:00Z', endedAt: null } as SignalUser['episodes'][number]] };
    expect(withStoredPressure([], stored('2026-11-27'), open, now, pack)).toEqual([]);
  });
});

describe('the forecast', () => {
  const s01 = caseOf('S01');
  const now = new Date(s01.input.now);
  const user = (fetchedAt: string): SignalUser => {
    const { pressure } = s01.input.user;
    if (pressure === null) throw new Error('S01 has a forecast');
    return { ...s01.input.user, timeZone: 'America/Bogota', pressure: { ...pressure, fetchedAt } };
  };

  test('a forecast 3 h 1 min old gives no pressure signal; one exactly 3 h old still does', () => {
    expect(computeSignals(user('2026-11-27T10:04:00Z'), now, pack)).toEqual([]);
    expect(computeSignals(user('2026-11-27T10:05:00Z'), now, pack).map((signal) => signal.kind)).toEqual(['pressure']);
  });

  test("an hour missing from the series (a null the provider sent) means no signal, never the next value's position", () => {
    const full = user('2026-11-27T12:10:00Z');
    const { pressure } = full;
    if (pressure === null) throw new Error('S01 has a forecast');
    const dropLast = { ...full, pressure: { ...pressure, hours: pressure.hours.slice(0, -1), hPa: pressure.hPa.slice(0, -1) } };
    expect(computeSignals(dropLast, now, pack)).toEqual([]);
    const dropFirst = { ...full, pressure: { ...pressure, hours: pressure.hours.slice(1), hPa: pressure.hPa.slice(1) } };
    expect(computeSignals(dropFirst, now, pack)).toEqual([]);
  });

  test('weather neither chosen nor tagged on enough attacks: no pressure signal', () => {
    expect(computeSignals({ ...user('2026-11-27T12:10:00Z'), knownTriggers: [] }, now, pack)).toEqual([]);
  });
});

describe('the quiet stretch', () => {
  const quiet = (last: string | null): Signal => ({
    kind: 'quiet_tracker',
    cause: 'quiet_tracker',
    causeKey: `quiet:${last ?? 'never'}`,
    evidence: { lastCheckinDate: last },
  });
  const user = { timeZone: 'America/Bogota', onboardedAt: '2026-09-01T15:00:00Z' };
  const now = new Date('2026-11-27T13:05:00Z');

  test('quietDaysOf counts local days since the last check-in, or since onboarding without one', () => {
    expect(quietDaysOf(quiet('2026-11-18'), user, now, pack)).toEqual({ days: 9, over: false });
    expect(quietDaysOf(quiet(null), user, now, pack)).toEqual({ days: 87, over: false });
    // 02:00Z is still the 26th in Bogota.
    expect(quietDaysOf(quiet('2026-11-23'), user, new Date('2026-11-27T02:00:00Z'), pack)).toEqual({ days: 3, over: false });
    const pressure: Signal = { kind: 'pressure', cause: 'pressure', causeKey: 'pressure:2026-11-27', evidence: { nowHpa: 1, laterHpa: 0, laterAt: '2026-11-28T13:00:00Z', dropHpa: 1 } };
    expect(quietDaysOf(pressure, user, now, pack)).toBeNull();
  });

  test('quietDaysOf with no check-in in the records and onboarding older than the window reads "over" the window, never the onboarding', () => {
    const longAgo = { timeZone: 'America/Bogota', onboardedAt: '2025-06-01T15:00:00Z' };
    expect(quietDaysOf(quiet(null), longAgo, now, pack)).toEqual({ days: pack.insights.windowDays, over: true });
    // Onboarded exactly the window ago: every day since is in the records, so the count is exact.
    const atWindow = { timeZone: 'America/Bogota', onboardedAt: '2026-08-29T15:00:00Z' };
    expect(quietDaysOf(quiet(null), atWindow, now, pack)).toEqual({ days: 90, over: false });
  });

  test('quiet:never is dropped once a dated quiet stretch was pushed, since it is that stretch out of the window', () => {
    const pushed: PushLogEntry = { causeKey: 'quiet:2026-08-20', cause: 'quiet_tracker', pushedAt: '2026-08-23T14:00:00Z' };
    expect(withoutRepeatedQuiet([quiet(null)], [pushed])).toEqual([]);
    expect(withoutRepeatedQuiet([quiet(null)], [])).toEqual([quiet(null)]);
    // Its own earlier push is the ordinary already-pushed rule's to handle, not this one.
    const neverPushed: PushLogEntry = { causeKey: 'quiet:never', cause: 'quiet_tracker', pushedAt: '2026-09-04T14:00:00Z' };
    expect(withoutRepeatedQuiet([quiet(null)], [neverPushed])).toEqual([quiet(null)]);
    // A new stretch with a dated key is never dropped.
    expect(withoutRepeatedQuiet([quiet('2026-11-20')], [pushed])).toEqual([quiet('2026-11-20')]);
    expect(decidePush(withoutRepeatedQuiet([quiet(null)], [pushed]), { timeZone: 'America/Bogota', notifyStart: '08:00', notifyEnd: '21:00', notifyDailyCap: 2, pushLog: [pushed] }, now, pack)).toEqual({
      causeKey: null,
      reason: 'no_signals',
    });
  });
});
