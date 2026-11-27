import { act, render } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';

import { resetAuth } from '../../test/authMock';
import { clearLocalDb } from '../../test/localDbTest';
import { saveMedication } from '../medicationStore';
import { ReminderSync } from '../ReminderSync';
import { askNotificationPermission } from '../reminders';

jest.mock('expo-sqlite', () => require('../../test/sqliteNode'));
jest.mock('../../auth/AuthProvider', () => require('../../test/authMock'));
// No resume or network event ever arrives in this suite: only the permission answer can trigger the second sync.
jest.mock('../../lib/useOnResume', () => ({ useOnResume: () => undefined }));

const mockOs = { granted: false, scheduled: [] as string[] };

jest.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DAILY: 'daily', DATE: 'date' },
  AndroidImportance: { DEFAULT: 3 },
  AndroidNotificationVisibility: { PRIVATE: 0 },
  IosAuthorizationStatus: { PROVISIONAL: 3 },
  setNotificationChannelAsync: jest.fn(() => Promise.resolve(null)),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: mockOs.granted, canAskAgain: true })),
  // The user taps Allow: the OS now reports the permission.
  requestPermissionsAsync: jest.fn(() => {
    mockOs.granted = true;
    return Promise.resolve({ granted: true, canAskAgain: true });
  }),
  getAllScheduledNotificationsAsync: jest.fn(() =>
    Promise.resolve(mockOs.scheduled.map((identifier) => ({ identifier, content: {}, trigger: null }))),
  ),
  cancelScheduledNotificationAsync: jest.fn((identifier: string) => {
    mockOs.scheduled = mockOs.scheduled.filter((id) => id !== identifier);
    return Promise.resolve();
  }),
  scheduleNotificationAsync: jest.fn((request: { identifier: string }) => {
    mockOs.scheduled.push(request.identifier);
    return Promise.resolve(request.identifier);
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  clearLocalDb();
  resetAuth();
  mockOs.granted = false;
  mockOs.scheduled = [];
});

test('the first scheduled medication gets its reminder as soon as the permission is granted, with no resume', async () => {
  await render(<ReminderSync userId="user-1" />);

  // The cabinet form saves, then asks.
  await act(async () => {
    saveMedication('user-1', '00000000-0000-4000-8000-0000000000c1', {
      name: 'Propranolol',
      kind: 'preventive',
      form: 'oral',
      medicationClass: 'other',
      doseText: null,
      minIntervalHours: null,
      schedule: 'daily',
      scheduleTime: '08:00:00',
      scheduleAnchor: null,
      archived: false,
    });
    await Promise.resolve();
  });
  // Without the permission the sync scheduled nothing.
  expect(mockOs.scheduled).toEqual([]);

  await act(async () => {
    expect(await askNotificationPermission('en')).toBe(true);
  });

  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  expect(mockOs.scheduled).toEqual(['preventive-reminder:user-1:00000000-0000-4000-8000-0000000000c1:0']);
});
