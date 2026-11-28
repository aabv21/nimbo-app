import type { Dose } from '../../cabinet/doseStore';
import type { Medication } from '../../cabinet/medicationStore';
import { safeFacts } from '../safeFacts';

const IBUPROFEN: Medication = {
  id: 'm-ibu',
  name: 'Ibuprofen 400 mg',
  kind: 'acute',
  form: 'oral',
  medicationClass: 'simple_analgesic',
  doseText: null,
  minIntervalMinutes: 480,
  schedule: null,
  scheduleTime: null,
  scheduleAnchor: null,
  archived: false,
  dirty: false,
};
const TRIPTAN: Medication = { ...IBUPROFEN, id: 'm-tri', name: 'Sumatriptan', medicationClass: 'triptan', minIntervalMinutes: null };
const PREVENTIVE: Medication = { ...IBUPROFEN, id: 'm-pre', name: 'Topiramate', kind: 'preventive' };

const NOW = new Date(2026, 10, 27, 16, 20);

function dose(medicationId: string, takenAt: Date, id = `${medicationId}-${String(takenAt.getTime())}`): Dose {
  return { id, medicationId, episodeId: null, takenAt: takenAt.toISOString(), helped: null, dirty: false };
}

test('ibuprofen with an 8 h interval taken at 15:55 gives its name, time and 8 hours', () => {
  const at = new Date(2026, 10, 27, 15, 55);
  expect(safeFacts([dose('m-ibu', at)], [IBUPROFEN], NOW)).toEqual({ med: 'Ibuprofen 400 mg', time: at, hours: 8 });
});

test('a triptan with no interval gives null', () => {
  expect(safeFacts([dose('m-tri', new Date(2026, 10, 27, 15, 0))], [TRIPTAN], NOW)).toBeNull();
});

test('a dose 25 h ago gives null', () => {
  expect(safeFacts([dose('m-ibu', new Date(NOW.getTime() - 25 * 60 * 60 * 1000))], [IBUPROFEN], NOW)).toBeNull();
});

test('the latest qualifying dose wins; a preventive or an unknown medication does not count', () => {
  const early = new Date(2026, 10, 27, 9, 0);
  const late = new Date(2026, 10, 27, 14, 0);
  const doses = [dose('m-pre', new Date(2026, 10, 27, 15, 0)), dose('m-gone', new Date(2026, 10, 27, 15, 30)), dose('m-ibu', late), dose('m-ibu', early)];
  expect(safeFacts(doses, [IBUPROFEN, PREVENTIVE], NOW)).toEqual({ med: 'Ibuprofen 400 mg', time: late, hours: 8 });
});
