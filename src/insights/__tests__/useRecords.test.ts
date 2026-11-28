import { renderHook } from '@testing-library/react-native';

import { logDose } from '../../cabinet/doseStore';
import { saveMedication } from '../../cabinet/medicationStore';
import type { MedicationInput } from '../../cabinet/medicationStore';
import { saveCheckin } from '../../checkin/checkinStore';
import { localDate } from '../../lib/localDate';
import { resetAuth, READY_PROFILE } from '../../test/authMock';
import { seedEpisode } from '../../test/episodeSeed';
import { clearLocalDb } from '../../test/localDbTest';
import { packs } from '../../condition';
import { computeInsights, insightNeeds, parseRecordInputs } from '../index';
import { usableZone, useRecords } from '../useRecords';

jest.mock('expo-sqlite', () => require('../../test/sqliteNode'));
jest.mock('expo-crypto', () => ({ randomUUID: () => (require('node:crypto') as typeof import('node:crypto')).randomUUID() }));
jest.mock('../../auth/AuthProvider', () => require('../../test/authMock'));
const mockZone = { value: 'America/Bogota' };
jest.mock('../../lib/localDate', () => ({
  ...jest.requireActual<typeof import('../../lib/localDate')>('../../lib/localDate'),
  deviceTimeZone: () => mockZone.value,
}));

const USER = 'user-1';
const DAY_MS = 86_400_000;
const ago = (days: number, hours = 0): Date => new Date(Date.now() - days * DAY_MS + hours * 3_600_000);
const MEDICATION: MedicationInput = {
  name: 'Sumatriptan',
  kind: 'acute',
  form: 'oral',
  medicationClass: 'triptan',
  doseText: null,
  minIntervalHours: null,
  schedule: null,
  scheduleTime: null,
  scheduleAnchor: null,
  archived: false,
};

beforeEach(() => {
  clearLocalDb();
  mockZone.value = 'America/Bogota';
  resetAuth({ profile: { ...READY_PROFILE, knownTriggers: ['weather'], onboardingCompletedAt: '2026-11-01T10:05:00Z' } });
});

test('seeded episodes, check-ins, doses and an archived medication come back as Records, with class and sleepBand', async () => {
  saveMedication(USER, 'med-active', MEDICATION);
  saveMedication(USER, 'med-old', { ...MEDICATION, name: 'Rizatriptan', archived: true });
  const episodeId = seedEpisode(USER, ago(3), ago(3, 2), { triggers: ['stress'], intensity: 6 });
  const open = seedEpisode(USER, ago(0, -1), null);
  const doseId = logDose(USER, { medicationId: 'med-old', takenAt: ago(3, 1), episodeId });
  saveCheckin(USER, localDate(ago(1)), { sleepBand: 'lt5', stress: 'high' });

  const { result } = await renderHook(() => useRecords(USER));
  const records = result.current;
  expect(records).toMatchObject({ timeZone: 'America/Bogota', knownTriggers: ['weather'], onboardedAt: '2026-11-01T10:05:00Z', hasLocation: false });
  expect(records.episodes.map((episode) => episode.id).sort()).toEqual([episodeId, open].sort());
  expect(records.episodes.find((episode) => episode.id === episodeId)).toEqual({
    id: episodeId,
    startedAt: expect.any(String) as unknown,
    endedAt: expect.any(String) as unknown,
    intensity: 6,
    triggers: ['stress'],
    helped: [],
    didNotHelp: [],
    debriefedAt: null,
  });
  expect(records.doses).toEqual([{ id: doseId, medicationId: 'med-old', episodeId, takenAt: expect.any(String) as unknown, helped: null }]);
  expect(records.checkins).toEqual([{ localDate: localDate(ago(1)), sleepBand: 'lt5', stress: 'high' }]);
  expect(records.medications).toEqual(
    expect.arrayContaining([
      { id: 'med-active', name: 'Sumatriptan', kind: 'acute', class: 'triptan' },
      { id: 'med-old', name: 'Rizatriptan', kind: 'acute', class: 'triptan' },
    ]),
  );
  // The same shape the server's parser accepts.
  expect(parseRecordInputs(JSON.parse(JSON.stringify(records)))).toEqual(records);
});

test('an unknown device zone reads as UTC, and the insights over it do not throw', async () => {
  mockZone.value = 'Mars/Base';
  seedEpisode(USER, ago(2), ago(2, 1), { triggers: ['stress'] });
  const { result } = await renderHook(() => useRecords(USER));
  expect(result.current.timeZone).toBe('UTC');
  const data = { ...result.current, timeZone: result.current.timeZone ?? 'UTC', now: new Date(), trackingSince: localDate(ago(20)) };
  expect(() => computeInsights(data, packs.migraine)).not.toThrow();
  expect(insightNeeds(data, packs.migraine).length).toBeGreaterThan(0);
  expect(usableZone('')).toBe('UTC');
  expect(usableZone(undefined)).toBe('UTC');
  expect(usableZone('Europe/Lisbon')).toBe('Europe/Lisbon');
});

test('a zone change on the next render reaches the records, so Patterns follows a trip', async () => {
  const { result, rerender } = await renderHook(() => useRecords(USER));
  expect(result.current.timeZone).toBe('America/Bogota');
  mockZone.value = 'Asia/Tokyo';
  await rerender({});
  expect(result.current.timeZone).toBe('Asia/Tokyo');
});
