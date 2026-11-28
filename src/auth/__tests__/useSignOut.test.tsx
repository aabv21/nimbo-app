import { act, renderHook } from '@testing-library/react-native';

const mockSignOut = jest.fn<Promise<unknown>, []>();
jest.mock('../authService', () => ({ signOut: () => mockSignOut() }));

import { useSignOut } from '../useSignOut';

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
