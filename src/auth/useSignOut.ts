import { useCallback, useState } from 'react';

import { signOut } from './authService';
import type { AuthErrorKey } from './errors';

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
    void signOut().then((result) => {
      setSigningOut(false);
      if (!result.ok) {
        setError(result.error);
      }
    });
  }, []);

  return { signOut: run, signingOut, error };
}
