import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useOnResume } from '../lib/useOnResume';
import { readStoredSession, startAuthAutoRefresh, supabase } from '../lib/supabase';
import { fetchProfile, readCachedProfileSync } from '../profile/profileRepository';
import type { Profile } from '../profile/profileRepository';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

export interface AuthContextValue {
  status: AuthStatus;
  userId: string | null;
  /** The cached profile at once, then the server's; null until one exists (e.g. offline before the first read). */
  profile: Profile | null;
  /** Reads the profile again and updates the cache; a failed read keeps what is shown. */
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface State {
  status: AuthStatus;
  userId: string | null;
  profile: Profile | null;
}

/**
 * The stored session and its cached profile, read synchronously: an offline launch (or a slow
 * network) reaches the app without waiting for supabase-js's own session check. Without a cached
 * profile the status stays `loading` until the first read settles.
 */
function initialState(): State {
  const stored = readStoredSession();
  if (stored === null) {
    return { status: 'loading', userId: null, profile: null };
  }
  const profile = readCachedProfileSync(stored.userId);
  return { status: profile === null ? 'loading' : 'signedIn', userId: stored.userId, profile };
}

const SIGNED_OUT: State = { status: 'signedOut', userId: null, profile: null };

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [state, setState] = useState<State>(initialState);
  // Drops a slow read that resolves after a sign-out or an account switch.
  const currentUserIdRef = useRef<string | null>(state.userId);
  const failedReadRef = useRef(false);

  const loadProfile = useCallback(async (userId: string): Promise<void> => {
    const result = await fetchProfile();
    if (currentUserIdRef.current !== userId) {
      return;
    }
    failedReadRef.current = !result.ok;
    // A failed read keeps the cached profile; with none, the app still leaves `loading` rather than spin.
    setState((previous) => ({
      status: 'signedIn',
      userId,
      profile: result.ok ? result.value : previous.profile,
    }));
  }, []);

  useEffect(() => {
    const stopAutoRefresh = startAuthAutoRefresh();
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      let nextUserId = session?.user.id ?? null;
      // Offline launch: with an expired token supabase-js reports INITIAL_SESSION as null but keeps the
      // session and retries; the user stays signed in until TOKEN_REFRESHED or SIGNED_OUT.
      if (nextUserId === null && event === 'INITIAL_SESSION') {
        nextUserId = readStoredSession()?.userId ?? null;
      }

      if (nextUserId === null) {
        currentUserIdRef.current = null;
        failedReadRef.current = false;
        // The kv copy stays for an offline reopen; only the in-memory profile goes.
        setState(SIGNED_OUT);
        return;
      }

      // A recovery session isn't a sign-in: the reset screen must stay mounted.
      if (event === 'PASSWORD_RECOVERY') {
        return;
      }

      const userChanged = currentUserIdRef.current !== nextUserId;
      currentUserIdRef.current = nextUserId;
      if (userChanged) {
        const cached = readCachedProfileSync(nextUserId);
        setState({ status: cached === null ? 'loading' : 'signedIn', userId: nextUserId, profile: cached });
      }
      void loadProfile(nextUserId);
    });

    return () => {
      data.subscription.unsubscribe();
      stopAutoRefresh();
    };
  }, [loadProfile]);

  const refreshProfile = useCallback(async (): Promise<void> => {
    const userId = currentUserIdRef.current;
    if (userId !== null) {
      await loadProfile(userId);
    }
  }, [loadProfile]);

  // A launch read that failed offline would otherwise wait for the next token refresh (up to an hour).
  useOnResume(() => {
    if (failedReadRef.current) void refreshProfile();
  });

  const value = useMemo(
    () => ({ status: state.status, userId: state.userId, profile: state.profile, refreshProfile }),
    [state, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
