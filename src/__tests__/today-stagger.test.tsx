// Its own file: the signal rows stagger once per app session, and a module registry per file is a fresh session.
import { act, render, screen } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';

import Today from '../app/(tabs)/today';
import { endEpisode, startEpisode } from '../episodes/episodeStore';
import { formatClock } from '../i18n/format';
import { translate } from '../i18n';
import type { MessageKey, Params } from '../i18n';
import { resetAuth } from '../test/authMock';
import { clearLocalDb } from '../test/localDbTest';

jest.mock('expo-sqlite', () => require('../test/sqliteNode'));
jest.mock('expo-crypto', () => ({ randomUUID: () => (require('node:crypto') as typeof import('node:crypto')).randomUUID() }));
jest.mock('../auth/AuthProvider', () => require('../test/authMock'));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useFocusEffect: (effect: () => void) => {
    jest.requireActual<typeof import('react')>('react').useEffect(() => {
      effect();
    }, []);
  },
}));
jest.mock('../signals/signalRepository', () => ({ fetchTodayPressure: jest.fn(() => Promise.resolve(null)), readCachedPressure: () => null, freshPressure: () => null }));
jest.mock('../lib/sync/SyncProvider', () => ({ useSyncState: () => ({ pending: 0, failed: 0, syncing: false, retry: jest.fn() }) }));

const t = (key: MessageKey, params?: Params): string => translate('en', key, params);
const NOW = new Date(2026, 10, 26, 14, 20);

/** Whether the row's own animated wrapper carries an entering animation (the mock renders it as a plain view). */
function rises(row: TestInstance): boolean {
  for (let node: TestInstance | null = row; node !== null; node = node.parent) {
    if (node.props.entering !== undefined) return true;
  }
  return false;
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['queueMicrotask'] });
  clearLocalDb();
  resetAuth();
});

afterEach(() => {
  jest.useRealTimers();
});

test('the signal rows rise in on the first render only; a row that arrives later shows in place', async () => {
  const view = await render(<Today />);
  const quiet = screen.getByRole('button', { name: `${t('signal.quiet.title')}. ${t('signal.quiet.reason')}` });
  expect(rises(quiet)).toBe(true);

  // An attack that ended last evening adds the debrief row while Today is open.
  const ended = new Date(2026, 10, 25, 18, 40);
  await act(async () => {
    endEpisode('user-1', startEpisode('user-1', new Date(2026, 10, 25, 17, 0)), ended);
    await Promise.resolve();
  });
  const debrief = screen.getByRole('button', { name: `${t('signal.debrief.title')}. ${t('signal.debrief.reason', { time: formatClock(ended, 'en') })}` });
  expect(rises(debrief)).toBe(false);

  // A later visit in the same session shows every row in place.
  await view.unmount();
  await render(<Today />);
  expect(rises(screen.getByRole('button', { name: `${t('signal.debrief.title')}. ${t('signal.debrief.reason', { time: formatClock(ended, 'en') })}` }))).toBe(false);
});
