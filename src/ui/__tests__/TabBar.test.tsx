import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Calendar, House, User } from 'lucide-react-native';
import { AccessibilityInfo, StyleSheet, Text } from 'react-native';
import type { StyleProp, TextStyle } from 'react-native';

import { TAB_BAR_HEIGHT, TabBar, useTabBarInset } from '../TabBar';

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

test('each tab is read as a tab with its visible label and its selected state; none is icon-only', async () => {
  await render(<TabBar tabs={TABS} current="history" onSelect={jest.fn()} accessibilityLabel="Sections" />);

  for (const { label } of TABS) {
    const tab = screen.getByRole('tab', { name: label });
    expect(tab).toHaveAccessibleName(label);
    // The words are on screen too, under the icon.
    expect(screen.getByText(label)).toBeOnTheScreen();
  }
  expect(screen.getByRole('tab', { name: 'History' })).toBeSelected();
  expect(screen.getByRole('tab', { name: 'Today' })).not.toBeSelected();
});

test('at large text sizes the labels grow to 1.5× and shrink to fit their tab, never below the default size, instead of truncating', async () => {
  await render(<TabBar tabs={TABS} current="today" onSelect={jest.fn()} accessibilityLabel="Sections" />);

  for (const { label } of TABS) {
    const text = screen.getByText(label);
    expect(text.props.maxFontSizeMultiplier).toBeGreaterThanOrEqual(1.5);
    // One line that shrinks: a long word ("Histórico") never breaks mid-word or ends in an ellipsis.
    expect(text.props.numberOfLines).toBe(1);
    expect(text.props.adjustsFontSizeToFit).toBe(true);
    expect(text.props.maxFontSizeMultiplier * text.props.minimumFontScale).toBeGreaterThanOrEqual(1);
    expect(StyleSheet.flatten(text.props.style as StyleProp<TextStyle>)?.height).toBeUndefined();
  }
});

function InsetProbe(): React.JSX.Element {
  return <Text testID="inset">{String(useTabBarInset())}</Text>;
}

test('the screens leave room for the bar at its measured height, so a taller bar never covers the last row', async () => {
  await render(
    <>
      <InsetProbe />
      <TabBar tabs={TABS} current="today" onSelect={jest.fn()} accessibilityLabel="Sections" />
    </>,
  );
  const before = Number(screen.getByTestId('inset').props.children);
  expect(before).toBeGreaterThanOrEqual(TAB_BAR_HEIGHT);

  await fireEvent(screen.getByTestId('tab-bar'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 360, height: TAB_BAR_HEIGHT + 24 } } });
  expect(Number(screen.getByTestId('inset').props.children)).toBe(before + 24);

  // A bar measured shorter than its default (a first layout pass) never shrinks the room below the default.
  await fireEvent(screen.getByTestId('tab-bar'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 10 } } });
  expect(Number(screen.getByTestId('inset').props.children)).toBe(before);
});
