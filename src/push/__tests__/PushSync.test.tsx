jest.mock('../pushRegistration', () => ({
  flushPendingUnregister: jest.fn(() => Promise.resolve()),
  registerPush: jest.fn(() => Promise.resolve('saved')),
}));

import { render, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';

import { PushSync } from '../PushSync';
import { flushPendingUnregister, registerPush } from '../pushRegistration';

const mocked = jest.mocked(Notifications);

beforeEach(() => {
  jest.clearAllMocks();
});

test('at launch it unregisters what a sign-out left, then registers when the permission is granted', async () => {
  await render(<PushSync userId="user-1" />);

  await waitFor(() => {
    expect(registerPush).toHaveBeenCalledWith('user-1', 'en');
  });
  expect(flushPendingUnregister).toHaveBeenCalled();
  expect(jest.mocked(flushPendingUnregister).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(registerPush).mock.invocationCallOrder[0] ?? 0);
});

test('without the permission it never registers, so it never prompts', async () => {
  mocked.getPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: true } as Notifications.NotificationPermissionsStatus);

  await render(<PushSync userId="user-1" />);

  await waitFor(() => {
    expect(mocked.getPermissionsAsync).toHaveBeenCalled();
  });
  expect(registerPush).not.toHaveBeenCalled();
  expect(mocked.requestPermissionsAsync).not.toHaveBeenCalled();
});
