import type { Medication } from '../medicationStore';
import { nextPreventive } from '../nextPreventive';

const ZONE = 'America/Bogota';
const bogota = (hour: number, minute = 0, day = 26): Date => new Date(Date.UTC(2026, 10, day, hour + 5, minute));

function medication(patch: Partial<Medication> = {}): Medication {
  return {
    id: 'med-1',
    name: 'Propranolol',
    kind: 'preventive',
    form: 'oral',
    medicationClass: 'other',
    doseText: null,
    minIntervalMinutes: null,
    schedule: 'daily',
    scheduleTime: '20:00:00',
    scheduleAnchor: null,
    archived: false,
    dirty: false,
    ...patch,
  };
}

test('a daily 20:00 medication at 15:00 gives today at 20:00', () => {
  const med = medication();
  expect(nextPreventive([med], bogota(15), ZONE)).toEqual({ medication: med, at: bogota(20) });
});

test('at 21:00 it gives null: only today counts', () => {
  expect(nextPreventive([medication()], bogota(21), ZONE)).toBeNull();
});

test('the earliest of several wins', () => {
  const late = medication({ id: 'late', scheduleTime: '21:30:00' });
  const early = medication({ id: 'early', scheduleTime: '18:00:00' });
  expect(nextPreventive([late, early], bogota(15), ZONE)?.medication.id).toBe('early');
});

test('a monthly medication counts only on its day', () => {
  const monthly = medication({ schedule: 'monthly', scheduleAnchor: '2026-01-26' });
  expect(nextPreventive([monthly], bogota(15), ZONE)?.at).toEqual(bogota(20));
  expect(nextPreventive([monthly], bogota(15, 0, 27), ZONE)).toBeNull();
});

test('archived, acute and unscheduled medications are ignored', () => {
  expect(
    nextPreventive(
      [medication({ archived: true }), medication({ kind: 'acute' }), medication({ schedule: null, scheduleTime: null })],
      bogota(15),
      ZONE,
    ),
  ).toBeNull();
});
