import { act } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { signOut } from '../auth/authService';
import { translate } from '../i18n';
import { kvRemove } from '../lib/kv';
import { markIntroSeen } from '../onboarding/introSeen';
import { READY_PROFILE, resetAuth, setAuth } from '../test/authMock';

jest.mock('../auth/AuthProvider', () => require('../test/authMock'));
// The root layout's long-attack watch reads the local store.
jest.mock('expo-sqlite', () => require('../test/sqliteNode'));
jest.mock('../lib/sync/SyncProvider', () => require('../test/syncMock'));
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve()),
  hideAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('../auth/authService', () => ({
  signInWithEmail: jest.fn(),
  signInWithApple: jest.fn(),
  signInWithGoogle: jest.fn(),
  resendSignUpCode: jest.fn(),
  signOut: jest.fn(() => Promise.resolve({ ok: true })),
  isGoogleSignInConfigured: jest.fn(() => false),
}));
// Stand-ins for the screens a user must not reach in some states; they count renders and show their name.
const mockRenders = { today: 0, aiConsent: 0, companion: 0 };
jest.mock('../app/(tabs)/today', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    default: () => {
      mockRenders.today += 1;
      return <Text>Today screen</Text>;
    },
  };
});
jest.mock('../app/(tabs)/companion', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    default: () => {
      mockRenders.companion += 1;
      return <Text>Companion screen</Text>;
    },
  };
});
jest.mock('../app/welcome/ai-consent', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    default: () => {
      mockRenders.aiConsent += 1;
      return <Text>AI consent</Text>;
    },
  };
});
// A pass-through that records whether each tab scene appeared still (the tab the shell opened on) or rose in.
const mockScenes: { focused: boolean; still: boolean }[] = [];
jest.mock('../ui/TabScene', () => ({
  TabScene: ({ focused, still, children }: { focused: boolean; still: boolean; children: React.ReactNode }) => {
    mockScenes.push({ focused, still });
    return children;
  },
}));
// The tab shell saves the phone's time zone on mount; that request never answers here.
jest.mock('../profile/profileRepository', () => ({
  acceptTerms: jest.fn(),
  setAiConsent: jest.fn(),
  updateProfile: jest.fn(() => new Promise(() => undefined)),
}));

// expo-router's test helpers replace the Reanimated mock on import with one that lacks what the base
// components use; fill it in from the shared mock before the routes load (they load lazily).
const reanimated = jest.requireMock<object>('react-native-reanimated');
Object.assign(reanimated, jest.requireActual<object>('../test/reanimatedMock'));
Object.defineProperty(reanimated, '__esModule', { value: true });

test('signed out on a phone that never saw the intro, the root layout opens it', async () => {
  kvRemove('intro.seen');
  resetAuth({ status: 'signedOut', userId: null, profile: null });
  await renderRouter('./src/app', { initialUrl: '/' });
  expect(await screen.findByRole('header', { name: translate('en', 'onb.value1.title') })).toBeOnTheScreen();
});

test('signed out once the intro was seen, the root layout lands on the sign-in screen', async () => {
  markIntroSeen();
  resetAuth({ status: 'signedOut', userId: null, profile: null });
  await renderRouter('./src/app', { initialUrl: '/' });
  expect(await screen.findByRole('header', { name: translate('en', 'auth.signIn.title') })).toBeOnTheScreen();
});

test('a launch that goes straight to sign-in cancels the preventive reminders a sign-out left behind', async () => {
  const left = (identifier: string): Notifications.NotificationRequest =>
    ({ identifier, content: { title: 'Nimbo', body: '' }, trigger: null }) as Notifications.NotificationRequest;
  jest
    .mocked(Notifications.getAllScheduledNotificationsAsync)
    .mockResolvedValueOnce([left('preventive-reminder:user-1:med-1:0'), left('something-else')]);
  markIntroSeen();
  resetAuth({ status: 'signedOut', userId: null, profile: null });
  await renderRouter('./src/app', { initialUrl: '/' });
  await screen.findByRole('header', { name: translate('en', 'auth.signIn.title') });

  expect(Notifications.cancelScheduledNotificationAsync).toHaveBeenCalledWith('preventive-reminder:user-1:med-1:0');
  expect(Notifications.cancelScheduledNotificationAsync).not.toHaveBeenCalledWith('something-else');
});

test('signed in without the boundary answered, the layout holds the user on the boundary screen', async () => {
  resetAuth({ profile: { ...READY_PROFILE, adultConfirmedAt: null, boundaryAcceptedAt: null, aiConsentAnsweredAt: null } });
  await renderRouter('./src/app', { initialUrl: '/' });
  expect(await screen.findByRole('header', { name: translate('en', 'boundary.title') })).toBeOnTheScreen();
});

test('signed in with an unreadable profile shows the loading view with a retry, never a consent screen', async () => {
  let finishRead = (): void => undefined;
  const auth = resetAuth({
    profile: null,
    refreshProfile: jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRead = resolve;
        }),
    ),
  });
  await renderRouter('./src/app', { initialUrl: '/' });
  expect(await screen.findByRole('progressbar')).toBeOnTheScreen();
  expect(screen.queryByRole('header', { name: translate('en', 'boundary.title') })).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: translate('en', 'error.retry') }));
  expect(auth.refreshProfile).toHaveBeenCalledTimes(1);
  // Busy while the read is out, so a second tap cannot stack reads; usable again once it settles.
  expect(screen.getByRole('button', { name: translate('en', 'common.loading') })).toBeDisabled();
  await act(async () => {
    finishRead();
    await Promise.resolve();
  });
  expect(screen.getByRole('button', { name: translate('en', 'error.retry') })).toBeEnabled();
});

test('a profile that can never be read still lets the user sign out', async () => {
  resetAuth({ profile: null });
  await renderRouter('./src/app', { initialUrl: '/' });
  await fireEvent.press(await screen.findByRole('button', { name: translate('en', 'profile.signOut') }));
  expect(signOut).toHaveBeenCalledTimes(1);
});

test('while the session itself is unknown, the loading view offers no actions', async () => {
  resetAuth({ status: 'loading', userId: null, profile: null });
  await renderRouter('./src/app', { initialUrl: '/' });
  expect(await screen.findByRole('progressbar')).toBeOnTheScreen();
  expect(screen.queryByRole('button')).not.toBeOnTheScreen();
});

const PENDING = { adultConfirmedAt: null, boundaryAcceptedAt: null, aiConsentAnsweredAt: null };
beforeEach(() => {
  mockRenders.today = 0;
  mockRenders.aiConsent = 0;
  mockRenders.companion = 0;
  mockScenes.length = 0;
});

const boundaryTitle = (): string => translate('en', 'boundary.title');

// `await renderRouter` flushes effects, so a screen that mounted and was then redirected away would look the
// same as one that never mounted. These counters record every render of the guarded screens instead.
test.each(['/today', '/welcome/ai-consent'])('a deep link to %s while the boundary is unanswered never mounts it', async (url) => {
  resetAuth({ profile: { ...READY_PROFILE, ...PENDING } });
  await renderRouter('./src/app', { initialUrl: url });
  expect(await screen.findByRole('header', { name: boundaryTitle() })).toBeOnTheScreen();
  expect(mockRenders.today).toBe(0);
  expect(mockRenders.aiConsent).toBe(0);
});

test('a ready user opening the boundary screen lands on Today', async () => {
  resetAuth();
  await renderRouter('./src/app', { initialUrl: '/welcome/boundary' });
  expect(screen.queryByRole('header', { name: boundaryTitle() })).not.toBeOnTheScreen();
  expect(await screen.findByText('Today screen')).toBeOnTheScreen();
});

test('signing in after mount with the gates pending lands on the boundary', async () => {
  markIntroSeen();
  resetAuth({ status: 'signedOut', userId: null, profile: null });
  await renderRouter('./src/app', { initialUrl: '/' });
  expect(await screen.findByRole('header', { name: translate('en', 'auth.signIn.title') })).toBeOnTheScreen();
  await act(async () => {
    setAuth({ status: 'signedIn', userId: 'user-1', profile: { ...READY_PROFILE, ...PENDING } });
    await Promise.resolve();
  });
  expect(await screen.findByRole('header', { name: boundaryTitle() })).toBeOnTheScreen();
});

test('the loading view leaves when the profile arrives', async () => {
  resetAuth({ profile: null });
  await renderRouter('./src/app', { initialUrl: '/' });
  expect(await screen.findByText(translate('en', 'common.loading'))).toBeOnTheScreen();
  await act(async () => {
    setAuth({ profile: READY_PROFILE });
    await Promise.resolve();
  });
  expect(await screen.findByText('Today screen')).toBeOnTheScreen();
  expect(screen.queryByText(translate('en', 'common.loading'))).not.toBeOnTheScreen();
});

const tabNames = (): string[] => screen.getAllByRole('tab').map((tab) => String(tab.props.accessibilityLabel));

test('with the AI on, the shell shows four tabs and Today is the current one', async () => {
  resetAuth();
  await renderRouter('./src/app', { initialUrl: '/' });
  expect(await screen.findByText('Today screen')).toBeOnTheScreen();
  expect(tabNames()).toEqual(['Today', 'Nimbo', 'History', 'Profile']);
  expect(screen.getByRole('tab', { name: 'Today' })).toBeSelected();
});

test('with the AI declined, the Nimbo tab is gone and the other three work', async () => {
  resetAuth({ profile: { ...READY_PROFILE, aiEnabled: false } });
  await renderRouter('./src/app', { initialUrl: '/' });
  expect(await screen.findByText('Today screen')).toBeOnTheScreen();
  expect(tabNames()).toEqual(['Today', 'History', 'Profile']);

  await fireEvent.press(screen.getByRole('tab', { name: 'History' }));
  expect(await screen.findByRole('header', { name: translate('en', 'history.title') })).toBeOnTheScreen();
  expect(screen.getByRole('tab', { name: 'History' })).toBeSelected();
});

// The layout's scene renderer draws nothing for a route with no trigger, so no screen-level redirect is needed.
test('a deep link to the companion with the AI off lands on Today and never mounts it', async () => {
  resetAuth({ profile: { ...READY_PROFILE, aiEnabled: false } });
  await renderRouter('./src/app', { initialUrl: '/companion' });
  expect(await screen.findByText('Today screen')).toBeOnTheScreen();
  expect(mockRenders.companion).toBe(0);
  // Today is the tab the shell opened on, so it appears as it is rather than rising in.
  const focused = mockScenes.filter((scene) => scene.focused);
  expect(focused.length).toBeGreaterThan(0);
  expect(focused.every((scene) => scene.still)).toBe(true);
});

test('a deep link to the companion with the AI on opens it', async () => {
  resetAuth();
  await renderRouter('./src/app', { initialUrl: '/companion' });
  expect(await screen.findByText('Companion screen')).toBeOnTheScreen();
  expect(screen.getByRole('tab', { name: 'Nimbo' })).toBeSelected();
});

test('turning the AI on adds the Nimbo tab', async () => {
  resetAuth({ profile: { ...READY_PROFILE, aiEnabled: false } });
  await renderRouter('./src/app', { initialUrl: '/' });
  expect(await screen.findByText('Today screen')).toBeOnTheScreen();
  await act(async () => {
    setAuth({ profile: READY_PROFILE });
    await Promise.resolve();
  });
  expect(tabNames()).toEqual(['Today', 'Nimbo', 'History', 'Profile']);
});
