import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';

import { translate } from '../../i18n';
import type { MessageKey } from '../../i18n';
import { registerPush } from '../../push/pushRegistration';
import { writeLastOutcome } from '../../push/pushStore';
import { NotificationSettings } from '../NotificationSettings';
import { updateProfile } from '../profileRepository';
import { READY_PROFILE, resetAuth } from '../../test/authMock';

jest.mock('../../auth/AuthProvider', () => require('../../test/authMock'));
jest.mock('../profileRepository', () => ({ updateProfile: jest.fn() }));
jest.mock('../../push/pushRegistration', () => ({ registerPush: jest.fn(() => Promise.resolve('saved')) }));

const t = (key: MessageKey): string => translate('en', key);
const mocked = jest.mocked(Notifications);
const mockedUpdate = jest.mocked(updateProfile);

function permission(status: { status: 'denied' | 'undetermined'; canAskAgain?: boolean }): void {
  mocked.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true, ...status } as unknown as Notifications.NotificationPermissionsStatus);
}

beforeEach(() => {
  jest.clearAllMocks();
  resetAuth();
  writeLastOutcome(null);
  mocked.getPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true } as Notifications.NotificationPermissionsStatus);
  mockedUpdate.mockImplementation((changes) => Promise.resolve({ ok: true, value: { ...READY_PROFILE, ...changes } }));
});

test('changing the cap to 0 saves notifyDailyCap 0', async () => {
  await render(<NotificationSettings userId="user-1" />);

  await fireEvent.press(screen.getByRole('radio', { name: t('notif.cap.value.zero') }));

  expect(mockedUpdate).toHaveBeenCalledWith({ notifyDailyCap: 0 });
});

test('equal start and end shows that no notifications are sent', async () => {
  resetAuth({ profile: { ...READY_PROFILE, notifyStart: '08:00:00', notifyEnd: '08:00:00' } });

  await render(<NotificationSettings userId="user-1" />);

  expect(screen.getByText(t('notif.hours.empty'))).toBeOnTheScreen();
});

test('different hours show no such line, and picking a start time saves it', async () => {
  await render(<NotificationSettings userId="user-1" />);
  expect(screen.queryByText(t('notif.hours.empty'))).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByTestId('notif-hours-start'));
  const picker = screen.getByTestId('datetimepicker');
  await fireEvent(picker, 'onValueChange', {}, new Date(2000, 0, 1, 7, 0));
  await fireEvent(picker, 'onValueChange', {}, new Date(2000, 0, 1, 7, 30));
  // The wheel's settles save nothing; closing the spinner saves its last time once.
  expect(mockedUpdate).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('notif-hours-start-done'));

  expect(mockedUpdate).toHaveBeenCalledTimes(1);
  expect(mockedUpdate).toHaveBeenCalledWith({ notifyStart: '07:30:00' });
  expect(screen.queryByTestId('datetimepicker')).not.toBeOnTheScreen();
});

test('an end time spun and closed by tapping the field again saves once; one left unchanged saves nothing', async () => {
  await render(<NotificationSettings userId="user-1" />);

  await fireEvent.press(screen.getByTestId('notif-hours-end'));
  await fireEvent.press(screen.getByTestId('notif-hours-end'));
  expect(mockedUpdate).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId('notif-hours-end'));
  await fireEvent(screen.getByTestId('datetimepicker'), 'onValueChange', {}, new Date(2000, 0, 1, 22, 15));
  await fireEvent.press(screen.getByTestId('notif-hours-end'));
  expect(mockedUpdate).toHaveBeenCalledWith({ notifyEnd: '22:15:00' });
});

test('leaving the screen with the spinner open still saves the time it shows', async () => {
  const view = await render(<NotificationSettings userId="user-1" />);

  await fireEvent.press(screen.getByTestId('notif-hours-start'));
  await fireEvent(screen.getByTestId('datetimepicker'), 'onValueChange', {}, new Date(2000, 0, 1, 6, 45));
  await view.unmount();

  expect(mockedUpdate).toHaveBeenCalledWith({ notifyStart: '06:45:00' });
});

test('a claim in progress says this phone is being checked', async () => {
  writeLastOutcome('verifying');

  await render(<NotificationSettings userId="user-1" />);

  expect(await screen.findByText(t('notif.verifying'))).toBeOnTheScreen();
});

test('a denied permission shows that notifications are off and the allow button, which registers', async () => {
  permission({ status: 'denied', canAskAgain: true });

  await render(<NotificationSettings userId="user-1" />);

  expect(await screen.findByText(t('notif.denied'))).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: t('onb.notif.allow') }));
  expect(registerPush).toHaveBeenCalledWith('user-1', 'en');
});

test('a permission never asked shows the allow button without the "off" line', async () => {
  permission({ status: 'undetermined' });

  await render(<NotificationSettings userId="user-1" />);

  expect(await screen.findByRole('button', { name: t('onb.notif.allow') })).toBeOnTheScreen();
  expect(screen.queryByText(t('notif.denied'))).not.toBeOnTheScreen();
});

test('granted with no token on this build says notifications aren’t available yet', async () => {
  writeLastOutcome('unavailable');

  await render(<NotificationSettings userId="user-1" />);

  expect(await screen.findByText(t('notif.unavailable'))).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: t('onb.notif.allow') })).not.toBeOnTheScreen();
});

test('the lock-screen switch writes lockScreenDetail', async () => {
  await render(<NotificationSettings userId="user-1" />);

  await fireEvent.press(screen.getByRole('switch', { name: t('profile.lock_detail') }));

  expect(mockedUpdate).toHaveBeenCalledWith({ lockScreenDetail: true });
});

test('a failed save shows the error and puts the value back', async () => {
  mockedUpdate.mockResolvedValueOnce({ ok: false, kind: 'network' });

  await render(<NotificationSettings userId="user-1" />);
  await fireEvent.press(screen.getByRole('radio', { name: '1' }));

  await waitFor(() => {
    expect(screen.getByText(t('error.network'))).toBeOnTheScreen();
  });
  expect(screen.getByRole('radio', { name: '2' })).toBeChecked();
});
