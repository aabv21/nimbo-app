import { GoogleSignin } from '@react-native-google-signin/google-signin';
import * as AppleAuthentication from 'expo-apple-authentication';

import { supabase } from '../lib/supabase';
import { toAuthErrorKey } from './errors';
import { createNonce } from './nonce';
import type { Client, Result } from './emailAuth';

/** Kept out of `emailAuth.ts`: the Apple and Google SDKs need React Native's native modules, not plain Node. */
export async function signInWithApple(client: Client = supabase): Promise<Result> {
  try {
    const { raw, hashed } = await createNonce();
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashed,
    });
    if (credential.identityToken === null) {
      return { ok: false, error: 'auth.error.unknown' };
    }

    const { error } = await client.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
      nonce: raw,
    });
    if (error !== null) {
      return { ok: false, error: toAuthErrorKey(error) };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toAuthErrorKey(error) };
  }
}

let googleConfigured = false;

function isConfiguredClientId(value: string | undefined): value is string {
  if (value === undefined) {
    return false;
  }
  return value.trim() !== '';
}

/**
 * Configures once, on first use; a missing id is a setup problem, warned in dev, not a user error.
 * OAuth client ids aren't secrets. `EXPO_PUBLIC_*` is inlined at build time only for literal member
 * expressions, so they're read directly rather than through a helper taking the key name.
 */
function ensureGoogleConfigured(): boolean {
  if (googleConfigured) {
    return true;
  }
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  if (!isConfiguredClientId(webClientId) || !isConfiguredClientId(iosClientId)) {
    if (__DEV__) {
      console.warn(
        'Sign in with Google is not configured: set EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID and EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID.',
      );
    }
    return false;
  }
  GoogleSignin.configure({ webClientId, iosClientId });
  googleConfigured = true;
  return true;
}

/**
 * No nonce: the library can't send a matching one, so GoTrue would reject every sign-in.
 * NOTE: no nonce replay protection for Google; upgrade: a library version exposing iOS's nonce, or Universal Sign In.
 */
export async function signInWithGoogle(client: Client = supabase): Promise<Result> {
  try {
    if (!ensureGoogleConfigured()) {
      return { ok: false, error: 'auth.error.unknown' };
    }

    const response = await GoogleSignin.signIn();
    if (response.type === 'cancelled') {
      return { ok: false, error: 'auth.error.cancelled' };
    }
    const idToken = response.data.idToken;
    if (idToken === null) {
      return { ok: false, error: 'auth.error.unknown' };
    }

    const { error } = await client.auth.signInWithIdToken({
      provider: 'google',
      token: idToken,
    });
    if (error !== null) {
      return { ok: false, error: toAuthErrorKey(error) };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: toAuthErrorKey(error) };
  }
}
