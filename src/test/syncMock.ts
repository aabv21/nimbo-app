// A stand-in for `SyncProvider` in suites that render the root layout: `jest.mock('../lib/sync/SyncProvider',
// () => require('../test/syncMock'))`. Nothing syncs and the banner state is empty.
import type { SyncState } from '../lib/sync/SyncProvider';

const state: SyncState = { pending: 0, failed: 0, syncing: false, retry: () => undefined };

export function useSyncState(): SyncState {
  return state;
}

export function SyncProvider({ children }: { children?: React.ReactNode }): React.ReactNode {
  return children;
}
