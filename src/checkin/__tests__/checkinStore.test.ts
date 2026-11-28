import { act, renderHook } from '@testing-library/react-native';

import { localDb } from '../../lib/local/db';
import { listOutbox } from '../../lib/outbox/outbox';
import { localDate } from '../../lib/localDate';
import { clearLocalDb } from '../../test/localDbTest';
import { isCheckinDone, saveCheckin, useCheckin, useCheckinDates } from '../checkinStore';

jest.mock('expo-sqlite', () => require('../../test/sqliteNode'));

beforeEach(clearLocalDb);

interface Row {
  user_id: string;
  local_date: string;
  sleep_band: string | null;
  stress: string | null;
  low_water: number;
  dirty: number;
}

const rows = (): Row[] =>
  localDb().getAllSync<Row>('SELECT user_id, local_date, sleep_band, stress, low_water, dirty FROM checkins ORDER BY local_date;');

test('two saves for one date merge into one row and queue two save_checkin calls with the keys given', () => {
  saveCheckin('user-a', '2026-11-27', { sleepBand: '6_7', stress: 'low' });
  saveCheckin('user-a', '2026-11-27', { lowWater: true });

  expect(rows()).toEqual([
    { user_id: 'user-a', local_date: '2026-11-27', sleep_band: '6_7', stress: 'low', low_water: 1, dirty: 1 },
  ]);
  const ops = listOutbox('user-a');
  expect(ops.map((op) => [op.kind, op.args])).toEqual([
    ['save_checkin', { p_local_date: '2026-11-27', p_fields: { sleep_band: '6_7', stress: 'low' } }],
    ['save_checkin', { p_local_date: '2026-11-27', p_fields: { low_water: true } }],
  ]);
  expect(ops.map((op) => op.recordKey)).toEqual(['checkin:2026-11-27', 'checkin:2026-11-27']);
});

test('a later save can clear a field and set a boolean back to false', async () => {
  saveCheckin('user-a', '2026-11-27', { sleepQuality: 'bad', alcohol: true });
  saveCheckin('user-a', '2026-11-27', { sleepQuality: null, alcohol: false });

  const { result } = await renderHook(() => useCheckin('user-a', '2026-11-27'));
  expect(result.current).toMatchObject({ sleepQuality: null, alcohol: false });
  expect(listOutbox('user-a')[1]?.args).toEqual({ p_local_date: '2026-11-27', p_fields: { sleep_quality: null, alcohol: false } });
});

test('a date the server would refuse is a RangeError and writes nothing', () => {
  expect(() => {
    saveCheckin('user-a', '1999-12-31', { stress: 'low' });
  }).toThrow(RangeError);
  expect(() => {
    saveCheckin('user-a', '2099-01-01', { stress: 'low' });
  }).toThrow(RangeError);
  expect(() => {
    saveCheckin('user-a', '2026-02-30', { stress: 'low' });
  }).toThrow(RangeError);
  expect(rows()).toEqual([]);
  expect(listOutbox('user-a')).toEqual([]);
});

test('saving no fields writes nothing', () => {
  saveCheckin('user-a', '2026-11-27', {});
  expect(rows()).toEqual([]);
  expect(listOutbox('user-a')).toEqual([]);
});

test('isCheckinDone needs both the sleep band and the stress', () => {
  const base = {
    localDate: '2026-11-27',
    sleepBand: null,
    sleepQuality: null,
    stress: null,
    lowWater: false,
    extraCaffeine: false,
    alcohol: false,
    skippedMeal: false,
    screenHeavy: false,
    periodStarted: false,
    dirty: false,
  } as const;
  expect(isCheckinDone(null)).toBe(false);
  expect(isCheckinDone(base)).toBe(false);
  expect(isCheckinDone({ ...base, sleepBand: '7_8' })).toBe(false);
  expect(isCheckinDone({ ...base, stress: 'mid' })).toBe(false);
  expect(isCheckinDone({ ...base, sleepBand: '7_8', stress: 'mid' })).toBe(true);
});

test('useCheckin reads the user’s own row and updates after a save', async () => {
  saveCheckin('user-b', '2026-11-27', { stress: 'high' });
  const { result } = await renderHook(() => useCheckin('user-a', '2026-11-27'));
  expect(result.current).toBeNull();

  await act(() => {
    saveCheckin('user-a', '2026-11-27', { sleepBand: 'lt5', stress: 'low' });
  });
  expect(result.current).toMatchObject({ localDate: '2026-11-27', sleepBand: 'lt5', stress: 'low', dirty: true });
});

test('useCheckinDates lists the user’s dates inside the inclusive range', async () => {
  saveCheckin('user-a', '2026-01-01', { stress: 'low' });
  saveCheckin('user-a', '2026-01-15', { stress: 'low' });
  saveCheckin('user-a', '2026-01-31', { stress: 'low' });
  saveCheckin('user-a', '2026-02-01', { stress: 'low' });
  saveCheckin('user-b', '2026-01-16', { stress: 'low' });

  const { result } = await renderHook(() => useCheckinDates('user-a', '2026-01-01', '2026-01-31'));
  expect([...result.current].sort()).toEqual(['2026-01-01', '2026-01-15', '2026-01-31']);
});

test('the date is the calendar day on the device clock, not the UTC day', () => {
  // Jest cannot switch the process zone, so this pins that the local clock parts are read, whatever zone runs it.
  const justAfterMidnight = new Date(2026, 10, 27, 0, 30);
  const justBeforeMidnight = new Date(2026, 10, 26, 23, 30);
  expect(localDate(justAfterMidnight)).toBe('2026-11-27');
  expect(localDate(justBeforeMidnight)).toBe('2026-11-26');
  saveCheckin('user-a', localDate(justAfterMidnight), { stress: 'low' });
  expect(rows().map((row) => row.local_date)).toEqual(['2026-11-27']);
});
