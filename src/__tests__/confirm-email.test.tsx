import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import ConfirmEmail from '../app/(auth)/confirm-email';
import { confirmSignUp, resendSignUpCode } from '../auth/authService';
import { translate } from '../i18n';
import type { MessageKey } from '../i18n';

jest.mock('../auth/authService', () => ({ confirmSignUp: jest.fn(), resendSignUpCode: jest.fn() }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => mockParams.current,
}));
const mockParams: { current: { email: string; sent?: string } } = { current: { email: 'ana@example.com' } };

const t = (key: MessageKey, params?: Record<string, string>): string => translate('en', key, params);

beforeEach(() => {
  jest.clearAllMocks();
  mockParams.current = { email: 'ana@example.com' };
});

test('arriving from sign-in, no code is claimed sent and sending one is the first action', async () => {
  jest.mocked(resendSignUpCode).mockResolvedValue({ ok: true });
  await render(<ConfirmEmail />);
  expect(screen.getByText(t('auth.confirm.bodyUnsent', { email: 'ana@example.com' }))).toBeOnTheScreen();
  expect(screen.queryByText(t('auth.confirm.body', { email: 'ana@example.com' }))).not.toBeOnTheScreen();

  await fireEvent.press(screen.getByRole('button', { name: t('auth.confirm.resend') }));
  expect(resendSignUpCode).toHaveBeenCalledWith('ana@example.com');
  expect(await screen.findByText(t('auth.confirm.body', { email: 'ana@example.com' }))).toBeOnTheScreen();
  // Now a code is out, the resend action waits out its cooldown.
  expect(screen.getByRole('button', { name: t('auth.confirm.resendIn', { time: '0:30' }) })).toBeDisabled();

  await fireEvent.press(screen.getByRole('button', { name: t('auth.signIn.title') }));
  expect(router.replace).toHaveBeenCalledWith('/sign-in');
});

test('arriving from sign-up, the code is already on its way and a resend waits out the cooldown', async () => {
  mockParams.current = { email: 'ana@example.com', sent: '1' };
  await render(<ConfirmEmail />);
  expect(screen.getByText(t('auth.confirm.body', { email: 'ana@example.com' }))).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: t('auth.confirm.resendIn', { time: '0:30' }) })).toBeDisabled();
  expect(screen.queryByRole('button', { name: t('auth.confirm.resend') })).not.toBeOnTheScreen();
});

test('a wrong code shows the mapped message; a right one is left to the session listener', async () => {
  jest.mocked(confirmSignUp).mockResolvedValue({ ok: false, error: 'auth.error.invalidCode' });
  await render(<ConfirmEmail />);
  await fireEvent.changeText(screen.getByLabelText(t('auth.confirm.code')), '123456');
  await fireEvent.press(screen.getByRole('button', { name: t('auth.confirm.submit') }));
  expect(await screen.findByText(t('auth.confirm.error.invalid'))).toBeOnTheScreen();
  expect(confirmSignUp).toHaveBeenCalledWith('ana@example.com', '123456');
});

test('the code is drawn as six cells over one labelled input', async () => {
  await render(<ConfirmEmail />);
  expect(screen.getAllByTestId('code-cell', { includeHiddenElements: true })).toHaveLength(6);
  await fireEvent.changeText(screen.getByLabelText(t('auth.confirm.code')), '48a1');
  expect(screen.getByLabelText(t('auth.confirm.code')).props.value).toBe('481');
  expect(screen.getByText('4', { includeHiddenElements: true })).toBeOnTheScreen();
  expect(screen.getByText('1', { includeHiddenElements: true })).toBeOnTheScreen();
});
