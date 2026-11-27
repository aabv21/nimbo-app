import { useCallback, useRef, useSyncExternalStore } from 'react';

import { subscribeTables, tableVersion } from './db';
import type { LocalTable } from './db';

interface Cached<T> {
  read: () => T;
  stamp: string;
  value: T;
}

/**
 * A synchronous read of the local store that re-renders when one of `tables` changes. Pass a stable
 * `read` (`useCallback` over its arguments): a new function reads again, any other render does not.
 */
export function useLocalQuery<T>(tables: readonly LocalTable[], read: () => T): T {
  const cached = useRef<Cached<T> | null>(null);
  // A string, so a caller's inline array literal does not resubscribe on every render.
  const tableKey = tables.join(',');

  const subscribe = useCallback(
    (onChange: () => void) => subscribeTables(tableKey.split(',') as LocalTable[], onChange),
    [tableKey],
  );

  const getSnapshot = useCallback((): T => {
    const stamp = tableKey
      .split(',')
      .map((table) => tableVersion(table as LocalTable))
      .join(',');
    const current = cached.current;
    if (current !== null && current.read === read && current.stamp === stamp) return current.value;
    const value = read();
    cached.current = { read, stamp, value };
    return value;
  }, [tableKey, read]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
