/** @jest-environment node */
// `record_inputs`' JSON into `RecordInputs`: a sample round-trips, a bad row is dropped alone, and tracking
// starts at the earlier of onboarding and the first record.
import { parseRecordInputs, type RecordInputs, trackingSinceOf } from '../records.ts';

const SAMPLE: RecordInputs = {
  timeZone: 'America/Bogota',
  knownTriggers: ['weather'],
  onboardedAt: '2026-09-01T12:00:00+00:00',
  hasLocation: true,
  episodes: [
    {
      id: 'aaaaaaaa-0000-0000-0000-000000000001',
      startedAt: '2026-11-20T10:00:00+00:00',
      endedAt: '2026-11-20T14:00:00+00:00',
      intensity: 6,
      triggers: ['stress'],
      helped: ['dark_room'],
      didNotHelp: ['caffeine'],
      debriefedAt: '2026-11-21T09:00:00+00:00',
    },
    { id: 'aaaaaaaa-0000-0000-0000-000000000002', startedAt: '2026-11-25T10:00:00+00:00', endedAt: null, intensity: null, triggers: [], helped: [], didNotHelp: [], debriefedAt: null },
  ],
  checkins: [
    { localDate: '2026-08-30', sleepBand: 'lt5', stress: 'high' },
    { localDate: '2026-11-19', sleepBand: null, stress: null },
  ],
  doses: [{ id: 'd1', medicationId: 'm1', episodeId: 'aaaaaaaa-0000-0000-0000-000000000001', takenAt: '2026-11-20T10:30:00+00:00', helped: true }],
  medications: [{ id: 'm1', name: 'Sumatriptan', kind: 'acute', class: 'triptan' }],
};

test('a sample round-trips', () => {
  expect(parseRecordInputs(JSON.parse(JSON.stringify(SAMPLE)))).toEqual(SAMPLE);
});

test("a row with an unknown sleep band, stress or class is dropped while the rest survive", () => {
  const parsed = parseRecordInputs({
    ...SAMPLE,
    checkins: [{ localDate: '2026-11-18', sleepBand: 'x', stress: 'low' }, { localDate: '2026-11-17', sleepBand: '7_8', stress: 'calm' }, ...SAMPLE.checkins],
    medications: [...SAMPLE.medications, { id: 'm2', name: 'New thing', kind: 'acute', class: 'antiemetic' }],
  });
  expect(parsed?.checkins).toEqual(SAMPLE.checkins);
  expect(parsed?.medications).toEqual(SAMPLE.medications);
  expect(parsed?.episodes).toEqual(SAMPLE.episodes);
});

test.each([
  ['a non-object', 'records'],
  ['null', null],
  ['an array', []],
  ['a missing list', { ...SAMPLE, doses: undefined }],
  ['hasLocation that is not a boolean', { ...SAMPLE, hasLocation: 'yes' }],
  ['knownTriggers that are not strings', { ...SAMPLE, knownTriggers: [1] }],
])('%s gives null', (_label, value) => {
  expect(parseRecordInputs(value)).toBeNull();
});

test('another caller reading empty lists and null profile fields still parses', () => {
  const empty = { timeZone: null, knownTriggers: [], onboardedAt: null, hasLocation: false, episodes: [], checkins: [], doses: [], medications: [] };
  expect(parseRecordInputs(empty)).toEqual(empty);
});

describe('trackingSinceOf', () => {
  const now = new Date('2026-11-27T17:00:00Z');

  test('the earlier of the onboarding date and the first check-in', () => {
    expect(trackingSinceOf(SAMPLE, 'America/Bogota', now)).toBe('2026-08-30');
    expect(trackingSinceOf({ ...SAMPLE, checkins: [] }, 'America/Bogota', now)).toBe('2026-09-01');
  });

  test('the onboarding date is a local date in the zone', () => {
    const late = { ...SAMPLE, onboardedAt: '2026-09-01T03:00:00Z', episodes: [], doses: [], checkins: [] };
    expect(trackingSinceOf(late, 'America/Bogota', now)).toBe('2026-08-31');
    expect(trackingSinceOf(late, 'UTC', now)).toBe('2026-09-01');
  });

  test('with no onboarding and no record it is today', () => {
    const empty = { ...SAMPLE, onboardedAt: null, episodes: [], doses: [], checkins: [] };
    expect(trackingSinceOf(empty, 'America/Bogota', now)).toBe('2026-11-27');
  });
});
