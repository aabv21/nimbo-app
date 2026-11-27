import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import SignIn from '../app/(auth)/sign-in';
import { resendSignUpCode, signInWithEmail } from '../auth/authService';
import { translate } from '../i18n';
import type { MessageKey } from '../i18n';

jest.mock('../auth/authService', () => ({
  signInWithEmail: jest.fn(),
  signInWithApple: jest.fn(),
  signInWithGoogle: jest.fn(),
  resendSignUpCode: jest.fn(),
  isGoogleSignInConfigured: jest.fn(() => false),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) } }));

const t = (key: MessageKey): string => translate('en', key);
const mockedSignIn = jest.mocked(signInWithEmail);

async function submit(email = 'ana@example.com', password = 'correct horse'): Promise<void> {
  await fireEvent.changeText(screen.getByLabelText(t('auth.signIn.email')), email);
  await fireEvent.changeText(screen.getByLabelText(t('auth.signIn.password')), password);
  await fireEvent.press(screen.getByRole('button', { name: t('auth.signIn.submit') }));
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(router.canGoBack).mockReturnValue(false);
});

test('the screen shows the sign-in title and, as the first screen, no Back', async () => {
  await render(<SignIn />);
  expect(screen.getByRole('header', { name: t('auth.signIn.title') })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: t('common.back') })).not.toBeOnTheScreen();
});

test('reached from another screen, Back returns to it', async () => {
  jest.mocked(router.canGoBack).mockReturnValue(true);
  await render(<SignIn />);
  await fireEvent.press(screen.getByRole('button', { name: t('common.back') }));
  expect(router.back).toHaveBeenCalledTimes(1);
});

test('an unconfirmed email goes to the code screen and offers a new code', async () => {
  mockedSignIn.mockResolvedValue({ ok: false, error: 'auth.error.emailNotConfirmed' });
  jest.mocked(resendSignUpCode).mockResolvedValue({ ok: true });
  await render(<SignIn />);
  await submit();

  await waitFor(() => {
    expect(router.push).toHaveBeenCalledWith({ pathname: '/confirm-email', params: { email: 'ana@example.com' } });
  });
  expect(screen.getByText(t('auth.signIn.error.unconfirmed'))).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: t('auth.confirm.resend') }));
  expect(resendSignUpCode).toHaveBeenCalledTimes(1);
  expect(resendSignUpCode).toHaveBeenCalledWith('ana@example.com');
});

test('any other failure shows its mapped message', async () => {
  mockedSignIn.mockResolvedValue({ ok: false, error: 'auth.error.invalidCredentials' });
  await render(<SignIn />);
  await submit();
  expect(await screen.findByText(t('auth.signIn.error.invalid'))).toBeOnTheScreen();
  expect(router.push).not.toHaveBeenCalled();

  mockedSignIn.mockResolvedValue({ ok: false, error: 'auth.error.network' });
  await fireEvent.press(screen.getByRole('button', { name: t('auth.signIn.submit') }));
  expect(await screen.findByText(t('error.network'))).toBeOnTheScreen();
});

test('a malformed email is stopped before the request', async () => {
  await render(<SignIn />);
  await submit('not-an-email');
  expect(await screen.findByText(t('auth.error.emailInvalid'))).toBeOnTheScreen();
  expect(mockedSignIn).not.toHaveBeenCalled();
});

test('a code sent from the notice opens the code screen in its sent state, and so does the next arrival there', async () => {
  mockedSignIn.mockResolvedValue({ ok: false, error: 'auth.error.emailNotConfirmed' });
  jest.mocked(resendSignUpCode).mockResolvedValue({ ok: true });
  await render(<SignIn />);
  await submit();
  await waitFor(() => {
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  await fireEvent.press(screen.getByRole('button', { name: t('auth.confirm.resend') }));
  await waitFor(() => {
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/confirm-email', params: { email: 'ana@example.com', sent: '1' } });
  });

  // Back on sign-in, trying again lands on the code screen that already says a code is on its way.
  await fireEvent.press(screen.getByRole('button', { name: t('auth.signIn.submit') }));
  await waitFor(() => {
    expect(router.push).toHaveBeenCalledTimes(3);
  });
  expect(router.push).toHaveBeenLastCalledWith({ pathname: '/confirm-email', params: { email: 'ana@example.com', sent: '1' } });
});
