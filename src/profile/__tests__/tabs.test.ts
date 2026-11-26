import { visibleTabs } from '../tabs';

test('the companion tab exists only with the AI on', () => {
  expect(visibleTabs({ aiEnabled: true })).toEqual(['today', 'companion', 'history', 'profile']);
  expect(visibleTabs({ aiEnabled: false })).toEqual(['today', 'history', 'profile']);
});
