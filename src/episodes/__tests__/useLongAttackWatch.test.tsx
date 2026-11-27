import { renderHook } from '@testing-library/react-native';
import { usePathname } from 'expo-router';

import { kvGet } from '../../lib/kv';
import { useOnResume } from '../../lib/useOnResume';
import { currentUrgentCare, showUrgentCare } from '../../redflags/urgentCare';
import { clearLocalDb } from '../../test/localDbTest';
import { endEpisode, startEpisode } from '../episodeStore';
import { useLongAttackWatch } from '../useLongAttackWatch';

jest.mock('expo-sqlite', () => require('../../test/sqliteNode'));
jest.mock('expo-crypto', () => ({ randomUUID: () => (require('node:crypto') as typeof import('node:crypto')).randomUUID() }));
jest.mock('expo-router', () => ({ usePathname: jest.fn(() => '/today') }));
jest.mock('../../redflags/urgentCare', () => ({ showUrgentCare: jest.fn(), currentUrgentCare: jest.fn(() => null) }));
jest.mock('../../lib/useOnResume', () => ({ useOnResume: jest.fn() }));

const show = jest.mocked(showUrgentCare);
const STARTED = new Date('2026-11-23T10:00:00Z');
const HOUR = 60 * 60 * 1000;

function at(hours: number): void {
  jest.setSystemTime(STARTED.getTime() + hours * HOUR);
}

/** What the app does on returning to the foreground: the latest callback passed to `useOnResume`. */
function resume(): void {
  const calls = jest.mocked(useOnResume).mock.calls;
  calls[calls.length - 1]?.[0]('foreground');
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  clearLocalDb();
});

afterEach(() => {
  jest.useRealTimers();
});

test('at 71 hours nothing opens', async () => {
  startEpisode('user-1', STARTED);
  at(71);
  await renderHook(() => {
    useLongAttackWatch('user-1');
  });
  resume();
  expect(show).not.toHaveBeenCalled();
});

test('at 72 hours urgent care opens once with long_attack, and neither a resume nor a relaunch opens it again', async () => {
  const id = startEpisode('user-1', STARTED);
  at(71);
  const hook = await renderHook(() => {
    useLongAttackWatch('user-1');
  });
  at(72);
  resume();

  expect(show).toHaveBeenCalledTimes(1);
  expect(show).toHaveBeenCalledWith({ flags: ['long_attack'], source: 'duration', excerpt: null, episodeId: id });
  expect(kvGet(`redflag.long.${id}`)).not.toBeNull();

  at(80);
  resume();
  await hook.unmount();
  await renderHook(() => {
    useLongAttackWatch('user-1');
  });
  resume();
  expect(show).toHaveBeenCalledTimes(1);
});

test('on mount past 72 hours it opens at once', async () => {
  const id = startEpisode('user-1', STARTED);
  at(73);
  await renderHook(() => {
    useLongAttackWatch('user-1');
  });
  expect(show).toHaveBeenCalledWith(expect.objectContaining({ episodeId: id }));
});

test('while urgent care is already showing it does not push a second screen, and opens on a later resume', async () => {
  const id = startEpisode('user-1', STARTED);
  at(72);
  jest.mocked(currentUrgentCare).mockReturnValue({ flags: ['thunderclap'], excerpt: 'x', source: 'text', episodeId: null });
  await renderHook(() => {
    useLongAttackWatch('user-1');
  });
  expect(show).not.toHaveBeenCalled();
  expect(kvGet(`redflag.long.${id}`)).toBeNull();

  jest.mocked(currentUrgentCare).mockReturnValue(null);
  resume();
  expect(show).toHaveBeenCalledTimes(1);
});

test('on the landing route it waits for the redirect, then opens', async () => {
  startEpisode('user-1', STARTED);
  at(73);
  jest.mocked(usePathname).mockReturnValue('/');
  const hook = await renderHook(() => {
    useLongAttackWatch('user-1');
  });
  expect(show).not.toHaveBeenCalled();

  jest.mocked(usePathname).mockReturnValue('/today');
  await hook.rerender(undefined);
  expect(show).toHaveBeenCalledTimes(1);
});

test('an ended attack, another user’s attack, or no user opens nothing', async () => {
  const ended = startEpisode('user-1', STARTED);
  endEpisode('user-1', ended, new Date(STARTED.getTime() + 2 * HOUR));
  startEpisode('user-2', STARTED);
  at(100);
  await renderHook(() => {
    useLongAttackWatch('user-1');
  });
  await renderHook(() => {
    useLongAttackWatch(null);
  });
  resume();
  expect(show).not.toHaveBeenCalled();
});
