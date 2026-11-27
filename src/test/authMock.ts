// A stand-in for `AuthProvider` in screen suites: `jest.mock('../auth/AuthProvider', () => require('../test/authMock'))`.
// `resetAuth()` in `beforeEach` signs in `user-1` with a consented profile; `setAuth` changes it.
import { useSyncExternalStore } from 'react';

import type { AuthContextValue } from '../auth/AuthProvider';
import type { Profile } from '../profile/profileRepository';

export const READY_PROFILE: Profile = {
  language: null,
  timezone: null,
  theme: 'day',
  reduceMotion: false,
  notifyStart: '09:00:00',
  notifyEnd: '20:00:00',
  notifyDailyCap: 2,
  lockScreenDetail: false,
  adultConfirmedAt: '2026-11-01T10:00:00Z',
  boundaryAcceptedAt: '2026-11-01T10:00:00Z',
  aiConsentAnsweredAt: '2026-11-01T10:01:00Z',
  aiEnabled: true,
  onboardingCompletedAt: '2026-11-01T10:05:00Z',
  knownTriggers: [],
  priority: null,
  trackPeriod: false,
};

let state: AuthContextValue;
const listeners = new Set<() => void>();

export function setAuth(patch: Partial<AuthContextValue>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function resetAuth(patch: Partial<AuthContextValue> = {}): AuthContextValue {
  state = {
    status: 'signedIn',
    userId: 'user-1',
    email: 'user-1@example.com',
    profile: READY_PROFILE,
    refreshProfile: jest.fn(() => Promise.resolve()),
    // Like the provider: merges into the current profile, so a screen re-renders with the change.
    patchProfile: jest.fn((change: Partial<Profile>) => {
      if (state.profile !== null) setAuth({ profile: { ...state.profile, ...change } });
    }),
    ...patch,
  };
  for (const listener of listeners) listener();
  return state;
}
resetAuth();

/** The value `useAuth()` returns now, for assertions outside a component. */
export function currentAuth(): AuthContextValue {
  return state;
}

export function useAuth(): AuthContextValue {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => state,
  );
}

export function AuthProvider({ children }: { children?: React.ReactNode }): React.ReactNode {
  return children;
}
