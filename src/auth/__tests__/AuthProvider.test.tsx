import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

type Session = { user: { id: string; email?: string } } | null;
let authStateCallback: ((event: string, session: Session) => void) | undefined;
const mockOnAuthStateChange = jest.fn((callback: typeof authStateCallback) => {
  authStateCallback = callback;
  return { data: { subscription: { unsubscribe: jest.fn() } } };
});
const mockReadStoredSession = jest.fn<{ userId: string; email: string | null } | null, []>(() => null);

jest.mock('../../lib/supabase', () => ({
  supabase: { auth: { onAuthStateChange: (cb: never) => mockOnAuthStateChange(cb) } },
  startAuthAutoRefresh: () => jest.fn(),
  readStoredSession: () => mockReadStoredSession(),
}));

let mockOnResume: () => void = () => undefined;
jest.mock('../../lib/useOnResume', () => ({
  useOnResume: (callback: () => void) => {
    mockOnResume = callback;
  },
}));

type Result = { ok: true; value: unknown } | { ok: false; kind: 'network' | 'invalid' | 'unknown' };
const mockFetchProfile = jest.fn<Promise<Result>, []>();
jest.mock('../../profile/profileRepository', () => {
  const actual = jest.requireActual<typeof import('../../profile/profileRepository')>('../../profile/profileRepository');
  return { ...actual, fetchProfile: () => mockFetchProfile() };
});

import { kvGet, kvRemove, kvSet } from '../../lib/kv';
import type { Profile } from '../../profile/profileRepository';
import { AuthProvider, useAuth } from '../AuthProvider';

const PROFILE: Profile = {
  language: 'en',
  timezone: null,
  theme: 'day',
  reduceMotion: false,
  notifyStart: '09:00:00',
  notifyEnd: '20:00:00',
  notifyDailyCap: 2,
  lockScreenDetail: false,
  adultConfirmedAt: '2026-11-01T10:00:00Z',
  boundaryAcceptedAt: '2026-11-01T10:00:00Z',
  aiConsentAnsweredAt: null,
  aiEnabled: false,
  onboardingCompletedAt: null,
};

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

beforeEach(() => {
  jest.clearAllMocks();
  authStateCallback = undefined;
  mockReadStoredSession.mockReturnValue(null);
  mockFetchProfile.mockReturnValue(new Promise(() => undefined));
  kvRemove('profile.u1');
  kvRemove('profile.u2');
});

test('offline with a stored session and a cached profile, the first render is signed in and never waits for the network', async () => {
  mockReadStoredSession.mockReturnValue({ userId: 'u1', email: 'ana@example.com' });
  kvSet('profile.u1', JSON.stringify(PROFILE));

  const { result } = await renderHook(() => useAuth(), { wrapper });

  expect(result.current.status).toBe('signedIn');
  expect(result.current.userId).toBe('u1');
  expect(result.current.profile).toEqual(PROFILE);
});

test('supabase-js reporting no session for an expired token keeps the stored user signed in', async () => {
  mockReadStoredSession.mockReturnValue({ userId: 'u1', email: null });
  kvSet('profile.u1', JSON.stringify(PROFILE));
  const { result } = await renderHook(() => useAuth(), { wrapper });

  await act(() => {
    authStateCallback?.('INITIAL_SESSION', null);
  });

  expect(result.current.status).toBe('signedIn');
  expect(result.current.profile).toEqual(PROFILE);
});

test('with a stored session and no cache, it is loading until the profile arrives', async () => {
  mockReadStoredSession.mockReturnValue({ userId: 'u1', email: null });
  let resolveFetch: (value: Result) => void = () => undefined;
  mockFetchProfile.mockReturnValue(new Promise((resolve) => (resolveFetch = resolve)));
  const { result } = await renderHook(() => useAuth(), { wrapper });
  await act(() => {
    authStateCallback?.('INITIAL_SESSION', null);
  });
  expect(result.current.status).toBe('loading');

  await act(() => {
    resolveFetch({ ok: true, value: PROFILE });
  });

  expect(result.current.status).toBe('signedIn');
  expect(result.current.profile).toEqual(PROFILE);
});

test('offline with no cache it still settles instead of spinning forever', async () => {
  mockReadStoredSession.mockReturnValue({ userId: 'u1', email: null });
  mockFetchProfile.mockResolvedValue({ ok: false, kind: 'network' });
  const { result } = await renderHook(() => useAuth(), { wrapper });
  await act(() => {
    authStateCallback?.('INITIAL_SESSION', null);
  });

  await waitFor(() => {
    expect(result.current.status).toBe('signedIn');
  });
  expect(result.current.profile).toBeNull();
});

test('the background refresh replaces the cached profile', async () => {
  mockReadStoredSession.mockReturnValue({ userId: 'u1', email: null });
  kvSet('profile.u1', JSON.stringify(PROFILE));
  mockFetchProfile.mockResolvedValue({ ok: true, value: { ...PROFILE, theme: 'dim' } });
  const { result } = await renderHook(() => useAuth(), { wrapper });
  await act(() => {
    authStateCallback?.('INITIAL_SESSION', null);
  });

  await waitFor(() => {
    expect(result.current.profile?.theme).toBe('dim');
  });
});

test('a failed refresh keeps the cached profile on screen', async () => {
  mockReadStoredSession.mockReturnValue({ userId: 'u1', email: null });
  kvSet('profile.u1', JSON.stringify(PROFILE));
  mockFetchProfile.mockResolvedValue({ ok: false, kind: 'network' });
  const { result } = await renderHook(() => useAuth(), { wrapper });
  await act(() => {
    authStateCallback?.('INITIAL_SESSION', null);
  });

  expect(result.current.status).toBe('signedIn');
  expect(result.current.profile).toEqual(PROFILE);
});

test('with no stored session, a null INITIAL_SESSION signs out without a read', async () => {
  const { result } = await renderHook(() => useAuth(), { wrapper });
  await act(() => {
    authStateCallback?.('INITIAL_SESSION', null);
  });

  expect(result.current.status).toBe('signedOut');
  expect(mockFetchProfile).not.toHaveBeenCalled();
});

test('sign-out clears the profile from memory but keeps the cache for an offline reopen', async () => {
  mockReadStoredSession.mockReturnValue({ userId: 'u1', email: null });
  kvSet('profile.u1', JSON.stringify(PROFILE));
  const { result } = await renderHook(() => useAuth(), { wrapper });

  await act(() => {
    authStateCallback?.('SIGNED_OUT', null);
  });

  expect(result.current).toMatchObject({ status: 'signedOut', userId: null, profile: null });
  const { readCachedProfileSync } = await import('../../profile/profileRepository');
  expect(readCachedProfileSync('u1')).toEqual(PROFILE);
});

test("a different user signing in never sees the previous user's cached profile", async () => {
  mockReadStoredSession.mockReturnValue({ userId: 'u1', email: null });
  kvSet('profile.u1', JSON.stringify(PROFILE));
  const { result } = await renderHook(() => useAuth(), { wrapper });
  await act(() => {
    authStateCallback?.('SIGNED_OUT', null);
  });

  await act(() => {
    authStateCallback?.('SIGNED_IN', { user: { id: 'u2' } });
  });

  expect(result.current.userId).toBe('u2');
  expect(result.current.profile).toBeNull();
  expect(result.current.status).toBe('loading');
});

test('a slow read for a user who signed out meanwhile is dropped', async () => {
  let resolveFetch: (value: Result) => void = () => undefined;
  mockFetchProfile.mockReturnValue(new Promise((resolve) => (resolveFetch = resolve)));
  const { result } = await renderHook(() => useAuth(), { wrapper });
  await act(() => {
    authStateCallback?.('SIGNED_IN', { user: { id: 'u1' } });
  });
  await act(() => {
    authStateCallback?.('SIGNED_OUT', null);
  });

  await act(() => {
    resolveFetch({ ok: true, value: PROFILE });
  });

  expect(result.current).toMatchObject({ status: 'signedOut', profile: null });
});

test('a password-recovery session is not a sign-in', async () => {
  const { result } = await renderHook(() => useAuth(), { wrapper });
  await act(() => {
    authStateCallback?.('INITIAL_SESSION', null);
  });

  await act(() => {
    authStateCallback?.('PASSWORD_RECOVERY', { user: { id: 'u1' } });
  });

  expect(result.current.status).toBe('signedOut');
});

test('refreshProfile reads again, and coming back online retries a read that failed', async () => {
  mockReadStoredSession.mockReturnValue({ userId: 'u1', email: null });
  mockFetchProfile.mockResolvedValue({ ok: false, kind: 'network' });
  const { result } = await renderHook(() => useAuth(), { wrapper });
  await act(() => {
    authStateCallback?.('INITIAL_SESSION', null);
  });
  await waitFor(() => {
    expect(result.current.status).toBe('signedIn');
  });

  mockFetchProfile.mockResolvedValue({ ok: true, value: PROFILE });
  await act(() => {
    mockOnResume();
  });

  await waitFor(() => {
    expect(result.current.profile).toEqual(PROFILE);
  });
  mockFetchProfile.mockClear();
  await act(async () => {
    await result.current.refreshProfile();
  });
  expect(mockFetchProfile).toHaveBeenCalledTimes(1);
});

test('useAuth outside the provider throws', async () => {
  const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  await expect(renderHook(() => useAuth())).rejects.toThrow('useAuth must be used within an AuthProvider');
  spy.mockRestore();
});

test('the email comes from the stored session at once, then from the session event', async () => {
  mockReadStoredSession.mockReturnValue({ userId: 'u1', email: 'ana@example.com' });
  kvSet('profile.u1', JSON.stringify(PROFILE));
  const { result } = await renderHook(() => useAuth(), { wrapper });
  expect(result.current.email).toBe('ana@example.com');

  await act(() => {
    authStateCallback?.('USER_UPDATED', { user: { id: 'u1', email: 'ana.rios@example.com' } });
  });
  expect(result.current.email).toBe('ana.rios@example.com');
});

test('patchProfile shows a change at once and keeps the rest of the profile', async () => {
  mockReadStoredSession.mockReturnValue({ userId: 'u1', email: null });
  kvSet('profile.u1', JSON.stringify(PROFILE));
  const { result } = await renderHook(() => useAuth(), { wrapper });

  await act(() => {
    result.current.patchProfile({ theme: 'dim' });
  });
  expect(result.current.profile).toEqual({ ...PROFILE, theme: 'dim' });
});

test('a read that a local change overtook is dropped, not shown or cached, and the row is read again', async () => {
  mockReadStoredSession.mockReturnValue({ userId: 'u1', email: null });
  kvSet('profile.u1', JSON.stringify(PROFILE));
  let resolveFetch: (value: Result) => void = () => undefined;
  mockFetchProfile.mockReturnValueOnce(new Promise((resolve) => (resolveFetch = resolve)));
  const { result } = await renderHook(() => useAuth(), { wrapper });
  await act(() => {
    authStateCallback?.('INITIAL_SESSION', null);
  });
  expect(mockFetchProfile).toHaveBeenCalledTimes(1);

  await act(() => {
    result.current.patchProfile({ theme: 'dark' });
  });
  // The read went out before the change, so its row still says Day.
  await act(async () => {
    resolveFetch({ ok: true, value: { ...PROFILE, theme: 'day' } });
    await Promise.resolve();
  });

  expect(result.current.profile?.theme).toBe('dark');
  expect(JSON.parse(kvGet('profile.u1') ?? 'null')).toMatchObject({ theme: 'dark' });
  expect(mockFetchProfile).toHaveBeenCalledTimes(2);
});

test('a read that no change overtook is shown and cached', async () => {
  mockReadStoredSession.mockReturnValue({ userId: 'u1', email: null });
  kvSet('profile.u1', JSON.stringify(PROFILE));
  mockFetchProfile.mockResolvedValueOnce({ ok: true, value: { ...PROFILE, theme: 'dim' } });
  const { result } = await renderHook(() => useAuth(), { wrapper });
  await act(async () => {
    authStateCallback?.('INITIAL_SESSION', null);
    await Promise.resolve();
  });

  expect(result.current.profile?.theme).toBe('dim');
  expect(JSON.parse(kvGet('profile.u1') ?? 'null')).toMatchObject({ theme: 'dim' });
  expect(mockFetchProfile).toHaveBeenCalledTimes(1);
});
