import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Calendar, House, User } from 'lucide-react-native';
import { AccessibilityInfo } from 'react-native';

import { TabBar } from '../TabBar';

const TABS = [
  { key: 'today', label: 'Today', icon: House },
  { key: 'history', label: 'History', icon: Calendar },
  { key: 'profile', label: 'Profile', icon: User },
] as const;

function reduceTransparency(on: boolean): void {
  jest.spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled').mockResolvedValue(on);
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.mocked(isLiquidGlassAvailable).mockReturnValue(false);
});

test('with reduce transparency on, the bar is opaque: no glass or blur view is rendered', async () => {
  reduceTransparency(true);
  jest.mocked(isLiquidGlassAvailable).mockReturnValue(true);
  await render(<TabBar tabs={TABS} current="today" onSelect={jest.fn()} accessibilityLabel="Sections" />);

  expect(await screen.findByTestId('tab-bar-opaque')).toBeOnTheScreen();
  expect(screen.queryByTestId('tab-bar-glass')).toBeNull();
  expect(screen.queryByTestId('tab-bar-blur')).toBeNull();
});

test('until the OS answers whether to reduce transparency, the bar is opaque', async () => {
  let answer: (on: boolean) => void = () => undefined;
  jest.spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled').mockReturnValue(
    new Promise((resolve) => {
      answer = resolve;
    }),
  );
  jest.mocked(isLiquidGlassAvailable).mockReturnValue(true);
  await render(<TabBar tabs={TABS} current="today" onSelect={jest.fn()} accessibilityLabel="Sections" />);

  // The read is still pending here: a first frame of glass would flash for a user who asked for none.
  expect(screen.getByTestId('tab-bar-opaque')).toBeOnTheScreen();
  expect(screen.queryByTestId('tab-bar-glass')).toBeNull();
  expect(screen.queryByTestId('tab-bar-blur')).toBeNull();

  await act(async () => {
    answer(false);
    await Promise.resolve();
  });
  expect(screen.getByTestId('tab-bar-glass')).toBeOnTheScreen();
});

test('on iOS 26 the bar is the system glass', async () => {
  reduceTransparency(false);
  jest.mocked(isLiquidGlassAvailable).mockReturnValue(true);
  await render(<TabBar tabs={TABS} current="today" onSelect={jest.fn()} accessibilityLabel="Sections" />);

  expect(await screen.findByTestId('tab-bar-glass')).toBeOnTheScreen();
  expect(screen.queryByTestId('tab-bar-opaque')).toBeNull();
});

test('without the system glass the bar blurs what is behind it', async () => {
  reduceTransparency(false);
  await render(<TabBar tabs={TABS} current="today" onSelect={jest.fn()} accessibilityLabel="Sections" />);

  expect(await screen.findByTestId('tab-bar-blur')).toBeOnTheScreen();
});

test('each tab is a tab with its state, and pressing another one selects it', async () => {
  const onSelect = jest.fn();
  await render(<TabBar tabs={TABS} current="today" onSelect={onSelect} accessibilityLabel="Sections" />);

  expect(screen.getByRole('tab', { name: 'Today' })).toBeSelected();
  expect(screen.getByRole('tab', { name: 'History' })).not.toBeSelected();
  await fireEvent.press(screen.getByRole('tab', { name: 'History' }));
  expect(onSelect).toHaveBeenCalledWith('history');
});

test('pressing the current tab selects nothing', async () => {
  const onSelect = jest.fn();
  await render(<TabBar tabs={TABS} current="today" onSelect={onSelect} accessibilityLabel="Sections" />);

  await fireEvent.press(screen.getByRole('tab', { name: 'Today' }));
  expect(onSelect).not.toHaveBeenCalled();
});
