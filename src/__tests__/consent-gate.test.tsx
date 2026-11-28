import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

import { translate } from '../i18n';
import type { MessageKey } from '../i18n';
import { clearReminders, syncReminders } from '../cabinet/reminders';
import { acceptTerms, setAiConsent } from '../profile/profileRepository';
import { showUrgentCare } from '../redflags/urgentCare';
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
// The Companion tab's modules import the client; its prompt makes no request.
jest.mock('../lib/supabase', () => ({ supabase: {} }));
// The schedule itself is the reminders suite's; here only whether leaving and returning to Today clears and resyncs it.
jest.mock('../cabinet/reminders', () => ({
  ...jest.requireActual<typeof import('../cabinet/reminders')>('../cabinet/reminders'),
  clearReminders: jest.fn(() => Promise.resolve()),
  syncReminders: jest.fn(() => Promise.resolve()),
}));
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
const PENDING = { adultConfirmedAt: null, boundaryAcceptedAt: null, termsVersion: null, aiConsentAnsweredAt: null, aiEnabled: false };

async function acceptBoundary(): Promise<void> {
  await fireEvent.press(screen.getByRole('checkbox', { name: t('boundary.age') }));
  await fireEvent.press(screen.getByRole('checkbox', { name: t('boundary.notMedical') }));
  await fireEvent.press(screen.getByRole('checkbox', { name: t('boundary.health') }));
  await fireEvent.press(screen.getByRole('button', { name: t('boundary.continue') }));
}

beforeEach(() => {
  jest.clearAllMocks();
  // A refresh that fails keeps what is shown, like the provider's: it changes nothing.
  resetAuth({ profile: { ...READY_PROFILE, ...PENDING }, refreshProfile: jest.fn(() => Promise.resolve()) });
});

test('a saved boundary moves on to the AI consent even when a follow-up refresh would fail', async () => {
  jest.mocked(acceptTerms).mockResolvedValue({ ok: true, value: { ...READY_PROFILE, ...PENDING, adultConfirmedAt: 'a', boundaryAcceptedAt: 'b', termsVersion: '2026-12-01' } });
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

test('an onboarded user with an older terms version is asked again, and accepting returns to Today with the reminders resynced', async () => {
  resetAuth({ profile: { ...READY_PROFILE, aiEnabled: false, termsVersion: '2026-11-01' } });
  jest.mocked(acceptTerms).mockResolvedValue({ ok: true, value: { ...READY_PROFILE, aiEnabled: false } });
  await renderRouter('./src/app', { initialUrl: '/' });
  expect(await screen.findByRole('header', { name: t('boundary.title') })).toBeOnTheScreen();
  expect(screen.getByText(t('boundary.updated'))).toBeOnTheScreen();
  // Away from Today the reminders are cleared, and nothing schedules them.
  expect(clearReminders).toHaveBeenCalled();
  expect(syncReminders).not.toHaveBeenCalled();

  await acceptBoundary();
  expect(await screen.findByText('Today screen')).toBeOnTheScreen();
  expect(currentAuth().profile?.termsVersion).toBe(READY_PROFILE.termsVersion);
  expect(syncReminders).toHaveBeenCalledWith('user-1', expect.anything(), expect.anything());
});

test('a pending AI re-consent never blocks Today: the Companion tab offers the AI screen, and a no returns to Today', async () => {
  resetAuth({ profile: { ...READY_PROFILE, aiEnabled: true, aiConsentVersion: '2026-11-01' } });
  jest.mocked(setAiConsent).mockResolvedValue({ ok: true, value: { ...READY_PROFILE, aiEnabled: false } });
  await renderRouter('./src/app', { initialUrl: '/' });
  expect(await screen.findByText('Today screen')).toBeOnTheScreen();

  await act(() => {
    router.push('/companion');
  });
  expect(await screen.findByText(t('consent.updated'))).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('companion-reconsent'));

  expect(await screen.findByRole('button', { name: t('consent.decline') })).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: t('consent.decline') }));
  expect(await screen.findByText('Today screen')).toBeOnTheScreen();
  expect(currentAuth().profile?.aiEnabled).toBe(false);
  expect(setAiConsent).toHaveBeenCalledWith(false, 'en');
});

test('a yes on the AI screen answered from the Companion tab leaves for the chat', async () => {
  resetAuth({ profile: { ...READY_PROFILE, aiEnabled: true, aiConsentVersion: '2026-11-01' } });
  jest.mocked(setAiConsent).mockResolvedValue({ ok: true, value: READY_PROFILE });
  await renderRouter('./src/app', { initialUrl: '/' });
  expect(await screen.findByText('Today screen')).toBeOnTheScreen();

  await act(() => {
    router.push('/companion');
  });
  await fireEvent.press(await screen.findByTestId('companion-reconsent'));
  await fireEvent.press(await screen.findByRole('button', { name: t('consent.accept') }));

  // The chat's composer: the prompt and the consent screen are gone.
  expect(await screen.findByText(t('companion.empty.title'))).toBeOnTheScreen();
  expect(screen.queryByTestId('companion-reconsent')).not.toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: t('consent.accept') })).not.toBeOnTheScreen();
  expect(currentAuth().profile?.aiConsentVersion).toBe(READY_PROFILE.aiConsentVersion);
});

test('a user whose AI answer is current cannot open the AI consent screen by link', async () => {
  resetAuth({ profile: READY_PROFILE });
  await renderRouter('./src/app', { initialUrl: '/ai-consent' });
  expect(await screen.findByText('Today screen')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: t('consent.accept') })).not.toBeOnTheScreen();
});

test('urgent care stays reachable from the red-flag hand-off while an AI re-consent is pending', async () => {
  resetAuth({ profile: { ...READY_PROFILE, aiEnabled: true, aiConsentVersion: null } });
  await renderRouter('./src/app', { initialUrl: '/' });
  expect(await screen.findByText('Today screen')).toBeOnTheScreen();

  await act(() => {
    showUrgentCare({ flags: ['thunderclap'], excerpt: 'the worst headache of my life', source: 'text', episodeId: null });
  });
  expect(await screen.findByRole('header', { name: t('redflag.title') })).toBeOnTheScreen();
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
