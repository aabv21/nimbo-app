import { act, render, renderHook, screen, waitFor } from '@testing-library/react-native';
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

jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() } }));
jest.mock('expo-sqlite', () => require('../../test/sqliteNode'));

import UrgentCare from '../../app/urgent-care';
import { translate } from '../../i18n';
import { markDeletion } from '../../account/deletionMarker';
import { allowUserKeys, kvGet, kvRemove, kvSet, kvUserRefused, refuseUserKeys } from '../../lib/kv';
import { completeOp, enqueue, listOutbox } from '../../lib/outbox/outbox';
import { clearLocalDb } from '../../test/localDbTest';
import { nextRoute } from '../gate';
import type { Profile } from '../../profile/profileRepository';
import { currentUrgentCare, showUrgentCare } from '../../redflags/urgentCare';
import { AuthProvider, useAuth } from '../AuthProvider';
import { currentUserId, setCurrentUserId } from '../currentUser';

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
  knownTriggers: [],
  priority: null,
  trackPeriod: false,
  termsVersion: '2026-12-01',
  aiConsentVersion: null,
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
  clearLocalDb();
});

test('offline with a stored session and a cached profile, the first render is signed in and never waits for the network', async () => {
  mockReadStoredSession.mockReturnValue({ userId: 'u1', email: 'ana@example.com' });
  kvSet('profile.u1', JSON.stringify(PROFILE));

  const { result } = await renderHook(() => useAuth(), { wrapper });

  expect(result.current.status).toBe('signedIn');
  expect(result.current.userId).toBe('u1');
  expect(result.current.profile).toEqual(PROFILE);
});

test('at a cold start the stored user is the current user before any auth event, so work settling early is kept', async () => {
  setCurrentUserId(null);
  mockReadStoredSession.mockReturnValue({ userId: 'u1', email: null });
  await renderHook(() => useAuth(), { wrapper });
  expect(authStateCallback).toBeDefined();
  expect(currentUserId()).toBe('u1');
});

test('with no stored session the current user stays null until a sign-in', async () => {
  setCurrentUserId('stale');
  await renderHook(() => useAuth(), { wrapper });
  expect(currentUserId()).toBeNull();
  await act(() => {
    authStateCallback?.('SIGNED_IN', { user: { id: 'u2' } });
  });
  expect(currentUserId()).toBe('u2');
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

describe('an account deletion', () => {
  test("a sign-out drops the data of an account still marked deleting (the server may have finished)", async () => {
    mockReadStoredSession.mockReturnValue({ userId: 'u1', email: null });
    kvSet('profile.u1', JSON.stringify(PROFILE));
    markDeletion('u1', 'deleting');
    await renderHook(() => useAuth(), { wrapper });

    await act(() => {
      authStateCallback?.('SIGNED_OUT', null);
    });

    expect(kvGet('profile.u1')).toBeNull();
    expect(kvGet('account.deleting.u1')).toBeNull();
    allowUserKeys('u1');
  });

  test('a sign-in of the same account again lifts the kv refusal, since it still exists', async () => {
    refuseUserKeys('u2');
    await renderHook(() => useAuth(), { wrapper });

    await act(() => {
      authStateCallback?.('SIGNED_IN', { user: { id: 'u2' } });
    });

    expect(kvUserRefused('u2')).toBe(false);
  });
});

const EXCERPT = 'the worst headache of my life';

test('sign-out forgets a pending urgent-care request, so the screen shows no excerpt', async () => {
  mockReadStoredSession.mockReturnValue({ userId: 'u1', email: null });
  kvSet('profile.u1', JSON.stringify(PROFILE));
  await renderHook(() => useAuth(), { wrapper });
  showUrgentCare({ flags: ['thunderclap'], excerpt: EXCERPT, source: 'text', episodeId: null });

  await act(() => {
    authStateCallback?.('SIGNED_OUT', null);
  });

  expect(currentUrgentCare()).toBeNull();
  await render(<UrgentCare />);
  expect(screen.queryByText(translate('en', 'redflag.excerpt', { text: EXCERPT }))).toBeNull();
});

test('an account switch forgets a pending urgent-care request', async () => {
  const { result } = await renderHook(() => useAuth(), { wrapper });
  await act(() => {
    authStateCallback?.('SIGNED_IN', { user: { id: 'u1' } });
  });
  showUrgentCare({ flags: ['thunderclap'], excerpt: EXCERPT, source: 'text', episodeId: null });

  await act(() => {
    authStateCallback?.('SIGNED_IN', { user: { id: 'u2' } });
  });

  expect(result.current.userId).toBe('u2');
  expect(currentUrgentCare()).toBeNull();
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

// Finishing onboarding is queued (it works offline); the server's row says null until the outbox sends it.
describe('a finish of onboarding still in the outbox', () => {
  const FINISHED_HERE = '2026-11-27T10:00:00.000Z';
  const SERVER_STAMP = '2026-11-27T10:00:05.000Z';
  const SETTING_UP: Profile = { ...PROFILE, aiConsentAnsweredAt: '2026-11-01T10:01:00Z' };

  async function launchWith(fetched: Profile, cached: Profile | null): Promise<{ current: ReturnType<typeof useAuth> }> {
    mockReadStoredSession.mockReturnValue({ userId: 'u1', email: null });
    if (cached !== null) kvSet('profile.u1', JSON.stringify(cached));
    mockFetchProfile.mockResolvedValue({ ok: true, value: fetched });
    const { result } = await renderHook(() => useAuth(), { wrapper });
    await act(() => {
      authStateCallback?.('INITIAL_SESSION', null);
    });
    await waitFor(() => {
      expect(mockFetchProfile).toHaveBeenCalled();
    });
    await act(async () => {
      await Promise.resolve();
    });
    return result;
  }

  test('a read that still says null keeps the stamp made on the phone, so the user stays on Today', async () => {
    enqueue('u1', 'complete_onboarding', {});
    const result = await launchWith(SETTING_UP, { ...SETTING_UP, onboardingCompletedAt: FINISHED_HERE });

    expect(result.current.profile?.onboardingCompletedAt).toBe(FINISHED_HERE);
    expect(nextRoute(result.current, { introSeen: true })).toBe('/today');
  });

  test('with no cached copy, the queued finish still stamps the profile', async () => {
    const op = enqueue('u1', 'complete_onboarding', {});
    const result = await launchWith(SETTING_UP, null);

    expect(result.current.profile?.onboardingCompletedAt).toBe(new Date(op.createdAt).toISOString());
    expect(nextRoute(result.current, { introSeen: true })).toBe('/today');
  });

  test('once it is sent, the server stamp replaces the phone one and nothing else changes', async () => {
    const op = enqueue('u1', 'complete_onboarding', {});
    completeOp(op);
    expect(listOutbox('u1')).toEqual([]);
    const result = await launchWith({ ...SETTING_UP, onboardingCompletedAt: SERVER_STAMP }, { ...SETTING_UP, onboardingCompletedAt: FINISHED_HERE });

    expect(result.current.profile?.onboardingCompletedAt).toBe(SERVER_STAMP);
    expect(nextRoute(result.current, { introSeen: true })).toBe('/today');
  });

  test('a call sent while the read is out still leaves the stamp: the read began before the server had it', async () => {
    const op = enqueue('u1', 'complete_onboarding', {});
    mockReadStoredSession.mockReturnValue({ userId: 'u1', email: null });
    kvSet('profile.u1', JSON.stringify({ ...SETTING_UP, onboardingCompletedAt: FINISHED_HERE }));
    let resolveFetch: (value: Result) => void = () => undefined;
    mockFetchProfile.mockReturnValue(new Promise((resolve) => (resolveFetch = resolve)));
    const { result } = await renderHook(() => useAuth(), { wrapper });
    await act(() => {
      authStateCallback?.('INITIAL_SESSION', null);
    });
    expect(mockFetchProfile).toHaveBeenCalledTimes(1);

    // The outbox delivers and removes the call before the read, which the server answered first, resolves.
    completeOp(op);
    await act(async () => {
      resolveFetch({ ok: true, value: SETTING_UP });
      await Promise.resolve();
    });

    expect(result.current.profile?.onboardingCompletedAt).toBe(FINISHED_HERE);
    expect(nextRoute(result.current, { introSeen: true })).toBe('/today');
  });

  test('without a queued finish, the server null stands', async () => {
    const result = await launchWith(SETTING_UP, { ...SETTING_UP, onboardingCompletedAt: FINISHED_HERE });

    expect(result.current.profile?.onboardingCompletedAt).toBeNull();
  });
});
