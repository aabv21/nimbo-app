import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import AiConsent from '../app/welcome/ai-consent';
import { translate } from '../i18n';
import type { MessageKey } from '../i18n';
import { setAiConsent } from '../profile/profileRepository';
import { READY_PROFILE, currentAuth, resetAuth } from '../test/authMock';

jest.mock('../auth/AuthProvider', () => require('../test/authMock'));
jest.mock('../profile/profileRepository', () => ({ acceptTerms: jest.fn(), setAiConsent: jest.fn() }));

const t = (key: MessageKey): string => translate('en', key);
const mockedSet = jest.mocked(setAiConsent);

beforeEach(() => {
  jest.clearAllMocks();
  resetAuth({ profile: { ...READY_PROFILE, aiConsentAnsweredAt: null, aiEnabled: false } });
  mockedSet.mockResolvedValue({ ok: true, value: READY_PROFILE });
});

test('the screen names the processors and what is and is not sent', async () => {
  await render(<AiConsent />);
  expect(screen.getByText(/Anthropic/)).toBeOnTheScreen();
  expect(screen.getByText(/TypeSafe/)).toBeOnTheScreen();
  expect(screen.getByText(t('consent.sent.body'))).toBeOnTheScreen();
  expect(screen.getByText(t('consent.never.body'))).toBeOnTheScreen();
  expect(screen.getByText(t('consent.optional'))).toBeOnTheScreen();
});

test('turning the companion on records true and shows the answer without another read', async () => {
  await render(<AiConsent />);
  await fireEvent.press(screen.getByRole('button', { name: t('consent.accept') }));
  await waitFor(() => {
    expect(currentAuth().patchProfile).toHaveBeenCalledWith({ aiEnabled: true, aiConsentAnsweredAt: READY_PROFILE.aiConsentAnsweredAt });
  });
  expect(mockedSet).toHaveBeenCalledTimes(1);
  expect(mockedSet).toHaveBeenCalledWith(true);
  expect(currentAuth().refreshProfile).not.toHaveBeenCalled();
});

test('declining records false and the app stays fully usable', async () => {
  mockedSet.mockResolvedValue({ ok: true, value: { ...READY_PROFILE, aiEnabled: false } });
  await render(<AiConsent />);
  await fireEvent.press(screen.getByRole('button', { name: t('consent.decline') }));
  await waitFor(() => {
    expect(currentAuth().patchProfile).toHaveBeenCalledWith({ aiEnabled: false, aiConsentAnsweredAt: READY_PROFILE.aiConsentAnsweredAt });
  });
  expect(mockedSet).toHaveBeenCalledTimes(1);
  expect(mockedSet).toHaveBeenCalledWith(false);
});

test('a failed save shows the error and does not navigate', async () => {
  mockedSet.mockResolvedValue({ ok: false, kind: 'unknown' });
  await render(<AiConsent />);
  await fireEvent.press(screen.getByRole('button', { name: t('consent.decline') }));
  expect(await screen.findByText(t('consent.error'))).toBeOnTheScreen();
  expect(currentAuth().patchProfile).not.toHaveBeenCalled();
});
