import { act, render } from '@testing-library/react-native';

import { READY_PROFILE, resetAuth, setAuth } from '../../test/authMock';
import { clearLocalDb } from '../../test/localDbTest';
import { ReminderSync } from '../ReminderSync';
import { saveMedication } from '../medicationStore';
import type { MedicationInput } from '../medicationStore';
import { clearReminders, syncReminders } from '../reminders';

jest.mock('expo-sqlite', () => require('../../test/sqliteNode'));
jest.mock('../../auth/AuthProvider', () => require('../../test/authMock'));
jest.mock('../reminders', () => ({
  syncReminders: jest.fn(() => Promise.resolve()),
  clearReminders: jest.fn(() => Promise.resolve()),
  onPermissionGranted: () => () => undefined,
}));
let mockResume: () => void = () => undefined;
jest.mock('../../lib/useOnResume', () => ({
  useOnResume: (callback: () => void) => {
    mockResume = callback;
  },
}));

const ID = '00000000-0000-4000-8000-0000000000b1';
const PREVENTIVE: MedicationInput = {
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
};

beforeEach(() => {
  jest.clearAllMocks();
  clearLocalDb();
  resetAuth();
});

const lastCall = (): unknown[] => jest.mocked(syncReminders).mock.calls.at(-1) ?? [];

test('syncs on mount with the user’s medications and the lock-screen setting', async () => {
  saveMedication('user-1', ID, PREVENTIVE);
  await render(<ReminderSync userId="user-1" />);

  expect(syncReminders).toHaveBeenCalledTimes(1);
  const [userId, meds, options] = lastCall();
  expect(userId).toBe('user-1');
  expect(meds).toEqual([expect.objectContaining({ id: ID, name: 'Propranolol' })]);
  expect(options).toEqual({ detail: false, locale: 'en' });
});

test('syncs again on a medication change, a resume and a change of the lock-screen detail', async () => {
  await render(<ReminderSync userId="user-1" />);
  expect(syncReminders).toHaveBeenCalledTimes(1);

  await act(async () => {
    saveMedication('user-1', ID, PREVENTIVE);
    await Promise.resolve();
  });
  expect(syncReminders).toHaveBeenCalledTimes(2);

  await act(() => {
    mockResume();
  });
  expect(syncReminders).toHaveBeenCalledTimes(3);

  await act(() => {
    setAuth({ profile: { ...READY_PROFILE, lockScreenDetail: true } });
  });
  expect(lastCall()[2]).toEqual({ detail: true, locale: 'en' });
});

test('archiving a medication syncs without it', async () => {
  saveMedication('user-1', ID, PREVENTIVE);
  await render(<ReminderSync userId="user-1" />);
  await act(async () => {
    saveMedication('user-1', ID, { ...PREVENTIVE, archived: true });
    await Promise.resolve();
  });
  expect(lastCall()[1]).toEqual([]);
});

test('unmounting, as a sign-out does, clears every reminder', async () => {
  const view = await render(<ReminderSync userId="user-1" />);
  expect(clearReminders).not.toHaveBeenCalled();
  await view.unmount();
  expect(clearReminders).toHaveBeenCalledTimes(1);
});

test('a failing sync does not crash the tree', async () => {
  jest.mocked(syncReminders).mockRejectedValueOnce(new Error('native'));
  await render(<ReminderSync userId="user-1" />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(syncReminders).toHaveBeenCalledTimes(1);
});
