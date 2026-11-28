import { act, renderHook } from '@testing-library/react-native';

import { logDose } from '../../cabinet/doseStore';
import { saveMedication } from '../../cabinet/medicationStore';
import type { MedicationInput } from '../../cabinet/medicationStore';
import { saveCheckin } from '../../checkin/checkinStore';
import type { SleepBand } from '../../checkin/checkinStore';
import { READY_PROFILE, resetAuth } from '../../test/authMock';
import { seedEpisode } from '../../test/episodeSeed';
import { clearLocalDb } from '../../test/localDbTest';
import type { Signal } from '../index';
import { fetchTodayPressure } from '../signalRepository';
import { useTodaySignals } from '../useTodaySignals';

jest.mock('expo-sqlite', () => require('../../test/sqliteNode'));
jest.mock('expo-crypto', () => ({ randomUUID: () => (require('node:crypto') as typeof import('node:crypto')).randomUUID() }));
jest.mock('../../auth/AuthProvider', () => require('../../test/authMock'));
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => void) => {
    jest.requireActual<typeof import('react')>('react').useEffect(() => {
      effect();
    }, [effect]);
  },
}));
jest.mock('expo-network', () => ({ addNetworkStateListener: () => ({ remove: () => undefined }) }));
jest.mock('../../lib/localDate', () => ({
  ...jest.requireActual<typeof import('../../lib/localDate')>('../../lib/localDate'),
  deviceTimeZone: () => 'America/Bogota',
}));
jest.mock('../signalRepository', () => ({ fetchTodayPressure: jest.fn(), readCachedPressure: () => null }));

interface SignalCase {
  id: string;
  input: {
    now: string;
    user: {
      knownTriggers: string[];
      onboardedAt: string;
      episodes: { startedAt: string; endedAt: string | null }[];
      checkins: { localDate: string; sleepBand: SleepBand; stress: 'low' | 'mid' | 'high' }[];
      doses: { medicationId: string; takenAt: string }[];
      medications: { id: string; name: string }[];
    };
  };
  expected: { signals: Signal[] };
}

const { cases } = require('../../../supabase/functions/_shared/__tests__/fixtures/signals-cases.json') as { cases: SignalCase[] };
const mockedFetch = jest.mocked(fetchTodayPressure);
const USER = 'user-1';
// 08:05 in Bogotá.
const NOW = new Date('2026-11-27T13:05:00Z');
const TRIPTAN: MedicationInput = {
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

const pressure = (localDate: string): Signal => ({
  kind: 'pressure',
  cause: 'pressure',
  causeKey: `pressure:${localDate}`,
  evidence: { nowHpa: 1012, laterHpa: 1005, laterAt: '2026-11-28T13:00:00Z', dropHpa: 7 },
});

/** An attack in the afternoon of `localDate` (Bogotá), so that day's check-in is its night before. */
function attackOn(localDate: string): void {
  seedEpisode(USER, new Date(`${localDate}T19:00:00Z`), new Date(`${localDate}T22:00:00Z`));
}

/** Five attack nights averaging 5.1 h, the other nights at 7.5 h, and today's check-in under 5 h. */
function seedShortNight(): void {
  const attackNights: [string, SleepBand][] = [
    ['2026-11-03', 'lt5'],
    ['2026-11-08', 'lt5'],
    ['2026-11-13', '5_6'],
    ['2026-11-18', '5_6'],
    ['2026-11-22', '5_6'],
  ];
  for (const [date, band] of attackNights) {
    saveCheckin(USER, date, { sleepBand: band, stress: 'mid' });
    attackOn(date);
  }
  for (const date of ['2026-11-05', '2026-11-10', '2026-11-15', '2026-11-20', '2026-11-25', '2026-11-26']) {
    saveCheckin(USER, date, { sleepBand: '7_8', stress: 'mid' });
  }
  saveCheckin(USER, '2026-11-27', { sleepBand: 'lt5', stress: 'mid' });
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['queueMicrotask', 'nextTick', 'setImmediate'] });
  jest.clearAllMocks();
  clearLocalDb();
  resetAuth({ profile: { ...READY_PROFILE, knownTriggers: [], onboardingCompletedAt: '2026-09-01T15:00:00Z' } });
});

afterEach(() => {
  jest.useRealTimers();
});

test('a short night shows from the phone’s own records, before the server answers', async () => {
  mockedFetch.mockReturnValue(new Promise(() => undefined));
  seedShortNight();
  const { result } = await renderHook(() => useTodaySignals(USER, NOW));

  expect(result.current.rows.map((signal) => signal.kind)).toEqual(['short_sleep']);
  expect(result.current.rows[0]?.evidence).toMatchObject({ sleepBand: 'lt5', avgAttackNightHours: 5.1, attackNights: 5, avgOtherNightHours: 7.5 });
  expect(result.current.empty).toBeNull();
  expect(mockedFetch).toHaveBeenCalledWith(USER, '2026-11-27');
});

test('a stored pressure row joins the rows only for today', async () => {
  resetAuth({ profile: { ...READY_PROFILE, knownTriggers: ['weather'], onboardingCompletedAt: '2026-09-01T15:00:00Z' } });
  seedShortNight();
  mockedFetch.mockResolvedValue(pressure('2026-11-26'));
  const yesterday = await renderHook(() => useTodaySignals(USER, NOW));
  await act(async () => {
    await Promise.resolve();
  });
  expect(yesterday.result.current.all.map((signal) => signal.kind)).toEqual(['short_sleep']);
  await yesterday.unmount();

  mockedFetch.mockResolvedValue(pressure('2026-11-27'));
  const today = await renderHook(() => useTodaySignals(USER, NOW));
  await act(async () => {
    await Promise.resolve();
  });
  expect(today.result.current.rows.map((signal) => signal.kind)).toEqual(['short_sleep', 'pressure']);
});

test('fixture S17’s records give three rows in priority order', async () => {
  const found = cases.find((item) => item.id.startsWith('S17'));
  if (found === undefined) throw new Error('no fixture S17');
  const { user } = found.input;
  resetAuth({ profile: { ...READY_PROFILE, knownTriggers: user.knownTriggers, onboardingCompletedAt: user.onboardedAt } });
  for (const medication of user.medications) saveMedication(USER, medication.id, { ...TRIPTAN, name: medication.name });
  for (const episode of user.episodes) seedEpisode(USER, new Date(episode.startedAt), episode.endedAt === null ? null : new Date(episode.endedAt));
  for (const checkin of user.checkins) saveCheckin(USER, checkin.localDate, { sleepBand: checkin.sleepBand, stress: checkin.stress });
  for (const dose of user.doses) logDose(USER, { medicationId: dose.medicationId, takenAt: new Date(dose.takenAt), episodeId: null });
  const stored = found.expected.signals.find((signal) => signal.kind === 'pressure') ?? null;
  mockedFetch.mockResolvedValue(stored);

  const { result } = await renderHook(() => useTodaySignals(USER, new Date(found.input.now)));
  await act(async () => {
    await Promise.resolve();
  });
  expect(result.current.rows.map((signal) => signal.kind)).toEqual(['debrief_due', 'overuse_warn', 'short_sleep']);
  expect(result.current.all.map((signal) => signal.kind)).toEqual(['debrief_due', 'overuse_warn', 'short_sleep', 'pressure']);
});

test('two check-ins and no attack read as too new for signals; more with nothing firing read as none', async () => {
  mockedFetch.mockResolvedValue(null);
  saveCheckin(USER, '2026-11-26', { sleepBand: '7_8', stress: 'low' });
  saveCheckin(USER, '2026-11-27', { sleepBand: '7_8', stress: 'low' });
  const fresh = await renderHook(() => useTodaySignals(USER, NOW));
  expect(fresh.result.current).toMatchObject({ rows: [], empty: 'new' });
  await fresh.unmount();

  saveCheckin(USER, '2026-11-25', { sleepBand: '7_8', stress: 'low' });
  const settled = await renderHook(() => useTodaySignals(USER, NOW));
  expect(settled.result.current).toMatchObject({ rows: [], empty: 'none' });
});
