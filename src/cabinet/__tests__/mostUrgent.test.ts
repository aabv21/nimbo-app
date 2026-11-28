import { overuseStatus, packs } from '../../condition';
import type { MedicationClass } from '../../condition';
import { mostUrgent } from '../OveruseNotice';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const pack = packs.migraine;

function days(count: number, from = 1): string[] {
  return Array.from({ length: count }, (_, index) => `2026-11-${String(from + index).padStart(2, '0')}`);
}

function urgent(doseDays: Partial<Record<MedicationClass, string[]>>): { scope: string; level: string } | null {
  const found = mostUrgent(overuseStatus(doseDays, pack));
  return found === null ? null : { scope: found.scope, level: found.entry.level };
}

test('a class at its limit beats the combined count at its limit', () => {
  expect(urgent({ triptan: days(10), simple_analgesic: days(5, 11) })).toEqual({ scope: 'triptan', level: 'limit' });
});

test('a class at its limit beats a class at warn', () => {
  expect(urgent({ triptan: days(10), simple_analgesic: days(12) })).toEqual({ scope: 'triptan', level: 'limit' });
});

test('the combined limit beats a class at warn', () => {
  expect(urgent({ triptan: days(8), opioid: days(4, 11) })).toEqual({ scope: 'combined', level: 'limit' });
});

test('is null when everything is ok', () => {
  expect(urgent({ triptan: days(3), simple_analgesic: days(2, 11) })).toBeNull();
  expect(urgent({})).toBeNull();
});
