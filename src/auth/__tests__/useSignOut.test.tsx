import { act, renderHook } from '@testing-library/react-native';

const mockSignOut = jest.fn<Promise<unknown>, []>();
jest.mock('../authService', () => ({ signOut: () => mockSignOut() }));
const mockForget = jest.fn<Promise<void>, [string]>(() => Promise.resolve());
jest.mock('../../push/pushRegistration', () => ({ forgetPushToken: (userId: string) => mockForget(userId) }));

import { setCurrentUserId } from '../currentUser';
import { FORGET_PUSH_WAIT_MS, useSignOut } from '../useSignOut';

beforeEach(() => {
  jest.clearAllMocks();
  setCurrentUserId('user-1');
});

test('tracks the pending request and clears it when sign-out succeeds', async () => {
  let finish: (value: { ok: true }) => void = () => undefined;
  mockSignOut.mockReturnValue(new Promise((resolve) => (finish = resolve)));
  const { result } = await renderHook(() => useSignOut());

  await act(() => {
    result.current.signOut();
  });
  expect(result.current.signingOut).toBe(true);

  await act(() => {
    finish({ ok: true });
  });
  expect(result.current).toMatchObject({ signingOut: false, error: undefined });
});

test("keeps a failure's message key until the next attempt", async () => {
  mockSignOut.mockResolvedValueOnce({ ok: false, error: 'auth.error.rateLimited' });
  const { result } = await renderHook(() => useSignOut());

  await act(() => {
    result.current.signOut();
  });
  expect(result.current).toMatchObject({ signingOut: false, error: 'auth.error.rateLimited' });

  mockSignOut.mockResolvedValueOnce({ ok: true });
  await act(() => {
    result.current.signOut();
  });
  expect(result.current.error).toBeUndefined();
});

test('deletes this phone’s push row with the session before signing out', async () => {
  const order: string[] = [];
  mockForget.mockImplementationOnce((userId) => {
    order.push(`forget:${userId}`);
    return Promise.resolve();
  });
  mockSignOut.mockImplementationOnce(() => {
    order.push('signOut');
    return Promise.resolve({ ok: true });
  });
  const { result } = await renderHook(() => useSignOut());

  await act(() => {
    result.current.signOut();
  });

  expect(order).toEqual(['forget:user-1', 'signOut']);
});

test(`a push delete that hangs never holds sign-out past ${String(FORGET_PUSH_WAIT_MS)} ms`, async () => {
  jest.useFakeTimers();
  try {
    mockForget.mockImplementationOnce(() => new Promise<void>(() => undefined));
    mockSignOut.mockResolvedValueOnce({ ok: true });
    const { result } = await renderHook(() => useSignOut());

    await act(() => {
      result.current.signOut();
    });
    expect(mockSignOut).not.toHaveBeenCalled();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(FORGET_PUSH_WAIT_MS);
    });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});
