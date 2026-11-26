// The cache across the real provider, hook and repository: only the supabase client is faked.
import { act, renderHook } from '@testing-library/react-native';
import type { ReactNode } from 'react';

type Answer = (outcome: { data: unknown; error: null; status: number }) => void;
const mockAnswers: Answer[] = [];
jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }) },
    // Every update waits until the test answers it, in whatever order the test picks.
    from: () => ({
      update: () => ({
        not: () => ({
          select: () => ({
            single: () =>
              new Promise((resolve) => {
                mockAnswers.push(resolve);
              }),
          }),
        }),
      }),
    }),
  },
  startAuthAutoRefresh: () => () => undefined,
  readStoredSession: () => ({ userId: 'u1', email: null }),
}));
jest.mock('../../lib/useOnResume', () => ({ useOnResume: () => undefined }));

import { AuthProvider, useAuth } from '../../auth/AuthProvider';
import { kvGet, kvSet } from '../../lib/kv';
import { useProfileChange } from '../useProfileChange';

const ROW = {
  user_id: 'u1',
  language: null,
  timezone: 'Europe/Madrid',
  theme: 'day',
  reduce_motion: false,
  notify_start: '09:00:00',
  notify_end: '20:00:00',
  notify_daily_cap: 2,
  lock_screen_detail: false,
  adult_confirmed_at: '2026-11-01T10:00:00Z',
  boundary_accepted_at: '2026-11-01T10:00:00Z',
  ai_consent_answered_at: '2026-11-01T10:01:00Z',
  ai_enabled: true,
  onboarding_completed_at: null,
};
const PROFILE = {
  language: null,
  timezone: 'Europe/Madrid',
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
  onboardingCompletedAt: null,
};

function wrapper({ children }: { children: ReactNode }): React.JSX.Element {
  return <AuthProvider>{children}</AuthProvider>;
}

async function answer(index: number, theme: string): Promise<void> {
  await act(async () => {
    mockAnswers.at(index)?.({ data: { ...ROW, theme }, error: null, status: 200 });
    await Promise.resolve();
  });
}

const cachedTheme = (): unknown => (JSON.parse(kvGet('profile.u1') ?? 'null') as { theme?: unknown } | null)?.theme;

test('an older write answering after a newer one leaves both the screen and the cache on the newer value', async () => {
  kvSet('profile.u1', JSON.stringify(PROFILE));
  const { result } = await renderHook(() => ({ auth: useAuth(), change: useProfileChange().change }), { wrapper });

  await act(() => {
    void result.current.change({ theme: 'dark' });
  });
  await act(() => {
    void result.current.change({ theme: 'dim' });
  });
  await answer(1, 'dim');
  await answer(0, 'dark');

  expect(result.current.auth.profile?.theme).toBe('dim');
  // What an offline relaunch would open on.
  expect(cachedTheme()).toBe('dim');
});
