import { daysLeftInMonth, doseDaysForMonth } from '../doseDays';
import type { Dose } from '../doseStore';
import type { Medication } from '../medicationStore';

const BOGOTA = 'America/Bogota'; // UTC-5, no daylight saving

function medication(id: string, patch: Partial<Medication> = {}): Medication {
  return {
    id,
    name: id,
    kind: 'acute',
    form: 'oral',
    medicationClass: 'triptan',
    doseText: null,
    minIntervalMinutes: null,
    schedule: null,
    scheduleTime: null,
    scheduleAnchor: null,
    archived: false,
    dirty: false,
    ...patch,
  };
}

let next = 0;
function dose(medicationId: string, takenAt: string): Dose {
  next += 1;
  return { id: `dose-${String(next)}`, medicationId, episodeId: null, takenAt, dirty: false };
}

const NOVEMBER = new Date('2026-11-15T17:00:00Z');
const DECEMBER = new Date('2026-12-15T17:00:00Z');
const TRIPTAN = medication('triptan');

test('two doses of one medication on the same day count one day', () => {
  const doses = [dose('triptan', '2026-11-10T14:00:00Z'), dose('triptan', '2026-11-10T20:00:00Z')];
  expect(doseDaysForMonth(doses, [TRIPTAN], NOVEMBER, BOGOTA)).toEqual({ triptan: ['2026-11-10'] });
});

test('two medications of one class on the same day count one day for the class', () => {
  const other = medication('other-triptan');
  const doses = [dose('triptan', '2026-11-10T14:00:00Z'), dose('other-triptan', '2026-11-10T15:00:00Z')];
  expect(doseDaysForMonth(doses, [TRIPTAN, other], NOVEMBER, BOGOTA)).toEqual({ triptan: ['2026-11-10'] });
});

test('a dose at 23:59 local on 30 November counts in November and one at 00:01 on 1 December in December', () => {
  // 23:59 in Bogota is 04:59 UTC the next day; the UTC date would put it in December.
  const lateNovember = dose('triptan', '2026-12-01T04:59:00Z');
  const earlyDecember = dose('triptan', '2026-12-01T05:01:00Z');
  const doses = [lateNovember, earlyDecember];

  expect(doseDaysForMonth(doses, [TRIPTAN], NOVEMBER, BOGOTA)).toEqual({ triptan: ['2026-11-30'] });
  expect(doseDaysForMonth(doses, [TRIPTAN], DECEMBER, BOGOTA)).toEqual({ triptan: ['2026-12-01'] });
});

test('the month of a date is read in the same time zone as the doses', () => {
  // 02:00 UTC on 1 December is still 21:00 on 30 November in Bogota.
  const doses = [dose('triptan', '2026-12-01T02:00:00Z')];
  expect(doseDaysForMonth(doses, [TRIPTAN], new Date('2026-12-01T02:00:00Z'), BOGOTA)).toEqual({ triptan: ['2026-11-30'] });
});

test('a dose taken just before midnight at the end of the year counts in that year', () => {
  const doses = [dose('triptan', '2027-01-01T04:30:00Z')];
  expect(doseDaysForMonth(doses, [TRIPTAN], new Date('2026-12-20T12:00:00Z'), BOGOTA)).toEqual({ triptan: ['2026-12-31'] });
});

test('preventive doses never count', () => {
  const preventive = medication('magnesium', { kind: 'preventive', medicationClass: 'other', schedule: 'daily', scheduleTime: '21:00:00' });
  expect(doseDaysForMonth([dose('magnesium', '2026-11-10T14:00:00Z')], [preventive], NOVEMBER, BOGOTA)).toEqual({});
});

test('past doses of an archived acute medication still count', () => {
  const archived = medication('old', { archived: true, medicationClass: 'simple_analgesic' });
  expect(doseDaysForMonth([dose('old', '2026-11-03T14:00:00Z')], [archived], NOVEMBER, BOGOTA)).toEqual({
    simple_analgesic: ['2026-11-03'],
  });
});

test('a dose of a medication that is not on the phone is left out', () => {
  expect(doseDaysForMonth([dose('missing', '2026-11-03T14:00:00Z')], [TRIPTAN], NOVEMBER, BOGOTA)).toEqual({});
});

test('days come back sorted', () => {
  const doses = [dose('triptan', '2026-11-20T14:00:00Z'), dose('triptan', '2026-11-02T14:00:00Z')];
  expect(doseDaysForMonth(doses, [TRIPTAN], NOVEMBER, BOGOTA)).toEqual({ triptan: ['2026-11-02', '2026-11-20'] });
});

test.each([
  ['2026-11-26T17:00:00Z', 4],
  ['2026-11-30T17:00:00Z', 0],
  ['2026-11-01T06:00:00Z', 29],
  ['2026-02-10T17:00:00Z', 18],
  ['2028-02-10T17:00:00Z', 19],
  // 03:00 UTC on 1 December is 22:00 on 30 November in Bogota: no days left.
  ['2026-12-01T03:00:00Z', 0],
])('daysLeftInMonth(%s) is %i', (now, left) => {
  expect(daysLeftInMonth(new Date(now), BOGOTA)).toBe(left);
});
