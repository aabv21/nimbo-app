import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { translate } from '../i18n';
import { act } from '@testing-library/react-native';
import { READY_PROFILE, resetAuth, setAuth } from '../test/authMock';

jest.mock('../auth/AuthProvider', () => require('../test/authMock'));
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
}));
// Stand-ins for the two screens a pending user must never reach; they count renders and show their name.
const mockRenders = { today: 0, aiConsent: 0 };
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

test('signed out, the root layout lands on the sign-in screen', async () => {
  resetAuth({ status: 'signedOut', userId: null, profile: null });
  await renderRouter('./src/app', { initialUrl: '/' });
  expect(await screen.findByRole('header', { name: translate('en', 'auth.signIn.title') })).toBeOnTheScreen();
});

test('signed in without the boundary answered, the layout holds the user on the boundary screen', async () => {
  resetAuth({ profile: { ...READY_PROFILE, adultConfirmedAt: null, boundaryAcceptedAt: null, aiConsentAnsweredAt: null } });
  await renderRouter('./src/app', { initialUrl: '/' });
  expect(await screen.findByRole('header', { name: translate('en', 'boundary.title') })).toBeOnTheScreen();
});

test('signed in with an unreadable profile shows the loading view with a retry, never a consent screen', async () => {
  const auth = resetAuth({ profile: null });
  await renderRouter('./src/app', { initialUrl: '/' });
  expect(await screen.findByText(translate('en', 'common.loading'))).toBeOnTheScreen();
  expect(screen.queryByRole('header', { name: translate('en', 'boundary.title') })).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: translate('en', 'error.retry') }));
  expect(auth.refreshProfile).toHaveBeenCalledTimes(1);
});

const PENDING = { adultConfirmedAt: null, boundaryAcceptedAt: null, aiConsentAnsweredAt: null };
beforeEach(() => {
  mockRenders.today = 0;
  mockRenders.aiConsent = 0;
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

test('a deep link to the companion with the AI off lands on Today', async () => {
  resetAuth({ profile: { ...READY_PROFILE, aiEnabled: false } });
  await renderRouter('./src/app', { initialUrl: '/companion' });
  expect(await screen.findByText('Today screen')).toBeOnTheScreen();
  expect(screen.queryByText(translate('en', 'companion.empty.title'))).not.toBeOnTheScreen();
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
