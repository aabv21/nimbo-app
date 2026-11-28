import { act, renderHook } from '@testing-library/react-native';

import { notifyChanged } from '../db';
import { useLocalQuery } from '../useLocalQuery';

jest.mock('expo-sqlite', () => require('../../../test/sqliteNode'));

test('the snapshot is read again only when a listed table changes', async () => {
  let reads = 0;
  const read = (): { reads: number } => {
    reads += 1;
    return { reads };
  };
  const { result, rerender } = await renderHook(() => useLocalQuery(['episodes', 'doses'], read));
  const first = result.current;
  expect(first.reads).toBe(1);

  await rerender({});
  expect(result.current).toBe(first);

  await act(() => {
    notifyChanged(['checkins']);
  });
  expect(result.current).toBe(first);

  await act(() => {
    notifyChanged(['doses']);
  });
  expect(result.current.reads).toBe(2);
});

test('a new read function (other arguments) reads again', async () => {
  const { result, rerender } = await renderHook(({ id }: { id: string }) => useLocalQuery(['episodes'], () => id), {
    initialProps: { id: 'a' },
  });
  expect(result.current).toBe('a');
  await rerender({ id: 'b' });
  expect(result.current).toBe('b');
});
