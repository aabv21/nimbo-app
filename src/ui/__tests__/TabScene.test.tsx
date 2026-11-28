import { render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { withTiming } from 'react-native-reanimated';

import type { MotionPreset } from '../motion';
import { motionFor } from '../motion';
import { TabScene } from '../TabScene';

const mockMotion: { current: MotionPreset } = { current: { level: 'full', duration: { fast: 120, base: 220, slow: 400 } } };
jest.mock('../motion', () => ({
  ...jest.requireActual<object>('../motion'),
  useMotion: () => mockMotion.current,
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  ...jest.requireActual<object>('../../test/reanimatedMock'),
  withTiming: jest.fn((toValue: unknown) => toValue),
}));

const entrances = jest.mocked(withTiming);

function scene(focused: boolean, still = false): React.JSX.Element {
  return (
    <TabScene focused={focused} still={still}>
      <Text>Profile body</Text>
    </TabScene>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockMotion.current = motionFor('day', false);
});

test('the tab the shell opens on appears without an entrance', async () => {
  await render(scene(true, true));
  expect(screen.getByText('Profile body')).toBeOnTheScreen();
  expect(entrances).not.toHaveBeenCalled();
});

test('a tab rises in each time it becomes the focused one', async () => {
  await render(scene(true));
  expect(entrances).toHaveBeenCalledTimes(1);
  await screen.rerender(scene(false));
  await screen.rerender(scene(true));
  expect(entrances).toHaveBeenCalledTimes(2);
});

test.each([
  ['Dim', motionFor('dim', false)],
  ['Reduce motion', motionFor('day', true)],
])('switching to %s while the tab is focused does not replay its entrance', async (_name, next) => {
  await render(scene(true));
  expect(entrances).toHaveBeenCalledTimes(1);

  mockMotion.current = next;
  await screen.rerender(scene(true));
  expect(entrances).toHaveBeenCalledTimes(1);

  // The new level is the one the next focus change uses.
  await screen.rerender(scene(false));
  await screen.rerender(scene(true));
  expect(entrances).toHaveBeenLastCalledWith(1, expect.objectContaining({ duration: next.duration.base }));
});
