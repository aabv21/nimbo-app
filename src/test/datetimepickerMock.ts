// The picker is native: a plain view that keeps its props, so a test can call `onValueChange` as the OS would.
import { createElement } from 'react';
import { View } from 'react-native';

export default function DateTimePicker(props: Record<string, unknown>): React.JSX.Element {
  return createElement(View, { testID: 'datetimepicker', ...props });
}

export const DateTimePickerAndroid = { open: jest.fn(), dismiss: jest.fn(() => Promise.resolve(true)) };
