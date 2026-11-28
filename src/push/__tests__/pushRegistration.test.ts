jest.mock('../../lib/supabase', () => ({ supabase: {} }));
const mockConstants: { expoConfig: { extra?: { eas?: { projectId?: string } } } | null } = {
  expoConfig: { extra: { eas: { projectId: 'project-1' } } },
};
// A getter: the factory runs before `mockConstants` is initialized.
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return mockConstants.expoConfig;
    },
  },
}));
jest.mock('expo-crypto', () => ({ getRandomBytes: jest.fn((size: number) => new Uint8Array(size).fill(0x1a)) }));

import { getRandomBytes } from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { PUSH_CHANNEL_ID } from '../../../supabase/functions/_shared/push.ts';
import { kvGet, kvRemove, kvSet } from '../../lib/kv';
import {
  CLAIM_RESTART_MS,
  confirmPushClaim,
  flushPendingUnregister,
  forgetPushToken,
  forgetPushTokenLater,
  registerPush,
  resumePushClaim,
  type PushClient,
} from '../pushRegistration';
import {
  DEVICE_SECRET_KEY,
  deviceSecret,
  PENDING_CLAIM_KEY,
  PENDING_UNREGISTER_KEY,
  pushKey,
  readLastOutcome,
  readPendingClaim,
  readPendingUnregister,
  readPush,
  writePendingClaim,
  writePendingUnregister,
  writePush,
} from '../pushStore';
import { SIGNAL_CHANNEL_ID } from '../signalChannel';

const mocked = jest.mocked(Notifications);
const USER_ID = 'user-1';
const TOKEN = 'ExponentPushToken[device-1]';
const SECRET = '1a'.repeat(32);
// The mocked getRandomBytes fills every byte with 0x1a, so a 16-byte nonce reads like this.
const NONCE = '1a'.repeat(16);
const NOW = Date.parse('2026-11-28T12:00:00Z');
const MINE = { token: TOKEN, userId: USER_ID };

type Answer = { error: { message: string; code?: string } | null };
type InvokeAnswer = { data: unknown; error: Error | null };
type Unregister = { token: string; user_id: string; device_secret: string };
type Claim = Record<string, unknown>;

/** A supabase-js stand-in recording register_push_token calls, own-row deletes and the function calls. */
function fakeClient({
  register = { error: null },
  remove = { error: null },
  unregister = () => Promise.resolve({ data: null, error: null }),
  claim = () => Promise.resolve({ data: null, error: null }),
}: {
  register?: Answer;
  remove?: Answer | Promise<never>;
  unregister?: (body: Unregister) => Promise<InvokeAnswer>;
  claim?: (body: Claim) => Promise<InvokeAnswer>;
} = {}) {
  const registered: unknown[] = [];
  const deletes: { table: string; column: string; value: string }[] = [];
  const unregistered: Unregister[] = [];
  const claims: Claim[] = [];
  const client = {
    rpc: (name: string, args: unknown) => {
      if (name !== 'register_push_token') throw new Error(`unexpected rpc ${name}`);
      registered.push(args);
      return Promise.resolve(register);
    },
    functions: {
      invoke: (name: string, options: { body: Unregister & Claim }) => {
        if (name === 'push-claim') {
          claims.push(options.body);
          return claim(options.body);
        }
        if (name !== 'push-unregister') throw new Error(`unexpected function ${name}`);
        unregistered.push(options.body);
        return unregister(options.body);
      },
    },
    from: (table: string) => ({
      delete: () => ({
        eq: (column: string, value: string) => {
          deletes.push({ table, column, value });
          return remove instanceof Promise ? remove : Promise.resolve(remove);
        },
      }),
    }),
  } as unknown as PushClient;
  return { client, registered, deletes, unregistered, claims };
}

function deniedStatus(): Notifications.NotificationPermissionsStatus {
  return { granted: false, canAskAgain: false, status: 'denied', expires: 'never' } as unknown as Notifications.NotificationPermissionsStatus;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  for (const key of [pushKey(USER_ID), DEVICE_SECRET_KEY, PENDING_UNREGISTER_KEY, PENDING_CLAIM_KEY]) kvRemove(key);
  mockConstants.expoConfig = { extra: { eas: { projectId: 'project-1' } } };
});

test('the app’s channel id is the one the server sends on', () => {
  expect(SIGNAL_CHANNEL_ID).toBe(PUSH_CHANNEL_ID);
});

describe('deviceSecret', () => {
  test('is 256 random bits as hex, made once and kept device-wide', () => {
    expect(deviceSecret()).toBe(SECRET);
    expect(deviceSecret()).toBe(SECRET);
    expect(getRandomBytes).toHaveBeenCalledTimes(1);
    expect(getRandomBytes).toHaveBeenCalledWith(32);
    expect(kvGet(DEVICE_SECRET_KEY)).toBe(SECRET);
  });
});

describe('registerPush', () => {
  test('on Android the signals channel exists before the permission and the token are asked for', async () => {
    const android = jest.replaceProperty(Platform, 'OS', 'android');
    const order: string[] = [];
    mocked.setNotificationChannelAsync.mockImplementation((id) => {
      order.push(`channel:${id}`);
      return Promise.resolve(null);
    });
    mocked.getPermissionsAsync.mockImplementationOnce(() => {
      order.push('permission');
      return Promise.resolve({ granted: true, canAskAgain: true } as Notifications.NotificationPermissionsStatus);
    });
    mocked.getExpoPushTokenAsync.mockImplementationOnce(() => {
      order.push('token');
      return Promise.resolve({ type: 'expo', data: TOKEN });
    });

    expect(await registerPush(USER_ID, 'es', fakeClient().client)).toBe('saved');

    android.restore();
    mocked.setNotificationChannelAsync.mockImplementation(() => Promise.resolve(null));
    expect(order.indexOf('channel:signals')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('channel:signals')).toBeLessThan(order.indexOf('permission'));
    expect(order.indexOf('permission')).toBeLessThan(order.indexOf('token'));
    expect(mocked.setNotificationChannelAsync).toHaveBeenCalledWith('signals', { name: 'Notas de Nimbo', importance: Notifications.AndroidImportance.DEFAULT });
    // The lock screen keeps the system default: the copy carries the privacy.
    expect(mocked.setNotificationChannelAsync.mock.calls.find(([id]) => id === 'signals')?.[1]).not.toHaveProperty('lockscreenVisibility');
  });

  test('a granted permission fetches the token for the EAS project and registers it with the device secret', async () => {
    const { client, registered } = fakeClient();

    expect(await registerPush(USER_ID, 'en', client)).toBe('saved');

    expect(mocked.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'project-1' });
    expect(registered).toEqual([{ p_token: TOKEN, p_platform: 'ios', p_device_secret: SECRET }]);
    expect(readPush(USER_ID)).toEqual({ token: TOKEN });
    expect(readLastOutcome()).toBe('saved');
  });

  test('registering a token that was waiting to be unregistered takes it off the pending list', async () => {
    writePendingUnregister([MINE, { token: TOKEN, userId: 'user-0' }, { token: 'ExponentPushToken[other]', userId: USER_ID }]);
    expect(await registerPush(USER_ID, 'en', fakeClient().client)).toBe('saved');
    expect(readPendingUnregister()).toEqual([{ token: 'ExponentPushToken[other]', userId: USER_ID }]);
  });

  test('a denied permission returns denied, asks for no token and calls no RPC', async () => {
    mocked.getPermissionsAsync.mockResolvedValueOnce(deniedStatus());
    const { client, registered } = fakeClient();

    expect(await registerPush(USER_ID, 'en', client)).toBe('denied');

    expect(mocked.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(mocked.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(registered).toEqual([]);
    expect(readPush(USER_ID)).toEqual({ token: null });
  });

  test('an undetermined permission is asked once', async () => {
    mocked.getPermissionsAsync.mockResolvedValueOnce({ granted: false, canAskAgain: true, status: 'undetermined' } as unknown as Notifications.NotificationPermissionsStatus);
    expect(await registerPush(USER_ID, 'en', fakeClient().client)).toBe('saved');
    expect(mocked.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  test('a failing token call (no FCM config on this build) is "unavailable" and stores nothing', async () => {
    mocked.getExpoPushTokenAsync.mockRejectedValueOnce(new Error('Default FirebaseApp is not initialized'));
    const { client, registered } = fakeClient();

    expect(await registerPush(USER_ID, 'en', client)).toBe('unavailable');

    expect(registered).toEqual([]);
    expect(readPush(USER_ID)).toEqual({ token: null });
    expect(readLastOutcome()).toBe('unavailable');
  });

  test('without an EAS project id the token is never asked for', async () => {
    mockConstants.expoConfig = { extra: {} };
    expect(await registerPush(USER_ID, 'en', fakeClient().client)).toBe('unavailable');
    expect(mocked.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  test('a refused registration other than 42501 is "failed" and keeps what was stored', async () => {
    writePush(USER_ID, { token: TOKEN });
    const { client, claims } = fakeClient({ register: { error: { message: 'offline' } } });

    expect(await registerPush(USER_ID, 'en', client)).toBe('failed');

    expect(claims).toEqual([]);
    expect(readPush(USER_ID)).toEqual({ token: TOKEN });
  });

  test('a phone whose token changed drops the old row after saving the new one', async () => {
    writePush(USER_ID, { token: 'ExponentPushToken[old]' });
    const { client, deletes } = fakeClient();

    expect(await registerPush(USER_ID, 'en', client)).toBe('saved');

    expect(deletes).toEqual([{ table: 'push_tokens', column: 'token', value: 'ExponentPushToken[old]' }]);
    expect(readPush(USER_ID)).toEqual({ token: TOKEN });
  });
});

describe('forgetting the token', () => {
  test('forgetPushTokenLater queues the token for push-unregister and forgets it for the account (offline: no call)', () => {
    writePush(USER_ID, { token: TOKEN });

    forgetPushTokenLater(USER_ID);

    expect(readPendingUnregister()).toEqual([MINE]);
    expect(readPush(USER_ID)).toEqual({ token: null });
  });

  test('forgetPushTokenLater drops this account’s claim in flight and does nothing without a token', () => {
    writePendingClaim({ userId: USER_ID, token: TOKEN, platform: 'ios', nonce: NONCE, startedAt: NOW });
    forgetPushTokenLater(USER_ID);
    expect(readPendingClaim()).toBeNull();
    expect(readPendingUnregister()).toEqual([]);
  });

  test('forgetPushToken deletes the own row with the session', async () => {
    writePush(USER_ID, { token: TOKEN });
    const { client, deletes, unregistered } = fakeClient();

    await forgetPushToken(USER_ID, client);

    expect(deletes).toEqual([{ table: 'push_tokens', column: 'token', value: TOKEN }]);
    expect(unregistered).toEqual([]);
    expect(readPush(USER_ID)).toEqual({ token: null });
    expect(readPendingUnregister()).toEqual([]);
  });

  test('forgetPushToken offline leaves the token pending', async () => {
    writePush(USER_ID, { token: TOKEN });
    await forgetPushToken(USER_ID, fakeClient({ remove: { error: { message: 'offline' } } }).client);
    expect(readPendingUnregister()).toEqual([MINE]);
  });

  test('a stalled network gives up after the timeout and keeps the token pending', async () => {
    jest.useFakeTimers();
    try {
      writePush(USER_ID, { token: TOKEN });
      const pending = forgetPushToken(USER_ID, fakeClient({ remove: new Promise<never>(() => undefined) }).client);
      await jest.advanceTimersByTimeAsync(5_000);
      await pending;
      expect(readPendingUnregister()).toEqual([MINE]);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('flushPendingUnregister', () => {
  test('unregisters each pending token with the device secret and drops it', async () => {
    writePush(USER_ID, { token: TOKEN });
    forgetPushTokenLater(USER_ID);
    const online = fakeClient();

    await flushPendingUnregister(online.client);

    expect(online.unregistered).toEqual([{ token: TOKEN, user_id: USER_ID, device_secret: SECRET }]);
    expect(readPendingUnregister()).toEqual([]);
  });

  test('a token that fails again stays for the next try; the others go', async () => {
    writePendingUnregister([
      { token: 'ExponentPushToken[one]', userId: USER_ID },
      { token: 'ExponentPushToken[two]', userId: USER_ID },
    ]);
    const { client } = fakeClient({
      unregister: ({ token }) => Promise.resolve({ data: null, error: token === 'ExponentPushToken[one]' ? new Error('500') : null }),
    });

    await flushPendingUnregister(client);

    expect(readPendingUnregister()).toEqual([{ token: 'ExponentPushToken[one]', userId: USER_ID }]);
  });

  test('nothing pending: no call; a rejected call never throws', async () => {
    const idle = fakeClient();
    await flushPendingUnregister(idle.client);
    expect(idle.unregistered).toEqual([]);

    writePendingUnregister([MINE]);
    await expect(flushPendingUnregister(fakeClient({ unregister: () => Promise.reject(new TypeError('x')) }).client)).resolves.toBeUndefined();
    expect(readPendingUnregister()).toEqual([MINE]);
  });
});

describe('reclaiming a token another device holds', () => {
  const CLAIMED = { userId: USER_ID, token: TOKEN, platform: 'ios' as const, nonce: NONCE, startedAt: NOW };

  test('a 42501 refusal starts a claim with a fresh nonce and answers "verifying"', async () => {
    const { client, claims } = fakeClient({ register: { error: { message: 'another device holds this token', code: '42501' } } });

    expect(await registerPush(USER_ID, 'en', client)).toBe('verifying');

    expect(claims).toEqual([{ token: TOKEN, step: 'start', nonce: NONCE }]);
    expect(readPendingClaim()).toEqual(CLAIMED);
    expect(readPush(USER_ID).token).toBeNull();
  });

  test('the code with this claim’s nonce confirms it with the device secret, and the token is saved', async () => {
    writePendingClaim(CLAIMED);
    writePendingUnregister([MINE]);
    const { client, claims } = fakeClient();

    expect(await confirmPushClaim('K7M2P9QX', NONCE, USER_ID, client)).toBe(true);

    expect(claims).toEqual([{ token: TOKEN, step: 'confirm', code: 'K7M2P9QX', nonce: NONCE, device_secret: SECRET, platform: 'ios' }]);
    expect(readPendingClaim()).toBeNull();
    expect(readPush(USER_ID)).toEqual({ token: TOKEN });
    expect(readPendingUnregister()).toEqual([]);
  });

  test('a code carrying another claim’s nonce is ignored and spends no attempt', async () => {
    writePendingClaim(CLAIMED);
    const { client, claims } = fakeClient();
    expect(await confirmPushClaim('ATTACK23', 'ff'.repeat(16), USER_ID, client)).toBe(false);
    expect(claims).toEqual([]);
    expect(readPendingClaim()).toEqual(CLAIMED);
  });

  test('a refused code keeps the claim for a retry at the next launch', async () => {
    writePendingClaim(CLAIMED);
    const { client } = fakeClient({ claim: () => Promise.resolve({ data: null, error: new Error('403') }) });
    expect(await confirmPushClaim('WRNGXY23', NONCE, USER_ID, client)).toBe(false);
    expect(readPendingClaim()).toEqual(CLAIMED);
  });

  test('a launch 10 minutes after the last start asks for a new code with the same nonce, and drops another account’s claim', async () => {
    const OTHER_NONCE = 'cd'.repeat(16);
    writePendingClaim({ ...CLAIMED, nonce: OTHER_NONCE, startedAt: NOW - CLAIM_RESTART_MS });
    const mine = fakeClient();
    await resumePushClaim(USER_ID, mine.client);
    expect(mine.claims).toEqual([{ token: TOKEN, step: 'start', nonce: OTHER_NONCE }]);
    expect(readPendingClaim()).toEqual({ ...CLAIMED, nonce: OTHER_NONCE, startedAt: NOW });

    const theirs = fakeClient();
    await resumePushClaim('user-2', theirs.client);
    expect(theirs.claims).toEqual([]);
    expect(readPendingClaim()).toBeNull();
  });

  test('a launch within 10 minutes of the last start asks for nothing: that start’s code may still arrive', async () => {
    writePendingClaim({ ...CLAIMED, startedAt: NOW - CLAIM_RESTART_MS + 1 });
    const { client, claims } = fakeClient();
    await resumePushClaim(USER_ID, client);
    expect(claims).toEqual([]);
  });

  test('a pending claim and another 42501 leave the nonce alone and start nothing', async () => {
    const KEPT = { ...CLAIMED, nonce: 'cd'.repeat(16), startedAt: NOW - 60_000 };
    writePendingClaim(KEPT);
    const { client, claims } = fakeClient({ register: { error: { message: 'another device holds this token', code: '42501' } } });

    expect(await registerPush(USER_ID, 'en', client)).toBe('verifying');

    expect(claims).toEqual([]);
    expect(readPendingClaim()).toEqual(KEPT);
  });

  test('onboarding’s "Allow", then Today mounting its syncs, starts the claim once', async () => {
    const { client, claims } = fakeClient({ register: { error: { message: 'another device holds this token', code: '42501' } } });

    // Onboarding fires its registration without waiting; the syncs mount while it is still in flight.
    const fromOnboarding = registerPush(USER_ID, 'en', client);
    const fromPushSync = registerPush(USER_ID, 'en', client);
    const fromClaimSync = resumePushClaim(USER_ID, client);
    expect(await Promise.all([fromOnboarding, fromPushSync, fromClaimSync])).toEqual(['verifying', 'verifying', undefined]);

    expect(claims).toEqual([{ token: TOKEN, step: 'start', nonce: NONCE }]);
    expect(readPendingClaim()).toEqual(CLAIMED);
  });

  test('a token another account claims is a different claim: it starts afresh', async () => {
    writePendingClaim({ ...CLAIMED, token: 'ExponentPushToken[old]' });
    const { client, claims } = fakeClient({ register: { error: { message: 'another device holds this token', code: '42501' } } });
    expect(await registerPush(USER_ID, 'en', client)).toBe('verifying');
    expect(claims).toEqual([{ token: TOKEN, step: 'start', nonce: NONCE }]);
  });
});

describe('the pending unregister list', () => {
  test('an older build’s bare tokens, with no account, are dropped rather than sent without one', async () => {
    kvSet(PENDING_UNREGISTER_KEY, JSON.stringify([TOKEN, MINE, 42]));
    expect(readPendingUnregister()).toEqual([MINE]);

    const { client, unregistered } = fakeClient();
    await flushPendingUnregister(client);
    expect(unregistered).toEqual([{ token: TOKEN, user_id: USER_ID, device_secret: SECRET }]);
    expect(kvGet(PENDING_UNREGISTER_KEY)).toBeNull();
  });

  test('two accounts’ entries for the same token are each sent with their own account', async () => {
    writePendingUnregister([MINE, { token: TOKEN, userId: 'user-2' }, MINE]);
    const { client, unregistered } = fakeClient();
    await flushPendingUnregister(client);
    expect(unregistered.map((body) => body.user_id)).toEqual([USER_ID, 'user-2']);
  });
});
