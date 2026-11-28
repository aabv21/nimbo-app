// "Delete my account": an explicit acknowledgement before the danger button, and each failure's message.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert, BackHandler } from 'react-native';

import { runDeletion } from '../account/deletionFlow';
import DeleteAccount from '../app/delete-account';
import { translate } from '../i18n';
import type { MessageKey } from '../i18n';
import { resetAuth } from '../test/authMock';

jest.mock('../auth/AuthProvider', () => require('../test/authMock'));
jest.mock('../lib/sync/SyncProvider', () => require('../test/syncMock'));
// The screen's options are recorded, so a test can read whether the back swipe is on.
const mockScreenOptions: { gestureEnabled?: boolean }[] = [];
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  Stack: {
    Screen: ({ options }: { options: { gestureEnabled?: boolean } }) => {
      mockScreenOptions.push(options);
      return null;
    },
  },
}));
jest.mock('../lib/supabase', () => ({ supabase: {}, readStoredSession: () => null }));
jest.mock('../account/deletionFlow', () => ({
  ...jest.requireActual<typeof import('../account/deletionFlow')>('../account/deletionFlow'),
  runDeletion: jest.fn(),
}));

const t = (key: MessageKey): string => translate('en', key);
const mockedRun = jest.mocked(runDeletion);

function deleteButton(): ReturnType<typeof screen.getByTestId> {
  return screen.getByTestId('delete-run');
}

beforeEach(() => {
  jest.clearAllMocks();
  resetAuth();
  mockedRun.mockResolvedValue('deleted');
});

test('says what is deleted, and the danger button is a button with its full label, disabled until the box is ticked', async () => {
  await render(<DeleteAccount />);

  expect(screen.getByRole('header', { name: t('delete.title') })).toBeOnTheScreen();
  expect(screen.getByText(t('delete.body'))).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: t('delete.cta') })).toBe(deleteButton());
  expect(deleteButton()).toBeDisabled();
  await fireEvent.press(deleteButton());
  expect(mockedRun).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByRole('checkbox', { name: t('delete.confirm') }));

  expect(deleteButton()).toBeEnabled();
  await fireEvent.press(deleteButton());
  const [userId, outbox] = mockedRun.mock.calls[0] ?? [];
  expect(userId).toBe('user-1');
  expect(typeof outbox?.pause).toBe('function');
});

test('a network failure shows its message and keeps the screen', async () => {
  mockedRun.mockResolvedValue('network');
  await render(<DeleteAccount />);

  await fireEvent.press(screen.getByTestId('delete-confirm'));
  await fireEvent.press(deleteButton());

  await waitFor(() => {
    expect(screen.getByText(t('delete.error.network'))).toBeOnTheScreen();
  });
  expect(deleteButton()).toBeEnabled();
});

test('reauth is an alert, since the sign-out takes the screen away', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  mockedRun.mockResolvedValue('reauth');
  await render(<DeleteAccount />);

  await fireEvent.press(screen.getByTestId('delete-confirm'));
  await fireEvent.press(deleteButton());

  await waitFor(() => {
    expect(alert).toHaveBeenCalledWith(t('delete.error.reauth'));
  });
  alert.mockRestore();
});

test('the export link opens the export screen first', async () => {
  await render(<DeleteAccount />);

  await fireEvent.press(screen.getByRole('button', { name: t('delete.export_first') }));

  expect(router.push).toHaveBeenCalledWith('/export');
});

test('while the deletion runs the screen cannot be left: back disabled, no swipe, Android back swallowed', async () => {
  let finish: (value: 'network') => void = () => undefined;
  mockedRun.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const addListener = jest.spyOn(BackHandler, 'addEventListener');
  await render(<DeleteAccount />);
  expect(mockScreenOptions.at(-1)?.gestureEnabled).toBe(true);

  await fireEvent.press(screen.getByTestId('delete-confirm'));
  await fireEvent.press(deleteButton());

  expect(screen.getByTestId('delete-back')).toBeDisabled();
  expect(mockScreenOptions.at(-1)?.gestureEnabled).toBe(false);
  const handler = addListener.mock.calls.find(([event]) => event === 'hardwareBackPress')?.[1];
  expect(handler?.(undefined as never)).toBe(true);
  await fireEvent.press(screen.getByTestId('delete-back'));
  expect(router.back).not.toHaveBeenCalled();

  finish('network');
  await waitFor(() => {
    expect(screen.getByTestId('delete-back')).toBeEnabled();
  });
  expect(mockScreenOptions.at(-1)?.gestureEnabled).toBe(true);
  addListener.mockRestore();
});
