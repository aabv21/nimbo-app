import { kvGet, kvSet } from '../../lib/kv';
import { debriefDoneKey, markDebriefDone, readDebriefsDone, removeDebriefsDone } from '../debriefDone';

beforeEach(() => {
  removeDebriefsDone('user-a');
  removeDebriefsDone('user-b');
});

test('marks per user under one key, once each, and one remove clears them all', () => {
  markDebriefDone('user-a', 'e1');
  markDebriefDone('user-a', 'e2');
  markDebriefDone('user-a', 'e1');
  markDebriefDone('user-b', 'e9');
  expect([...readDebriefsDone('user-a')]).toEqual(['e2', 'e1']);
  expect([...readDebriefsDone('user-b')]).toEqual(['e9']);
  removeDebriefsDone('user-a');
  expect(kvGet(debriefDoneKey('user-a'))).toBeNull();
  expect(readDebriefsDone('user-b').has('e9')).toBe(true);
});

test('keeps the last 20, the oldest dropping off', () => {
  for (let index = 1; index <= 22; index += 1) markDebriefDone('user-a', `e${String(index)}`);
  const done = readDebriefsDone('user-a');
  expect(done.size).toBe(20);
  expect(done.has('e1')).toBe(false);
  expect(done.has('e22')).toBe(true);
});

test('an unreadable value reads as none', () => {
  kvSet(debriefDoneKey('user-a'), '{"not":"a list"}');
  expect(readDebriefsDone('user-a').size).toBe(0);
});
