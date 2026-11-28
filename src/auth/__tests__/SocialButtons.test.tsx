import { render, screen } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { translate } from '../../i18n';
import { SocialButtons } from '../SocialButtons';

jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-apple-authentication', () => ({ signInAsync: jest.fn(), AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 } }));
jest.mock('@react-native-google-signin/google-signin', () => ({ GoogleSignin: { signIn: jest.fn(), configure: jest.fn() } }));

const google = translate('en', 'auth.signIn.google');
const apple = translate('en', 'auth.signIn.apple');

afterEach(() => {
  delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  delete process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  jest.restoreAllMocks();
});

test('without the Google client ids there is no Google button; Apple stays on iPhone', async () => {
  await render(<SocialButtons onError={jest.fn()} />);
  expect(screen.queryByRole('button', { name: google })).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: apple })).toBeOnTheScreen();
});

test('with both client ids the Google button is offered', async () => {
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'web-client-id';
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = 'ios-client-id';
  await render(<SocialButtons onError={jest.fn()} />);
  expect(screen.getByRole('button', { name: google })).toBeOnTheScreen();
});

test('on Android without the Google client ids nothing is offered, not even the "or"', async () => {
  jest.replaceProperty(Platform, 'OS', 'android');
  await render(<SocialButtons onError={jest.fn()} />);
  expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  expect(screen.queryByText(translate('en', 'auth.or'))).not.toBeOnTheScreen();
});
