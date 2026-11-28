import { renderHook, waitFor } from '@testing-library/react-native';

import { kvGet, kvRemove, kvSet } from '../../lib/kv';
import { resetAuth, setAuth } from '../../test/authMock';
import { usePremium } from '../usePremium';

jest.mock('../../auth/AuthProvider', () => require('../../test/authMock'));
const mockedRpc = jest.fn();
jest.mock('../../lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockedRpc(...args) } }));

beforeEach(() => {
  mockedRpc.mockReset();
  resetAuth();
  kvRemove('premium.user-1');
  kvRemove('premium.user-2');
});

test('it answers the RPC value and keeps it', async () => {
  mockedRpc.mockResolvedValue({ data: true, error: null });
  const { result } = await renderHook(() => usePremium());
  await waitFor(() => {
    expect(result.current).toEqual({ premium: true, loading: false });
  });
  expect(mockedRpc).toHaveBeenCalledWith('has_premium', { p_user: 'user-1' });
  expect(kvGet('premium.user-1')).toBe('true');
});

test('a false answer replaces a cached true', async () => {
  kvSet('premium.user-1', 'true');
  mockedRpc.mockResolvedValue({ data: false, error: null });
  const { result } = await renderHook(() => usePremium());
  await waitFor(() => {
    expect(result.current).toEqual({ premium: false, loading: false });
  });
  expect(kvGet('premium.user-1')).toBe('false');
});

test('offline it answers the cached value', async () => {
  kvSet('premium.user-1', 'true');
  mockedRpc.mockResolvedValue({ data: null, error: { code: '', message: 'Failed to fetch' } });
  const { result } = await renderHook(() => usePremium());
  await waitFor(() => {
    expect(result.current.loading).toBe(false);
  });
  expect(result.current.premium).toBe(true);
  expect(kvGet('premium.user-1')).toBe('true');
});

test('offline with nothing cached is not premium', async () => {
  mockedRpc.mockRejectedValue(new TypeError('Network request failed'));
  const { result } = await renderHook(() => usePremium());
  await waitFor(() => {
    expect(result.current.loading).toBe(false);
  });
  expect(result.current.premium).toBe(false);
});

test('another user\'s cache is never read', async () => {
  kvSet('premium.user-1', 'true');
  resetAuth({ userId: 'user-2' });
  mockedRpc.mockReturnValue(new Promise(() => undefined));
  const { result } = await renderHook(() => usePremium());
  expect(result.current).toEqual({ premium: false, loading: true });
});

test('a change of user starts again from that user\'s own cache', async () => {
  kvSet('premium.user-1', 'true');
  mockedRpc.mockReturnValue(new Promise(() => undefined));
  const { result } = await renderHook(() => usePremium());
  expect(result.current.premium).toBe(true);
  setAuth({ userId: 'user-2' });
  await waitFor(() => {
    expect(result.current.premium).toBe(false);
  });
});

test('signed out it is not premium and asks nothing', async () => {
  resetAuth({ status: 'signedOut', userId: null });
  const { result } = await renderHook(() => usePremium());
  expect(result.current).toEqual({ premium: false, loading: false });
  expect(mockedRpc).not.toHaveBeenCalled();
});
