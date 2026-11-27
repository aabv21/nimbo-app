import { fireEvent, render, screen } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';

import Cabinet from '../app/cabinet';
import MedicationScreen from '../app/cabinet/[id]';
import Profile from '../app/(tabs)/profile';
import { daysLeftInMonth } from '../cabinet/doseDays';
import { logDose } from '../cabinet/doseStore';
import { saveMedication } from '../cabinet/medicationStore';
import { askNotificationPermission } from '../cabinet/reminders';
import type { MedicationInput } from '../cabinet/medicationStore';
import { translate } from '../i18n';
import type { MessageKey, Params } from '../i18n';
import { localDb } from '../lib/local/db';
import { listOutbox } from '../lib/outbox/outbox';
import { resetAuth } from '../test/authMock';
import { clearLocalDb } from '../test/localDbTest';

jest.mock('expo-sqlite', () => require('../test/sqliteNode'));
jest.mock('expo-crypto', () => ({ randomUUID: () => (require('node:crypto') as typeof import('node:crypto')).randomUUID() }));
jest.mock('../cabinet/reminders', () => ({ askNotificationPermission: jest.fn(() => Promise.resolve(true)) }));
jest.mock('../auth/AuthProvider', () => require('../test/authMock'));
// Profile reads the sync counts for its sign-out question.
jest.mock('../lib/sync/SyncProvider', () => require('../test/syncMock'));
jest.mock('../auth/useSignOut', () => ({ useSignOut: () => ({ signOut: jest.fn(), signingOut: false, error: undefined }) }));
jest.mock('../profile/profileRepository', () => ({ updateProfile: jest.fn(), setAiConsent: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: jest.fn(),
}));

const t = (key: MessageKey, params?: Params): string => translate('en', key, params);
const TRIPTAN_ID = '00000000-0000-4000-8000-0000000000a1';
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

/** One dose at local noon on each of the first `count` days of this month. */
function logTriptanDays(count: number): void {
  const now = new Date();
  for (let day = 1; day <= count; day += 1) {
    logDose('user-1', { medicationId: TRIPTAN_ID, takenAt: new Date(now.getFullYear(), now.getMonth(), day, 12), episodeId: null });
  }
}

function medicationRows(): { name: string; kind: string; class: string; min_interval_minutes: number | null; schedule: string | null }[] {
  return localDb().getAllSync('SELECT name, kind, class, min_interval_minutes, schedule FROM medications ORDER BY name;');
}

// Only the date is fixed, mid-month: `logTriptanDays` logs from the 1st, and `logDose` refuses a time ahead of now.
const NOW = new Date(2026, 10, 20, 15);

beforeEach(() => {
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'],
  });
  jest.clearAllMocks();
  clearLocalDb();
  resetAuth();
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: 'new' });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('the list', () => {
  test('an empty cabinet says what adding a medication does and offers to add one', async () => {
    await render(<Cabinet />);
    expect(screen.getByText(t('cabinet.empty.title'))).toBeTruthy();
    expect(screen.getByText(t('cabinet.empty.body'))).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: t('cabinet.add') }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/cabinet/[id]', params: { id: 'new' } });
  });

  test('medications are grouped, each acute one shows its days against the limit, and the source sits at the foot', async () => {
    saveMedication('user-1', TRIPTAN_ID, TRIPTAN);
    saveMedication('user-1', '00000000-0000-4000-8000-0000000000a2', {
      ...TRIPTAN,
      name: 'Magnesium',
      kind: 'preventive',
      medicationClass: 'other',
      schedule: 'daily',
      scheduleTime: '21:00:00',
    });
    logTriptanDays(3);
    await render(<Cabinet />);

    expect(screen.getByText(t('cabinet.kind.acute'))).toBeTruthy();
    expect(screen.getByText(t('cabinet.kind.preventive'))).toBeTruthy();
    expect(screen.getByText(t('today.med.days', { used: 3, limit: 10 }))).toBeTruthy();
    expect(screen.getByText(t('cabinet.schedule.daily', { time: '21:00' }))).toBeTruthy();
    expect(screen.getByText(t('cabinet.limits.source'))).toBeTruthy();
    expect(screen.queryByText(t('overuse.limit.action'))).toBeNull();
  });

  test('at 8 triptan days the list shows the warn notice with 8 of 10', async () => {
    saveMedication('user-1', TRIPTAN_ID, TRIPTAN);
    logTriptanDays(8);
    await render(<Cabinet />);

    const title = t('overuse.warn.title', { class: t('med.class.triptan'), used: 8, limit: 10 });
    expect(title).toContain('8 of 10');
    expect(screen.getByText(title)).toBeTruthy();
    expect(screen.queryByText(t('overuse.limit.action'))).toBeNull();
  });

  test('at the limit the list shows the limit notice and its action opens the dose history', async () => {
    saveMedication('user-1', TRIPTAN_ID, TRIPTAN);
    logTriptanDays(10);
    await render(<Cabinet />);

    expect(screen.getByText(t('overuse.limit.title', { used: 10, limit: 10 }))).toBeTruthy();
    await fireEvent.press(screen.getByText(t('overuse.limit.action')));
    expect(router.push).toHaveBeenCalledWith('/history?filter=doses');
  });

  test('the warn notice counts the days left in the month', async () => {
    saveMedication('user-1', TRIPTAN_ID, TRIPTAN);
    logTriptanDays(8);
    await render(<Cabinet />);
    const left = daysLeftInMonth(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(screen.getByText(translate('en', left === 1 ? 'overuse.warn.body.one' : 'overuse.warn.body.other', { left }))).toBeTruthy();
  });

  test('another user’s medications are not listed', async () => {
    saveMedication('user-2', TRIPTAN_ID, TRIPTAN);
    await render(<Cabinet />);
    expect(screen.getByText(t('cabinet.empty.title'))).toBeTruthy();
  });
});

describe('the form', () => {
  test('adding an acute triptan with no interval saves it and goes back', async () => {
    await render(<MedicationScreen />);
    await fireEvent.changeText(screen.getByLabelText(t('cabinet.name')), '  Sumatriptan ');
    await fireEvent.press(screen.getByRole('radio', { name: t('med.class.triptan') }));
    await fireEvent.press(screen.getByRole('button', { name: t('common.save') }));

    expect(medicationRows()).toEqual([{ name: 'Sumatriptan', kind: 'acute', class: 'triptan', min_interval_minutes: null, schedule: null }]);
    expect(listOutbox('user-1').map((op) => op.kind)).toEqual(['save_medication']);
    expect(router.back).toHaveBeenCalled();
  });

  test('an interval in hours is saved as minutes', async () => {
    await render(<MedicationScreen />);
    await fireEvent.changeText(screen.getByLabelText(t('cabinet.name')), 'Ibuprofen');
    await fireEvent.changeText(screen.getByLabelText(t('cabinet.interval')), '1,5');
    await fireEvent.press(screen.getByRole('button', { name: t('common.save') }));
    expect(medicationRows()[0]?.min_interval_minutes).toBe(90);
  });

  test('a blank name shows the error and saves nothing', async () => {
    await render(<MedicationScreen />);
    await fireEvent.changeText(screen.getByLabelText(t('cabinet.name')), '   ');
    await fireEvent.press(screen.getByRole('button', { name: t('common.save') }));

    expect(screen.getByText(t('cabinet.name.error'))).toBeTruthy();
    expect(medicationRows()).toEqual([]);
    expect(router.back).not.toHaveBeenCalled();
  });

  test.each(['0.2', '80', 'abc'])('an interval of %s shows the interval error and saves nothing', async (text) => {
    await render(<MedicationScreen />);
    await fireEvent.changeText(screen.getByLabelText(t('cabinet.name')), 'Ibuprofen');
    await fireEvent.changeText(screen.getByLabelText(t('cabinet.interval')), text);
    await fireEvent.press(screen.getByRole('button', { name: t('common.save') }));
    expect(screen.getByText(t('cabinet.interval.error'))).toBeTruthy();
    expect(medicationRows()).toEqual([]);
  });

  test('choosing Preventive hides the interval and shows the schedule', async () => {
    await render(<MedicationScreen />);
    expect(screen.getByLabelText(t('cabinet.interval'))).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: t('cabinet.kind.preventive') }));

    expect(screen.queryByLabelText(t('cabinet.interval'))).toBeNull();
    expect(screen.getByText(t('cabinet.schedule'))).toBeTruthy();
    expect(screen.getByRole('radio', { name: t('cabinet.schedule.none') })).toBeTruthy();
  });

  test('a monthly preventive needs a time and a start date, then saves them', async () => {
    await render(<MedicationScreen />);
    await fireEvent.changeText(screen.getByLabelText(t('cabinet.name')), 'Injection');
    await fireEvent.press(screen.getByRole('radio', { name: t('cabinet.kind.preventive') }));
    await fireEvent.press(screen.getByRole('radio', { name: t('cabinet.schedule.monthly', { day: new Date().getDate(), time: '--:--' }) }));
    await fireEvent.press(screen.getByRole('button', { name: t('common.save') }));
    expect(screen.getAllByText(t('cabinet.schedule.error')).length).toBeGreaterThan(0);
    expect(medicationRows()).toEqual([]);

    await fireEvent.changeText(screen.getByLabelText(t('cabinet.schedule.time')), '9:30');
    await fireEvent.changeText(screen.getByLabelText(t('cabinet.schedule.start')), '2026-12-05');
    await fireEvent.press(screen.getByRole('button', { name: t('common.save') }));

    expect(medicationRows()).toEqual([expect.objectContaining({ name: 'Injection', kind: 'preventive', schedule: 'monthly', min_interval_minutes: null })]);
    const args = listOutbox('user-1')[0]?.args as { p_fields: unknown };
    expect(args.p_fields).toEqual(expect.objectContaining({ schedule: 'monthly', schedule_time: '09:30:00', schedule_anchor: '2026-12-05' }));
  });

  test('saving a schedule asks for the notification permission', async () => {
    await render(<MedicationScreen />);
    await fireEvent.changeText(screen.getByLabelText(t('cabinet.name')), 'Propranolol');
    await fireEvent.press(screen.getByRole('radio', { name: t('cabinet.kind.preventive') }));
    await fireEvent.press(screen.getByRole('radio', { name: t('cabinet.schedule.daily', { time: '--:--' }) }));
    await fireEvent.changeText(screen.getByLabelText(t('cabinet.schedule.time')), '8:00');
    await fireEvent.press(screen.getByRole('button', { name: t('common.save') }));

    expect(askNotificationPermission).toHaveBeenCalledTimes(1);
    expect(askNotificationPermission).toHaveBeenCalledWith('en');
  });

  test('saving an acute medication does not ask', async () => {
    await render(<MedicationScreen />);
    await fireEvent.changeText(screen.getByLabelText(t('cabinet.name')), 'Ibuprofen');
    await fireEvent.press(screen.getByRole('button', { name: t('common.save') }));

    expect(askNotificationPermission).not.toHaveBeenCalled();
  });

  test('an existing medication opens filled in and ends with an archive that asks first', async () => {
    saveMedication('user-1', TRIPTAN_ID, { ...TRIPTAN, minIntervalHours: 4 });
    jest.mocked(useLocalSearchParams).mockReturnValue({ id: TRIPTAN_ID });
    await render(<MedicationScreen />);

    expect(screen.getByDisplayValue('Sumatriptan')).toBeTruthy();
    expect(screen.getByDisplayValue('4')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: t('cabinet.archive') }));
    expect(screen.getByText(t('cabinet.archive.confirm'))).toBeTruthy();
    expect(localDb().getFirstSync('SELECT archived_at FROM medications WHERE archived_at IS NOT NULL;')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: t('common.confirm') }));
    expect(localDb().getFirstSync('SELECT archived_at FROM medications WHERE archived_at IS NOT NULL;')).not.toBeNull();
    expect(router.back).toHaveBeenCalled();
  });
});

describe('the profile row', () => {
  test('opens the cabinet and shows how many medications it holds', async () => {
    saveMedication('user-1', TRIPTAN_ID, TRIPTAN);
    await render(<Profile />);
    expect(screen.getByText('1')).toBeTruthy();
    await fireEvent.press(screen.getByText(t('cabinet.title')));
    expect(router.push).toHaveBeenCalledWith('/cabinet');
  });
});
