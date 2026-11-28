import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { translate } from '../i18n';
import type { MessageKey } from '../i18n';
import { acceptTerms, setAiConsent } from '../profile/profileRepository';
import { READY_PROFILE, currentAuth, resetAuth } from '../test/authMock';

// The consent screens with the real root layout: a saved answer moves the user on through the gate alone.
jest.mock('../auth/AuthProvider', () => require('../test/authMock'));
// The root layout's long-attack watch reads the local store.
jest.mock('expo-sqlite', () => require('../test/sqliteNode'));
jest.mock('../lib/sync/SyncProvider', () => require('../test/syncMock'));
jest.mock('../push/pushRegistration', () => require('../test/pushClientsMock'));
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve()),
  hideAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('../auth/authService', () => ({ signOut: jest.fn() }));
jest.mock('../app/(tabs)/today', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { __esModule: true, default: () => <Text>Today screen</Text> };
});
// The tab shell saves the phone's time zone on mount; that request never answers here.
jest.mock('../profile/profileRepository', () => ({
  acceptTerms: jest.fn(),
  setAiConsent: jest.fn(),
  updateProfile: jest.fn(() => new Promise(() => undefined)),
}));

// Same Reanimated fill-in as the smoke suite: expo-router's test helpers replace the shared mock on import.
const reanimated = jest.requireMock<object>('react-native-reanimated');
Object.assign(reanimated, jest.requireActual<object>('../test/reanimatedMock'));
Object.defineProperty(reanimated, '__esModule', { value: true });

const t = (key: MessageKey): string => translate('en', key);
const PENDING = { adultConfirmedAt: null, boundaryAcceptedAt: null, aiConsentAnsweredAt: null, aiEnabled: false };

async function acceptBoundary(): Promise<void> {
  await fireEvent.press(screen.getByRole('checkbox', { name: t('boundary.age') }));
  await fireEvent.press(screen.getByRole('checkbox', { name: t('boundary.notMedical') }));
  await fireEvent.press(screen.getByRole('button', { name: t('boundary.continue') }));
}

beforeEach(() => {
  jest.clearAllMocks();
  // A refresh that fails keeps what is shown, like the provider's: it changes nothing.
  resetAuth({ profile: { ...READY_PROFILE, ...PENDING }, refreshProfile: jest.fn(() => Promise.resolve()) });
});

test('a saved boundary moves on to the AI consent even when a follow-up refresh would fail', async () => {
  jest.mocked(acceptTerms).mockResolvedValue({ ok: true, value: { ...READY_PROFILE, ...PENDING, adultConfirmedAt: 'a', boundaryAcceptedAt: 'b' } });
  await renderRouter('./src/app', { initialUrl: '/' });
  expect(await screen.findByRole('header', { name: t('boundary.title') })).toBeOnTheScreen();

  await acceptBoundary();
  expect(await screen.findByRole('header', { name: t('consent.title') })).toBeOnTheScreen();
  expect(currentAuth().refreshProfile).not.toHaveBeenCalled();
});

test('a saved AI answer opens the tabs', async () => {
  resetAuth({ profile: { ...READY_PROFILE, aiConsentAnsweredAt: null, aiEnabled: false } });
  jest.mocked(setAiConsent).mockResolvedValue({ ok: true, value: { ...READY_PROFILE, aiEnabled: false } });
  await renderRouter('./src/app', { initialUrl: '/' });
  expect(await screen.findByRole('header', { name: t('consent.title') })).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: t('consent.decline') }));
  expect(await screen.findByText('Today screen')).toBeOnTheScreen();
  expect(currentAuth().profile?.aiEnabled).toBe(false);
});

test('a failed boundary save keeps the user on the screen with the error', async () => {
  jest.mocked(acceptTerms).mockResolvedValue({ ok: false, kind: 'network' });
  await renderRouter('./src/app', { initialUrl: '/' });
  expect(await screen.findByRole('header', { name: t('boundary.title') })).toBeOnTheScreen();

  await acceptBoundary();
  expect(await screen.findByText(t('boundary.error'))).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: t('boundary.title') })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: t('boundary.continue') })).toBeEnabled();
});
