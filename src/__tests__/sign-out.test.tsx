// Signing out from the root layout, with the real auth, sync and reminder providers: everything of the session
// leaves the phone except the records still waiting to upload, which stay for that user's return.
import { act } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';

import { signOut } from '../auth/authService';
import { translate } from '../i18n';
import { translatePlural } from '../i18n/plural';
import { kvGet, kvSet } from '../lib/kv';
import { localDb } from '../lib/local/db';
import { enqueue, listOutbox } from '../lib/outbox/outbox';
import { markIntroSeen } from '../onboarding/introSeen';
import { currentUrgentCare, showUrgentCare } from '../redflags/urgentCare';
import { READY_PROFILE } from '../test/authMock';
import { clearLocalDb, insertEpisode } from '../test/localDbTest';

type Session = { user: { id: string; email?: string } } | null;
const mockAuth: { callback: ((event: string, session: Session) => void) | null; stored: { userId: string; email: string | null } | null } = {
  callback: null,
  stored: { userId: 'user-1', email: 'user-1@example.com' },
};
jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (callback: (event: string, session: Session) => void) => {
        mockAuth.callback = callback;
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
    },
    // Offline: every send gets no answer, so the queued operation stays queued.
    rpc: jest.fn(() => Promise.reject(new TypeError('Network request failed'))),
  },
  startAuthAutoRefresh: () => () => undefined,
  readStoredSession: () => mockAuth.stored,
}));
jest.mock('../lib/sync/pull', () => ({ pullAll: jest.fn(() => Promise.resolve({ ok: false, kind: 'network' })) }));
jest.mock('../auth/authService', () => ({
  signInWithEmail: jest.fn(),
  signInWithApple: jest.fn(),
  signInWithGoogle: jest.fn(),
  resendSignUpCode: jest.fn(),
  signOut: jest.fn(() => Promise.resolve({ ok: true })),
  isGoogleSignInConfigured: jest.fn(() => false),
}));
jest.mock('../profile/profileRepository', () => {
  const actual = jest.requireActual<typeof import('../profile/profileRepository')>('../profile/profileRepository');
  // The tab shell saves the phone's time zone on mount; that request never answers here.
  return { ...actual, fetchProfile: jest.fn(() => new Promise(() => undefined)), updateProfile: jest.fn(() => new Promise(() => undefined)) };
});
jest.mock('expo-sqlite', () => require('../test/sqliteNode'));
jest.mock('expo-crypto', () => ({ randomUUID: () => (require('node:crypto') as typeof import('node:crypto')).randomUUID() }));
jest.mock('expo-font', () => ({ useFonts: () => [true, null] }));
jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve()),
  hideAsync: jest.fn(() => Promise.resolve()),
}));

// expo-router's test helpers replace the Reanimated mock on import; fill it in from the shared mock (as in smoke.test.tsx).
const reanimated = jest.requireMock<object>('react-native-reanimated');
Object.assign(reanimated, jest.requireActual<object>('../test/reanimatedMock'));
Object.defineProperty(reanimated, '__esModule', { value: true });

const REMINDER = 'preventive-reminder:user-1:med-1:0';
const DELIVERED = 'preventive-reminder:user-1:med-1:1';

// The OS's lists: what the app scheduled, and what is in the tray.
const scheduled = new Map<string, Notifications.NotificationRequest>();
const presented: string[] = [DELIVERED, 'another-app-alert'];

beforeEach(() => {
  clearLocalDb();
  markIntroSeen();
  kvSet('profile.user-1', JSON.stringify(READY_PROFILE));
  jest.mocked(Notifications.scheduleNotificationAsync).mockImplementation((request) => {
    const identifier = request.identifier ?? '';
    scheduled.set(identifier, { identifier, content: request.content, trigger: null } as Notifications.NotificationRequest);
    return Promise.resolve(identifier);
  });
  jest.mocked(Notifications.getAllScheduledNotificationsAsync).mockImplementation(() => Promise.resolve([...scheduled.values()]));
  jest.mocked(Notifications.cancelScheduledNotificationAsync).mockImplementation((identifier) => {
    scheduled.delete(identifier);
    return Promise.resolve();
  });
  jest.mocked(Notifications.getPresentedNotificationsAsync).mockImplementation(() =>
    Promise.resolve(presented.map((identifier) => ({ date: 0, request: { identifier, content: {}, trigger: null } }) as unknown as Notifications.Notification)),
  );
  jest.mocked(Notifications.dismissNotificationAsync).mockImplementation((identifier) => {
    presented.splice(presented.indexOf(identifier), 1);
    return Promise.resolve();
  });
});

function episodeIds(): string[] {
  return localDb()
    .getAllSync<{ id: string }>("SELECT id FROM episodes WHERE user_id = 'user-1' ORDER BY id;")
    .map((row) => row.id);
}

test('signing out with a record not uploaded asks first, then clears the session and keeps only that record', async () => {
  // Open attacks from an hour ago: a fixed start date ages past the long-attack watch's hours as the calendar moves on,
  // and the mounted watch would then open urgent care in the middle of this test.
  const anHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  insertEpisode('user-1', 'clean-episode', anHourAgo);
  // Changed as crisis mode would, then left unsent: the phone is offline.
  insertEpisode('user-1', 'pending-episode', anHourAgo);
  localDb().withTransactionSync(() => {
    localDb().runSync("UPDATE episodes SET intensity = 6 WHERE id = 'pending-episode';");
    enqueue('user-1', 'update_episode', { p_id: 'pending-episode', p_fields: { intensity: 6 } });
  });
  // A preventive medication with a daily reminder, already synced.
  localDb().runSync(
    "INSERT INTO medications (id, user_id, name, kind, class, schedule, schedule_time) VALUES ('med-1', 'user-1', 'Propranolol', 'preventive', 'other', 'daily', '08:00:00');",
  );
  // The agent's notes, cached from an online visit to "What I know about you": the user's words about themselves.
  kvSet('memory.user-1', JSON.stringify([{ id: 'n1', text: 'Works night shifts on Thursdays', createdAt: '2026-11-20T10:00:00Z' }]));
  // Debriefs finished on this phone.
  kvSet('debrief.done.user-1', JSON.stringify(['clean-episode']));

  await renderRouter('./src/app', { initialUrl: '/profile' });
  expect(await screen.findByRole('header', { name: translate('en', 'profile.title') })).toBeOnTheScreen();
  await waitFor(() => {
    expect(scheduled.has(REMINDER)).toBe(true);
  });
  // A red-flag hand-off still waiting, with what the user wrote (opened without moving this test off Profile).
  const push = jest.spyOn(router, 'push').mockImplementation(() => undefined);
  showUrgentCare({ flags: ['weakness'], excerpt: 'my arm is numb', source: 'text', episodeId: null });
  push.mockRestore();

  await fireEvent.press(screen.getByRole('button', { name: translate('en', 'profile.signOut') }));
  expect(screen.getByText(translatePlural('en', 'profile.signOut.pending', 1))).toBeOnTheScreen();
  expect(signOut).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: translate('en', 'profile.signOut') }));
  expect(signOut).toHaveBeenCalledTimes(1);

  // What supabase-js does once the sign-out request returns.
  await act(async () => {
    mockAuth.stored = null;
    mockAuth.callback?.('SIGNED_OUT', null);
    await Promise.resolve();
  });

  expect(await screen.findByRole('header', { name: translate('en', 'auth.signIn.title') })).toBeOnTheScreen();
  await waitFor(() => {
    expect(episodeIds()).toEqual(['pending-episode']);
  });
  expect(listOutbox('user-1').map((op) => op.kind)).toEqual(['update_episode']);
  // The cached notes and the debriefs marked done leave whatever the outbox holds.
  expect(kvGet('memory.user-1')).toBeNull();
  expect(kvGet('debrief.done.user-1')).toBeNull();
  expect(localDb().getAllSync("SELECT id FROM medications WHERE user_id = 'user-1';")).toEqual([]);
  expect(scheduled.has(REMINDER)).toBe(false);
  expect(presented).toEqual(['another-app-alert']);
  expect(currentUrgentCare()).toBeNull();
  // Kept while the record waits, so this account can reopen offline and send it.
  expect(kvGet('profile.user-1')).not.toBeNull();
});
