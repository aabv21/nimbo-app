import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import AiConsent from '../app/welcome/ai-consent';
import { translate } from '../i18n';
import type { MessageKey } from '../i18n';
import { setAiConsent } from '../profile/profileRepository';
import { READY_PROFILE, currentAuth, resetAuth } from '../test/authMock';

jest.mock('../auth/AuthProvider', () => require('../test/authMock'));
jest.mock('../profile/profileRepository', () => ({ acceptTerms: jest.fn(), setAiConsent: jest.fn() }));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) } }));

const t = (key: MessageKey): string => translate('en', key);
const mockedSet = jest.mocked(setAiConsent);

beforeEach(() => {
  jest.clearAllMocks();
  resetAuth();
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

test('turning the companion on records true and goes to Today', async () => {
  await render(<AiConsent />);
  await fireEvent.press(screen.getByRole('button', { name: t('consent.accept') }));
  await waitFor(() => {
    expect(router.replace).toHaveBeenCalledWith('/today');
  });
  expect(mockedSet).toHaveBeenCalledTimes(1);
  expect(mockedSet).toHaveBeenCalledWith(true);
  expect(currentAuth().refreshProfile).toHaveBeenCalledTimes(1);
});

test('declining records false and the app stays fully usable', async () => {
  await render(<AiConsent />);
  await fireEvent.press(screen.getByRole('button', { name: t('consent.decline') }));
  await waitFor(() => {
    expect(router.replace).toHaveBeenCalledWith('/today');
  });
  expect(mockedSet).toHaveBeenCalledTimes(1);
  expect(mockedSet).toHaveBeenCalledWith(false);
});

test('a failed save shows the error and does not navigate', async () => {
  mockedSet.mockResolvedValue({ ok: false, kind: 'unknown' });
  await render(<AiConsent />);
  await fireEvent.press(screen.getByRole('button', { name: t('consent.decline') }));
  expect(await screen.findByText(t('consent.error'))).toBeOnTheScreen();
  expect(router.replace).not.toHaveBeenCalled();
});
