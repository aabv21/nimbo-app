import { render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Platform } from 'react-native';

import { AlertText } from '../AlertText';
import { Notice } from '../Notice';
import { TextField } from '../TextField';

const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
const platform = Platform.OS;

function on(os: typeof Platform.OS): void {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

beforeEach(() => {
  announce.mockClear();
  on('ios');
});

afterAll(() => {
  on(platform);
});

test('on iOS a notice that appears is spoken once, title then body; a re-render says nothing new', async () => {
  const view = await render(<Notice tone="danger" title="Could not export" body="Check your connection." />);
  expect(announce).toHaveBeenCalledTimes(1);
  expect(announce).toHaveBeenCalledWith('Could not export. Check your connection.');

  await view.rerender(<Notice tone="danger" title="Could not export" body="Check your connection." />);
  expect(announce).toHaveBeenCalledTimes(1);
  await view.rerender(<Notice tone="info" title="Your file is ready" />);
  expect(announce).toHaveBeenLastCalledWith('Your file is ready');
});

test('a standing status notice (announce={false}) is not spoken when its screen opens or its words change', async () => {
  const view = await render(<Notice tone="warning" announce={false} title="2 records could not be uploaded" />);
  await view.rerender(<Notice tone="warning" announce={false} title="3 records could not be uploaded" />);
  expect(announce).not.toHaveBeenCalled();
});

test('on Android the live region speaks it, so there is no second announcement', async () => {
  on('android');
  await render(<Notice testID="notice" tone="danger" title="Could not export" />);
  expect(screen.getByTestId('notice')).toHaveProp('accessibilityLiveRegion', 'assertive');
  expect(announce).not.toHaveBeenCalled();
});

test("a field's error is spoken when it appears, and an inline alert when it shows", async () => {
  const field = await render(<TextField label="Time" value="" onChangeText={jest.fn()} />);
  expect(announce).not.toHaveBeenCalled();
  await field.rerender(<TextField label="Time" value="" onChangeText={jest.fn()} error="Type a time like 21:05" />);
  expect(announce).toHaveBeenCalledWith('Type a time like 21:05');
  await field.unmount();

  await render(<AlertText text="That end is before the start" />);
  expect(announce).toHaveBeenLastCalledWith('That end is before the start');
  expect(screen.getByRole('alert')).toHaveProp('accessibilityLiveRegion', 'assertive');
});
