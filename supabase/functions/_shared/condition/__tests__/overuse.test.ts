/** @jest-environment node */
import { overuseStatus } from '../overuse.ts';
import type { OveruseEntry } from '../overuse.ts';
import { migraine as pack } from '../migraine.ts';

function days(count: number, month = '2026-11', from = 1): string[] {
  return Array.from({ length: count }, (_, index) => `${month}-${String(from + index).padStart(2, '0')}`);
}

test('the combined limit is the ICHD-3 8.2.6 count of 10 days', () => {
  expect(pack.combinedClassDayLimit).toBe(10);
});

test.each([
  ['triptan', 7, 'ok', 10],
  ['triptan', 8, 'warn', 10],
  ['triptan', 9, 'warn', 10],
  ['triptan', 10, 'limit', 10],
  ['simple_analgesic', 11, 'ok', 15],
  ['simple_analgesic', 12, 'warn', 15],
  ['simple_analgesic', 15, 'limit', 15],
  ['opioid', 10, 'limit', 10],
] as const)('%s on %i days is %s against %i', (medicationClass, count, level, limit) => {
  const { byClass } = overuseStatus({ [medicationClass]: days(count) }, pack);
  expect(byClass[medicationClass]).toEqual({ days: count, limit, level });
});

test('a class with no tracked limit is always ok', () => {
  const { byClass } = overuseStatus({ gepant: days(20) }, pack);
  expect(byClass.gepant).toEqual({ days: 20, limit: null, level: 'ok' });
});

test('every class is present, with zero days when it has none', () => {
  const { byClass } = overuseStatus({}, pack);
  expect(Object.keys(byClass).sort()).toEqual([...pack.medicationClasses].sort());
  expect(byClass.ergot).toEqual({ days: 0, limit: 10, level: 'ok' });
});

test('two classes on different dates add up to the combined limit while neither is past warn', () => {
  const status = overuseStatus({ triptan: days(5), simple_analgesic: days(5, '2026-11', 11) }, pack);
  expect(status.byClass.triptan.level).toBe('ok');
  expect(status.byClass.simple_analgesic.level).toBe('ok');
  expect(status.combined).toEqual({ days: 10, limit: 10, level: 'limit', classes: ['simple_analgesic', 'triptan'] });
});

test('a date taken in two classes counts once in the combined total', () => {
  const status = overuseStatus({ triptan: days(5), simple_analgesic: days(5) }, pack);
  expect(status.combined).toEqual({ days: 5, limit: 10, level: 'ok', classes: ['simple_analgesic', 'triptan'] });
});

test('the same date listed twice in one class counts once', () => {
  const status = overuseStatus({ triptan: ['2026-11-03', '2026-11-03'] }, pack);
  expect(status.byClass.triptan.days).toBe(1);
});

test('the combined warn level starts at 8 of 10', () => {
  const status = overuseStatus({ triptan: days(4), opioid: days(4, '2026-11', 11) }, pack);
  expect(status.combined.level).toBe('warn');
});

test('one class alone never raises the combined notice', () => {
  const status = overuseStatus({ simple_analgesic: days(12) }, pack);
  expect(status.byClass.simple_analgesic.level).toBe('warn');
  expect(status.combined).toEqual({ days: 12, limit: 10, level: 'ok', classes: ['simple_analgesic'] });
});

test('a class without a limit adds no days to the combined total', () => {
  const status = overuseStatus({ gepant: days(9), triptan: days(2, '2026-11', 20) }, pack);
  expect(status.combined).toEqual({ days: 2, limit: 10, level: 'ok', classes: ['triptan'] });
});

test('combination analgesics (8.2.5, their own limit) and gepants and others never count toward the combined total', () => {
  const status = overuseStatus({ combination_analgesic: days(5), triptan: days(5, '2026-11', 11) }, pack);
  expect(status.combined).toEqual({ days: 5, limit: 10, level: 'ok', classes: ['triptan'] });

  const never = overuseStatus({ gepant: days(6), other: days(6, '2026-11', 11), triptan: days(2, '2026-11', 21) }, pack);
  expect(never.combined).toEqual({ days: 2, limit: 10, level: 'ok', classes: ['triptan'] });
});

test('combination analgesics keep their own 10-day limit', () => {
  expect(overuseStatus({ combination_analgesic: days(10) }, pack).byClass.combination_analgesic.level).toBe('limit');
});

test('the status is typed as an entry per class', () => {
  const entry: OveruseEntry = overuseStatus({}, pack).byClass.triptan;
  expect(entry.level).toBe('ok');
});
