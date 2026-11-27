// The 5-minute rule has one home, the condition pack, which both the stores and the companion's drafts read.
import { MAX_AHEAD_MS } from '../../../condition';
import { checkedTime, CLOCK_SKEW_MS } from '../clientTime';

const NOW = new Date('2026-11-27T17:00:00.000Z');

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

test('the stores take the shared rule: up to 5 minutes ahead, never later', () => {
  expect(CLOCK_SKEW_MS).toBe(MAX_AHEAD_MS);
  expect(MAX_AHEAD_MS).toBe(5 * 60_000);
  expect(checkedTime(new Date(NOW.getTime() + MAX_AHEAD_MS))).toBe(NOW.getTime() + MAX_AHEAD_MS);
  expect(() => checkedTime(new Date(NOW.getTime() + MAX_AHEAD_MS + 1_000))).toThrow(RangeError);
});
