import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Linking } from 'react-native';

import { policyUrl } from '../account/consent';
import AiConsent from '../app/welcome/ai-consent';
import { translate } from '../i18n';
import type { MessageKey } from '../i18n';
import { I18nProvider } from '../i18n/I18nProvider';
import { kvRemove, kvSet } from '../lib/kv';
import { setAiConsent } from '../profile/profileRepository';
import { READY_PROFILE, currentAuth, resetAuth } from '../test/authMock';

jest.mock('../auth/AuthProvider', () => require('../test/authMock'));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), dismissTo: jest.fn() } }));
jest.mock('../profile/profileRepository', () => ({ acceptTerms: jest.fn(), setAiConsent: jest.fn() }));

const t = (key: MessageKey): string => translate('en', key);
const mockedSet = jest.mocked(setAiConsent);
const openURL = jest.spyOn(Linking, 'openURL');

beforeEach(() => {
  jest.clearAllMocks();
  openURL.mockResolvedValue(undefined);
  kvRemove('locale-preference');
  // A first answer during onboarding; the re-consent tests below set an onboarded profile.
  resetAuth({ profile: { ...READY_PROFILE, aiConsentAnsweredAt: null, aiEnabled: false, aiConsentVersion: null, onboardingCompletedAt: null } });
  mockedSet.mockResolvedValue({ ok: true, value: READY_PROFILE });
});

test('the screen names the processors and what is and is not sent', async () => {
  await render(<AiConsent />);
  expect(screen.getByText(t('consent.sharing'))).toBeOnTheScreen();
  expect(screen.getByText(t('consent.transfer'))).toBeOnTheScreen();
  expect(t('consent.sharing')).toMatch(/Anthropic.*TypeSafe/);
  expect(screen.getByText(t('consent.sent.body'))).toBeOnTheScreen();
  expect(screen.getByText(t('consent.never.body'))).toBeOnTheScreen();
  expect(screen.getByText(t('consent.optional'))).toBeOnTheScreen();
});

test('turning the companion on records true and shows the answer without another read', async () => {
  await render(<AiConsent />);
  await fireEvent.press(screen.getByRole('button', { name: t('consent.accept') }));
  await waitFor(() => {
    expect(currentAuth().patchProfile).toHaveBeenCalledWith({
      aiEnabled: true,
      aiConsentAnsweredAt: READY_PROFILE.aiConsentAnsweredAt,
      aiConsentVersion: READY_PROFILE.aiConsentVersion,
    });
  });
  expect(mockedSet).toHaveBeenCalledTimes(1);
  expect(mockedSet).toHaveBeenCalledWith(true, 'en');
  expect(currentAuth().refreshProfile).not.toHaveBeenCalled();
});

test('declining records false and the app stays fully usable', async () => {
  mockedSet.mockResolvedValue({ ok: true, value: { ...READY_PROFILE, aiEnabled: false } });
  await render(<AiConsent />);
  await fireEvent.press(screen.getByRole('button', { name: t('consent.decline') }));
  await waitFor(() => {
    expect(currentAuth().patchProfile).toHaveBeenCalledWith({
      aiEnabled: false,
      aiConsentAnsweredAt: READY_PROFILE.aiConsentAnsweredAt,
      aiConsentVersion: READY_PROFILE.aiConsentVersion,
    });
  });
  expect(mockedSet).toHaveBeenCalledTimes(1);
  expect(mockedSet).toHaveBeenCalledWith(false, 'en');
});

test('accept and decline pass the UI language', async () => {
  kvSet('locale-preference', 'pt');
  const pt = (key: MessageKey): string => translate('pt', key);
  await render(
    <I18nProvider>
      <AiConsent />
    </I18nProvider>,
  );
  await fireEvent.press(screen.getByRole('button', { name: pt('consent.decline') }));
  await waitFor(() => {
    expect(mockedSet).toHaveBeenCalledWith(false, 'pt');
  });
  await fireEvent.press(screen.getByRole('button', { name: pt('consent.accept') }));
  await waitFor(() => {
    expect(mockedSet).toHaveBeenCalledWith(true, 'pt');
  });
});

test('the screen says where the data is processed and links to the policy\'s AI section', async () => {
  kvSet('locale-preference', 'es');
  await render(
    <I18nProvider>
      <AiConsent />
    </I18nProvider>,
  );
  expect(screen.getByText(translate('es', 'consent.transfer'))).toBeOnTheScreen();

  const link = screen.getByTestId('ai-consent-policy');
  expect(link.props.accessibilityRole).toBe('link');
  await fireEvent.press(screen.getByRole('link', { name: translate('es', 'consent.policy_link') }));
  expect(openURL).toHaveBeenCalledWith(policyUrl('es', 'ai'));
  expect(openURL).toHaveBeenCalledWith('https://aabv21.github.io/nimbo-privacy/es/#ai');
});

test('a failed save shows the error and does not navigate', async () => {
  mockedSet.mockResolvedValue({ ok: false, kind: 'unknown' });
  await render(<AiConsent />);
  await fireEvent.press(screen.getByRole('button', { name: t('consent.decline') }));
  expect(await screen.findByText(t('consent.error'))).toBeOnTheScreen();
  expect(currentAuth().patchProfile).not.toHaveBeenCalled();
});

test('a saved answer never navigates: the gate moves the user on', async () => {
  await render(<AiConsent />);
  await fireEvent.press(screen.getByRole('button', { name: t('consent.accept') }));
  await waitFor(() => {
    expect(currentAuth().patchProfile).toHaveBeenCalledTimes(1);
  });
  expect(router.push).not.toHaveBeenCalled();
  expect(router.replace).not.toHaveBeenCalled();
  expect(router.dismissTo).not.toHaveBeenCalled();
});

test('a first answer shows no "updated" notice', async () => {
  await render(<AiConsent />);
  expect(screen.queryByText(t('consent.updated'))).not.toBeOnTheScreen();
});

test('answering a newer text: the "updated" notice shows, and a yes leaves for the chat', async () => {
  resetAuth({ profile: { ...READY_PROFILE, aiEnabled: true, aiConsentVersion: '2026-11-01' } });
  await render(<AiConsent />);
  expect(screen.getByText(t('consent.updated'))).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: t('consent.accept') }));
  await waitFor(() => {
    expect(router.dismissTo).toHaveBeenCalledWith('/companion');
  });
  expect(currentAuth().profile?.aiConsentVersion).toBe(READY_PROFILE.aiConsentVersion);
});

test('answering a newer text with a no leaves for Today, since the Companion tab is gone', async () => {
  resetAuth({ profile: { ...READY_PROFILE, aiEnabled: true, aiConsentVersion: '2026-11-01' } });
  mockedSet.mockResolvedValue({ ok: true, value: { ...READY_PROFILE, aiEnabled: false } });
  await render(<AiConsent />);
  await fireEvent.press(screen.getByRole('button', { name: t('consent.decline') }));
  await waitFor(() => {
    expect(router.dismissTo).toHaveBeenCalledWith('/today');
  });
});

test('the screen shows the first of the six onboarding steps', async () => {
  await render(<AiConsent />);
  const progress = screen.getByRole('progressbar', { name: t('onb.progress') });
  expect(progress.props.accessibilityValue).toEqual({ min: 0, max: 6, now: 1 });
});

test('an onboarded user asked again for a newer text sees no setup progress', async () => {
  resetAuth({ profile: { ...READY_PROFILE, aiEnabled: true, aiConsentVersion: '2026-11-01' } });
  await render(<AiConsent />);
  expect(screen.getByRole('header', { name: t('consent.title') })).toBeOnTheScreen();
  expect(screen.queryByRole('progressbar', { name: t('onb.progress') })).not.toBeOnTheScreen();
});
