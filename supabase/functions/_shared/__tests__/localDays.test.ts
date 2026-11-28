/** @jest-environment node */
import { addDays, daysBetween, daysInMonth, localHourIn, recordDayOf, weekdayOf } from '../localDays.ts';

test('an attack at 02:30 local belongs to the previous record day', () => {
  expect(recordDayOf(new Date('2026-11-20T07:30:00Z'), 'America/Bogota', 4)).toBe('2026-11-19');
  expect(recordDayOf(new Date('2026-11-20T09:30:00Z'), 'America/Bogota', 4)).toBe('2026-11-20');
});

test('localHourIn follows summer time in America/Santiago (UTC−3)', () => {
  expect(localHourIn(new Date('2026-11-27T04:30:00Z'), 'America/Santiago')).toBe(1);
});

test('localHourIn reads midnight as 0', () => {
  expect(localHourIn(new Date('2026-11-27T05:00:00Z'), 'America/Bogota')).toBe(0);
});

test('daysBetween and addDays', () => {
  expect(daysBetween('2026-09-03', '2026-10-16')).toBe(43);
  expect(daysBetween('2026-11-27', '2026-11-20')).toBe(-7);
  expect(addDays('2026-11-27', -89)).toBe('2026-08-30');
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
});

test('weekdayOf and daysInMonth', () => {
  expect(weekdayOf('2026-11-23')).toBe('mon');
  expect(weekdayOf('2026-11-29')).toBe('sun');
  expect(daysInMonth('2026-02')).toBe(28);
  expect(daysInMonth('2028-02')).toBe(29);
  expect(daysInMonth('2026-12')).toBe(31);
});
