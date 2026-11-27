import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { translate } from '../../i18n';
import type { Medication } from '../medicationStore';
import { askNotificationPermission, clearReminders, nextOccurrences, REMINDER_CHANNEL_ID, syncReminders } from '../reminders';

interface Scheduled {
  identifier: string;
  content: { title: string; body: string; data?: unknown };
  trigger: { type: string; hour?: number; minute?: number; date?: Date; channelId?: string };
}

const mockScheduled: Scheduled[] = [];
/** Identifiers of the notifications in the tray. */
const mockPresented: string[] = [];
const mockPermission = { granted: true, canAskAgain: true };

jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DAILY: 'daily', DATE: 'date' },
  AndroidImportance: { DEFAULT: 3 },
  AndroidNotificationVisibility: { PRIVATE: 0 },
  IosAuthorizationStatus: { PROVISIONAL: 3 },
  setNotificationChannelAsync: jest.fn(() => Promise.resolve(null)),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ ...mockPermission })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true, canAskAgain: true })),
  getAllScheduledNotificationsAsync: jest.fn(() =>
    Promise.resolve(mockScheduled.map(({ identifier, content, trigger }) => ({ identifier, content, trigger }))),
  ),
  cancelScheduledNotificationAsync: jest.fn((identifier: string) => {
    const at = mockScheduled.findIndex((entry) => entry.identifier === identifier);
    if (at >= 0) mockScheduled.splice(at, 1);
    return Promise.resolve();
  }),
  getPresentedNotificationsAsync: jest.fn(() =>
    Promise.resolve(mockPresented.map((identifier) => ({ date: 0, request: { identifier, content: { title: 'Nimbo', body: '' }, trigger: null } }))),
  ),
  dismissNotificationAsync: jest.fn((identifier: string) => {
    const at = mockPresented.indexOf(identifier);
    if (at >= 0) mockPresented.splice(at, 1);
    return Promise.resolve();
  }),
  scheduleNotificationAsync: jest.fn((request: { identifier: string } & Omit<Scheduled, 'identifier'>) => {
    mockScheduled.push(request);
    return Promise.resolve(request.identifier);
  }),
}));

const ZONE = 'America/Bogota';
const UTC_OFFSET_HOURS = 5;
/** A Bogotá wall-clock time as the instant it is. */
const bogota = (year: number, month: number, day: number, hour: number, minute = 0): Date =>
  new Date(Date.UTC(year, month - 1, day, hour + UTC_OFFSET_HOURS, minute));

const DAILY = { schedule: 'daily', scheduleTime: '08:00:00', scheduleAnchor: null } as const;

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
    scheduleTime: '08:00:00',
    scheduleAnchor: null,
    archived: false,
    dirty: false,
    ...patch,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockScheduled.length = 0;
  mockPresented.length = 0;
  mockPermission.granted = true;
  mockPermission.canAskAgain = true;
});

describe('nextOccurrences', () => {
  test('daily 08:00 from 26 Nov 09:00 gives 27, 28 and 29 Nov at 08:00', () => {
    expect(nextOccurrences(DAILY, bogota(2026, 11, 26, 9), 3, ZONE)).toEqual([
      bogota(2026, 11, 27, 8),
      bogota(2026, 11, 28, 8),
      bogota(2026, 11, 29, 8),
    ]);
  });

  test('daily from before the time starts the same day', () => {
    expect(nextOccurrences(DAILY, bogota(2026, 11, 26, 7, 59), 1, ZONE)).toEqual([bogota(2026, 11, 26, 8)]);
  });

  test('a monthly anchor on the 31st falls on the last day of shorter months', () => {
    const med = { schedule: 'monthly', scheduleTime: '08:00:00', scheduleAnchor: '2027-01-31' } as const;
    expect(nextOccurrences(med, bogota(2027, 1, 31, 20), 2, ZONE)).toEqual([bogota(2027, 2, 28, 8), bogota(2027, 3, 31, 8)]);
  });

  test('February has 29 days in 2028', () => {
    const med = { schedule: 'monthly', scheduleTime: '08:00:00', scheduleAnchor: '2028-01-31' } as const;
    expect(nextOccurrences(med, bogota(2028, 1, 31, 20), 1, ZONE)).toEqual([bogota(2028, 2, 29, 8)]);
  });

  test('a monthly schedule that has not started yet begins on its anchor', () => {
    const med = { schedule: 'monthly', scheduleTime: '08:00:00', scheduleAnchor: '2027-03-10' } as const;
    expect(nextOccurrences(med, bogota(2026, 11, 26, 9), 2, ZONE)).toEqual([bogota(2027, 3, 10, 8), bogota(2027, 4, 10, 8)]);
  });

  test('quarterly with anchor 15 Jan gives 15 Apr, 15 Jul and 15 Oct', () => {
    const med = { schedule: 'quarterly', scheduleTime: '08:00:00', scheduleAnchor: '2027-01-15' } as const;
    expect(nextOccurrences(med, bogota(2027, 1, 15, 12), 3, ZONE)).toEqual([
      bogota(2027, 4, 15, 8),
      bogota(2027, 7, 15, 8),
      bogota(2027, 10, 15, 8),
    ]);
  });

  test('a schedule without its time, or a monthly one without its anchor, gives nothing', () => {
    expect(nextOccurrences({ ...DAILY, scheduleTime: null }, new Date(), 3, ZONE)).toEqual([]);
    expect(nextOccurrences({ schedule: 'monthly', scheduleTime: '08:00:00', scheduleAnchor: null }, new Date(), 3, ZONE)).toEqual([]);
    expect(nextOccurrences({ schedule: null, scheduleTime: null, scheduleAnchor: null }, new Date(), 3, ZONE)).toEqual([]);
  });
});

describe('syncReminders', () => {
  const NEUTRAL = translate('en', 'push.neutral');

  test('without the lock-screen detail the body is the neutral line and never the medication name', async () => {
    await syncReminders('user-1', [medication({ name: 'Propranolol' })], { detail: false, locale: 'en' });

    expect(mockScheduled).toHaveLength(1);
    expect(mockScheduled[0]?.content).toEqual({ title: 'Nimbo', body: NEUTRAL });
    expect(JSON.stringify(mockScheduled)).not.toContain('Propranolol');
    expect(mockScheduled[0]?.trigger).toEqual({ type: 'daily', hour: 8, minute: 0, channelId: REMINDER_CHANNEL_ID });
  });

  test('with the detail on the body names the medication, and only the body', async () => {
    await syncReminders('user-1', [medication({ name: 'Propranolol' })], { detail: true, locale: 'es' });

    expect(mockScheduled[0]?.content.body).toBe(translate('es', 'reminder.detail', { med: 'Propranolol' }));
    expect(mockScheduled[0]?.content.title).toBe('Nimbo');
    expect(mockScheduled[0]?.content.data).toBeUndefined();
  });

  test('a monthly medication gets three one-time date notifications', async () => {
    const med = medication({ schedule: 'monthly', scheduleAnchor: '2020-01-31' });
    await syncReminders('user-1', [med], { detail: false, locale: 'en' });

    expect(mockScheduled.map((entry) => entry.trigger.type)).toEqual(['date', 'date', 'date']);
    const dates = mockScheduled.map((entry) => entry.trigger.date?.getTime() ?? 0);
    expect(dates).toEqual([...dates].sort((a, b) => a - b));
    expect(dates.every((at) => at > Date.now())).toBe(true);
  });

  test('syncing again replaces the notifications instead of adding to them', async () => {
    await syncReminders('user-1', [medication()], { detail: false, locale: 'en' });
    await syncReminders('user-1', [medication()], { detail: false, locale: 'en' });
    expect(mockScheduled).toHaveLength(1);
  });

  test('an archived medication is cancelled', async () => {
    await syncReminders('user-1', [medication()], { detail: false, locale: 'en' });
    expect(mockScheduled).toHaveLength(1);

    await syncReminders('user-1', [medication({ archived: true })], { detail: false, locale: 'en' });
    expect(mockScheduled).toEqual([]);
  });

  test('an acute medication or one without a schedule gets no reminder', async () => {
    await syncReminders('user-1', [medication({ kind: 'acute' }), medication({ id: 'med-2', schedule: null, scheduleTime: null })], {
      detail: false,
      locale: 'en',
    });
    expect(mockScheduled).toEqual([]);
  });

  test('another user’s reminders are cancelled when a new user syncs', async () => {
    await syncReminders('user-a', [medication()], { detail: true, locale: 'en' });
    await syncReminders('user-b', [], { detail: true, locale: 'en' });
    expect(mockScheduled).toEqual([]);
  });

  test('clearReminders cancels every reminder of the app', async () => {
    await syncReminders('user-1', [medication(), medication({ id: 'med-2', name: 'Topiramate' })], { detail: false, locale: 'en' });
    await clearReminders();
    expect(mockScheduled).toEqual([]);
  });

  test('clearReminders also takes the delivered reminders out of the tray, and nothing else', async () => {
    mockPresented.push('preventive-reminder:user-1:med-1:0', 'another-app-alert', 'preventive-reminder:user-1:med-2:1');
    await clearReminders();
    expect(mockPresented).toEqual(['another-app-alert']);
  });

  test('a tray the OS cannot read still lets clearReminders cancel the scheduled ones', async () => {
    await syncReminders('user-1', [medication()], { detail: false, locale: 'en' });
    jest.mocked(Notifications.getPresentedNotificationsAsync).mockRejectedValueOnce(new Error('unsupported'));
    await clearReminders();
    expect(mockScheduled).toEqual([]);
  });

  test('without the notification permission nothing is scheduled and what was is cancelled', async () => {
    await syncReminders('user-1', [medication()], { detail: false, locale: 'en' });
    mockPermission.granted = false;
    await syncReminders('user-1', [medication()], { detail: false, locale: 'en' });
    expect(mockScheduled).toEqual([]);
  });

  test('Android gets a default-importance channel whose lock-screen visibility is private', async () => {
    const platform = Platform.OS;
    Platform.OS = 'android';
    try {
      await syncReminders('user-1', [medication()], { detail: false, locale: 'en' });
    } finally {
      Platform.OS = platform;
    }
    expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
      REMINDER_CHANNEL_ID,
      expect.objectContaining({ importance: 3, lockscreenVisibility: 0, name: translate('en', 'reminder.channel') }),
    );
  });
});

describe('askNotificationPermission', () => {
  test('is true without asking when already granted', async () => {
    expect(await askNotificationPermission()).toBe(true);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  test('asks when the system still can, and does not when the denial is permanent', async () => {
    mockPermission.granted = false;
    expect(await askNotificationPermission()).toBe(true);
    expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    mockPermission.canAskAgain = false;
    expect(await askNotificationPermission()).toBe(false);
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });
});
