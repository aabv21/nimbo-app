import { isAuthError, isAuthRetryableFetchError } from '@supabase/supabase-js';

import type { MessageKey } from '../i18n';

export type AuthErrorKey =
  | 'auth.error.invalidCredentials'
  | 'auth.error.emailNotConfirmed'
  | 'auth.error.emailInUse'
  | 'auth.error.weakPassword'
  | 'auth.error.invalidCode'
  | 'auth.error.rateLimited'
  | 'auth.error.network'
  | 'auth.error.cancelled'
  | 'auth.error.unknown';

/** The catalog message an error shows; the exhaustive switch fails typecheck for an error with no text in en, es and pt. */
export function authErrorMessage(error: AuthErrorKey): MessageKey {
  switch (error) {
    case 'auth.error.invalidCredentials':
      return 'auth.signIn.error.invalid';
    case 'auth.error.emailNotConfirmed':
      return 'auth.signIn.error.unconfirmed';
    case 'auth.error.emailInUse':
      return 'auth.signUp.error.emailTaken';
    case 'auth.error.weakPassword':
      return 'auth.signUp.error.weakPassword';
    case 'auth.error.invalidCode':
      return 'auth.confirm.error.invalid';
    case 'auth.error.rateLimited':
      return 'auth.error.rateLimited';
    case 'auth.error.network':
      return 'error.network';
    case 'auth.error.cancelled':
      return 'auth.error.cancelled';
    case 'auth.error.unknown':
      return 'error.generic';
  }
}

const CODE_TO_KEY: Readonly<Record<string, AuthErrorKey>> = {
  invalid_credentials: 'auth.error.invalidCredentials',
  email_not_confirmed: 'auth.error.emailNotConfirmed',
  user_already_exists: 'auth.error.emailInUse',
  email_exists: 'auth.error.emailInUse',
  weak_password: 'auth.error.weakPassword',
  otp_expired: 'auth.error.invalidCode',
  invalid_otp: 'auth.error.invalidCode',
  over_email_send_rate_limit: 'auth.error.rateLimited',
  over_request_rate_limit: 'auth.error.rateLimited',
};

/** The native-module codes surfaced when a user cancels an Apple or Google sign-in sheet. */
const CANCEL_CODES: ReadonlySet<string> = new Set(['ERR_REQUEST_CANCELED', 'SIGN_IN_CANCELLED']);

function hasStringCode(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string';
}

/**
 * Maps any error `authService` might throw or receive from supabase-js, Apple or Google sign-in
 * to a translated-message key, so screens never show a raw provider error to the user.
 */
export function toAuthErrorKey(error: unknown): AuthErrorKey {
  if (isAuthRetryableFetchError(error) || error instanceof TypeError) {
    return 'auth.error.network';
  }
  if (hasStringCode(error) && CANCEL_CODES.has(error.code)) {
    return 'auth.error.cancelled';
  }
  if (isAuthError(error) && error.code !== undefined) {
    return CODE_TO_KEY[error.code] ?? 'auth.error.unknown';
  }
  return 'auth.error.unknown';
}
