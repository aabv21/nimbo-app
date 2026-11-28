import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { policyUrl } from '../account/consent';
import Profile from '../app/(tabs)/profile';
import { translate } from '../i18n';
import { translatePlural } from '../i18n/plural';
import type { MessageKey } from '../i18n';
import { fetchAgentNotes } from '../memory/agentNotesRepository';
import { setAiConsent, updateProfile } from '../profile/profileRepository';
import { READY_PROFILE, currentAuth, resetAuth } from '../test/authMock';

jest.mock('../auth/AuthProvider', () => require('../test/authMock'));
// The cabinet row counts medications from the local store.
jest.mock('expo-sqlite', () => require('../test/sqliteNode'));
// Focus runs once, on mount: a second press before the screen is focused again is dropped.
jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useFocusEffect: (effect: () => void) => {
    jest.requireActual<typeof import('react')>('react').useEffect(() => {
      effect();
    }, []);
  },
}));
// The notes row counts the agent's notes, read online.
jest.mock('../memory/agentNotesRepository', () => ({
  ...jest.requireActual<typeof import('../memory/agentNotesRepository')>('../memory/agentNotesRepository'),
  fetchAgentNotes: jest.fn(),
}));
jest.mock('../lib/supabase', () => ({ supabase: {} }));
jest.mock('../profile/profileRepository', () => ({ updateProfile: jest.fn(), setAiConsent: jest.fn() }));
// The sync banner's counts, which a test sets to have records still waiting to upload.
const mockSync = { pending: 0, failed: 0, syncing: false, retry: jest.fn() };
jest.mock('../lib/sync/SyncProvider', () => ({ useSyncState: () => mockSync }));
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
    resetPreference: (next: string = 'system') => {
      preference = next;
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
  mockSync.pending = 0;
  mockSync.failed = 0;
  mockedUpdate.mockImplementation((changes) => Promise.resolve({ ok: true, value: { ...READY_PROFILE, ...changes } }));
  mockedConsent.mockImplementation((enabled) => Promise.resolve({ ok: true, value: { ...READY_PROFILE, aiEnabled: enabled } }));
  jest.mocked(fetchAgentNotes).mockResolvedValue({ ok: true, value: [] });
});

test('choosing Português saves the language and the screen re-renders in Portuguese', async () => {
  await render(<Profile />);
  expect(screen.getByRole('header', { name: t('profile.title') })).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('radio', { name: 'Português' }));

  expect(mockSetPreference).toHaveBeenCalledWith('pt');
  expect(mockedUpdate).toHaveBeenCalledWith({ language: 'pt' });
  expect(await screen.findByRole('header', { name: translate('pt', 'profile.title') })).toBeOnTheScreen();
});

test('"What I know about you" counts the notes with the AI off too, and opens once per visit', async () => {
  resetAuth({ profile: { ...READY_PROFILE, aiEnabled: false } });
  jest.mocked(fetchAgentNotes).mockResolvedValue({
    ok: true,
    value: [
      { id: 'n2', text: 'Works night shifts on Thursdays', createdAt: '2026-11-20T10:00:00Z' },
      { id: 'n1', text: 'Prefers short answers', createdAt: '2026-11-10T10:00:00Z' },
    ],
  });
  await render(<Profile />);

  expect(await screen.findByText(translatePlural('en', 'profile.memory.count', 2))).toBeOnTheScreen();
  expect(screen.getByText(t('profile.memory'))).toBeOnTheScreen();
  const row = screen.getByTestId('profile-memory');
  await fireEvent.press(row);
  await fireEvent.press(row);

  const { router } = jest.requireMock<{ router: { push: jest.Mock } }>('expo-router');
  expect(router.push).toHaveBeenCalledTimes(1);
  expect(router.push).toHaveBeenCalledWith('/memory');
});

test('"Your data" opens the export, the privacy policy in the UI language and, set apart after Sign out, the deletion', async () => {
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  await render(<Profile />);
  const { router } = jest.requireMock<{ router: { push: jest.Mock } }>('expo-router');

  expect(screen.getByRole('header', { name: t('profile.sec.data') })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: t('profile.export') }));
  expect(router.push).toHaveBeenCalledWith('/export');

  await fireEvent.press(screen.getByRole('link', { name: t('profile.privacy') }));
  await fireEvent.press(screen.getByRole('link', { name: t('profile.privacy') }));
  expect(openURL).toHaveBeenCalledTimes(2);
  expect(openURL).toHaveBeenCalledWith(policyUrl('en'));

  const buttons = screen.getAllByRole('button').map((element) => element.props.accessibilityLabel as unknown);
  expect(buttons.indexOf(t('profile.delete'))).toBeGreaterThan(buttons.indexOf(t('profile.signOut')));
  await fireEvent.press(screen.getByTestId('profile-delete'));
  expect(router.push).toHaveBeenCalledWith('/delete-account');
  openURL.mockRestore();
});

test('one note reads in the singular', async () => {
  jest.mocked(fetchAgentNotes).mockResolvedValue({
    ok: true,
    value: [{ id: 'n1', text: 'Prefers short answers', createdAt: '2026-11-10T10:00:00Z' }],
  });
  await render(<Profile />);

  expect(await screen.findByText(translatePlural('en', 'profile.memory.count', 1))).toBeOnTheScreen();
  expect(translatePlural('en', 'profile.memory.count', 1)).toBe('1 note');
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

test('the lock-screen detail and period switches save their change, both off by default', async () => {
  await render(<Profile />);
  const detail = screen.getByRole('switch', { name: t('profile.lock_detail') });
  const period = screen.getByRole('switch', { name: t('profile.period') });
  expect(detail).not.toBeChecked();
  expect(period).not.toBeChecked();

  await fireEvent.press(detail);
  expect(mockedUpdate).toHaveBeenCalledWith({ lockScreenDetail: true });
  await fireEvent.press(period);
  expect(mockedUpdate).toHaveBeenCalledWith({ trackPeriod: true });
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
  // Turning it off shares nothing, so the transfer is not repeated.
  expect(screen.queryByText(t('consent.transfer'))).not.toBeOnTheScreen();
  expect(mockedConsent).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByRole('button', { name: t('common.confirm') }));
  await waitFor(() => {
    expect(currentAuth().profile?.aiEnabled).toBe(false);
  });
  expect(mockedConsent).toHaveBeenCalledTimes(1);
  expect(mockedConsent).toHaveBeenCalledWith(false, 'en');
  // The answer's version reaches the profile too, so the gate does not ask for this text again.
  expect(currentAuth().profile?.aiConsentVersion).toBe(READY_PROFILE.aiConsentVersion);
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
  // The same facts as the consent screen, the US transfer included, with its policy section.
  expect(screen.getByText(t('consent.sent.body'))).toBeOnTheScreen();
  expect(screen.getByText(t('consent.transfer'))).toBeOnTheScreen();
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  await fireEvent.press(screen.getByRole('link', { name: t('consent.policy_link') }));
  expect(openURL).toHaveBeenCalledWith(policyUrl('en', 'ai'));
  expect(mockedConsent).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByRole('button', { name: t('consent.accept') }));
  await waitFor(() => {
    expect(currentAuth().profile?.aiEnabled).toBe(true);
  });
  expect(mockedConsent).toHaveBeenCalledWith(true, 'en');
});

test('a pending AI re-consent: the switch stays on (a withdrawal still works) and a notice opens the AI screen', async () => {
  resetAuth({ profile: { ...READY_PROFILE, aiEnabled: true, aiConsentVersion: '2026-11-01' } });
  await render(<Profile />);
  expect(screen.getByRole('switch', { name: t('profile.companion.switch') })).toBeChecked();
  expect(screen.getByText(t('consent.paused'))).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: t('companion.reconsent.open') }));
  const { router } = jest.requireMock<{ router: { push: jest.Mock } }>('expo-router');
  expect(router.push).toHaveBeenCalledWith('/ai-consent');
});

test('with the AI answered to this build\'s text, no paused notice', async () => {
  await render(<Profile />);
  expect(screen.queryByText(t('consent.paused'))).not.toBeOnTheScreen();
});

test('the AI switch records the answer in the UI language', async () => {
  jest.requireMock<{ resetPreference: (next: string) => void }>('../i18n/I18nProvider').resetPreference('pt');
  resetAuth({ profile: { ...READY_PROFILE, aiEnabled: false } });
  await render(<Profile />);

  await fireEvent.press(screen.getByRole('switch', { name: translate('pt', 'profile.companion.switch') }));
  await fireEvent.press(screen.getByRole('button', { name: translate('pt', 'consent.accept') }));
  await waitFor(() => {
    expect(mockedConsent).toHaveBeenCalledWith(true, 'pt');
  });
});

test('the account shows the email, and with nothing waiting to upload Sign out signs out at once', async () => {
  await render(<Profile />);
  expect(screen.getByText(t('profile.signedInAs', { email: 'user-1@example.com' }))).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: t('profile.signOut') }));
  expect(mockSignOut).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: t('common.cancel') })).not.toBeOnTheScreen();
});

describe('signing out with records not uploaded yet', () => {
  const warning = (n: number): string => translatePlural('en', 'profile.signOut.pending', n);

  test('asks first, counting the pending and the failed ones, and Sign out then signs out', async () => {
    mockSync.pending = 2;
    mockSync.failed = 1;
    await render(<Profile />);

    await fireEvent.press(screen.getByRole('button', { name: t('profile.signOut') }));
    expect(mockSignOut).not.toHaveBeenCalled();
    expect(screen.getByText(warning(3))).toBeOnTheScreen();
    expect(warning(3)).toContain('3 records');

    await fireEvent.press(screen.getByRole('button', { name: t('profile.signOut') }));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  test('one record reads in the singular', async () => {
    mockSync.pending = 1;
    await render(<Profile />);
    await fireEvent.press(screen.getByRole('button', { name: t('profile.signOut') }));
    expect(screen.getByText(warning(1))).toBeOnTheScreen();
    expect(warning(1)).not.toBe(warning(2));
  });

  test('Cancel keeps the user signed in and puts the button back', async () => {
    mockSync.pending = 1;
    await render(<Profile />);
    await fireEvent.press(screen.getByRole('button', { name: t('profile.signOut') }));
    await fireEvent.press(screen.getByRole('button', { name: t('common.cancel') }));

    expect(mockSignOut).not.toHaveBeenCalled();
    expect(screen.queryByText(warning(1))).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: t('profile.signOut') })).toBeOnTheScreen();
  });
});
