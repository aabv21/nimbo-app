import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import Profile from '../app/(tabs)/profile';
import { translate } from '../i18n';
import type { MessageKey } from '../i18n';
import { setAiConsent, updateProfile } from '../profile/profileRepository';
import { READY_PROFILE, currentAuth, resetAuth } from '../test/authMock';

jest.mock('../auth/AuthProvider', () => require('../test/authMock'));
// The cabinet row counts medications from the local store.
jest.mock('expo-sqlite', () => require('../test/sqliteNode'));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('../profile/profileRepository', () => ({ updateProfile: jest.fn(), setAiConsent: jest.fn() }));
const mockSignOut = jest.fn();
jest.mock('../auth/useSignOut', () => ({
  useSignOut: () => ({ signOut: mockSignOut, signingOut: false, error: undefined }),
}));
// The real hook keeps the preference in a context; this one keeps it in a module store so the test can watch the call.
const mockSetPreference = jest.fn();
jest.mock('../i18n/I18nProvider', () => {
  const actual = jest.requireActual<typeof import('../i18n/I18nProvider')>('../i18n/I18nProvider');
  const { useSyncExternalStore } = jest.requireActual<typeof import('react')>('react');
  let preference: string = 'system';
  const listeners = new Set<() => void>();
  return {
    ...actual,
    resetPreference: () => {
      preference = 'system';
    },
    useLocalePreference: () => {
      const current = useSyncExternalStore(
        (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        () => preference,
      );
      return {
        preference: current,
        setPreference: (next: string) => {
          mockSetPreference(next);
          preference = next;
          for (const listener of listeners) listener();
          return Promise.resolve();
        },
      };
    },
  };
});

const t = (key: MessageKey, params?: Record<string, string>): string => translate('en', key, params);
const mockedUpdate = jest.mocked(updateProfile);
const mockedConsent = jest.mocked(setAiConsent);

beforeEach(() => {
  jest.clearAllMocks();
  jest.requireMock<{ resetPreference: () => void }>('../i18n/I18nProvider').resetPreference();
  resetAuth();
  mockedUpdate.mockImplementation((changes) => Promise.resolve({ ok: true, value: { ...READY_PROFILE, ...changes } }));
  mockedConsent.mockImplementation((enabled) => Promise.resolve({ ok: true, value: { ...READY_PROFILE, aiEnabled: enabled } }));
});

test('choosing Português saves the language and the screen re-renders in Portuguese', async () => {
  await render(<Profile />);
  expect(screen.getByRole('header', { name: t('profile.title') })).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('radio', { name: 'Português' }));

  expect(mockSetPreference).toHaveBeenCalledWith('pt');
  expect(mockedUpdate).toHaveBeenCalledWith({ language: 'pt' });
  expect(await screen.findByRole('header', { name: translate('pt', 'profile.title') })).toBeOnTheScreen();
});

test('appearance offers Automatic, Light, Dark and Dim, and Dark applies at once and is saved', async () => {
  await render(<Profile />);
  for (const key of ['profile.appearance.system', 'profile.appearance.day', 'profile.appearance.dark', 'profile.appearance.dim'] as const) {
    expect(screen.getByRole('radio', { name: t(key) })).toBeOnTheScreen();
  }
  // Pending, so only the optimistic change can have re-themed the app.
  mockedUpdate.mockReturnValueOnce(new Promise(() => undefined));

  await fireEvent.press(screen.getByRole('radio', { name: t('profile.appearance.dark') }));

  expect(mockedUpdate).toHaveBeenCalledWith({ theme: 'dark' });
  expect(currentAuth().profile?.theme).toBe('dark');
  expect(screen.getByRole('radio', { name: t('profile.appearance.dark') })).toBeChecked();
});

test('a failed save puts the appearance back and says so', async () => {
  mockedUpdate.mockResolvedValueOnce({ ok: false, kind: 'network' });
  await render(<Profile />);

  await fireEvent.press(screen.getByRole('radio', { name: t('profile.appearance.dim') }));

  expect(await screen.findByText(t('error.network'))).toBeOnTheScreen();
  expect(currentAuth().profile?.theme).toBe('day');
});

test('the reduce-motion switch saves the change', async () => {
  await render(<Profile />);
  await fireEvent.press(screen.getByRole('switch', { name: t('profile.reduceMotion') }));
  expect(mockedUpdate).toHaveBeenCalledWith({ reduceMotion: true });
});

test('turning the AI off asks first, then records false', async () => {
  await render(<Profile />);
  const toggle = screen.getByRole('switch', { name: t('profile.companion.switch') });
  expect(toggle).toBeChecked();

  // The confirmation repeats the switch's own sub-line, so it shows the text a second time.
  expect(screen.getAllByText(t('profile.companion.confirmOff'))).toHaveLength(1);
  await fireEvent.press(toggle);
  expect(screen.getAllByText(t('profile.companion.confirmOff'))).toHaveLength(2);
  expect(mockedConsent).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByRole('button', { name: t('common.confirm') }));
  await waitFor(() => {
    expect(currentAuth().profile?.aiEnabled).toBe(false);
  });
  expect(mockedConsent).toHaveBeenCalledTimes(1);
  expect(mockedConsent).toHaveBeenCalledWith(false);
});

test('cancelling the confirmation keeps the AI on', async () => {
  await render(<Profile />);
  await fireEvent.press(screen.getByRole('switch', { name: t('profile.companion.switch') }));
  await fireEvent.press(screen.getByRole('button', { name: t('common.cancel') }));

  expect(mockedConsent).not.toHaveBeenCalled();
  expect(screen.getAllByText(t('profile.companion.confirmOff'))).toHaveLength(1);
  expect(screen.queryByRole('button', { name: t('common.confirm') })).not.toBeOnTheScreen();
});

test('turning the AI on shows the consent text before recording true', async () => {
  resetAuth({ profile: { ...READY_PROFILE, aiEnabled: false } });
  await render(<Profile />);

  await fireEvent.press(screen.getByRole('switch', { name: t('profile.companion.switch') }));
  expect(screen.getByText(t('profile.companion.confirmOn'))).toBeOnTheScreen();
  expect(mockedConsent).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByRole('button', { name: t('consent.accept') }));
  await waitFor(() => {
    expect(currentAuth().profile?.aiEnabled).toBe(true);
  });
  expect(mockedConsent).toHaveBeenCalledWith(true);
});

test('the account shows the email, and Sign out calls the sign-out hook', async () => {
  await render(<Profile />);
  expect(screen.getByText(t('profile.signedInAs', { email: 'user-1@example.com' }))).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: t('profile.signOut') }));
  expect(mockSignOut).toHaveBeenCalledTimes(1);
});
