import { useCallback, useState } from 'react';

import { forgetPushToken } from '../push/pushRegistration';
import { signOut } from './authService';
import { currentUserId } from './currentUser';
import type { AuthErrorKey } from './errors';

/** How long sign-out waits for the push token's delete; past it the sign-out cleanup unregisters it instead. */
export const FORGET_PUSH_WAIT_MS = 2_000;

/** Deletes this phone's push row while the session still can, so a shared phone stops getting the account's pushes. */
async function forgetPushBriefly(): Promise<void> {
  const userId = currentUserId();
  if (userId === null) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, FORGET_PUSH_WAIT_MS);
  });
  await Promise.race([forgetPushToken(userId).catch(() => undefined), waited]);
  clearTimeout(timer);
}

/**
 * Sign-out for a button: tracks the pending request and keeps a failure's message key. A successful
 * sign-out needs nothing here: `AuthProvider`'s SIGNED_OUT moves the app to the signed-out screens.
 */
export function useSignOut(): { signOut: () => void; signingOut: boolean; error: AuthErrorKey | undefined } {
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<AuthErrorKey | undefined>(undefined);

  const run = useCallback(() => {
    setError(undefined);
    setSigningOut(true);
    void forgetPushBriefly()
      .then(() => signOut())
      .then((result) => {
        setSigningOut(false);
        if (!result.ok) {
          setError(result.error);
        }
      });
  }, []);

  return { signOut: run, signingOut, error };
}
