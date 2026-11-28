jest.mock('expo-router', () => ({ router: { navigate: jest.fn() } }));

import { act, render } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';

import { PushTapSync } from '../PushTapSync';

const mocked = jest.mocked(Notifications);

function tap(data: Record<string, unknown>, actionIdentifier = Notifications.DEFAULT_ACTION_IDENTIFIER): Notifications.NotificationResponse {
  return { actionIdentifier, notification: { request: { content: { data } } } } as unknown as Notifications.NotificationResponse;
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('a signal push tap that launched the app opens Today and is cleared', async () => {
  mocked.getLastNotificationResponse.mockReturnValueOnce(tap({ url: '/today', signalId: 'signal-1' }));

  await render(<PushTapSync />);

  expect(router.navigate).toHaveBeenCalledWith('/today');
  expect(mocked.clearLastNotificationResponse).toHaveBeenCalled();
});

test('a tap while the app runs opens Today; the listener goes away on unmount', async () => {
  const remove = jest.fn();
  let listener: ((response: Notifications.NotificationResponse) => void) | undefined;
  mocked.addNotificationResponseReceivedListener.mockImplementationOnce((callback) => {
    listener = callback;
    return { remove };
  });
  const view = await render(<PushTapSync />);

  await act(() => {
    listener?.(tap({ url: '/today', signalId: 'signal-1' }));
  });

  expect(router.navigate).toHaveBeenCalledWith('/today');
  await view.unmount();
  expect(remove).toHaveBeenCalled();
});

test.each([
  ['another url, even a real route', tap({ url: '/episode/x' })],
  ['a preventive reminder (its data is empty)', tap({})],
  ['a claim code', tap({ type: 'push-claim', code: 'K7M2P9QX' })],
  ['an action button rather than the push itself', tap({ url: '/today' }, 'snooze')],
])('ignores %s', async (_label, response) => {
  mocked.getLastNotificationResponse.mockReturnValueOnce(response);

  await render(<PushTapSync />);

  expect(router.navigate).not.toHaveBeenCalled();
  expect(mocked.clearLastNotificationResponse).not.toHaveBeenCalled();
});
