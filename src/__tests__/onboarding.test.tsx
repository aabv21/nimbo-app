import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { translate } from '../i18n';
import type { MessageKey } from '../i18n';
import { kvRemove } from '../lib/kv';
import { readIntroSeen } from '../onboarding/introSeen';
import * as outbox from '../lib/outbox/outbox';
import { setAiConsent, updateProfile } from '../profile/profileRepository';
import { registerPush } from '../push/pushRegistration';
import { READY_PROFILE, currentAuth, resetAuth } from '../test/authMock';
import { clearLocalDb } from '../test/localDbTest';

// The intro and the setup steps with the real root layout: each answer moves the user on through the gate.
jest.mock('../auth/AuthProvider', () => require('../test/authMock'));
jest.mock('expo-sqlite', () => require('../test/sqliteNode'));
jest.mock('expo-crypto', () => ({ randomUUID: () => (require('node:crypto') as typeof import('node:crypto')).randomUUID() }));
jest.mock('../lib/sync/SyncProvider', () => require('../test/syncMock'));
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve()),
  hideAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('../auth/authService', () => ({
  signUpWithEmail: jest.fn(),
  signInWithEmail: jest.fn(),
  signInWithApple: jest.fn(),
  signInWithGoogle: jest.fn(),
  resendSignUpCode: jest.fn(),
  signOut: jest.fn(),
  isGoogleSignInConfigured: jest.fn(() => false),
}));
jest.mock('../app/(tabs)/today', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { __esModule: true, default: () => <Text>Today screen</Text> };
});
// Every write but the finish goes to the network, faked here; the finish is the real one, queued in the local store.
jest.mock('../lib/supabase', () => ({ supabase: {} }));
jest.mock('../push/pushRegistration', () => require('../test/pushClientsMock'));
jest.mock('../profile/profileRepository', () => ({
  ...jest.requireActual<typeof import('../profile/profileRepository')>('../profile/profileRepository'),
  acceptTerms: jest.fn(),
  setAiConsent: jest.fn(),
  updateProfile: jest.fn(),
}));

const reanimated = jest.requireMock<object>('react-native-reanimated');
Object.assign(reanimated, jest.requireActual<object>('../test/reanimatedMock'));
Object.defineProperty(reanimated, '__esModule', { value: true });

const t = (key: MessageKey): string => translate('en', key);
const SETTING_UP = { ...READY_PROFILE, onboardingCompletedAt: null };
const queuedKinds = (): string[] => outbox.listOutbox('user-1').map((op) => op.kind);

async function header(key: MessageKey): Promise<void> {
  expect(await screen.findByRole('header', { name: t(key) })).toBeOnTheScreen();
}

async function press(name: string): Promise<void> {
  await fireEvent.press(screen.getByRole('button', { name }));
}

beforeEach(() => {
  jest.clearAllMocks();
  kvRemove('intro.seen');
  resetAuth({ profile: SETTING_UP });
  // Like the server: the row the write returns carries what was sent.
  jest.mocked(updateProfile).mockImplementation((changes) => Promise.resolve({ ok: true, value: { ...SETTING_UP, ...changes } }));
  clearLocalDb();
});

test('Get started marks the intro seen and opens sign-up', async () => {
  resetAuth({ status: 'signedOut', userId: null, profile: null });
  await renderRouter('./src/app', { initialUrl: '/' });
  await header('onb.value1.title');

  await press(t('common.next'));
  await header('onb.value2.title');
  await press(t('common.next'));
  await header('onb.value3.title');
  await press(t('onb.start'));

  await header('auth.signUp.title');
  expect(readIntroSeen()).toBe(true);
});

test('Skip on the intro marks it seen and opens sign-in', async () => {
  resetAuth({ status: 'signedOut', userId: null, profile: null });
  await renderRouter('./src/app', { initialUrl: '/' });
  await header('onb.value1.title');

  await press(t('common.skip'));
  await header('auth.signIn.title');
  expect(readIntroSeen()).toBe(true);
});

test('after the AI consent the user lands on the triggers step', async () => {
  resetAuth({ profile: { ...SETTING_UP, aiConsentAnsweredAt: null, aiEnabled: false } });
  jest.mocked(setAiConsent).mockResolvedValue({ ok: true, value: { ...SETTING_UP, aiEnabled: false } });
  await renderRouter('./src/app', { initialUrl: '/' });
  await header('consent.title');

  await press(t('consent.decline'));
  await header('onb.triggers.title');
});

test('the chosen triggers are saved in the order picked', async () => {
  await renderRouter('./src/app', { initialUrl: '/' });
  await header('onb.triggers.title');

  await fireEvent.press(screen.getByRole('checkbox', { name: t('condition.triggers.weather') }));
  await fireEvent.press(screen.getByRole('checkbox', { name: t('condition.triggers.stress') }));
  await press(t('common.next'));

  await header('onb.priority.title');
  expect(updateProfile).toHaveBeenCalledWith({ knownTriggers: ['weather', 'stress'] });
});

test('a failed save keeps the user on the step with the error', async () => {
  jest.mocked(updateProfile).mockResolvedValue({ ok: false, kind: 'network' });
  await renderRouter('./src/app', { initialUrl: '/' });
  await header('onb.triggers.title');

  await fireEvent.press(screen.getByRole('checkbox', { name: t('condition.triggers.weather') }));
  await press(t('common.next'));

  expect(await screen.findByText(t('consent.error'))).toBeOnTheScreen();
  expect(screen.getByRole('header', { name: t('onb.triggers.title') })).toBeOnTheScreen();
});

test('choosing “not overdoing pain relievers” saves the overuse priority', async () => {
  await renderRouter('./src/app', { initialUrl: '/welcome/priority' });
  await header('onb.priority.title');

  await fireEvent.press(screen.getByRole('radio', { name: t('onb.priority.overuse') }));
  await press(t('common.next'));

  await header('onb.meds.title');
  expect(updateProfile).toHaveBeenCalledWith({ priority: 'overuse' });
});

test('Skip on every step still reaches the last one, writing nothing', async () => {
  await renderRouter('./src/app', { initialUrl: '/' });
  await header('onb.triggers.title');
  await press(t('common.skip'));
  await header('onb.priority.title');
  await press(t('common.skip'));
  await header('onb.meds.title');
  await press(t('common.skip'));
  await header('onb.notif.title');
  await press(t('common.not_now'));

  await header('onb.loc.title');
  expect(updateProfile).not.toHaveBeenCalled();
  expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
});

test('Add a medication on the medications step opens the cabinet form', async () => {
  await renderRouter('./src/app', { initialUrl: '/welcome/medications' });
  await header('onb.meds.title');

  await press(t('cabinet.add'));
  // The form's own title is the same words as the button that opened it.
  expect(await screen.findByRole('header', { name: t('cabinet.add') })).toBeOnTheScreen();
});

test('a denied notification permission still moves on', async () => {
  jest.mocked(Notifications.getPermissionsAsync).mockResolvedValueOnce({ granted: false, canAskAgain: true } as Notifications.NotificationPermissionsStatus);
  jest.mocked(Notifications.requestPermissionsAsync).mockResolvedValueOnce({ granted: false, canAskAgain: false } as Notifications.NotificationPermissionsStatus);
  await renderRouter('./src/app', { initialUrl: '/welcome/notifications' });
  await header('onb.notif.title');

  await press(t('onb.notif.allow'));

  await header('onb.loc.title');
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(registerPush).not.toHaveBeenCalled();
});

test('a granted notification permission registers this phone’s push token, then moves on', async () => {
  await renderRouter('./src/app', { initialUrl: '/welcome/notifications' });
  await header('onb.notif.title');

  await press(t('onb.notif.allow'));

  await header('onb.loc.title');
  expect(registerPush).toHaveBeenCalledWith('user-1', 'en');
});

test('the lock-screen choice is saved, and the hours and cap rows are not buttons', async () => {
  await renderRouter('./src/app', { initialUrl: '/welcome/notifications' });
  await header('onb.notif.title');

  expect(screen.getByText(t('notif.hours'))).toBeOnTheScreen();
  expect(screen.getByText(t('notif.cap'))).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: t('notif.hours') })).not.toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: t('notif.cap') })).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('radio', { name: t('notif.lock.detail') }));
  expect(updateProfile).toHaveBeenCalledWith({ lockScreenDetail: true });
});

test('offline, “Not now” on location finishes onboarding through the outbox and the gate lands on Today', async () => {
  // Offline: every network write fails, and the client itself is an empty stand-in that would throw on a request.
  jest.mocked(updateProfile).mockResolvedValue({ ok: false, kind: 'network' });
  await renderRouter('./src/app', { initialUrl: '/welcome/location' });
  await header('onb.loc.title');

  await press(t('common.not_now'));

  expect(await screen.findByText('Today screen')).toBeOnTheScreen();
  expect(queuedKinds()).toEqual(['complete_onboarding']);
  expect(currentAuth().profile?.onboardingCompletedAt).toEqual(expect.any(String));
});

test('a denied location still finishes onboarding without saving an area', async () => {
  await renderRouter('./src/app', { initialUrl: '/welcome/location' });
  await header('onb.loc.title');

  await press(t('onb.loc.allow'));

  expect(await screen.findByText('Today screen')).toBeOnTheScreen();
  // The tab shell saves the time zone once it mounts; no area is ever sent.
  expect(updateProfile).not.toHaveBeenCalledWith(expect.objectContaining({ coarseLocation: expect.anything() as unknown }));
  expect(queuedKinds()).toEqual(['complete_onboarding']);
});

test('an allowed location sends only the rounded area, then finishes', async () => {
  jest.mocked(Location.requestForegroundPermissionsAsync).mockResolvedValueOnce({ granted: true, canAskAgain: true, expires: 'never' } as Location.LocationPermissionResponse);
  jest.mocked(Location.getCurrentPositionAsync).mockResolvedValueOnce({ coords: { latitude: 4.71234, longitude: -74.07219 } } as Location.LocationObject);
  await renderRouter('./src/app', { initialUrl: '/welcome/location' });
  await header('onb.loc.title');

  await press(t('onb.loc.allow'));

  expect(await screen.findByText('Today screen')).toBeOnTheScreen();
  expect(updateProfile).toHaveBeenCalledWith({ coarseLocation: { lat: 4.7, lon: -74.1 } });
  expect(queuedKinds()).toEqual(['complete_onboarding']);
});

test('a finish the phone cannot store keeps the user on the last step with the error', async () => {
  const spy = jest.spyOn(outbox, 'enqueue').mockImplementationOnce(() => {
    throw new Error('disk full');
  });
  await renderRouter('./src/app', { initialUrl: '/welcome/location' });
  await header('onb.loc.title');

  await press(t('common.not_now'));

  expect(await screen.findByText(t('consent.error'))).toBeOnTheScreen();
  expect(screen.queryByText('Today screen')).not.toBeOnTheScreen();
  expect(currentAuth().profile?.onboardingCompletedAt).toBeNull();
  spy.mockRestore();
});
